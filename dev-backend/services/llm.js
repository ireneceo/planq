// LLM 게이트웨이 — PlanQ 의 모든 LLM/임베딩 호출은 여기 하나를 지난다.
//
// 왜 필요한가: 여태 13곳이 각자 `fetch('https://api.openai.com/...')` 를 복붙했다. 그래서
//   - 429(레이트리밋)·502 를 아무도 재시도하지 않았다 → 답변 초안·번역·추출이 조용히 실패
//   - 타임아웃·모델·temperature 가 파일마다 달랐고, 모델을 바꾸려면 13곳을 고쳐야 했다
//   - 한 달에 LLM 을 몇 번 불렀고 몇 번 실패했는지 아무도 몰랐다 (운영 관측 0)
//   - 입력 크기 상한이 없는 호출이 섞여 있었다 (비용 폭탄 — memory: project_cost_guard_audit)
//
// 이 파일이 책임지는 것: 키 확인 · 모델 레지스트리 · 입력 상한 · 타임아웃 · 재시도(백오프) ·
//   실패 시 호출부가 준 fallback 반환(throw 하지 않음 — LLM 은 있으면 좋은 것이지 없으면 죽는 게 아니다) ·
//   토큰/지연/실패 통계.
//
// 이 파일이 책임지지 않는 것 (호출부의 몫): 권한(위임자 principal), 플랜 게이트(plan.can('use_cue')),
//   사용량 차감(recordCueAction), rate-limit(costGuard). 게이트웨이는 "어떻게 부르는가" 만 안다.
//   누가 부를 자격이 있는가는 도메인이 안다 — memory: project_agent_permission_model.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

// 용도별 모델·기본값 레지스트리. 모델 교체는 여기 한 줄 (또는 env LLM_MODEL_<PURPOSE>).
//   maxInputChars — 프롬프트 총량 상한. 넘으면 잘라서 보낸다(요금은 입력 토큰에도 붙는다).
//   ※ 아래 값은 **옛 호출부의 실제 값과 1:1** 이다 (게이트웨이 이관은 동작 무변경 리팩터 — Fable D-1).
//     레지스트리가 실제와 다르면 그건 문서가 아니라 거짓말이다. 값을 바꾸려면 여기서 의도적으로 바꾼다.
const PURPOSES = {
  cue_reply:      { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 400,  timeoutMs: 45_000, maxInputChars: 24_000 },
  cue_task:       { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 1200, timeoutMs: 45_000, maxInputChars: 32_000 },
  task_extract:   { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 1500, timeoutMs: 45_000, maxInputChars: 32_000 },
  task_plan:      { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 2000, timeoutMs: 45_000, maxInputChars: 16_000 },
  task_estimate:  { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 100,  timeoutMs: 20_000, maxInputChars: 12_000 },
  mail_reply:     { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 800,  timeoutMs: 45_000, maxInputChars: 24_000 },
  mail_summary:   { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 500,  timeoutMs: 45_000, maxInputChars: 24_000 },
  translation:    { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 2000, timeoutMs: 20_000, maxInputChars: 16_000 },
  kb_extract:     { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 4000, timeoutMs: 45_000, maxInputChars: 32_000 },
  // kb_tags — 옛 호출부는 temperature 를 아예 안 줬다(= API 기본 1.0). 키워드 추출에 1.0 은 실수에 가깝다
  //   (같은 문서에서 매번 다른 태그가 나온다). **의도적으로** 0.3 으로 낮춘다 — 이 한 줄만 1:1 이 아니다.
  kb_tags:        { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 200,  timeoutMs: 45_000, maxInputChars: 8_000 },
  kb_answer:      { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 800,  timeoutMs: 45_000, maxInputChars: 32_000 },
  docs_generate:  { model: 'gpt-4o-mini', temperature: 0.4, maxTokens: 3000, timeoutMs: 90_000, maxInputChars: 24_000 },
  // brief — 옛 호출부가 자료를 100,000자까지 보냈다(자료 여러 건을 합쳐 요약하는 기능). 상한을 그 아래로
  //   내리면 요약이 조용히 일부 자료를 빠뜨린다. 옛 값을 존중하되 천장은 둔다.
  brief:          { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 4000, timeoutMs: 45_000, maxInputChars: 110_000 },
  // report — 옛 호출부가 데이터를 40,000자로 잘라 보냈다. 게이트웨이 상한을 그보다 낮추면 리포트가
  //   조용히 짧아진다(동작 변경). 옛 값을 그대로 존중한다.
  report:         { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 1200, timeoutMs: 45_000, maxInputChars: 44_000 },
  wiki_cluster:   { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 1500, timeoutMs: 45_000, maxInputChars: 24_000 },
  template:       { model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 1500, timeoutMs: 45_000, maxInputChars: 16_000 },
  generic:        { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 800,  timeoutMs: 45_000, maxInputChars: 16_000 },
};

