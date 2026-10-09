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
        const tpl = require('../services/pdfTemplates');
        // 화면으로 나가는 조립 — PDF 용 서버 자기 주소를 걷어낸다(안 걷으면 이미지가 전부 깨진다).
        const body = tpl.browserAssetHtml(tpl.richBodyToHtml(
          parseMaybeJson(sr.content_snapshot) ?? parseMaybeJson(entity.content_json), null, null));
        signedHtml = sd.injectSignatures(body, view.requests, sd.labelsFor(req));
      }
    } catch (e) { console.warn('[sign] 서명본 조립 실패', e.message); }

    return successResponse(res, {
      token: sr.token,
      signer_email: sr.signer_email,
      signer_name: sr.signer_name,
      status: sr.status,
      expires_at: sr.expires_at,
      // 이미지 문맥(2b 1단계) — 고정본 본문 이미지가 서명자(익명)에게 열리게 한다(services/imageCtx).
      image_ctx: require('../services/imageCtx').issueImageCtx('sign', { token: sr.token }),
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
      // 보내는 쪽(우리) 서명자 — 로그인한 본인이면 이 화면에서 인증번호 대신 로그인으로 서명한다
      //   (POST /api/signatures/:id/sign-internal, 그 라우트가 본인·멤버를 다시 본다). 받는 쪽에는 싣지 않는다.
      ...(sr.party === 'us' ? { request_id: sr.id, signer_user_id: sr.signer_user_id ?? null } : {}),
      // 서명 항목(2026-10-05) — 이 서명자가 채울 서명 칸 수(그리기·이미지). 없으면 옛 요청 = 1칸
      required_items: sr.required_items ? { sign: sr.required_items.sign, date: !!sr.required_items.date, name: !!sr.required_items.name } : null,
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
        attachments: (sr.attachments_snapshot || []).filter((a) => a.kind !== 'post').map((a) => ({
          file_id: a.file_id, name: a.name, size: a.size, mime: a.mime,
        })),
        // 연결 문서(2026-10-05) — 요청 때 동결한 것. 본문은 GET /sign/:token/linked/:postId 로 따로 연다.
        linked_docs: (sr.attachments_snapshot || []).filter((a) => a.kind === 'post').map((a) => ({
          post_id: a.post_id, title: a.title || '',
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
    const entry = list.find((a) => a.kind !== 'post' && Number(a.file_id) === want);
    if (!entry) return errorResponse(res, 'not_in_scope', 404);

    const file = await File.findOne({ where: { id: want, business_id: sr.business_id } });
    if (!file || file.deleted_at) return errorResponse(res, 'file_missing', 404);
    // ★ 2026-10-05 — 저장소는 한 함수(services/attachmentStorage)로 읽는다. 여태 로컬 디스크만 봐서
    //   워크스페이스 Drive 에 저장된 별첨은 목록엔 뜨는데 누르면 404 였다(서명자는 별첨을 못 본 채 서명).
    const storage = require('../services/attachmentStorage');
    const body = await storage.readAttachmentBody(file);
    if (!body.ok) return errorResponse(res, body.msg, body.code);

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
    if (body.redirect) return res.redirect(body.redirect);
    return storage.sendAttachmentBody(res, body, 'sign/attachment');
  } catch (err) { next(err); }
});

// GET /api/sign/:token/linked/:postId — 서명자용 **연결 문서** 열람 (무인증, 토큰 범위 한정 · 2026-10-05)
//   본문이 "관련 문서 참조" 를 말하는데 서명자는 그 문서를 볼 길이 없었다. 범위는 별첨과 같은 원칙 —
//   이 요청에 **동결된 목록**에 있는 문서만, **동결된 본문**만 준다. 원본(posts)은 읽지 않는다
//   (요청 뒤에 원본이 바뀌거나 범위가 좁혀져도 서명자가 본 것은 요청 때의 것이다).
router.get('/sign/:token/linked/:postId', async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.status === 'canceled') return errorResponse(res, 'canceled', 410);
    if (isExpiredNow(sr)) return errorResponse(res, 'expired', 410);
    const list = Array.isArray(sr.attachments_snapshot) ? sr.attachments_snapshot : [];
    const want = Number(req.params.postId);
    const entry = list.find((a) => a.kind === 'post' && Number(a.post_id) === want);
    if (!entry) return errorResponse(res, 'not_in_scope', 404);
    try {
      const viewed = Array.isArray(sr.attachments_viewed) ? sr.attachments_viewed : [];
      viewed.push({ post_id: want, at: new Date().toISOString() });
      await sr.update({ attachments_viewed: viewed.slice(-200) });
    } catch (e) { console.warn('[sign] 연결 문서 열람 기록 실패', e.message); }
    const tpl = require('../services/pdfTemplates');
    const html = tpl.browserAssetHtml(tpl.richBodyToHtml(parseMaybeJson(entry.content_snapshot), null, null));
    return successResponse(res, { post_id: want, title: entry.title || '', html });
  } catch (err) { next(err); }
});

