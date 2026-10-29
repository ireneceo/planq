// 템플릿에서 «AI 로 고쳐 넣기» — 전체 다시 쓰기가 아니라 **바꿀 것만(변경 목록)** 받는다 (2026-10-29, Fable 설계 §5)
//   Irene: «적용할 때 ai가 제대로 하게 해줘.»
//   옛 방식(aiTaskPlanner 의 base_candidates 고쳐 쓰기)은 AI 가 목록 전체를 새로 써서, 지시가 안 건드린 항목도
//   설명이 줄고(1~2문장 규칙)·30개 뒤가 잘리고·우선순위가 바뀌고·하루짜리가 이틀이 됐다.
//   → AI 는 ops(update·add·remove·shift)만 내고, 서버가 원본 위에 얹는다. 지시가 안 건드린 항목은 글자 하나 안 바뀐다.
//   본문·공개 범위·태그·결과물 액션은 AI 가 고치지 않는다(본문은 담당자 결과물 — rules/qtask.md · HTML 왕복이 깨진다).
//   일반 AI 업무 추가(aiTaskPlanner)는 이 파일과 무관하다.
const { callLLM, isEnabled, modelFor } = require('./llm');
const { sanitizeRRule } = require('./rruleFromRecurrence');

const PURPOSE = 'task_plan_list';          // 입력 16,000자·출력 8,000토큰 — ops 는 짧지만 원본 목록이 길다
const MAX_ITEMS = 40;                       // = aiTaskPlanner.MAX_CONFIRM_CANDIDATES (확정 상한)
const PROMPT_BUDGET = 13_000;               // 목록 부분 글자 상한(설명 발췌 길이를 여기에 맞춘다)
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const UPDATABLE = ['title', 'description', 'priority', 'estimated_hours', 'start_offset_days', 'duration_days',
  'assignee_hint', 'workstream_hint', 'is_milestone', 'category', 'recurrence_rule', 'depends_on_indexes'];

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const isInt = (v) => Number.isInteger(v);

function itemLine(it, i, descMax) {
  const s = it.start_offset_days;
  const d = Number.isInteger(it.duration_days) ? it.duration_days : 1;
  // 기간을 숫자로 꼭 적는다 — «당일 마감» 만 적으면 AI 가 기간 0 을 몰라 «이틀 늘려» 를 +4 로 만들었다(Fable 실측).
  const when = s === null || s === undefined ? '날짜 없음' : `start=D+${s} · due=D+${s + d} · duration=${d}${d === 0 ? ' (당일 마감)' : ''}`;
  const meta = [
    when,
    `priority=${it.priority || 'normal'}`,
    Number(it.estimated_hours) > 0 ? `${Number(it.estimated_hours)}h` : null,
    it.assignee_hint ? `role=${String(it.assignee_hint).slice(0, 40)}` : null,
    it.workstream_hint ? `group=${String(it.workstream_hint).slice(0, 60)}` : null,
    it.is_milestone ? 'milestone' : null,
    it.category ? `category=${String(it.category).slice(0, 40)}` : null,
    it.recurrence_rule ? `rrule=${it.recurrence_rule}` : null,
    Array.isArray(it.depends_on_indexes) && it.depends_on_indexes.length ? `after=${it.depends_on_indexes.map((x) => x + 1).join(',')}` : null,
  ].filter(Boolean).join(' · ');
  const desc = String(it.description || '').trim();
  const bodyLen = plain(it.body).length;
  // 번호는 사람이 세는 대로 1부터 — 화면 미리보기·카드도 같은 번호를 보인다(«2번» 이 셋째를 바꾸던 Fable 실측).
  return `#${i + 1} ${String(it.title || '').slice(0, 200)} [${meta}]`
    + (desc ? `\n   설명: ${desc.length > descMax ? desc.slice(0, descMax) + '…' : desc}` : '')
    + (bodyLen ? `\n   [본문 ${bodyLen}자 — 고치지 않는다] ${plain(it.body).slice(0, 120)}` : '');
}

