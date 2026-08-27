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
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');
const {
  SignatureRequest, Post, Document, Business, BusinessMember, User, Conversation, Message, Project,
  PostAttachment, File,
} = require('../models');
const { sequelize } = require('../config/database');
const { parseMaybeJson, buildEntitySnapshot, loadEntity, maybeUpdateEntityStatus } = require('../services/signatureCore');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { sendSignatureRequestEmail, sendSignatureOtpEmail } = require('../services/emailService');
// 서명·확인 공용 조각 (services/signatureCore.js). 판정을 두 벌로 두지 않기 위해 여기서만 가져온다.
const {
  loadByToken, confirmLimiter, docConfirmEnabled, assertKind,
  isExpiredNow, notifyWorkspaceMembersOnSignature,
} = require('../services/signatureCore');

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


async function getEntityTitle(entity) {
  if (!entity) return '문서';
  return entity.title || '문서';
}

// 양사 진행 집계 — signature_requests 만으로 표현 (entity.status 변경 안 함)
// Post.status enum (draft/published) 은 publish 차원이라 signing 과 별개.
// 서명 진행은 GET /signatures 에서 SignatureRequest 행 집계로 노출.
// 향후 별도 entity.signature_status 컬럼 추가 시 여기서 갱신 (Phase 2 검토).

/**
 * 서명 대상 동결 — "무엇에 서명하는가" 를 요청 생성 시점에 붙잡아 둔다 (2026-08-27).
 *
 * ★ 왜 필요한가: 서명 페이지는 열 때마다 문서의 **현재** 본문을 읽는다. 여태 그 상태로,
 *   서명 기록에는 누가·언제·어디서만 남고 **무엇에** 가 없었다. 서명 뒤 본문을 한 글자만 고쳐도
 *   그 서명이 무엇에 붙은 것인지 증명할 방법이 사라진다(운영 첫 실사용 직전 발견).
 *   본문은 전문을 남긴다 — 계약서는 재현이 곧 증거다. 첨부는 파일을 복제하지 않고
 *   files.content_hash 로 지문만 남긴다(파일은 스토리지에 그대로 있다).
 */
