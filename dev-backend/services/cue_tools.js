// Cue 대화형 실행 — **에이전트 카탈로그 어댑터** (2026-10-12, 설계 docs/CUE_REGISTRY_FOLD_DESIGN.md · Fable DESIGN-OK).
//
// 왜 바뀌었나:
//   Irene 2026-10-12 — *"태그나 다른 설정 요청하면 다 되는 거 맞냐 … 다른 업무, 이메일 쓰기, 프로젝트 등록, 노트 작성,
//   등등 Cue가 할 수 있는 범위를 넓히라는 거야. 그리고 수정까지."* Cue 는 손으로 짠 쓰기 7종뿐이었고, 같은 일을 하는
//   외부 AI 카탈로그(services/agent/registry.js, 49종)가 따로 있었다 — 설계서 §8.5 결정 ⑥ «카탈로그는 한 벌» 이 미이행이었다.
//
// 이 파일이 하는 일(그 외는 하지 않는다 — 검증·권한·실행은 레지스트리·행동 계층의 몫):
//   - TOOL_SCHEMAS     레지스트리 도구 중 Cue 허용목록을 OpenAI function schema 로(zod → JSON Schema)
//   - principalOf      로그인 세션 → 카탈로그 principal(provider 'cue'). scopes 는 «표면» — 권한은 행동 계층이 본다
//   - converse         /help 의 읽기 루프(라운드 4 · 읽기 6 · 12초). 쓰기 도구가 나오면 멈추고 **제안만** 만든다
//   - buildProposedAction / proposeOne   쓰기 제안 = strict 파싱 + preview(실행 X) + 카드 데이터
//   - executeTool      카드 [실행] → runTool(humanConfirmed) — 실행 문은 이것 하나
//
// ★ /help 는 절대 쓰기를 실행하지 않는다 — 여기서 runTool 을 부르는 곳은 executeTool 과 읽기 루프(읽기 도구만)뿐이다(가드 cuetools).
// ★ 재무(invoice/payment)는 레지스트리에 없고(가드 agentsurface) 여기서도 열지 않는다(가드 cuefinance·cuetools).

const { zodToJsonSchema } = require('zod-to-json-schema');
const { z } = require('zod');
const { BusinessMember, User, Business } = require('../models');
const { getMemberNameMap } = require('./displayName');
const { resolveAssignees } = require('./task_extractor');
const { TOOLS, byName } = require('./agent/registry');
const { runTool, proposeTool } = require('./agent/execute');
const cfg = require('./agent_oauth/config');
const { wallOf } = require('../utils/wallTime');

// ── Cue 가 쓸 수 있는 도구(허용목록) ─────────────────────────
//   쓰기: 업무·일정·문서·프로젝트·메모·상담·Q info·메일 답장 초안. 파일 올리기(upload_file)는 외부 URL 을 받는 문이라 빼둔다.
//   읽기: 찾기·상세 — 루프가 부른다. get_context 는 프롬프트에 이미 같은 값이 들어간다.
const CUE_WRITE = [
  'create_task', 'update_task', 'reschedule_task', 'complete_task', 'assign_task', 'submit_review', 'add_task_note',
  'add_task_reviewers', 'move_task_to_project',
  'create_event', 'update_event', 'add_meeting_to_event', 'reschedule_events',
  'create_document', 'append_to_document', 'update_document', 'link_documents', 'move_document_to_project',
  'create_project', 'create_memo', 'add_project_note', 'add_client_interaction', 'create_knowledge_item',
  'create_mail_reply_draft',
];
const CUE_READ = [
  'search_all', 'search_tasks', 'get_task', 'get_task_notes', 'search_members', 'search_clients', 'get_client',
  'search_projects', 'get_project', 'list_events', 'list_project_notes', 'list_client_interactions',
  'list_mail_accounts', 'search_mail', 'get_mail_thread', 'get_mail_message', 'search_documents', 'get_document',
  'list_files', 'search_meeting_notes', 'get_meeting_note', 'search_knowledge', 'get_knowledge_item',
];
const WRITE_TOOLS = new Set(CUE_WRITE);
const READ_TOOLS = new Set(CUE_READ);

