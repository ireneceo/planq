// 자체 결제 서비스 — 플랜 변경 / Subscription 활성화 / 강등 cron
//
// 1순위: 자체 결제 (계좌이체 mark-paid)
// 2순위: PortOne (P-7 마지막 단계, 같은 Subscription 모델 재사용)
//
// 흐름:
//   사용자가 플랜 변경 요청 → createPendingSubscription
//     → 기존 active Subscription 은 'replaced' 로
//     → 신규 Subscription(pending) + Payment(pending) 생성
//     → 입금 안내 메일 발송 (admin 도 동일 안내 받음)
//   admin (workspace owner) mark-paid → activateSubscription
//     → Payment.status='paid', paid_at, marked_by 저장
//     → Subscription.status='active', period 설정
//     → Business.plan 업데이트, BusinessPlanHistory 기록
//   cron (매일 자정):
//     - active 중 current_period_end 지난 것 → past_due
//     - past_due → grace (D+1)
//     - grace_ends_at 지난 것 (D+8) → demoted, Business.plan='free'

const { Op } = require('sequelize');
const { Subscription, Payment, Business, BusinessPlanHistory, User, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { sendEmail } = require('./emailService');
const PLANS = require('../config/plans');

const GRACE_DAYS = 7;

// 다음 결제일 계산
function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d;
}

function getPlanPrice(planCode, cycle, currency = 'KRW') {
  const plan = PLANS.PLANS?.[planCode] || PLANS[planCode];
  if (!plan) return null;
  const priceMap = cycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
  return priceMap?.[currency] ?? 0;
}

