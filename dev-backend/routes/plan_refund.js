// 체험 중 결제 «해지하고 환불 요청» — 대표(owner)의 요청·취소 문. 설계 docs/TRIAL_REFUND_DESIGN.md §2·§5
//
//   POST   /api/plan/:businessId/payments/:paymentId/refund-request  body { note?, refund_account?: {bank, number, holder} }
//   DELETE /api/plan/:businessId/payments/:paymentId/refund-request
//
//   ★ 요청은 상태를 바꾸지 않는다 — 결제는 paid, 서비스는 그대로. 되돌리는 것은 관리자 [환불](services/refund) 한 번뿐.
//   ★ 자격은 billing.trialRefundability 한 함수(요청·/status·관리자 처리가 같이 쓴다).
//   ★ 계좌는 암호문(_enc)으로만 둔다 — 전역 toJSON 이 응답에서 내린다. 읽는 문은 관리자 refund-account 하나.
//   routes/plan.js 가 큰 파일 상한(godfile)에 걸려 따로 둔다. 같은 접두어(/api/plan)에 plan.js 뒤로 마운트 —
//   꼬리 경로(/payments/:id/refund-request)가 plan.js 와 겹치지 않는다.
const express = require('express');
const router = express.Router();
const { Payment } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const billing = require('../services/billing');
const { writeAudit } = require('../services/auditService');

const ownerOnly = (req, res, next) => {
  if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') return errorResponse(res, 'owner_only', 403);
  return next();
};

const BANK_RE = /^.{1,80}$/;
const NUMBER_RE = /^[0-9-]{6,30}$/;
function parseAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bank = String(raw.bank || '').trim();
  const number = String(raw.number || '').replace(/\s/g, '');
  const holder = String(raw.holder || '').trim();
  if (!BANK_RE.test(bank) || !BANK_RE.test(holder) || !NUMBER_RE.test(number)) return null;
  return { bank, number, holder };
}
const isCardPayment = (p) => p.method === 'stripe' || p.method === 'card';

router.post('/:businessId/payments/:paymentId/refund-request', authenticateToken, checkBusinessAccess, ownerOnly, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const ctx = await billing.loadTrialRefundContext(businessId, { paymentId });
    if (!ctx.payment) return errorResponse(res, 'payment_not_found', 404);
    const j = billing.trialRefundability({ ...ctx, stage: 'request' });
    if (!j.eligible) return errorResponse(res, j.reason, 409);

    // 계좌이체는 돌려받을 계좌가 있어야 한다. 카드는 결제한 카드로 취소하므로 받지 않는다(보내도 버린다).
    let accountEnc = null;
    if (!isCardPayment(ctx.payment)) {
      const acc = parseAccount(req.body?.refund_account);
      if (!acc) return errorResponse(res, 'refund_account_required', 400);
      accountEnc = require('../services/encryption').encrypt(JSON.stringify(acc));
    }
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
    const now = new Date();
    // 동시 요청 — 조건부 UPDATE 로 못을 박는다(자격은 위에서 봤다). 한 건만 1 행을 바꾼다.
    const [affected] = await Payment.update({
      refund_requested_at: now, refund_requested_by: req.user.id, refund_request_note: note, refund_account_enc: accountEnc,
    }, { where: { id: paymentId, business_id: businessId, status: 'paid', refund_requested_at: null } });
    if (affected !== 1) return errorResponse(res, 'already_requested', 409);

    await writeAudit({
      userId: req.user.id, businessId, action: 'payment.refund_requested', targetType: 'payment', targetId: paymentId,
      ipAddress: req.ip || null,
      newValue: { amount: Number(ctx.payment.amount), currency: ctx.payment.currency, method: ctx.payment.method, has_account: !!accountEnc, note: !!note },
    });

    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      const p = ctx.payment;
      const amountStr = p.currency === 'KRW' ? `${Number(p.amount).toLocaleString()}원` : `${p.currency} ${Number(p.amount).toLocaleString()}`;
      notifyPlatformAdmins({
        eventKind: 'payment',
        title: `환불 요청 — 체험 중 결제 (${amountStr})`,
        body: `워크스페이스 ID ${businessId} 가 결제 #${paymentId} 의 환불을 요청했습니다(${isCardPayment(p) ? '카드' : '계좌이체'}). 확인 후 환불 처리하면 구독이 체험 상태로 돌아갑니다.`,
        link: `${APP_URL}/admin/payments?payment=${paymentId}`,
        ctaLabel: '환불 처리하기',
        relatedEntityId: paymentId,
      }).catch(() => null);
    });
    return successResponse(res, { requested: true, payment_id: paymentId, requested_at: now });
  } catch (err) { next(err); }
});

router.delete('/:businessId/payments/:paymentId/refund-request', authenticateToken, checkBusinessAccess, ownerOnly, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const p = await Payment.findOne({ where: { id: paymentId, business_id: businessId } });
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    if (p.status === 'refunded') return errorResponse(res, 'already_refunded', 409);
    if (!p.refund_requested_at) return errorResponse(res, 'not_requested', 409);
    const [affected] = await Payment.update(
      { refund_requested_at: null, refund_requested_by: null, refund_request_note: null, refund_account_enc: null },
      { where: { id: paymentId, business_id: businessId, status: 'paid' } },
    );
    if (affected !== 1) return errorResponse(res, 'already_refunded', 409);
    await writeAudit({
      userId: req.user.id, businessId, action: 'payment.refund_request_canceled', targetType: 'payment', targetId: paymentId,
      ipAddress: req.ip || null, newValue: { requested_at: p.refund_requested_at },
    });
    return successResponse(res, { canceled: true, payment_id: paymentId });
  } catch (err) { next(err); }
});

module.exports = router;
