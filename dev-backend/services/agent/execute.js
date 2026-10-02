// AI 에이전트 도구 — **단일 실행 진입점** (#439, 설계 §3·§7·§8·§9).
//
//   순서: 킬스위치 → scope → (쓰기) 계량 게이트 → 멱등 → handler → 감사 → 계량 기록 → 봉투.
//   provider 와 무관하다. MCP 서버는 이 함수만 부른다(도구를 직접 부르지 않는다).
const crypto = require('crypto');
const { z } = require('zod');
const cfg = require('../agent_oauth/config');
const { byName } = require('./registry');
const { AgentError, err, envelope } = require('./errors');
const store = require('../ephemeralStore');

const IDEM_TTL_MS = 10 * 60 * 1000;

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** 감사 입력 — 본문 같은 긴 글은 길이만 남긴다(감사 원장이 사본 저장소가 되지 않게). */
function maskArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k === 'idempotency_key') continue;
    out[k] = typeof v === 'string' && v.length > 120 ? `<${v.length} chars>` : v;
  }
  return out;
}

function audit(p, tool, args, result) {
  require('../auditService').logAudit(null, {
    userId: p.userId,
    businessId: p.businessId,
    action: `agent.${tool}`,
    targetType: result?.target_type || 'business',
    targetId: result?.target_id || p.businessId,
    newValue: {
      acting_for: { instructed_by: p.userId, permission_basis: 'oauth_grant', provider: p.provider, client_id: p.clientId, grant_id: p.grantId },
      args: maskArgs(args),
      result: { ok: result?.ok !== false, code: result?.code || null, replayed: !!result?.replayed },
    },
  });
}

/**
 * @param {object} p   principal(토큰에서만) — { userId, businessId, platformRole, grantId, clientId, provider, scopes }
 * @param {string} name
 * @param {object} rawArgs
 * @returns {Promise<object>} 성공: { ok:true, ...data } / 실패: 봉투 { ok:false, error }
 */
async function runTool(p, name, rawArgs) {
  const tool = byName.get(name);
  const requestId = crypto.randomBytes(6).toString('hex');
  if (!tool) return envelope(err('NOT_FOUND', 'unknown_tool'));
  let args = rawArgs || {};
  let idemKey = null;
  try {
    if (!cfg.enabled()) throw err('AUTH_REQUIRED', 'agent_disabled');
    const missing = tool.scopes.filter((s) => !(p.scopes || []).includes(s));
    if (missing.length) throw err('PERMISSION_DENIED', 'scope', { missing_scopes: missing });
    // 입력 검증 — MCP SDK 가 이미 했지만 이 함수를 다른 입구(Cue 등)가 부를 때를 위해 한 번 더(.strict: 모르는 칸 거절)
    const parsed = z.object(tool.input).strict().safeParse(args);
    if (!parsed.success) {
      throw err('VALIDATION_ERROR', 'invalid_input', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    args = parsed.data;

    if (tool.write) {
      if (!cfg.writeEnabled()) throw err('PERMISSION_DENIED', 'agent_write_disabled');
      const plan = require('../plan');
      const can = await plan.can(p.businessId, 'use_cue', { actions: 1 });
      if (!can.ok) throw err('QUOTA_EXCEEDED', can.reason || 'quota', { limit: can.limit ?? null, current: can.current ?? null });

      // 멱등 — 키를 주면 그 키, 아니면 파라미터 지문. 10분 안에 같은 요청은 한 번만 실행한다(설계 §8).
      const { idempotency_key: k, ...rest } = args;
      idemKey = crypto.createHash('sha256').update(`${p.grantId}|${name}|${k || stableStringify(rest)}`).digest('hex');
      const fresh = await store.setIfAbsent('agent_idem', idemKey, { status: 'pending' }, IDEM_TTL_MS);
      if (!fresh) {
        const row = await store.get('agent_idem', idemKey);
        if (row?.payload?.status === 'done') {
          const out = { ok: true, ...row.payload.result, created: false, replayed: true };
          audit(p, name, args, { ok: true, replayed: true, target_type: row.payload.target_type, target_id: row.payload.target_id });
          return out;
        }
        throw err('CONFLICT', 'in_progress', { retry_after_sec: 2 });
      }
    }

    const actor = { kind: 'user', userId: p.userId, platformRole: p.platformRole, req: null,
      channel: { kind: 'agent', provider: p.provider, grant_id: p.grantId, client_id: p.clientId } };
    const data = await tool.handler(p, args, actor);
    const target = data?.task ? { target_type: 'task', target_id: data.task.task_id }
      : data?.note ? { target_type: 'task_comment', target_id: data.note.note_id } : {};

    if (tool.write) {
      await store.update('agent_idem', idemKey, { status: 'done', result: data, ...target }).catch(() => {});
      const { recordUsage } = require('../cue_orchestrator');
      recordUsage(p.businessId, 'agent_tool', 'gpt-4.1-nano', 0, 0).catch((e) => console.warn('[agent usage]', e.message));
    }
    audit(p, name, args, { ok: true, ...target });
    return { ok: true, ...data };
  } catch (e) {
    // 실패한 쓰기는 멱등 자리를 비운다 — 같은 요청을 고쳐 다시 보낼 수 있게
    if (idemKey && !(e instanceof AgentError && e.code === 'CONFLICT')) await store.del('agent_idem', idemKey).catch(() => {});
    if (!(e instanceof AgentError)) console.error(`[agent ${name}] ${requestId}`, e.message);
    const out = envelope(e, requestId);
    audit(p, name, args, { ok: false, code: out.error.code });
    return out;
  }
}

module.exports = { runTool };
