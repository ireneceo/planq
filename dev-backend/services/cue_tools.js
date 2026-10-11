// Cue 대화형 실행 — 툴 카탈로그 · 검증 · 담당자 해석 · dispatch (#81, 설계 docs/CUE_CONVERSATIONAL_EXECUTION_DESIGN.md)
//
// 이 모듈이 confirm 게이트의 심장이다:
//   - `/help` 는 여기서 TOOL_SCHEMAS + buildToolSystemContext 만 가져간다 (LLM 에 제안시킬 도구 정의·컨텍스트).
//     **/help 는 절대 executeTool 을 부르지 않는다** — 제안만 하고 실행은 사람이 누른 뒤 execute-action 에서.
//   - `execute-action` 은 executeTool 하나만 부른다 → 검증 → 담당자 해석 → 행동 계층 dispatch.
//
// 재무(invoice/payment)는 카탈로그에 없다 — Cue 는 문서 초안까지만, 돈은 영구 봉쇄 (guard cuetools).
// LLM 은 툴을 **제안**할 뿐, actor 는 언제나 사용자 본인(execute-action) 또는 위임자(행동 계층) — 권한은 사람의 것.

const { BusinessMember, User, Business, Task } = require('../models');
const { todayInTz } = require('../utils/datetime');
const { getMemberNameMap } = require('./displayName');
const { resolveAssignees } = require('./task_extractor');
const { createTask, submitReview, complete, createComment } = require('./actions/task_actions');
const { createEvent, rescheduleEvent } = require('./actions/event_actions');
const { Op } = require('sequelize');
const { createDocument } = require('./actions/document_actions');

// 문서 종류 — 재무 계열(invoice·tax_invoice) 의도적 제외 (Cue 는 청구서를 만들지 않는다)
const DOC_KINDS = ['quote', 'contract', 'nda', 'proposal', 'sow', 'meeting_note', 'sop', 'custom'];

// 전이·댓글 툴 — 이미 존재하는 업무(task_id)를 대상으로 한다. 권한은 행동 계층이 건다
//   (submit/complete 는 담당자만 = only_assignee 403, 댓글은 canAccessTask). Cue 는 대상만 지정.
const TASK_TARGET_TOOLS = new Set(['submit_review', 'complete_task', 'add_task_comment']);

const WRITE_TOOLS = new Set(['create_task', 'create_event', 'reschedule_events', 'create_document_draft', ...TASK_TARGET_TOOLS]);

// 일정 옮기기 한 번에 최대 몇 건 — 한 장의 확인 카드가 사람이 훑어볼 수 있는 양.
const MAX_MOVES = 20;

