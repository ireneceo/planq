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

// LLM 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, isEnabled, modelFor } = require('./llm');
const MODEL = modelFor('task_plan');

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

function buildSystemPrompt(language, members, projectContext, targetDate, todayLocal, mode, workstreams = [], routineCtx = null) {
  const lang = language === 'en' ? 'English' : 'Korean';
  // #354 루틴 설계 모드 — 일회성 분해가 아니라 **상시 반복 체계**를 설계한다.
  //   ★ 여기서 만들지 않는 것(Fable 판정): 성과지표(측정 방법 없는 지표 금지 — #358 게이트가 먼저),
  //     Q Records 자동 개설(문서 종속 자원이라 고아를 낳는다 — #360 이 먼저), 전략 필드 쓰기.
  //     산출물 저장 위치는 **지침 안의 한 섹션**으로 쓴다 — 저장할 컬럼이 아직 없다.
  // ★ 이 블록은 프롬프트 **맨 끝**에 붙인다. 앞에 붙였더니 뒤따르는 거대 본문
  //   (분해 정책·명명 규칙·OUTPUT FORMAT)에 묻혀 계약이 셋이나 무시됐다 — 실측:
  //   영역 1개(요구 3~8) · 지침 136자(요구 500~1,500) · pipeline_refs 0건.
  //   같은 지시라도 마지막에 오면 지켜진다. 서버 재요구(아래 enforceRoutineContract)와 2중으로 건다.
  const routineBlock = mode === 'routine' ? `

═══ ROUTINE DESIGN MODE — FINAL REQUIREMENTS. THESE OVERRIDE EVERY RULE ABOVE ═══

The user wants a RECURRING OPERATING SYSTEM, not a one-off project breakdown.
Design it in two layers: **areas** (work groups) and **recurring tasks** placed into those areas.

1. AREAS — 3~8 areas that carve up this project's ongoing work. Output them in "areas".
   - **You MUST output at least 3 areas when you output 4 or more tasks.** Grouping every routine
     under one area is a FAILED design — the point of this mode is to give the work a structure.
   - Reuse EXISTING work groups when one already covers the ground: copy its name EXACTLY and set "existing": true.
     Reusing one existing area does NOT mean everything goes into it — add the areas the rest of the work needs.
   - Only invent a new area when nothing existing fits. New areas: "existing": false.
   - An area is a standing domain of responsibility (예: "리서치 운영", "콘텐츠 발행"), NOT a project phase
     (요구정의/설계/QA 같은 단계 이름은 여기서 틀렸다 — 그건 일회성 프로젝트의 어휘다).
   - description: 1~2 sentences on what belongs in this area.

2. TASKS — every task MUST be recurring. "recurrence_rule" is REQUIRED (never null) in this mode.
   - "area_ref": the 0-based index of the area in "areas" this task belongs to. Required.
   - "completed": ALWAYS false in this mode.
   - "pipeline_refs": 0-based indexes of OTHER tasks in this response that feed this one
     (예: 일간 기록 → 주간 정리 → 월간 회고). Up to 5. Use it to express the routine pipeline.
     **At least one task MUST have a non-empty pipeline_refs** — a routine system where nothing
     feeds anything is not a system. Lower-frequency tasks consume higher-frequency ones:
     the weekly task references the daily task's index, the monthly references the weekly.
     Leave "depends_on_index" null in this mode — pipeline_refs replaces it.
   - "instruction" is REQUIRED and substantial: **at least 300 characters, target 500~1,200**, markdown.
     A 150-character instruction is a FAILED output — that is a description, not a guide.
     Write the actual procedure someone follows: numbered steps, what to check, what "done" looks like.
     It MUST end with the section where the output is recorded:
       ${language === 'en' ? '"## Deliverable & where it goes"' : '"## 산출물과 기록 위치"'}
     — name the concrete artifact and the place it lands (문서·표·지식 항목 등). Be specific.

     COPY THIS SHAPE AND DEPTH (this is the minimum acceptable length):
     """
     ${language === 'en' ? `## Steps
     1. Open the reading queue and pick the 1-2 papers with the highest relevance to this week's research question.
     2. For each paper, capture: the claim, the evidence behind it, the method's limits, and what it changes for us.
     3. Write one paragraph in your own words. Do NOT paste the abstract — if you cannot restate it, you have not read it.
     4. Tag it with the theme so the weekly roll-up can pick it up.

     ## Checks before closing
     - Every entry names a source (title + link).
     - At least one line says what this changes for our own work. An entry with no "so what" is not done.
     - If nothing was worth recording today, record that fact with one line of reasoning — silence is not a record.

     ## Deliverable & where it goes
     One dated entry per paper in the Insight Log table, with columns: date / source / claim / implication / tag.` : `## 절차
     1. 읽기 대기열에서 이번 주 리서치 질문과 관련도가 높은 논문 1~2편을 고른다.
     2. 편마다 다음을 뽑는다 — 주장 / 근거 / 방법의 한계 / 우리에게 달라지는 점.
     3. 자기 말로 한 문단을 쓴다. 초록을 붙여넣지 않는다 — 다시 못 쓰면 읽은 것이 아니다.
     4. 주간 정리가 집어갈 수 있도록 주제 태그를 단다.

     ## 닫기 전 점검
     - 항목마다 출처(제목 + 링크)가 있는가.
     - "우리 작업에 무엇이 달라지는가" 가 최소 한 줄 있는가. 그게 없으면 끝난 것이 아니다.
     - 오늘 기록할 것이 없었다면 그 사실을 한 줄 근거와 함께 남긴다 — 빈칸은 기록이 아니다.

     ## 산출물과 기록 위치
     Insight Log 표에 논문 1편당 1행 — 날짜 / 출처 / 주장 / 시사점 / 태그.`}
     """

3. LOAD BALANCE — this is what makes a routine survivable. Before finalizing, count how many tasks
   land on a typical weekday. **Keep it at or under 3 recurring tasks per weekday.** If your draft
   exceeds that, do NOT just delete work — move it to a lower frequency (daily → 주 3회 → 주 1회).
   Prefer WEEKLY/MONTHLY for anything that does not genuinely need daily cadence.

4. Do NOT invent success metrics, KPIs, or strategy statements. That is not your job in this mode.
${routineCtx?.strategy?.context || routineCtx?.strategy?.goal ? `
Project strategy already set by the user — your routine must SERVE this, never contradict it:
${routineCtx.strategy.context ? `  Background: ${String(routineCtx.strategy.context).slice(0, 800)}` : ''}
${routineCtx.strategy.goal ? `  Goal: ${String(routineCtx.strategy.goal).slice(0, 800)}` : ''}` : ''}
${routineCtx?.existingRecurring?.length ? `
Recurring tasks ALREADY running in this project — do NOT duplicate these, and count them in your load balance:
${routineCtx.existingRecurring.slice(0, 40).map((t) => `  - ${t.title} [${t.recurrence_rule}]`).join('\n')}` : ''}

Additional output key for this mode:
  "areas": [ { "title": "<area name>", "description": "<1-2 sentences>", "existing": <bool> } ]
` : '';
  // quick 모드 — "Cue에게 말하기" 바의 캐주얼 한마디. 분해 최소화(보통 1개), 사용자가 명시적으로
  // 여러 산출물을 나열했을 때만 다중. 일반 모달은 mode 없음(기존 분해 정책 유지).
  const quickBlock = mode === 'quick' ? `

═══ QUICK CAPTURE MODE (override decomposition) ═══

This input came from a casual one-line "talk to me" bar. The user expects ONE task unless they clearly listed multiple distinct deliverables.
- Default to exactly 1 task. Do NOT auto-expand a single deliverable into phases.
- Only output multiple tasks if the user explicitly enumerated separate deliverables (예: "A 하고 B 하고 C") or asked to break it down.
- Still apply the naming policy (outcome-named title) and respect any stated deadline.
- This QUICK rule OVERRIDES the "minimum 3 tasks" / domain-expansion rules below.
` : '';

  // #353 ② — 업무그룹(워크스트림) 배치. 이름을 알려주지 않으면 LLM 이 힌트를 지어내고,
  //   지어낸 이름은 confirm 의 보수 매칭에서 전부 미배치로 떨어진다(기능이 있으나 마나가 된다).
  const workstreamBlock = (workstreams && workstreams.length)
    ? `\nProject work groups (workstreams) — set workstream_hint to the EXACT name from this list, or null:\n`
      + workstreams.map((w) => `  - ${w}`).join('\n')
    : '';
  const memberLines = members && members.length > 0
    ? members.map(m => `  - ${m.name}${m.job_title ? ` (${m.job_title}` + (m.expertise ? `, ${m.expertise.slice(0, 60)}` : '') + ')' : ''}`).join('\n')
    : '  (no members)';

  return `You are a 30-year veteran project planning consultant with deep expertise across web/app development, marketing campaigns, sales pipelines, content production, event planning, and operations. You have personally launched hundreds of projects and know the standard professional workflow for any business domain.
${quickBlock}

═══ EXPERT-LEVEL QUALITY BAR (zero-compromise) ═══

NO MATTER HOW BRIEF OR VAGUE THE USER'S INPUT, your output MUST be:
  - Comprehensively staged (요구정의 → 설계 → 실행 → 검수 → 런칭/배포 — fill in domain-appropriate phases)
  - Realistically dependency-ordered (downstream tasks reference upstream as depends_on_index)
  - Time-balanced (no single task > 40 hours unless truly atomic; split if over)
  - Domain-standard (use industry-standard task names — e.g. for web dev: 와이어프레임/시안/퍼블리싱/QA/런칭)

If the user input is vague (예: "쇼핑몰 만들기"), apply the standard professional template for that domain. Do NOT output a tiny 1-2 task list — fill in the missing context with industry best practice.

If the user input is too ambiguous to infer ANY domain, output 5-7 universal phases (요구정의서 작성 / 일정 계획서 작성 / 실행 단계별 결과물 작성 / 중간 검수 보고서 작성 / 최종 산출물 발행 / 런칭 보고서 작성).

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

- Output 5~15 tasks for normal scope. Minimum 3 even for "simple" requests (요구정의 → 실행 → 검수 발행).
- Single-task requests (예: "보고서 1장 작성") = 1-2 tasks OK, but verify the user explicitly stated "single".
- estimated_hours: realistic 1~80 per task. If a task estimates >40h, SPLIT it into sub-tasks.
- duration_days: working days (exclude weekends in your reasoning). Sequential dependency = next task starts after previous ends.
- start_offset_days / due_offset_days: integer days from today (today = 0). Respect user's deadline if given. If no deadline, distribute realistically.
- priority: "low" | "normal" | "high" | "urgent". **Default is "normal". Most tasks are "normal".**
  This field exists to make a FEW tasks stand out. If everything is "high", nothing is.
  · "urgent"  — only when it blocks other people RIGHT NOW, or its deadline is within ~2 days.
  · "high"    — at most **one or two per plan**, and only for the single critical-path item
                whose slip moves the whole deadline. Being on the critical path is NOT enough by itself.
  · "low"     — nice-to-have, safely droppable.
  If you are unsure, answer "normal". Do not use importance to express enthusiasm.
- recurrence_rule: an RFC-5545 RRULE string, ONLY when the task is an explicitly repeating routine
  (예: "매일 논문 읽기", "평일 아침 SNS", "매월 마지막 평일 결산", "분기 보고"). One-off work → null.
  FREQ MUST be one of DAILY / WEEKLY / MONTHLY / YEARLY. Never HOURLY or MINUTELY.
  The task's due date is the first occurrence (DTSTART) — do NOT put DTSTART in the string.
  Examples (copy the shape):
    매일           FREQ=DAILY
    평일만         FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
    월·수·금       FREQ=WEEKLY;BYDAY=MO,WE,FR
    격주           FREQ=WEEKLY;INTERVAL=2;BYDAY=MO
    매월 n일       FREQ=MONTHLY;BYMONTHDAY=15
    매월 마지막 평일 FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1
    매월 둘째 화요일 FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2
    분기마다       FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1
    매년           FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=2
  End condition — add ONLY when the user stated one: ';COUNT=12' (n times) or ';UNTIL=20261231T235959Z' (until a date).
- recurrence: legacy field — "none" | "daily" | "weekly" | "monthly". Set it to match recurrence_rule
  when the rule is one of those simple shapes, otherwise "none". recurrence_rule always wins.
- completed: true ONLY when the user says the work is ALREADY DONE and just needs to be recorded
  (예: "완료로 추가해줘", "이건 어제 끝냈어 기록만 해줘"). Anything the user still has to do → false. Default false.
  A completed task is recorded on today's date. Never combine completed:true with a recurrence.
- depends_on_index: 0-based index of another task in the SAME response that must complete first. Use this aggressively — most tasks have at least one upstream.
- assignee_hint: short role keyword (예: "디자이너" / "백엔드 개발자" / "마케터" / "기획자"). Match domain expertise.
- assignee_name: if the user EXPLICITLY named a specific person to handle this task (예: "루아에게 요청", "민수가 맡아"), set the EXACT member name copied from the Workspace members list below. Otherwise null. Names take priority over assignee_hint.
- description: 1-2 sentences explaining what the deliverable contains. CRITICAL — if the user's input contains any URL/link or specific reference, PRESERVE it verbatim inside the description (never drop the link). Capture the user's actual request faithfully; do NOT replace it with a generic restatement.
- instruction: OPTIONAL long-form execution guide for the assignee — steps, checklist, standards, references.
  Write it ONLY when the user asked for a routine/guideline or the task genuinely needs multi-step guidance
  (반복 루틴은 거의 항상 필요하다). Markdown is fine. Keep it under 6,000 characters. null when not needed.
  description stays SHORT (1-2 sentences) even when instruction is long — they are different fields.
- Output ${lang} for titles and descriptions.

═══ DOMAIN-AWARE EXPANSION (apply when user input is brief) ═══

If the user mentions a domain, automatically include the standard phases for that domain:

Web/App development → 요구사항 정의 / 사이트맵·와이어 / 디자인 시안 / 퍼블리싱 / 백엔드 / DB·API / QA / 런칭 / 모니터링 보고서
Marketing campaign → 목표·KPI 정의 / 페르소나 / 채널 배분 / 소재 디자인 / 셋업·검수 / 런칭 / 주간 분석 / 종합 보고서
Sales pipeline → 리드 정의 / 접근 자료 작성 / 미팅 / 견적·제안 / 계약 / 납품 / 결제 청구 / 회고
Content production → 주제 리스트 / 일정 / 초안 / 검수·이미지 / 발행
Event/Workshop → 콘셉트 / 일정·장소 / 안내문 / 자료 준비 / 진행 체크리스트 / 회고 보고서
Internal ops → 현황 정리 / 분석 보고서 / 액션 아이템 정의 / 실행 / 결과 검토

═══ CONTEXT ═══

Today: ${todayLocal}
${targetDate ? `User's target deadline: ${targetDate}` : 'No explicit deadline.'}
${projectContext ? `Project context: ${projectContext}` : ''}

Workspace members (use these to infer assignee_hint):
${memberLines}
${workstreamBlock}

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
      "recurrence_rule": "<RRULE string or null>",
      "recurrence": "none" | "daily" | "weekly" | "monthly",
      "instruction": "<long-form execution guide or null>",
      "workstream_hint": "<exact work group name from the list above, or null>",
      "completed": <true only if the user said it is already finished, else false>,
      "assignee_hint": "<short role keyword or null>",
      "assignee_name": "<exact member name if user named a person, else null>",
      "depends_on_index": <int or null>,
      "area_ref": <int index into "areas", routine mode only, else omit>,
      "pipeline_refs": [<int>, ...]   // routine mode only, else omit
    }
  ],
  "reasoning": "<ONE short phrase (max 30 Korean chars / 60 English chars) naming WHAT was broken out. No justification, no restating the user's request, no meta-commentary about the decomposition itself. Good: \\"계획서 작성 1건으로 정리했어요\\". Bad: \\"사용자의 요청에 따라 ... 단일 작업을 정의했습니다. 이 작업은 ... 필요합니다\\">"
}${routineBlock}`;
}

async function callOpenAi(systemPrompt, userPrompt, purpose = 'task_plan') {
  if (!isEnabled()) {
    return { content: '{"tasks":[],"reasoning":"OPENAI_API_KEY not configured"}', input_tokens: 0, output_tokens: 0, fallback: true };
  }
  const r = await callLLM({
    // #354 — 루틴 설계는 출력이 6배라 별도 purpose(routine_plan). 여기서 task_plan 으로 고정하면
    //   12,000토큰 상한이 2,000 으로 되돌아가 JSON 이 중간에서 잘린다(= 전량 유실).
    purpose,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    json: true,
    fallback: '{"tasks":[],"reasoning":"LLM error"}',   // 실패해도 화면은 빈 목록으로 살아 있어야 한다
  });
  return {
    content: r.content || '{"tasks":[]}',
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
    fallback: r.fallback,
    // ★ 'length' = 출력 상한에서 **잘린** 응답. 잘린 JSON 은 파싱에 실패해 tasks 가 0건이 되는데,
    //   그것을 "추출 못 함" 으로 내보내면 사용자는 85초를 기다린 끝에 "더 구체적으로 입력해 주세요"
    //   라는 거짓 안내를 받는다 — 더 구체적으로 쓰면 출력이 더 길어져 오히려 악화된다(Fable 실측).
    finish_reason: r.finish_reason || null,
  };
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

// #90 — 사용자가 명시한 이름 → 멤버 매칭. 워크스페이스 표시명(name) / 계정명(account_name) 둘 다.
// 정확 일치 우선, 없으면 포함(부분) 일치. 1명 확정 시 user_id, 다수/0명이면 null.
//
// opts.exactOnly — 2) 포함 일치를 건너뛴다. 음성 입력(routes/voice.js)처럼 사용자가 오타를
//   눈으로 고칠 기회 없이 곧장 해석되는 경로용. 멤버 '김지원' 이 있을 때 "지원팀에 공유" 가
//   김지원으로 확정되는 오배정을 막는다 (그 배정은 알림 발송까지 이어진다).
function matchMemberByName(name, members, opts = {}) {
  if (!name || !members || members.length === 0) return null;
  const n = String(name).toLowerCase().trim();
  if (n.length < 2) return null;
  const nameOf = (m) => [m.name, m.account_name, m.name_localized].filter(Boolean).map(s => String(s).toLowerCase());
  // 1) 정확 일치
  let hit = members.filter(m => nameOf(m).some(x => x === n));
  if (hit.length === 1) return hit[0].user_id;
  if (hit.length > 1) return null;
  if (opts.exactOnly) return null;
  // 2) 포함 일치 (이름이 멤버명에 포함되거나 그 반대 — "루아에게" 같은 조사 흡수)
  hit = members.filter(m => nameOf(m).some(x => x.length >= 2 && (n.includes(x) || x.includes(n))));
  if (hit.length === 1) return hit[0].user_id;
  return null;
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
const { sanitizeRRule } = require('./rruleFromRecurrence');

// #353 ③ — 장문 실행 지침 상한. description(요약)과 달리 여기엔 체크리스트·기준이 들어간다.
const MAX_INSTRUCTION_LEN = 8000;

// 잘린 응답이라도 tasks 가 온전히 들어왔으면 쓸 수 있다 — 무조건 버리지 않는다.
function rawTasksUsable(parsed) {
  return !!parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0;
}

// #354 — 영역 상한. 넘으면 LLM 이 "영역" 을 업무 수준으로 잘게 쪼갠 것이라 설계가 아니다.
const MAX_AREAS = 12;
// 루틴 지침 최소 길이. **Irene 이 손으로 쓴 실데이터가 175~1,001자**(#354 원문)라 그 하한을
//   그대로 쓰면 한 문장짜리도 통과한다. 중간값 근처인 300 을 바닥으로 둔다 —
//   이 값을 넘기면 재요구(LLM 1회 추가)가 발화하므로, 올릴수록 비용이 는다.
const MIN_ROUTINE_INSTRUCTION = 300;
// 영역 이름 정규화 — confirm 의 워크스트림 매칭과 **같은 규칙**이어야 한다(공백 제거 + 소문자).
//   여기와 저기가 다르면 "기존 영역 재사용" 이 어긋나 같은 이름 워크스트림이 중복 생성된다.
function normAreaKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

async function planTasksFromPrompt({ prompt, businessId, projectContext, members = [], workstreams = [], targetDate = null, todayLocal, language = 'ko', mode = null, instruction = null, instructions = null, baseCandidates = null, strategy = null, existingRecurring = null, baseAreas = null }) {
  if (!prompt || !String(prompt).trim()) {
    return { candidates: [], reasoning: '', fallback: true, error: 'empty_prompt' };
  }
  const isRoutine = mode === 'routine';
  let systemPrompt = buildSystemPrompt(language, members, projectContext, targetDate, todayLocal, mode, workstreams,
    isRoutine ? { strategy, existingRecurring } : null);
  // KNOWLEDGE_LOOP 축1 — 워크스페이스 카테고리별 실측 소요시간 통계 주입 (estimated_hours 정확도 ↑)
  try { systemPrompt += await require('./cueKnowledge').getWorkPatternPromptBlock(businessId); } catch { /* noop */ }
  // 운영 #312 — 재생성은 "처음부터 다시 분해" 가 아니라 **"직전 결과를 고쳐 쓰기"** 다.
  //   여태 지시를 한 줄만 붙여 매번 백지에서 다시 분해했고, 그래서 두 번째 지시를 주면
  //   첫 번째 지시가 통째로 풀렸다 (Irene: "히스토리 날리고 수정하면 의미가 있어?").
  //   → ① 지시를 누적해서 순서대로 넘기고 ② 직전 후보 목록을 원본으로 같이 넘긴다.
  let userPrompt = String(prompt).trim();
  const insList = (Array.isArray(instructions) ? instructions : (instruction ? [instruction] : []))
    .map(x => String(x || '').trim()).filter(Boolean).slice(-10).map(x => x.slice(0, 1000));
  if (Array.isArray(baseCandidates) && baseCandidates.length) {
    const brief = baseCandidates.slice(0, 30).map((c, i) => {
      const t = String(c.title || '').slice(0, 120);
      const d = String(c.description || '').slice(0, 200);
      return `${i + 1}. ${t}${d ? ` — ${d}` : ''}`;
    }).join('\n');
    userPrompt += (language === 'en'
      ? '\n\n[Current task list — revise THIS list. Keep items the instructions do not mention, unchanged]\n'
      : '\n\n[현재 업무 목록 — 이 목록을 **고쳐서** 낸다. 지시가 언급하지 않은 항목은 그대로 유지]\n') + brief;
  }
  if (insList.length) {
    const label = language === 'en'
      ? '\n\n[Revision instructions — cumulative, oldest first. Apply ALL of them; later ones win on conflict]\n'
      : '\n\n[수정 지시 — 앞에서 뒤로 누적된 요구다. **모두** 반영한다. 충돌하면 뒤엣것을 따른다]\n';
    userPrompt += label + insList.map((x, i) => `${i + 1}. ${x}`).join('\n');
  }
  // #354 — 재생성 때 **영역도 같이** 원본으로 넘긴다. 업무 목록만 넘기면 "영역을 5개로 줄여"
  //   같은 지시가 볼 대상 자체를 못 봐서 반쪽 재생성이 된다.
  if (isRoutine && Array.isArray(baseAreas) && baseAreas.length) {
    const abrief = baseAreas.slice(0, MAX_AREAS)
      .map((a, i) => `${i}. ${String(a.title || '').slice(0, 120)}${a.description ? ` — ${String(a.description).slice(0, 160)}` : ''}`)
      .join('\n');
    userPrompt += (language === 'en'
      ? '\n\n[Current areas — revise THIS list. area_ref indexes refer to it]\n'
      : '\n\n[현재 영역 목록 — 이 목록을 **고쳐서** 낸다. area_ref 는 이 목록을 가리킨다]\n') + abrief;
  }
  const result = await callOpenAi(systemPrompt, userPrompt, isRoutine ? 'routine_plan' : 'task_plan');

  let parsed;
  let parseFailed = false;
  try { parsed = JSON.parse(result.content); }
  catch { parsed = { tasks: [], reasoning: 'parse_error' }; parseFailed = true; }

  // ★ 조용한 0건 차단 — 응답이 **상한에서 잘렸는지**를 먼저 본다.
  //   잘린 JSON 은 파싱에 실패해 tasks 0건이 되는데, 그걸 "추출 못 함" 으로 내보내면
  //   사용자는 오래 기다린 끝에 "더 구체적으로 입력해 주세요" 를 본다 — 정반대 처방이다
  //   (더 구체적으로 쓰면 출력이 길어져 더 잘린다). 원인을 이름으로 돌려준다.
  //   memory: feedback_silent_no_output_paths — 오류 없이 산출물만 0인 경로.
  const truncated = result.finish_reason === 'length';
  if (!result.fallback && (truncated || parseFailed)) {
    console.warn('[aiTaskPlanner] 응답 절단/파싱 실패 —',
      `finish_reason=${result.finish_reason} parseFailed=${parseFailed}`,
      `out_tokens=${result.output_tokens} content_len=${(result.content || '').length}`);
  }
  if (truncated && !rawTasksUsable(parsed)) {
    return {
      candidates: [], areas: [], routine_shortfall: null,
      reasoning: '', fallback: false,
      error: 'output_truncated',
      input_tokens: result.input_tokens, output_tokens: result.output_tokens,
    };
  }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  // #354 — 영역 정규화. 기존 워크스트림과 같은 이름이면 LLM 이 뭐라 했든 existing:true 로 **서버가** 정한다
  //   (LLM 의 self-report 를 믿으면 같은 이름 워크스트림이 중복 생성된다).
  const existingKeys = new Set((workstreams || []).map(normAreaKey).filter(Boolean));
  let areas = [];
  if (isRoutine) {
    const rawAreas = Array.isArray(parsed.areas) ? parsed.areas : [];
    const seen = new Set();
    areas = rawAreas.map((a) => ({
      title: String(a?.title || '').trim().slice(0, 200),
      description: a?.description ? String(a.description).trim().slice(0, 1000) : null,
    })).filter((a) => {
      if (!a.title) return false;
      const k = normAreaKey(a.title);
      if (seen.has(k)) return false;      // 같은 영역을 두 번 내는 경우 — 뒤엣것 버림
      seen.add(k);
      return true;
    }).slice(0, MAX_AREAS).map((a, i) => ({
      idx: i,
      title: a.title,
      description: a.description,
      existing: existingKeys.has(normAreaKey(a.title)),
    }));
  }
  let areaCount = areas.length;

  // ★ LLM 은 배열에 null·문자열을 섞어 보낸다(실측: tasks 22건 중 일부가 null).
  //   방어 없이 map 하면 `Cannot read properties of null` 로 **요청 전체가 500** 이 된다.
  //   여기는 루틴 전용이 아니라 일반 분해도 지나는 길이므로 같은 자리에서 한 번만 막는다.
  //   ※ idx 는 걸러낸 **뒤** 기준이어야 한다 — depends_on_index·pipeline_refs·area_ref 가
  //     가리키는 번호가 걸러내기 전 번호면 서로 다른 업무를 가리키게 된다.
  const buildCandidates = (rawArr) => (Array.isArray(rawArr) ? rawArr : [])
    .filter((t) => t && typeof t === 'object' && String(t.title || '').trim())
    .map((t, idx, arr) => {
    const title = String(t.title || '').trim().slice(0, 200);
    const description = String(t.description || '').trim().slice(0, 1000);
    const estimated_hours = clampInt(t.estimated_hours, 1, 80, 4);
    const duration_days = clampInt(t.duration_days, 1, 90, 1);
    const start_offset_days = clampInt(t.start_offset_days, 0, 365, 0);
    const due_offset_days = clampInt(t.due_offset_days, start_offset_days, 365, start_offset_days + duration_days);
    const priority = clampPriority(t.priority);
    // #262 후속 — 정기 루틴은 후보 단계에서부터 반복을 들고 있어야 한다.
    //   여태 후보 스키마에 반복 개념이 아예 없어서, "매일 …" 이라고 써도 일회성 업무로만 생성됐다.
    const recurrenceRaw = ['daily', 'weekly', 'monthly'].includes(String(t.recurrence || '').toLowerCase())
      ? String(t.recurrence).toLowerCase() : 'none';
    // #237 "완료로 추가" — 이미 끝난 일의 기록. 완료된 일에 다음 회차는 없으므로 반복과 **상호배타**다
    //   (여기서 안 끊으면 recurringTaskGenerator 가 닫힌 업무에서 다음 회차를 계속 낳는다).
    // ★ 루틴 설계에는 "이미 끝난 일" 이라는 개념이 없다. 여기서 서버가 끊지 않으면
    //   completed:true 하나가 아래 상호배타 규칙을 타고 **RRULE 을 조용히 null 로 만든다**
    //   — 반복을 설계하러 들어와서 반복 없는 업무가 나오는 사고다.
    const completed = isRoutine ? false : (t.completed === true || t.completed === 'true');
    const recurrence = completed ? 'none' : recurrenceRaw;
    // #353 ① — LLM 이 직접 낸 RRULE. 프리셋 3종으로는 평일·말일·BYSETPOS·분기·종료조건을 못 만든다.
    //   검증은 생성 경로와 같은 관문(sanitizeRRule — FREQ 화이트리스트 포함).
    //   거절되면 조용히 버리지 않고 **프리셋 폴백**으로 내려간다(하위호환) — reason 은 후보에 실어 보낸다.
    const rrCheck = completed ? { rule: null, reason: 'completed' } : sanitizeRRule(t.recurrence_rule);
    const recurrence_rule = rrCheck.rule;
    const recurrence_rule_rejected = (!completed && t.recurrence_rule && !rrCheck.rule) ? rrCheck.reason : null;
    // #353 ③ — 장문 실행 지침. description(1~2문장 요약)과 **다른 필드**다.
    //   여기서 잘라 버리면 루틴 지침이 반쪽으로 저장된다 → 초과분은 아래에서 재생성 1회로 되받는다.
    const instructionRaw = t.instruction ? String(t.instruction).trim() : '';
    // #353 ② — 업무그룹 힌트(이름). 실제 배치는 confirm 이 프로젝트 워크스트림과 대조해 판단한다.
    const workstream_hint = t.workstream_hint ? String(t.workstream_hint).trim().slice(0, 120) : null;
    const assignee_hint = t.assignee_hint ? String(t.assignee_hint).slice(0, 80) : null;
    const assignee_name = t.assignee_name ? String(t.assignee_name).slice(0, 80) : null;
    const depends_on_index = (Number.isInteger(t.depends_on_index) && t.depends_on_index !== idx && t.depends_on_index >= 0)
      ? t.depends_on_index : null;
    // #354 — 영역 배치. 범위 밖이면 **조용히 버리지 않고** null 로 떨어뜨린 사실을 후보에 실어 보낸다
    //   (미배치로 화면에 보여야 사용자가 직접 고를 수 있다).
    const areaRefRaw = Number.isInteger(t.area_ref) ? t.area_ref : null;
    const area_ref = (isRoutine && areaRefRaw !== null && areaRefRaw >= 0 && areaRefRaw < areaCount) ? areaRefRaw : null;
    const area_ref_dropped = isRoutine && areaRefRaw !== null && area_ref === null;
    // 파이프라인 링크 — depends_on_index 와 같은 규칙(자기참조·범위 밖 제거) + 중복 제거, 최대 5.
    const pipeline_refs = isRoutine && Array.isArray(t.pipeline_refs)
      ? [...new Set(t.pipeline_refs.filter((n) => Number.isInteger(n) && n >= 0 && n !== idx && n < arr.length))].slice(0, 5)
      : [];
    // #90 — 이름 지정 우선, 없으면 역할 힌트
    const assignee_user_id = matchMemberByName(assignee_name, members) ?? matchMemberByHint(assignee_hint, members);
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
      recurrence,
      completed,
      assignee_hint,
      assignee_name,
      assignee_user_id,
      // 운영 #263 — "담당자로 내가 안나오고 이상한 1, 2 라고 표시되는데."
      //   여기서 고른 사람의 **표시 이름을 같이 내려준다.** 화면이 id 로 이름을 되찾으려 하면
      //   실패한다 — 프로젝트 화면의 담당자 목록은 **프로젝트 멤버만**인데(TasksTab), 이 매칭은
      //   **워크스페이스 전체**에서 이뤄지기 때문이다(dev 실측: 전 프로젝트가 1~4명 vs 5명 불일치).
      //   그 차집합에 해당하는 사람이 뽑히면 화면엔 `#2` 같은 날 id 만 남았다.
      //   고른 쪽이 이름을 아는데 보는 쪽이 못 찾는 구조 자체가 문제다 — 고른 쪽이 말한다.
      assignee_display_name: assignee_user_id
        ? ((members.find(m => m.user_id === assignee_user_id)?.name) || null)
        : null,
      recurrence_rule,
      recurrence_rule_rejected,
      instruction: instructionRaw || null,
      workstream_hint,
      depends_on_index,
      area_ref,
      area_ref_dropped,
      pipeline_refs,
      vague,
    };
  }).filter(c => c.title);

  let candidates = buildCandidates(rawTasks);

  // #354 — 루틴 계약 검사 + **1회 재요구**.
  //   프롬프트만으로는 지켜지지 않는다(실측: 영역 1개 · 지침 136자 · pipeline 0건).
  //   LLM 순종에 기대지 않고, 어긴 항목을 이름으로 짚어 한 번 더 받는다. 그래도 못 지키면
  //   **받은 그대로 내보내고** 프론트가 무엇이 부족한지 표시한다 — 조용히 삼키지 않는다.
  let routineShortfall = null;
  if (isRoutine && candidates.length) {
    // 재요구 대상은 **구조 결함만**이다. 지침 길이는 재요구에 넣지 않는다 —
    //   "더 길게 써라" 를 시키면 모델이 출력 상한(12,000토큰)을 꽉 채워 JSON 이 중간에서 잘리고,
    //   그 응답은 통째로 못 쓴다(실측). 게다가 짧은 지침(180~400자)은 Irene 이 손으로 쓴
    //   실데이터 범위(175~1,001자) 안이라 애초에 결함이 아니다. 부족하면 아래 soft 로 알린다.
    // ★ 청중이 둘이다 — **LLM(재요구 지시)** 과 **사용자(화면 안내)**. 한 문자열에 섞으면
    //   반드시 한쪽이 틀린다: 영문 지시가 한국어 사용자 화면에 뜨거나, 한국어 안내가
    //   프롬프트에 실린다. 그래서 코드(code)로 내려보내고 **문구는 프론트가 i18n 으로** 만든다.
    //   `llm` 필드는 재요구 프롬프트에만 쓴다(사용자에게 나가지 않는다).
    const check = (cands, ars) => {
      const miss = [];
      if (cands.length >= 4 && ars.length < 3) {
        miss.push({ code: 'areas_too_few', n: ars.length, llm: `"areas" has ${ars.length} entries — output at least 3 distinct areas` });
      }
      if (!cands.some((c) => c.pipeline_refs && c.pipeline_refs.length)) {
        miss.push({ code: 'no_pipeline', n: 0, llm: 'no task has "pipeline_refs" — connect the routines (weekly consumes daily, monthly consumes weekly)' });
      }
      const noRule = cands.filter((c) => !c.recurrence_rule);
      if (noRule.length) {
        miss.push({ code: 'no_recurrence', n: noRule.length, llm: `${noRule.length} tasks have no "recurrence_rule" — every task in routine mode must repeat` });
      }
      return miss;
    };
    // soft — 재요구는 안 하되 화면이 알 수 있게 내려보낸다(조용히 삼키지 않는다).
    const softCheck = (cands) => {
      const out = [];
      const short = cands.filter((c) => !c.instruction || c.instruction.length < MIN_ROUTINE_INSTRUCTION);
      if (short.length) out.push({ code: 'instruction_short', n: short.length, min: MIN_ROUTINE_INSTRUCTION });
      // 영역은 만들었는데 **아무 업무도 배치되지 않은** 상태 — 화면엔 "업무 0건" 으로만 보여
      //   사용자가 "왜 비었지" 로 읽는다. 무슨 일이 있었는지 말해 준다(Fable 권고).
      if (areas.length > 0 && cands.length > 0 && !cands.some((c) => Number.isInteger(c.area_ref))) {
        out.push({ code: 'no_area_assignment', n: areas.length });
      }
      return out;
    };
    // ★ soft 는 hard 유무와 무관하게 항상 센다. hard 가 없을 때만 건너뛰게 두면
    //   "구조는 멀쩡한데 지침이 짧은" 흔한 경우가 화면에 아무 말도 못 하게 된다.
    let missing = check(candidates, areas);
    const runSoft = () => { const s = softCheck(candidates); if (s.length) routineShortfall = (routineShortfall || []).concat(s); };
    if (!missing.length) runSoft();
    if (missing.length) {
      const note = '\n\n[CONTRACT VIOLATIONS — your previous answer was rejected. Fix ALL of these and output the FULL JSON again]\n'
        + missing.map((m, i) => `${i + 1}. ${m.llm}`).join('\n');
      try {
        const retry = await callOpenAi(systemPrompt, userPrompt + note, 'routine_plan');
        const rp = JSON.parse(retry.content);
        const rTasks = Array.isArray(rp.tasks) ? rp.tasks : [];
        if (rTasks.length) {
          // 영역도 함께 다시 읽는다 — 업무만 갈아끼우면 area_ref 가 옛 영역을 가리킨다.
          const rAreasRaw = Array.isArray(rp.areas) ? rp.areas : [];
          const seen2 = new Set();
          const rAreas = rAreasRaw.map((a) => ({
            title: String(a?.title || '').trim().slice(0, 200),
            description: a?.description ? String(a.description).trim().slice(0, 1000) : null,
          })).filter((a) => {
            if (!a.title) return false;
            const k = normAreaKey(a.title);
            if (seen2.has(k)) return false;
            seen2.add(k); return true;
          }).slice(0, MAX_AREAS).map((a, i) => ({ idx: i, title: a.title, description: a.description, existing: existingKeys.has(normAreaKey(a.title)) }));
          // ★ 재요구 결과를 **무조건 덮어쓰지 않는다.** 실측: 첫 응답이 영역 3개로 멀쩡했는데
          //   재요구가 영역 1개를 돌려줬고, 그대로 갈아끼워 결과가 나빠졌다.
          //   더 나은 쪽을 고른다 — 판정 기준은 위반 건수, 같으면 지침 총량.
          const useAreas = rAreas.length ? rAreas : areas;
          // ★ buildCandidates 는 areaCount 를 **클로저로** 읽는다. 새 영역 개수를 먼저 반영하지 않고
          //   후보를 다시 만들면, 늘어난 영역(4·5번)을 가리키는 area_ref 가 범위 밖으로 떨어져
          //   미배치가 된다(실측: 영역 5개인데 2건이 area=null).
          const prevAreaCount = areaCount;
          areaCount = useAreas.length;
          const rebuilt = buildCandidates(rTasks);
          if (rebuilt.length) {
            const score = (cands, ars) => {
              const v = check(cands, ars).length;
              const insSum = cands.reduce((a, c) => a + (c.instruction || '').length, 0);
              return { v, insSum };
            };
            const before = score(candidates, areas);
            const after = score(rebuilt, useAreas);
            // ★ **확실히 나아졌을 때만** 갈아끼운다. 동점일 때 지침 글자수로 고르게 했더니
            //   영역 3개짜리를 1개짜리로 바꿨다 — 글자수는 늘었지만 설계는 무너졌다.
            //   동점 = 개선 아님 → 첫 응답을 지킨다.
            const better = after.v < before.v;
            if (better) {
              candidates = rebuilt;
              areas = useAreas;
            } else {
              areaCount = prevAreaCount;   // 첫 응답을 유지하므로 영역 개수도 되돌린다
              console.warn(`[aiTaskPlanner] routine 재요구가 더 나쁨 — 첫 응답 유지 (위반 ${before.v}→${after.v}, 지침 ${before.insSum}→${after.insSum}자)`);
            }
          } else {
            areaCount = prevAreaCount;
          }
          missing = check(candidates, areas);
        }
        result.input_tokens += retry.input_tokens || 0;
        result.output_tokens += retry.output_tokens || 0;
      } catch (e) {
        console.warn('[aiTaskPlanner] routine contract retry failed', e.message);
      }
      runSoft();
      if (missing.length) {
        routineShortfall = (routineShortfall || []).concat(missing);
        // 무엇이 부족한지 로그에 남긴다 — "모델이 그 키를 아예 안 냈는지" 와
        // "냈는데 서버가 걸렀는지" 는 화면에서 구별이 안 된다.
        console.warn('[aiTaskPlanner] routine 계약 미충족:', missing.map((m) => m.code).join(' | '),
          '| 첫 업무 키:', Object.keys(rawTasks[0] || {}).join(','));
      }
    }
  }

  // #353 ③ — 지침이 상한을 넘으면 **자르지 않고 한 번 더 요구한다**.
  //   자르면 루틴 지침이 문장 중간에서 끊긴 채 저장되고, 사용자는 그것이 잘린 줄도 모른다.
  //   재생성은 1회로 제한한다(LLM 비용·응답 지연). 그래도 넘치면 그때는 절단하고 **표시**한다.
  const overLimit = candidates.filter((c) => c.instruction && c.instruction.length > MAX_INSTRUCTION_LEN);
  if (overLimit.length) {
    const retryNote = language === 'en'
      ? `\n\n[Constraint] Each "instruction" must be under ${MAX_INSTRUCTION_LEN} characters. Rewrite them shorter, keeping every step.`
      : `\n\n[제약] 각 "instruction" 은 ${MAX_INSTRUCTION_LEN}자 미만이어야 한다. 단계를 빠뜨리지 말고 더 짧게 다시 써라.`;
    try {
      const retry = await callOpenAi(systemPrompt, userPrompt + retryNote, isRoutine ? 'routine_plan' : 'task_plan');
      const reparsed = JSON.parse(retry.content);
      const retried = buildCandidates(Array.isArray(reparsed.tasks) ? reparsed.tasks : []);
      if (retried.length) candidates = retried;
      result.input_tokens += retry.input_tokens || 0;
      result.output_tokens += retry.output_tokens || 0;
    } catch (e) {
      console.warn('[aiTaskPlanner] instruction retry failed', e.message);
    }
    // 재생성 후에도 넘치면 절단 — 다만 **잘렸다는 사실을 후보에 실어 보낸다**(조용한 손실 금지)
    for (const c of candidates) {
      if (c.instruction && c.instruction.length > MAX_INSTRUCTION_LEN) {
        c.instruction = c.instruction.slice(0, MAX_INSTRUCTION_LEN);
        c.instruction_truncated = true;
      }
    }
  }

  // #90 — 링크 유실 방지 안전망: 프롬프트의 URL 이 어떤 후보 description 에도 없으면 첫 후보에 보존.
  const urls = (String(prompt).match(/https?:\/\/[^\s<>"')]+/g) || []).slice(0, 3);
  if (urls.length && candidates.length) {
    const allDesc = candidates.map(c => c.description || '').join(' ');
    const missing = urls.filter(u => !allDesc.includes(u));
    if (missing.length) {
      const extra = (language === 'en' ? '\n\nReference: ' : '\n\n참고 링크: ') + missing.join(' ');
      candidates[0].description = (candidates[0].description || '').slice(0, 1000 - extra.length) + extra;
    }
  }

  // #90 후속 — 담당자 안전망 (URL net 과 같은 원리): LLM 이 assignee_name 을 놓쳐도
  //   프롬프트에 워크스페이스 멤버 이름이 직접 언급돼 있으면 배정 복구.
  //   정확히 1명으로 특정될 때만 적용 — 여러 이름이면 모호하므로 건드리지 않는다.
  const unassigned = candidates.filter((c) => !c.assignee_user_id);
  if (unassigned.length && members.length) {
    const promptText = String(prompt);
    const mentioned = new Map();
    for (const m of members) {
      const names = [m.name, m.account_name].filter((n) => n && String(n).trim().length >= 2);
      if (names.some((n) => promptText.includes(String(n).trim()))) mentioned.set(m.user_id, m);
    }
    if (mentioned.size === 1) {
      const m = [...mentioned.values()][0];
      for (const c of unassigned) {
        c.assignee_user_id = m.user_id;
        if (!c.assignee_name) c.assignee_name = m.name || m.account_name || null;
        // 운영 #263 — 이 안전망도 담당자를 **채우는** 경로다. 여기서 표시 이름을 안 실으면
        //   위 정규화에서 붙인 것과 어긋나 이 경로로 배정된 후보만 화면에 `#id` 로 뜬다.
        c.assignee_display_name = m.name || m.account_name || null;
      }
    }
  }

  // recordUsage — cue_usage 카운터에 'ai_task_create' 액션으로 기록
  if (!result.fallback && businessId) {
    try {
      // #354 — 루틴 설계는 별도 액션으로 센다. 같은 'ai_task_create' 로 합치면 사용량 화면에서
      //   "출력이 6배인 호출" 이 일반 분해와 구별되지 않아, 비용이 어디서 나는지 못 읽는다.
      await recordUsage(businessId,
        isRoutine ? 'ai_routine_plan' : 'ai_task_create',
        isRoutine ? modelFor('routine_plan') : MODEL,
        result.input_tokens, result.output_tokens);
    } catch (e) { console.warn('[aiTaskPlanner] recordUsage failed', e.message); }
  }

  return {
    candidates,
    areas,
    // #354 — 계약을 못 채운 항목. 화면이 "지침이 짧습니다" 를 말할 수 있어야 한다(조용한 손실 금지).
    routine_shortfall: routineShortfall,
    // 운영 #263 — "이런 긴 멘트가 필요해? 언제 읽어?"
    //   프롬프트는 "30자 이내 · 메타설명 금지" 를 요구하는데 여기 캡은 120자였다. 계약이 4배 어긋나
    //   장황한 첫 문장이 그대로 통과했다(Irene 실측: "사용자의 요청에 따라 … 단일 작업을 정의했습니다.").
    //   ★ LLM 순종에 의존하지 않고 서버에서 강제한다(#241 번역 강제와 같은 방식).
    //   ★ 길면 **자르지 않고 버린다** — 한도를 넘었다는 건 애초에 요구한 "한 구절" 이 아니라는 뜻이라,
    //     잘린 문장을 보여주느니 없는 게 낫다. 프론트에 기본 문구가 이미 있다(CueTaskBar 'ai.bar.organized').
    reasoning: (() => {
      const raw = String(parsed.reasoning || '').replace(/\s+/g, ' ').trim();
      if (!raw) return '';
      const first = (raw.split(/(?<=[.。!?])\s/)[0] || raw).trim();
      const hasHangul = /[가-힣]/.test(first);
      const limit = hasHangul ? 40 : 80;   // 프롬프트 계약(30/60)에 약간의 여유
      return first.length > limit ? '' : first;
    })(),
    fallback: result.fallback,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  };
}

module.exports = { planTasksFromPrompt, detectVague, matchMemberByHint, matchMemberByName };
