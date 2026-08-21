// Q Talk 메시지 첨부 — multer 기반 업로드 + 다운로드
//   POST /api/message-attachments/:conversationId/:messageId
//   GET  /api/message-attachments/:id/download
//
// 규칙:
//   - 파일 저장: uploads/{business_id}/{yyyy-mm}/{uuid}{ext}
//   - 플랜별 파일 크기 제한 검증 (plan.js)
//   - SHA-256 dedup 는 추후 (현재는 단일 저장)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Conversation, Message, MessageAttachment, File: FileModel } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { serializeMessageAttachment } = require('../services/filePreview');
const { canAccessConversation } = require('../middleware/access_scope');
const { decodeOriginalName } = require('../services/filename');
const { perUserLimiter } = require('../middleware/costGuard');

// 비용폭탄 H3 — 업로드 per-user rate-limit (라우트 내부 적용. security.js 의 경로 패턴 방식은
//   실제 마운트 경로 불일치로 죽어 있었음 → 여기서 직접 건다). 분당 10회.
const attachUploadLimiter = perUserLimiter('msg-attach', { windowMs: 60 * 1000, max: 10, message: '파일 업로드가 너무 잦습니다. 잠시 후 다시 시도하세요.' });

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// 운영 #267 — 허용 확장자는 services/uploadPolicy 한 곳이 정본이다.
//   여기 사본을 두면 화면마다 되는 형식이 달라진다(업무 첨부만 영상이 막혀 있던 것이 그 사례).
const { ATTACHMENT_EXT: ALLOWED_EXT } = require('../services/uploadPolicy');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ym = new Date().toISOString().slice(0, 7);
    const biz = req._conversation?.business_id || req.params.businessId || 'misc';
    const dir = path.join(UPLOAD_ROOT, String(biz), ym);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
// multer 자체 한도는 5GB (Drive 연동 시 영상). 자체 스토리지/플랜 한도는 라우트 핸들러에서 별도 검증.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('disallowed_extension'));
    cb(null, true);
  },
});

async function loadConversationAndGuard(req, res) {
  const conv = await Conversation.findByPk(req.params.conversationId);
  if (!conv) { errorResponse(res, 'conversation_not_found', 404); return null; }
  // member/owner/admin/platform_admin OR conversation participant OR matching client_id 통과
  const allowed = await canAccessConversation(req.user.id, conv);
  if (!allowed) { errorResponse(res, 'forbidden', 403); return null; }
  req._conversation = conv;
  return conv;
}

