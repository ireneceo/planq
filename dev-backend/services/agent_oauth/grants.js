// AI 에이전트 연동(#439) — 연결(grant)·토큰의 **한 곳**.
//
//   동의 API(:3003, routes/agent_oauth.js)와 MCP 서버(:3005, mcp/server.js)가 같은 함수를 쓴다.
//   두 프로세스가 각자 «누가 연결할 수 있나» 를 판정하면 갈라진다.
//
//   신원·범위는 **토큰에서만** 나온다. 모델이 보낸 user_id·business_id 는 어디에서도 읽지 않는다(설계 §5).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('./config');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * 이 사람이 이 워크스페이스로 AI 앱을 연결할 수 있는가 — 동의할 때와 **매 호출** 같은 판정.
 *   멤버 이상(owner·admin·member)만. 고객·AI 멤버·정지 계정·탈퇴 멤버는 안 된다(설계 §5.6·5.7).
 *   멤버십이 끊기면 grant 를 지우지 않아도 다음 호출에서 닫힌다.
 */
async function canConnect(userId, businessId) {
  const { User, BusinessMember, Business } = require('../../models');
  const u = await User.findByPk(userId, { attributes: ['id', 'is_ai', 'status', 'platform_role'] });
  if (!u || u.is_ai) return { ok: false, code: 'user_not_allowed' };
  if (u.status && !['active'].includes(u.status)) return { ok: false, code: 'user_not_active' };
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'deleted_at'] });
  if (!biz || biz.deleted_at) return { ok: false, code: 'workspace_not_found' };
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId, removed_at: null }, attributes: ['role'] });
  if (!bm || !['owner', 'admin', 'member'].includes(bm.role)) return { ok: false, code: 'members_only' };
  return { ok: true, role: bm.role, platformRole: u.platform_role || null };
}

/** 동의 화면이 보여주는 «연결할 수 있는 워크스페이스» — canConnect 와 같은 조건. */
async function connectableWorkspaces(userId) {
  const { BusinessMember, Business } = require('../../models');
  const rows = await BusinessMember.findAll({
    where: { user_id: userId, removed_at: null, role: ['owner', 'admin', 'member'] },
    include: [{ model: Business, attributes: ['id', 'name', 'brand_name', 'deleted_at'] }],
  });
  return rows
    .filter((r) => r.Business && !r.Business.deleted_at)
    .map((r) => ({ business_id: r.business_id, name: r.Business.brand_name || r.Business.name, role: r.role }));
}

/**
 * 여러 워크스페이스(2026-10-15, docs/AI_AGENT_MULTI_WORKSPACE_DESIGN.md · Fable 설계 판정) ──────────────
 *   grant.business_id = 기본 워크스페이스(토큰 bid·형제 정리·감사 키) · extra_business_ids = 함께 허용한 것.
 *   NULL = 옛 연결 = 기본 하나만. 기본 워크스페이스를 떠나면 연결 전체가 닫힌다(principalFromAccess — 의도, 설계 §1-1).
 */
function extraIdsOf(grant) {
  const raw = grant && Array.isArray(grant.extra_business_ids) ? grant.extra_business_ids : [];
  const def = Number(grant && grant.business_id);
  return [...new Set(raw.map(Number).filter((x) => Number.isInteger(x) && x > 0 && x !== def))];
}
/** 이 연결이 닿는 워크스페이스 전부 — 기본이 맨 앞. */
function workspaceIdsOf(grant) { return [Number(grant.business_id), ...extraIdsOf(grant)]; }

/** «이 워크스페이스에 닿는 연결» 술어 한 벌 — 연결 목록(GET /api/agent/grants)·온보딩이 같이 쓴다(Fable 6). */
function grantsTouchingWorkspaceWhere(userId, businessId) {
  const { Op, literal } = require('sequelize');
  const bid = Number(businessId);
  if (!Number.isInteger(bid) || bid <= 0) return { id: -1 };
  return {
    user_id: userId,
    [Op.or]: [
      { business_id: bid },
      literal(`JSON_CONTAINS(\`AgentGrant\`.\`extra_business_ids\`, '${bid}')`),
    ],
  };
}

async function workspaceNames(ids) {
  if (!ids.length) return new Map();
  const { Business } = require('../../models');
  const rows = await Business.findAll({ where: { id: ids }, attributes: ['id', 'name', 'brand_name'] });
  return new Map(rows.map((b) => [b.id, b.brand_name || b.name]));
}

/** 외부 앱에 보일 워크스페이스 표기 — 응답 봉투의 `workspace`. */
async function workspaceLabel(businessId) {
  const names = await workspaceNames([Number(businessId)]);
  return { workspace_id: Number(businessId), name: names.get(Number(businessId)) || null };
}

