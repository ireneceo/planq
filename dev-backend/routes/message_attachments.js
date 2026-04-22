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
const { Conversation, Message, MessageAttachment, BusinessMember, ConversationParticipant } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.txt', '.md', '.csv',
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
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (플랜별 상위 검증)
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('disallowed_extension'));
    cb(null, true);
  },
});

async function loadConversationAndGuard(req, res) {
  const conv = await Conversation.findByPk(req.params.conversationId);
  if (!conv) { errorResponse(res, 'conversation_not_found', 404); return null; }
  const businessId = conv.business_id;
  const isMember = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
  let allowed = !!isMember;
  if (!allowed) {
    const participant = await ConversationParticipant.findOne({
      where: { conversation_id: conv.id, user_id: req.user.id },
    });
    allowed = !!participant;
  }
  if (!allowed) { errorResponse(res, 'forbidden', 403); return null; }
  req._conversation = conv;
  return conv;
}

// ─── POST upload ───
router.post('/:conversationId/:messageId',
  authenticateToken,
  async (req, res, next) => {
    try { if (!(await loadConversationAndGuard(req, res))) return; next(); }
    catch (err) { next(err); }
  },
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.message === 'disallowed_extension') return errorResponse(res, 'disallowed_extension', 400);
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'file_too_large', 400);
      return errorResponse(res, err.message || 'upload_failed', 400);
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

      // 플랜별 업로드 크기 한도 (간단 체크)
      try {
        const plan = require('../services/plan');
        const limit = await plan.fileSizeLimit(req._conversation.business_id);
        if (limit && req.file.size > limit) {
          fs.unlink(req.file.path, () => {});
          return errorResponse(res, `file_too_large_plan (limit=${Math.round(limit / 1024 / 1024)}MB)`, 413);
        }
      } catch { /* plan 조회 실패 시 관대 통과 */ }

      const created = await MessageAttachment.create({
        message_id: msg.id,
        file_name: req.file.originalname,
        file_path: path.relative(path.join(__dirname, '..'), req.file.path),
        file_size: req.file.size,
        mime_type: req.file.mimetype || null,
        storage_provider: 'planq',
      });

      // Socket.IO broadcast: 같은 대화방에 첨부 알림
      const io = req.app.get('io');
      if (io) {
        io.to(`conversation:${req._conversation.id}`).emit('message:attachment', {
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

// ─── GET download / preview ───
router.get('/:id/download', authenticateToken, async (req, res, next) => {
  try {
    const att = await MessageAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'not_found', 404);
    const msg = await Message.findByPk(att.message_id);
    if (!msg) return errorResponse(res, 'not_found', 404);
    const conv = await Conversation.findByPk(msg.conversation_id);
    if (!conv) return errorResponse(res, 'not_found', 404);

    // 권한 검증
    const isMember = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: conv.business_id } });
    let allowed = !!isMember;
    if (!allowed) {
      const participant = await ConversationParticipant.findOne({
        where: { conversation_id: conv.id, user_id: req.user.id },
      });
      allowed = !!participant;
    }
    if (!allowed) return errorResponse(res, 'forbidden', 403);

    const abs = path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'file_missing', 404);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name)}`);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
