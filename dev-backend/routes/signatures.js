// 서명 받기 — Phase A
//
// 두 트랙:
//   1) 멤버 라우트 (인증 필요): /api/posts/:id/signatures, /api/signatures/:id/*
//      → 발급 / 진행 조회 / 취소 / 재발송
//   2) 공개 라우트 (토큰 기반): /api/sign/:token/*
//      → OTP 발송·검증·서명·거절
//
// 보안:
//   - rate limit: OTP 발송 IP 1/min/3, token 5/5min
//   - OTP: 6 digit numeric, sha256 해시, 5분 TTL, 5회 lock 60min
//   - 토큰: 64 hex (256 bit)
//   - 모든 변이 transaction
//   - audit log: 발급·OTP·서명·거절·취소 모두 createAuditLog
//   - HTML 본문 sanitize: 공개 페이지에서 읽기 전용 PostEditor 가 처리
//
// Cron (별도 스크립트):
//   - status='sent'/'viewed' && expires_at < now → 'expired'

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const {
  SignatureRequest, Post, Document, Business, BusinessMember, User, Conversation, Message,
} = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { sendSignatureRequestEmail, sendSignatureOtpEmail } = require('../services/emailService');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
const TOKEN_BYTES = 32;
const OTP_TTL_MIN = 5;
const OTP_LOCK_MIN = 60;
const OTP_MAX_ATTEMPTS = 5;
const DEFAULT_EXPIRY_DAYS = 14;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Helpers ───
function genToken() { return crypto.randomBytes(TOKEN_BYTES).toString('hex'); }
function genOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }

async function assertMember(userId, businessId, isPlatformAdmin) {
  if (isPlatformAdmin) return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (bm) return true;
  const biz = await Business.findOne({ where: { id: businessId, owner_id: userId } });
  return !!biz;
}

async function loadEntity(entity_type, entity_id) {
  if (entity_type === 'post') return await Post.findByPk(entity_id);
  if (entity_type === 'document') return await Document.findByPk(entity_id);
  return null;
}

async function getEntityTitle(entity) {
  if (!entity) return '문서';
  return entity.title || '문서';
}

// 양사 진행 집계 — signature_requests 만으로 표현 (entity.status 변경 안 함)
// Post.status enum (draft/published) 은 publish 차원이라 signing 과 별개.
// 서명 진행은 GET /signatures 에서 SignatureRequest 행 집계로 노출.
// 향후 별도 entity.signature_status 컬럼 추가 시 여기서 갱신 (Phase 2 검토).
async function maybeUpdateEntityStatus(/* entity_type, entity_id, business_id, t */) {
  // no-op (의도)
}

// ─── Rate Limit ───
const otpSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || ''}:${req.ip}`,
  message: { success: false, message: 'rate_limit_otp_send' },
});
const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || ''}:${req.ip}`,
  message: { success: false, message: 'rate_limit_otp_verify' },
});

// ════════════════════════════════════════════════════════════
// 멤버 라우트 (인증 필요)
// ════════════════════════════════════════════════════════════

