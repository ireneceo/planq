// routes/signature_internal.js — **보내는 쪽(우리 멤버) 서명** (2026-09-22)
//
// signatures.js 에서 분리. signature_public.js(무인증 토큰) · signature_confirm.js(#239) 와 같은 이유:
//   한 파일이 계속 자라 god-file 래칫을 넘었고, 이 경로는 **본인 확인 방법이 아예 다르다**
//   (이메일 인증번호가 아니라 로그인). 경계가 다른 것은 따로 두고 읽는 편이 안전하다.
//
// 서버 마운트: app.use('/api', require('./routes/signature_internal'))  ← signatures 와 같은 base.
const express = require('express');
const router = express.Router();
const { SignatureRequest } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { buildEntitySnapshot, loadEntity, maybeUpdateEntityStatus } = require('../services/signatureCore');
const { assertKind, isExpiredNow, notifyWorkspaceMembersOnSignature } = require('../services/signatureCore');

// 멤버 판정 — signatures.js 와 **같은 술어**(access_scope 한 곳). 베끼지 않는다.
async function assertMember(userId, businessId, isPlatformAdmin) {
  const { assertMemberOrAbove } = require('../middleware/access_scope');
  return assertMemberOrAbove(userId, businessId, isPlatformAdmin ? 'platform_admin' : null);
}

// POST /api/signatures/:id/sign-internal — **보내는 쪽(우리 멤버) 서명** (2026-09-22)
// body: { signature_image_b64, consent: true }
//
//   받는 쪽과 다른 것은 **본인 확인 방법 하나**다: 이메일 인증번호 대신 **로그인**이 본인을 증명한다.
//   나머지(동의 기록·시각·IP·UA·고정본 대조·알림·거래 단계 진행)는 받는 쪽과 **같은 것**을 남긴다 —
//   증거의 수준이 갈리면 «우리 서명» 이 계약에서 약한 고리가 된다.
//   서명할 수 있는 사람: 요청에 지정된 멤버(signer_user_id). 지정이 없으면 요청자(requester_user_id).
router.post('/signatures/:id/sign-internal', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sr = await SignatureRequest.findByPk(req.params.id, { transaction: t });
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (!(await assertMember(req.user.id, sr.business_id, req.user.platform_role === 'platform_admin'))) {
      await t.rollback(); return errorResponse(res, 'forbidden', 403);
    }
    if (sr.party !== 'us') { await t.rollback(); return errorResponse(res, 'not_internal_signer', 400); }
    if (!assertKind(sr, 'sign', res)) { await t.rollback(); return; }
    const allowed = sr.signer_user_id || sr.requester_user_id;
    if (Number(allowed) !== Number(req.user.id)) {
      await t.rollback(); return errorResponse(res, 'not_your_signature', 403);
    }
    if (sr.status === 'signed') { await t.rollback(); return errorResponse(res, 'already_signed', 409); }
    if (isExpiredNow(sr)) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    if (sr.status === 'rejected' || sr.status === 'canceled') { await t.rollback(); return errorResponse(res, 'invalid_state', 400); }
    if (!req.body?.consent) { await t.rollback(); return errorResponse(res, 'consent_required', 400); }
    const sig = String(req.body?.signature_image_b64 || '');
    if (!sig.startsWith('data:image/') || sig.length > 200_000) {
      await t.rollback(); return errorResponse(res, 'invalid_signature_image', 400);
    }
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    // 받는 쪽과 같은 대조 — 서명 시점의 문서가 동결분과 같은지. 다르면 막지 않고 사실로 남긴다.
    let signedHash = sr.content_hash || null;
    let mismatch = false;
    try {
      const cur = await loadEntity(sr.entity_type, sr.entity_id);
      if (cur) {
        const now = await buildEntitySnapshot(sr.entity_type, cur, t);
        signedHash = now.content_hash;
        mismatch = !!(sr.content_hash && now.content_hash !== sr.content_hash);
      }
    } catch (e) { console.warn('[sign-internal] snapshot 대조 실패', e.message); }

    await sr.update({
      status: 'signed',
      signature_image_b64: sig,
      signed_at: new Date(),
      signed_ip: ip, signed_ua: ua, signed_consent: true,
      signer_user_id: req.user.id,
      signed_content_hash: signedHash,
      snapshot_mismatch: mismatch,
    }, { transaction: t });
    await maybeUpdateEntityStatus(sr.entity_type, sr.entity_id, sr.business_id, t);
    await t.commit();

    createAuditLog({
      userId: req.user.id, businessId: sr.business_id, action: 'signature.sign_internal',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, ip, content_hash: sr.content_hash, snapshot_mismatch: mismatch },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_signed', entity_type: sr.entity_type, entity_id: sr.entity_id });
    require('../services/projectStageEngine').onSignatureChanged(sr.id).catch(() => null);
    notifyWorkspaceMembersOnSignature(sr, 'signed', sr.signer_name).catch((e) => console.warn('[notify signature signed]', e.message));

    return successResponse(res, { signed: true, signed_at: new Date() });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

module.exports = router;
