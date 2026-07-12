// routes/email_accounts.js — EmailAccount CRUD (Q Mail M1)
// admin only (workspace owner/admin) — requireMenu('qmail', 'admin') 정합.
// 비밀번호는 services/encryption.js (AES-256-GCM).
// POST/PUT 시 IMAP 실연결 검증 강제 — 잘못된 자격이 조용히 등록되어 5분마다 실패하는 사고 차단.
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

// 이 사용자가 볼 수 있는 계정 where 조건:
//   회사 공용 계정 (owner_user_id NULL, 모든 멤버) + 본인 개인 계정 (owner_user_id = 나).
//   다른 사람의 개인 메일은 절대 노출 X (admin 도 차단 — email_threads.accessibleAccountIds 와 정합).
function accessibleWhere(req) {
  const { Op } = require('sequelize');
  return { [Op.or]: [{ owner_user_id: null }, { owner_user_id: req.user.id }] };
}

// 이 계정을 관리(편집/삭제/동기화)할 수 있는가:
//   회사 공용(owner null) → admin 만. 본인 개인(owner=나) → 본인. 그 외 → false.
function canManageAccount(req, acc) {
  if (acc.owner_user_id == null) return isAdmin(req);
  return acc.owner_user_id === req.user.id;
}

// 관리자 교정(remediation) — 남의 개인 계정으로 "잘못 등록된" 워크스페이스 자산을 바로잡는 경로.
//   실사례: 회사 대표 메일(help@)이 한 멤버의 개인 메일로 등록돼 회사 메일이 그 사람에게만 보였다.
//   프론트엔 admin 전용 "개인 ↔ 회사 공용 전환" 버튼이 있었지만, accessibleWhere 가 남의 개인 계정을
//   조회 단계에서 걸러 404 → 그 기능은 한 번도 동작한 적이 없다 (죽은 기능).
//   열어주는 범위는 최소 — 공용 전환(scope='team') 과 비활성화(is_active=false) 뿐:
//     · 자격증명(비밀번호·호스트·사용자명) 편집 불가 — 관리자가 남의 사서함을 가로챌 수 없다
//     · 남의 개인 계정을 자기 개인(scope='personal')으로 가져오는 것도 불가
//     · GET 목록은 그대로 — 누가 어떤 개인 메일을 연결했는지 노출하지 않는다
const ADMIN_REMEDIATION_FIELDS = ['scope', 'is_active'];

function isAdminRemediation(req, acc) {
  if (!acc || acc.owner_user_id == null) return false;   // 공용 계정은 기존 경로
  if (acc.owner_user_id === req.user.id) return false;   // 본인 것은 기존 경로
  if (!isAdmin(req)) return false;
  const keys = Object.keys(req.body || {});
  if (keys.length === 0) return false;
  if (!keys.every((k) => ADMIN_REMEDIATION_FIELDS.includes(k))) return false;
  if (req.body.scope !== undefined && req.body.scope !== 'team') return false;
  if (req.body.is_active !== undefined && req.body.is_active !== false) return false;
  return true;
}

// PUT/DELETE 공통 조회 — 기본은 본인 것 + 공용. 관리자 교정 요청이면 워크스페이스 전체에서 찾는다.
async function findAccountForMutation(req, { allowRemediation = true } = {}) {
  const base = { id: req.params.id, business_id: req.params.businessId };
  const own = await EmailAccount.findOne({ where: { ...base, ...accessibleWhere(req) } });
  if (own) return { acc: own, remediation: false };
  if (!allowRemediation) return { acc: null, remediation: false };
  const any = await EmailAccount.findOne({ where: base });
  if (!any || !isAdminRemediation(req, any)) return { acc: null, remediation: false };
  return { acc: any, remediation: true };
}

