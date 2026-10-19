// 결제 환불 요청 — 관리자 쪽 공용 조각 (2026-10-19). 요청 받는 문은 routes/plan_refund, 처리는 services/refund.
//   · trialRequestIds — 요청 행이 «체험 중 결제» 인지(처리와 같은 술어 billing.trialRefundability, stage process).
//   · notifyRefundOwner — 처리·반려 결과를 그 워크스페이스 대표에게 앱 알림으로(메일 발송은 새로 만들지 않는다).
const { Business } = require('../models');
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

async function notifyRefundOwner(pay, { title, body }) {
  try {
    const biz = await Business.findByPk(pay.business_id, { attributes: ['id', 'owner_id'] });
    if (!biz || !biz.owner_id) return;
    await require('../routes/notifications').notify({
      userId: biz.owner_id, businessId: pay.business_id, eventKind: 'payment',
      title, body, link: '/business/settings/plan', skipChannels: ['email'],
    });
  } catch (e) { console.warn('[refund owner notify]', e.message); }
}

module.exports = { moneyStr, trialRequestIds, notifyRefundOwner };