// ─────────────────────────────────────────────
// LLM function-calling 스키마 — /help 가 tools 로 넘긴다
// ─────────────────────────────────────────────
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '업무(할 일)를 하나 만든다. 사용자가 "…업무 만들어줘", "…해야 해", "…에게 …요청" 처럼 실행할 일을 말할 때. 담당자를 명확히 언급하면 assignee_name 에 그 사람 이름을 넣는다(언급 없으면 비움 — 요청자 본인이 담당).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '업무명 — 결과물 기반, 간결하게. "완료/완성" 같은 접미사 금지.' },
          assignee_name: { type: 'string', description: '담당자로 명확히 언급된 워크스페이스 멤버 이름. 아래 [멤버] 목록의 이름과 정확히 일치시킬 것. 언급 없으면 생략.' },
          description: { type: 'string', description: '업무 상세(의뢰 명세). 선택.' },
          due_date: { type: 'string', description: '마감일 YYYY-MM-DD. "다음주 화요일" 등은 아래 [오늘] 기준으로 계산.' },
          project_id: { type: 'integer', description: '연결할 프로젝트 id (아는 경우만).' },
          completed: { type: 'boolean', description: '이미 끝난 일을 기록으로 남기는 경우 true. "완료로 추가", "…했어 완료로 넣어줘", "끝난 건데 기록해줘" 처럼 **이미 완료된 사실**을 말할 때만. 앞으로 할 일이면 넣지 않는다.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: '캘린더 일정을 하나 만든다. "…일정 잡아줘", "…미팅 넣어줘" 등. 시각은 [오늘]·[시간대] 기준 ISO8601 로.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '일정 제목.' },
          start_at: { type: 'string', description: '시작 ISO8601 (워크스페이스 시간대 기준).' },
          end_at: { type: 'string', description: '종료 ISO8601. 언급 없으면 시작 +1시간.' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['title', 'start_at', 'end_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_events',
      description: '이미 있는 캘린더 일정(하나 또는 여러 개)을 다른 날짜·시간으로 옮긴다. "목요일 일정 월요일로 바꿔줘", "회의 다음 주로 미뤄줘", "…빼고 나머지 옮겨줘" 등. event_id 는 반드시 [옮길 수 있는 일정] 목록의 #번호에서 고른다(목록에 없는 일정은 옮길 수 없다). 사용자가 제외하라고 한 일정은 넣지 않는다. 시간을 말하지 않았으면 start_time 을 비운다 — 원래 시각·길이가 유지된다.',
      parameters: {
        type: 'object',
        properties: {
          moves: {
            type: 'array',
            description: `옮길 일정들 (최대 ${MAX_MOVES}건).`,
            items: {
              type: 'object',
              properties: {
                event_id: { type: 'integer', description: '[옮길 수 있는 일정] 의 #번호.' },
                date: { type: 'string', description: '새 날짜 YYYY-MM-DD. "다음 주 월요일" 등은 [오늘] 기준으로 계산.' },
                start_time: { type: 'string', description: '새 시작 시각 HH:MM (워크스페이스 시간대). 사용자가 시각을 말했을 때만.' },
              },
              required: ['event_id', 'date'],
            },
          },
        },
        required: ['moves'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_document_draft',
      description: '문서 초안을 하나 만든다. 회의록·제안서·계약서·견적서 등. 청구서/세금계산서는 만들 수 없다.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: DOC_KINDS, description: '문서 종류.' },
          title: { type: 'string' },
          client_id: { type: 'integer', description: '연결할 고객 id (아는 경우만).' },
          project_id: { type: 'integer', description: '연결할 프로젝트 id (아는 경우만).' },
        },
        required: ['kind', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_review',
      description: '이미 있는 업무의 결과물을 제출해 컨펌(검토) 요청을 보낸다. "이 업무 검토 요청 보내줘", "결과물 제출해줘" 등. 담당자 본인만 가능. task_id 는 [현재 업무] 또는 컨텍스트에서.',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'integer', description: '대상 업무 id.' } },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: '이미 있는 업무를 완료 처리한다. "이 업무 완료해줘", "끝났어" 등. 담당자 본인만 가능. 컨펌자가 있는 업무는 컨펌을 거쳐야 하므로 거부될 수 있다.',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'integer', description: '대상 업무 id.' } },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_task_comment',
      description: '이미 있는 업무에 댓글을 남긴다. "이 업무에 ~라고 코멘트 달아줘" 등.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: '대상 업무 id.' },
          content: { type: 'string', description: '댓글 내용.' },
        },
        required: ['task_id', 'content'],
      },
    },
  },
];

