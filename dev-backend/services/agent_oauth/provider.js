// AI 에이전트 연동(#439) — MCP SDK 의 OAuthServerProvider 구현.
//
//   SDK(@modelcontextprotocol/sdk server/auth)가 /authorize·/token·/register·/revoke 의 **프로토콜**(PKCE 검증·
//   입력 스키마·오류 모양·속도 제한)을 맡고, 여기는 **PlanQ 의 판단**(누구를 등록하나·누구에게 무엇을 주나)만 한다.
//
//   단기 상태는 services/ephemeralStore(재시작 생존·원자 연산) — 메모리 Map 금지(2026-09-10 교훈).
//     agent_authreq : 인가 요청(동의 화면이 끝날 때까지 10분)
//     agent_code    : 인가 코드 → sha256 키, 2분, 1회 소비(consume === 1), 시도 상한
const crypto = require('crypto');
const { InvalidGrantError, InvalidClientMetadataError, InvalidRequestError, InvalidTokenError } =
  require('@modelcontextprotocol/sdk/server/auth/errors.js');
const cfg = require('./config');
const grants = require('./grants');
const store = require('../ephemeralStore');
const { encrypt, decrypt } = require('../encryption');

// ── 등록된 클라이언트 (DCR) ─────────────────────────────────────────────
const clientsStore = {
  async getClient(clientId) {
    const { AgentClient } = require('../../models');
    const c = await AgentClient.findOne({ where: { client_id: String(clientId || '') } });
    if (!c) return undefined;
    let secret;
    if (c.client_secret_enc) { try { secret = decrypt(c.client_secret_enc); } catch { secret = undefined; } }
    return {
      ...(c.metadata || {}),
      client_id: c.client_id,
      client_name: c.client_name || undefined,
      redirect_uris: c.redirect_uris,
      token_endpoint_auth_method: c.token_endpoint_auth_method,
      ...(secret ? { client_secret: secret } : {}),
    };
  },

  async registerClient(info) {
    const uris = Array.isArray(info.redirect_uris) ? info.redirect_uris : [];
    if (!uris.length) throw new InvalidClientMetadataError('redirect_uris required');
    const providers = uris.map((u) => cfg.providerForRedirect(u));
    // 허용 호스트 밖의 주소가 **하나라도** 있으면 거절 — 섞어 등록하면 나중에 그 주소로 코드를 받을 수 있다.
    if (providers.some((p) => !p)) throw new InvalidClientMetadataError('redirect_uri host not allowed');
    if (new Set(providers.map((p) => p.id)).size > 1) throw new InvalidClientMetadataError('mixed redirect hosts');
    const { AgentClient } = require('../../models');
    const meta = {
      client_name: info.client_name ? String(info.client_name).slice(0, 200) : undefined,
      grant_types: info.grant_types, response_types: info.response_types, scope: info.scope,
      client_uri: info.client_uri, logo_uri: info.logo_uri,
    };
    await AgentClient.create({
      client_id: info.client_id,
      client_name: meta.client_name || null,
      redirect_uris: uris,
      provider_hint: providers[0].id,
      token_endpoint_auth_method: info.token_endpoint_auth_method || 'none',
      client_secret_enc: info.client_secret ? encrypt(info.client_secret) : null,
      metadata: meta,
    });
    require('../auditService').logAudit(null, {
      userId: null, businessId: null, action: 'agent_client.register', targetType: 'agent_client', targetId: null,
      newValue: { client_id: info.client_id, client_name: meta.client_name || null, provider: providers[0].id },
    });
    return info;
  },
};