// IMAP 자격 실검증 — 등록/수정 전 강제. 실패 원인을 provider 별 안내 코드로 분류.
async function verifyImapCredentials({ host, port, tls, username, password, folder }) {
  try {
    const imaps = require('imap-simple');
    const conn = await imaps.connect({
      imap: { user: username, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } },
    });
    await conn.openBox(folder || 'INBOX');
    await conn.end();
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const h = String(host || '').toLowerCase();
    if (/invalid credentials|authenticat|login fail|auth/i.test(msg)) {
      if (h.includes('gmail') || h.includes('googlemail')) return { ok: false, code: 'gmail_app_password_required', detail: msg };
      if (h.includes('naver')) return { ok: false, code: 'naver_app_password_required', detail: msg };
      if (h.includes('office365') || h.includes('outlook')) return { ok: false, code: 'ms_app_password_required', detail: msg };
      return { ok: false, code: 'imap_auth_failed', detail: msg };
    }
    if (/enotfound|getaddrinfo/i.test(msg)) return { ok: false, code: 'imap_host_not_found', detail: msg };
    return { ok: false, code: 'imap_connect_failed', detail: msg };
  }
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
    owner_user_id: j.owner_user_id ?? null,
    is_personal: j.owner_user_id != null,
    scope: j.owner_user_id != null ? 'personal' : 'team',
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

// GET — 계정 목록 (회사 공용 + 본인 개인. 멤버도 접근 가능 — 개인 메일 관리 위해)
router.get('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const rows = await EmailAccount.findAll({
      where: { business_id: req.params.businessId, ...accessibleWhere(req) },
      order: [['owner_user_id', 'ASC'], ['is_default', 'DESC'], ['created_at', 'ASC']],
    });
    successResponse(res, rows.map(serializeAccount));
  } catch (err) { next(err); }
});

// POST — 신규 등록 (자동 IMAP test)
router.post('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const b = req.body || {};
    // scope: 'personal'(개인, 본인만) | 'team'(회사 공용, 모든 멤버). team 은 admin 만.
    const scope = b.scope === 'personal' ? 'personal' : 'team';
    if (scope === 'team' && !isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const ownerUserId = scope === 'personal' ? req.user.id : null;
    // 필수 검증
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errorResponse(res, 'invalid_email', 400);
    if (!b.imap_host || !b.imap_username || !b.imap_password) {
      return errorResponse(res, 'imap_required', 400);
    }
    // 중복 (워크스페이스 내 같은 email 1개만)
    const dup = await EmailAccount.findOne({ where: { business_id: businessId, email } });
    if (dup) return errorResponse(res, 'duplicate_email', 409);
    // 저장 전 실연결 검증 — 실패 시 등록 자체를 거부 + 원인별 안내 코드
    const verify = await verifyImapCredentials({
      host: b.imap_host, port: Number(b.imap_port) || 993, tls: b.imap_tls !== false,
      username: b.imap_username, password: b.imap_password, folder: b.imap_folder || 'INBOX',
    });
    if (!verify.ok) return res.status(400).json({ success: false, message: verify.code, detail: verify.detail });
    // 첫 공용 계정이면 is_default 자동 (개인 계정은 공용 default 후보 아님)
    const teamCount = await EmailAccount.count({ where: { business_id: businessId, owner_user_id: null } });
    const acc = await EmailAccount.create({
      business_id: businessId,
      owner_user_id: ownerUserId,
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
      is_default: scope === 'team' && teamCount === 0,
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
    const { acc, remediation } = await findAccountForMutation(req);
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!remediation && !canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    const b = req.body || {};
    const patch = {};
    // #109 — 개인 ↔ 회사공용(scope) 전환. 옛 버그: PUT 에 scope 변경이 없어 "회사공용에 실수로 추가했는데 개인으로 못 바꿈".
    //   회사공용→개인: 본인 소유로 이전(팀 계정 관리 권한은 canManageAccount 가 이미 admin 으로 게이트).
    //   개인→회사공용: 공용화라 admin 만.
    if (b.scope !== undefined) {
      if (b.scope === 'personal') {
        patch.owner_user_id = req.user.id;
      } else {
        if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
        patch.owner_user_id = null;
      }
    }
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
    // IMAP 자격이 바뀌면 저장 전 실연결 검증 (비밀번호 재입력으로 계정 살리는 경로 포함)
    const imapTouched = ['imap_host', 'imap_port', 'imap_username', 'imap_password'].some((k) => b[k] !== undefined && b[k]);
    if (imapTouched) {
      const password = (b.imap_password && String(b.imap_password)) || decrypt(acc.imap_password_encrypted);
      const verify = await verifyImapCredentials({
        host: b.imap_host !== undefined ? b.imap_host : acc.imap_host,
        port: Number(b.imap_port !== undefined ? b.imap_port : acc.imap_port) || 993,
        tls: b.imap_tls !== undefined ? !!b.imap_tls : acc.imap_tls,
        username: b.imap_username !== undefined ? b.imap_username : acc.imap_username,
        password,
        folder: b.imap_folder !== undefined ? (b.imap_folder || 'INBOX') : acc.imap_folder,
      });
      if (!verify.ok) return res.status(400).json({ success: false, message: verify.code, detail: verify.detail });
      // 검증 통과 → 실패 이력 리셋
      patch.last_sync_error = null;
      patch.fail_count = 0;
    }
    const prevOwner = acc.owner_user_id;
    await acc.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      // 관리자가 남의 개인 계정을 교정한 경우는 별도 action — 감사에서 구분되어야 한다
      action: remediation ? 'email_account.admin_remediate' : 'email_account.update',
      targetType: 'EmailAccount', targetId: acc.id,
      oldValue: remediation ? { owner_user_id: prevOwner } : undefined,
      newValue: { fields: Object.keys(patch), ...(remediation ? { owner_user_id: acc.owner_user_id } : {}) },
    });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// DELETE — soft (is_active=false, data 보존)
router.delete('/:businessId/email-accounts/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 관리자 교정 — DELETE 는 body 가 없으므로 비활성화 의사로 간주 (교정 허용 필드와 동일)
    if (!req.body || Object.keys(req.body).length === 0) req.body = { is_active: false };
    const { acc, remediation } = await findAccountForMutation(req);
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!remediation && !canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    await acc.update({ is_active: false });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: remediation ? 'email_account.admin_deactivate' : 'email_account.deactivate',
      targetType: 'EmailAccount', targetId: acc.id,
    });
    successResponse(res, null, 'deactivated');
  } catch (err) { next(err); }
});

