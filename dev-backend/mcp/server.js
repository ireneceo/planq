// PlanQ MCP 읽기 서버 (#D-4) — 외부 에이전트(Claude Code 등) 유통 채널.
//
//   별도 프로세스(planq-mcp). dev-backend 를 라이브러리로 require 한다.
//   인증: Bearer api_token → sha256 조회 → getUserScope(user_id, business_id) 교환.
//         **토큰 소유자 scope 로 전 격리** — 별도 권한 체계 없음.
//   툴 4개 전부 **읽기 전용**(cue_context 재포장). 쓰기 툴은 이 표면에 절대 없다(D-4 순서 엄수).
//   Streamable HTTP + stateless(요청마다 새 server·transport). 감사: 전 호출 mcp.<tool>.
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

const PORT = Number(process.env.MCP_PORT) || 3005;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const app = express();
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

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`[planq-mcp] listening on 127.0.0.1:${PORT} (stateless, read-only)`));
}

module.exports = { app, buildServer };