// ─── Rate Limit ───
const otpSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || ''}:${ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'rate_limit_otp_send' },
});
const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || ''}:${ipKeyGenerator(req.ip)}`,
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

    // #239 — 서명 요청(sign) vs 확인 요청(confirm). 모르는 값이면 sign 으로 떨어진다(fail-safe:
    //   기존 클라이언트가 kind 를 안 보내도 종전과 똑같이 동작).
    const kind = req.body?.kind === 'confirm' ? 'confirm' : 'sign';
    if (kind === 'confirm' && String(process.env.FEATURE_DOC_CONFIRM || 'on').toLowerCase() === 'off') {
      await t.rollback(); return errorResponse(res, 'feature_disabled', 503);
    }

    // 서명 대상 동결 — 서명자별로 같은 값이므로 루프 밖에서 한 번만 계산한다.
    const snapshot = await buildEntitySnapshot('post', post, t);

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
          // #239 — kind 를 조건에 넣는다. 같은 사람에게 서명 요청과 확인 요청을 각각 보낼 수 있어야
          //   하는데, 빼면 먼저 보낸 쪽이 재발송으로 덮어써져 한 종류만 존재하게 된다.
          kind,
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
          kind,
          note, expires_at: expiresAt, status: 'sent',
          // 서명 대상 동결 — 재발송(existing)에는 다시 찍지 않는다.
          //   이미 상대가 본 대상을 조용히 바꾸면 그게 더 큰 사고다.
          ...snapshot,
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
    createAuditLog({
      userId: req.user.id, businessId: post.business_id,
      action: 'signature.request',
      targetType: 'Post', targetId: post.id,
      metadata: { signers: created.map(c => c.signer_email), expires_at: expiresAt },
    });

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
    createAuditLog({
      userId: req.user.id, businessId: sr.business_id, action: 'signature.cancel',
      targetType: 'SignatureRequest', targetId: sr.id,
    });
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
// 받은 서명 archive — cross-workspace
// GET /api/signatures/received?status=&workspace=&q=&limit=&offset=
// signer_email = req.user.email 인 SignatureRequest 모두 (어느 워크스페이스든)
// ════════════════════════════════════════════════════════════
router.get('/signatures/received', authenticateToken, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const wsId = req.query.workspace ? Number(req.query.workspace) : null;
    const where = { signer_email: req.user.email };
    if (wsId) where.business_id = wsId;
    if (req.query.status && req.query.status !== 'all') {
      where.status = req.query.status;
    }
    const total = await SignatureRequest.count({ where });
    const rows = await SignatureRequest.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit, offset,
    });

    // entity title 보강 (Post 위주)
    const postIds = rows.filter(r => r.entity_type === 'post').map(r => r.entity_id);
    const posts = postIds.length > 0
      ? await Post.findAll({ where: { id: postIds }, attributes: ['id', 'title'] })
      : [];
    const titleMap = new Map(posts.map(p => [p.id, p.title]));

    // workspace 라벨 보강 (cross-workspace 구분용)
    const bizIds = Array.from(new Set(rows.map(r => r.business_id)));
    const bizs = bizIds.length > 0
      ? await Business.findAll({ where: { id: bizIds }, attributes: ['id', 'name', 'brand_name'] })
      : [];
    const bizMap = new Map(bizs.map(b => [b.id, b]));

    // 검색 (q): entity title 매칭 (단순 client-side 필터)
    let items = rows.map(s => ({
      ...serialize(s),
      entity_title: s.entity_type === 'post' ? (titleMap.get(s.entity_id) || '문서') : '문서',
      workspace: bizMap.get(s.business_id) ? {
        business_id: s.business_id,
        brand_name: bizMap.get(s.business_id).brand_name || bizMap.get(s.business_id).name,
        // 받는 입장이라 role 은 'client' 로 표시 (단 owner/member 가 자기에게 발송한 경우도 있을 수 있음 — 그 경우도 받는 시점은 동일)
        role: 'client',
      } : null,
    }));
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      items = items.filter(it => (it.entity_title || '').toLowerCase().includes(q));
    }

    // 워크스페이스 목록 (필터 UI 용 — 받은 적 있는 워크스페이스 모두)
    const allRowsForWs = await SignatureRequest.findAll({
      where: { signer_email: req.user.email },
      attributes: ['business_id'],
      group: ['business_id'],
    });
    const allBizIds = Array.from(new Set(allRowsForWs.map(r => r.business_id)));
    const allBizs = allBizIds.length > 0
      ? await Business.findAll({ where: { id: allBizIds }, attributes: ['id', 'name', 'brand_name'] })
      : [];
    const workspaces = allBizs.map(b => ({
      business_id: b.id,
      brand_name: b.brand_name || b.name,
      role: 'client',
    }));

    return successResponse(res, { items, total, workspaces });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════
// 공개 라우트 (토큰 기반, 인증 없음)
// ════════════════════════════════════════════════════════════

// GET /api/sign/:token — 토큰 페이지 진입 (문서 본문 + 진행 상태)
// POST /api/sign/:token/otp — OTP 발송
router.post('/sign/:token/otp', otpSendLimiter, async (req, res, next) => {
  try {
    const sr = await loadByToken(req.params.token);
    if (!sr) return errorResponse(res, 'not_found', 404);
    // #239 — 역방향 가드: 확인 요청(confirm)은 OTP 경로를 타지 않는다.
    if (!assertKind(sr, 'sign', res)) return;
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
    // 발송 실패를 삼키고 sent:true 반환하면 사용자는 오지 않는 코드를 무한정 기다린다(거짓 전송).
    //   운영(SMTP 有)에서 실패 시 502 로 알려 재시도/문의 유도. dev(SMTP 無)는 콘솔 코드로 대체.
    const otpSent = await sendSignatureOtpEmail({ to: sr.signer_email, docTitle: post?.title || '문서', code })
      .then(() => true).catch((e) => { console.error('[sig-otp] send failed:', e?.message); return false; });
    if (!process.env.SMTP_HOST) console.log(`[DEV-OTP] token=${sr.token.slice(0,8)}.. code=${code} email=${sr.signer_email}`);
    if (!otpSent && process.env.SMTP_HOST) return errorResponse(res, 'otp_send_failed', 502);
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
    // #239 — 역방향 가드 (위 /otp 와 같은 이유)
    if (!assertKind(sr, 'sign', res)) return;
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
    // #239 — 역방향 가드: 확인 요청(confirm)이 서명 경로로 들어오면 안 된다.
    if (!assertKind(sr, 'sign', res)) { await t.rollback(); return; }
    if (sr.status === 'signed') { await t.rollback(); return errorResponse(res, 'already_signed', 409); }
    if (isExpiredNow(sr)) { await t.rollback(); return errorResponse(res, 'expired', 410); }
    if (sr.status === 'rejected' || sr.status === 'canceled') {
      await t.rollback(); return errorResponse(res, 'invalid_state', 400);
    }
    if (!sr.otp_verified_at) { await t.rollback(); return errorResponse(res, 'otp_required', 400); }
    const consent = !!req.body?.consent;
    if (!consent) { await t.rollback(); return errorResponse(res, 'consent_required', 400); }
    const sig = String(req.body?.signature_image_b64 || '');
    if (!sig.startsWith('data:image/') || sig.length > 200_000) {
      await t.rollback(); return errorResponse(res, 'invalid_signature_image', 400);
    }
    const signerName = req.body?.signer_name ? String(req.body.signer_name).slice(0, 100) : sr.signer_name;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    // ★ 서명 시점 대조 (2026-08-27) — 서명자가 본 것(동결분)과 문서의 **현재** 상태가 같은지
    //   한 번 더 재고, 다르면 그 사실 자체를 증거로 남긴다. 막지는 않는다:
    //   서명자는 동결분을 보고 서명했고 그 동결분이 증거이므로, 서명을 거부할 이유가 아니라
    //   "요청 후 원본이 바뀌었다" 는 사실을 기록해야 할 사유다.
    let signedHash = sr.content_hash || null;
    let mismatch = false;
    try {
      const cur = await loadEntity(sr.entity_type, sr.entity_id);
      if (cur) {
        const now = await buildEntitySnapshot(sr.entity_type, cur, t);
        signedHash = now.content_hash;
        mismatch = !!(sr.content_hash && now.content_hash !== sr.content_hash);
      }
    } catch (e) { console.warn('[sign] snapshot 대조 실패', e.message); }

    await sr.update({
      status: 'signed',
      signature_image_b64: sig,
      signed_at: new Date(),
      signed_ip: ip, signed_ua: ua, signed_consent: true,
      signer_name: signerName,
      signed_content_hash: signedHash,
      snapshot_mismatch: mismatch,
    }, { transaction: t });

    await maybeUpdateEntityStatus(sr.entity_type, sr.entity_id, sr.business_id, t);
    await t.commit();

    createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.sign',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, ip, content_hash: sr.content_hash, snapshot_mismatch: mismatch },
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_signed', entity_type: sr.entity_type, entity_id: sr.entity_id });

    // Phase D+1: project stage 자동 진행 (양사 서명 완료면 contract → completed)
    require('../services/projectStageEngine').onSignatureChanged(sr.id).catch(() => null);

    // 멤버 알림 — 서명 완료
    notifyWorkspaceMembersOnSignature(sr, 'signed', signerName).catch((e) => console.warn('[notify signature signed]', e.message));

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
    // #239 — 역방향 가드: 확인 요청(confirm)이 서명 경로로 들어오면 안 된다.
    if (!assertKind(sr, 'sign', res)) { await t.rollback(); return; }
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

    createAuditLog({
      userId: null, businessId: sr.business_id, action: 'signature.reject',
      targetType: 'SignatureRequest', targetId: sr.id,
      metadata: { signer: sr.signer_email, reason, ip },
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${sr.business_id}`).emit('inbox:refresh', { reason: 'signature_rejected', entity_type: sr.entity_type, entity_id: sr.entity_id });

    require('../services/projectStageEngine').onSignatureChanged(sr.id).catch(() => null);

    notifyWorkspaceMembersOnSignature(sr, 'rejected', sr.signer_name).catch((e) => console.warn('[notify signature rejected]', e.message));

    return successResponse(res, { rejected: true });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});
function serialize(sr) {
  return {
    id: sr.id,
    entity_type: sr.entity_type, entity_id: sr.entity_id,
    kind: sr.kind || 'sign',   // #239 — 화면이 "서명 요청" vs "확인 요청" 을 구분하는 근거
    business_id: sr.business_id,
    requester_user_id: sr.requester_user_id,
    signer_email: sr.signer_email, signer_name: sr.signer_name,
    token: sr.token,
    sign_url: `${APP_URL}/sign/${sr.token}`,
    status: sr.status,
    viewed_at: sr.viewed_at,
    confirmed_at: sr.confirmed_at,
    comment: sr.comment,
    comment_at: sr.comment_at,
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
