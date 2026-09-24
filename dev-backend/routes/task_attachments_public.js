// routes/task_attachments_public.js — 업무 첨부 이미지 **공개 서빙**(무인증 `<img>` 용) 한 라우트.
//
// 2026-09-24 routes/task_attachments.js 에서 그대로 옮겼다(god-file 500줄 한도 — 이미지 게이트를 넣으며 넘었다).
//   ★ 마운트는 server.js 에서 task_attachments **바로 뒤** — 옮기기 전과 같은 순서라 앞 라우터가 이 경로를 가로채지 않는다.
//   ★ 무인증 라우트다. 등급 판정은 middleware/imageViewer.denyPrivateCopy(원본 File 등급) 한 곳.
const express = require('express');
const router = express.Router();
const { TaskAttachment } = require('../models');
const { errorResponse } = require('../middleware/errorHandler');
const { readAttachmentBody } = require('../services/attachmentStorage');
const { isRenderableImage, effectiveMimeType } = require('../services/filePreview');

// ============================================
// GET /api/tasks/public/attach/:storedName — 공개 (UUID stored_name 으로 접근 제어)
// 이미지 인라인 삽입용. <img src> 에서 Authorization 헤더 못 보내는 제약 대응.
// 보안:
//   - image/* MIME 타입만 허용 (HTML/JS 임베딩으로 인한 XSS 차단)
//   - X-Content-Type-Options: nosniff (브라우저 MIME 추론 차단)
//   - Content-Disposition: inline 로 렌더 컨텍스트 제한
//   - 비이미지 파일은 인증된 /attachments/:id/download 엔드포인트 사용
// ============================================
router.get('/public/attach/:storedName', async (req, res, next) => {
  try {
    const att = await TaskAttachment.findOne({ where: { stored_name: req.params.storedName } });
    if (!att) return errorResponse(res, 'not_found', 404);
    // octet-stream 을 그대로 내보내면 판정만 통과하고 <img> 는 안 그린다 — Content-Type 도 되살린다.
    const serveMime = effectiveMimeType(att.mime_type, att.original_name);
    if (!isRenderableImage(att.mime_type, att.original_name)) {
      return errorResponse(res, 'not_public_image', 403);
    }
    if (await require('../middleware/imageViewer').denyPrivateCopy(req, res, { externalId: att.storage_provider === 'gdrive' ? att.external_id : null, storedName: att.stored_name }, 'tasks/public/attach')) return; // ★ 원본 File 등급으로 판정(IMAGE_STAGE2B §0)
    // #134 — 여기가 <img> 가 실제로 부르는 경로. Drive 저장분은 로컬 파일이 없어 410 이었다.
    const body = await readAttachmentBody(att);
    if (!body.ok) return errorResponse(res, body.msg, body.code);
    if (body.redirect) return res.redirect(body.redirect);

    // ?w= 리사이즈는 로컬 파일일 때만 (Drive 스트림은 원본 그대로)
    if (body.abs && await require('../services/imageResize').maybeServeResized(req, res, body.abs, serveMime)) return;

    require('../services/fileServing').applyFileResponseHeaders(res, { mime_type: serveMime, file_name: att.file_name || att.original_name }, { inline: true });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    body.stream.on('error', (e) => {
      console.error('[task_attachments] public image stream error:', e.message);
      if (!res.headersSent) errorResponse(res, 'stream_failed', 502);
    });
    body.stream.pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