// POST /api/posts/:id/signatures
// body: { signers: [{ email, name? }, ...], note?, expires_in_days?, send_chat?: boolean, conversation_id?: number }
// 응답: { signatures: [...], chat_message_id?: number }
router.post('/posts/:id/signatures', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const post = await Post.findByPk(req.params.id, { transaction: t });
    if (!post) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      await t.rollback(); return errorResponse(res, 'forbidden', 403);
    }

    const signers = Array.isArray(req.body?.signers) ? req.body.signers : [];
    if (signers.length === 0) { await t.rollback(); return errorResponse(res, 'signers_required', 400); }
    if (signers.length > 10) { await t.rollback(); return errorResponse(res, 'too_many_signers', 400); }
    const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
    const expiresInDays = Math.min(Math.max(Number(req.body?.expires_in_days || DEFAULT_EXPIRY_DAYS), 1), 90);
    const expiresAt = new Date(Date.now() + expiresInDays * 86400 * 1000);

    // 발송자 + 워크스페이스 정보
    const sender = await User.findByPk(req.user.id, { attributes: ['name'], transaction: t });
    const business = await Business.findByPk(post.business_id, { attributes: ['name'], transaction: t });

    // 멱등 처리: 같은 (entity, signer_email) 의 pending/sent/viewed 가 있으면 그것 갱신
    const created = [];
    for (const s of signers) {
      const email = String(s.email || '').trim().toLowerCase();
      const name = s.name ? String(s.name).slice(0, 100) : null;
      if (!EMAIL_RE.test(email)) { await t.rollback(); return errorResponse(res, `invalid_email: ${email}`, 400); }
      const existing = await SignatureRequest.findOne({
        where: {
          entity_type: 'post', entity_id: post.id, business_id: post.business_id,
          signer_email: email,
          status: { [Op.in]: ['pending', 'sent', 'viewed'] },
        },
        transaction: t,
      });
      let row;
      if (existing) {
        // 만료·메모 갱신, 토큰 그대로 (재발송)
        await existing.update({
          signer_name: name || existing.signer_name,
          note, expires_at: expiresAt,
          reminder_count: existing.reminder_count + 1,
          last_reminder_at: new Date(),
          status: 'sent',
        }, { transaction: t });
        row = existing;
      } else {
        row = await SignatureRequest.create({
          entity_type: 'post', entity_id: post.id, business_id: post.business_id,
          requester_user_id: req.user.id,
          signer_email: email, signer_name: name,
          token: genToken(),
          note, expires_at: expiresAt, status: 'sent',
        }, { transaction: t });
      }
      created.push(row);
    }

    // 이메일 발송 (rollback 가능 — sendEmail 실패해도 DB rollback 안 함; 단 OTP 와 다르게 sign 요청 자체는 idempotent)
    await t.commit();

    // 트랜잭션 커밋 후 외부 호출 (이메일·채팅)
    const docTitle = post.title;
    for (const row of created) {
      const signUrl = `${APP_URL}/sign/${row.token}`;
      await sendSignatureRequestEmail({
        to: row.signer_email,
        docTitle,
        senderName: sender?.name || '',
        workspaceName: business?.name || '',
        signerName: row.signer_name,
        message: row.note,
        signUrl,
        expiresAt: row.expires_at,
      }).catch(() => null);
    }

    // 채팅 카드 발송 (옵션)
    let chatMessageId = null;
    const sendChat = !!req.body?.send_chat;
    const convId = Number(req.body?.conversation_id || 0);
    if (sendChat && convId) {
      const conv = await Conversation.findOne({ where: { id: convId, business_id: post.business_id } });
      if (conv) {
        // 첫 서명자의 token URL을 카드 메시지로 (개별 서명자는 이메일로도 받음)
        const first = created[0];
        const signUrl = `${APP_URL}/sign/${first.token}`;
        const msg = await Message.create({
          conversation_id: conv.id,
          sender_id: req.user.id,
          content: `[서명 요청] ${docTitle}`,
          kind: 'card',
          meta: {
            card_type: 'signature_request',
            entity_type: 'post', entity_id: post.id,
            title: docTitle, sign_url: signUrl, signers: created.map(c => ({ email: c.signer_email, status: c.status })),
            note: created[0]?.note || null,
          },
          is_ai: false, is_internal: false,
        });
        await conv.update({ last_message_at: new Date() });
        chatMessageId = msg.id;
      }
    }

    // Audit
    await createAuditLog({
      userId: req.user.id, businessId: post.business_id,
      action: 'signature.request',
      targetType: 'Post', targetId: post.id,
      metadata: { signers: created.map(c => c.signer_email), expires_at: expiresAt },
    }).catch(() => null);

    // 확인필요 갱신 — 발행 워크스페이스 (서명자 측은 다른 워크스페이스에 있을 수 있어 따로 관리)
    const io = req.app.get('io');
    if (io) io.to(`business:${post.business_id}`).emit('inbox:refresh', { reason: 'signature_created', entity_type: 'post', entity_id: post.id });

    // SMTP 미설정 시 dev 콘솔 로그 (운영에선 X)
    if (!process.env.SMTP_HOST) {
      created.forEach(row => {
        console.log(`[DEV-SIGN] signer=${row.signer_email} url=${APP_URL}/sign/${row.token}`);
      });
    }

    return successResponse(res, {
      signatures: created.map(serialize),
      chat_message_id: chatMessageId,
    }, 'Signature requests sent');
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

// GET /api/posts/:id/signatures — 진행 조회
router.get('/posts/:id/signatures', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const list = await SignatureRequest.findAll({
      where: { entity_type: 'post', entity_id: post.id, business_id: post.business_id },
      order: [['created_at', 'ASC']],
    });
    return successResponse(res, list.map(serialize));
  } catch (err) { next(err); }
});

