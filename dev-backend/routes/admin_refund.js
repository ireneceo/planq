// 플랫폼 관리자 — 결제 환불 요청 처리(반려) 라우트 (2026-10-19).
//   admin_billing.js 가 god-file 상한(500줄)에 걸려 따로 둔다. 마운트는 routes/admin.js — `/api/admin` prefix 와
//   `authenticateToken + requireRole('platform_admin')` 게이트를 그대로 물려받는다(admin_billing 과 같은 이유).
//   환불 처리 자체는 admin_billing POST /payments/:id/refund (services/refund.refundPayment 한 함수).
const express = require('express');
const router = express.Router();
const { Payment } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { moneyStr, notifyRefundOwner } = require('../services/refundRequest');

// POST /api/admin/payments/:id/refund-request/decline — 환불 요청 반려(약관 기준 밖 등). body { reason }
//   결제·구독은 그대로, 요청 칸만 비운다(환불 계좌 암호문 파기). 사유는 감사와 대표 알림에 남는다.
router.post('/payments/:id/refund-request/decline', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 255);
    if (!reason) return errorResponse(res, 'decline_reason_required', 400);
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    if (p.status !== 'paid' || !p.refund_requested_at) return errorResponse(res, 'not_requested', 409);
    const requestedAt = p.refund_requested_at;
    const [affected] = await Payment.update(
      { refund_requested_at: null, refund_requested_by: null, refund_request_note: null, refund_account_enc: null },
      { where: { id: p.id, status: 'paid', refund_requested_at: requestedAt } },
    );
    if (affected !== 1) return errorResponse(res, 'not_requested', 409);
    await require('../services/auditService').writeAudit({
      userId: req.user.id, businessId: p.business_id, action: 'payment.refund_request_declined',
      targetType: 'payment', targetId: p.id, ipAddress: req.ip || null,
      newValue: { reason, requested_at: new Date(requestedAt).toISOString() },
    });
    setImmediate(() => notifyRefundOwner(p, {
      title: '환불 요청이 반려됐습니다',
      body: `${moneyStr(p)} 결제의 환불 요청이 반려됐습니다. 사유: ${reason}`,
    }));
    return successResponse(res, { declined: true, payment_id: p.id });
  } catch (err) { next(err); }
});

// 계좌이체 환불 계좌 — 읽는 문은 여기 하나(docs/TRIAL_REFUND_DESIGN.md §5). 응답 일반 경로엔 _enc 라 실리지 않는다.
router.get('/payments/:id/refund-account', async (req, res, next) => {
  try {
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    let account = null;
    if (p.refund_account_enc) {
      try { account = JSON.parse(require('../services/encryption').decrypt(p.refund_account_enc)); } catch { account = null; }
    }
    require('../services/auditService').logAudit(req, {
      action: 'admin.payment.refund_account_view', targetType: 'payment', targetId: p.id,
      newValue: { business_id: p.business_id, has_account: !!account },
    });
    return successResponse(res, { account });
  } catch (err) { next(err); }
});

module.exports = router;
