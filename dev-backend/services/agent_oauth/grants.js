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

/** 요청 scope ∩ 묶음(읽기만/읽기+쓰기) ∩ 지원 scope. 요청이 없으면 묶음 전체. */
function grantedScopes(requested, access) {
  const bundle = access === 'write' ? cfg.ALL_SCOPES : cfg.READ_SCOPES;
  const req = Array.isArray(requested) && requested.length ? requested : bundle;
  return [...new Set(req.filter((s) => bundle.includes(s)))];
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

async function revokeGrant(grant, reason) {
  if (!grant || grant.revoked_at) return;
  await grant.update({ revoked_at: new Date(), revoked_reason: reason, refresh_token_hash: null });
  require('../auditService').logAudit(null, {
    userId: grant.user_id, businessId: grant.business_id,
    action: 'agent_grant.revoke', targetType: 'agent_grant', targetId: grant.id,
    newValue: { reason, provider: grant.provider, client_id: grant.client_id },
  });
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
  sha256, randomToken, canConnect, connectableWorkspaces, grantedScopes,
  issueTokens, revokeGrant, principalFromAccess, signAccess,
};
