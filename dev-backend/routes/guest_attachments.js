// routes/guest_attachments.js — 게스트(로그인 없는 링크)의 첨부 (docs/GUEST_UPLOAD_DESIGN.md · Fable DESIGN: READY 2026-11-12)
//
//   POST /api/guest/:token/messages/upload          — 사진·PDF 보내기(메시지 + 첨부를 한 요청에서)
//   GET  /api/guest/:token/attachments/:attId/preview — 그 방의 보이는 그림 미리보기(webp 줄인 것만)
//
// ★ 무인증 표면이다. 토큰 해석·한도 키는 guest_common 한 벌(attachGuest·guestLimiter·requireRoom).
// ★ 못 찾겠으면 전부 404 — 403 은 «그 토큰은 있다» 를 흘린다(쓰기 금지 링크의 read_only_link 403 은 텍스트 라우트와 같은 기존 계약).
// ★ 게스트에게 영구 공개 주소(/api/message-attachments/public/<uuid>)를 절대 주지 않는다 — 링크를 회수해도 안 닫힌다.
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter, attachGuest, requireRoom } = require('./guest_common');
const { GUEST_ATTACHMENT_EXT } = require('../services/uploadPolicy');
const { guestAttachmentPreviewable, serializeGuestAttachment } = require('../services/guestAttachment');

const router = express.Router();

const MAX_BYTES = 10 * 1024 * 1024;   // 파일당 (플랜 한도가 더 작으면 그쪽)
const MAX_FILES = 3;                  // 한 번에
const LINK_CAP_COUNT = 100;           // 링크(그림자 User)가 그 방에 올린 누적
const LINK_CAP_BYTES = 300 * 1024 * 1024;
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const uploadEnabled = () => process.env.GUEST_UPLOAD_ENABLED !== 'false';

/** GET /api/guest/:token 의 `upload` 칸 — 화면은 이 값만 쓴다. */
function uploadInfo(guest) {
  const enabled = !!(guest && guest.conversation && guest.link && guest.link.can_write && uploadEnabled());
  return { enabled, max_bytes: MAX_BYTES, max_files: MAX_FILES, accept: [...GUEST_ATTACHMENT_EXT] };
}

// 토큰을 바꿔 가며 두드리는 것 대비 — IP 키(trust proxy 로 본 req.ip)
const ipLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `guest-upload-ip-${ipKeyGenerator(req.ip)}`,   // IPv6 는 /56 묶음으로(우회 막기)
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'too_many_requests' },
});

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const ym = new Date().toISOString().slice(0, 7);
    const dir = path.join(UPLOAD_ROOT, String(req.guest.link.business_id), ym);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: MAX_FILES, fields: 4, fieldSize: 20 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!GUEST_ATTACHMENT_EXT.has(path.extname(file.originalname).toLowerCase())) return cb(new Error('invalid_file'));
    cb(null, true);
  },
});

const unlinkAll = (files) => { for (const f of files || []) fs.unlink(f.path, () => {}); };

// 링크 누적 — 그림자 User 가 그 방에 올린 첨부 수·크기
async function linkUsage(guest) {
  const { sequelize } = require('../config/database');
  const [[row]] = await sequelize.query(
    `SELECT COUNT(ma.id) AS n, COALESCE(SUM(ma.file_size), 0) AS bytes
       FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
      WHERE m.sender_id = :uid AND m.conversation_id = :cid`,
    { replacements: { uid: guest.guestUser.id, cid: guest.conversation.id } });
  return { count: Number(row.n || 0), bytes: Number(row.bytes || 0) };
}