// GET /api/sign/:token/pdf — 서명자가 **자기가 서명한 문서**를 PDF 로 받는다 (무인증, 토큰 범위 · 2026-10-05)
//   여태 «받은 서명» 의 [PDF] 가 서명 요청 토큰을 문서 공유 토큰 자리(/api/posts/public/:token/pdf)에 넣어
//   **늘 404** 였다(두 토큰은 다른 열쇠다). 서명 직후 화면에는 받을 문이 아예 없었다.
//   - 서명·확인을 마친 요청만 — 진행 중 문서는 서명 화면에서 본다.
//   - 조립은 문서 PDF 와 **같은 함수**(routes/posts buildPostPdf → 고정본 + 서명). 증명서 장(이메일·IP)은
//     넣지 않는다 — 링크 소지자가 여는 공개 문(CLAUDE.md 서명본 규칙).
//   - PDF 렌더는 비싸다 — 토큰+IP 로 10분 10회.
const pdfLimiter = require('express-rate-limit')({
  windowMs: 10 * 60 * 1000, max: 10,
  keyGenerator: (req) => `signpdf:${String(req.params.token || '').slice(0, 16)}:${require('express-rate-limit').ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'rate_limit_pdf' },
});
router.get('/sign/:token/pdf', pdfLimiter, async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.status === 'canceled') return errorResponse(res, 'canceled', 410);
    if (!['signed', 'confirmed', 'commented'].includes(sr.status)) return errorResponse(res, 'not_signed_yet', 409);
    if (sr.entity_type !== 'post') return errorResponse(res, 'not_found', 404);
    const { Post, User } = require('../models');
    const post = await Post.findByPk(sr.entity_id, { include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }] });
    if (!post || Number(post.business_id) !== Number(sr.business_id)) return errorResponse(res, 'entity_missing', 404);
    const pdf = await require('./posts').buildPostPdf(post, req, false);
    const title = sr.title_snapshot || post.title || 'document';
    const asciiName = String(title).replace(/[^\w-]/g, '_').slice(0, 80) || 'document';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"; filename*=UTF-8''${encodeURIComponent(`${title}.pdf`)}`);
    return res.send(pdf);
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
router.post('/sign/request-link', linkLimiter, async (req, res, next) => { // audit-exempt: 감사(signature.link_requested)는 응답 뒤 sendLinkAgain 이 남긴다 — 응답 시간으로 명단이 드러나지 않게 뒤로 뺐다
  try {
    const entityType = req.body?.entity_type === 'document' ? 'document' : 'post';
    const entityId = Number(req.body?.entity_id || 0);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!entityId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse(res, 'invalid_request', 400);
    }
    const { SignatureRequest } = require('../models');
    const { Op } = require('sequelize');
    const sr = await SignatureRequest.findOne({
      where: {
        entity_type: entityType, entity_id: entityId, signer_email: email,
        kind: 'sign', party: 'them',           // 보내는 쪽(멤버)에게는 메일 링크가 없다
        status: { [Op.in]: ['pending', 'sent', 'viewed'] },
      },
      order: [['id', 'DESC']],
    });
    // ★ 보내기는 응답 뒤에 한다 — 명단에 있을 때만 메일 발송을 기다리면 **응답 시간**으로 명단 여부가
    //   드러난다(2026-10-09 보안점검). 응답 본문만 같게 해서는 열거가 안 막힌다.
    if (sr && !isExpiredNow(sr)) {
      setImmediate(() => sendLinkAgain(sr).catch((e) => console.warn('[sign] 링크 재발송 실패', e.message)));
    }
    // 명단에 없어도 같은 응답 — 열거 차단
    return successResponse(res, { sent: true });
  } catch (err) { next(err); }
});

async function sendLinkAgain(sr) {
  const { User, Business } = require('../models');
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
  });
  await sr.update({ reminder_count: sr.reminder_count + 1, last_reminder_at: new Date() });
  createAuditLog({
    userId: sr.requester_user_id, businessId: sr.business_id, action: 'signature.link_requested',
    targetType: 'SignatureRequest', targetId: sr.id, metadata: { signer: sr.signer_email },
  });
}

module.exports = router;
