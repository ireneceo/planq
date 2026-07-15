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
const { getMemberNameMap } = require('./displayName');
const { resolveAssignees } = require('./task_extractor');
const { createTask, submitReview, complete, createComment } = require('./actions/task_actions');
const { createEvent } = require('./actions/event_actions');
const { createDocument } = require('./actions/document_actions');

// 문서 종류 — 재무 계열(invoice·tax_invoice) 의도적 제외 (Cue 는 청구서를 만들지 않는다)
const DOC_KINDS = ['quote', 'contract', 'nda', 'proposal', 'sow', 'meeting_note', 'sop', 'custom'];

// 전이·댓글 툴 — 이미 존재하는 업무(task_id)를 대상으로 한다. 권한은 행동 계층이 건다
//   (submit/complete 는 담당자만 = only_assignee 403, 댓글은 canAccessTask). Cue 는 대상만 지정.
const TASK_TARGET_TOOLS = new Set(['submit_review', 'complete_task', 'add_task_comment']);

const WRITE_TOOLS = new Set(['create_task', 'create_event', 'create_document_draft', ...TASK_TARGET_TOOLS]);

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
// /help 응답용 — LLM tool_calls → 단일 proposed_action (첫 유효 쓰기 툴 1건만).
//   담당자 이름을 여기서 해석해 카드가 결과를 표시하게 한다.
// ─────────────────────────────────────────────
async function buildProposedAction(businessId, toolCalls) {
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

  let r;
  let entityType;
  if (tool === 'create_task') {
    r = await createTask(actor, {
      businessId,
      title: p.title,
      assigneeId: p.assignee_id,          // 없으면 행동 계층이 본인으로 기본 배정
      description: p.description,
      dueDate: p.due_date,
      projectId: p.project_id,
      source: 'manual',
    }, { autoAiEstimate: false });          // Cue 채팅 생성은 백그라운드 AI 추정 안 붙임
    entityType = 'task';
  } else if (tool === 'create_event') {
    r = await createEvent(actor, {
      businessId, title: p.title,
      startAt: p.start_at, endAt: p.end_at,
      description: p.description, location: p.location,
    });
    entityType = 'event';
  } else if (tool === 'create_document_draft') {
    r = await createDocument(actor, {
      businessId, kind: p.kind, title: p.title,
      clientId: p.client_id, projectId: p.project_id,
    });
    entityType = 'document';
  } else {
    return { ok: false, code: 'unknown_tool', http: 400 };
  }

  if (!r.ok) return r;   // 행동 계층 거부 계약(code·http) 그대로 올린다

  // 엔티티 정규화 — 라우트가 프로비넌스 감사·응답에 쓴다 (경로별 반환 형태 차이를 여기서 흡수)
  const d = r.data || {};
  const entity = entityType === 'task' ? d.task
    : entityType === 'event' ? (d.full || d.event)
    : d.document;
  return { ok: true, data: { entity_type: entityType, entity_id: entity?.id || null, entity } };
}

module.exports = {
  TOOL_SCHEMAS,
  WRITE_TOOLS,
  DOC_KINDS,
  buildToolSystemContext,
  buildProposedAction,
  executeTool,
  // 테스트/디버그
  validateNormalize,
  resolveAssigneeName,
};
