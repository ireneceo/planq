// PlanQ MCP 읽기 서버 (#D-4) — 외부 에이전트(Claude Code 등) 유통 채널.
//
//   별도 프로세스(planq-mcp). dev-backend 를 라이브러리로 require 한다.
//   인증: Bearer api_token → sha256 조회 → getUserScope(user_id, business_id) 교환.
//         **토큰 소유자 scope 로 전 격리** — 별도 권한 체계 없음.
//   툴 4개 전부 **읽기 전용**(cue_context 재포장). 쓰기 툴은 이 표면에 절대 없다(D-4 순서 엄수).
//   Streamable HTTP + stateless(요청마다 새 server·transport). 감사: 전 호출 mcp.<tool>.
//
// ★ 2026-10-02 (#439) — **AI 에이전트 표면**(`/agent/*`)을 같은 프로세스에 얹었다. 설계 docs/AI_AGENT_INTEGRATION_DESIGN.md.
//   · `/agent/mcp` — OAuth 2.1 Bearer(services/agent_oauth). 도구는 services/agent/registry 한 벌, 실행은 runTool 하나.
//   · `/agent/{authorize,token,register,revoke}` — SDK 핸들러를 **직접** 마운트한다. SDK 의 mcpAuthRouter 는 엔드포인트를
//     도메인 최상위(/register…)에 고정하는데, 최상위 /register 는 PlanQ 회원가입 화면이라 겹친다.
//   · 디스커버리 RFC 9728·8414 — 경로 삽입형과 이어붙임형을 둘 다 준다(클라이언트마다 찾는 자리가 다르다).
//   · 옛 `/mcp`(api_token, 읽기 4툴)는 그대로 — 표면을 바꾸지 않는다.
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { ApiToken, Business } = require('../models');
const { getUserScope } = require('../middleware/access_scope');
const ctx = require('../services/cue_context');
const { logAudit } = require('../services/auditService');
const agentCfg = require('../services/agent_oauth/config');
const { provider: agentProvider } = require('../services/agent_oauth/provider');
const agentGrants = require('../services/agent_oauth/grants');
const { TOOLS: AGENT_TOOLS } = require('../services/agent/registry');
const { runTool } = require('../services/agent/execute');
const { authorizationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/authorize.js');
const { tokenHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/token.js');
const { clientRegistrationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/register.js');
const { revocationHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/revoke.js');
const { metadataHandler } = require('@modelcontextprotocol/sdk/server/auth/handlers/metadata.js');

const PORT = Number(process.env.MCP_PORT) || 3005;

// ★ 2026-10-04 — 이 프로세스에는 socket.io 가 없다. 행동 계층은 `global.__planqIo` 로 방송하므로,
//   비어 있으면 AI 가 만든 업무·메모가 열린 화면에 새로고침 전까지 안 보였다. 메인 백엔드로 넘기는 대리자를 둔다.
if (!global.__planqIo) global.__planqIo = require('../services/remoteIo').remoteIo;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const app = express();
// nginx 뒤 — SDK 핸들러의 속도 제한이 클라이언트 IP 로 세게(안 그러면 모든 요청이 127.0.0.1 하나로 묶인다)
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'planq-mcp' }));

// ── 인증 — Bearer api_token → principal(user_id·business_id·scope) ──
async function authenticate(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = await ApiToken.findOne({ where: { token_hash: sha256(m[1].trim()), revoked_at: null } });
  if (!token) return null;
  if (token.expires_at && new Date(token.expires_at) < new Date()) return null;
  const scope = await getUserScope(token.user_id, token.business_id, null);
  if (!scope || !(scope.isMember || scope.isOwner || scope.isPlatformAdmin || scope.isAdmin)) return null;
  token.update({ last_used_at: new Date() }).catch(() => {});
  return { token, scope, businessId: token.business_id, userId: token.user_id };
}

function auditTool(principal, tool, args) {
  logAudit(null, {
    userId: principal.userId,
    businessId: principal.businessId,
    action: `mcp.${tool}`,
    targetType: 'business',
    targetId: principal.businessId,
    newValue: {
      acting_for: { instructed_by: principal.userId, permission_basis: 'api_token', token_id: principal.token.id },
      args: args || null,
    },
  });
}

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj ?? null, null, 2) }] });

