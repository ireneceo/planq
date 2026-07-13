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
const { Op } = require('sequelize');
const router = express.Router();
const {
  ExternalConnection, BusinessCloudToken, EmailAccount, EmailThread, BusinessMember, Business, CalendarEvent,
} = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const personalOauth = require('../services/personalOauth');
const personalCalendar = require('../services/personalCalendar');
const personalDrive = require('../services/personalDrive');
const { encrypt } = require('../services/encryption');

// 본인이 해당 워크스페이스 멤버인지 검증 (owner 도 business_members 행 보유 — 확인됨)
async function assertBusinessMember(req, bizId) {
  if (req.user.platform_role === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId, removed_at: null } });
  return !!bm;
}

const PERSONAL_PROVIDERS = ['google_calendar', 'google_drive', 'gmail'];

// OAuth 콜백 창 HTML — 부모창 postMessage 후 자동 닫기 (cloud.js 패턴 정합, COOP fallback 포함)
// #125a — 네이티브 복귀 딥링크. planq.kr 경로(Universal Link/App Link)로 302 → OS 가 앱을 깨우고
//   NativeBridge 의 appUrlOpen 이 시스템 브라우저를 닫은 뒤 'planq:oauth-connected' 를 발행한다.
//   (로그인 OAuth 가 /oauth/native-return 으로 쓰는 것과 같은 통로)
function nativeReturnRedirect(res, { ok, provider, error }) {
  const qs = new URLSearchParams({ provider: provider || '', ok: ok ? '1' : '0' });
  if (error) qs.set('error', String(error).slice(0, 120));
  return res.redirect(302, `/oauth/native-return?kind=connect&${qs.toString()}`);
}