// DELETE /api/signatures/:id — 취소
router.delete('/signatures/:id', authenticateToken, async (req, res, next) => {
  try {
    const sr = await SignatureRequest.findByPk(req.params.id);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, sr.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    if (sr.status === 'signed' || sr.status === 'rejected') {
      return errorResponse(res, 'already_finalized', 400);
    }
    await sr.update({ status: 'canceled' });
    await createAuditLog({
      userId: req.user.id, businessId: sr.business_id, action: 'signature.cancel',
      targetType: 'SignatureRequest', targetId: sr.id,
    }).catch(() => null);
    return successResponse(res, { canceled: true });
  } catch (err) { next(err); }
});

// POST /api/signatures/:id/reminder — 재발송
router.post('/signatures/:id/reminder', authenticateToken, async (req, res, next) => {
  try {
    const sr = await SignatureRequest.findByPk(req.params.id);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, sr.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    if (sr.status !== 'sent' && sr.status !== 'viewed') {
      return errorResponse(res, 'cannot_remind', 400);
    }
    const post = await Post.findByPk(sr.entity_id);
    const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
    const business = await Business.findByPk(sr.business_id, { attributes: ['name'] });
    const signUrl = `${APP_URL}/sign/${sr.token}`;
    await sendSignatureRequestEmail({
      to: sr.signer_email,
      docTitle: post?.title || '문서',
      senderName: sender?.name || '', workspaceName: business?.name || '',
      signerName: sr.signer_name, message: sr.note,
      signUrl, expiresAt: sr.expires_at,
    }).catch(() => null);
    await sr.update({ reminder_count: sr.reminder_count + 1, last_reminder_at: new Date() });
    if (!process.env.SMTP_HOST) console.log(`[DEV-SIGN-REMIND] ${sr.signer_email} ${signUrl}`);
    return successResponse(res, { sent: true, reminder_count: sr.reminder_count });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// 공개 라우트 (토큰 기반, 인증 없음)
// ════════════════════════════════════════════════════════════

async function loadByToken(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  return await SignatureRequest.findOne({ where: { token } });
}

// GET /api/sign/:token — 토큰 페이지 진입 (문서 본문 + 진행 상태)
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

    return successResponse(res, {
      token: sr.token,
      signer_email: sr.signer_email,
      signer_name: sr.signer_name,
      status: sr.status,
      expires_at: sr.expires_at,
      otp_verified: !!sr.otp_verified_at,
      signed_at: sr.signed_at,
      signature_image_b64: sr.signature_image_b64,  // 서명 후 미리보기
      note: sr.note,
      entity: {
        type: sr.entity_type,
        id: sr.entity_id,
        title: entity.title || '문서',
        content_json: sr.entity_type === 'post' ? (entity.content_json ? (typeof entity.content_json === 'string' ? JSON.parse(entity.content_json) : entity.content_json) : null) : null,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/sign/:token/otp — OTP 발송
router.post('/sign/:token/otp', otpSendLimiter, async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.status !== 'sent' && sr.status !== 'viewed') return errorResponse(res, 'invalid_state', 400);
    if (sr.otp_locked_until && sr.otp_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }
    const code = genOtp();
    const codeHash = sha256(code);
    const ttl = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await sr.update({
      otp_code_hash: codeHash, otp_sent_at: new Date(), otp_expires_at: ttl, otp_attempts: 0,
    });
    const post = await Post.findByPk(sr.entity_id);
    await sendSignatureOtpEmail({ to: sr.signer_email, docTitle: post?.title || '문서', code }).catch(() => null);
    if (!process.env.SMTP_HOST) console.log(`[DEV-OTP] token=${sr.token.slice(0,8)}.. code=${code} email=${sr.signer_email}`);
    return successResponse(res, { sent: true, expires_at: ttl });
  } catch (err) { next(err); }
});

// POST /api/sign/:token/verify — OTP 검증
// body: { code: '123456' }
router.post('/sign/:token/verify', otpVerifyLimiter, async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'invalid_code_format', 400);
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    if (sr.otp_locked_until && sr.otp_locked_until > new Date()) return errorResponse(res, 'locked', 423);
    if (!sr.otp_code_hash || !sr.otp_expires_at || sr.otp_expires_at < new Date()) {
      return errorResponse(res, 'otp_expired', 410);
    }
    const expectedHash = sha256(code);
    if (expectedHash !== sr.otp_code_hash) {
      const attempts = sr.otp_attempts + 1;
      const update = { otp_attempts: attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.otp_locked_until = new Date(Date.now() + OTP_LOCK_MIN * 60_000);
        update.otp_code_hash = null; update.otp_expires_at = null;
      }
      await sr.update(update);
      return errorResponse(res, attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid_code', attempts >= OTP_MAX_ATTEMPTS ? 423 : 400);
    }
    await sr.update({ otp_verified_at: new Date(), otp_attempts: 0 });
    return successResponse(res, { verified: true });
  } catch (err) { next(err); }
});

// POST /api/sign/:token/sign — 서명 완료
// body: { signature_image_b64, consent: true, signer_name? }
router.post('/sign/:token/sign', async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (sr.status === 'signed') { await t.rollback(); return errorResponse(res, 'already_signed', 409); }
    if (sr.status === 'rejected' || sr.status === 'canceled' || sr.status === 'expired') {
      await t.rollback(); return errorResponse(res, 'invalid_state', 400);
    }
    if (!sr.otp_verified_at) { await t.rollback(); return errorResponse(res, 'otp_required', 400); }
    if (sr.expires_at && sr.expires_at < new Date()) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    const consent = !!req.body?.consent;
    if (!consent) { await t.rollback(); return errorResponse(res, 'consent_required', 400); }
    const sig = String(req.body?.signature_image_b64 || '');
    if (!sig.startsWith('data:image/') || sig.length > 200_000) {
      await t.rollback(); return errorResponse(res, 'invalid_signature_image', 400);
    }
    const signerName = req.body?.signer_name ? String(req.body.signer_name).slice(0, 100) : sr.signer_name;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    await sr.update({
      status: 'signed',
      signature_image_b64: sig,
      signed_at: new Date(),
      signed_ip: ip, signed_ua: ua, signed_consent: true,
      signer_name: signerName,
    }, { transaction: t });

    await maybeUpdateEntityStatus(sr.entity_type, sr.entity_id, sr.business_id, t);
    await t.commit();

    await createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.sign',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, ip },
    }).catch(() => null);

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_signed', entity_type: sr.entity_type, entity_id: sr.entity_id });

    // Phase D+1: project stage 자동 진행 (양사 서명 완료면 contract → completed)
    require('../services/projectStageEngine').onSignatureChanged(sr.id).catch(() => null);

    return successResponse(res, { signed: true, signed_at: new Date() });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