// ─── POST upload ───
router.post('/:conversationId/:messageId',
  authenticateToken,
  attachUploadLimiter,
  async (req, res, next) => {
    try { if (!(await loadConversationAndGuard(req, res))) return; next(); }
    catch (err) { next(err); }
  },
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.message === 'disallowed_extension') {
        return errorResponse(res,
          '지원하지 않는 파일 형식입니다. 이미지·문서·영상·음성 파일만 업로드 가능해요.',
          400
        );
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return errorResponse(res, '파일이 너무 큽니다 (최대 5GB).', 413);
      }
      return errorResponse(res, err.message || '업로드 실패', 400);
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) return errorResponse(res, 'file_required', 400);

      const msg = await Message.findOne({
        where: { id: req.params.messageId, conversation_id: req._conversation.id },
      });
      if (!msg) return errorResponse(res, 'message_not_found', 404);
      if (msg.sender_id !== req.user.id) return errorResponse(res, 'forbidden', 403);

      // 비용폭탄 재게이트(2026-07-03) — 메시지 첨부는 항상 자체(planq) 로컬 저장(이 라우트엔 Drive
      //   업로드 경로가 없다 — storage_provider 는 아래에서 'planq' 하드코딩). 따라서 external:false 로
      //   플랜 파일크기 한도 + 총 쿼터를 반드시 강제한다.
      //   (직전 버전이 external:driveConnected 를 넘겨, Drive 연동 워크스페이스는 크기·쿼터 검사를
      //    통째로 건너뛰고 로컬 디스크에 무제한 저장·미집계되던 H-e 구멍을 재개봉했었음.)
      const plan = require('../services/plan');
      const { reservePlanqUpload, releasePlanqUpload } = require('../services/storageUsage');
      const attachBizId = req._conversation.business_id;
      const canUp = await plan.can(attachBizId, 'upload_file', { size: req.file.size, external: false });
      if (!canUp.ok) {
        fs.unlink(req.file.path, () => {});
        if (canUp.reason === 'file_size_exceeded') {
          const limitMB = Math.round((canUp.limit || 0) / 1024 / 1024);
          return errorResponse(res, `파일이 너무 큽니다. 현재 플랜에서 ${limitMB}MB 까지 가능해요.`, 413);
        }
        return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
      }

      // race-safe 쿼터 예약(FOR UPDATE 재검증) — 30s getUsage 캐시 + 10/분 리미터 창에서
      //   동시 업로드가 쿼터를 초과 집계하는 것을 방지. files.js 와 동일 패턴.
      let reserved;
      try {
        reserved = await reservePlanqUpload(attachBizId, req.file.size);
      } catch (e) {
        // 예약 자체가 실패(락 경합 재시도 소진 등) → 임시파일 정리 후 재던짐(집계 오염 없음).
        fs.unlink(req.file.path, () => {});
        throw e;
      }
      if (!reserved.ok) {
        fs.unlink(req.file.path, () => {});
        return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
      }

      let created;
      try {
        created = await MessageAttachment.create({
          message_id: msg.id,
          file_name: decodeOriginalName(req.file.originalname),
          file_path: path.relative(path.join(__dirname, '..'), req.file.path),
          file_size: req.file.size,
          mime_type: req.file.mimetype || null,
          storage_provider: 'planq',
        });
      } catch (e) {
        // 레코드 생성 실패 → 예약분 반환 + 임시파일 정리(집계 정합 유지).
        await releasePlanqUpload(attachBizId, req.file.size).catch(() => {});
        fs.unlink(req.file.path, () => {});
        throw e;
      }

      // Socket.IO broadcast: 같은 대화방에 첨부 알림
      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${req._conversation.id}`).emit('message:attachment', {
          message_id: msg.id,
          attachment: serializeMessageAttachment(created),
        });
      }

      // ★ 미리보기 URL 을 처음부터 같이 준다 — 프론트가 id 로 URL 을 조립하면
      //   무인증·순차 id 경로가 되살아난다(services/filePreview 주석 참조).
      successResponse(res, serializeMessageAttachment(created), 'Attachment uploaded', 201);
    } catch (err) { next(err); }
  }
);

// ─── POST link existing file (사이클 O4) ───
// 워크스페이스에 이미 있는 File 을 메시지 첨부로 link. 물리적 재업로드 없음 (dedup).
router.post('/:conversationId/:messageId/link-existing',
  authenticateToken,
  async (req, res, next) => {
    try { if (!(await loadConversationAndGuard(req, res))) return; next(); }
    catch (err) { next(err); }
  },
  async (req, res, next) => {
    try {
      const { file_id } = req.body || {};
      if (!file_id) return errorResponse(res, 'file_id_required', 400);

      const msg = await Message.findOne({
        where: { id: req.params.messageId, conversation_id: req._conversation.id },
      });
      if (!msg) return errorResponse(res, 'message_not_found', 404);
      if (msg.sender_id !== req.user.id) return errorResponse(res, 'forbidden', 403);

      const file = await FileModel.findOne({
        where: { id: file_id, business_id: req._conversation.business_id }
      });
      if (!file) return errorResponse(res, 'file_not_found', 404);

      // file_path 를 항상 backend 루트 기준 상대경로로 정규화.
      // routes/files.js 는 절대경로(req.file.path)로 저장. /raw·/public 의 path.join(__dirname, '..', X)
      // 이 절대경로면 잘못된 결과 → 이미지 깨짐. 여기서 한 번 정규화해서 일관성 유지.
      const backendRoot = path.join(__dirname, '..');
      const relPath = path.isAbsolute(file.file_path)
        ? path.relative(backendRoot, file.file_path)
        : file.file_path;

      const created = await MessageAttachment.create({
        message_id: msg.id,
        file_name: file.file_name,
        file_path: relPath,
        file_size: file.file_size,
        mime_type: file.mime_type,
        storage_provider: file.storage_provider || 'planq',
        external_id: file.external_id || null,
        external_url: file.external_url || null,
        file_id: file.id,
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${req._conversation.id}`).emit('message:attachment', {
          message_id: msg.id,
          attachment: serializeMessageAttachment(created),
        });
      }

      successResponse(res, serializeMessageAttachment(created), 'Existing file linked', 201);
    } catch (err) { next(err); }
  }
);

