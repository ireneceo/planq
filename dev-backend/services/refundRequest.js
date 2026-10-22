// 결제 환불 요청 — 관리자 쪽 공용 조각 (2026-10-19). 요청 받는 문은 routes/plan_refund, 처리는 services/refund.
//   · trialRequestIds — 요청 행이 «체험 중 결제» 인지(처리와 같은 술어 billing.trialRefundability, stage process).
//   · refundEffects — 결제 완료 행마다 «환불하면 구독도 해지되나 / 애드온 한도 몇이 돌아가나»(처리와 같은 술어).
//   · notifyRefundOwner — 처리·반려 결과를 그 워크스페이스 대표에게. 앱 알림만이 기본, 무료 전환 건은 메일도(새 템플릿 없음).
const { Business, Subscription, Payment } = require('../models');
const billing = require('./billing');

const moneyStr = (p) => (p.currency === 'KRW' ? `${Number(p.amount).toLocaleString()}원` : `${p.currency} ${Number(p.amount).toLocaleString()}`);

async function trialRequestIds(rows) {
  const out = new Set();
  for (const p of rows) {
    if (p.status !== 'paid' || !p.refund_requested_at) continue;
    const ctx = await billing.loadTrialRefundContext(p.business_id, { paymentId: p.id });
    if (ctx.payment && billing.trialRefundability({ ...ctx, stage: 'process' }).eligible) out.add(p.id);
  }
  return out;
}

async function refundEffects(rows) {
  const out = new Map();
  const paid = rows.filter((p) => p.status === 'paid');
  if (!paid.length) return out;
  const { getAddon } = require('../config/plans');
  const planRows = paid.filter((p) => p.kind !== 'addon' && p.subscription_id);
  const subIds = [...new Set(planRows.map((p) => p.subscription_id))];
  const bizIds = [...new Set(planRows.map((p) => p.business_id))];
  const [subs, bizs, laterRows] = await Promise.all([
    subIds.length ? Subscription.findAll({ where: { id: subIds }, attributes: ['id', 'status'] }) : [],
    bizIds.length ? Business.findAll({ where: { id: bizIds }, attributes: ['id', 'plan'] }) : [],
    subIds.length ? Payment.findAll({ where: { subscription_id: subIds, status: 'paid' }, attributes: ['id', 'subscription_id', 'paid_at'] }) : [],
  ]);
  const subBy = new Map(subs.map((x) => [x.id, x]));
  const bizBy = new Map(bizs.map((x) => [x.id, x]));
  const isLater = (a, b) => {   // a 가 b 보다 뒤인가 — billing.countLaterPaid 와 같은 순서
    const ta = a.paid_at ? new Date(a.paid_at).getTime() : null;
    const tb = b.paid_at ? new Date(b.paid_at).getTime() : null;
    if (tb == null) return a.id > b.id;
    if (ta == null) return false;
    return ta > tb || (ta === tb && a.id > b.id);
  };
  for (const p of paid) {
    if (p.kind === 'addon') {
      const a = p.addon_code ? getAddon(p.addon_code) : null;
      out.set(p.id, { cancels: false, addonUnits: a ? a.unit * Math.max(1, Number(p.addon_quantity) || 1) : null });
      continue;
    }
    const laterPaidCount = laterRows.filter((x) => x.subscription_id === p.subscription_id && x.id !== p.id && isLater(x, p)).length;
    const cancels = billing.refundCancelsSubscription({
      payment: p, sub: subBy.get(p.subscription_id) || null, biz: bizBy.get(p.business_id) || null, laterPaidCount,
    });
    out.set(p.id, { cancels, addonUnits: null });
  }
  return out;
}

async function notifyRefundOwner(pay, { title, body, withEmail = false }) {
  try {
    const biz = await Business.findByPk(pay.business_id, { attributes: ['id', 'owner_id'] });
    if (!biz || !biz.owner_id) return;
    await require('../routes/notifications').notify({
      userId: biz.owner_id, businessId: pay.business_id, eventKind: 'payment',
      title, body, link: '/business/settings/plan', ...(withEmail ? {} : { skipChannels: ['email'] }),
    });
  } catch (e) { console.warn('[refund owner notify]', e.message); }
}

// 관리자 manual 환불 뒤 대표 알림 — docs/REFUND_CANCEL_DESIGN.md §5-6(체험 환불은 서비스가 전용 메일·알림을 보낸다).
//   무료로 바뀌었으면 돈과 기능이 함께 바뀐 건이라 메일까지 · 아니면 고객이 요청한 건만 앱 알림.
function notifyAfterManualRefund(r) {
  if (!r || r.alreadyRefunded) return;
  const pay = r.payment;
  if (r.restoredTo !== 'free' && !pay.refund_requested_at) return;
  setImmediate(() => notifyRefundOwner(pay, r.restoredTo === 'free' ? {
    title: '환불이 처리됐습니다',
    body: `${moneyStr(pay)} 결제가 환불됐고 워크스페이스가 무료 플랜으로 바뀌었습니다. 유료 기능은 다시 결제하면 이어서 쓸 수 있습니다(초과 데이터는 읽기 전용).`,
    withEmail: true,
  } : {
    title: '환불이 처리됐습니다',
    body: `${moneyStr(pay)} 결제의 환불 요청이 처리됐습니다. 돌려받는 데 카드사·은행 사정으로 며칠 걸릴 수 있습니다.`,
  }));
}

module.exports = { moneyStr, trialRequestIds, refundEffects, notifyRefundOwner, notifyAfterManualRefund };