function personalCallbackHtml({ ok, provider, title, body }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8FAFC;color:#0F172A;}
  .box{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,0.06);}
  h2{margin:0 0 10px;font-size:18px;color:${ok ? '#0F766E' : '#DC2626'};}
  p{margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;}
  button{height:36px;padding:0 18px;background:#14B8A6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
  button:hover{background:#0D9488;}
  .hint{font-size:11.5px;color:#94A3B8;margin-top:6px;}
  #fallback{display:none;}
</style></head>
<body>
  <div class="box" id="primary">
    ${body}
    <button type="button" id="closeBtn">닫기</button>
    <div class="hint">잠시 후 자동으로 닫힙니다…</div>
  </div>
  <div class="box" id="fallback"><h2 style="color:#0F766E;">✓ 완료</h2><p>이 창을 닫으셔도 됩니다.</p></div>
  <script>
    (function(){
      try { window.opener && window.opener.postMessage({ type: 'personal:connected', provider: ${JSON.stringify(provider || null)}, ok: ${ok ? 'true' : 'false'} }, '*'); } catch(e){}
      var tryClose = function(){ try { window.close(); } catch(e){} };
      document.getElementById('closeBtn').addEventListener('click', tryClose);
      setTimeout(tryClose, 800);
      setTimeout(function(){ if(!document.hidden){ var p=document.getElementById('primary'),f=document.getElementById('fallback'); if(p&&f){p.style.display='none';f.style.display='block';} } }, 1500);
    })();
  </script>
</body></html>`;
}

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

// DELETE /api/me/external-connections/:id — 본인 해제 (Google 토큰 revoke best-effort)
router.delete('/me/external-connections/:id', authenticateToken, async (req, res, next) => {
  try {
    const conn = await ExternalConnection.findOne({
      where: { id: req.params.id, user_id: req.user.id, owner_scope: 'user' },
    });
    if (!conn) return errorResponse(res, 'not_found', 404);
    if (conn.auth_type === 'oauth') await personalOauth.revokeToken(conn);
    await conn.destroy();
    successResponse(res, null, 'disconnected');
  } catch (err) { next(err); }
});

// ─── 개인 OAuth 흐름 (Phase 2-4) ──────────────────────────
// POST /api/me/oauth/google/initiate  body: { provider, business_id }
// → Google 동의 화면 auth_url 반환. 프론트가 popup 으로 연다.
router.post('/me/oauth/google/initiate', authenticateToken, async (req, res, next) => {
  try {
    if (!personalOauth.isConfigured()) return errorResponse(res, 'google_oauth_not_configured', 500);
    const provider = String((req.body || {}).provider || '');
    const bizId = parseInt((req.body || {}).business_id, 10);
    if (!PERSONAL_PROVIDERS.includes(provider)) return errorResponse(res, 'unsupported_provider', 400);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);
    // #125a — 네이티브 앱에서 시작하면 콜백이 "자동으로 닫힙니다" HTML 대신 앱 딥링크로 복귀해야 한다.
    //   (Capacitor 시스템 브라우저에서는 window.close() 가 no-op 이라 창이 그대로 멈춘다)
    const native = (req.body || {}).client === 'native';
    const auth_url = personalOauth.buildAuthUrl({ userId: req.user.id, businessId: bizId, provider, native });
    successResponse(res, { auth_url });
  } catch (err) { next(err); }
});

// GET /api/me/oauth/google/callback?code=&state=  (Google redirect — 비인증, state 로 사용자 복원)
router.get('/me/oauth/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  // #125a — state 안의 native 플래그를 알게 된 뒤부터는 실패도 앱 딥링크로 복귀시킨다
  //   (네이티브에서 HTML 을 띄우면 창이 그대로 멈춘다). parseState 전 실패는 HTML 유지.
  // ★ state 는 Google 이 에러 응답(access_denied 등)에도 동봉한다 → 에러 분기보다 먼저 파싱해
  //   네이티브 여부를 확정해야 한다. 안 그러면 '취소' 같은 흔한 경로에서 HTML 이 떠 창이 멈춘다
  //   (= #125a 가 고치려던 바로 그 증상. Fable BLOCK 3).
  let isNativeFlow = false;
  try {
    const pre = personalOauth.parseState(req.query.state);
    isNativeFlow = !!(pre && pre.native);
  } catch { /* 파싱 실패 → 웹으로 취급 */ }

  const fail = (msg) => {
    if (isNativeFlow) return nativeReturnRedirect(res, { ok: false, provider: null, error: msg });
    return res.status(400).send(personalCallbackHtml({
      ok: false, provider: null, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${msg}</p>`,
    }));
  };

  if (oauthError) {
    // 심사(검증) 전 거부/사용자 취소를 구분해 안내 — "고장"으로 오해하지 않게
    const friendly = String(oauthError) === 'access_denied'
      ? 'Google 연결이 완료되지 않았습니다. 권한 요청을 취소했거나, PlanQ 의 Google 앱 심사가 끝나기 전이라 이 계정은 아직 원클릭 연동이 제한될 수 있습니다. 메일은 설정의 "계정 추가"에서 앱 비밀번호 방식으로 연결할 수 있습니다.'
      : `Google 에서 거부됨: ${oauthError}`;
    return fail(friendly);
  }
  if (!code || !state) return fail('잘못된 요청');
  const parsed = personalOauth.parseState(state);
  if (!parsed) return fail('보안 검증 실패 (state 만료/위조)');
  isNativeFlow = !!parsed.native;

  try {
    // 멤버십 재검증 (state 의 user 가 여전히 그 워크스페이스 멤버인지)
    const bm = await BusinessMember.findOne({ where: { user_id: parsed.userId, business_id: parsed.businessId, removed_at: null } });
    if (!bm) return fail('워크스페이스 접근 권한 없음');

    const { tokens, email, name, sub } = await personalOauth.exchangeCodeForTokens(code);
    if (!email) return fail('Google 계정 이메일을 확인할 수 없습니다');

    // ── Gmail 은 EmailAccount (Q Mail M1 파이프라인) 로 저장 — 기존 IMAP cron 재사용 + owner_user_id 격리 ──
    if (parsed.provider === 'gmail') {
      const acctFields = {
        business_id: parsed.businessId,
        owner_user_id: parsed.userId,           // 개인 메일 — 본인만 접근
        email,
        display_name: name || null,
        auth_type: 'google_oauth',
        oauth_access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
        oauth_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        oauth_scope: tokens.scope || personalOauth.PROVIDER_SCOPES.gmail.join(' '),
        imap_host: 'imap.gmail.com',
        imap_port: 993,
        imap_username: email,
        imap_tls: true,
        imap_folder: 'INBOX',
        is_active: true,
        last_sync_error: null,
        fail_count: 0,
      };
      if (tokens.refresh_token) acctFields.oauth_refresh_token_encrypted = encrypt(tokens.refresh_token);

      const [acct, acctCreated] = await EmailAccount.findOrCreate({
        where: { business_id: parsed.businessId, email },
        defaults: acctFields,
      });
      if (!acctCreated) {
        // 같은 워크스페이스에 같은 email 이 이미 있음 — 안전 가드 (회사 공용/타인 개인 덮어쓰기 금지)
        if (acct.owner_user_id == null) return fail('이 메일은 회사 공용 계정으로 등록되어 있어 개인으로 연결할 수 없습니다');
        if (acct.owner_user_id !== parsed.userId) return fail('이 메일은 다른 사용자에게 연결되어 있습니다');
        await acct.update(acctFields);
      }
      return res.send(personalCallbackHtml({
        ok: true, provider: 'gmail', title: '연동 완료',
        body: `<h2>Gmail 연동 완료</h2><p>계정: <strong>${email}</strong><br/>5분 내 새 메일이 인박스에 들어옵니다.</p>`,
      }));
    }

    const scopeList = personalOauth.PROVIDER_SCOPES[parsed.provider].join(' ');
    const baseFields = {
      auth_type: 'oauth',
      account_email: email,
      account_name: name || null,
      account_external_id: sub || null,
      scope: tokens.scope || scopeList,
      access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      is_active: true,
      last_sync_error: null,
      fail_count: 0,
    };
    // refresh_token 은 재동의 시에만 옴 — 있으면 갱신, 없으면 기존 유지
    if (tokens.refresh_token) baseFields.refresh_token_encrypted = encrypt(tokens.refresh_token);

    // upsert — 같은 (user, business, provider, email) 1개 (UNIQUE 키 정합)
    const [conn, created] = await ExternalConnection.findOrCreate({
      where: {
        owner_scope: 'user', business_id: parsed.businessId,
        user_id: parsed.userId, provider: parsed.provider, account_email: email,
      },
      defaults: {
        owner_scope: 'user', business_id: parsed.businessId,
        user_id: parsed.userId, provider: parsed.provider,
        ...baseFields,
      },
    });
    if (!created) await conn.update(baseFields);

    const labelMap = { google_calendar: 'Google Calendar', google_drive: 'Google Drive', gmail: 'Gmail' };
    // #125a — 네이티브면 앱으로 복귀 (시스템 브라우저는 window.close() 가 안 먹혀 창이 멈춘다)
    if (isNativeFlow) return nativeReturnRedirect(res, { ok: true, provider: parsed.provider });
    return res.send(personalCallbackHtml({
      ok: true, provider: parsed.provider, title: '연동 완료',
      body: `<h2>${labelMap[parsed.provider]} 연동 완료</h2><p>계정: <strong>${email}</strong></p>`,
    }));
  } catch (e) {
    console.error('[me/oauth callback]', e);
    // 네이티브는 HTML 을 띄우면 창이 멈춘다 → 실패도 앱 딥링크로 복귀 (Fable BLOCK 3)
    if (isNativeFlow) return nativeReturnRedirect(res, { ok: false, provider: parsed.provider, error: 'connect_failed' });
    return res.status(500).send(personalCallbackHtml({
      ok: false, provider: parsed.provider, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`,
    }));
  }
});

// ─── Phase 2 — 개인 Google Calendar overlay ──────────────
// GET /api/me/calendar/events?business_id=&start=&end=
// → 본인 연결된 개인 Google 캘린더 일정 (정규화). Q Calendar 가 violet overlay 로 표시.
router.get('/me/calendar/events', authenticateToken, async (req, res, next) => {
  try {
    const bizId = parseInt(req.query.business_id, 10);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const DAY = 24 * 3600 * 1000;
    const timeMin = req.query.start ? new Date(req.query.start).toISOString() : new Date(Date.now() - 31 * DAY).toISOString();
    const timeMax = req.query.end ? new Date(req.query.end).toISOString() : new Date(Date.now() + 62 * DAY).toISOString();

    const conns = await ExternalConnection.findAll({
      where: {
        owner_scope: 'user', user_id: req.user.id, business_id: bizId,
        provider: 'google_calendar', is_active: true,
      },
    });
    if (!conns.length) return successResponse(res, { events: [], connections: [] });

    // PlanQ 가 구글에 밀어 넣은 일정 id — 오버레이에서 제외한다 (PlanQ 원본 + 구글 사본 = 이중 표시).
    //   신규 일정은 구글쪽 표식(extendedProperties.planq)으로도 걸러지지만, 표식이 없던 옛 일정은
    //   여기서 넘기는 id 집합으로만 걸러낼 수 있다.
    const pushed = await CalendarEvent.findAll({
      where: { business_id: bizId, gcal_event_id: { [Op.ne]: null } },
      attributes: ['gcal_event_id'],
    });
    const excludeIds = new Set(pushed.map((e) => String(e.gcal_event_id)));

    const events = [];
    const connections = [];
    for (const conn of conns) {
      try {
        const evs = await personalCalendar.listEvents(conn, { timeMin, timeMax, excludeIds });
        events.push(...evs);
        connections.push({ id: conn.id, account_email: conn.account_email, ok: true });
        if (conn.last_sync_error || conn.fail_count) await conn.update({ last_sync_error: null, fail_count: 0, last_sync_at: new Date() });
        else await conn.update({ last_sync_at: new Date() });
      } catch (e) {
        console.error('[me/calendar/events] fetch failed conn=' + conn.id, e.message);
        connections.push({ id: conn.id, account_email: conn.account_email, ok: false, error: e.message });
        await conn.update({ last_sync_error: e.message, fail_count: (conn.fail_count || 0) + 1 }).catch(() => {});
      }
    }
    successResponse(res, { events, connections });
  } catch (err) { next(err); }
});

// ─── Phase 3 — 개인 메일 계정 (Gmail) ──────────────────────
// GET /api/me/email-accounts?business_id= — 본인 개인 메일 계정 (owner_user_id=me)
router.get('/me/email-accounts', authenticateToken, async (req, res, next) => {
  try {
    const where = { owner_user_id: req.user.id };
    if (req.query.business_id) {
      const bizId = parseInt(req.query.business_id, 10);
      if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);
      where.business_id = bizId;
    }
    const rows = await EmailAccount.findAll({
      where,
      attributes: ['id', 'business_id', 'email', 'display_name', 'auth_type', 'is_active', 'last_sync_at', 'last_sync_error', 'fail_count', 'created_at'],
      order: [['created_at', 'DESC']],
    });
    successResponse(res, rows.map(r => ({ ...r.toJSON(), provider: 'gmail', owner_scope: 'user' })));
  } catch (err) { next(err); }
});

// DELETE /api/me/email-accounts/:id — 본인 개인 메일 해제 (owner_user_id=me 만)
router.delete('/me/email-accounts/:id', authenticateToken, async (req, res, next) => {
  try {
    const acct = await EmailAccount.findOne({ where: { id: req.params.id, owner_user_id: req.user.id } });
    if (!acct) return errorResponse(res, 'not_found', 404);
    // 개인 메일 데이터(스레드/메시지/첨부) 정리 후 계정 삭제 — FK 제약 회피.
    // 스레드 삭제 시 EmailMessage·EmailAttachment 는 onDelete CASCADE 로 함께 제거.
    await EmailThread.destroy({ where: { account_id: acct.id, business_id: acct.business_id } });
    await acct.destroy();
    successResponse(res, null, 'disconnected');
  } catch (err) { next(err); }
});

// ─── Phase 4 — 개인 Google Drive 파일 목록 (읽기 전용) ──────
// GET /api/me/drive/files?business_id=&q=&page_token=
router.get('/me/drive/files', authenticateToken, async (req, res, next) => {
  try {
    const bizId = parseInt(req.query.business_id, 10);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const conn = await ExternalConnection.findOne({
      where: {
        owner_scope: 'user', user_id: req.user.id, business_id: bizId,
        provider: 'google_drive', is_active: true,
      },
    });
    if (!conn) return successResponse(res, { connected: false, files: [], next_page_token: null });

    try {
      const out = await personalDrive.listFiles(conn, { q: req.query.q, pageToken: req.query.page_token });
      await conn.update({ last_sync_at: new Date(), last_sync_error: null, fail_count: 0 });
      return successResponse(res, { connected: true, account_email: conn.account_email, ...out });
    } catch (e) {
      console.error('[me/drive/files] fetch failed conn=' + conn.id, e.message);
      await conn.update({ last_sync_error: e.message, fail_count: (conn.fail_count || 0) + 1 }).catch(() => {});
      return errorResponse(res, `drive_fetch_failed: ${e.message}`, 502);
    }
  } catch (err) { next(err); }
});

module.exports = router;