const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : undefined);
const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// ─────────────────────────────────────────────
// 검증/정규화 — 클라(또는 LLM) 입력을 믿지 않는다. snake_case 유지(카드가 다루는 형태).
//   반환: { ok:true, params } | { ok:false, code }
// ─────────────────────────────────────────────
function validateNormalize(tool, raw = {}) {
  if (!WRITE_TOOLS.has(tool)) return { ok: false, code: 'unknown_tool' };
  if (tool === 'create_task') {
    const title = clip(raw.title, 300);
    if (!title) return { ok: false, code: 'title_required' };
    const due = raw.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.due_date)) ? String(raw.due_date) : undefined;
    return {
      ok: true,
      params: {
        title,
        assignee_name: clip(raw.assignee_name, 100),
        assignee_id: posInt(raw.assignee_id),   // 카드가 해석/수정한 담당자 (실행 시 우선)
        description: clip(raw.description, 5000),
        due_date: due,
        project_id: posInt(raw.project_id),
        // #237 "완료로 추가" — 이미 끝난 일의 기록. 여기선 **의도만** 정규화하고,
        //   실제 완료는 executeTool 이 행동 계층 complete() 로 낸다(직접 status 쓰기 금지).
        completed: raw.completed === true || raw.completed === 'true',
      },
    };
  }
  if (tool === 'create_event') {
    const title = clip(raw.title, 300);
    if (!title) return { ok: false, code: 'title_required' };
    const sd = raw.start_at ? new Date(raw.start_at) : null;
    const ed = raw.end_at ? new Date(raw.end_at) : null;
    if (!sd || isNaN(sd.getTime()) || !ed || isNaN(ed.getTime())) return { ok: false, code: 'invalid_dates' };
    return {
      ok: true,
      params: {
        title,
        start_at: sd.toISOString(),
        end_at: ed.toISOString(),
        description: clip(raw.description, 5000),
        location: clip(raw.location, 300),
      },
    };
  }
  if (tool === 'reschedule_events') {
    const list = Array.isArray(raw.moves) ? raw.moves : [];
    const seen = new Set();
    const moves = [];
    for (const m of list) {
      const id = posInt(m?.event_id);
      const date = m?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(m.date)) ? String(m.date) : null;
      if (!id || !date || seen.has(id)) continue;
      const st = m?.start_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(m.start_time)) ? String(m.start_time) : undefined;
      seen.add(id);
      moves.push({ event_id: id, date, ...(st ? { start_time: st } : {}) });
      if (moves.length >= MAX_MOVES) break;
    }
    if (!moves.length) return { ok: false, code: 'no_events_to_move' };
    return { ok: true, params: { moves } };
  }
  if (tool === 'create_document_draft') {
    const title = clip(raw.title, 300);
    if (!title) return { ok: false, code: 'title_required' };
    if (!DOC_KINDS.includes(raw.kind)) return { ok: false, code: 'invalid_kind' };
    return {
      ok: true,
      params: { kind: raw.kind, title, client_id: posInt(raw.client_id), project_id: posInt(raw.project_id) },
    };
  }
  if (tool === 'submit_review' || tool === 'complete_task') {
    const taskId = posInt(raw.task_id);
    if (!taskId) return { ok: false, code: 'task_id_required' };
    return { ok: true, params: { task_id: taskId } };
  }
  if (tool === 'add_task_comment') {
    const taskId = posInt(raw.task_id);
    const content = clip(raw.content, 5000);
    if (!taskId) return { ok: false, code: 'task_id_required' };
    if (!content) return { ok: false, code: 'content_required' };
    return { ok: true, params: { task_id: taskId, content } };
  }
  return { ok: false, code: 'unknown_tool' };
}

// ─────────────────────────────────────────────
// 담당자 이름 → user_id (워크스페이스 전체 멤버 풀). resolveAssignees 재사용:
//   표시명 → 계정명 → role 순, 외부 고객·AI 는 코드로 배제, 미매칭이면 null (틀린 추측 강요 안 함).
// ─────────────────────────────────────────────
async function resolveAssigneeName(businessId, name) {
  if (!name) return { userId: null, displayName: null };
  const bms = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const pool = new Map();
  for (const m of bms) {
    if (!m.user_id) continue;
    pool.set(m.user_id, {
      user_id: m.user_id, role: m.role || null,
      accountName: m.user?.name || null,
      isExternal: false, isAi: m.role === 'ai',
    });
  }
  const nameMap = await getMemberNameMap(businessId, [...pool.keys()]);
  for (const [uid, v] of pool) {
    const dn = nameMap.get(uid);
    v.displayName = dn?.name || dn?.name_localized || v.accountName || null;
  }
  const [resolved] = resolveAssignees([{ guessed_assignee_name: name }], pool);
  const uid = resolved?.guessed_assignee_user_id || null;
  return { userId: uid, displayName: uid ? (pool.get(uid)?.displayName || null) : null };
}

// ─────────────────────────────────────────────
// /help 프롬프트 컨텍스트 — 오늘/요일/시간대/멤버 로스터.
//   로스터 주입이 담당자 해석 정확도의 핵심 (LLM 이 실제 멤버명을 assignee_name 으로 뱉게).
// ─────────────────────────────────────────────
async function buildToolSystemContext(businessId, todayIso) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const tz = biz?.timezone || 'Asia/Seoul';
  const now = todayIso ? new Date(todayIso) : new Date();
  let dateStr = '';
  try {
    dateStr = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, dateStyle: 'full' }).format(now);
  } catch { dateStr = now.toISOString().slice(0, 10); }

  const bms = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const ids = bms.filter((m) => m.role !== 'ai' && m.user_id).map((m) => m.user_id);
  const nameMap = await getMemberNameMap(businessId, ids);
  const roster = bms
    .filter((m) => m.role !== 'ai' && m.user_id)
    .map((m) => {
      const dn = nameMap.get(m.user_id);
      const name = dn?.name || dn?.name_localized || m.user?.name || `#${m.user_id}`;
      return `- ${name}${m.role ? ` (${m.role})` : ''}`;
    })
    .join('\n');

  return `[오늘] ${dateStr} · [시간대] ${tz}\n[멤버] 담당자로 지정 가능한 워크스페이스 멤버 (assignee_name 은 반드시 이 이름과 정확히 일치):\n${roster || '- (없음)'}`;
}


