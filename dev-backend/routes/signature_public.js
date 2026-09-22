// routes/signature_public.js — 서명 요청의 **공개 조회** 경로 (무인증, 토큰 범위 한정)
//
// signatures.js 에서 분리(2026-08-27). #239 때 signature_confirm.js 를 뗀 것과 같은 이유·같은 방식:
//   한 파일이 계속 자라 god-file 래칫을 넘었고, 공개(토큰) 조회는 소유자용 관리 라우트와
//   보안 경계 자체가 다르다 — 무인증으로 들어오는 표면은 따로 두고 읽는 편이 안전하다.
// 서버 마운트: app.use('/api', require('./routes/signature_public'))  ← signatures 와 같은 base.
const express = require('express');
const router = express.Router();
const { errorResponse, successResponse } = require('../middleware/errorHandler');
const { File } = require('../models');
const { loadByToken, isExpiredNow, parseMaybeJson, loadEntity } = require('../services/signatureCore');
const { createAuditLog } = require('../middleware/audit');

router.get('/sign/:token', async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.status === 'canceled') return errorResponse(res, 'canceled', 410);
    if (sr.status === 'expired' || (sr.expires_at && sr.expires_at < new Date() && sr.status !== 'signed' && sr.status !== 'rejected')) {
      if (sr.status !== 'expired') await sr.update({ status: 'expired' });
      return errorResponse(res, 'expired', 410);
    }
    // viewed 마킹
    if (sr.status === 'sent') {
      await sr.update({ status: 'viewed', viewed_at: new Date() });
    }
    const entity = await loadEntity(sr.entity_type, sr.entity_id);
    if (!entity) return errorResponse(res, 'entity_missing', 404);

    // 서명본 조립 — 실패해도 서명 자체는 막지 않는다(본문은 content_json 으로 그려진다).
    let signedHtml = null;
    try {
      const sd = require('../services/signedDocument');
      const view = await sd.loadSignedView(sr.entity_type, sr.entity_id);
      if (view.total) {
        const body = require('../services/pdfTemplates').richBodyToHtml(
          parseMaybeJson(sr.content_snapshot) ?? parseMaybeJson(entity.content_json), null, null);
        signedHtml = sd.injectSignatures(body, view.requests, sd.labelsFor(req));
      }
    } catch (e) { console.warn('[sign] 서명본 조립 실패', e.message); }

    return successResponse(res, {
      token: sr.token,
      signer_email: sr.signer_email,
      signer_name: sr.signer_name,
      status: sr.status,
      expires_at: sr.expires_at,
      kind: sr.kind || 'sign',   // #239 — 공개 페이지가 확인 뷰/서명 뷰를 가르는 값
    confirmed_at: sr.confirmed_at,
    comment: sr.comment,
    comment_at: sr.comment_at,
    otp_verified: !!sr.otp_verified_at,
      signed_at: sr.signed_at,
      signature_image_b64: sr.signature_image_b64,  // 서명 후 미리보기
      note: sr.note,
      // 서명란(2026-09-22) — 화면이 «내 칸» 을 문서 안에서 강조한다. 어디에 들어가는지 모른 채
      //   서명하게 두지 않는다(설계 §1). slot NULL 이면 서명란 없는 옛 요청이다.
      slot: sr.slot == null ? null : sr.slot,
      party: sr.party || 'them',
      entity: {
        type: sr.entity_type,
        id: sr.entity_id,
        title: sr.title_snapshot || entity.title || '문서',
        // ★ 2026-08-27 — **동결된 본문**을 보여준다. 여태 문서의 *현재* 본문을 읽어 왔고,
        //   그래서 요청을 보낸 뒤 본문이 바뀌면 서명자는 다른 것을 보게 됐다.
        //   동결분이 없는 옛 row 만 현재 본문으로 떨어진다(하위호환).
        content_json: sr.entity_type === 'post'
          ? parseMaybeJson(sr.content_snapshot) ?? parseMaybeJson(entity.content_json)
          : null,
        // ★ 별첨 — 여태 응답에 없어서 서명 화면에 아예 안 나왔다. 본문이 "별첨 2에 정한…" 을
        //   인용하는데 정작 서명자는 그것을 볼 수 없는 상태였다(운영 계약서 실사례).
        //   동결 시점 목록을 그대로 보여준다 — 이후 문서에 첨부가 추가/삭제돼도 서명 대상은 불변이다.
        attachments: (sr.attachments_snapshot || []).map((a) => ({
          file_id: a.file_id, name: a.name, size: a.size, mime: a.mime,
        })),
        snapshot_at: sr.snapshot_at,
        // 서명본 — 이미 서명된 칸은 그 서명이 보인다(다른 사람이 먼저 서명했을 수 있다).
        //   조립은 services/signedDocument 한 곳. ★ 증명서(이메일·IP)는 싣지 않는다.
        signed_html: signedHtml,
        project: entity.Project ? { id: entity.Project.id, name: entity.Project.name } : null,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/sign/:token/attachments/:fileId — 서명자용 별첨 열람 (무인증, 토큰 범위 한정)
//
// ★ 2026-08-27 — 서명자는 로그인 사용자가 아니다. 그런데 계약 본문이 별첨을 인용하면
//   그 별첨을 **볼 수 있어야** 서명이 의미를 갖는다. 여태 별첨은 응답에도 화면에도 없었다.
//   범위는 이 서명 요청에 **동결된 목록**으로 못 박는다 — 문서에 나중에 붙은 파일은 열리지 않는다.
//   (파일 id 를 클라이언트가 아무거나 넣어도 동결 목록에 없으면 404. 워크스페이스 전체가 뚫리지 않는다.)
router.get('/sign/:token/attachments/:fileId', async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.status === 'canceled') return errorResponse(res, 'canceled', 410);
    if (isExpiredNow(sr)) return errorResponse(res, 'expired', 410);
    const list = Array.isArray(sr.attachments_snapshot) ? sr.attachments_snapshot : [];
    const want = Number(req.params.fileId);
    const entry = list.find((a) => Number(a.file_id) === want);
    if (!entry) return errorResponse(res, 'not_in_scope', 404);

    const file = await File.findOne({ where: { id: want, business_id: sr.business_id } });
    if (!file || file.deleted_at) return errorResponse(res, 'file_missing', 404);
    const fs = require('fs');
    if (!file.file_path || !fs.existsSync(file.file_path)) return errorResponse(res, 'file_missing', 404);

    // 열람 사실 기록 — 증거의 일부다 ("별첨을 보지 못했다" 는 주장에 대한 반증).
    try {
      const viewed = Array.isArray(sr.attachments_viewed) ? sr.attachments_viewed : [];
      viewed.push({ file_id: want, at: new Date().toISOString() });
      await sr.update({ attachments_viewed: viewed.slice(-200) });
    } catch (e) { console.warn('[sign] 별첨 열람 기록 실패', e.message); }

    const asciiName = String(file.file_name || 'attachment').replace(/[^\w.-]/g, '_').slice(0, 80) || 'attachment';
    require('../services/fileServing').applyFileResponseHeaders(res, file, {
      inline: true,
      disposition: `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.file_name || asciiName)}`,
    });
    return res.sendFile(require('path').resolve(file.file_path));
  } catch (err) { next(err); }
});

