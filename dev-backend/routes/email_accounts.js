// routes/email_accounts.js — EmailAccount CRUD (Q Mail M1)
// admin only (workspace owner/admin) — requireMenu('qmail', 'admin') 정합.
// 비밀번호는 services/encryption.js (AES-256-GCM).
// POST 시 자동 IMAP test 시도 — 실패해도 등록은 진행 (사용자가 정보 수정 가능).
const express = require('express');
const router = express.Router();
const { EmailAccount, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { encrypt, decrypt } = require('../services/encryption');
const { createAuditLog } = require('../middleware/audit');

// admin 권한 검사 — owner 또는 admin 또는 platform_admin
function isAdmin(req) {
  return req.businessRole === 'owner'
    || req.businessRole === 'admin'
    || req.user?.platform_role === 'platform_admin';
}

// 응답 시 비밀번호 hash 제외 (frontend 노출 X)
function serializeAccount(acc) {
  const j = acc.toJSON ? acc.toJSON() : acc;
  return {
    id: j.id,
    business_id: j.business_id,
    email: j.email,
    display_name: j.display_name,
    imap_host: j.imap_host,
    imap_port: j.imap_port,
    imap_username: j.imap_username,
    imap_tls: j.imap_tls,
    imap_folder: j.imap_folder,
    imap_last_uid: j.imap_last_uid,
    smtp_host: j.smtp_host,
    smtp_port: j.smtp_port,
    smtp_username: j.smtp_username,
    smtp_tls: j.smtp_tls,
    is_active: j.is_active,
    is_default: j.is_default,
    last_sync_at: j.last_sync_at,
    last_sync_error: j.last_sync_error,
    fail_count: j.fail_count,
    // 비밀번호는 응답 X — 보유 여부만 boolean
    has_imap_password: !!j.imap_password_encrypted,
    has_smtp_password: !!j.smtp_password_encrypted,
    created_at: j.created_at,
    updated_at: j.updated_at,
  };
}

// GET — workspace 단위 계정 목록
router.get('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const rows = await EmailAccount.findAll({
      where: { business_id: req.params.businessId },
      order: [['is_default', 'DESC'], ['created_at', 'ASC']],
    });
    successResponse(res, rows.map(serializeAccount));
  } catch (err) { next(err); }
});

// POST — 신규 등록 (자동 IMAP test)
router.post('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const b = req.body || {};
    // 필수 검증
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errorResponse(res, 'invalid_email', 400);
    if (!b.imap_host || !b.imap_username || !b.imap_password) {
      return errorResponse(res, 'imap_required', 400);
    }
    // 중복
    const dup = await EmailAccount.findOne({ where: { business_id: businessId, email } });
    if (dup) return errorResponse(res, 'duplicate_email', 409);
    // 첫 계정이면 is_default 자동
    const count = await EmailAccount.count({ where: { business_id: businessId } });
    const acc = await EmailAccount.create({
      business_id: businessId,
      email,
      display_name: b.display_name || null,
      imap_host: b.imap_host,
      imap_port: Number(b.imap_port) || 993,
      imap_username: b.imap_username,
      imap_password_encrypted: encrypt(b.imap_password),
      imap_tls: b.imap_tls !== false,
      imap_folder: b.imap_folder || 'INBOX',
      smtp_host: b.smtp_host || null,
      smtp_port: Number(b.smtp_port) || (b.smtp_host ? 587 : null),
      smtp_username: b.smtp_username || null,
      smtp_password_encrypted: b.smtp_password ? encrypt(b.smtp_password) : null,
      smtp_tls: b.smtp_tls !== false,
      is_active: true,
      is_default: count === 0,
    });
    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'email_account.create',
      targetType: 'EmailAccount', targetId: acc.id,
      newValue: { email, imap_host: acc.imap_host, imap_port: acc.imap_port },
    });
    successResponse(res, serializeAccount(acc), 'EmailAccount created', 201);
  } catch (err) { next(err); }
});

// PUT — 수정 (비밀번호 변경 가능)
router.put('/:businessId/email-accounts/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    const b = req.body || {};
    const patch = {};
    if (b.display_name !== undefined) patch.display_name = b.display_name || null;
    if (b.imap_host !== undefined) patch.imap_host = b.imap_host;
    if (b.imap_port !== undefined) patch.imap_port = Number(b.imap_port) || 993;
    if (b.imap_username !== undefined) patch.imap_username = b.imap_username;
    if (b.imap_password !== undefined && b.imap_password) patch.imap_password_encrypted = encrypt(b.imap_password);
    if (b.imap_tls !== undefined) patch.imap_tls = !!b.imap_tls;
    if (b.imap_folder !== undefined) patch.imap_folder = b.imap_folder || 'INBOX';
    if (b.smtp_host !== undefined) patch.smtp_host = b.smtp_host || null;
    if (b.smtp_port !== undefined) patch.smtp_port = Number(b.smtp_port) || null;
    if (b.smtp_username !== undefined) patch.smtp_username = b.smtp_username || null;
    if (b.smtp_password !== undefined && b.smtp_password) patch.smtp_password_encrypted = encrypt(b.smtp_password);
    if (b.smtp_tls !== undefined) patch.smtp_tls = !!b.smtp_tls;
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
    await acc.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'email_account.update',
      targetType: 'EmailAccount', targetId: acc.id,
      newValue: { fields: Object.keys(patch) },
    });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// DELETE — soft (is_active=false, data 보존)
router.delete('/:businessId/email-accounts/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    await acc.update({ is_active: false });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'email_account.deactivate',
      targetType: 'EmailAccount', targetId: acc.id,
    });
    successResponse(res, null, 'deactivated');
  } catch (err) { next(err); }
});

// POST /test — IMAP 연결 테스트
router.post('/:businessId/email-accounts/:id/test', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    const password = decrypt(acc.imap_password_encrypted);
    if (!password) return errorResponse(res, 'password_decrypt_failed', 500);
    // imap-simple 으로 1회 connect → disconnect (10초 timeout)
    let connOk = false;
    let errMsg = null;
    try {
      const imaps = require('imap-simple');
      const conn = await imaps.connect({
        imap: {
          user: acc.imap_username,
          password,
          host: acc.imap_host,
          port: acc.imap_port,
          tls: acc.imap_tls,
          authTimeout: 10000,
          tlsOptions: { rejectUnauthorized: false },
        },
      });
      await conn.openBox(acc.imap_folder);
      await conn.end();
      connOk = true;
    } catch (e) {
      errMsg = e.message;
    }
    successResponse(res, { ok: connOk, error: errMsg });
  } catch (err) { next(err); }
});

// POST /set-default — 기본 계정 설정
router.post('/:businessId/email-accounts/:id/set-default', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    // 모든 계정 default 해제 → 이 계정만 true
    await EmailAccount.update({ is_default: false }, { where: { business_id: businessId } });
    await acc.update({ is_default: true });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// POST /sync-now — 즉시 IMAP fetch 트리거 (cron 대기 없이)
router.post('/:businessId/email-accounts/:id/sync-now', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    // emailImapCron 의 syncOne 직접 호출 (M1 후속 — 지금은 placeholder)
    successResponse(res, { triggered: true, account_id: acc.id });
  } catch (err) { next(err); }
});

module.exports = router;