// ─────────────────────────────────────────────
// 일정 옮기기 (2026-10-11 — Irene: *"목요일에 넣어두었던 일정들 중에 고두밥 가는 거 빼고 다 못했어.
//   세 개 일정 다음 주 월요일로 바꿔줘"* → Cue 가 «기존 일정을 고치는 기능은 못 써요» 라고 답했다).
//   Cue 는 일정을 **만들기만** 했고, 지난 일정은 보지도 못했다(컨텍스트는 오늘·앞으로 7일뿐).
//   그래서 ①고칠 수 있는 일정 목록(#id·요일·시각)을 프롬프트에 싣고 ②reschedule_events 로 여러 건을
//   한 장의 확인 카드에 올린다. 실행은 행동 계층 rescheduleEvent 한 문 — 화면 수정과 같은 판정.
// ─────────────────────────────────────────────
const SCHEDULE_WORDS = /일정|캘린더|미팅|회의|약속|스케줄|옮|미뤄|미루|연기|당겨|앞당|월요일|화요일|수요일|목요일|금요일|토요일|일요일|다음\s*주|schedule|calendar|meeting|event|resched|postpone|move/i;
const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 35;
const EDIT_LIST_LIMIT = 80;
const WD_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** instant → 그 시간대의 벽시계 { date:'YYYY-MM-DD', time:'HH:MM', wd:0..6 } */
function wallOf(at, tz) {
  const d = at instanceof Date ? at : new Date(at);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const hh = String(Number(p.hour) % 24).padStart(2, '0');
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** 그 시간대의 벽시계(날짜·시각) → instant. 오프셋을 두 번 맞춰 서머타임 경계도 견딘다. */
function wallToInstant(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const w = wallOf(new Date(guess), tz);
    const [wy, wm, wd] = w.date.split('-').map(Number);
    const [wh, wmin] = w.time.split(':').map(Number);
    guess += target - Date.UTC(wy, wm - 1, wd, wh, wmin);
  }
  return new Date(guess);
}

/** 일정 한 건 + 옮길 날짜(·시각) → 새 { start_at, end_at } (길이 유지). 종일은 날짜 수 유지. */
function computeMove(event, move, tz) {
  if (event.all_day) {
    const ad = require('../utils/allDayDate');
    const { date, last_date: last } = ad.allDayDates(event);
    const span = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    return ad.allDayRange(move.date, ad.addDays(move.date, Math.max(0, span)));
  }
  const st = move.start_time || wallOf(event.start_at, tz).time;
  const start = wallToInstant(move.date, st, tz);
  const dur = Math.max(0, new Date(event.end_at).getTime() - new Date(event.start_at).getTime());
  return { start_at: start, end_at: new Date(start.getTime() + dur) };
}

/** 이 사람이 이 일정을 «옮길 수 없는» 이유 — 실행(rescheduleEvent)과 같은 순서의 판정. null = 옮길 수 있음 */
function moveBlockReason(event, bm, userId) {
  const { canEditEvent } = require('./calendarPermission');
  if (!canEditEvent(event, bm, userId)) return 'only_creator_or_owner';
  if (event.booking_status) return 'booking_use_actions';
  if (event.rrule && !event.recurrence_parent_id) return 'recurring_use_calendar';
  return null;
}

/** 이 사람에게 **보이는** 일정만 id 로 읽는다 — 캘린더 목록과 같은 술어(access_scope.calendarListWhere). */
async function loadVisibleEvents(businessId, userId, platformRole, extraWhere, opts = {}) {
  const { CalendarEvent } = require('../models');
  const { getUserScope, calendarListWhere } = require('../middleware/access_scope');
  const scope = await getUserScope(userId, businessId, platformRole);
  const base = await calendarListWhere(userId, businessId, scope);
  if (!base) return [];
  return CalendarEvent.findAll({
    where: { [Op.and]: [base, { business_id: businessId }, extraWhere] },
    order: [['start_at', 'ASC'], ['id', 'ASC']],
    ...opts,
  });
}

