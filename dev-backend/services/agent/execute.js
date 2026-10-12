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
const CONFIRM_TTL_MS = 5 * 60 * 1000;   // MEDIUM 미리보기 → 동의 → 재호출까지

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** 감사 입력 — 본문 같은 긴 글은 길이만 남긴다(감사 원장이 사본 저장소가 되지 않게). */
function maskArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    // 키·확인 토큰은 감사에 남기지 않는다 — 토큰 로깅 금지(CLAUDE.md 체크리스트, Fable M2-a 관찰)
    if (k === 'idempotency_key' || k === 'confirmation_token') continue;
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
      // 앱 안 Cue 는 로그인 세션이 근거다(OAuth 동의 없음) — «AI 가 한 일» 필터는 외부·Cue 를 같이 본다
      acting_for: { instructed_by: p.userId, permission_basis: p.provider === 'cue' ? 'session' : 'oauth_grant', provider: p.provider, client_id: p.clientId, grant_id: p.grantId },
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
/** 실제 위험도 — 인자에 따라 올라가는 도구(create_event: 참석자·Meet)는 riskOf 가 정한다. */
const riskOf = (tool, args) => (tool.riskOf ? tool.riskOf(args || {}) : tool.risk);

/**
 * 앱 안 Cue 의 «제안» — 쓰기 도구를 **실행하지 않고** 검증·미리보기만 한다(docs/CUE_REGISTRY_FOLD_DESIGN.md A).
 *   /help 가 부르는 유일한 쓰기 쪽 함수다. 여기서 handler 를 부르면 안 된다(가드 cuetools).
 * @returns {{ ok:true, args, risk, preview } | { ok:false, error }}
 */