// ─── GET download — 인증 필수, 모든 MIME ───
router.get('/:id/download', authenticateToken, async (req, res, next) => {
  try {
    const att = await MessageAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'not_found', 404);
    const msg = await Message.findByPk(att.message_id);
    if (!msg) return errorResponse(res, 'not_found', 404);
    const conv = await Conversation.findByPk(msg.conversation_id);
    if (!conv) return errorResponse(res, 'not_found', 404);

    // 권한 검증 — access_scope 위임 (member OR participant OR matching client_id)
    const allowed = await canAccessConversation(req.user.id, conv);
    if (!allowed) return errorResponse(res, 'forbidden', 403);

    const abs = path.isAbsolute(att.file_path) ? att.file_path : path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'file_missing', 404);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name)}`);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
});

// ─── GET /:id/raw — **삭제됨 (2026-08-20 보안)** ───
//   무인증 + 순차 정수 id 라 1,2,3… 열거만으로 **타 워크스페이스 채팅 이미지**가 열렸다
//   (Fable 이 통제 데이터로 크로스테넌트 실증: 다른 워크스페이스 대화방의 첨부를 토큰 없이 200 으로 획득).
//   planq 분기는 UUID 로 302 리다이렉트했는데, 그게 곧 **추측 불가능한 토큰을 순차 id 로 알려주는** 경로였다.
//   대체: 첨부 응답에 서버가 `preview_url` 을 계산해 담는다(services/filePreview.serializeMessageAttachment).
//   되살리지 말 것 — <img> 는 Authorization 헤더를 못 실으므로 인증을 붙일 수도 없다.

// ─── GET public — UUID 기반 공개 (image MIME only). ───
//   <img src> 가 가져갈 수 있는 최종 경로.
//   보안: image/* MIME 만 허용 (HTML/JS 임베딩으로 인한 XSS 차단), nosniff, inline.
router.get('/public/:storedName', async (req, res, next) => {
  try {
    const stored = String(req.params.storedName || '');
    // ★ 두 종류의 **추측 불가능한** 토큰을 받는다 (files.js public-image 와 같은 계약):
    //     · 로컬 저장분 — UUID 파일명 `xxxxxxxx-....png`
    //     · Drive 저장분 — Drive 파일 ID (점이 없다. file_path 에 이 ID 가 들어 있다)
    //   ★ 왜 `/:id/raw` 를 안 쓰는가: 그 경로는 **순차 정수 id + 무인증** 이라 1,2,3… 으로 훑을 수 있다
    //     (Fable 실측: 타 워크스페이스 채팅 이미지 열람 가능). 목록·미리보기는 전부 이 경로로 보낸다.
    const looksLocal = /^[a-z0-9-]+\.[a-z0-9]+$/i.test(stored);
    const looksDriveId = /^[A-Za-z0-9_-]{20,200}$/.test(stored);
    if (!looksLocal && !looksDriveId) return errorResponse(res, 'invalid_filename', 400);

    const { Op } = require('sequelize');
    // Drive 저장분의 정본 토큰은 **external_id** 다. file_path 에 Drive ID 를 넣던 옛 행이 있어
    //   폴백으로 같이 찾는다(그 행들은 external_id 가 비어 있다). services/filePreview 와 같은 규칙.
    const att = looksLocal
      ? await MessageAttachment.findOne({ where: { file_path: { [Op.like]: `%${stored}` }, storage_provider: 'planq' } })
        // ★ LIKE 는 **접미사** 매칭이라 `8.png` 같은 짧은 값으로도 아무 이미지가 걸린다.
        //   토큰이 파일명 전체와 정확히 같을 때만 인정한다(추측 불가능성이 이 경로의 유일한 방벽이다).
        .then((row) => (row && path.basename(row.file_path) === stored ? row : null))
      : await MessageAttachment.findOne({
          where: { storage_provider: 'gdrive', [Op.or]: [{ external_id: stored }, { file_path: stored }] },
        });
    if (!att) return errorResponse(res, 'not_found', 404);
    if (!require('../services/filePreview').isRenderableImage(att.mime_type)) {
      return errorResponse(res, 'not_public_image', 403);
    }

    // 저장소 단일 원천. Drive 는 서버가 워크스페이스 토큰으로 받아서 흘려준다.
    //   MessageAttachment 에는 business_id 가 없어 대화방을 거쳐 찾는다(‥/:id/raw 와 같은 경로).
    let businessId = null;
    if (att.storage_provider === 'gdrive') {
      const { Conversation } = require('../models');
      const msg = await Message.findByPk(att.message_id, { attributes: ['conversation_id'] });
      const conv = msg && await Conversation.findByPk(msg.conversation_id, { attributes: ['business_id'] });
      if (!conv) return errorResponse(res, 'conversation_not_found', 404);
      businessId = conv.business_id;
    }
    const body = await require('../services/attachmentStorage').readAttachmentBody({
      storage_provider: att.storage_provider,
      file_path: att.file_path,
      external_id: att.external_id || att.file_path,   // 정본은 external_id, 옛 행은 file_path 에 Drive ID
      business_id: businessId,
    });
    if (!body.ok) return errorResponse(res, body.msg, body.code);
    if (body.redirect) return res.redirect(body.redirect);
    // ?w= 리사이즈는 로컬 파일일 때만 (Drive 스트림은 원본 그대로)
    if (body.abs && await require('../services/imageResize').maybeServeResized(req, res, body.abs, att.mime_type)) return;

    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    body.stream.on('error', (e) => {
      console.error('[message_attachments] public image stream error:', e.message);
      if (!res.headersSent) errorResponse(res, 'stream_failed', 502);
      else res.destroy();
    });
    body.stream.pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