/** /help 프롬프트 — 옮길 수 있는 일정 목록. 일정 얘기일 때만 싣는다(토큰). */
async function buildEventEditContext(businessId, userId, platformRole, text) {
  if (!SCHEDULE_WORDS.test(String(text || ''))) return '';
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const tz = biz?.timezone || 'Asia/Seoul';
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (!bm || bm.role === 'ai' || bm.role === 'client') return '';
  const now = Date.now();
  const from = new Date(now - LOOKBACK_DAYS * 86400000);
  const to = new Date(now + LOOKAHEAD_DAYS * 86400000);
  const rows = await loadVisibleEvents(businessId, userId, platformRole,
    { start_at: { [Op.lt]: to }, end_at: { [Op.gt]: from } }, { limit: EDIT_LIST_LIMIT + 1 });
  const lines = rows.slice(0, EDIT_LIST_LIMIT).map((e) => {
    const s = wallOf(e.start_at, tz);
    const when = e.all_day
      ? `${s.date}(${WD_KO[s.wd]}) 종일`
      : `${s.date}(${WD_KO[s.wd]}) ${s.time}–${wallOf(e.end_at, tz).time}`;
    const why = moveBlockReason(e, bm, userId);
    const tag = why === 'recurring_use_calendar' ? ' [반복 일정 — 캘린더에서 직접 옮겨야 함]'
      : why === 'booking_use_actions' ? ' [상담 예약 — «다른 시간 제안» 으로만 바꿈]'
      : why ? ' [만든 사람만 옮길 수 있음]' : '';
    return `- #${e.id} ${when} «${String(e.title || '').slice(0, 80)}»${tag}`;
  });
  const more = rows.length > EDIT_LIST_LIMIT ? `\n- … (더 있음 — 범위를 좁혀 말해 달라고 할 것)` : '';
  return `[옮길 수 있는 일정] 지난 ${LOOKBACK_DAYS}일~앞으로 ${LOOKAHEAD_DAYS}일, 사용자가 볼 수 있는 워크스페이스 일정 (날짜는 워크스페이스 시간대 · 요일 표기). `
    + `일정을 옮기거나 미뤄 달라고 하면 이 목록에서 고른 #번호로 reschedule_events 를 제안한다. 여러 건이면 한 번에 moves 로 묶는다. `
    + `[ ] 표시가 붙은 일정은 옮길 수 없으니 넣지 말고 이유를 말한다. 개인 구글 캘린더 일정은 여기 없고 옮길 수 없다.\n`
    + (lines.length ? lines.join('\n') + more : '- (이 기간에 일정 없음 — 조회함)');
}

// ─────────────────────────────────────────────
// /help 응답용 — LLM tool_calls → 단일 proposed_action (첫 유효 쓰기 툴 1건만).
//   담당자 이름을 여기서 해석해 카드가 결과를 표시하게 한다.
// ─────────────────────────────────────────────
async function buildProposedAction(businessId, toolCalls, userId = null, platformRole = null) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  for (const tc of toolCalls) {
    const name = tc?.function?.name;
    if (!WRITE_TOOLS.has(name)) continue;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    const v = validateNormalize(name, args);
    if (!v.ok) continue;
    const params = v.params;
    if (name === 'create_task' && params.assignee_name) {
      const r = await resolveAssigneeName(businessId, params.assignee_name);
      params.assignee_id = r.userId || undefined;
      params.assignee_resolved_name = r.displayName || undefined;  // 카드 표시용 (못 찾으면 undefined → "본인")
    }
    // 일정 옮기기 — 카드가 «무엇이 언제에서 언제로» 를 보여주게 한다. 보이지 않는 일정은 조용히 뺀다
    //   (제목을 카드에 실으면 그게 곧 노출이다). 옮길 수 없는 일정은 이유와 함께 남겨 사람이 본다.
    if (name === 'reschedule_events') {
      if (!userId) continue;
      const preview = await previewMoves(businessId, userId, platformRole, params.moves);
      if (!preview.items.length) continue;
      params.moves = preview.items.map((x) => ({ event_id: x.event_id, date: x.date, ...(x.start_time ? { start_time: x.start_time } : {}) }));
      params.items = preview.items;
      params.timezone = preview.tz;
      return { tool: name, params };
    }
    // 전이·댓글 — 카드가 "어느 업무인지" 보여주도록 대상 업무 제목을 해석 (워크스페이스 격리)
    if (TASK_TARGET_TOOLS.has(name) && params.task_id) {
      const task = await Task.findOne({ where: { id: params.task_id, business_id: businessId }, attributes: ['id', 'title'] });
      if (!task) continue;   // 다른 워크스페이스/없는 업무를 가리키면 제안 자체를 버린다
      params.task_title = task.title;
    }
    return { tool: name, params };
  }
  return null;
}


