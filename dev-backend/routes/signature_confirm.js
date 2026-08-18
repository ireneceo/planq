// 문서 외부 확인 라우트 — 운영 #239.
//
// 왜 signatures.js 에서 갈라져 나왔나: 확인 기능이 붙으면서 그 파일이 803줄이 되어 god-file 래칫에
// 걸렸다. 절단면은 **공개 무인증 표면 중 '확인' 계열**이다 — 서명(OTP·캔버스·동의)과 확인(그냥 눌러서
// 확인/의견)은 요구 강도가 달라 함께 두면 서로의 가드를 헷갈리게 한다(실제로 만료 검사가 갈라져 있었다).
// 공용 판정은 services/signatureCore.js 한 곳에서만 가져온다.
const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const {
  loadByToken, confirmLimiter, docConfirmEnabled, assertKind,
  isExpiredNow, notifyWorkspaceMembersOnSignature,
} = require('../services/signatureCore');


// ─────────────────────────────────────────────
// 운영 #239 — 확인(confirm) 공개 액션
//
// 왜 OTP 가 없는가 (Fable 판정): 확인은 "그냥 확인했다" 이고, 여기에 서명급 인증을 요구하면
//   Irene 이 원한 "굳이 내부로 유저로 들어오지 않고 업무처리" 가 도로 무거워진다.
//   신원은 **사람별 토큰**이 담보한다(64자 랜덤, 수신자에게만 발송, 만료·회수 가능).
//   공개 share 링크(/public/posts)에는 이 액션을 붙이지 않는다 — 그건 전달받은 누구나 누를 수 있다.
// ─────────────────────────────────────────────

// POST /api/sign/:token/confirm — 확인했습니다 (+ 선택 의견)
router.post('/sign/:token/confirm', confirmLimiter, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    if (!docConfirmEnabled()) { await t.rollback(); return errorResponse(res, 'feature_disabled', 503); }
    const sr = await loadByToken(req.params.token);
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (!assertKind(sr, 'confirm', res)) { await t.rollback(); return; }
    if (isExpiredNow(sr)) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    if (sr.status === 'canceled') { await t.rollback(); return errorResponse(res, 'canceled', 400); }
    if (sr.confirmed_at) { await t.rollback(); return errorResponse(res, 'already_confirmed', 409); }

    const comment = req.body?.comment ? String(req.body.comment).slice(0, 2000) : null;
    const signerName = req.body?.signer_name ? String(req.body.signer_name).slice(0, 100) : null;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    await sr.update({
      status: 'confirmed',
      confirmed_at: new Date(),
      comment: comment || sr.comment,
      comment_at: comment ? new Date() : sr.comment_at,
      // 서명과 같은 증거 필드를 쓴다 — 누가·언제·어디서 눌렀는지가 확인의 근거다.
      signed_ip: ip, signed_ua: ua,
      ...(signerName ? { signer_name: signerName } : {}),
    }, { transaction: t });
    await t.commit();

    createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.confirm',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, comment, ip },
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'doc_confirmed', entity_type: sr.entity_type, entity_id: sr.entity_id });

    notifyWorkspaceMembersOnSignature(sr, 'confirmed', sr.signer_name).catch((e) => console.warn('[notify doc confirmed]', e.message));

    return successResponse(res, { confirmed: true, comment: sr.comment });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

// POST /api/sign/:token/comment — 의견만 남기기 (확인은 하지 않음)
router.post('/sign/:token/comment', confirmLimiter, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    if (!docConfirmEnabled()) { await t.rollback(); return errorResponse(res, 'feature_disabled', 503); }
    const sr = await loadByToken(req.params.token);
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (!assertKind(sr, 'confirm', res)) { await t.rollback(); return; }
    if (isExpiredNow(sr)) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    if (sr.status === 'canceled') { await t.rollback(); return errorResponse(res, 'canceled', 400); }

    const comment = req.body?.comment ? String(req.body.comment).trim().slice(0, 2000) : '';
    if (!comment) { await t.rollback(); return errorResponse(res, 'comment_required', 400); }
    const signerName = req.body?.signer_name ? String(req.body.signer_name).slice(0, 100) : null;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    await sr.update({
      // 이미 확인까지 마친 뒤의 추가 의견이면 confirmed 를 되돌리지 않는다.
      status: sr.confirmed_at ? sr.status : 'commented',
      comment, comment_at: new Date(),
      signed_ip: ip, signed_ua: ua,
      ...(signerName ? { signer_name: signerName } : {}),
    }, { transaction: t });
    await t.commit();

    createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.comment',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, comment, ip },
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'doc_commented', entity_type: sr.entity_type, entity_id: sr.entity_id });

    notifyWorkspaceMembersOnSignature(sr, 'commented', sr.signer_name).catch((e) => console.warn('[notify doc commented]', e.message));

    return successResponse(res, { commented: true, comment });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

// ─── Serializer ───

module.exports = router;