const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';
const EMBED_TIMEOUT_MS = 30_000;
const EMBED_MAX_CHARS = 8_000;

// 재시도 — 429(레이트리밋)와 5xx(일시 장애)만. 4xx(잘못된 요청)는 다시 보내도 같은 답이다.
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

const stats = {
  calls: 0, ok: 0, failed: 0, fallback: 0, retries: 0,
  input_tokens: 0, output_tokens: 0, total_ms: 0,
  by_purpose: {},   // purpose → { calls, ok, failed, ms }
  last_error: null, // { at, purpose, status, message }
};

function isEnabled() { return !!OPENAI_API_KEY; }

function resolve(purpose, opts = {}) {
  const base = PURPOSES[purpose] || PURPOSES.generic;
  const envModel = process.env[`LLM_MODEL_${String(purpose).toUpperCase()}`];
  return {
    model: opts.model || envModel || base.model,
    temperature: opts.temperature ?? base.temperature,
    maxTokens: opts.maxTokens || base.maxTokens,
    timeoutMs: opts.timeoutMs || base.timeoutMs,
    maxInputChars: opts.maxInputChars || base.maxInputChars,
  };
}

// 입력 총량 상한 — 마지막 메시지(보통 실제 내용)부터 자른다. 시스템 프롬프트는 보존.
function capMessages(messages, maxChars) {
  const total = messages.reduce((n, m) => n + String(m.content || '').length, 0);
  if (total <= maxChars) return { messages, truncated: false };
  const out = messages.map((m) => ({ ...m }));
  let over = total - maxChars;
  for (let i = out.length - 1; i >= 0 && over > 0; i--) {
    if (out[i].role === 'system') continue;
    const c = String(out[i].content || '');
    if (c.length <= 200) continue;
    const keep = Math.max(200, c.length - over);
    over -= (c.length - keep);
    out[i].content = c.slice(0, keep) + '\n…(입력이 길어 일부 생략됨)';
  }
  return { messages: out, truncated: true };
}

function bump(purpose, field, n = 1) {
  const p = stats.by_purpose[purpose] || (stats.by_purpose[purpose] = { calls: 0, ok: 0, failed: 0, ms: 0 });
  p[field] = (p[field] || 0) + n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LLM 호출 (chat completions).
 *
 * @param {object} p
 * @param {string} p.purpose   PURPOSES 키 (모델·상한·타임아웃 결정). 없으면 'generic'
 * @param {Array}  p.messages  [{ role, content }]
 * @param {boolean} [p.json]   JSON 모드 (response_format: json_object)
 * @param {Array} [p.tools]    OpenAI function-calling 툴 목록. 주면 tool_calls 를 그대로 돌려준다.
 *                             ※ 게이트웨이는 **툴을 실행하지 않는다** — 무엇을 부를지 제안만 받는다.
 *                             실행은 행동 계층(services/taskTransition.js 계열)이 권한 검사를 거쳐서 한다.
 *                             "데이터가 바뀌는 것은 사람이 누른 뒤에만" (docs/AI_NATIVE_IMPLEMENTATION_PLAN.md D-2.5).
 * @param {string|object} [p.toolChoice]  'auto' | 'none' | { type:'function', function:{name} }
 * @param {*} [p.fallback]     실패 시 content 로 돌려줄 값 (LLM 은 없으면 못 쓰는 게 아니라 덜 똑똑해질 뿐)
 * @returns {{content, tool_calls, input_tokens, output_tokens, fallback, model, ms, attempts, truncated}}
 */
async function callLLM({ purpose = 'generic', messages, json = false, tools = null, toolChoice = undefined, fallback = '', ...opts }) {
  const cfg = resolve(purpose, opts);
  const started = Date.now();
  stats.calls++; bump(purpose, 'calls');

  if (!isEnabled()) {
    stats.fallback++; bump(purpose, 'failed');
    return { content: fallback, tool_calls: [], input_tokens: 0, output_tokens: 0, fallback: true, model: cfg.model, ms: 0, attempts: 0, truncated: false };
  }

  const capped = capMessages(messages || [], cfg.maxInputChars);
  if (capped.truncated) console.warn(`[llm] ${purpose} 입력 상한 초과 → 잘라서 호출 (max ${cfg.maxInputChars}자)`);

  let lastStatus = 0;
  let lastMessage = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages: capped.messages,
          temperature: cfg.temperature,
          max_tokens: cfg.maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          ...(tools && tools.length ? { tools, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });

      if (!r.ok) {
        lastStatus = r.status;
        lastMessage = (await r.text()).slice(0, 300);
        if (RETRYABLE.has(r.status) && attempt < MAX_ATTEMPTS) {
          // Retry-After 를 존중한다 — 무시하고 두드리면 레이트리밋이 더 길어진다
          const ra = Number(r.headers.get('retry-after'));
          const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * Math.pow(2, attempt - 1);
          stats.retries++;
          console.warn(`[llm] ${purpose} ${r.status} → ${backoff}ms 후 재시도 (${attempt}/${MAX_ATTEMPTS - 1})`);
          await sleep(Math.min(backoff, 8_000));
          continue;
        }
        break;
      }

      const data = await r.json();
      const ms = Date.now() - started;
      const inTok = data.usage?.prompt_tokens || 0;
      const outTok = data.usage?.completion_tokens || 0;
      stats.ok++; stats.input_tokens += inTok; stats.output_tokens += outTok; stats.total_ms += ms;
      bump(purpose, 'ok'); bump(purpose, 'ms', ms);
      return {
        content: data.choices?.[0]?.message?.content || '',
        // 툴 제안 (실행 아님). tools 를 안 준 호출은 항상 빈 배열이라 기존 호출부에 영향 0.
        tool_calls: data.choices?.[0]?.message?.tool_calls || [],
        input_tokens: inTok,
        output_tokens: outTok,
        fallback: false,
        model: cfg.model,
        ms,
        attempts: attempt,
        truncated: capped.truncated,
      };
    } catch (err) {
      lastMessage = err.message || String(err);
      const timedOut = err.name === 'TimeoutError' || /abort/i.test(lastMessage);
      if (timedOut && attempt < MAX_ATTEMPTS) {
        stats.retries++;
        console.warn(`[llm] ${purpose} 타임아웃(${cfg.timeoutMs}ms) → 재시도 (${attempt}/${MAX_ATTEMPTS - 1})`);
        continue;
      }
      break;
    }
  }

  const ms = Date.now() - started;
  stats.failed++; stats.fallback++; stats.total_ms += ms;
  bump(purpose, 'failed'); bump(purpose, 'ms', ms);
  stats.last_error = { at: new Date().toISOString(), purpose, status: lastStatus, message: lastMessage.slice(0, 200) };
  console.warn(`[llm] ${purpose} 실패 (${lastStatus || 'exception'}): ${lastMessage.slice(0, 200)}`);
  return { content: fallback, tool_calls: [], input_tokens: 0, output_tokens: 0, fallback: true, model: cfg.model, ms, attempts: MAX_ATTEMPTS, truncated: capped.truncated };
}