/** 옮길 일정들의 미리보기 — 보이는 것만, 옮길 수 없으면 blocked 코드. 카드와 실행이 같은 계산(computeMove)을 쓴다. */
async function previewMoves(businessId, userId, platformRole, moves) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const tz = biz?.timezone || 'Asia/Seoul';
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (!bm || bm.role === 'ai' || bm.role === 'client') return { tz, items: [] };
  const ids = moves.map((m) => m.event_id);
  const rows = await loadVisibleEvents(businessId, userId, platformRole, { id: { [Op.in]: ids } });
  const byId = new Map(rows.map((e) => [e.id, e]));
  const { CalendarEventAttendee } = require('../models');
  const items = [];
  for (const m of moves) {
    const e = byId.get(m.event_id);
    if (!e) continue;
    const next = computeMove(e, m, tz);
    const others = await CalendarEventAttendee.count({ where: { event_id: e.id, [Op.or]: [{ user_id: { [Op.ne]: userId } }, { user_id: null }] } });
    items.push({
      event_id: e.id, title: e.title, all_day: !!e.all_day,
      date: m.date, ...(m.start_time ? { start_time: m.start_time } : {}),
      from_start: new Date(e.start_at).toISOString(), from_end: new Date(e.end_at).toISOString(),
      to_start: next.start_at.toISOString(), to_end: next.end_at.toISOString(),
      attendees_others: others,
      ...(moveBlockReason(e, bm, userId) ? { blocked: moveBlockReason(e, bm, userId) } : {}),
    });
  }
  return { tz, items };
}