// 옛 이름(이미 화면에 떠 있는 카드·음성 시트) → 카탈로그 이름. 인자 모양도 여기서 한 번만 맞춘다.
const ALIASES = {
  create_document_draft: (a) => ({ name: 'create_document', args: { title: a.title, content: '', ...(a.project_id ? { project_id: a.project_id } : {}) } }),
  add_task_comment: (a) => ({ name: 'add_task_note', args: { task_id: a.task_id, content: a.content } }),
};
// 프로토타입 키(constructor·toString)가 별칭으로 잡히면 500 이 났다(Fable 2026-10-11) — 자기 키만 본다.
const isAlias = (name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(ALIASES, name);
const HIDDEN_INPUTS = new Set(['confirmation_token', 'idempotency_key', 'source']);

// ─────────────────────────────────────────────
// OpenAI function schema — 레지스트리 zod 에서 만든다(손으로 쓰지 않는다). create_task 에만 assignee_name 편의 칸을 더한다
//   (프롬프트의 [멤버] 로스터 이름 → 여기서 id 로 바꾼다. 음성·짧은 요청에서 search_members 왕복을 아낀다).
// ─────────────────────────────────────────────
function schemaOf(tool) {
  const shape = Object.fromEntries(Object.entries(tool.input).filter(([k]) => !HIDDEN_INPUTS.has(k)));
  if (tool.name === 'create_task') shape.assignee_name = z.string().max(100).optional().describe('Assignee name exactly as in the [멤버] roster (alternative to assignee_user_id).');
  const js = zodToJsonSchema(z.object(shape), { $refStrategy: 'none' });
  delete js.$schema;
  return { type: 'function', function: { name: tool.name, description: tool.description.slice(0, 1000), parameters: js } };
}
const TOOL_SCHEMAS = TOOLS.filter((t) => WRITE_TOOLS.has(t.name) || READ_TOOLS.has(t.name)).map(schemaOf);

// ─────────────────────────────────────────────
// principal — 로그인 세션이 동의다. scopes 는 «표면»: 묶음 전부 + 메일은 동의 화면과 같은 술어(워크스페이스 스위치 ∧ qmail 메뉴)일 때만.
// ─────────────────────────────────────────────
async function principalOf(userId, businessId, platformRole = null) {
  const scopes = [...cfg.BUNDLE_SCOPES];
  try {
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
    const { workspaceMailAllowed } = require('./agent_oauth/grants');
    const { getMemberMenuLevels } = require('../middleware/menu_permission');
    const lv = await getMemberMenuLevels(businessId, userId);
    const mailMenu = !lv || lv.role === 'owner' || lv.role === 'admin' || (lv.menus?.qmail || 'write') !== 'none';
    if (biz && workspaceMailAllowed(biz.permissions) && mailMenu) scopes.push(...cfg.OPT_IN_SCOPES);
  } catch (e) { console.warn('[cue principal mail]', e.message); }
  return { userId, businessId, platformRole: platformRole || null, provider: 'cue', grantId: `cue:${userId}:${businessId}`, clientId: null, scopes };
}

// ─────────────────────────────────────────────
// 담당자 이름 → user_id (워크스페이스 멤버 풀). 표시명 → 계정명 → role 순, 고객·AI 배제, 못 찾으면 null(틀린 추측 강요 안 함).
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
    pool.set(m.user_id, { user_id: m.user_id, role: m.role || null, accountName: m.user?.name || null, isExternal: false, isAi: m.role === 'ai' });
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

/** 모델·옛 카드가 보낸 인자 → 카탈로그 인자. 별칭·편의 칸(assignee_name)만 바꾼다 — 검증은 레지스트리가 한다. */
async function normalizeCall(businessId, name, raw = {}) {
  let tool = name; let args = { ...(raw || {}) };
  if (isAlias(tool)) ({ name: tool, args } = ALIASES[tool](args));
  if (tool === 'create_task') {
    if (args.assignee_id && !args.assignee_user_id) args.assignee_user_id = args.assignee_id;
    delete args.assignee_id;
    const nm = args.assignee_name;
    delete args.assignee_name; delete args.assignee_resolved_name;
    if (nm && !args.assignee_user_id) {
      const r = await resolveAssigneeName(businessId, nm);
      if (r.userId) args.assignee_user_id = r.userId;
    }
  }
  for (const k of Object.keys(args)) if (args[k] === null || args[k] === '') { if (!(tool === 'create_document' && k === 'content')) delete args[k]; }
  return { tool, args };
}

// ─────────────────────────────────────────────
// /help 프롬프트 — 오늘/요일/시간대/멤버 로스터(user_id 포함). 날짜 계산·담당자 해석의 바탕.
// ─────────────────────────────────────────────
async function buildToolSystemContext(businessId, todayIso) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const tz = biz?.timezone || 'Asia/Seoul';
  const now = todayIso ? new Date(todayIso) : new Date();
  let dateStr = '';
  try { dateStr = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, dateStyle: 'full' }).format(now); } catch { dateStr = now.toISOString().slice(0, 10); }
  const bms = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const ids = bms.filter((m) => m.role !== 'ai' && m.role !== 'client' && m.user_id).map((m) => m.user_id);
  const nameMap = await getMemberNameMap(businessId, ids);
  const roster = bms.filter((m) => m.role !== 'ai' && m.role !== 'client' && m.user_id).map((m) => {
    const dn = nameMap.get(m.user_id);
    return `- ${dn?.name || dn?.name_localized || m.user?.name || `#${m.user_id}`} (user_id ${m.user_id}${m.role ? `, ${m.role}` : ''})`;
  }).join('\n');
  return `[오늘] ${dateStr} · [시간대] ${tz}\n[멤버] 담당자·참석자로 지정 가능한 워크스페이스 멤버:\n${roster || '- (없음)'}\n`
    + `[도구 사용] 무엇을 고치거나 연결하려면 먼저 찾기 도구(search_*, list_events, get_*)로 대상의 id 를 확인한다. 제목으로 지목한 업무는 담당자와 무관하게 search_tasks 에 assignee:'anyone' 으로 찾는다. `
    + `쓰기 도구는 한 번에 하나만 부른다 — 실행은 사람이 확인 카드를 누른 뒤에 된다. 지우기·보내기·청구는 할 수 없다.\n`
    + `[쓰기 원칙] 사용자가 말한 것만 넣는다 — 말하지 않은 고객·담당자·참석자·태그를 붙이지 말고, 본문·메모에 조언·후속 조치·추측을 덧붙이지 않는다. `
    + `꼭 골라야 하는 값은 가장 중립적인 쪽으로(프로젝트 종류는 고객을 말했을 때만 client, 아니면 internal) — 사람이 카드에서 고친다. `
    + `화상회의·구글 미팅 링크를 원하면 create_event 에 create_meeting:true(팀 공개 일정만) 또는 기존 일정이면 add_meeting_to_event.\n`
    // 2026-10-12 실측: «회의록 문서 초안 만들어줘» 에 도구 대신 채팅에 마크다운을 써 주고 «복붙해서 새 문서로» 라고 했다.
    //   할 수 있는 일을 «못 한다/직접 하라» 로 답하지 않게 — 요청 동사 → 도구 지도를 준다.
    + `[할 수 있는 일] «만들어/남겨/등록해/추가해/바꿔/옮겨/연결해» 요청은 글로 대신 써 주거나 «직접 하세요» 라고 하지 말고 맞는 쓰기 도구로 카드를 낸다(내용이 필요하면 도구 인자에 넣는다):\n`
    + `업무 만들기 create_task · 업무 수정(제목·설명·태그·분류·예상시간) update_task · 마감 reschedule_task · 담당 assign_task · 완료 complete_task · 검토 요청 submit_review · 컨펌자 add_task_reviewers · 업무 메모 add_task_note · 업무 프로젝트 옮기기 move_task_to_project · `
    + `일정 만들기 create_event · 일정 수정 update_event · 여러 일정 옮기기 reschedule_events · 화상회의 추가 add_meeting_to_event · `
    + `문서(회의록·초안·보고서) create_document · 문서에 덧붙이기 append_to_document · 문서 고치기 update_document · 문서 연결 link_documents · 문서 프로젝트 옮기기 move_document_to_project · `
    + `프로젝트 만들기 create_project · 프로젝트 메모 add_project_note · Q note 메모 create_memo · Q info 정리 create_knowledge_item · 고객 상담 기록 add_client_interaction · 메일 답장 초안 create_mail_reply_draft(보내지는 않는다).\n`
    + `못 하는 일(삭제·메일 발송·청구/결제·권한·워크스페이스 설정·반복 일정 시리즈 편집)만 «못 한다» 고 말하고 어느 화면에서 하는지 알려 준다.`;
}