/** 임베딩 — 실패 시 null (호출부가 키워드 검색으로 폴백한다) */
async function embed(text, { model = EMBED_MODEL } = {}) {
  const t = String(text || '').slice(0, EMBED_MAX_CHARS).trim();
  if (!t || !isEnabled()) return null;
  const started = Date.now();
  stats.calls++; bump('embed', 'calls');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch(`${API_BASE}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: t }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!r.ok) {
        if (RETRYABLE.has(r.status) && attempt < MAX_ATTEMPTS) {
          stats.retries++;
          await sleep(400 * Math.pow(2, attempt - 1));
          continue;
        }
        const body = (await r.text()).slice(0, 200);
        stats.failed++; bump('embed', 'failed');
        stats.last_error = { at: new Date().toISOString(), purpose: 'embed', status: r.status, message: body };
        console.warn('[llm] embed 실패', r.status, body);
        return null;
      }
      const data = await r.json();
      const ms = Date.now() - started;
      stats.ok++; stats.total_ms += ms;
      stats.input_tokens += data.usage?.prompt_tokens || 0;
      bump('embed', 'ok'); bump('embed', 'ms', ms);
      return data.data?.[0]?.embedding || null;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) { stats.retries++; continue; }
      stats.failed++; bump('embed', 'failed');
      stats.last_error = { at: new Date().toISOString(), purpose: 'embed', status: 0, message: String(err.message).slice(0, 200) };
      console.warn('[llm] embed 예외', err.message);
      return null;
    }
  }
  return null;
}

/** 운영 관측 — /api/health 와 admin 에서 읽는다.
 *  ※ 스냅샷이다 — 중첩 객체(by_purpose)까지 복사한다. 얕은 복사로 돌려주면 호출부가 "이전 값" 으로
 *    들고 있던 스냅샷이 원본과 함께 변해서, 전후 비교가 **항상 같다고 나온다** (검증이 눈을 감는다). */
function getStats() {
  const avg = stats.ok > 0 ? Math.round(stats.total_ms / stats.ok) : 0;
  return {
    enabled: isEnabled(),
    ...stats,
    by_purpose: JSON.parse(JSON.stringify(stats.by_purpose)),
    last_error: stats.last_error ? { ...stats.last_error } : null,
    avg_ms: avg,
    fail_rate: stats.calls > 0 ? Number((stats.failed / stats.calls).toFixed(3)) : 0,
  };
}

/** 이 용도가 실제로 쓰는 모델 이름 (env override 반영) — 응답에 모델을 표기하는 호출부용 */
function modelFor(purpose) { return resolve(purpose).model; }

module.exports = { callLLM, embed, getStats, isEnabled, modelFor, PURPOSES, EMBED_MODEL };