// ─────────────────────────────────────────────
// execute-action — 검증 → 행동 계층 params 매핑 → dispatch.
//   actor = 사용자 본인. 행동 계층이 메뉴 권한(qtask/qcalendar/qdocs)·assertAssignable·감사·broadcast 를 건다.
// ─────────────────────────────────────────────
async function executeTool(actor, businessId, tool, rawParams) {
  const v = validateNormalize(tool, rawParams);
  if (!v.ok) return { ok: false, code: v.code, http: 400 };
  const p = v.params;

  // 전이·댓글 — 대상 업무를 워크스페이스 격리로 로드한 뒤 행동 계층 전이 호출.
  //   권한(담당자만·접근권)은 행동 계층이 건다. 여기선 대상 존재·소속만 확인.
  if (TASK_TARGET_TOOLS.has(tool)) {
    const task = await Task.findOne({ where: { id: p.task_id, business_id: businessId } });
    if (!task) return { ok: false, code: 'invalid_task', http: 400 };
    let tr;
    if (tool === 'submit_review') tr = await submitReview(task, actor);
    else if (tool === 'complete_task') tr = await complete(task, actor);
    else tr = await createComment(actor, task, { content: p.content });
    if (!tr.ok) return tr;
    return { ok: true, data: { entity_type: 'task', entity_id: task.id, entity: tr.data?.task || task } };
  }

  // 일정 옮기기 — 한 건씩 행동 계층으로. 새 시각은 **서버가 다시 계산**한다(카드가 보낸 to_start 는 믿지 않는다).
  //   일부만 실패해도 된 것은 된 것이다 — 결과에 실패 목록을 싣고, 하나도 못 옮겼으면 첫 사유로 거절한다.
  if (tool === 'reschedule_events') {
    const { CalendarEvent } = require('../models');
    const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
    const tz = biz?.timezone || 'Asia/Seoul';
    const moved = [];
    const failed = [];
    for (const m of p.moves) {
      const e = await CalendarEvent.findOne({ where: { id: m.event_id, business_id: businessId } });
      if (!e) { failed.push({ event_id: m.event_id, code: 'event_not_found', http: 404 }); continue; }
      const next = computeMove(e, m, tz);
      const r = await rescheduleEvent(actor, {
        businessId, eventId: e.id, startAt: next.start_at.toISOString(), endAt: next.end_at.toISOString(), via: 'cue',
      });
      if (r.ok) moved.push(e.id);
      else failed.push({ event_id: m.event_id, code: r.code, http: r.http || 400 });
    }
    if (!moved.length) {
      const f = failed[0] || { code: 'no_events_to_move', http: 400 };
      return { ok: false, code: f.code, http: f.http };
    }
    return { ok: true, data: { entity_type: 'event', entity_id: moved[0], entity: null, moved_ids: moved, failed: failed.map(({ event_id, code }) => ({ event_id, code })) } };
  }

  let r;
  let entityType;
  if (tool === 'create_task') {
    // #237 "완료로 추가" — Irene: "완료된 업무로 **오늘 업무날짜로** 리스트에 넣어줘".
    //   마감을 따로 말하지 않았으면 오늘로 채운다. 그래야 나중에 되살려도 오늘 자리에 남고,
    //   목록 안착 자체는 completed_at(=지금) 이 책임진다(utils/todayTaskSet ⑧).
    let dueDate = p.due_date;
    if (p.completed && !dueDate) {
      const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
      dueDate = todayInTz(biz?.timezone || 'Asia/Seoul');
    }
    r = await createTask(actor, {
      businessId,
      title: p.title,
      assigneeId: p.assignee_id,          // 없으면 행동 계층이 배정 결정 — 프로젝트가 있으면 기본담당자→PM→본인, 없으면 본인
      description: p.description,
      dueDate,
      projectId: p.project_id,
      source: 'manual',
      createdVia: 'cue',                    // provenance(표시 전용) — source·권한 무관, "Cue로 추가됨" 배지용
    }, { autoAiEstimate: false });          // Cue 채팅 생성은 백그라운드 AI 추정 안 붙임
    entityType = 'task';
  } else if (tool === 'create_event') {
    r = await createEvent(actor, {
      businessId, title: p.title,
      startAt: p.start_at, endAt: p.end_at,
      description: p.description, location: p.location,
      createdVia: 'cue',
    });
    entityType = 'event';
  } else if (tool === 'create_document_draft') {
    r = await createDocument(actor, {
      businessId, kind: p.kind, title: p.title,
      clientId: p.client_id, projectId: p.project_id,
      createdVia: 'cue',
    });
    entityType = 'document';
  } else {
    return { ok: false, code: 'unknown_tool', http: 400 };
  }

  if (!r.ok) return r;   // 행동 계층 거부 계약(code·http) 그대로 올린다

  // #237 "완료로 추가" — 생성된 업무를 **행동 계층 complete() 로** 닫는다.
  //   ★ createTask 에 status:'completed' 를 넘기지 않는다 — 그러면 completed_at·이력·Focus 종료·
  //     broadcast·요청자 알림이 전부 빠진 반쪽 완료가 만들어지고, 컨펌 정책도 우회된다.
  //   실패는 **생성을 되돌리지 않는다** — 업무는 남기고 "완료는 못 했다" 를 카드가 안내한다:
  //     only_assignee          담당자가 남 (요청 업무는 담당자만 완료할 수 있다)
  //     not_ready_for_complete 컨펌자가 붙었다 (요청 업무엔 요청자가 자동 컨펌자로 들어간다)
  let completedSkipped = null;
  if (tool === 'create_task' && p.completed) {
    const cr = await complete(r.data.task, actor);
    if (!cr.ok) completedSkipped = cr.code || 'complete_failed';
  }

  // 엔티티 정규화 — 라우트가 프로비넌스 감사·응답에 쓴다 (경로별 반환 형태 차이를 여기서 흡수)
  const d = r.data || {};
  const entity = entityType === 'task' ? d.task
    : entityType === 'event' ? (d.full || d.event)
    : d.document;
  return {
    ok: true,
    data: {
      entity_type: entityType, entity_id: entity?.id || null, entity,
      ...(completedSkipped ? { completed_skipped: completedSkipped } : {}),
    },
  };
}

module.exports = {
  TOOL_SCHEMAS,
  WRITE_TOOLS,
  DOC_KINDS,
  buildToolSystemContext,
  buildEventEditContext,
  buildProposedAction,
  executeTool,
  // 테스트/디버그
  validateNormalize,
  resolveAssigneeName,
  computeMove,
  wallToInstant,
};