function buildPrompts({ items, startDate, instructions, language, workstreams }) {
  const en = language === 'en';
  // 설명은 예산 안에서 가능한 한 길게 — 짧게 잘라도 원본은 서버가 들고 있으므로 결과에는 영향이 없다(고치지 않으면 그대로).
  let descMax = 1500;
  let list = items.map((it, i) => itemLine(it, i, descMax)).join('\n');
  while (list.length > PROMPT_BUDGET && descMax > 80) {
    descMax = Math.floor(descMax / 2);
    list = items.map((it, i) => itemLine(it, i, descMax)).join('\n');
  }
  const done = instructions.slice(0, -1);
  const now = instructions[instructions.length - 1];
  const system = `You edit an existing task list (from a saved template) by returning a PATCH — never rewrite the whole list.
Return JSON only: {"ops":[...],"note":"<one short sentence in ${en ? 'English' : 'Korean'}: name the changed task by its TITLE and the new value>"}
Numbers: tasks are numbered #1, #2, #3 … exactly as the user sees them. «2번» / "task 2" = #2. Use these #numbers as idx — always the ORIGINAL numbers, even after other ops.
Op shapes:
  {"op":"update","idx":2,"set":{ only the fields that change }}
     allowed fields: title, description, priority(low|normal|high|urgent), estimated_hours, start_offset_days(int ≥0, or null = no date),
     duration_days(int ≥0; 0 = due the same day), assignee_hint, workstream_hint, is_milestone(bool), category, recurrence_rule(RFC-5545 RRULE without DTSTART, or null), depends_on_indexes(#numbers)
  {"op":"add","after":3,"item":{"title":"…", other allowed fields}}   (after = insert after that #; omit "after" to append at the end; 0 = at the very top)
  {"op":"remove","idx":5}
  {"op":"shift","idx":[4,5,6],"days":2}  or  {"op":"shift","from":4,"days":2}   ("from" = that # and every later #)
Dates: calendar days from D+0 = the apply start date ${startDate} (weekends included). due = start + duration. duration 0 = due on the start day.
Direction of time — get the SIGN right:
  later / 뒤로 / 미루다 / 늦추다 / 연기 → ADD days (start_offset_days bigger, shift days POSITIVE)
  earlier / 앞당기다 / 당기다 / 일찍 → SUBTRACT days (start_offset_days smaller, shift days NEGATIVE)
Scope — change ONLY what the latest instruction names:
- Lengthen/shorten one task («늘려/줄여») = ONE update of that task's duration_days: new = old duration ± n. Nothing else, even if dates overlap.
- Move one task («하루 뒤로», «이틀 앞당겨») = ONE update of that task's start_offset_days (duration unchanged). Do NOT move any other task.
- Use "shift" with "from" ONLY when the instruction explicitly says the following tasks move too («이후 업무도 같이», «뒤 일정 전부», «나머지 전부»).
- Every task and field you do not mention stays exactly as it is.
Examples (list: #2 킥오프 start=D+3 · due=D+3 · duration=0, #3 시안 start=D+5 · due=D+10 · duration=5):
  «2번 업무 기간 이틀 늘려줘» → [{"op":"update","idx":2,"set":{"duration_days":2}}]
  «킥오프를 하루 뒤로 미뤄줘» → [{"op":"update","idx":2,"set":{"start_offset_days":4}}]
  «시안을 이틀 앞당겨줘» → [{"op":"update","idx":3,"set":{"start_offset_days":3}}]
  «3번부터 이후 일정 전부 사흘 뒤로» → [{"op":"shift","from":3,"days":3}]
- Never touch the body (본문), visibility, tags or action items — they are not editable here.
- Earlier instructions are ALREADY applied to the list below. Do not undo them, do not apply them again.
- If the instruction is impossible or unclear (e.g. the number does not exist), return {"ops":[],"note":"<why>"}.
- Write new titles/descriptions in ${en ? 'English' : 'Korean'}.${workstreams.length ? `\n- Existing groups (workstream_hint must be one of these, or null): ${workstreams.slice(0, 30).join(' / ')}` : ''}`;
  const user = `[현재 목록 — 총 ${items.length}개]\n${list}`
    + (done.length ? `\n\n[이미 반영된 지시 — 되돌리지 말 것]\n${done.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '')
    + `\n\n[이번 지시]\n${now}`;
  return { system, user };
}

// 값 하나를 저장 모양으로 — 틀리면 { bad: 이유 }.
function cleanField(key, v, n) {
  switch (key) {
    case 'title': { const t = String(v || '').trim().slice(0, 200); return t ? { v: t } : { bad: 'empty_title' }; }
    case 'description': return { v: v == null ? '' : String(v).slice(0, 2000) };
    case 'priority': return PRIORITIES.includes(v) ? { v } : { bad: 'priority' };
    case 'estimated_hours': return v == null ? { v: null } : (Number(v) > 0 && Number(v) <= 999 ? { v: Number(v) } : { bad: 'estimated_hours' });
    case 'start_offset_days': return v == null ? { v: null } : (isInt(v) && v >= -365 && v <= 3650 ? { v } : { bad: 'start_offset_days' });
    case 'duration_days': return isInt(v) && v >= 0 && v <= 3650 ? { v } : { bad: 'duration_days' };
    case 'assignee_hint': case 'workstream_hint': case 'category':
      return { v: v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, key === 'category' ? 100 : 120) };
    case 'is_milestone': return { v: v === true };
    case 'recurrence_rule': {
      if (v == null || v === '') return { v: null };
      const r = sanitizeRRule(v);
      return r.rule ? { v: r.rule } : { bad: `recurrence_rule:${r.reason}` };
    }
    case 'depends_on_indexes':
      return Array.isArray(v) && v.every((x) => isInt(x) && x >= 0 && x < n) ? { v: [...new Set(v)].slice(0, 10) } : { bad: 'depends_on_indexes' };
    default: return { bad: `unknown_field:${key}` };
  }
}

// set 전체가 깨끗해야 그 op 를 받는다(반쪽 반영은 사람이 알아보기 어렵다).
function cleanSet(set, n) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return { bad: 'set_missing' };
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (!UPDATABLE.includes(k)) return { bad: `unknown_field:${k}` };
    const c = cleanField(k, v, n);
    if (c.bad) return { bad: c.bad };
    out[k] = c.v;
  }
  return Object.keys(out).length ? { v: out } : { bad: 'set_empty' };
}

// 날짜 칸 짝 맞추기 — 시작이 null 이면 기간도 null, 시작이 생기면 기간 기본 1 · due_offset_days 는 화면 카드용 파생 값.
function syncDates(it) {
  if (it.start_offset_days === null || it.start_offset_days === undefined) {
    it.start_offset_days = null; it.duration_days = null; it.due_offset_days = null;
  } else {
    if (!isInt(it.duration_days)) it.duration_days = 1;
    it.due_offset_days = it.start_offset_days + it.duration_days;
  }
}

/**
 * ops 를 원본 위에 얹는다(순수 함수 — 시험이 LLM 없이 부른다).
 * 순서: update·shift(적힌 순서, 같은 idx 는 뒤엣것이 이긴다) → remove → add → 재번호 → 연결 번호 다시 맞춤.
 * @returns {{ items, applied:number, rejected:Array<{op,reason}>, notes:string[] }}
 */
function applyOps(original, ops) {
  const n = original.length;
  const rejected = [];
  const reject = (op, reason) => rejected.push({ op, reason });
  // 원본은 건드리지 않는다 — 바뀌는 항목만 복사본을 만든다(안 바뀐 항목은 원본 객체 그대로 → 바이트 동일).
  const rows = original.map((it, i) => ({ key: i, item: it, changed: false }));
  const touch = (r) => { if (!r.changed) { r.item = { ...r.item }; r.changed = true; } return r.item; };
  const inRange = (i) => isInt(i) && i >= 0 && i < n;
  const removed = new Set();
  const adds = [];
  let applied = 0;

  for (const op of (Array.isArray(ops) ? ops : [])) {
    if (!op || typeof op !== 'object') { reject(op, 'not_object'); continue; }
    if (op.op === 'update') {
      if (!inRange(op.idx)) { reject(op, 'idx_out_of_range'); continue; }
      const c = cleanSet(op.set, n);
      if (c.bad) { reject(op, c.bad); continue; }
      if (c.v.depends_on_indexes && c.v.depends_on_indexes.includes(op.idx)) { reject(op, 'self_dependency'); continue; }
      const it = touch(rows[op.idx]);
      Object.assign(it, c.v);
      if ('assignee_hint' in c.v) it.assignee_user_id = null;   // 역할이 바뀌면 사람 매칭은 다시(화면의 역할 매핑이 채운다)
      if ('workstream_hint' in c.v) it.workstream_id = null;
      syncDates(it);
      applied += 1;
    } else if (op.op === 'shift') {
      const days = op.days;
      if (!isInt(days) || days === 0 || Math.abs(days) > 365) { reject(op, 'days'); continue; }
      let targets;
      if (Array.isArray(op.idx)) targets = op.idx;
      else if (isInt(op.from)) targets = Array.from({ length: Math.max(0, n - op.from) }, (_, k) => op.from + k);
      else { reject(op, 'shift_target'); continue; }
      if (!targets.length || !targets.every(inRange)) { reject(op, 'idx_out_of_range'); continue; }
      for (const i of new Set(targets)) {
        if (rows[i].item.start_offset_days === null || rows[i].item.start_offset_days === undefined) continue; // 날짜 없음은 밀 날짜가 없다
        const it = touch(rows[i]);
        it.start_offset_days += days;
        syncDates(it);
      }
      applied += 1;
    } else if (op.op === 'remove') {
      if (!inRange(op.idx)) { reject(op, 'idx_out_of_range'); continue; }
      removed.add(op.idx);
      applied += 1;
    } else if (op.op === 'add') {
      const after = op.after === undefined || op.after === null ? n - 1 : op.after;
      if (!(after === -1 || inRange(after))) { reject(op, 'after_out_of_range'); continue; }
      const c = cleanSet(op.item, n);
      if (c.bad || !c.v.title) { reject(op, c.bad || 'empty_title'); continue; }
      const it = { title: c.v.title, description: '', priority: 'normal', start_offset_days: null, ...c.v };
      if (!('start_offset_days' in c.v)) {
        // 날짜를 안 주면 앞 항목의 마감 다음날(앞이 없거나 날짜 없음이면 날짜 없음)
        const prev = after >= 0 ? rows[after].item : null;
        if (prev && isInt(prev.start_offset_days)) it.start_offset_days = prev.start_offset_days + (isInt(prev.duration_days) ? prev.duration_days : 1);
      }
      syncDates(it);
      adds.push({ after, item: it });
      applied += 1;
    } else {
      reject(op, 'unknown_op');
    }
  }

  // 배치 — 원본 순서에서 지운 것을 빼고, 각 원본 뒤(또는 맨 앞)에 추가분을 끼운다.
  const final = [];
  const addsAt = (a) => adds.filter((x) => x.after === a).map((x) => ({ key: null, item: x.item }));
  final.push(...addsAt(-1));
  for (const r of rows) {
    if (!removed.has(r.key)) final.push(r);
    final.push(...addsAt(r.key));
  }
  // 연결 번호 다시 맞춤 — 원본 번호 → 새 번호(지운 것을 가리키면 뺀다).
  const newIndexOfKey = new Map();
  final.forEach((r, i) => { if (r.key !== null) newIndexOfKey.set(r.key, i); });
  const notes = [];
  const items = final.map((r, i) => {
    let it = r.item;
    const deps = Array.isArray(it.depends_on_indexes) ? it.depends_on_indexes : null;
    if (deps) {
      const mapped = deps.map((d) => newIndexOfKey.get(d)).filter((d) => d !== undefined && d !== i);
      const same = mapped.length === deps.length && mapped.every((d, k) => d === deps[k]);
      if (!same) { if (r.key !== null && !r.changed) { it = { ...it }; r.changed = true; } it.depends_on_indexes = mapped.length ? mapped : null; }
    }
    // 번호는 화면 카드의 키 — 항상 새 번호로(바뀌지 않은 항목의 다른 칸은 그대로)
    if (it.idx !== i) { if (r.key !== null && !r.changed) { it = { ...it }; r.changed = true; } it.idx = i; }
    return it;
  });
  // 음수 시작(앞으로 당기기 지시) → 전체를 같은 만큼 뒤로 맞춰 D+0 이 가장 이른 날이 되게(간격은 그대로).
  const minStart = items.reduce((m, it) => (isInt(it.start_offset_days) ? Math.min(m, it.start_offset_days) : m), 0);
  if (minStart < 0) {
    for (let i = 0; i < items.length; i++) {
      if (!isInt(items[i].start_offset_days)) continue;
      items[i] = { ...items[i], start_offset_days: items[i].start_offset_days - minStart };
      syncDates(items[i]);
    }
    notes.push(`shifted_all:${-minStart}`);
  }
  return { items, applied, rejected, notes };
}

// AI 는 사람 번호(#1 부터)로 답한다 → applyOps 의 0-base 번호로. 숫자가 아니면 그대로 두어 applyOps 가 거절한다.
function fromHumanNumbers(op) {
  if (!op || typeof op !== 'object') return op;
  const dec = (v) => (isInt(v) ? v - 1 : v);
  const o = { ...op };
  if ('idx' in o) o.idx = Array.isArray(o.idx) ? o.idx.map(dec) : dec(o.idx);
  if ('from' in o) o.from = dec(o.from);
  if ('after' in o && o.after !== null && o.after !== undefined) o.after = dec(o.after);   // 0(맨 앞) → -1
  const fixDeps = (set) => (set && Array.isArray(set.depends_on_indexes) ? { ...set, depends_on_indexes: set.depends_on_indexes.map(dec) } : set);
  if (o.set) o.set = fixDeps(o.set);
  if (o.item) o.item = fixDeps(o.item);
  return o;
}

/**
 * @returns {Promise<{ ok:true, items, applied, rejected, note, notes } | { ok:false, code, http }>}
 */
async function refineTemplateItems({ businessId, items, startDate, instructions, language = 'ko', workstreams = [] }) {
  if (!isEnabled()) return { ok: false, code: 'ai_unavailable', http: 503 };
  const { system, user } = buildPrompts({ items, startDate, instructions, language, workstreams });
  const r = await callLLM({
    purpose: PURPOSE,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    json: true,
    fallback: '',
  });
  if (!r.fallback && businessId) {
    try {
      await require('./cue_orchestrator').recordUsage(businessId, 'ai_template_refine', modelFor(PURPOSE), r.input_tokens || 0, r.output_tokens || 0);
    } catch (e) { console.warn('[templateAiRefine] recordUsage', e.message); }
  }
  let parsed = null;
  try { parsed = JSON.parse(r.content || ''); } catch { parsed = null; }
  // 깨진 응답에 «전체 다시 쓰기» 로 물러서지 않는다 — 원본을 지키는 것이 이 기능의 계약이다.
  if (!parsed || !Array.isArray(parsed.ops)) return { ok: false, code: 'ai_patch_invalid', http: 400 };
  const out = applyOps(items, parsed.ops.map(fromHumanNumbers));
  if (out.items.length > MAX_ITEMS) return { ok: false, code: 'too_many_items', http: 400 };
  return { ok: true, ...out, note: parsed.note ? String(parsed.note).slice(0, 300) : '' };
}

module.exports = { refineTemplateItems, applyOps, fromHumanNumbers, buildPrompts, MAX_ITEMS };