// ─────────────────────────────────────────────
// 옮길 수 있는 일정 목록 — 일정 얘기일 때만(토큰). list_events 왕복 없이 «목요일 일정» 을 알아듣게 한다(2026-10-11).
// ─────────────────────────────────────────────
const SCHEDULE_WORDS = /일정|캘린더|미팅|회의|약속|스케줄|옮|미뤄|미루|연기|당겨|앞당|월요일|화요일|수요일|목요일|금요일|토요일|일요일|다음\s*주|schedule|calendar|meeting|event|resched|postpone|move/i;
const WD_KO = ['일', '월', '화', '수', '목', '금', '토'];
async function buildEventEditContext(businessId, userId, platformRole, text) {
  if (!SCHEDULE_WORDS.test(String(text || ''))) return '';
  const p = await principalOf(userId, businessId, platformRole);
  const now = Date.now();
  const r = await runTool(p, 'list_events', { from: new Date(now - 14 * 86400000).toISOString(), to: new Date(now + 35 * 86400000).toISOString() }, { quietRead: true });
  if (!r.ok) return '';
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const tz = biz?.timezone || 'Asia/Seoul';
  const lines = (r.items || []).slice(0, 80).map((e) => {
    const s = wallOf(e.start_at, tz);
    const when = e.all_day ? `${e.date || s.date}(${WD_KO[s.wd]}) 종일` : `${s.date}(${WD_KO[s.wd]}) ${s.time}–${wallOf(e.end_at, tz).time}`;
    return `- #${e.event_id} ${when} «${String(e.title || '').slice(0, 80)}»${e.recurring ? ' [반복 일정 — 캘린더에서 직접 바꿔야 함]' : ''}${e.meeting_url ? ' [화상회의 있음]' : ''}`;
  });
  return '[최근·다가오는 일정] 지난 14일~앞으로 35일, 사용자가 볼 수 있는 워크스페이스 일정(워크스페이스 시간대·요일). '
    + '옮기기는 reschedule_events(여러 건이면 moves 로 묶는다), 제목·장소·시간 수정은 update_event, 화상회의(Google Meet) 추가는 add_meeting_to_event 에 이 #번호를 쓴다.\n'
    + (lines.length ? lines.join('\n') : '- (이 기간에 일정 없음 — 조회함)');
}

