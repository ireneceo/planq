// routes/external_connections.js — Phase 1 통합 외부 연동 API
//
// 두 endpoint:
// 1. /api/businesses/:bizId/external-connections — 워크스페이스 (admin only)
// 2. /api/me/external-connections — 개인 (본인만)
//
// Phase 1 — read/list 위주. OAuth initiate/callback 은 옛 라우트 (cloud.js / email_accounts.js) 유지.
// Phase 2~5 에서 신규 endpoint 추가.
//
// 옛 데이터 union — Phase 1 UI 가 옛 business_cloud_tokens / email_accounts 도 같이 표시:
//   GET /me/external-connections — 본인 user_id 의 external_connections 만 (Phase 1 에서는 비어있음)
//   GET /businesses/:bizId/external-connections?include_legacy=true — business_cloud_tokens + email_accounts union
const express = require('express');
const router = express.Router();
const {
  ExternalConnection, BusinessCloudToken, EmailAccount, BusinessMember, Business,
} = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

function isAdminRole(req) {
  return req.businessRole === 'owner'
    || req.businessRole === 'admin'
    || req.user?.platform_role === 'platform_admin';
}

// 응답 sanitize — 비밀번호/토큰 hash 노출 차단
function sanitize(row) {
  const j = row.toJSON ? row.toJSON() : row;
  delete j.access_token_encrypted;
  delete j.refresh_token_encrypted;
  delete j.password_encrypted;
  return {
    ...j,
    has_access_token: !!j.access_token_encrypted,
    has_refresh_token: !!j.refresh_token_encrypted,
    has_password: !!j.password_encrypted,
  };
}

// 옛 BusinessCloudToken → ExternalConnection-like shape
function adaptLegacyCloudToken(row) {
  const providerMap = { gdrive: 'google_drive', gcal: 'google_calendar' };
  return {
    id: `legacy-cloud-${row.id}`,
    owner_scope: 'workspace',
    business_id: row.business_id,
    user_id: null,
    provider: providerMap[row.provider] || row.provider,
    auth_type: 'oauth',
    account_email: row.account_email,
    account_name: null,
    is_active: true,
    is_default: true,
    last_sync_at: null,
    scope: row.scope,
    metadata: { root_folder_id: row.root_folder_id, connected_by: row.connected_by },
    created_at: row.connected_at,
    updated_at: row.updated_at || row.connected_at,
    _legacy_source: 'business_cloud_tokens',
  };
}

// 옛 EmailAccount → ExternalConnection-like
function adaptLegacyEmailAccount(row) {
  const providerMap = { google_oauth: 'gmail', password: 'gmail', microsoft_oauth: 'outlook' };
  return {
    id: `legacy-email-${row.id}`,
    owner_scope: 'workspace',  // 옛 EmailAccount 는 항상 workspace
    business_id: row.business_id,
    user_id: null,
    provider: providerMap[row.auth_type] || 'gmail',
    auth_type: row.auth_type === 'google_oauth' ? 'oauth' : 'password',
    account_email: row.email,
    account_name: row.display_name,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    is_active: row.is_active,
    is_default: row.is_default,
    last_sync_at: row.last_sync_at,
    last_sync_error: row.last_sync_error,
    fail_count: row.fail_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    _legacy_source: 'email_accounts',
  };
}

// ─── 워크스페이스 — admin only ─────────────────────
// GET /api/businesses/:bizId/external-connections?include_legacy=true
router.get('/businesses/:businessId/external-connections', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdminRole(req)) return errorResponse(res, 'admin_required', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const rows = await ExternalConnection.findAll({
      where: { business_id: businessId, owner_scope: 'workspace' },
      order: [['created_at', 'DESC']],
    });
    const result = rows.map(sanitize);
    // 옛 데이터 union (Phase 1 — UI 통합 표시)
    if (req.query.include_legacy === 'true') {
      const cloudTokens = await BusinessCloudToken.findAll({ where: { business_id: businessId } });
      const emailAccounts = await EmailAccount.findAll({ where: { business_id: businessId } });
      result.push(...cloudTokens.map(adaptLegacyCloudToken));
      result.push(...emailAccounts.map(adaptLegacyEmailAccount));
    }
    successResponse(res, result);
  } catch (err) { next(err); }
});

// ─── 개인 — 본인만 ────────────────────────────────
// GET /api/me/external-connections?business_id=:id
router.get('/me/external-connections', authenticateToken, async (req, res, next) => {
  try {
    const where = { user_id: req.user.id, owner_scope: 'user' };
    if (req.query.business_id) {
      const bizId = parseInt(req.query.business_id, 10);
      // 멤버십 검증
      const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId } });
      if (!bm && req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'no_business_access', 403);
      }
      where.business_id = bizId;
    }
    const rows = await ExternalConnection.findAll({ where, order: [['created_at', 'DESC']] });
    successResponse(res, rows.map(sanitize));
  } catch (err) { next(err); }
});

// POST /api/me/external-connections — 개인 연결 신규 (수동 — OAuth 는 별도 endpoint)
// body: { provider, business_id, account_email, ... }
router.post('/me/external-connections', authenticateToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.business_id || !b.provider || !b.account_email) {
      return errorResponse(res, 'missing_required', 400);
    }
    const bizId = parseInt(b.business_id, 10);
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'no_business_access', 403);
    }
    // 중복 검사
    const dup = await ExternalConnection.findOne({
      where: {
        owner_scope: 'user', business_id: bizId, user_id: req.user.id,
        provider: b.provider, account_email: b.account_email,
      },
    });
    if (dup) return errorResponse(res, 'duplicate', 409);
    const conn = await ExternalConnection.create({
      owner_scope: 'user',
      business_id: bizId,
      user_id: req.user.id,
      provider: b.provider,
      auth_type: b.auth_type || 'oauth',
      account_email: b.account_email,
      account_name: b.account_name || null,
      imap_host: b.imap_host || null,
      imap_port: b.imap_port || null,
      smtp_host: b.smtp_host || null,
      smtp_port: b.smtp_port || null,
      is_active: true,
    });
    successResponse(res, sanitize(conn), 'connected', 201);
  } catch (err) { next(err); }
});

// DELETE /api/me/external-connections/:id — 본인 해제
router.delete('/me/external-connections/:id', authenticateToken, async (req, res, next) => {
  try {
    const conn = await ExternalConnection.findOne({
      where: { id: req.params.id, user_id: req.user.id, owner_scope: 'user' },
    });
    if (!conn) return errorResponse(res, 'not_found', 404);
    await conn.destroy();
    successResponse(res, null, 'disconnected');
  } catch (err) { next(err); }
});

module.exports = router;
