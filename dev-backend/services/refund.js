// 결제 환불 — 한 함수, 두 모드. 설계 docs/TRIAL_REFUND_DESIGN.md §3·§4
//
//   mode 'trial'  : 체험 중 결제를 «해지하고 환불 요청» 한 건. 결제 → refunded, 구독 → canceled('trial_refund'),
//                   워크스페이스 → 체험(trialing, 종료일 불변) 또는 이미 체험이 끝났으면 past_due + 유예 7일.
//   mode 'manual' : 관리자 [환불]·고객 요청 환불. docs/REFUND_CANCEL_DESIGN.md §5 (Fable DESIGN_OK 2026-10-22):
//                   · 플랜 결제가 그 구독의 마지막 유료 결제(billing.refundCancelsSubscription)면 구독 canceled('refund') + 즉시 무료
//                   · 애드온 결제면 그만큼 한도 회수(addonBilling.revokeUnitsInTx)
//                   · 그 밖(지난 기간 결제 등)·keepSubscription(보상성 환불)이면 결제만 refunded
//                   판정은 트랜잭션 안에서 다시 본다(밖에서 본 값으로 쓰지 않는다).
//
//   ★ 돈 먼저, 장부 나중 — 카드 환불(Stripe)은 트랜잭션 **밖에서** 먼저 하고(idempotencyKey), 실패하면 DB 를 건드리지 않는다.
//     재시도는 같은 키라 Stripe 가 같은 환불을 돌려준다(두 번 나가지 않는다).
//   ★ Stripe 호출은 viaStripe:true 일 때만 — 기본으로 켜면 이미 Stripe 대시보드에서 손으로 돌려준 건을 두 번 환불한다.
//   ★ 감사는 트랜잭션 안 writeAudit(돈이다 — markPaymentPaid 와 같은 철학).
const { sequelize } = require('../config/database');
const { Payment, Subscription, Business, BusinessPlanHistory, User } = require('../models');
const billing = require('./billing');
const PLANS = require('../config/plans');

const GRACE_DAYS = 7;

function err(code, statusCode = 409) { const e = new Error(code); e.code = code; e.statusCode = statusCode; return e; }
const isCard = (p) => (p.method === 'stripe' || p.method === 'card') && !!p.stripe_payment_intent;

// Stripe 거절은 우리 코드(409)로 바꿔 던진다 — Stripe 의 statusCode 를 그대로 흘리면 401(키 오류)이
//   화면의 «로그인 만료» 처리(토큰 갱신 → 같은 요청 재전송)로 빠지고, 404(다른 Stripe 계정의 결제)는
//   «없음» 으로 읽힌다(2026-10-30 Stripe 키 교체 뒤 환불 실패 신고). 어느 경우든 DB 는 건드리기 전이다.
function stripeRefundError(e) {
  if (e && e.code === 'STRIPE_NOT_CONFIGURED') return err('stripe_not_configured', 409);
  if (!e || typeof e.type !== 'string' || !e.type.startsWith('Stripe')) return e;
  console.warn('[refund stripe]', e.type, e.statusCode, e.code || '', e.message);
  if (e.type === 'StripeAuthenticationError') return err('stripe_auth_failed', 409);
  if (e.code === 'resource_missing') return err('stripe_payment_not_found', 409);
  if (e.code) return err(e.code, 409);   // more_permissions_required · charge_already_refunded 등 — 화면이 코드로 안내
  return err(e.type === 'StripePermissionError' ? 'more_permissions_required' : 'stripe_error', 409);
}

async function stripeRefund(payment) {
  try {
    const { getStripeForMerchant } = require('./stripeService');
    const stripe = await getStripeForMerchant('platform');
    const r = await stripe.refunds.create(
      { payment_intent: payment.stripe_payment_intent },
      { idempotencyKey: `planq-refund-${payment.id}` },
    );
    return r && r.id ? r.id : null;
  } catch (e) { throw stripeRefundError(e); }
}

/**
 * @returns {{ payment, alreadyRefunded?: boolean, restoredTo?: 'trialing'|'past_due'|'free'|null, stripeRefundId?: string|null, addonUnitsRemoved?: number|null }}
 */
