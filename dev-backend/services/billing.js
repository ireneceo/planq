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

// ─── 결제 면제 (운영 #275) ───
// 판정은 plan 엔진 것을 그대로 재사용한다 — 여기서 컬럼을 다시 읽어 판정하면 술어가 갈라진다
// (memory feedback_predicate_must_match_both_sides). plan.js 는 billing.js 를 require 하지 않으므로
// lazy require 로 순환참조 없음. 설계: docs/BILLING_EXEMPTION_DESIGN.md
async function isBillingExempt(businessId) {
  const { exempt } = await require('./plan').getBusinessPlan(businessId);
  return !!exempt;
}

function billingExemptError() {
  const e = new Error('billing_exempt');
  e.code = 'billing_exempt';
  return e;
}

// ─── 면제 워크스페이스 구독 정상화 — 단일 헬퍼 ★ ───
// cron(①②③)과 admin 면제 토글이 **모두 이 함수 하나만** 호출한다.
// 복원 로직을 두 곳에 적으면 반드시 갈라진다(Fable 설계 게이트 C4).
//
// 단일-active 불변식 보장: 대상 1건을 markPaymentPaid 와 **동일한 FIELD 정렬**로 고르고,
// 나머지 active/past_due/grace 는 markPaymentPaid:204-214 와 **동일한 where 절**로 replaced 마크.
//
// ★ 트랜잭션 소유권 (Fable 재심 M-A): cron 은 t 없이 부른다. 자체 트랜잭션을 열지 않으면
//   "전부 replaced" 와 "대상 active" 사이 crash 시 active 0건 창이 열린다(단일-active 의 쌍대 위험).
async function restoreExemptSubscription(businessId, { transaction } = {}) {
  const owned = !transaction;
  const t = transaction || await sequelize.transaction();
  try {
    const now = new Date();
    const sub = await Subscription.findOne({
      where: {
        business_id: businessId,
        status: { [Op.in]: ['pending', 'active', 'past_due', 'grace'] },
      },
      order: [
        [sequelize.literal(`FIELD(status, 'active', 'grace', 'past_due', 'pending')`), 'ASC'],
        ['created_at', 'DESC'],
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let restored = false;
    if (sub) {
      // 대상 외 살아있는 구독 전부 정리 — 중복 active 원천 차단
      await Subscription.update(
        { status: 'replaced', canceled_at: now },
        {
          where: {
            business_id: businessId,
            id: { [Op.ne]: sub.id },
            status: { [Op.in]: ['active', 'past_due', 'grace', 'pending'] },
          },
          transaction: t,
        }
      );

      // ★ update 전에 캡처한다 — Sequelize 의 update 는 인스턴스를 먼저 변이시키므로
      //   update 뒤에 sub.status 를 읽으면 항상 'active' 라 술어가 죽는다
      //   (memory feedback_sequelize_update_mutation). 죽으면 exempt_restored 통계와
      //   백필 로그가 거짓 보고한다.
      const wasActive = sub.status === 'active';

      // period_end 가 이미 미래면 연장하지 않는다 — admin 토글 반복 ON 시 매번 +1사이클 되는 것을
      // 막는 완전 멱등 조건(Fable 재심 권고 5). 과거면 max(now, end) 기준 1사이클만 민다(M3).
      const curEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
      const needsExtend = !curEnd || curEnd <= now;
      const periodEnd = needsExtend ? addCycle(now, sub.cycle) : curEnd;

      await sub.update({
        status: 'active',
        started_at: sub.started_at || now,
        current_period_start: sub.current_period_start || now,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        past_due_at: null, grace_started_at: null, grace_ends_at: null, demoted_at: null,
      }, { transaction: t });
      restored = needsExtend || !wasActive;
    }

    // ★ 구독 row 가 없거나 전부 canceled 인 워크스페이스(biz 4·5 류)에서도 Business 상태는 반드시
    //   정상화한다. no-op 으로 여기까지 건너뛰면 trial cron 이 매일 재스캔하고 admin 목록이
    //   자기모순으로 남는다 (Fable 재심 M-C).
    await Business.update(
      { subscription_status: 'active', grace_ends_at: null, plan_expires_at: null },
      { where: { id: businessId }, transaction: t }
    );

    if (owned) await t.commit();
    try { require('./plan').invalidateBusinessCache(businessId); } catch { /* noop */ }
    return { restored, subscriptionId: sub ? sub.id : null };
  } catch (err) {
    if (owned) await t.rollback();
    throw err;
  }
}

// ─── 1. 플랜 변경 (사용자 요청) — 신규 Subscription + pending Payment 생성 ───
async function createPendingSubscription({ businessId, planCode, cycle, userId, currency = 'KRW', taxInvoice = null }) {
  // ★ 게이트는 라우트가 아니라 여기(서비스)에 있다 — 청구를 만드는 진입점은 체크아웃 라우트와
  //   services/trial.js 의 cron **둘 다**다. 라우트에만 걸면 cron 이 그대로 지나가 면제
  //   워크스페이스에 청구서와 입금 안내 메일이 나간다 (Fable 설계 게이트 C2).
  if (await isBillingExempt(businessId)) throw billingExemptError();

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
    // 기존 '미결제 pending' 체크아웃만 replaced (재오픈/재클릭 dedupe).
    //   ★결제완료 active/past_due/grace 는 건드리지 않는다 — 새 체크아웃을 열었다고 이미 낸 구독을
    //   미결제로 갈아치우면 결제가 고아가 된다(운영 워프로랩 실사고). 새 결제가 mark-paid 될 때
    //   markPaymentPaid 가 이전 active 를 supersede 한다.
    await Subscription.update(
      { status: 'replaced', canceled_at: new Date() },
      {
        where: {
          business_id: businessId,
          status: 'pending',
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
    // ★이미 replaced/demoted/canceled 된 죽은 구독에 매달린 고아 pending 결제를 mark-paid 하면
    //   죽은 구독이 부활하며 현 플랜을 옛 플랜으로 뒤집는다(N+94급). 살아있는 구독의 결제만 확정 허용.
    if (!['pending', 'active', 'past_due', 'grace'].includes(sub.status)) {
      await t.rollback();
      throw new Error('subscription_superseded');
    }

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

    // ★ 매출 계상 여부를 결제 확정 시점에 박제한다 (운영 #275).
    //   조인 판정으로 두면 면제를 끄는 순간 과거 내부결제가 매출로 되살아난다(시점 오염).
    const isRevenue = !(await isBillingExempt(pay.business_id));

    await pay.update({
      status: 'paid',
      paid_at: now,
      marked_by: markedByUserId,
      marked_at: now,
      payer_name: payerName ? String(payerName).slice(0, 80) : pay.payer_name,
      payer_memo: payerMemo ? String(payerMemo).slice(0, 255) : pay.payer_memo,
      period_start: periodStart,
      period_end: periodEnd,
      is_revenue: isRevenue,
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

    // ★새 구독이 활성화되면 그 워크스페이스의 '다른' 결제완료 구독(active/past_due/grace)을 supersede.
    //   createPendingSubscription 이 더 이상 active 를 안 밀어내므로, 실제 승계는 여기(결제확정 시점)에서 한 번만.
    //   (같은 sub 재-mark 는 위 alreadyPaid 가드로 차단되어 자기 자신을 replaced 로 만들 일은 없다)
    await Subscription.update(
      { status: 'replaced', canceled_at: now },
      {
        where: {
          business_id: sub.business_id,
          id: { [Op.ne]: sub.id },
          status: { [Op.in]: ['active', 'past_due', 'grace'] },
        },
        transaction: t,
      }
    );

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
        // 비매출(내부·테스터)이면 제목에 표기 — admin 이 입금 확인 시점에 바로 인지하게.
        title: `결제 입금 확인 — ${planLabel} ${cycleLabel} (${amountStr})${isRevenue ? '' : ' · 비매출(내부/테스터)'}`,
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

  // 면제 워크스페이스에는 갱신 청구를 만들지 않는다 (운영 #275).
  if (await isBillingExempt(sub.business_id)) {
    return { payment: null, created: false, skipped: 'billing_exempt' };
  }

  const existing = await Payment.findOne({
    where: { subscription_id: sub.id, status: 'pending' },
    order: [['created_at', 'DESC']],
  });
  if (existing) return { payment: existing, created: false };

  // 가드 1 — 현재 워크스페이스 플랜과 다른 구독이면 갱신 청구를 만들지 않는다.
  // 옛/중복 구독(예: 업그레이드 후 남은 stale starter)에 청구를 만들면, 결제 시
  // markPaymentPaid 가 Business.plan 을 그 옛 플랜으로 덮어써 의도치 않은 강등이 된다. (N+94 운영 사고)
  const biz = await Business.findByPk(sub.business_id, { attributes: ['id', 'plan'] });
  if (biz && biz.plan && biz.plan !== 'free' && biz.plan !== sub.plan_code) {
    return { payment: null, created: false, skipped: 'plan_mismatch' };
  }

  // 가드 2 — 같은 워크스페이스에 더 뒤까지 유효한 다른 active 구독이 있으면 이 구독은 stale → 스킵.
  const superseding = await Subscription.findOne({
    where: {
      business_id: sub.business_id,
      status: 'active',
      id: { [Op.ne]: sub.id },
      current_period_end: { [Op.gt]: sub.current_period_end || new Date(0) },
    },
  });
  if (superseding) return { payment: null, created: false, skipped: 'superseded' };

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

// ─── 면제 종료 사전 안내 (운영 #275) ───
// 면제에 종료일을 걸어두면 그날 이후 **아무 말 없이 청구가 재개**된다.
// 결제 요구가 갑자기 뜨는 것이 이번 사이클의 원래 신고였다 — 같은 일을 우리가 만들면 안 된다.
// D-7 에 한 번, 만료 당일에 한 번 알린다. 중복 발송은 notifications 조회로 막는다(멱등).
const EXEMPT_NOTICE_DAYS_BEFORE = 7;

async function notifyExemptExpiring() {
  const { Op } = require('sequelize');
  const { Notification, BusinessMember } = require('../models');
  const now = new Date();
  const soon = new Date(now.getTime() + EXEMPT_NOTICE_DAYS_BEFORE * 86400 * 1000);
  const stats = { warned: 0, expired_notified: 0 };

  const rows = await Business.findAll({
    where: {
      deleted_at: null,
      billing_exempt: true,
      billing_exempt_until: { [Op.ne]: null, [Op.lte]: soon },
    },
    attributes: ['id', 'name', 'brand_name', 'billing_exempt_until'],
  });

  for (const biz of rows) {
    const until = new Date(biz.billing_exempt_until);
    const past = until <= now;
    // ★ 멱등 키는 **실재하는 컬럼**으로 잡는다. Notification 에 `tag` 컬럼은 없다
    //   (entity_type/entity_id 가 실물). 없는 컬럼으로 조회하면 매 실행 throw 하고
    //   catch 에 삼켜져 "안내가 영영 안 가는" 상태가 된다 — 이 사이클에서 월간 보고서 cron 이
    //   정확히 그렇게 죽어 있었다. 같은 실수를 반복하지 않는다.
    // ★ 멱등 키에 **종료일**을 넣는다 (Fable 중요-2).
    //   business_id 만으로 잡으면 알림 행이 남아 있는 한 **일생 1회**다 —
    //   면제를 다시 걸거나 종료일을 연장하면 두 번째 사이클의 안내가 영영 안 나간다.
    //   같은 조용한 결손 계열이므로 종료일을 키에 포함해 사이클마다 새로 알린다.
    const untilKey = until.toISOString().slice(0, 10).replace(/-/g, '');   // YYYYMMDD
    const entityType = past ? 'exempt_expired' : 'exempt_expiring';
    try {
      const sent = await Notification.findOne({
        where: { business_id: biz.id, entity_type: entityType, entity_id: Number(untilKey) },
        attributes: ['id'],
      });
      if (sent) continue;

      const owners = await BusinessMember.findAll({
        where: { business_id: biz.id, role: 'owner', removed_at: null },
        attributes: ['user_id'],
      });
      const userIds = owners.map((o) => o.user_id).filter(Boolean);
      if (!userIds.length) continue;

      const dateTxt = until.toISOString().slice(0, 10);
      const { notifyMany } = require('../routes/notifications');
      await notifyMany({
        userIds,
        businessId: biz.id,
        eventKind: 'subscription',
        title: past ? '무료 이용 기간이 끝났습니다' : `무료 이용이 ${dateTxt} 에 종료됩니다`,
        body: past
          ? '결제 면제 기간이 종료되어 다음 결제 주기부터 정상 요금제로 청구됩니다.'
          : `종료일 이후에는 정상 요금제로 청구됩니다. 결제 정보를 미리 확인해 주세요.`,
        link: '/business/settings/plan',
        ctaLabel: '구독 상태 보기',
        workspaceName: biz.brand_name || biz.name || null,
        entityType,
        entityId: Number(untilKey),
      });
      if (past) stats.expired_notified += 1; else stats.warned += 1;
    } catch (e) {
      console.warn('[exempt-notice]', biz.id, e.message);
    }
  }
  return stats;
}

// ─── 4. cron — 4단계 (active → past_due → grace → demoted) ───
async function runDailyBillingCron() {
  const now = new Date();
  const stats = {
    active_to_past_due: 0, past_due_to_grace: 0, grace_to_demoted: 0, renewal_payments_created: 0,
    // 면제 관측성 (운영 #275) — 로그로 "면제가 실제로 돌았는가" 를 확인할 수 있어야 한다.
    exempt_skipped: 0, exempt_restored: 0,
  };

  // 1) active 중 current_period_end 지나간 것 → past_due
  const expiringActive = await Subscription.findAll({
    where: {
      status: 'active',
      current_period_end: { [Op.lt]: now },
    },
  });
  for (const s of expiringActive) {
    // 면제 워크스페이스는 만료 전이 대신 무료 연장 — 안 하면 매일 만료 판정에 걸린다.
    if (await isBillingExempt(s.business_id)) {
      const { restored } = await restoreExemptSubscription(s.business_id);
      stats.exempt_skipped += 1;
      if (restored) stats.exempt_restored += 1;
      continue;
    }
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
    // 면제면 grace 로 떨어뜨리지 않고 정상 복원 — 면제를 켠 순간 화면이 정상으로 돌아온다.
    if (await isBillingExempt(s.business_id)) {
      const { restored } = await restoreExemptSubscription(s.business_id);
      stats.exempt_skipped += 1;
      if (restored) stats.exempt_restored += 1;
      continue;
    }
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
    // 면제 워크스페이스는 절대 강등하지 않는다 (운영 #275 — biz 2 가 이미 강등당한 사례).
    if (await isBillingExempt(s.business_id)) {
      const { restored } = await restoreExemptSubscription(s.business_id);
      stats.exempt_skipped += 1;
      if (restored) stats.exempt_restored += 1;
      continue;
    }
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

  // 5) 면제 종료 사전·당일 안내 — 종료일 이후 아무 말 없이 청구가 재개되는 것을 막는다.
  //    ★ 이 호출이 없으면 함수가 아무리 건강해도 **영영 돌지 않는다**(Fable 치명: 배선 누락).
  try {
    const notice = await notifyExemptExpiring();
    stats.exempt_expiring_warned = notice.warned;
    stats.exempt_expired_notified = notice.expired_notified;
  } catch (e) { console.warn('[billing cron exempt-notice]', e.message); }

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
  // ★결제완료(active/grace/past_due)를 미결제 pending 보다 우선 반환.
  //   안 그러면 결제한 상태에서 새 체크아웃(pending)을 열면 화면이 '미결제/프리'로 보인다(운영 워프로랩 실사고).
  return await Subscription.findOne({
    where: {
      business_id: businessId,
      status: { [Op.in]: ['pending', 'active', 'past_due', 'grace'] },
    },
    order: [
      [sequelize.literal(`FIELD(status, 'active', 'grace', 'past_due', 'pending')`), 'ASC'],
      ['created_at', 'DESC'],
    ],
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
  // 결제 면제 (운영 #275) — 판정/복원 단일 착지점
  isBillingExempt,
  restoreExemptSubscription,
  notifyExemptExpiring,
};