// ─────────────────────────────────────────────
// 확인 카드 데이터 — preview 계약(설계 B): { summary_key, fields, notes, targets, items? }. 라벨은 i18n 키.
//   필드 종류는 레지스트리 zod 에서 읽는다(도구별 손그림 없음). id 대상(task_id·event_id…)은 편집 불가.
// ─────────────────────────────────────────────
const TARGET_KEYS = { task_id: 'task', event_id: 'event', project_id: 'project', client_id: 'client', document_id: 'document', thread_id: 'mail' };
const MEMBER_KEYS = new Set(['assignee_user_id', 'attendee_user_ids', 'reviewer_user_ids', 'member_user_ids', 'default_assignee_user_id']);
const CLIENT_KEYS = new Set(['client_ids', 'attendee_client_ids']);

/** 카드의 멤버 고르기 목록 — 이 워크스페이스의 사람 멤버(고객·AI 제외). */
async function memberOptions(businessId) {
  const bms = await BusinessMember.findAll({ where: { business_id: businessId, removed_at: null }, attributes: ['user_id', 'role'] });
  const ids = bms.filter((m) => m.user_id && m.role !== 'ai' && m.role !== 'client').map((m) => m.user_id);
  const nm = await getMemberNameMap(businessId, ids);
  const users = await User.findAll({ where: { id: ids }, attributes: ['id', 'name'] });
  const acct = new Map(users.map((u) => [u.id, u.name]));
  return ids.filter((id) => acct.has(id)).map((id) => ({ value: id, label: nm.get(id)?.name || nm.get(id)?.name_localized || acct.get(id) || `#${id}` }));
}
/** 고객 id → 이름(이 워크스페이스 고객만 — 카드에 숫자 대신 이름). */
async function clientLabels(businessId, ids) {
  if (!ids || !ids.length) return [];
  const { Client } = require('../models');
  const rows = await Client.findAll({ where: { business_id: businessId, id: ids }, attributes: ['id', 'display_name', 'company_name'] });
  return rows.map((c) => ({ value: c.id, label: c.display_name || c.company_name || `#${c.id}` }));
}
const LONG_TEXT = new Set(['description', 'content', 'note', 'body']);
const EXTRA_EDITABLE = {
  create_task: ['due_date', 'assignee_user_id', 'description'],
  create_event: ['location', 'description'],
};

