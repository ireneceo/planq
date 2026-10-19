// 결제 환불 요청 — 대표(owner)의 요청·취소 문. 설계 docs/TRIAL_REFUND_DESIGN.md §2·§5
//
//   POST   /api/plan/:businessId/payments/:paymentId/refund-request  body { note?, refund_account?: {bank, number, holder} }
//   DELETE /api/plan/:businessId/payments/:paymentId/refund-request
//
//   두 갈래, 한 문 (2026-10-19 — Irene «왜 환불요청이 문의폼으로 와? 관리자로써 어쩌라는 건지 모르겠어»):
//     · 체험 중 결제(billing.trialRefundability 가 자격 있음) → kind 'trial' — 관리자가 처리하면 구독이 체험으로 돌아간다.
//     · 그 밖의 결제 완료 건 → kind 'general' — 약관 제4조 기준으로 관리자가 판단해 [환불] 또는 [반려]. 사유 필수.
//     예전엔 일반 환불이 «문의» 로 들어가 결제와 안 묶였고(관리자는 «새 문의 #3» 메일 + 문의 보기 링크만 받았다),
//     처리 문(관리자 결제 관리)에 그 결제가 표시되지 않았다. 이제 둘 다 결제 행에 표시되고 관리자 확인 필요에 뜬다.
//
//   ★ 요청은 상태를 바꾸지 않는다 — 결제는 paid, 서비스는 그대로. 되돌리는 것은 관리자 [환불](services/refund) 한 번뿐.
//   ★ 체험 자격은 billing.trialRefundability 한 함수(요청·/status·관리자 처리가 같이 쓴다).
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

// 관리자 알림 — 제목만 보고도 «무슨 일·어디서·얼마» 를 알게, 링크는 그 결제 행(처리 문)으로.
async function notifyRefundRequested({ payment: p, biz, isTrial, note, requesterName }) {
  const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
  const { Business } = require('../models');
  const b = biz || await Business.findByPk(p.business_id, { attributes: ['id', 'name', 'brand_name'] });
  const ws = b ? (b.brand_name || b.name) : `워크스페이스 ${p.business_id}`;
  const amountStr = p.currency === 'KRW' ? `${Number(p.amount).toLocaleString()}원` : `${p.currency} ${Number(p.amount).toLocaleString()}`;
  const paidDay = p.paid_at ? new Date(p.paid_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  const method = isCardPayment(p) ? '카드' : '계좌이체';
  const lines = [
    `${ws} 에서 결제 환불을 요청했습니다${requesterName ? ` (요청: ${requesterName})` : ''}.`,
    `결제일 ${paidDay} · ${amountStr} · ${method} · 결제 #${p.id}`,
    note ? `사유: ${note}` : null,
    isTrial
      ? '체험 중 결제입니다 — 환불 처리하면 결제 금액 전액이 돌아가고 구독이 체험 상태로 돌아갑니다.'
      : '약관 제4조 기준(월간 7일·연간 14일 이내 전액, 그 뒤 일할)으로 확인한 뒤 관리자 결제 관리에서 [환불 처리] 또는 [반려] 하세요.',
  ].filter(Boolean);
  await notifyPlatformAdmins({
    eventKind: 'payment',
    title: `[환불 요청] ${ws} — ${amountStr}${isTrial ? ' (체험 중 결제)' : ''}`,
    body: lines.join('\n'),
    link: `${APP_URL}/admin/payments?payment=${p.id}`,
    ctaLabel: '환불 요청 처리하기',
    relatedEntityId: p.id,
  });
}

router.post('/:businessId/payments/:paymentId/refund-request', authenticateToken, checkBusinessAccess, ownerOnly, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const ctx = await billing.loadTrialRefundContext(businessId, { paymentId });
    if (!ctx.payment) {
      // 체험 후보 조회는 플랜 결제만 본다 — 애드온 결제도 일반 환불 요청은 받는다.
      ctx.payment = await Payment.findOne({ where: { id: paymentId, business_id: businessId } });
      if (!ctx.payment) return errorResponse(res, 'payment_not_found', 404);
    }
    if (ctx.payment.status !== 'paid') return errorResponse(res, 'not_paid', 409);
    if (ctx.payment.refund_requested_at) return errorResponse(res, 'already_requested', 409);
    const isTrial = billing.trialRefundability({ ...ctx, stage: 'request' }).eligible;

    // 계좌이체는 돌려받을 계좌가 있어야 한다. 카드는 결제한 카드로 취소하므로 받지 않는다(보내도 버린다).
    let accountEnc = null;
    if (!isCardPayment(ctx.payment)) {
      const acc = parseAccount(req.body?.refund_account);
      if (!acc) return errorResponse(res, 'refund_account_required', 400);
      accountEnc = require('../services/encryption').encrypt(JSON.stringify(acc));
    }
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
    // 일반 환불은 관리자가 약관 기준으로 판단해야 하므로 사유가 있어야 한다(체험 중 환불은 조건만 맞으면 전액이라 선택).
    if (!isTrial && !note) return errorResponse(res, 'refund_reason_required', 400);
    const now = new Date();
    // 동시 요청 — 조건부 UPDATE 로 못을 박는다(자격은 위에서 봤다). 한 건만 1 행을 바꾼다.
    const [affected] = await Payment.update({
      refund_requested_at: now, refund_requested_by: req.user.id, refund_request_note: note, refund_account_enc: accountEnc,
    }, { where: { id: paymentId, business_id: businessId, status: 'paid', refund_requested_at: null } });
    if (affected !== 1) return errorResponse(res, 'already_requested', 409);

    await writeAudit({
      userId: req.user.id, businessId, action: 'payment.refund_requested', targetType: 'payment', targetId: paymentId,
      ipAddress: req.ip || null,
      newValue: { kind: isTrial ? 'trial' : 'general', amount: Number(ctx.payment.amount), currency: ctx.payment.currency, method: ctx.payment.method, has_account: !!accountEnc, note: !!note },
    });

    setImmediate(() => notifyRefundRequested({ payment: ctx.payment, biz: ctx.biz, isTrial, note, requesterName: req.user.name })
      .catch((e) => console.warn('[refund-request notify]', e.message)));
    return successResponse(res, { requested: true, kind: isTrial ? 'trial' : 'general', payment_id: paymentId, requested_at: now });
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