/**
 * 이 연결이 허용한 워크스페이스 목록(list_workspaces) — 연결 밖 워크스페이스는 이름도 내지 않는다.
 *   available = 지금 canConnect 가 통과하는가(내보내짐·정지·삭제면 false + 이유).
 */
async function allowedWorkspaces(p) {
  const { AgentGrant } = require('../../models');
  const grant = p.grantId ? await AgentGrant.findByPk(p.grantId, { attributes: ['id', 'business_id', 'extra_business_ids'] }) : null;
  const def = Number(p.defaultBusinessId || p.businessId);
  const ids = grant ? workspaceIdsOf(grant) : [def];
  const names = await workspaceNames(ids);
  const grantScopes = p.grantScopes || p.scopes || [];
  const out = [];
  for (const id of ids) {
    const can = await canConnect(p.userId, id);
    out.push({
      workspace_id: id, name: names.get(id) || null, is_default: id === def,
      role: can.ok ? can.role : null, available: !!can.ok, unavailable_reason: can.ok ? null : can.code,
      mail: id === def && grantScopes.includes('mail:read'),
    });
  }
  return out;
}

/**
 * 호출 하나의 대상 워크스페이스를 정한다 — execute.runTool 이 scope 판정 **앞에서** 한 번 부른다.
 *   ★ 원본 principal 을 바꾸지 않고 **새 객체**를 돌려준다 — buildAgentServer 는 요청당 principal 하나를 모든 도구가 공유한다
 *     (JSON-RPC batch 로 둘째 호출에 첫 호출의 치환이 남으면 안 된다, Fable 2).
 *   생략·기본과 같음 → 기본. 허용 목록 밖 → workspace_not_allowed. 목록 안인데 지금 접근 불가 → workspace_unavailable:<code>.
 *   **다른 워크스페이스로 대체하지 않는다.** 메일(opt-in)은 기본 워크스페이스에만 — 다른 곳에선 scopes 에서 뺀다.
 * @returns {Promise<{ ok:true, principal } | { ok:false, code, requested, allowed }>}
 */
async function resolveWorkspace(p, workspaceId) {
  const def = Number(p.businessId);
  const base = { ...p, defaultBusinessId: def, grantScopes: p.scopes || [] };
  if (workspaceId === undefined || workspaceId === null || Number(workspaceId) === def) return { ok: true, principal: base };
  const want = Number(workspaceId);
  const { AgentGrant } = require('../../models');
  const grant = await AgentGrant.findByPk(p.grantId, { attributes: ['id', 'business_id', 'extra_business_ids'] });
  const ids = grant ? workspaceIdsOf(grant) : [def];
  const allowedList = async () => {
    const names = await workspaceNames(ids);
    return ids.map((id) => ({ workspace_id: id, name: names.get(id) || null, is_default: id === def }));
  };
  if (!ids.includes(want)) return { ok: false, code: 'workspace_not_allowed', requested: want, allowed: await allowedList() };
  const can = await canConnect(p.userId, want);
  if (!can.ok) return { ok: false, code: `workspace_unavailable:${can.code}`, requested: want, allowed: await allowedList() };
  return {
    ok: true,
    principal: {
      ...base, businessId: want, role: can.role, platformRole: can.platformRole,
      scopes: (p.scopes || []).filter((x) => !cfg.OPT_IN_SCOPES.includes(x)),
    },
  };
}

/**
 * 메일 scope 가 «없는» 이유가 «기본 워크스페이스에서만 허용» 인가 — scope 거절 안내·출처 메일·search_all 메일 그룹이 같은 술어(Fable 3).
 *   이 경우 «다시 연결해서 메일 허용» 은 거짓 안내다(다시 연결해도 기본에만 붙는다).
 */
function mailDeniedReason(p, scope = 'mail:read') {
  if (!cfg.OPT_IN_SCOPES.includes(scope)) return null;
  if (!p || !p.defaultBusinessId || Number(p.businessId) === Number(p.defaultBusinessId)) return null;
  return (p.grantScopes || []).includes(scope) ? 'mail_default_workspace_only' : null;
}

/**
 * 부여할 scope — ①요청 scope ∩ 묶음(읽기만/읽기+쓰기)(요청이 없으면 묶음 전체) ②별도 동의(opt-in)는
 *   **요청과 무관하게 체크박스가 켜졌을 때만** 더한다(설계 docs/AI_AGENT_M3_DESIGN.md §3.1).
 *   클라이언트가 mail:read 를 요청해도 사람이 체크하지 않으면 붙지 않고, 요청하지 않았어도 체크하면 붙는다.
 * @param {string[]} requested
 * @param {'read'|'write'} access
 * @param {{ mail?: boolean, mail_drafts?: boolean }} [optIn]
 */