function unwrap(def) {
  let d = def;
  while (d && (d._def?.typeName === 'ZodOptional' || d._def?.typeName === 'ZodDefault' || d._def?.typeName === 'ZodNullable' || d._def?.typeName === 'ZodEffects')) {
    d = d._def.innerType || d._def.schema;
  }
  return d;
}
function fieldType(key, def) {
  const d = unwrap(def);
  const tn = d?._def?.typeName;
  if (MEMBER_KEYS.has(key)) return tn === 'ZodArray' ? 'members' : 'member';
  if (tn === 'ZodEnum') return 'select';
  if (tn === 'ZodBoolean') return 'bool';
  if (tn === 'ZodNumber') return 'number';
  if (tn === 'ZodArray') return 'chips';
  if (tn === 'ZodString') {
    if (/(^|_)date$/.test(key)) return 'date';
    if (/_at$/.test(key)) return 'datetime';
    return LONG_TEXT.has(key) ? 'textarea' : 'text';
  }
  return 'readonly';
}

async function targetTitle(p, kind, id) {
  const call = { task: ['get_task', { task_id: id }], project: ['get_project', { project_id: id }], client: ['get_client', { client_id: id }],
    document: ['get_document', { post_id: id }], mail: ['get_mail_thread', { thread_id: id }] }[kind];
  try {
    if (kind === 'event') return null;   // 일정 제목은 preview(previewUpdateEvent 등)가 권한을 본 뒤 준다
    if (!call) return null;
    const r = await runTool(p, call[0], call[1], { quietRead: true });
    if (!r.ok) return null;
    const o = r.task || r.project || r.client || r.document || r.thread || {};
    return o.title || o.name || o.display_name || o.subject || null;
  } catch { return null; }
}