// POST /api/sign/request-link — 채팅 카드의 [서명하기] (2026-09-22, 설계 §4)
//
// ★ 여러 사람이 보는 방에 **서명자별 링크(=그 사람의 열쇠)를 올리지 않는다.**
//   여태 카드에 첫 서명자의 토큰 URL 이 그대로 실려, 방에 있는 누구나 그 사람 대신
//   서명 화면에 들어갈 수 있었다(본인 확인은 그 뒤 이메일 인증번호가 하지만, 링크 자체가 열쇠다).
//   대신 «내 이메일» 을 받아 **그 주소로** 링크를 보낸다 — 주소의 주인만 받는다.
//
// 열거 방지: 명단에 없어도 **같은 응답**을 준다. 다르게 답하면 이 문이 "이 사람이 서명자인가" 를
//   알려 주는 조회 창구가 된다. 실패도 성공도 { sent: true }.
const linkLimiter = require('express-rate-limit')({
  windowMs: 10 * 60 * 1000, max: 5,
  keyGenerator: (req) => `${req.body?.entity_id || ''}:${require('express-rate-limit').ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'rate_limit_link' },
});
router.post('/sign/request-link', linkLimiter, async (req, res, next) => {
  try {
    const entityType = req.body?.entity_type === 'document' ? 'document' : 'post';
    const entityId = Number(req.body?.entity_id || 0);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!entityId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse(res, 'invalid_request', 400);
    }
    const { SignatureRequest, User, Business } = require('../models');
    const { Op } = require('sequelize');
    const sr = await SignatureRequest.findOne({
      where: {
        entity_type: entityType, entity_id: entityId, signer_email: email,
        kind: 'sign', party: 'them',           // 보내는 쪽(멤버)에게는 메일 링크가 없다
        status: { [Op.in]: ['pending', 'sent', 'viewed'] },
      },
      order: [['id', 'DESC']],
    });
    if (sr && !isExpiredNow(sr)) {
      const entity = await loadEntity(sr.entity_type, sr.entity_id);
      const business = await Business.findByPk(sr.business_id, { attributes: ['name'] });
      const sender = await User.findByPk(sr.requester_user_id, { attributes: ['name'] });
      await require('../services/emailService').sendSignatureRequestEmail({
        to: sr.signer_email,
        docTitle: sr.title_snapshot || entity?.title || '문서',
        senderName: sender?.name || '',
        workspaceName: business?.name || '',
        signerName: sr.signer_name,
        message: sr.note,
        signUrl: `${process.env.APP_URL || 'https://dev.planq.kr'}/sign/${sr.token}`,
        expiresAt: sr.expires_at,
      }).catch((e) => console.warn('[sign] 링크 재발송 실패', e.message));
      await sr.update({ reminder_count: sr.reminder_count + 1, last_reminder_at: new Date() });
      createAuditLog({
        userId: sr.requester_user_id, businessId: sr.business_id, action: 'signature.link_requested',
        targetType: 'SignatureRequest', targetId: sr.id, metadata: { signer: sr.signer_email },
      });
    }
    // 명단에 없어도 같은 응답 — 열거 차단
    return successResponse(res, { sent: true });
  } catch (err) { next(err); }
});

module.exports = router;
