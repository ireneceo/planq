// routes/signature_reject.js — 받는 쪽 «수정 요청·거절» (2026-10-22, Fable 설계 PASS · docs/SIGNATURE_REVISE_ROUND_DESIGN.md D8)
//
// signatures.js 에서 분리(god-file 래칫). 서버 마운트: app.use('/api', require('./routes/signature_reject')) — 꼬리 경로 고유.
//   kind 'revise'(수정 요청 · 사유 필수) | 'decline'(서명 안 함 · 사유 선택). 상태는 둘 다 rejected + rejected_kind.
//   옛 화면은 kind 를 안 보낸다 → decline(종전 «거절» 과 같다).
const express = require('express');
const router = express.Router();
// 지운 워크스페이스의 서명 링크는 닫힌다(10-09 A5 의 공개 라우터 규칙 — 서명만 빠져 있었다, 2026-10-23 보안 재점검).
router.param('token', (req, res, next, token) => {
  const M = require('../models');
  return require('../services/shareOpenable').workspaceAliveParam([[M.SignatureRequest, 'token']])(req, res, next, token);
});
const { SignatureRequest } = require('../models');
const { sequelize } = require('../config/database');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const {
  loadByToken, assertKind, isExpiredNow, maybeUpdateEntityStatus, notifyWorkspaceMembersOnSignature, rejectEventOf, confirmLimiter,
} = require('../services/signatureCore');

// POST /api/sign/:token/reject — 거절
// body: { kind?: 'revise'|'decline', reason?, consent: true }
// 라우트 한도 — 전역 /api 한도만 있었다(토큰 64자 + OTP 가 필요해 노출은 작지만 확인·의견과 같은 한도로 맞춘다).
router.post('/sign/:token/reject', confirmLimiter, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    // #239 — 역방향 가드: 확인 요청(confirm)이 서명 경로로 들어오면 안 된다.
    if (!assertKind(sr, 'sign', res)) { await t.rollback(); return; }
    // 열린 요청(sent·viewed)만 — 예전엔 signed·rejected 만 막아 OTP 를 통과한 취소·만료 토큰이 rejected 로 되살아났다
    //   (Fable 2026-10-22 R3 «유령 거절» — 닫힌 회차의 행이 새 회차에 다시 나타난다).
    if (sr.status !== 'sent' && sr.status !== 'viewed') {
      await t.rollback(); return errorResponse(res, sr.status === 'signed' || sr.status === 'rejected' ? 'already_finalized' : 'invalid_state', 409);
    }
    if (isExpiredNow(sr)) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    if (!sr.otp_verified_at) { await t.rollback(); return errorResponse(res, 'otp_required', 400); }
    // 수정 요청(revise) vs 서명 안 함(decline) — 옛 화면은 kind 를 안 보낸다 → decline(종전 «거절» 과 같다)
    const rejectKind = req.body?.kind === 'revise' ? 'revise' : 'decline';
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) || null : null;
    if (rejectKind === 'revise' && !reason) { await t.rollback(); return errorResponse(res, 'reason_required', 400); }
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    const [hit] = await SignatureRequest.update({
      status: 'rejected', rejected_at: new Date(), rejected_kind: rejectKind,
      rejected_reason: reason, signed_ip: ip, signed_ua: ua,
    }, { where: { id: sr.id, status: sr.status }, transaction: t });
    if (!hit) { await t.rollback(); return errorResponse(res, 'state_changed', 409); }
    sr.rejected_kind = rejectKind; sr.rejected_reason = reason;   // 알림이 이 인스턴스를 읽는다
    await maybeUpdateEntityStatus(sr.entity_type, sr.entity_id, sr.business_id, t);
    await t.commit();

    createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.reject',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, kind: rejectKind, reason, ip },
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_rejected', entity_type: sr.entity_type, entity_id: sr.entity_id });

    require('../services/signatureHooks').afterSignatureChange(sr.id);   // 거래 단계 + 직원 계약서 signed_at

    notifyWorkspaceMembersOnSignature(sr, rejectEventOf(sr), sr.signer_name).catch((e) => console.warn('[notify signature rejected]', e.message));

    return successResponse(res, { rejected: true, kind: rejectKind });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

module.exports = router;