// ── 요청마다 새 McpServer (stateless) — 토큰의 principal 로 툴 클로저 ──
function buildServer(principal) {
  const server = new McpServer({ name: 'planq-mcp', version: '1.0.0' });
  const { scope, businessId } = principal;

  server.registerTool('workspace_overview',
    { description: '현재 워크스페이스 개요 — 진행 중 프로젝트·업무·최근 활동 요약(읽기). 권한 범위 내로 격리됨.', inputSchema: {} },
    async () => {
      auditTool(principal, 'workspace_overview');
      const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
      const r = await ctx.getWorkspaceOverview({ businessId, scope, businessTimezone: biz?.timezone || 'Asia/Seoul' });
      return asText(r);
    });

  server.registerTool('search_workspace',
    { description: '워크스페이스 전방위 검색(프로젝트·고객·업무·문서) — 권한 범위 내.', inputSchema: { query: z.string().min(1).max(200).describe('검색어') } },
    async ({ query }) => {
      auditTool(principal, 'search_workspace', { query });
      const r = await ctx.getWorkspaceMatches({ businessId, scope, query });
      return asText(r);
    });

  server.registerTool('get_client_360',
    { description: '특정 고객 360 스냅샷(프로젝트·업무·청구 요약) — 권한 범위 내.', inputSchema: { client_id: z.number().int().positive().describe('고객 id') } },
    async ({ client_id }) => {
      auditTool(principal, 'get_client_360', { client_id });
      const r = await ctx.getClientSnapshot(client_id, businessId, scope);
      return asText(r);
    });

  server.registerTool('get_project_status',
    { description: '특정 프로젝트 상태 스냅샷(진행·업무·다음 액션) — 권한 범위 내.', inputSchema: { project_id: z.number().int().positive().describe('프로젝트 id') } },
    async ({ project_id }) => {
      auditTool(principal, 'get_project_status', { project_id });
      const r = await ctx.getProjectSnapshot(project_id, businessId, scope);
      return asText(r);
    });

  return server;
}

// ── Streamable HTTP (stateless) ──
app.post('/mcp', async (req, res) => {
  const principal = await authenticate(req).catch(() => null);
  if (!principal) {
    return res.status(401).json({
      jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized — 유효한 PlanQ API 토큰 필요' }, id: null,
    });
  }
  const server = buildServer(principal);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close?.(); server.close?.(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp handleRequest]', e.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal' }, id: null });
  }
});