/** preview 의 흔한 모양 → 사람에게 보일 짧은 알림(i18n 키 + 값). 모르는 칸은 버린다(원문을 그대로 보이지 않는다). */
function notesOf(preview) {
  if (!preview || typeof preview !== 'object') return [];
  const out = [];
  const n = preview.notified_count ?? preview.attendees_notified_if_time_or_place_changes;
  if (n) out.push({ key: 'notify', count: n });
  const meetWarned = (preview.warnings || []).some((w) => /^meet_unavailable/.test(String(w)));
  if ((preview.meeting?.create || preview.meeting?.source) && !(meetWarned && !preview.meeting.source)) out.push({ key: `meet_${preview.meeting.source || 'none'}` });
  for (const w of preview.warnings || []) out.push({ key: `warn_${String(w).split(':')[0]}` });
  if (Array.isArray(preview.attendees) && preview.attendees.length) out.push({ key: 'attendees', names: preview.attendees.slice(0, 10).join(', ') });
  if (Array.isArray(preview.clients_who_will_see_it) && preview.clients_who_will_see_it.length) {
    out.push({ key: 'clients_gain', names: preview.clients_who_will_see_it.map((c) => c.name || c.contact_name || c).slice(0, 10).join(', ') });
  }
  if (preview.meeting?.replaces_existing) out.push({ key: 'meet_replaces' });
  if (Array.isArray(preview.clients)) {
    const see = preview.clients.filter((c) => c.has_planq_account).map((c) => c.name);
    if (see.length) out.push({ key: 'clients_see', names: see.slice(0, 10).join(', ') });
  }
  return out;
}

async function buildCard(p, tool, args, preview) {
  const def = byName.get(tool);
  const fields = [];
  let roster = null;
  const targets = [];
  const extra = EXTRA_EDITABLE[tool] || [];
  for (const [key, zd] of Object.entries(def.input)) {
    if (HIDDEN_INPUTS.has(key) || key === 'moves' || key === 'link_document_ids') continue;
    if (TARGET_KEYS[key] && !(tool.startsWith('create_') && key === 'project_id')) {
      if (args[key] === undefined) continue;
      const fromPreview = preview?.task?.title || preview?.event?.title || null;
      targets.push({ type: TARGET_KEYS[key], id: args[key], title: (TARGET_KEYS[key] === 'task' || TARGET_KEYS[key] === 'event') && fromPreview ? fromPreview : await targetTitle(p, TARGET_KEYS[key], args[key]) });
      continue;
    }
    if (args[key] === undefined && !extra.includes(key)) continue;
    let type = fieldType(key, zd);
    const d = unwrap(zd);
    let options;
    if (type === 'member' || type === 'members') options = roster || (roster = await memberOptions(p.businessId));
    if (CLIENT_KEYS.has(key)) { type = 'clients'; options = await clientLabels(p.businessId, args[key] || []); }
    fields.push({
      key, label_key: `qhelper.field.${key}`, type, value: args[key] ?? null, editable: type !== 'readonly',
      ...(type === 'select' ? { options: d._def.values } : {}),
      ...(options ? { options } : {}),
      ...(key === 'project_id' ? { type: 'readonly', editable: false, display: await targetTitle(p, 'project', args[key]) } : {}),
    });
  }
  // before → after (reschedule_task·assign_task·complete_task·submit_review 등 preview 가 주는 변화)
  const changes = [];
  if (preview?.before && preview?.after) {
    for (const k of Object.keys(preview.after)) {
      const b = preview.before[k]; const a = preview.after[k];
      const show = (v) => (v && typeof v === 'object' ? (v.name || v.title || JSON.stringify(v)) : v);
      if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ key: k, label_key: `qhelper.field.${k}`, before: show(b) ?? null, after: show(a) ?? null });
    }
  }
  return {
    summary_key: `qhelper.tool.${tool}`,
    fields, targets, changes, notes: notesOf(preview),
    ...(Array.isArray(preview?.items) ? { items: preview.items, timezone: preview.timezone } : {}),
  };
}