async function refundPayment({ paymentId, mode = 'manual', reason, viaStripe = false, keepSubscription = false, adminUserId = null, actor = null, _stripeRefund = stripeRefund }) {
  if (mode !== 'trial' && mode !== 'manual') throw err('invalid_mode', 400);
  const pre = await Payment.findByPk(paymentId);
  if (!pre) throw err('payment_not_found', 404);
  if (pre.status === 'refunded') return { payment: pre, alreadyRefunded: true, restoredTo: null };
  if (pre.status !== 'paid') throw err('only_paid_can_refund', 400);

  // 트랜잭션 전에 자격을 먼저 본다 — 자격 없는 건으로 Stripe 에서 돈이 나가면 안 된다(안에서 한 번 더 본다).
  if (mode === 'trial') {
    const ctx = await billing.loadTrialRefundContext(pre.business_id, { paymentId: pre.id });
    const j = billing.trialRefundability({ ...ctx, stage: 'process' });
    if (!j.eligible) throw err(j.reason, 409);
  }

  let stripeRefundId = null;
  if (viaStripe && isCard(pre)) stripeRefundId = await _stripeRefund(pre);   // 실패하면 여기서 throw — DB 불변

  const t = await sequelize.transaction();
  try {
    const pay = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (pay.status === 'refunded') { await t.rollback(); return { payment: pay, alreadyRefunded: true, restoredTo: null, stripeRefundId }; }
    if (pay.status !== 'paid') throw err('only_paid_can_refund', 400);
    const now = new Date();
    const refundReason = reason ? String(reason).slice(0, 255) : (mode === 'trial' ? '체험 중 환불' : '관리자 환불');
    let restoredTo = null;
    let audit = {};
    let addonUnitsRemoved = null;

    if (mode === 'trial') {
      const sub = pay.subscription_id ? await Subscription.findByPk(pay.subscription_id, { transaction: t, lock: t.LOCK.UPDATE }) : null;
      const biz = await Business.findByPk(pay.business_id, { transaction: t, lock: t.LOCK.UPDATE });
      const used = await Payment.count({ where: { business_id: pay.business_id, status: 'refunded', refund_kind: 'trial' }, transaction: t });
      const j = billing.trialRefundability({ payment: pay, sub, biz, trialRefundsUsed: used, stage: 'process' });
      if (!j.eligible) throw err(j.reason, 409);

      await sub.update({ status: 'canceled', canceled_at: now, cancel_reason: 'trial_refund' }, { transaction: t });
      await billing.closeDeadPendingPayments(pay.business_id, t);

      const fromPlan = biz.plan;
      const toPlan = PLANS.resolveTrialPlan(biz.plan);
      const trialLeft = biz.trial_ends_at && new Date(biz.trial_ends_at) > now;
      if (trialLeft) {
        // 체험은 그대로 — 종료일을 늘리지 않는다(«체험기간은 그대로»). 비용 캡은 trialing 으로 자동 복귀.
        await biz.update({ plan: toPlan, subscription_status: 'trialing', plan_expires_at: null, grace_ends_at: null, scheduled_plan: null }, { transaction: t });
        restoredTo = 'trialing';
      } else {
        // 요청은 체험 중에 했는데 처리가 늦었다 — cron 이 만들었을 것과 같은 길(환불 시점부터 유예 7일).
        await biz.update({ plan: toPlan, subscription_status: 'past_due', plan_expires_at: null, grace_ends_at: new Date(now.getTime() + GRACE_DAYS * 86400e3), scheduled_plan: null }, { transaction: t });
        restoredTo = 'past_due';
      }
      await BusinessPlanHistory.create({
        business_id: pay.business_id, from_plan: fromPlan, to_plan: toPlan, reason: 'refund',
        changed_by: adminUserId, note: `Payment #${pay.id} 체험 중 환불`,
      }, { transaction: t });
      audit = {
        // Date 를 그대로 넘기면 감사 마스킹이 {} 로 바꾼다(Fable 비차단 1) — 문자열로 남긴다
        requested_at: pay.refund_requested_at ? new Date(pay.refund_requested_at).toISOString() : null, requested_by: pay.refund_requested_by,
        restored_to: restoredTo, tax_invoice_status: pay.tax_invoice_status || null,
      };
    }

    if (mode === 'manual') {
      const biz = await Business.findByPk(pay.business_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (pay.kind === 'addon') {
        // 돈을 돌려줬는데 한도가 열려 있으면 어긋난다 — 보상성 환불(keepSubscription)이면 그대로 둔다.
        if (!keepSubscription && biz && pay.addon_code) {
          const r = await require('./addonBilling').revokeUnitsInTx({ biz, addonCode: pay.addon_code, quantity: pay.addon_quantity, t });
          addonUnitsRemoved = r.removed;
          audit = { addon_code: pay.addon_code, addon_field: r.field, addon_units_removed: r.removed, addon_before: r.previous, addon_after: r.current };
        }
      } else {
        const sub = pay.subscription_id ? await Subscription.findByPk(pay.subscription_id, { transaction: t, lock: t.LOCK.UPDATE }) : null;
        const laterPaidCount = await billing.countLaterPaid(pay, t);
        const cancels = billing.refundCancelsSubscription({ payment: pay, sub, biz, laterPaidCount });
        if (cancels && !keepSubscription) {
          const c = await billing.cancelToFreeInTx({
            biz, sub, t, cancelReason: 'refund', historyReason: 'refund',
            changedBy: adminUserId, note: `Payment #${pay.id} 환불 해지`,
          });
          await billing.closeDeadPendingPayments(pay.business_id, t);
          restoredTo = 'free';
          audit = { canceled_subscription_id: sub.id, from_plan: c.fromPlan, to_plan: 'free' };
        }
        if (cancels) audit.keep_subscription = !!keepSubscription;
      }
      if (keepSubscription) audit.keep_subscription = true;
    }

    await pay.update({
      status: 'refunded', refunded_at: now, refund_reason: refundReason, refund_kind: mode,
      stripe_refund_id: stripeRefundId || pay.stripe_refund_id || null,
      refund_account_enc: null,   // 처리 끝 — 환불 계좌 파기(보관 최소화)
    }, { transaction: t });

    await require('./auditService').writeAudit({
      userId: (actor && actor.userId) || adminUserId || null,
      businessId: pay.business_id,
      action: 'payment.refunded', targetType: 'payment', targetId: pay.id,
      ipAddress: (actor && actor.ip) || null,
      newValue: {
        kind: mode, amount: Number(pay.amount), currency: pay.currency, method: pay.method,
        stripe_refund_id: stripeRefundId, via_stripe: !!stripeRefundId, reason: refundReason, ...audit,
      },
    }, { transaction: t });

    await t.commit();
    try { require('./plan').invalidateBusinessCache(pay.business_id); } catch { /* noop */ }

    if (mode === 'trial') {
      setImmediate(async () => {
        try {
          const biz = await Business.findByPk(pay.business_id);
          const owner = biz && biz.owner_id ? await User.findByPk(biz.owner_id, { attributes: ['id', 'email'] }) : null;
          const wsName = biz ? (biz.brand_name || biz.name) : '';
          if (owner && owner.email) {
            await require('./emailService').sendTrialRefundDoneEmail({
              to: owner.email, workspaceName: wsName, amount: pay.amount, currency: pay.currency, method: pay.method,
              paymentId: pay.id, restoredTo, trialEndsAt: biz.trial_ends_at, graceEndsAt: biz.grace_ends_at, businessId: pay.business_id,
            });
            await require('../routes/notifications').notify({
              userId: owner.id, businessId: pay.business_id, eventKind: 'payment',
              title: '환불이 완료됐습니다', body: restoredTo === 'trialing' ? '체험이 그대로 이어집니다.' : '체험 기간이 끝나 결제가 필요합니다.',
              link: '/business/settings/plan', skipChannels: ['email'],   // 전용 메일을 이미 보냈다(두 통 방지)
            });
          }
        } catch (e) { console.warn('[refund notify]', e.message); }
      });
    }
    return { payment: pay, alreadyRefunded: false, restoredTo, stripeRefundId, addonUnitsRemoved };
  } catch (e) {
    try { await t.rollback(); } catch { /* already finished */ }
    throw e;
  }
}

module.exports = { refundPayment, GRACE_DAYS };