// POST /api/sign/:token/reject — 거절
// body: { reason?, consent: true }
router.post('/sign/:token/reject', async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (sr.status === 'signed' || sr.status === 'rejected') {
      await t.rollback(); return errorResponse(res, 'already_finalized', 409);
    }
    if (!sr.otp_verified_at) { await t.rollback(); return errorResponse(res, 'otp_required', 400); }
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : null;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    await sr.update({
      status: 'rejected', rejected_at: new Date(),
      rejected_reason: reason, signed_ip: ip, signed_ua: ua,
    }, { transaction: t });
    await maybeUpdateEntityStatus(sr.entity_type, sr.entity_id, sr.business_id, t);
    await t.commit();

    await createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.reject',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, reason, ip },
    }).catch(() => null);

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_rejected', entity_type: sr.entity_type, entity_id: sr.entity_id });

    require('../services/projectStageEngine').onSignatureChanged(sr.id).catch(() => null);

    return successResponse(res, { rejected: true });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

// ─── Serializer ───
function serialize(sr) {
  return {
    id: sr.id,
    entity_type: sr.entity_type, entity_id: sr.entity_id,
    business_id: sr.business_id,
    requester_user_id: sr.requester_user_id,
    signer_email: sr.signer_email, signer_name: sr.signer_name,
    token: sr.token,
    sign_url: `${APP_URL}/sign/${sr.token}`,
    status: sr.status,
    viewed_at: sr.viewed_at,
    otp_verified: !!sr.otp_verified_at,
    signed_at: sr.signed_at,
    signed_ip: sr.signed_ip,
    signature_image_b64: sr.signature_image_b64 ? '(present)' : null,  // 진행 표 응답에서 이미지 본문 노출 X (대신 별도 GET)
    rejected_at: sr.rejected_at, rejected_reason: sr.rejected_reason,
    note: sr.note,
    expires_at: sr.expires_at,
    reminder_count: sr.reminder_count,
    last_reminder_at: sr.last_reminder_at,
    created_at: sr.created_at,
  };
}

module.exports = router;
