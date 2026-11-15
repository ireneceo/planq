// 미결제 플랜 청구 금액 = 플랜 + 현재 애드온 (불변식 한 함수) — 2026-11-15 Fable 설계 R1~R4
//
// Irene: «멤버를 추가해도 결제금액이 같아» — 유예 중 갱신 청구(39,000)가 애드온을 추가하기 전에 만들어져
//   멱등 재사용되며 그대로 남았다. 애드온을 바꾸는 모든 문(신청·해지·환불 회수·관리자 적용)이 같은 트랜잭션에서
//   이 함수를 부른다. 금액 내역은 billing.buildRenewalLines 한 벌(연간 ×12·통화 포함).
//
// «얼었다(frozen)» = 고객이 이미 «입금했어요» 를 눌렀거나(notify_paid_at) Stripe 세션이 살아 있다(만료 못 시킴).
//   얼면 금액·내역을 절대 바꾸지 않는다(고객이 본 금액으로 보냈다).
// 잠금 순서는 markPaymentPaid 와 같게 pay → (sub) → biz.

const { Payment, Subscription, Business } = require('../models');
const { writeAudit } = require('./auditService');
const { roundMoney } = require('./money');

// 트랜잭션 전에 — 미결제 플랜 청구에 열린 Stripe 세션이 있으면 만료시키고 비운다.
//   만료 성공·이미 만료면 stripe_session_id = NULL. 완료됐거나 API 실패면 그대로(→ sync 가 frozen 으로 본다).
async function releaseStripeSession(businessId) {
  const billing = require('./billing');
  const payable = await billing.findPayablePending(businessId);
  const pay = payable && payable.payment;
  if (!pay || !pay.stripe_session_id) return { released: false };
  try {
    const { getStripeForMerchant } = require('./stripeService');
    const stripe = await getStripeForMerchant('platform');
    const s = await stripe.checkout.sessions.retrieve(pay.stripe_session_id);
    if (s && s.status === 'open') await stripe.checkout.sessions.expire(pay.stripe_session_id);
    else if (!s || s.status !== 'expired') return { released: false, status: s && s.status };
    await Payment.update({ stripe_session_id: null }, { where: { id: pay.id, status: 'pending', stripe_session_id: pay.stripe_session_id } });
    return { released: true };
  } catch (e) {
    console.warn('[pendingPlanSync] stripe expire failed', e.message);
    return { released: false, error: e.message };
  }
}

// 트랜잭션 안에서 — 금액을 맞출 미결제 플랜 청구를 찾아 먼저 잠근다(biz 보다 먼저).
async function lockPayablePending(businessId, t) {
  const billing = require('./billing');
  const payable = await billing.findPayablePending(businessId, { transaction: t });
  if (!payable) return null;
  return Payment.findByPk(payable.payment.id, { transaction: t, lock: t.LOCK.UPDATE });
}

function isFrozen(pay) {
  return !!(pay.notify_paid_at || pay.stripe_session_id);
}

// 반환: { payment, changed, frozen, old_amount, new_amount } | { payment: null }
//   payment 를 넘기면(lockPayablePending 로 잠근 것) 그것을, 아니면 직접 찾아 잠근다.
async function syncPendingPlanAmount(businessId, { transaction: t, payment = undefined, userId = null } = {}) {
  if (!t) throw new Error('sync_requires_transaction');
  const pay = payment === undefined ? await lockPayablePending(businessId, t) : payment;
  if (!pay || pay.status !== 'pending' || pay.kind !== 'plan') return { payment: null, changed: false, frozen: false };

  const old = Number(pay.amount);
  if (isFrozen(pay)) return { payment: pay, changed: false, frozen: true, old_amount: old, new_amount: old };

  const sub = await Subscription.findByPk(pay.subscription_id, { transaction: t });
  const biz = await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
  if (!sub || !biz) return { payment: pay, changed: false, frozen: false, old_amount: old, new_amount: old };

  const billing = require('./billing');
  const lines = billing.buildRenewalLines(sub, biz);
  const currency = sub.currency || pay.currency || 'KRW';
  const amount = roundMoney(lines.reduce((a, l) => a + Number(l.amount || 0), 0), currency);
  if (!(amount > 0)) return { payment: pay, changed: false, frozen: false, old_amount: old, new_amount: old };
  const sameLines = JSON.stringify(pay.line_items || null) === JSON.stringify(lines);
  if (amount === old && sameLines) return { payment: pay, changed: false, frozen: false, old_amount: old, new_amount: old };

  // 조건부 UPDATE — 그 사이 «입금했어요»·Stripe 세션이 붙었으면 0행(= frozen)
  const [n] = await Payment.update({ amount, line_items: lines }, {
    where: { id: pay.id, status: 'pending', notify_paid_at: null, stripe_session_id: null },
    transaction: t,
  });
  if (!n) return { payment: pay, changed: false, frozen: true, old_amount: old, new_amount: old };

  await writeAudit({
    user_id: userId || null,
    business_id: businessId,
    action: 'payment.amount_synced',
    target_type: 'payment',
    target_id: pay.id,
    old_value: { amount: old, line_items: pay.line_items || null },
    new_value: { amount, line_items: lines },
  }, { transaction: t });

  pay.amount = amount;
  pay.line_items = lines;
  return { payment: pay, subscription: sub, changed: amount !== old, frozen: false, old_amount: old, new_amount: amount };
}

// 커밋 뒤 — 금액이 바뀌었으면 새 금액으로 입금 안내를 한 번 더(인증된 owner 메일만, 갱신 안내와 같은 조건).
function notifyIfChanged(result) {
  if (!result || !result.changed || !result.payment || !result.subscription) return;
  setImmediate(() => {
    require('./billing').notifyRenewalDue(result.subscription, result.payment).catch(() => null);
  });
}

module.exports = { releaseStripeSession, lockPayablePending, syncPendingPlanAmount, notifyIfChanged, isFrozen };
