// AI Task Planner — 자연어 한 줄 → 다중 업무 분해 (사이클 N+1)
// ─────────────────────────────────────────────────────────────
// 설계: docs/AI_TASK_DESIGN.md
// 핵심 원칙:
//   1. 결과물 기반 업무명 강제 ("디자인" X → "메인 페이지 시안 작성" O)
//   2. estimated_hours 1~80 합리적
//   3. 의존성 (depends_on_index) — 0-based 다른 업무 인덱스
//   4. assignee_hint — 멤버 역할 키워드. 후처리에서 BusinessMember.job_title/expertise 매칭
//   5. 사용자 마감/기간 준수 (target_date 명시 시 due_offset_days <= target offset)
//
// LLM: gpt-4o-mini (cue_orchestrator 와 동일 모델), JSON mode

const { recordUsage } = require('./cue_orchestrator');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';

// 결과물 기반 명명 검증 — 단독으로 쓰이면 부적절한 단어 (사용자 인지용)
const VAGUE_WORDS_KO = ['디자인', '개발', '시장조사', '조사', '회의', '미팅', '리뷰', '검토', '확인', '준비', '체크', '논의', '기획', '분석'];
const VAGUE_WORDS_EN = ['design', 'develop', 'research', 'meeting', 'review', 'check', 'discuss', 'prepare', 'plan', 'analyze'];

function detectVague(title, language) {
  const t = String(title || '').trim();
  if (!t) return false;
  const list = language === 'en' ? VAGUE_WORDS_EN : VAGUE_WORDS_KO;
  // 단독 단어 + 공백 추가 + 결과물 명사가 없는 경우만 의심
  // 예: "디자인", "디자인 작업" → vague / "메인 페이지 디자인 시안 작성" → OK (작성/시안 등 결과물 명사 포함)
  const lower = t.toLowerCase();
  const hasOutputNoun = /(작성|발행|제작|등록|보고서|시안|초안|문서|자료|일정표|리스트|목록|결과|보고|배포|런칭|회의록|draft|report|document|deliverable|launch|publish)/i.test(t);
  if (hasOutputNoun) return false;
  return list.some(w => lower.includes(w.toLowerCase()));
}