/** 쓰기 호출 하나 → 제안(카드). 실행하지 않는다. 실패면 { error } — 루프가 모델에게 돌려줘 이유를 말하게 한다. */
async function proposeOne(p, name, rawArgs) {
  const { tool, args } = await normalizeCall(p.businessId, name, rawArgs);
  if (!WRITE_TOOLS.has(tool)) return { error: { code: 'NOT_FOUND', message: 'unknown_tool' } };
  const r = await proposeTool(p, tool, args);
  if (!r.ok) return { error: r.error };
  const card = await buildCard(p, tool, r.args, r.preview);
  return { proposal: { tool, params: r.args, card } };
}

/** /help·음성 — tool_calls 중 첫 쓰기 하나를 제안으로. (음성은 읽기 루프 없이 이것만 쓴다) */
async function buildProposedAction(businessId, toolCalls, userId = null, platformRole = null) {
  if (!Array.isArray(toolCalls) || !toolCalls.length || !userId) return null;
  const p = await principalOf(userId, businessId, platformRole);
  for (const tc of toolCalls) {
    const name = tc?.function?.name;
    if (!WRITE_TOOLS.has(name) && !isAlias(name)) continue;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    const r = await proposeOne(p, name, args);
    if (r.proposal) return r.proposal;
  }
  return null;
}

// ─────────────────────────────────────────────
// 읽기 루프 — 모델이 찾기 도구를 부르면 결과를 돌려주고 다시 묻는다. 상한: 라운드 4 · 읽기 호출 6 · 12초.
//   쓰기 도구가 나오면 그 자리에서 멈추고 첫 쓰기를 **제안**으로 만든다(실행 X). 제안이 거절되면 이유를 모델에 돌려준다.
// ─────────────────────────────────────────────
const MAX_ROUNDS = 4; const MAX_READS = 6; const MAX_MS = 12000;
const RESULT_CHARS = 6000;

async function converse({ p, messages, callLLM, llmOpts = {} }) {
  const started = Date.now();
  const msgs = [...messages];
  const reads = [];
  let usage = { input_tokens: 0, output_tokens: 0, model: null };
  let last = null;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const overBudget = reads.length >= MAX_READS || Date.now() - started > MAX_MS || round === MAX_ROUNDS;
    // 예산이 끝나면 쓰기 도구만 남긴다 — 더 찾지 말고 지금 아는 것으로 답하거나 제안하게
    const tools = overBudget ? TOOL_SCHEMAS.filter((s) => WRITE_TOOLS.has(s.function.name)) : TOOL_SCHEMAS;
    const r = await callLLM({ ...llmOpts, messages: msgs, tools });
    last = r;
    usage = { input_tokens: usage.input_tokens + (r.input_tokens || 0), output_tokens: usage.output_tokens + (r.output_tokens || 0), model: r.model || usage.model };
    if (r.fallback) return { fallback: true, usage, reads };
    const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
    if (!calls.length) return { content: r.content || '', usage, reads };

    const write = calls.find((c) => WRITE_TOOLS.has(c?.function?.name) || isAlias(c?.function?.name));
    if (write) {
      let args = {};
      try { args = JSON.parse(write.function.arguments || '{}'); } catch { args = {}; }
      const pr = await proposeOne(p, write.function.name, args);
      if (pr.proposal) return { content: r.content || '', proposal: pr.proposal, usage, reads };
      // 거절(권한·없는 태그·잘못된 날짜…) — 모델에게 이유를 주고 한 번 더(설명하거나 고쳐서 다시 제안)
      msgs.push({ role: 'assistant', content: r.content || null, tool_calls: [write] });
      msgs.push({ role: 'tool', tool_call_id: write.id, content: JSON.stringify({ ok: false, error: pr.error }).slice(0, RESULT_CHARS) });
      continue;
    }
    msgs.push({ role: 'assistant', content: r.content || null, tool_calls: calls });
    for (const c of calls) {
      let out;
      if (!READ_TOOLS.has(c?.function?.name) || reads.length >= MAX_READS) {
        out = { ok: false, error: { code: 'NOT_ALLOWED', message: reads.length >= MAX_READS ? 'read_budget_exhausted' : 'unknown_tool' } };
      } else {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { args = {}; }
        out = await runTool(p, c.function.name, args, { quietRead: true });
        reads.push({ tool: c.function.name, ok: !!out.ok });
      }
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, RESULT_CHARS) });
    }
  }
  return { content: last?.content || '', usage, reads };
}