async function proposeTool(p, name, rawArgs) {
  const tool = byName.get(name);
  if (!tool || !tool.write) return envelope(err('NOT_FOUND', 'unknown_tool'));
  try {
    if (!cfg.enabledFor(p) || !cfg.writeEnabledFor(p)) throw err('PERMISSION_DENIED', 'agent_write_disabled');
    const missing = tool.scopes.filter((s) => !(p.scopes || []).includes(s));
    if (missing.length) throw err('PERMISSION_DENIED', 'scope', { missing_scopes: missing });
    const parsed = z.object(tool.input).strict().safeParse(rawArgs || {});
    if (!parsed.success) throw err('VALIDATION_ERROR', 'invalid_input', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const args = parsed.data;
    const preview = typeof tool.preview === 'function' ? await tool.preview(p, args) : null;
    return { ok: true, args, risk: riskOf(tool, args), preview };
  } catch (e) {
    if (!(e instanceof AgentError)) console.error(`[agent propose ${name}]`, e.message);
    return envelope(e);
  }
}

async function runTool(p, name, rawArgs, opts = {}) {
  // 사람 확인 면제는 **앱 안 Cue 에만** — 카드를 누른 것이 확인이다. 외부 AI 앱은 언제나 확인 토큰 2단계.
  const humanConfirmed = !!opts.humanConfirmed && p && p.provider === 'cue';
  // Cue 의 읽기 루프는 건별 감사를 남기지 않는다 — /help 가 «이번 질문에 무엇을 읽었는지» 를 1행으로 남긴다(설계 A)
  const tool = byName.get(name);
  const quiet = !!opts.quietRead && p && p.provider === 'cue' && !!tool && !tool.write;
  const requestId = crypto.randomBytes(6).toString('hex');
  if (!tool) return envelope(err('NOT_FOUND', 'unknown_tool'));
  let args = rawArgs || {};
  let idemKey = null;
  try {
    if (!cfg.enabledFor(p)) throw err('AUTH_REQUIRED', 'agent_disabled');
    const missing = tool.scopes.filter((s) => !(p.scopes || []).includes(s));
    if (missing.length) {
      // 별도 동의 scope(mail:*) 는 «재연결 + 체크박스» 로만 얻는다 — 모델이 사용자에게 그 절차를 말하게 한다(설계 M3 §10).
      const optIn = missing.filter((x) => cfg.OPT_IN_SCOPES.includes(x));
      const extra = { missing_scopes: missing };
      if (optIn.length) extra.hint = 'Reconnect PlanQ and allow email access in the consent screen.';
      else extra.hint = 'This PlanQ connection was approved before this ability existed. Ask the user to disconnect and reconnect PlanQ (choose read + write) to allow it.';
      throw err('PERMISSION_DENIED', 'scope', extra);
    }
    // 입력 검증 — MCP SDK 가 이미 했지만 이 함수를 다른 입구(Cue 등)가 부를 때를 위해 한 번 더(.strict: 모르는 칸 거절)
    const parsed = z.object(tool.input).strict().safeParse(args);
    if (!parsed.success) {
      throw err('VALIDATION_ERROR', 'invalid_input', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    args = parsed.data;

    if (tool.write) {
      if (!cfg.writeEnabledFor(p)) throw err('PERMISSION_DENIED', 'agent_write_disabled');
      const plan = require('../plan');
      const can = await plan.can(p.businessId, 'use_cue', { actions: 1 });
      if (!can.ok) throw err('QUOTA_EXCEEDED', can.reason || 'quota', { limit: can.limit ?? null, current: can.current ?? null });

      const { idempotency_key: k, confirmation_token: ct, ...rest } = args;
      const fp = crypto.createHash('sha256').update(`${p.grantId}|${name}|${stableStringify(rest)}`).digest('hex');

      // MEDIUM — 확인 2단계(설계 §7, provider 와 무관). 토큰 없이 오면 **실행하지 않고** 미리보기 + 1회용 토큰을 준다.
      //   토큰은 (연결·도구·인자 지문)에 묶인다 — 다른 업무·다른 날짜에 쓰면 거절한다.
      const risk = riskOf(tool, args);
      if (risk === 'MEDIUM' && !ct && !humanConfirmed) {
        const preview = await tool.preview(p, args);
        const token = crypto.randomBytes(24).toString('base64url');
        await store.set('agent_confirm', crypto.createHash('sha256').update(token).digest('hex'), { grant: p.grantId, tool: name, fp }, CONFIRM_TTL_MS);
        throw err('CONFIRMATION_REQUIRED', 'confirm_with_user', { preview, confirmation_token: token, expires_in_sec: CONFIRM_TTL_MS / 1000 });
      }

      // 멱등 — 키 > 확인 토큰 > 파라미터 지문. 10분 안에 같은 요청은 한 번만 실행한다(설계 §8).
      //   MEDIUM 은 확인 토큰이 곧 키다 — 같은 토큰으로 재시도하면 이미 한 결과를 돌려준다(토큰을 다시 소비하지 않는다).
      //   ★ 확인 토큰을 키로 쓸 때는 인자 지문도 묶는다 — 토큰만 키로 두면, 쓴 토큰을 **다른 인자**로 다시 보냈을 때
      //     앞 결과를 «replayed» 로 돌려줘 모델이 다른 대상도 처리된 줄 안다(2026-10-07 create_project 검증 실측).
      idemKey = crypto.createHash('sha256').update(`${p.grantId}|${name}|${k || (ct ? `${ct}|${fp}` : stableStringify(rest))}`).digest('hex');
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
      if (risk === 'MEDIUM' && !humanConfirmed) {
        const h = crypto.createHash('sha256').update(ct).digest('hex');
        const row = await store.get('agent_confirm', h);
        const okToken = row && row.payload?.grant === p.grantId && row.payload?.tool === name && row.payload?.fp === fp
          && (await store.consume('agent_confirm', h)) === 1;
        if (!okToken) throw err('PERMISSION_DENIED', 'confirmation_invalid');
      }
    }

    const actor = { kind: 'user', userId: p.userId, platformRole: p.platformRole, req: null,
      channel: { kind: 'agent', provider: p.provider, grant_id: p.grantId, client_id: p.clientId } };
    const data = await tool.handler(p, args, actor);
    const target = data?.draft ? { target_type: 'email_draft', target_id: data.draft.draft_id }
      : data?.task ? { target_type: 'task', target_id: data.task.task_id }
      // ★ note 는 메모 도구만 객체로 준다 — 문서 도구는 안내 **문자열** note 를 같이 돌려줘서, 이 줄이 문자열에
      //   걸리면 대상이 «task_comment / 워크스페이스 id» 로 남았다(Fable 행 5 D1, 2026-10-07 실측).
      : (data?.note && typeof data.note === 'object') ? { target_type: 'task_comment', target_id: data.note.note_id }
        : data?.interaction ? { target_type: 'client_interaction', target_id: data.interaction.interaction_id }
          : data?.project_note ? { target_type: 'project_note', target_id: data.project_note.note_id }
            : data?.file ? { target_type: 'file', target_id: data.file.file_id }
              : data?.document ? { target_type: 'post', target_id: data.document.post_id }
                // 일정 — 없어서 agent.create_event 감사가 전부 «business» 로 남았다(Fable 59fba176 검증, 2026-10-07)
                : data?.event?.event_id ? { target_type: 'calendar_event', target_id: data.event.event_id }
                  : data?.project?.project_id && data?.created ? { target_type: 'project', target_id: data.project.project_id }
                    : data?.memo?.memo_id ? { target_type: 'qnote_session', target_id: data.memo.memo_id }
                      : data?.knowledge_item?.kb_id ? { target_type: 'KbDocument', target_id: data.knowledge_item.kb_id } : {};

    if (tool.write) {
      await store.update('agent_idem', idemKey, { status: 'done', result: data, ...target }).catch(() => {});
      // Cue 업무 묶음의 행(p.meter === false, provider cue 한정)은 계량하지 않는다 — 묶음을 낸 /help 턴이 1회 계량했다.
      if (!(p.provider === 'cue' && p.meter === false)) {
        const { recordUsage } = require('../cue_orchestrator');
        recordUsage(p.businessId, 'agent_tool', 'gpt-4.1-nano', 0, 0).catch((e) => console.warn('[agent usage]', e.message));
      }
    }
    if (!quiet) audit(p, name, args, { ok: true, ...target });
    return { ok: true, ...data };
  } catch (e) {
    // 실패한 쓰기는 멱등 자리를 비운다 — 같은 요청을 고쳐 다시 보낼 수 있게
    //   단, «같은 요청이 지금 실행 중»(in_progress) 은 남의 자리다 — 지우면 동시 요청이 두 번 실행된다.
    //   다른 CONFLICT(초안이 이미 있음 등)는 이 요청이 실패한 것이라 자리를 비운다 — 안 그러면 사용자가 원인을 치운 뒤
    //   같은 요청을 다시 보내도 10분간 in_progress 로 막힌다(2026-10-04 M3-c create_mail_reply_draft).
    if (idemKey && !(e instanceof AgentError && e.code === 'CONFLICT' && e.message === 'in_progress')) await store.del('agent_idem', idemKey).catch(() => {});
    if (!(e instanceof AgentError)) console.error(`[agent ${name}] ${requestId}`, e.message);
    const out = envelope(e, requestId);
    if (!quiet) audit(p, name, args, { ok: false, code: out.error.code });
    return out;
  }
}

module.exports = { runTool, proposeTool, riskOf };