// 입금 안내 이메일
function bankInstructionHtml({ businessName, planName, amount, currency, cycle, accountInfo, paymentId }) {
  const amountStr = currency === 'KRW' ? `${Number(amount).toLocaleString()}원` : `${currency} ${Number(amount).toLocaleString()}`;
  const cycleLabel = cycle === 'monthly' ? '월간' : '연간';
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:32px;">
      <tr><td>
        <div style="font-size:13px;color:#64748B;letter-spacing:1px;text-transform:uppercase;font-weight:700;">PlanQ</div>
        <h1 style="margin:8px 0 16px;font-size:20px;color:#0F172A;font-weight:700;">${businessName} · ${planName} ${cycleLabel} 결제 안내</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;">
          아래 계좌로 <strong>${amountStr}</strong> 입금 후, PlanQ 워크스페이스 관리자가 결제 확인을 처리하면 즉시 활성화됩니다.
        </p>
        <table cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;margin-bottom:16px;">
          <tr><td style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding-bottom:6px;">입금 계좌</td></tr>
          <tr><td style="font-size:14px;color:#0F172A;font-weight:600;line-height:1.7;">
            ${accountInfo || 'PlanQ 결제 계좌 정보 미설정 — support@planq.kr 문의'}
          </td></tr>
          <tr><td style="font-size:11px;color:#64748B;padding-top:12px;border-top:1px solid #E2E8F0;margin-top:12px;">
            입금자명에 결제 ID <strong>#${paymentId}</strong> 또는 워크스페이스명을 함께 적어주세요.
          </td></tr>
        </table>
        <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.6;">
          이 결제는 24시간 내 미입금 시 자동 취소됩니다. 문의: support@planq.kr
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ─── 1. 플랜 변경 (사용자 요청) — 신규 Subscription + pending Payment 생성 ───
async function createPendingSubscription({ businessId, planCode, cycle, userId, currency = 'KRW' }) {
  const plan = PLANS.PLANS?.[planCode] || PLANS[planCode];
  if (!plan) throw new Error('invalid_plan_code');
  if (planCode === 'free') {
    // Free 로 다운그레이드는 Subscription 없이 바로 처리 (별도 함수)
    return await downgradeToFree({ businessId, userId, reason: 'downgrade' });
  }

  const price = getPlanPrice(planCode, cycle, currency);
  if (price == null) throw new Error('price_not_available');
  if (price === 0) throw new Error('use_downgrade_for_free');

  const t = await sequelize.transaction();
  try {
    // 기존 active/past_due/grace 구독 → replaced 처리
    await Subscription.update(
      { status: 'replaced', canceled_at: new Date() },
      {
        where: {
          business_id: businessId,
          status: { [Op.in]: ['active', 'past_due', 'grace', 'pending'] },
        },
        transaction: t,
      }
    );

    const sub = await Subscription.create({
      business_id: businessId,
      plan_code: planCode,
      cycle, status: 'pending',
      price, currency,
      created_by: userId,
    }, { transaction: t });

    const pay = await Payment.create({
      business_id: businessId,
      subscription_id: sub.id,
      method: 'bank_transfer',
      status: 'pending',
      amount: price, currency, cycle,
      created_by: userId,
    }, { transaction: t });

    await t.commit();

    // 입금 안내 이메일 발송 (admin/owner 들에게)
    // 계좌는 PlanQ SaaS 결제 계좌 (env). 워크스페이스 자체 계좌가 아님 — 사용자가 PlanQ 에 송금
    try {
      const biz = await Business.findByPk(businessId, {
        attributes: ['name', 'brand_name'],
      });
      const owners = await BusinessMember.findAll({
        where: { business_id: businessId, role: 'owner', removed_at: null },
        include: [{ model: User, as: 'user', attributes: ['email', 'name'] }],
      });
      const planqBankName = process.env.PLANQ_BILLING_BANK_NAME;
      const planqBankAccount = process.env.PLANQ_BILLING_BANK_ACCOUNT;
      const planqBankHolder = process.env.PLANQ_BILLING_BANK_HOLDER || 'PlanQ';
      const accountInfo = planqBankName && planqBankAccount
        ? `${planqBankName} ${planqBankAccount} (예금주 ${planqBankHolder})`
        : 'PlanQ 결제 계좌 정보가 미설정 — support@planq.kr 문의 부탁드립니다.';
      const html = bankInstructionHtml({
        businessName: biz?.brand_name || biz?.name || '',
        planName: plan.name_ko || plan.name,
        amount: price, currency, cycle,
        accountInfo,
        paymentId: pay.id,
      });
      const subject = `[PlanQ] ${plan.name_ko || plan.name} ${cycle === 'monthly' ? '월간' : '연간'} 결제 안내 #${pay.id}`;
      for (const m of owners) {
        if (m.user?.email) {
          await sendEmail({ to: m.user.email, subject, html }).catch(() => null);
        }
      }
      if (!process.env.SMTP_HOST) {
        console.log(`[DEV-BILLING] payment=${pay.id} biz=${businessId} ${planCode}/${cycle} ${price} ${currency}`);
      }
    } catch (e) {
      console.error('[billing] email failed:', e.message);
    }

    return { subscription: sub, payment: pay };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// ─── 2. mark-paid (admin 액션) — Subscription 활성화 ───
async function markPaymentPaid({ paymentId, markedByUserId, payerName, payerMemo }) {
  const t = await sequelize.transaction();
  try {
    const pay = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pay) throw new Error('payment_not_found');
    if (pay.status === 'paid') { await t.rollback(); return { payment: pay, alreadyPaid: true }; }
    if (pay.status !== 'pending') throw new Error('invalid_state');

    const sub = await Subscription.findByPk(pay.subscription_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!sub) throw new Error('subscription_not_found');

    const now = new Date();
    const periodStart = sub.current_period_end && sub.current_period_end > now
      ? sub.current_period_end // 연장 (이미 active 상태에서 다음 cycle 결제)
      : now;                   // 신규 활성화
    const periodEnd = addCycle(periodStart, sub.cycle);

    await pay.update({
      status: 'paid',
      paid_at: now,
      marked_by: markedByUserId,
      marked_at: now,
      payer_name: payerName ? String(payerName).slice(0, 80) : pay.payer_name,
      payer_memo: payerMemo ? String(payerMemo).slice(0, 255) : pay.payer_memo,
      period_start: periodStart,
      period_end: periodEnd,
    }, { transaction: t });

    const wasFirst = sub.status === 'pending';
    await sub.update({
      status: 'active',
      started_at: sub.started_at || now,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      next_billing_at: periodEnd,
      past_due_at: null, grace_started_at: null, grace_ends_at: null, demoted_at: null,
    }, { transaction: t });

    // Business.plan 동기화 + 이력 기록
    const biz = await Business.findByPk(sub.business_id, { transaction: t, lock: t.LOCK.UPDATE });
    const fromPlan = biz.plan;
    if (biz.plan !== sub.plan_code || biz.subscription_status !== 'active') {
      await biz.update({
        plan: sub.plan_code,
        subscription_status: 'active',
        plan_expires_at: periodEnd,
        scheduled_plan: null,
      }, { transaction: t });
    }
    if (wasFirst || fromPlan !== sub.plan_code) {
      await BusinessPlanHistory.create({
        business_id: sub.business_id,
        from_plan: fromPlan,
        to_plan: sub.plan_code,
        reason: fromPlan === 'free' || PLANS.PLANS?.[fromPlan]?.price_monthly?.KRW < sub.price ? 'upgrade' : 'downgrade',
        changed_by: markedByUserId,
        note: `Payment #${pay.id} marked-paid`,
      }, { transaction: t });
    }

    await t.commit();
    // plan engine 캐시 무효화 (Business.plan 변경 후 status 조회가 stale 안 되게)
    try { require('./plan').invalidateBusinessCache(sub.business_id); } catch { /* noop */ }
    return { payment: pay, subscription: sub };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// ─── 3. Free 강등 (cron 또는 admin) ───
async function downgradeToFree({ businessId, userId, reason = 'expire' }) {
  const t = await sequelize.transaction();
  try {
    const biz = await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!biz) throw new Error('business_not_found');
    const fromPlan = biz.plan;
    await biz.update({
      plan: 'free',
      subscription_status: 'active', // Free 는 active 상태
      plan_expires_at: null,
      scheduled_plan: null,
    }, { transaction: t });

    // 활성 구독 demoted 처리
    await Subscription.update(
      { status: 'demoted', demoted_at: new Date() },
      {
        where: {
          business_id: businessId,
          status: { [Op.in]: ['active', 'past_due', 'grace'] },
        },
        transaction: t,
      }
    );

    if (fromPlan !== 'free') {
      await BusinessPlanHistory.create({
        business_id: businessId,
        from_plan: fromPlan,
        to_plan: 'free',
        reason,
        changed_by: userId || null,
      }, { transaction: t });
    }
    await t.commit();
    try { require('./plan').invalidateBusinessCache(businessId); } catch { /* noop */ }
    return { businessId, fromPlan, toPlan: 'free' };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// ─── 4. cron — 4단계 (active → past_due → grace → demoted) ───
async function runDailyBillingCron() {
  const now = new Date();
  const stats = { active_to_past_due: 0, past_due_to_grace: 0, grace_to_demoted: 0 };

  // 1) active 중 current_period_end 지나간 것 → past_due
  const expiringActive = await Subscription.findAll({
    where: {
      status: 'active',
      current_period_end: { [Op.lt]: now },
    },
  });
  for (const s of expiringActive) {
    await s.update({
      status: 'past_due',
      past_due_at: now,
    });
    stats.active_to_past_due += 1;
  }

  // 2) past_due → grace (즉시 grace 진입, grace_ends_at = past_due_at + GRACE_DAYS)
  const stalePastDue = await Subscription.findAll({
    where: { status: 'past_due' },
  });
  for (const s of stalePastDue) {
    const startedAt = s.past_due_at || now;
    const endsAt = new Date(startedAt.getTime() + GRACE_DAYS * 86400 * 1000);
    await s.update({
      status: 'grace',
      grace_started_at: startedAt,
      grace_ends_at: endsAt,
    });
    // Business.subscription_status 동기화 + plan 엔진 캐시 무효화
    await Business.update(
      { subscription_status: 'past_due', grace_ends_at: endsAt },
      { where: { id: s.business_id } }
    );
    try { require('./plan').invalidateBusinessCache(s.business_id); } catch { /* noop */ }
    stats.past_due_to_grace += 1;
  }

  // 3) grace 만료 → demoted (Free 강등)
  const expiredGrace = await Subscription.findAll({
    where: {
      status: 'grace',
      grace_ends_at: { [Op.lt]: now },
    },
  });
  for (const s of expiredGrace) {
    await downgradeToFree({ businessId: s.business_id, reason: 'expire' });
    stats.grace_to_demoted += 1;
  }

  return stats;
}

// ─── 5. 영수증 PDF (Puppeteer 재사용) ───
async function buildReceiptPdf(paymentId) {
  const pay = await Payment.findByPk(paymentId, {
    include: [{ model: Subscription }],
  });
  if (!pay) throw new Error('payment_not_found');
  const biz = await Business.findByPk(pay.business_id, {
    attributes: ['name', 'brand_name', 'legal_name', 'tax_id', 'representative', 'address', 'bank_name'],
  });
  const plan = PLANS.PLANS?.[pay.Subscription?.plan_code] || {};
  const planLabel = plan.name_ko || plan.name || pay.Subscription?.plan_code || '';
  const cycleLabel = pay.cycle === 'monthly' ? '월간' : '연간';
  const amount = pay.currency === 'KRW' ? `${Number(pay.amount).toLocaleString()}원` : `${pay.currency} ${Number(pay.amount).toLocaleString()}`;
  const periodStart = pay.period_start ? new Date(pay.period_start).toISOString().slice(0, 10) : '—';
  const periodEnd = pay.period_end ? new Date(pay.period_end).toISOString().slice(0, 10) : '—';
  const paidAt = pay.paid_at ? new Date(pay.paid_at).toISOString().slice(0, 10) : '—';

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; color: #0F172A; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .sub { color: #64748B; font-size: 12px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #E2E8F0; padding: 10px 12px; text-align: left; font-size: 12px; }
    th { background: #F8FAFC; font-weight: 700; width: 30%; }
    .amount { font-size: 20px; font-weight: 700; color: #0D9488; }
  </style></head><body>
    <h1>영수증 / Receipt</h1>
    <div class="sub">PlanQ — ${biz?.brand_name || biz?.name || ''}</div>
    <table>
      <tr><th>영수번호</th><td>R-${pay.id}-${new Date(pay.paid_at || pay.created_at).getFullYear()}</td></tr>
      <tr><th>결제일</th><td>${paidAt}</td></tr>
      <tr><th>플랜</th><td>${planLabel} (${cycleLabel})</td></tr>
      <tr><th>이용 기간</th><td>${periodStart} ~ ${periodEnd}</td></tr>
      <tr><th>결제 금액</th><td class="amount">${amount}</td></tr>
      <tr><th>결제 방식</th><td>${pay.method === 'bank_transfer' ? '계좌이체' : pay.method}</td></tr>
      ${pay.payer_name ? `<tr><th>입금자명</th><td>${pay.payer_name}</td></tr>` : ''}
    </table>
    ${biz?.legal_name || biz?.tax_id ? `
    <h2 style="margin-top:32px;font-size:14px;">발행자 정보</h2>
    <table>
      ${biz.legal_name ? `<tr><th>상호</th><td>${biz.legal_name}</td></tr>` : ''}
      ${biz.tax_id ? `<tr><th>사업자등록번호</th><td>${biz.tax_id}</td></tr>` : ''}
      ${biz.representative ? `<tr><th>대표자</th><td>${biz.representative}</td></tr>` : ''}
      ${biz.address ? `<tr><th>주소</th><td>${biz.address}</td></tr>` : ''}
    </table>` : ''}
  </body></html>`;

  const { renderPdfFromHtml } = require('./pdfService');
  return renderPdfFromHtml(html);
}

// ─── 6. 현재 구독 조회 ───
async function getCurrentSubscription(businessId) {
  return await Subscription.findOne({
    where: {
      business_id: businessId,
      status: { [Op.in]: ['pending', 'active', 'past_due', 'grace'] },
    },
    order: [['created_at', 'DESC']],
  });
}

module.exports = {
  createPendingSubscription,
  markPaymentPaid,
  downgradeToFree,
  runDailyBillingCron,
  buildReceiptPdf,
  getCurrentSubscription,
  getPlanPrice,
};