// ── 인가 · 토큰 ───────────────────────────────────────────────────────
const provider = {
  get clientsStore() { return clientsStore; },

  /** 인가 요청을 저장하고 동의 화면으로 보낸다. 코드는 사람이 [연결] 을 누른 뒤(routes/agent_oauth.js)에 나온다. */
  async authorize(client, params, res) {
    if (!cfg.enabled() || !cfg.tokenSecret()) throw new InvalidRequestError('agent integration disabled');
    // resource 를 붙여 왔으면 우리 MCP 주소와 정확히 같아야 한다(다른 서버용 토큰을 우리가 만들지 않는다).
    if (params.resource && params.resource.href.replace(/\/$/, '') !== cfg.RESOURCE) {
      throw new InvalidRequestError('invalid resource');
    }
    const requestId = crypto.randomBytes(18).toString('base64url');
    await store.set('agent_authreq', requestId, {
      client_id: client.client_id,
      client_name: client.client_name || null,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      scopes: params.scopes || [],
      state: params.state || null,
      resource: params.resource ? params.resource.href : null,
    }, cfg.AUTHREQ_TTL_MS);
    res.redirect(302, `${cfg.CONSENT_URL}?request=${encodeURIComponent(requestId)}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const row = await store.get('agent_code', grants.sha256(code));
    if (!row || row.payload?.client_id !== client.client_id) throw new InvalidGrantError('invalid code');
    const n = await store.bumpAttempts('agent_code', grants.sha256(code));
    if (n !== null && n > cfg.CODE_MAX_ATTEMPTS) {
      await store.del('agent_code', grants.sha256(code));
      throw new InvalidGrantError('too many attempts');
    }
    return row.payload.code_challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const key = grants.sha256(code);
    const row = await store.get('agent_code', key);
    // 1회 소비 — 동시에 둘이 와도 1 을 받는 쪽은 하나뿐이다(PKCE 검증은 SDK 가 이미 끝냈다).
    if (!row || (await store.consume('agent_code', key)) !== 1) throw new InvalidGrantError('invalid code');
    const p = row.payload || {};
    if (p.client_id !== client.client_id) throw new InvalidGrantError('client mismatch');
    if (redirectUri && redirectUri !== p.redirect_uri) throw new InvalidGrantError('redirect_uri mismatch');
    if (resource && p.resource && resource.href !== p.resource) throw new InvalidGrantError('resource mismatch');
    const { AgentGrant } = require('../../models');
    const grant = await AgentGrant.findByPk(p.grant_id);
    if (!grant || grant.revoked_at || grant.client_id !== client.client_id) throw new InvalidGrantError('grant not found');
    const can = await grants.canConnect(grant.user_id, grant.business_id);
    if (!can.ok) throw new InvalidGrantError('not allowed');
    const tokens = await grants.issueTokens(grant);
    // 같은 앱으로 다시 연결하면 옛 연결을 닫는다 — 앱은 새 토큰만 쓰는데 옛 연결이 목록에 남아 «ChatGPT» 가 둘 보였고,
    //   어느 쪽이 쓰이는지 몰라 쓰이는 쪽을 끊으면 재연결을 시켰다(2026-10-07 운영 grant 3·4). 토큰을 내준 **뒤에** 닫는다.
    await grants.supersedeSiblings(grant, p.redirect_uri);
    return tokens;
  },

  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    if (resource && resource.href.replace(/\/$/, '') !== cfg.RESOURCE) throw new InvalidGrantError('invalid resource');
    const { AgentGrant } = require('../../models');
    const h = grants.sha256(refreshToken);
    const grant = await AgentGrant.findOne({ where: { refresh_token_hash: h } });
    if (!grant) {
      // 직전 refresh 가 다시 오면 탈취 의심 — 그 연결 전체를 닫는다(refresh_tokens 의 reuse_detected 와 같은 정책).
      const reused = await AgentGrant.findOne({ where: { prev_refresh_token_hash: h } });
      if (reused && !reused.revoked_at) await grants.revokeGrant(reused, 'reuse_detected');
      throw new InvalidGrantError('invalid refresh token');
    }
    if (grant.revoked_at || grant.client_id !== client.client_id) throw new InvalidGrantError('invalid refresh token');
    if (grant.refresh_expires_at && new Date(grant.refresh_expires_at) < new Date()) throw new InvalidGrantError('refresh token expired');
    const can = await grants.canConnect(grant.user_id, grant.business_id);
    if (!can.ok) { await grants.revokeGrant(grant, 'membership_lost'); throw new InvalidGrantError('not allowed'); }
    return grants.issueTokens(grant);
  },

  async verifyAccessToken(token) {
    const r = await grants.principalFromAccess(token);
    if (!r.ok) throw new InvalidTokenError(r.code);
    const p = r.principal;
    return {
      token, clientId: p.clientId, scopes: p.scopes, expiresAt: p.exp,
      resource: new URL(cfg.RESOURCE), extra: { principal: p },
    };
  },

  /** 클라이언트가 연결을 끊을 때(ChatGPT 에서 삭제). 모르는 토큰이면 조용히 끝낸다(RFC 7009). */
  async revokeToken(client, request) {
    const { AgentGrant } = require('../../models');
    const tok = String(request.token || '');
    let grant = await AgentGrant.findOne({ where: { refresh_token_hash: grants.sha256(tok), client_id: client.client_id } });
    if (!grant) {
      const r = await grants.principalFromAccess(tok);
      if (r.ok && r.principal.clientId === client.client_id) grant = await AgentGrant.findByPk(r.principal.grantId);
    }
    if (grant) await grants.revokeGrant(grant, 'client');
  },
};

module.exports = { provider, clientsStore };