// POST /test — IMAP 연결 테스트
router.post('/:businessId/email-accounts/:id/test', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
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
    // 기본 계정은 워크스페이스 공용 발송 기본값 → 회사 공용 계정만 가능 (개인 계정 제외)
    if (acc.owner_user_id != null) return errorResponse(res, 'personal_cannot_be_default', 400);
    // 공용 계정 default 해제 → 이 계정만 true
    await EmailAccount.update({ is_default: false }, { where: { business_id: businessId, owner_user_id: null } });
    await acc.update({ is_default: true });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// POST /sync-now — 즉시 IMAP fetch 트리거 (cron 대기 없이)
router.post('/:businessId/email-accounts/:id/sync-now', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    // 백그라운드 fire-and-forget
    const emailImapCron = require('../services/emailImapCron');
    emailImapCron.syncOne(acc).catch(e => console.error('[sync-now]', e.message));
    successResponse(res, { triggered: true, account_id: acc.id });
  } catch (err) { next(err); }
});

// ─── Gmail OAuth (N+70 Task C) — 앱 비밀번호 대체 ───────────────────
// GET /api/businesses/:businessId/email-accounts/oauth/gmail/initiate?return_to=...
//   → Google OAuth URL 302 redirect (scope: https://mail.google.com/ + email + profile)
router.get('/:businessId/email-accounts/oauth/gmail/initiate', authenticateToken, checkBusinessAccess, async (req, res) => {
  try {
    // scope: 'personal'(개인, 본인만) | 'team'(회사 공용). team 은 admin 만.
    const scope = req.query.scope === 'personal' ? 'personal' : 'team';
    if (scope === 'team' && !isAdmin(req)) return res.status(403).send('admin only');
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).send('GOOGLE_CLIENT_ID 미설정');
    const gmailOauth = require('../services/gmail_oauth');
    const url = gmailOauth.buildAuthUrl({
      businessId: Number(req.params.businessId),
      userId: req.user.id,
      returnUrl: req.query.return_to || '/business/settings/mail-accounts',
      scope,
    });
    // #82/#72 — auth_url 을 JSON 으로 반환. 프론트가 apiFetch(Bearer) 로 받아 window.location 이동.
    // (옛 방식: window.location.href 로 이 라우트 직접 진입 → 브라우저 네비게이션이 Bearer 미전달 →
    //  authenticateToken 401 "Access token required". connectPersonal 동일 패턴으로 통일.)
    return res.json({ success: true, data: { auth_url: url } });
  } catch (e) {
    console.error('[gmail-oauth/initiate]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/businesses/email-accounts/oauth/gmail/callback?code=&state=
//   → Google 이 redirect — code 교환 + EmailAccount 생성/갱신 + frontend redirect
//   (note: 이 callback 은 business path 외부 — Google 가 등록한 redirect URI 그대로 사용)
router.get('/email-accounts/oauth/gmail/callback', async (req, res) => {
  // CSP 정합 — inline script X. 성공 시 302 redirect, 실패 시 settings 페이지에 ?error= 쿼리.
  // open redirect 방어 — returnUrl 은 상대경로(/ 시작, // 아님)만 허용. 그 외 기본으로 강제.
  const safeReturn = (returnUrl) => {
    const u = String(returnUrl || '');
    return (u.startsWith('/') && !u.startsWith('//')) ? u : '/business/settings/mail-accounts';
  };
  // 기존 쿼리(?scope=personal 등) 보존해 append — 개인 뷰 복귀 (F-3). hash 만 제거.
  const appendQuery = (returnUrl, key, val) => {
    const base = safeReturn(returnUrl).replace(/#.*$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${key}=${encodeURIComponent(val)}`;
  };
  const buildSuccessRedirect = (returnUrl, email) => appendQuery(returnUrl, 'gmail_connected', email);
  const buildErrorRedirect = (returnUrl, error) => appendQuery(returnUrl, 'gmail_error', error);

  let returnUrl = null;   // catch 에서도 개인 뷰 복귀하도록 바깥 스코프.
  try {
    const { code, state, error: oauthError } = req.query;
    const gmailOauth = require('../services/gmail_oauth');
    const parsed = state ? gmailOauth.decodeState(String(state)) : null;
    if (parsed) returnUrl = parsed.returnUrl;
    if (oauthError) return res.redirect(302, buildErrorRedirect(returnUrl, oauthError));
    if (!code || !state) return res.redirect(302, buildErrorRedirect(returnUrl, 'invalid_request'));
    if (!parsed) return res.redirect(302, buildErrorRedirect(null, 'invalid_state'));

    const tokens = await gmailOauth.exchangeCodeForTokens(String(code));
    const { encrypt } = require('../services/encryption');

    // scope: 'personal' → 본인 소유 / 'team' → 회사 공용 (owner null)
    const ownerUserId = parsed.scope === 'personal' ? parsed.userId : null;
    // 같은 email 이미 등록돼 있으면 갱신 (OAuth 토큰 교체)
    let acc = await EmailAccount.findOne({
      where: { business_id: parsed.businessId, email: tokens.email },
    });
    const teamCount = await EmailAccount.count({ where: { business_id: parsed.businessId, owner_user_id: null } });
    const isFirstTeam = parsed.scope !== 'personal' && teamCount === 0;
    const payload = {
      business_id: parsed.businessId,
      owner_user_id: ownerUserId,
      email: tokens.email,
      display_name: tokens.name || null,
      auth_type: 'google_oauth',
      oauth_access_token_encrypted: encrypt(tokens.access_token),
      oauth_refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : (acc?.oauth_refresh_token_encrypted || null),
      oauth_expires_at: tokens.expires_at,
      oauth_scope: tokens.scope,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: tokens.email,
      imap_password_encrypted: null,    // OAuth 시 password 없음
      imap_tls: true,
      imap_folder: 'INBOX',
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: tokens.email,
      smtp_password_encrypted: null,
      smtp_tls: true,
      is_active: true,
    };
    if (acc) {
      // 재연결 — 소유(공용/개인)는 기존 값 보존 (token/연결정보만 갱신)
      delete payload.owner_user_id;
      await acc.update(payload);
    } else {
      payload.is_default = isFirstTeam;
      acc = await EmailAccount.create(payload);
    }
    return res.redirect(302, buildSuccessRedirect(parsed.returnUrl, tokens.email));
  } catch (e) {
    console.error('[gmail-oauth/callback]', e);
    return res.redirect(302, buildErrorRedirect(returnUrl, e.message));
  }
});

module.exports = router;