// ─────────────────────────────────────────────
// execute-action — 카드 [실행] → runTool(humanConfirmed). 실행 문은 이것 하나다.
//   반환: { ok:true, data:{ entity_type, entity_id, open_url, result } } | { ok:false, code, http }
// ─────────────────────────────────────────────
const HTTP_OF = { VALIDATION_ERROR: 400, PERMISSION_DENIED: 403, NOT_FOUND: 404, CONFLICT: 409, QUOTA_EXCEEDED: 422, AUTH_REQUIRED: 403, RATE_LIMITED: 429 };

function entityOf(res) {
  const pick = [
    ['task', res.task, (o) => o.task_id], ['event', res.event, (o) => o.event_id], ['document', res.document, (o) => o.post_id],
    ['project', res.project, (o) => o.project_id], ['memo', res.memo, (o) => o.memo_id], ['knowledge', res.knowledge_item, (o) => o.kb_id],
    ['mail_draft', res.draft, (o) => o.thread_id || o.draft_id], ['interaction', res.interaction, (o) => o.client_id || o.interaction_id],
    ['project_note', res.project_note, (o) => o.project_id || o.note_id], ['note', typeof res.note === 'object' ? res.note : null, (o) => o.task_id || o.note_id],
  ];
  for (const [type, o, id] of pick) {
    if (o && typeof o === 'object') return { entity_type: type, entity_id: id(o) || null, open_url: o.url || res.client?.url || res.project?.url || null };
  }
  if (res.moved_event_ids) return { entity_type: 'event', entity_id: res.moved_event_ids[0] || null, open_url: null };
  return { entity_type: null, entity_id: null, open_url: null };
}

async function executeTool(actor, businessId, name, rawParams) {
  const p = await principalOf(actor.userId, businessId, actor.platformRole);
  const { tool, args } = await normalizeCall(businessId, name, rawParams);
  if (!WRITE_TOOLS.has(tool)) return { ok: false, code: 'unknown_tool', http: 400 };
  const r = await runTool(p, tool, args, { humanConfirmed: true });
  if (!r.ok) return { ok: false, code: r.error?.message || r.error?.code || 'failed', http: HTTP_OF[r.error?.code] || 400 };
  const ent = entityOf(r);
  return {
    ok: true,
    data: {
      tool, ...ent,
      replayed: !!r.replayed,
      ...(r.completed_skipped ? { completed_skipped: r.completed_skipped } : {}),
      ...(r.meet_warning ? { meet_warning: r.meet_warning } : {}),
      ...(r.moved_event_ids ? { moved_ids: r.moved_event_ids, failed: r.failed || [] } : {}),
      ...(r.attendees_notified !== undefined ? { notified: r.attendees_notified } : {}),
    },
  };
}

module.exports = {
  TOOL_SCHEMAS,
  WRITE_TOOLS,
  READ_TOOLS,
  ALIASES,
  principalOf,
  buildToolSystemContext,
  buildEventEditContext,
  buildProposedAction,
  converse,
  executeTool,
  // 테스트/디버그
  proposeOne,
  normalizeCall,
  resolveAssigneeName,
  buildCard,
  isAlias,
};
