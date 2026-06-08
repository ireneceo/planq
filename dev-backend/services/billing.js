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
const { sendBillingInstructionEmail } = require('./emailService');
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

// ─── 1. 플랜 변경 (사용자 요청) — 신규 Subscription + pending Payment 생성 ───
async function createPendingSubscription({ businessId, planCode, cycle, userId, currency = 'KRW', taxInvoice = null }) {
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
      // 세금계산서 (한국 사업자 옵션) — mark-paid 시 발행 시도
      tax_invoice_requested: !!(taxInvoice && taxInvoice.biz_no),
      tax_invoice_data: (taxInvoice && taxInvoice.biz_no) ? {
        biz_no: String(taxInvoice.biz_no || '').slice(0, 20),
        biz_name: String(taxInvoice.biz_name || '').slice(0, 200),
        ceo_name: String(taxInvoice.ceo_name || '').slice(0, 80),
        address: String(taxInvoice.address || '').slice(0, 500),
        email: String(taxInvoice.email || '').slice(0, 200),
      } : null,
      tax_invoice_status: (taxInvoice && taxInvoice.biz_no) ? 'requested' : 'none',
    }, { transaction: t });

    await t.commit();

    // 입금 안내 이메일 발송 (admin/owner 들에게)
    // 계좌는 PlanQ SaaS 결제 계좌 (platform_settings 우선 + .env fallback). 워크스페이스 자체 계좌가 아님.
    try {
      const biz = await Business.findByPk(businessId, {
        attributes: ['name', 'brand_name'],
      });
      const owners = await BusinessMember.findAll({
        where: { business_id: businessId, role: 'owner', removed_at: null },
        include: [{ model: User, as: 'user', attributes: ['email', 'name'] }],
      });
      const wsName = biz?.brand_name || biz?.name || '';
      for (const m of owners) {
        if (m.user?.email) {
          await sendBillingInstructionEmail({
            to: m.user.email,
            kind: 'plan',
            workspaceName: wsName,
            itemName: plan.name_ko || plan.name,
            cycle,
            amount: price,
            currency,
            paymentId: pay.id,
            businessId,
          }).catch(() => null);
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
async function markPaymentPaid({ paymentId, markedByUserId, payerName, payerMemo, taxInvoice }) {
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

    // 세금계산서 신청 입력 (옵션) — checkout 시 안 받았어도 mark-paid 시점에 추가 가능
    const taxFields = (taxInvoice && taxInvoice.biz_no) ? {
      tax_invoice_requested: true,
      tax_invoice_data: {
        biz_no: String(taxInvoice.biz_no || '').slice(0, 20),
        biz_name: String(taxInvoice.biz_name || '').slice(0, 200),
        ceo_name: String(taxInvoice.ceo_name || '').slice(0, 80),
        address: String(taxInvoice.address || '').slice(0, 500),
        email: String(taxInvoice.email || '').slice(0, 200),
      },
      tax_invoice_status: 'requested',
    } : {};

    await pay.update({
      status: 'paid',
      paid_at: now,
      marked_by: markedByUserId,
      marked_at: now,
      payer_name: payerName ? String(payerName).slice(0, 80) : pay.payer_name,
      payer_memo: payerMemo ? String(payerMemo).slice(0, 255) : pay.payer_memo,
      period_start: periodStart,
      period_end: periodEnd,
      ...taxFields,
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

    // 플랫폼 관리자 알림 — payment 입금 확인 + subscription 활성화 (둘 다 발송)
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
      const planLabel = PLANS.PLANS?.[sub.plan_code]?.name_ko || sub.plan_code;
      const cycleLabel = sub.cycle === 'monthly' ? '월간' : sub.cycle === 'yearly' ? '연간' : sub.cycle;
      const amountStr = pay.currency === 'KRW' ? `${Number(pay.amount).toLocaleString()}원` : `${pay.currency} ${Number(pay.amount).toLocaleString()}`;
      notifyPlatformAdmins({
        eventKind: 'payment',
        title: `결제 입금 확인 — ${planLabel} ${cycleLabel} (${amountStr})`,
        body: `결제 #${pay.id} mark-paid. 워크스페이스 ID ${sub.business_id}, ${pay.payer_name ? `입금자명 ${pay.payer_name}, ` : ''}${pay.payer_memo ? `메모: ${pay.payer_memo}` : ''}`,
        link: `${APP_URL}/admin/payments?id=${pay.id}`,
        ctaLabel: '결제 보기',
        relatedEntityId: pay.id,
      }).catch(() => null);
      if (wasFirst || fromPlan !== sub.plan_code) {
        notifyPlatformAdmins({
          eventKind: 'subscription',
          title: `구독 변경 — ${fromPlan} → ${sub.plan_code}`,
          body: `워크스페이스 ID ${sub.business_id} 가 ${planLabel} ${cycleLabel} 으로 ${wasFirst ? '신규 활성화' : '변경'} 됐습니다.`,
          link: `${APP_URL}/admin/subscriptions`,
          ctaLabel: '구독 보기',
          relatedEntityId: sub.id,
        }).catch(() => null);
      }
    });
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

    if (fromPlan !== 'free') {
      setImmediate(() => {
        const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
        notifyPlatformAdmins({
          eventKind: 'subscription',
          title: `구독 강등 — ${fromPlan} → free`,
          body: `워크스페이스 ID ${businessId} 가 free 로 강등됐습니다. 사유: ${reason}.`,
          link: `${APP_URL}/admin/subscriptions`,
          ctaLabel: '구독 보기',
          relatedEntityId: businessId,
        }).catch(() => null);
      });
    }
    return { businessId, fromPlan, toPlan: 'free' };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// ─── 갱신 pending Payment 보장 (멱등) ───
// 구독이 갱신일 도래/연체(past_due·grace)로 들어가면 "결제할 청구"가 있어야
// 배너 → '결제가 필요한 청구' 카드 → 결제 모달 → mark-paid(연장) 흐름이 동작한다.
// cron 은 상태만 바꾸고 결제 건을 안 만들던 회귀를 막는다. 같은 구독에 pending 이 이미 있으면 재사용.
async function ensureRenewalPayment(sub) {
  if (!sub || sub.plan_code === 'free') return { payment: null, created: false };

  const existing = await Payment.findOne({
    where: { subscription_id: sub.id, status: 'pending' },
    order: [['created_at', 'DESC']],
  });
  if (existing) return { payment: existing, created: false };

  // 금액은 구독에 박제된 price 우선, 없으면 플랜표에서 산출
  const amount = (sub.price != null && Number(sub.price) > 0)
    ? sub.price
    : getPlanPrice(sub.plan_code, sub.cycle, sub.currency || 'KRW');
  if (amount == null || Number(amount) <= 0) return { payment: null, created: false };

  const pay = await Payment.create({
    business_id: sub.business_id,
    subscription_id: sub.id,
    method: 'bank_transfer',
    status: 'pending',
    amount,
    currency: sub.currency || 'KRW',
    cycle: sub.cycle,
    created_by: null, // 시스템(cron) 생성
    tax_invoice_status: 'none',
  });

  // 입금 안내 이메일 — owner 들에게 (검증된 수신자만). 실패해도 cron 진행.
  setImmediate(() => { notifyRenewalDue(sub, pay).catch(() => null); });
  return { payment: pay, created: true };
}

// 갱신 청구 입금 안내 메일 (createPendingSubscription 의 메일 로직 재사용)
async function notifyRenewalDue(sub, pay) {
  const plan = PLANS.PLANS?.[sub.plan_code] || PLANS[sub.plan_code];
  if (!plan) return;
  const biz = await Business.findByPk(sub.business_id, { attributes: ['name', 'brand_name'] });
  const owners = await BusinessMember.findAll({
    where: { business_id: sub.business_id, role: 'owner', removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['email', 'name', 'email_verified_at'] }],
  });
  const wsName = biz?.brand_name || biz?.name || '';
  for (const m of owners) {
    // 자동(cron) 발송이므로 인증된 이메일에만 — 미인증/test 주소 반송 방지 ([[feedback_no_automail_unverified]])
    if (m.user?.email && m.user?.email_verified_at) {
      await sendBillingInstructionEmail({
        to: m.user.email,
        kind: 'plan',
        workspaceName: wsName,
        itemName: plan.name_ko || plan.name,
        cycle: sub.cycle,
        amount: pay.amount,
        currency: pay.currency,
        paymentId: pay.id,
        businessId: sub.business_id,
      }).catch(() => null);
    }
  }
}

// ─── 4. cron — 4단계 (active → past_due → grace → demoted) ───
async function runDailyBillingCron() {
  const now = new Date();
  const stats = { active_to_past_due: 0, past_due_to_grace: 0, grace_to_demoted: 0, renewal_payments_created: 0 };

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

  // 4) 갱신 청구 백필 — 아직 강등 안 된 past_due/grace 구독 중 pending 결제가 없는 건에 갱신 청구 생성.
  //    이번 run 에서 막 전이된 건 + 배포 이전부터 grace 였던 레거시 건 모두 멱등 커버.
  const overdueSubs = await Subscription.findAll({
    where: { status: { [Op.in]: ['past_due', 'grace'] } },
  });
  for (const s of overdueSubs) {
    const { created } = await ensureRenewalPayment(s);
    if (created) stats.renewal_payments_created += 1;
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
  ensureRenewalPayment,
  buildReceiptPdf,
  getCurrentSubscription,
  getPlanPrice,
};
