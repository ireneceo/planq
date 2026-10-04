// AI 에이전트 연동(#439) — 동의 화면 · 연결 목록/해제 (메인 백엔드 :3003, 로그인 세션).
//
//   흐름: 외부 AI(ChatGPT 등) → /agent/authorize(MCP 프로세스) → 302 /connect/agent?request=<id>
//         → 이 화면이 GET request 로 «어느 앱이 무엇을» 보여주고 → 사람이 워크스페이스·권한을 골라 POST consent
//         → 코드 발급 → 브라우저가 외부 AI 의 redirect_uri 로 간다.
//   «누가 연결할 수 있나» 는 services/agent_oauth/grants.canConnect 한 곳 — MCP 프로세스도 매 호출 같은 함수를 쓴다.
//   설계 docs/AI_AGENT_INTEGRATION_DESIGN.md §4.2.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const cfg = require('../services/agent_oauth/config');
const grants = require('../services/agent_oauth/grants');
const store = require('../services/ephemeralStore');

const consentLimit = perUserLimiter('agent-consent', { windowMs: 10 * 60 * 1000, max: 20 });

function redirectWith(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * 워크스페이스마다 «메일 읽기 허용» 체크박스의 재료 — 스위치(workspaceMailAllowed) + 보이는 계정(accessibleAccountIds 와 같은 집합).
 *   설계 docs/AI_AGENT_M3_DESIGN.md §3.1: 어디로 가는지 모르면 확인할 수 없다 → 계정 주소와 공용/개인을 동의 화면이 그린다.
 */
async function withMailInfo(userId, workspaces) {
  if (!workspaces.length) return workspaces;
  const { Business } = require('../models');
  const bizRows = await Business.findAll({ where: { id: workspaces.map((w) => w.business_id) }, attributes: ['id', 'permissions'] });
  const permOf = new Map(bizRows.map((b) => [b.id, b.permissions]));
  return Promise.all(workspaces.map(async (w) => ({
    ...w,
    mail: {
      enabled: grants.workspaceMailAllowed(permOf.get(w.business_id)),
      accounts: await grants.mailAccountsFor(userId, w.business_id),
    },
  })));
}

// GET /api/agent/oauth/request/:id — 동의 화면 데이터
router.get('/oauth/request/:id', authenticateToken, async (req, res, next) => {
  try {
    if (!cfg.enabled()) return errorResponse(res, 'agent_disabled', 404);
    const row = await store.get('agent_authreq', String(req.params.id));
    if (!row) return errorResponse(res, 'request_expired', 404);
    const p = row.payload || {};
    const prov = cfg.providerForRedirect(p.redirect_uri);
    const wanted = Array.isArray(p.scopes) && p.scopes.length ? p.scopes : cfg.ALL_SCOPES;
    return successResponse(res, {
      client_name: p.client_name || null,
      provider: prov ? prov.id : null,
      provider_label: prov ? prov.label : null,
      redirect_host: (() => { try { return new URL(p.redirect_uri).host; } catch { return null; } })(),
      // 쓰기를 요청했는가 — 묶음 선택지의 기본값
      wants_write: wanted.some((s) => cfg.WRITE_SCOPES.includes(s)),
      workspaces: await withMailInfo(req.user.id, await grants.connectableWorkspaces(req.user.id)),
    });
  } catch (err) { next(err); }
});

// POST /api/agent/oauth/consent  { request_id, business_id, access:'read'|'write', approve }
router.post('/oauth/consent', authenticateToken, consentLimit, async (req, res, next) => {
  try {
    if (!cfg.enabled() || !cfg.tokenSecret()) return errorResponse(res, 'agent_disabled', 404);
    const { request_id, business_id, access, approve, mail } = req.body || {};
    const row = await store.get('agent_authreq', String(request_id || ''));
    if (!row) return errorResponse(res, 'request_expired', 404);
    const p = row.payload || {};
    // 요청은 한 번만 쓴다 — 동의·거절 어느 쪽이든 끝나면 지운다(같은 요청으로 코드를 두 번 받지 못하게).
    if ((await store.consume('agent_authreq', String(request_id))) !== 1) return errorResponse(res, 'request_expired', 404);

    if (!approve) {
      return successResponse(res, { redirect: redirectWith(p.redirect_uri, { error: 'access_denied', state: p.state }) });
    }
    const bizId = Number(business_id);
    const can = await grants.canConnect(req.user.id, bizId);
    if (!can.ok) return errorResponse(res, can.code, 403);
    // 메일 읽기(opt-in) — 화면이 체크박스를 비활성으로 그리는 조건을 서버가 **다시** 본다(화면만 막으면 요청으로 우회된다).
    //   스위치가 꺼졌거나 보이는 계정이 없으면 요청을 거절한다(조용히 빼면 사람이 켠 줄 알고 연결한다).
    const { AgentGrant, Business } = require('../models');
    let wantsMail = false;
    if (mail === true) {
      const biz = await Business.findByPk(bizId, { attributes: ['id', 'permissions'] });
      if (!grants.workspaceMailAllowed(biz?.permissions)) return errorResponse(res, 'workspace_disabled_mail', 403);
      if (!(await grants.mailAccountsFor(req.user.id, bizId)).length) return errorResponse(res, 'no_mail_account', 400);
      wantsMail = true;
    }
    const scopes = grants.grantedScopes(p.scopes, access === 'write' ? 'write' : 'read', { mail: wantsMail });
    if (!scopes.length) return errorResponse(res, 'no_scopes', 400);

    const prov = cfg.providerForRedirect(p.redirect_uri);
    const grant = await AgentGrant.create({
      user_id: req.user.id, business_id: bizId, client_id: p.client_id,
      provider: prov ? prov.id : null, scopes,
    });
    const code = grants.randomToken();
    await store.set('agent_code', grants.sha256(code), {
      grant_id: grant.id, client_id: p.client_id, code_challenge: p.code_challenge,
      redirect_uri: p.redirect_uri, resource: p.resource || null,
    }, cfg.CODE_TTL_MS);
    require('../services/auditService').logAudit(req, {
      userId: req.user.id, businessId: bizId, action: 'agent_grant.create', targetType: 'agent_grant', targetId: grant.id,
      newValue: { provider: grant.provider, client_id: p.client_id, client_name: p.client_name || null, scopes },
    });
    return successResponse(res, { redirect: redirectWith(p.redirect_uri, { code, state: p.state }) });
  } catch (err) { next(err); }
});

// GET /api/agent/grants?business_id= — 내가 이 워크스페이스에 연결한 AI 앱(살아 있는 것만)
router.get('/grants', authenticateToken, async (req, res, next) => {
  try {
    const bizId = Number(req.query.business_id);
    if (!bizId) return errorResponse(res, 'business_id required', 400);
    const { AgentGrant, AgentClient } = require('../models');
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const { rows, count } = await AgentGrant.findAndCountAll({
      where: { user_id: req.user.id, business_id: bizId, revoked_at: null },
      order: [['created_at', 'DESC']], limit, offset,
    });
    const clients = await AgentClient.findAll({ where: { client_id: rows.map((r) => r.client_id) }, attributes: ['client_id', 'client_name'] });
    const nameOf = new Map(clients.map((c) => [c.client_id, c.client_name]));
    return paginatedResponse(res, rows.map((g) => ({
      id: g.id, provider: g.provider, client_name: nameOf.get(g.client_id) || null,
      access: (g.scopes || []).some((s) => cfg.WRITE_SCOPES.includes(s)) ? 'write' : 'read',
      // 「메일 포함」 칩 — 어느 연결이 메일을 보는지 사람이 알아야 끊을 수 있다(설계 §3.1)
      mail: (g.scopes || []).includes('mail:read'),
      connected: !!g.activated_at, created_at: g.created_at, last_used_at: g.last_used_at,
    })), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// DELETE /api/agent/grants/:id — 내 연결 해제
router.delete('/grants/:id', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 grants.revokeGrant 가 쓴다(agent_grant.revoke) — 해제 경로 셋(사용자·클라이언트·재사용 감지)이 같은 함수를 지난다
  try {
    const { AgentGrant } = require('../models');
    const g = await AgentGrant.findOne({ where: { id: Number(req.params.id), user_id: req.user.id } });
    if (!g) return errorResponse(res, 'not_found', 404);
    await grants.revokeGrant(g, 'user');
    return successResponse(res, { id: g.id, revoked: true });
  } catch (err) { next(err); }
});

module.exports = router;