function grantedScopes(_requested, access, optIn = {}) {
  // ★ 2026-10-06 — 요청 scope 로 **좁히지 않는다.** 동의 화면은 scope 목록을 보여 주지 않고 «읽기만 / 읽기+쓰기»
  //   묶음만 고르게 한다 — 사람이 고른 것은 묶음이다. 그런데 ChatGPT 는 처음 등록할 때 받아 둔 scope 목록을
  //   계속 요청해서, 그 뒤에 생긴 docs:write·files:write 가 **다시 연결해도 영영 안 붙었다**(운영 grant 4 실측).
  //   도구는 "다시 연결하세요" 라고 하고, 다시 연결해도 같은 목록이라 끝없이 재연결을 시켰다.
  //   별도 동의(mail:*) 는 지금처럼 체크박스로만 붙는다.
  const bundle = access === 'write' ? cfg.BUNDLE_SCOPES : cfg.READ_SCOPES;
  const out = [...new Set(bundle)];
  if (optIn.mail === true) {
    out.push('mail:read');
    if (optIn.mail_drafts === true) out.push('mail_drafts:write');
  }
  return out;
}

/**
 * 이 워크스페이스에서 AI 앱이 메일을 읽어도 되는가 — 동의 화면(체크박스 활성)과 **매 호출**(메일 도구 첫 줄)이 같은 함수.
 *   저장 자리는 businesses.permissions.ai_agent.mail(새 컬럼 0). 값이 없으면 기본 true(설계 §12-①).
 */
function workspaceMailAllowed(permissions) {
  const p = permissions && typeof permissions === 'object' ? permissions : {};
  const a = p.ai_agent && typeof p.ai_agent === 'object' ? p.ai_agent : {};
  return a.mail !== false;
}

/** 동의 화면이 보여 줄 «보이는 계정» — accessibleAccountIds 와 같은 집합(공용 + 내 개인). 연결 정보·오류 원문은 싣지 않는다. */
async function mailAccountsFor(userId, businessId) {
  const { accessibleAccountIds } = require('../mailIdentity');
  const ids = await accessibleAccountIds(businessId, userId);
  if (!ids.length) return [];
  const { EmailAccount } = require('../../models');
  const rows = await EmailAccount.findAll({
    where: { id: ids, business_id: businessId },
    attributes: ['id', 'email', 'owner_user_id', 'is_active'],
    order: [['owner_user_id', 'ASC'], ['id', 'ASC']],
  });
  return rows.map((a) => ({ account_id: a.id, email: a.email, is_personal: !!a.owner_user_id, is_active: !!a.is_active }));
}

function signAccess(grant) {
  const secret = cfg.tokenSecret();
  if (!secret) throw new Error('agent_secret_missing');
  return jwt.sign(
    { kind: 'agent', gid: grant.id, uid: grant.user_id, bid: grant.business_id, scp: grant.scopes },
    secret,
    { expiresIn: cfg.ACCESS_TTL_SEC, audience: cfg.RESOURCE, issuer: cfg.ISSUER },
  );
}

/** 새 access + 새 refresh. 옛 refresh 는 prev 로 내려 재사용을 감지한다. */
async function issueTokens(grant) {
  const refresh = randomToken();
  await grant.update({
    prev_refresh_token_hash: grant.refresh_token_hash || null,
    refresh_token_hash: sha256(refresh),
    refresh_expires_at: new Date(Date.now() + cfg.REFRESH_TTL_MS),
    activated_at: grant.activated_at || new Date(),
    last_used_at: new Date(),
  });
  return {
    access_token: signAccess(grant),
    token_type: 'Bearer',
    expires_in: cfg.ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope: (grant.scopes || []).join(' '),
  };
}

/** 연결 감사를 연결이 닿는 워크스페이스마다 남긴다(기본 = role 'default', 함께 = role 'extra'). */
function auditGrantPerWorkspace(req, grant, action, value) {
  const { logAudit } = require('../auditService');
  const def = Number(grant.business_id);
  for (const bid of workspaceIdsOf(grant)) {
    logAudit(req, {
      userId: grant.user_id, businessId: bid, action, targetType: 'agent_grant', targetId: grant.id,
      newValue: { ...value, role: bid === def ? 'default' : 'extra', default_business_id: def, extra_business_ids: extraIdsOf(grant) },
    });
  }
}

async function revokeGrant(grant, reason, extra = {}) {
  if (!grant || grant.revoked_at) return;
  await grant.update({ revoked_at: new Date(), revoked_reason: reason, refresh_token_hash: null });
  // 함께 허용한 워크스페이스에도 한 줄씩 — 그 워크스페이스 감사에서 «닿던 연결이 끊겼다» 가 보여야 한다(Fable 5)
  const { auditGrantPerWorkspace } = module.exports;
  auditGrantPerWorkspace(null, grant, 'agent_grant.revoke', { reason, provider: grant.provider, client_id: grant.client_id, ...extra });
}