function buildSystemPrompt(language, members, projectContext, targetDate, todayLocal) {
  const lang = language === 'en' ? 'English' : 'Korean';
  const memberLines = members && members.length > 0
    ? members.map(m => `  - ${m.name}${m.job_title ? ` (${m.job_title}` + (m.expertise ? `, ${m.expertise.slice(0, 60)}` : '') + ')' : ''}`).join('\n')
    : '  (no members)';

  return `You are a senior project-planning expert for a B2B work tool. Decompose a user's natural-language brief into a list of CONCRETE, OUTCOME-NAMED tasks.

═══ ZERO-TOLERANCE NAMING POLICY ═══

Every task title MUST name a deliverable with a clear completion moment.

BAD (vague verbs alone):
  - "디자인" / "design"
  - "시장조사" / "research"
  - "회의" / "meeting"
  - "고객 미팅" / "client meeting"
  - "리뷰" / "review"

GOOD (outcome-named, completion-clear):
  - "메인 페이지 디자인 시안 작성"
  - "경쟁사 비교분석표 작성"
  - "신규 고객사 미팅 회의록 작성"
  - "런칭 체크리스트 발행"

Rules:
1. Each title ends with a completion-noun (작성/발행/제작/등록/배포/런칭/완료) or a deliverable noun (시안/초안/보고서/문서/리스트).
2. NEVER output a title that is just a verb or a domain word.
3. If unsure, name the deliverable explicitly: "X 작성", "Y 발행".

═══ DECOMPOSITION POLICY ═══

- Output 1~12 tasks. Quality > quantity. If the brief is small, output 1 task.
- estimated_hours: realistic 1~80 per task. Sum should match the user's brief scope.
- duration_days: working days (exclude weekends in your reasoning).
- start_offset_days / due_offset_days: integer days from today (today = 0). Respect user's deadline if given.
- priority: "low" | "normal" | "high" | "urgent". Default "normal".
- depends_on_index: 0-based index of another task in the SAME response that must complete first. null if none.
- assignee_hint: a short role keyword (예: "디자이너" / "백엔드 개발자" / "디자이너+개발자") to help the system match a workspace member. null if not inferrable.
- Output ${lang} for titles and descriptions.

═══ CONTEXT ═══

Today: ${todayLocal}
${targetDate ? `User's target deadline: ${targetDate}` : 'No explicit deadline.'}
${projectContext ? `Project context: ${projectContext}` : ''}

Workspace members (use these to infer assignee_hint):
${memberLines}

═══ OUTPUT FORMAT (strict JSON) ═══

{
  "tasks": [
    {
      "title": "<outcome-named title>",
      "description": "<1-line description, optional>",
      "estimated_hours": <int 1-80>,
      "duration_days": <int>,
      "start_offset_days": <int, today=0>,
      "due_offset_days": <int>,
      "priority": "low" | "normal" | "high" | "urgent",
      "assignee_hint": "<short role keyword or null>",
      "depends_on_index": <int or null>
    }
  ],
  "reasoning": "<1-3 sentence explanation of how you decomposed and why>"
}`;
}

async function callOpenAi(systemPrompt, userPrompt) {
  if (!OPENAI_API_KEY) {
    return { content: '{"tasks":[],"reasoning":"OPENAI_API_KEY not configured"}', input_tokens: 0, output_tokens: 0, fallback: true };
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.warn('[aiTaskPlanner] LLM error', r.status, err.slice(0, 200));
      return { content: '{"tasks":[],"reasoning":"LLM error"}', input_tokens: 0, output_tokens: 0, fallback: true };
    }
    const data = await r.json();
    return {
      content: data.choices?.[0]?.message?.content || '{"tasks":[]}',
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      fallback: false,
    };
  } catch (err) {
    console.warn('[aiTaskPlanner] LLM exception', err.message);
    return { content: '{"tasks":[],"reasoning":"LLM exception"}', input_tokens: 0, output_tokens: 0, fallback: true };
  }
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function clampPriority(p) {
  const v = String(p || 'normal').toLowerCase();
  if (['low', 'normal', 'high', 'urgent'].includes(v)) return v;
  return 'normal';
}

// 멤버 fuzzy 매칭 — assignee_hint → BusinessMember
// 일치 1명이면 user_id 반환, 다수/0명이면 null
function matchMemberByHint(hint, members) {
  if (!hint || !members || members.length === 0) return null;
  const h = String(hint).toLowerCase().trim();
  if (!h) return null;
  const matches = members.filter(m => {
    const fields = [m.job_title, m.expertise, m.role].filter(Boolean).join(' ').toLowerCase();
    if (!fields) return false;
    // hint 토큰 중 하나라도 fields 에 포함되면 매칭
    const tokens = h.split(/[\s,/+]+/).filter(t => t.length >= 2);
    return tokens.some(tok => fields.includes(tok));
  });
  if (matches.length === 1) return matches[0].user_id;
  return null;
}

// 메인 — 미리보기 후보 생성
async function planTasksFromPrompt({ prompt, businessId, projectContext, members = [], targetDate = null, todayLocal, language = 'ko' }) {
  if (!prompt || !String(prompt).trim()) {
    return { candidates: [], reasoning: '', fallback: true, error: 'empty_prompt' };
  }
  const systemPrompt = buildSystemPrompt(language, members, projectContext, targetDate, todayLocal);
  const result = await callOpenAi(systemPrompt, String(prompt).trim());

  let parsed;
  try { parsed = JSON.parse(result.content); }
  catch { parsed = { tasks: [], reasoning: 'parse_error' }; }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const candidates = rawTasks.map((t, idx) => {
    const title = String(t.title || '').trim().slice(0, 200);
    const description = String(t.description || '').trim().slice(0, 1000);
    const estimated_hours = clampInt(t.estimated_hours, 1, 80, 4);
    const duration_days = clampInt(t.duration_days, 1, 90, 1);
    const start_offset_days = clampInt(t.start_offset_days, 0, 365, 0);
    const due_offset_days = clampInt(t.due_offset_days, start_offset_days, 365, start_offset_days + duration_days);
    const priority = clampPriority(t.priority);
    const assignee_hint = t.assignee_hint ? String(t.assignee_hint).slice(0, 80) : null;
    const depends_on_index = (Number.isInteger(t.depends_on_index) && t.depends_on_index !== idx && t.depends_on_index >= 0)
      ? t.depends_on_index : null;
    const assignee_user_id = matchMemberByHint(assignee_hint, members);
    const vague = detectVague(title, language);
    return {
      idx,
      title,
      description,
      estimated_hours,
      duration_days,
      start_offset_days,
      due_offset_days,
      priority,
      assignee_hint,
      assignee_user_id,
      depends_on_index,
      vague,
    };
  }).filter(c => c.title);

  // recordUsage — cue_usage 카운터에 'ai_task_create' 액션으로 기록
  if (!result.fallback && businessId) {
    try {
      await recordUsage(businessId, 'ai_task_create', MODEL, result.input_tokens, result.output_tokens);
    } catch (e) { console.warn('[aiTaskPlanner] recordUsage failed', e.message); }
  }

  return {
    candidates,
    reasoning: String(parsed.reasoning || '').slice(0, 1000),
    fallback: result.fallback,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  };
}

module.exports = { planTasksFromPrompt, detectVague, matchMemberByHint };