// ── POST /api/guest/:token/messages/upload ─────────────────────────────────
// audit-exempt: 게스트(무인증) 글쓰기 — 텍스트 라우트(guest.js POST /:token/messages)와 같은 계약. 사람 계정이 없고, 이력은 메시지 행·링크 message_count·last_used 가 남긴다
router.post('/:token/messages/upload',
  guestLimiter('guest-upload', { windowMs: 60 * 1000, max: 5 }),
  guestLimiter('guest-upload-h', { windowMs: 60 * 60 * 1000, max: 30 }),
  ipLimiter,
  attachGuest, requireRoom,
  async (req, res, next) => {
    try {
      if (!req.guest.link.can_write) return errorResponse(res, 'read_only_link', 403);
      if (!uploadEnabled()) return errorResponse(res, 'not_found', 404);
      // 파싱 전에 큰 요청을 거절한다(디스크에 쓰기 전)
      const len = Number(req.headers['content-length'] || 0);
      if (len > MAX_FILES * MAX_BYTES + 1024 * 1024) return errorResponse(res, 'file_too_large', 413);
      const u = await linkUsage(req.guest);
      if (u.count >= LINK_CAP_COUNT || u.bytes >= LINK_CAP_BYTES) return errorResponse(res, 'guest_upload_cap', 429);
      req._guestUsage = u;
      next();
    } catch (err) { next(err); }
  },
  (req, res, next) => {
    upload.array('files', MAX_FILES)(req, res, (err) => {
      if (!err) return next();
      unlinkAll(req.files);
      if (err.message === 'invalid_file') return errorResponse(res, 'invalid_file', 400);
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'file_too_large', 413);
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return errorResponse(res, 'too_many_files', 400);
      return errorResponse(res, 'invalid_file', 400);
    });
  },
  async (req, res, next) => {
    const files = req.files || [];
    const bizId = req.guest.link.business_id;
    const reserved = [];   // 예약한 크기 — 실패하면 돌려준다
    const fail = async (msg, code) => {
      unlinkAll(files);
      const { releasePlanqUpload } = require('../services/storageUsage');
      for (const sz of reserved) await releasePlanqUpload(bizId, sz).catch(() => {});
      return errorResponse(res, msg, code);
    };
    try {
      const { createGuestMessage, cleanGuestContent, cleanGuestName } = require('../services/guestMessage');
      const raw = String(req.body?.content || '').trim();
      if (raw.length > 4000) return fail('content_too_long', 400);
      const content = cleanGuestContent(raw);
      if (!files.length && !content) return fail('content_required', 400);
      if (!files.length) return fail('file_required', 400);   // 글만이면 텍스트 라우트로
      const nm = cleanGuestName(req.body?.guest_name);
      if (nm.error) return fail(nm.error, 400);
      // 누적 한도 — 이번 묶음까지 더해서
      const addBytes = files.reduce((n, f) => n + f.size, 0);
      const u = req._guestUsage;
      if (u.count + files.length > LINK_CAP_COUNT || u.bytes + addBytes > LINK_CAP_BYTES) return fail('guest_upload_cap', 429);

      // 내용 검사 — 매직바이트·sharp. mime 은 서버 판정값
      const { checkGuestFile, cleanGuestFileName } = require('../services/guestUploadCheck');
      const prepared = [];
      for (const f of files) {
        const chk = await checkGuestFile(f.path, f.originalname);
        if (!chk.ok) return fail('invalid_file', 400);
        prepared.push({
          file_name: cleanGuestFileName(f.originalname),
          file_path: path.relative(path.join(__dirname, '..'), f.path),
          file_size: f.size,
          mime_type: chk.mime,
        });
      }

      // 쿼터 — 주인은 워크스페이스(로그인 사용자 첨부와 같은 두 겹: 플랜 판정 + race-safe 예약)
      const plan = require('../services/plan');
      const { reservePlanqUpload } = require('../services/storageUsage');
      for (const f of files) {
        const can = await plan.can(bizId, 'upload_file', { size: f.size, external: false });
        if (!can.ok) return fail(can.reason === 'file_size_exceeded' ? 'file_too_large' : 'storage_full', 413);
        const r = await reservePlanqUpload(bizId, f.size);
        if (!r.ok) return fail('storage_full', 413);
        reserved.push(f.size);
      }

      let made;
      try {
        made = await createGuestMessage({ guest: req.guest, content, guestName: nm.name, files: prepared, app: req.app });
      } catch (e) {
        await fail('upload_failed', 500);
        throw e;
      }
      return successResponse(res, {
        id: made.msg.id,
        created_at: made.msg.created_at,
        attachments: made.attachments.map(serializeGuestAttachment),
      }, 'sent', 201);
    } catch (err) {
      if (!res.headersSent) { await fail('upload_failed', 500).catch(() => {}); }
      next(err);
    }
  });

// ── GET /api/guest/:token/attachments/:attId/preview?w= ─────────────────────
//   그 링크의 방 · 안 지운 · 게스트에게 보이는 메시지의 그림만. webp 줄인 것만, 원본 폴백 없음.
//   판정이 캐시보다 먼저다(guest_project 파일 미리보기와 같은 계약).
const PREVIEW_CACHE_OPTS = { cacheControl: 'private, max-age=3600', disposition: 'inline; filename="preview"' };
router.get('/:token/attachments/:attId/preview',
  guestLimiter('guest-att-preview', { windowMs: 60 * 1000, max: 120 }), attachGuest, requireRoom, async (req, res, next) => {
    try {
      if (!/^\d{1,12}$/.test(String(req.params.attId))) return errorResponse(res, 'not_found', 404);
      const { MessageAttachment, Message } = require('../models');
      const att = await MessageAttachment.findOne({
        where: { id: Number(req.params.attId) },
        attributes: ['id', 'file_name', 'file_size', 'mime_type', 'file_path', 'storage_provider', 'external_id', 'message_id'],
        include: [{ model: Message, required: true,
          where: { conversation_id: req.guest.conversation.id, is_deleted: { [Op.not]: true } },
          attributes: ['id', 'is_deleted', 'is_internal', 'is_ai', 'ai_mode_used', 'ai_draft_approved'] }],
      });
      const { visibleToGuest } = require('../services/guest_link');
      if (!att || !visibleToGuest(att.Message.toJSON()) || !guestAttachmentPreviewable(att)) return errorResponse(res, 'not_found', 404);

      const imageResize = require('../services/imageResize');
      const { effectiveMimeType } = require('../services/filePreview');
      const mime = effectiveMimeType(att.mime_type, att.file_name);
      const rq = { query: { w: String(imageResize.snapPreviewWidth(req.query.w)) } };
      const cacheId = `guest-att:${att.storage_provider || 'planq'}:${att.external_id || att.file_path}`;
      if (imageResize.serveCachedIfPresent(rq, res, mime, cacheId, PREVIEW_CACHE_OPTS)) return;
      const { readAttachmentBody } = require('../services/attachmentStorage');
      const body = await readAttachmentBody(att);
      if (!body || body.ok === false || body.redirect) return errorResponse(res, 'not_found', 404);
      if (body.abs) {
        const served = await imageResize.maybeServeResized(rq, res, body.abs, mime, PREVIEW_CACHE_OPTS);
        if (!served && !res.headersSent) return errorResponse(res, 'not_found', 404);
        return;
      }
      if (!body.stream) return errorResponse(res, 'not_found', 404);
      const served = await imageResize.resizeStreamAndServe(rq, res, body.stream, mime, cacheId, PREVIEW_CACHE_OPTS);
      if (!served && !res.headersSent) return errorResponse(res, 'not_found', 404);
    } catch (err) { next(err); }
  });

module.exports = router;
module.exports.uploadInfo = uploadInfo;