// stateless: GET(SSE)·DELETE(session) 미지원 → 405
app.get('/mcp', (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed (stateless)' }, id: null }));
app.delete('/mcp', (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed (stateless)' }, id: null }));

// ══════════════════════════════════════════════════════════════════════
// AI 에이전트 표면 (#439) — OAuth 2.1 인증 서버 + /agent/mcp
// ══════════════════════════════════════════════════════════════════════
const AS_METADATA = {
  issuer: agentCfg.ISSUER,
  authorization_endpoint: `${agentCfg.ISSUER}/authorize`,
  token_endpoint: `${agentCfg.ISSUER}/token`,
  registration_endpoint: `${agentCfg.ISSUER}/register`,
  revocation_endpoint: `${agentCfg.ISSUER}/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  scopes_supported: agentCfg.ALL_SCOPES,
};
const PR_METADATA = {
  resource: agentCfg.RESOURCE,
  authorization_servers: [agentCfg.ISSUER],
  scopes_supported: agentCfg.ALL_SCOPES,
  bearer_methods_supported: ['header'],
  resource_name: 'PlanQ',
};
const PRM_URL = `${agentCfg.APP_URL}/.well-known/oauth-protected-resource/agent/mcp`;

// 꺼져 있으면 표면 전체가 없는 것처럼(404) — 무재배포 롤백 스위치 AGENT_ENABLED
const agentOn = (req, res, next) => (agentCfg.enabled() && agentCfg.tokenSecret() ? next() : res.status(404).json({ error: 'not_found' }));

for (const path of ['/.well-known/oauth-authorization-server/agent', '/.well-known/oauth-authorization-server', '/agent/.well-known/oauth-authorization-server']) {
  app.use(path, agentOn, metadataHandler(AS_METADATA));
}
for (const path of ['/.well-known/oauth-protected-resource/agent/mcp', '/agent/mcp/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource']) {
  app.use(path, agentOn, metadataHandler(PR_METADATA));
}
app.use('/agent/authorize', agentOn, authorizationHandler({ provider: agentProvider }));
app.use('/agent/token', agentOn, tokenHandler({ provider: agentProvider, rateLimit: { windowMs: 60 * 1000, max: 30 } }));
app.use('/agent/register', agentOn, clientRegistrationHandler({ clientsStore: agentProvider.clientsStore, rateLimit: { windowMs: 60 * 60 * 1000, max: 20 } }));
app.use('/agent/revoke', agentOn, revocationHandler({ provider: agentProvider }));

// 호출 속도 — 연결(grant) 단위. 분당 60(설계 §9.2). 메모리 창이면 충분하다(프로세스 하나 · 짧은 창).
const callWindow = new Map();
function overRate(grantId) {
  const now = Date.now();
  const w = (callWindow.get(grantId) || []).filter((t) => now - t < 60 * 1000);
  w.push(now);
  callWindow.set(grantId, w);
  return w.length > 60;
}

function unauthorized(res, code) {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${PRM_URL}", error="invalid_token", error_description="${code}"`);
  return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
}

function buildAgentServer(principal) {
  // 클라이언트 목록에 보일 정체 — 이름·설명·아이콘·사이트(MCP serverInfo). 아이콘은 공개 PNG(로그인 없이 열려야 한다).
  //   ★ 지원은 클라이언트마다 다르다 — 2026-10 기준 ChatGPT·Claude 사용자 지정 앱은 이 아이콘을 안 그리는 사례가 많다(디렉터리 앱만 그림).
  const server = new McpServer({
    name: 'planq', title: 'PlanQ', version: '1.0.0',
    description: 'PlanQ — tasks, clients, projects and schedules of your workspace',
    websiteUrl: agentCfg.APP_URL,
    icons: [
      { src: `${agentCfg.APP_URL}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
      { src: `${agentCfg.APP_URL}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
    ],
  });
  for (const tool of AGENT_TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      // .strict() — 모르는 칸(business_id·user_id 등)을 조용히 버리지 않고 거절한다. 범위는 토큰에서만 정한다(설계 §5.1).
      inputSchema: z.object(tool.input).strict(),
      annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: !tool.write, openWorldHint: false },
    }, async (args) => {
      const out = await runTool(principal, tool.name, args || {});
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    });
  }
  return server;
}

app.post('/agent/mcp', agentOn, async (req, res) => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return unauthorized(res, 'missing_token');
  const r = await agentGrants.principalFromAccess(m[1].trim()).catch(() => ({ ok: false, code: 'invalid' }));
  if (!r.ok) return unauthorized(res, r.code);
  if (overRate(r.principal.grantId)) {
    return res.status(429).json({ jsonrpc: '2.0', error: { code: -32029, message: 'rate_limited' }, id: null });
  }
  const server = buildAgentServer(r.principal);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close?.(); server.close?.(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[agent mcp]', e.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal' }, id: null });
  }
});
// 토큰 없는 GET 도 401 챌린지 — 클라이언트가 처음 두드리는 방식이 GET 인 경우가 있다(설계 §4.2 ①)
app.get('/agent/mcp', agentOn, (req, res) => {
  if (!req.headers.authorization) return unauthorized(res, 'missing_token');
  return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed (stateless)' }, id: null });
});
app.delete('/agent/mcp', agentOn, (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed (stateless)' }, id: null }));

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`[planq-mcp] listening on 127.0.0.1:${PORT} (stateless, read-only)`));
}

module.exports = { app, buildServer, buildAgentServer };
