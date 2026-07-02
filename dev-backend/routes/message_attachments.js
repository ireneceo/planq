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
const { canAccessConversation } = require('../middleware/access_scope');
const { decodeOriginalName } = require('../services/filename');
const { perUserLimiter } = require('../middleware/costGuard');

// 비용폭탄 H3 — 업로드 per-user rate-limit (라우트 내부 적용. security.js 의 경로 패턴 방식은
//   실제 마운트 경로 불일치로 죽어 있었음 → 여기서 직접 건다). 분당 10회.
const attachUploadLimiter = perUserLimiter('msg-attach', { windowMs: 60 * 1000, max: 10, message: '파일 업로드가 너무 잦습니다. 잠시 후 다시 시도하세요.' });

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.txt', '.md', '.csv',
  // 영상 — Drive 연동 시 5GB 까지, 자체 스토리지 시 플랜 한도까지
  '.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v',
  // 음성
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
]);

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

      // 비용폭탄 H3 — Drive 미연동 시 자체 스토리지. 플랜 크기한도 + 총 쿼터 강제.
      //   옛 plan.fileSizeLimit 는 존재하지 않는 유령함수 → try/catch 에 먹혀 크기검사 자체가 죽어
      //   무제한 업로드(쿼터 미집계)되던 구멍. files.js 정석 패턴(plan.can('upload_file'))으로 복구.
      const plan = require('../services/plan');
      const { BusinessCloudToken, BusinessStorageUsage } = require('../models');
      const attachBizId = req._conversation.business_id;
      const cloudToken = await BusinessCloudToken.findOne({
        where: { business_id: attachBizId, provider: 'gdrive' },
      });
      const driveConnected = !!cloudToken && !!cloudToken.root_folder_id;
      const canUp = await plan.can(attachBizId, 'upload_file', { size: req.file.size, external: driveConnected });
      if (!canUp.ok) {
        fs.unlink(req.file.path, () => {});
        if (canUp.reason === 'file_size_exceeded') {
          const limitMB = Math.round((canUp.limit || 0) / 1024 / 1024);
          return errorResponse(res, `파일이 너무 큽니다. 현재 플랜에서 ${limitMB}MB 까지 가능 — 큰 파일은 Google Drive 를 연결해 주세요.`, 413);
        }
        return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
      }

      const created = await MessageAttachment.create({
        message_id: msg.id,
        file_name: decodeOriginalName(req.file.originalname),
        file_path: path.relative(path.join(__dirname, '..'), req.file.path),
        file_size: req.file.size,
        mime_type: req.file.mimetype || null,
        storage_provider: 'planq',
      });

      // 비용폭탄 H3 — 자체 스토리지 사용 시 워크스페이스 총 사용량 집계 (Drive 는 외부라 skip).
      if (!driveConnected) {
        try {
          await BusinessStorageUsage.findOrCreate({
            where: { business_id: attachBizId },
            defaults: { business_id: attachBizId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
          });
          await BusinessStorageUsage.increment({ bytes_used: req.file.size, file_count: 1 }, { where: { business_id: attachBizId } });
        } catch (e) { console.warn('[msg-attach] usage increment failed', e.message); }
      }

      // Socket.IO broadcast: 같은 대화방에 첨부 알림
      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${req._conversation.id}`).emit('message:attachment', {
          message_id: msg.id,
          attachment: {
            id: created.id,
            file_name: created.file_name,
            file_size: created.file_size,
            mime_type: created.mime_type,
          },
        });
      }

      successResponse(res, {
        id: created.id,
        message_id: created.message_id,
        file_name: created.file_name,
        file_size: created.file_size,
        mime_type: created.mime_type,
      }, 'Attachment uploaded', 201);
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
          attachment: {
            id: created.id, file_name: created.file_name, file_size: created.file_size,
            mime_type: created.mime_type, file_id: created.file_id,
          },
        });
      }

      successResponse(res, {
        id: created.id, message_id: created.message_id,
        file_name: created.file_name, file_size: created.file_size,
        mime_type: created.mime_type, file_id: created.file_id,
      }, 'Existing file linked', 201);
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

// ─── GET raw — <img src> 호환 (인증 헤더 못 실음). UUID stored_name 으로 redirect. ───
//   인증 X — id 노출 자체는 task_attachments 와 동일한 패턴.
//   /public/:storedName 이 image MIME only 게이트.
router.get('/:id/raw', async (req, res, next) => {
  try {
    const att = await MessageAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'not_found', 404);

    // 사이클 N+16-E — storage_provider 별 분기.
    //   planq (자체) — /public 으로 redirect (옛 동작).
    //   gdrive — 서버 프록시 (drive.file scope 로 PlanQ 가 만든 파일만 접근). file_path 가 Drive file_id.
    if (att.storage_provider === 'gdrive') {
      try {
        const gdrive = require('../services/gdrive');
        const { Conversation } = require('../models');
        const msg = await Message.findByPk(att.message_id, { attributes: ['conversation_id'] });
        if (!msg) return errorResponse(res, 'message_not_found', 404);
        const conv = await Conversation.findByPk(msg.conversation_id, { attributes: ['business_id'] });
        if (!conv) return errorResponse(res, 'conversation_not_found', 404);
        const token = await gdrive.getTokenForBusiness(conv.business_id);
        if (!token) return errorResponse(res, 'gdrive_token_missing', 410);
        const drive = await gdrive.getDriveClient(token);
        if (att.mime_type && att.mime_type.startsWith('image/')) {
          res.setHeader('Content-Type', att.mime_type);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Disposition', 'inline');
          res.setHeader('Cache-Control', 'private, max-age=3600');
          const stream = await gdrive.getFileStream(drive, att.file_path);
          return stream.pipe(res);
        }
        // 비이미지: drive 의 webViewLink 로 redirect (사용자가 클릭 다운로드)
        return res.redirect(302, att.external_url || '/');
      } catch (e) {
        console.error('[message-attachments] gdrive raw failed:', e.message);
        return errorResponse(res, 'gdrive_stream_failed', 502);
      }
    }

    const stored = path.basename(att.file_path);
    const w = parseInt(req.query.w, 10); // #97 — 리사이즈 파라미터 redirect 에 보존
    return res.redirect(302, `/api/message-attachments/public/${stored}${w > 0 ? `?w=${w}` : ''}`);
  } catch (err) { next(err); }
});

// ─── GET public — UUID 기반 공개 (image MIME only). ───
//   <img src> 가 가져갈 수 있는 최종 경로.
//   보안: image/* MIME 만 허용 (HTML/JS 임베딩으로 인한 XSS 차단), nosniff, inline.
router.get('/public/:storedName', async (req, res, next) => {
  try {
    const stored = String(req.params.storedName || '');
    if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(stored)) {
      return errorResponse(res, 'invalid_filename', 400);
    }
    const att = await MessageAttachment.findOne({
      where: { file_path: { [require('sequelize').Op.like]: `%${stored}` } },
    });
    if (!att) return errorResponse(res, 'not_found', 404);
    if (!att.mime_type || !att.mime_type.startsWith('image/')) {
      return errorResponse(res, 'not_public_image', 403);
    }
    const abs = path.isAbsolute(att.file_path) ? att.file_path : path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'file_missing', 410);
    if (await require('../services/imageResize').maybeServeResized(req, res, abs, att.mime_type)) return; // #97 ?w= 리사이즈
    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