/**
 * 같은 사람 × 겹치는 워크스페이스 × **같은 앱**(돌아갈 주소가 같은 클라이언트)의 다른 살아 있는 연결을 닫는다.
 *   ChatGPT 는 커넥터를 다시 추가할 때 클라이언트를 새로 등록하기도 해서(client_id 가 바뀐다) client_id 로는 못 묶는다.
 *   돌아갈 주소(커넥터 주소)는 그대로라 그것으로 묶는다. 다른 앱(Claude 등)·다른 워크스페이스 연결은 건드리지 않는다.
 *   이유 값은 'client'(앱이 다시 연결해 바꿨다) — ENUM 을 늘리지 않으려고. 감사에 replaced_by 를 남긴다.
 */
async function supersedeSiblings(grant, redirectUri) {
  if (!grant || !redirectUri) return 0;
  const { Op } = require('sequelize');
  const { AgentGrant, AgentClient } = require('../../models');
  // 워크스페이스 집합이 **겹치면** 같은 자리다 — «기본 B + 함께 A» 로 다시 연결했는데 옛 «기본 A» 가 살아 있으면
  //   A 의 목록에 같은 앱이 둘 보인다(Fable 4, 2026-10-15). 겹치지 않는 다른 워크스페이스 연결은 건드리지 않는다.
  const mine = new Set(workspaceIdsOf(grant));
  const others = (await AgentGrant.findAll({
    where: { user_id: grant.user_id, revoked_at: null, id: { [Op.ne]: grant.id } },
  })).filter((g) => workspaceIdsOf(g).some((id) => mine.has(id)));
  if (!others.length) return 0;
  const clients = await AgentClient.findAll({ where: { client_id: [...new Set(others.map((g) => g.client_id))] }, attributes: ['client_id', 'redirect_uris'] });
  const sameApp = new Set(clients.filter((c) => (Array.isArray(c.redirect_uris) ? c.redirect_uris : []).includes(redirectUri)).map((c) => c.client_id));
  let n = 0;
  for (const g of others) {
    if (!sameApp.has(g.client_id)) continue;
    await revokeGrant(g, 'client', { replaced_by: grant.id });
    n += 1;
  }
  return n;
}

/**
 * access 토큰 → principal. 실패하면 null(이유는 code 로).
 *   ①서명·kind·aud·iss ②grant 생존(revoked 아님·활성) ③멤버십 생존(canConnect) — 셋 다 매 호출.
 */
async function principalFromAccess(token) {
  const secret = cfg.tokenSecret();
  if (!secret) return { ok: false, code: 'disabled' };
  let p;
  try {
    p = jwt.verify(String(token || ''), secret, { audience: cfg.RESOURCE, issuer: cfg.ISSUER });
  } catch (e) {
    return { ok: false, code: e.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
  if (p.kind !== 'agent' || !p.gid) return { ok: false, code: 'invalid' };
  const { AgentGrant } = require('../../models');
  const grant = await AgentGrant.findByPk(p.gid);
  if (!grant || grant.revoked_at || !grant.activated_at) return { ok: false, code: 'revoked' };
  if (grant.user_id !== p.uid || grant.business_id !== p.bid) return { ok: false, code: 'invalid' };
  // ★ 기본 워크스페이스를 떠나면 함께 허용한 워크스페이스가 살아 있어도 연결 전체를 닫는다(설계 §1-1, Fable 8) —
  //   기본을 다른 것으로 올리면 토큰 bid·메일 동의·형제 정리가 전부 갈라진다. 다시 연결하면 된다.
  const can = await canConnect(grant.user_id, grant.business_id);
  if (!can.ok) {
    if (can.code === 'members_only' || can.code === 'workspace_not_found') await revokeGrant(grant, 'membership_lost');
    return { ok: false, code: can.code };
  }
  grant.update({ last_used_at: new Date() }).catch(() => {});
  return {
    ok: true,
    principal: {
      userId: grant.user_id, businessId: grant.business_id, platformRole: can.platformRole,
      grantId: grant.id, clientId: grant.client_id, provider: grant.provider || 'unknown',
      scopes: grant.scopes || [], role: can.role, exp: p.exp,
    },
  };
}

module.exports = {
  sha256, randomToken, canConnect, connectableWorkspaces, grantedScopes, workspaceMailAllowed, mailAccountsFor,
  issueTokens, revokeGrant, supersedeSiblings, principalFromAccess, signAccess,
  extraIdsOf, workspaceIdsOf, grantsTouchingWorkspaceWhere, workspaceLabel, allowedWorkspaces, resolveWorkspace,
  mailDeniedReason, auditGrantPerWorkspace,
};
