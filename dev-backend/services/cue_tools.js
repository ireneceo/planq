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
//   - converse         /help 의 읽기 루프(라운드 4 · 읽기 6 · 12초). 쓰기 도구가 나오면 멈추고 **제안만** 만든다(한 답 최대 3장, 서로 독립)
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
// 업무 묶음 상한 — 확정 라우트(/api/tasks/ai-create/confirm)와 같은 값 하나(Fable 2026-10-12 (다))
const { MAX_CONFIRM_CANDIDATES } = require('./aiTaskPlanner');

// ── Cue 가 쓸 수 있는 도구(허용목록) ─────────────────────────
//   쓰기: 업무·일정·문서·프로젝트·메모·상담·Q info·메일 답장 초안. 파일 올리기(upload_file)는 외부 URL 을 받는 문이라 빼둔다.
//   읽기: 찾기·상세 — 루프가 부른다. get_context 는 프롬프트에 이미 같은 값이 들어간다.
const CUE_WRITE = [
  'create_task', 'update_task', 'reschedule_task', 'complete_task', 'assign_task', 'submit_review', 'add_task_note',
  'add_task_reviewers', 'add_task_watchers', 'move_task_to_project',
  'create_event', 'update_event', 'add_meeting_to_event', 'reschedule_events',
  'create_document', 'append_to_document', 'update_document', 'link_documents', 'move_document_to_project',
  'create_project', 'create_memo', 'add_project_note', 'add_client_interaction', 'create_knowledge_item',
  'create_mail_reply_draft', 'create_client_inquiry',
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
    const mailMenu = !lv || lv.role === 'owner' || lv.role === 'admin' || lv.menus?.qmail !== 'none';
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

// ─────────────────────────────────────────────
// 업무 담당자 정하기 (2026-11-27, Irene «큐에게 업무를 요청하면 기본적으로는 요청한 사람에게 … 누구한테 요청 넣어 달라고 하면 그 사람이 담당»)
//   모델이 고른 값만 믿지 않는다 — 사용자가 **한 말**(ctx.lastText = 이번 말 · ctx.userText = 이 대화의 사용자 말 전부)과 맞춘다.
//   ① 지목 없음 → 비움(= 요청한 사람, createTask) · 모델이 말에 없는 사람을 골랐거나 맡기는 말 없이 이름만 나왔으면(«박개발이 보내준 자료») 비움
//   ② 지목 있음(«OO에게 요청·시켜·맡겨», «담당은 OO») → 그 사람(services/memberMention 한 벌 — 호칭·직함·성 뺀 이름·한 글자 오차)
//   ③ 지목했는데 못 찾음/여럿 → 비우고 카드에 «못 찾음/누구인지» 안내(조용히 «나» 로 만들지 않는다)
//   ④ 담당 = 요청한 사람 → 요청 아님(as_request 뺌)
// ─────────────────────────────────────────────
async function settleTaskAssignee(businessId, args, saidName, ctx = {}) {
  const mm = require('./memberMention');
  const notes = []; let unresolved = null;
  const askerId = ctx.askerId ? Number(ctx.askerId) : null;
  const pool = await mm.memberPool(businessId);
  const lastText = String(ctx.lastText || '');
  const allText = String(ctx.userText || lastText);
  const targets = lastText ? mm.resolveTargetsInText(lastText, pool, { askerId }) : [];
  const hitIds = [...new Set(targets.filter((t) => t.userId).map((t) => t.userId))];
  const say = (r) => {
    if (r.status === 'matched' || r.status === 'self') { args.assignee_user_id = r.userId; return true; }
    if (r.status === 'ambiguous') notes.push({ key: 'assignee_ambiguous', names: `${r.said} → ${r.candidates.map((c) => c.name).filter(Boolean).join(', ')}` });
    else unresolved = r.said;
    return false;
  };
  if (args.assignee_user_id != null) args.assignee_user_id = Number(args.assignee_user_id) || undefined;
  // 모델이 이름만 준 경우
  if (saidName && !args.assignee_user_id) say(mm.resolveSaid(saidName, pool, { askerId }));
  const cur = args.assignee_user_id ? pool.find((m) => m.user_id === args.assignee_user_id) : null;
  if (lastText && args.assignee_user_id && args.assignee_user_id !== askerId) {
    const named = hitIds.includes(args.assignee_user_id);
    const mentioned = cur && mm.isMentioned(allText, cur);
    // 말에 없는 사람 · 이름은 나왔지만 맡기는 말이 없음 → 지목이 아니다
    if (!cur || (!named && (!mentioned || !mm.ASSIGN_VERB.test(allText)))) delete args.assignee_user_id;
  }
  // 이번 말에 지목이 하나뿐인데 모델이 비웠다 → 지목한 사람(업무 한 건일 때만 — 여러 건이면 항목마다 다를 수 있다)
  if (!args.assignee_user_id && (ctx.taskCount || 1) === 1) {
    if (hitIds.length === 1) args.assignee_user_id = hitIds[0];
    else if (!hitIds.length && targets.length && !unresolved && !notes.length) say(targets[0]);
  }
  if (args.assignee_user_id === askerId) { delete args.assignee_user_id; delete args.as_request; }
  if (!args.assignee_user_id) {
    delete args.as_request;
    if (unresolved) {
      notes.push({ key: 'assignee_unresolved', names: unresolved });
      const lead = `요청 대상: ${unresolved}`;
      if (!String(args.description || '').includes(lead)) args.description = args.description ? `${lead}\n${args.description}` : lead;
    }
  } else if (args.title) {
    args.title = mm.cleanRequestTitle(args.title);
  }
  return { notes, unresolved };
}

/** 모델·옛 카드가 보낸 인자 → 카탈로그 인자. 별칭·편의 칸(assignee_name)만 바꾼다 — 검증은 레지스트리가 한다.
 *  ctx(선택) — { lastText, userText, askerId, taskCount }: 사용자가 한 말로 업무 담당자를 맞춘다(settleTaskAssignee).
 *  사람이 카드에서 고친 뒤 실행할 때(executeTool)는 넘기지 않는다 — 사람이 고른 값을 덮지 않는다. */
async function normalizeCall(businessId, name, raw = {}, ctx = null) {
  let tool = name; let args = { ...(raw || {}) };
  let notes = []; let assigneeSaid = null;
  if (isAlias(tool)) ({ name: tool, args } = ALIASES[tool](args));
  if (tool === 'create_task') {
    if (args.assignee_id && !args.assignee_user_id) args.assignee_user_id = args.assignee_id;
    delete args.assignee_id;
    const nm = args.assignee_name;
    delete args.assignee_name; delete args.assignee_resolved_name;
    if (ctx) {
      ({ notes, unresolved: assigneeSaid } = await settleTaskAssignee(businessId, args, nm, ctx));
    } else if (nm && !args.assignee_user_id) {
      const r = await resolveAssigneeName(businessId, nm);
      if (r.userId) args.assignee_user_id = r.userId;
    }
  }
  // 2026-10-12 — 화상회의(Meet)를 말했다 = 팀 공개가 필요조건(구글 일정에 회의가 생긴다).
  //   공개 범위를 안 정하면 미리보기가 meet_requires_team_visibility 로 거절하고 모델이 «직접 하세요» 로 답했다.
  //   인자에 넣어 카드에 «공개 범위» 로 보이게 한다 — 실행은 사람이 카드를 확인한 뒤다. 사람이 private 을 말했으면 그대로 둔다.
  if (tool === 'create_event' && args.create_meeting && !args.visibility) args.visibility = 'team';
  for (const k of Object.keys(args)) if (args[k] === null || args[k] === '' || args[k] === undefined) { if (!(tool === 'create_document' && k === 'content')) delete args[k]; }
  return { tool, args, notes, assigneeSaid };
}

// ─────────────────────────────────────────────
// /help 프롬프트 — 오늘/요일/시간대/멤버 로스터(user_id 포함). 날짜 계산·담당자 해석의 바탕.
// ─────────────────────────────────────────────
async function buildToolSystemContext(businessId, todayIso, askerId = null) {
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
  // 직함·전문 분야도 싣는다 — «대표님께», «디자이너한테» 를 사람으로 알아듣게(2026-11-27). 같은 사람이 두 줄이면 한 줄만.
  const seenIds = new Set();
  const roster = bms.filter((m) => m.role !== 'ai' && m.role !== 'client' && m.user_id && !seenIds.has(m.user_id) && seenIds.add(m.user_id)).map((m) => {
    const dn = nameMap.get(m.user_id);
    const job = [m.job_title, m.expertise].filter(Boolean).join(' · ');
    return `- ${dn?.name || dn?.name_localized || m.user?.name || `#${m.user_id}`} (user_id ${m.user_id}${m.role ? `, ${m.role}` : ''}${job ? `, ${job}` : ''})`;
  }).join('\n');
  // 질문자 — 없으면 «담당자는 나» 를 로스터의 다른 사람으로 골랐다(2026-10-12 실측: 김오너가 물었는데 김미정 배정).
  const askerDn = askerId ? nameMap.get(askerId) : null;
  const askerBm = askerId ? bms.find((m) => m.user_id === askerId) : null;   // 로스터와 같은 이름 해석(표시명 → 계정명)
  const askerLine = askerId && ids.includes(askerId)
    ? `[질문자] ${askerDn?.name || askerDn?.name_localized || askerBm?.user?.name || `#${askerId}`} (user_id ${askerId}) — «나·내·저» 는 이 사람이다.\n` : '';
  return `[오늘] ${dateStr} · [시간대] ${tz}\n${askerLine}[멤버] 담당자·참석자로 지정 가능한 워크스페이스 멤버:\n${roster || '- (없음)'}\n`
    + `[도구 사용] 무엇을 고치거나 연결하려면 먼저 찾기 도구(search_*, list_events, get_*)로 대상의 id 를 확인한다. 제목으로 지목한 업무는 담당자와 무관하게 search_tasks 에 assignee:'anyone' 으로 찾는다. `
    + `쓰기 도구는 요청에 쓰기가 여럿이면 각각 부른다(한 답 최대 ${MAX_WRITES}개, 카드마다 사람이 따로 확인해 실행한다) — 카드끼리 같은 것을 두 번 만들지 않는다. `
    + `업무를 여러 개 만들어 달라고 하면 사용자가 말한 항목마다 create_task 를 **하나씩 전부** 부른다(최대 ${MAX_CONFIRM_CANDIDATES}개 — 이 개수는 위 상한에 세지 않는다). 항목을 합치거나 빼거나 쪼개지 말고 순서·문구를 지킨다 — 화면이 한 목록으로 묶어 사람이 고친 뒤 한 번에 추가한다. `
    + `카드는 서로 독립이어야 한다: 새로 만드는 것에 딸린 설정은 그 도구의 칸으로 한 번에 넣는다(업무의 컨펌자 = create_task reviewer_user_ids · 일정의 참석자·화상회의 = create_event attendee_user_ids·create_meeting · 이미 있는 업무 연결 = create_event task_id). `
    + `이번 답에서 새로 만드는 업무에 일정을 연결해야 하면 업무 카드와 일정 카드(task_id 없이)를 **둘 다** 내고, 답에 «업무 카드를 실행한 뒤 '그 업무에 일정 연결해' 라고 말해 주시면 연결할게요» 를 쓴다 — 다음 턴에 앞 대화의 [실행됨] 줄(#번호)로 update_event task_id 카드를 낸다. `
    + `카드를 낼 때도 답을 비우지 않는다 — 한두 문장으로 카드 몇 장에 무엇이 들어 있고 각각 확인해 실행하면 된다는 것을 말한다. `
    + `지우기·보내기·청구는 할 수 없다.\n`
    // 2026-11-27 Irene «큐에게 업무를 요청하면 기본적으로는 요청한 사람에게 … 누구한테 요청 넣어 달라고 하면 그 사람이 담당»
    //   실측: «대표님께 계약서 검토 요청해줘» 에 «메신저는 못 보낸다» 며 복붙 문구만 줬고, «루아에게 …» 는 카드 없이 멤버 목록만 읊었다.
    + `[업무 담당자] 사람을 지목하지 않은 업무는 assignee 를 비운다(= 질문자 본인 업무). 다른 사람 이름이 **언급만** 된 것(«OO가 보내준 자료 정리», «OO에게 받은 파일»)은 지목이 아니다. `
    + `«OO에게/한테/께 ~ 요청·부탁해줘 / 시켜줘 / 맡겨줘», «담당은 OO» 는 그 사람을 담당자로 한 create_task 다 — 메시지·메일을 보내 달라는 뜻이 아니다(«메신저는 못 보낸다» 고 답하지 않는다). `
    + `호칭·직함·성 뺀 이름(«디자님», «박 개발자», «대표님», «팀장님»)도 [멤버] 의 이름·직함으로 맞춰 assignee_user_id 를 넣는다. 확실히 못 맞추면 assignee_name 에 **말한 그대로**(«대표님», «루아») 넣고 create_task 를 부른다 — 서버가 이름·직함으로 다시 맞춘다. 누구인지·요청 방식(담당/컨펌자)을 **되묻지 않는다**. 목록에 없다고 카드를 안 내거나 멤버 목록을 읊지 않는다(사람이 카드에서 고른다). `
    + `«요청·부탁» 을 직접 말했으면 as_request:true. 요청 업무의 제목은 받는 사람이 할 일이다 — 끝에 «요청» 을 붙이지 않는다.\n`
    + `[쓰기 원칙] 사용자가 말한 것만 넣는다 —말하지 않은 고객·담당자·참석자·태그를 붙이지 말고, 본문·메모에 조언·후속 조치·추측을 덧붙이지 않는다. `
    + `꼭 골라야 하는 값은 가장 중립적인 쪽으로(프로젝트 종류는 고객을 말했을 때만 client, 아니면 internal) — 사람이 카드에서 고친다. `
    + `화상회의·구글 미팅 링크를 원하면 create_event 에 create_meeting:true + visibility:'team'(Meet 은 팀 공개 일정만 — 카드에 보인다) 또는 기존 일정이면 add_meeting_to_event. `
    + `«화상회의는 못 붙인다/화면에서 직접 켜라» 고 답하지 않는다 — 카드를 실행하면 만든 링크가 결과 줄에 나온다.\n`
    // 2026-10-12 실측: «회의록 문서 초안 만들어줘» 에 도구 대신 채팅에 마크다운을 써 주고 «복붙해서 새 문서로» 라고 했다.
    //   할 수 있는 일을 «못 한다/직접 하라» 로 답하지 않게 — 요청 동사 → 도구 지도를 준다.
    + `[할 수 있는 일] «만들어/남겨/등록해/추가해/바꿔/옮겨/연결해» 요청은 글로 대신 써 주거나 «직접 하세요» 라고 하지 말고 맞는 쓰기 도구로 카드를 낸다(내용이 필요하면 도구 인자에 넣는다):\n`
    + `업무 만들기 create_task · 업무 수정(제목·설명·태그·분류·예상시간) update_task(설명·결과물은 통째로 바뀐다 — «설명에 추가해줘» 면 get_task 의 기존 설명 끝에 새 내용을 이어 붙인 전체를 보낸다) · 마감 reschedule_task · 담당 assign_task · 완료 complete_task · 검토 요청 submit_review · 컨펌자 add_task_reviewers · 참조(알아야 할 사람 — 승인 의무 없음) add_task_watchers 또는 create_task 의 watcher_user_ids · 업무 메모 add_task_note · 업무 프로젝트 옮기기 move_task_to_project · `
    + `일정 만들기 create_event · 일정 수정 update_event · 여러 일정 옮기기 reschedule_events · 화상회의 추가 add_meeting_to_event · `
    + `문서(회의록·초안·보고서) create_document · 문서에 덧붙이기 append_to_document · 문서 고치기 update_document · 문서 연결 link_documents · 문서 프로젝트 옮기기 move_document_to_project · `
    + `프로젝트 만들기 create_project · 프로젝트 메모 add_project_note · Q note 메모(회의·개인 메모) create_memo · Q info 항목(계정·연락처·가격·규정·체크리스트처럼 다시 꺼내 쓰는 정보) create_knowledge_item · 고객 상담 기록 add_client_interaction · 메일 답장 초안 create_mail_reply_draft(보내지는 않는다).\n`
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
const MEMBER_KEYS = new Set(['assignee_user_id', 'attendee_user_ids', 'reviewer_user_ids', 'watcher_user_ids', 'member_user_ids', 'default_assignee_user_id']);
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
  // as_request — «요청하기» 를 카드에 늘 보인다(2026-11-18 음성 «누구에게 요청해줘»: 모델이 넣었을 때만 칸이 생겨 요청/배정을 사람이 못 바꿨다)
  create_task: ['due_date', 'assignee_user_id', 'as_request', 'reviewer_user_ids', 'watcher_user_ids', 'description'],
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
  if ((preview.reviewers_skipped || []).some((x) => x.reason === 'requester_auto_reviewer')) out.push({ key: 'reviewer_requester_auto' });
  if (Array.isArray(preview.add_reviewers) && preview.add_reviewers.length) out.push({ key: 'reviewers_notified', count: preview.add_reviewers.length });
  if (Array.isArray(preview.add_watchers) && preview.add_watchers.length) out.push({ key: 'watchers_notified', names: preview.add_watchers.map((w) => w.name).slice(0, 10).join(', ') });
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
    // 일정 수정의 업무 연결은 «바뀌는 값» 이다 — 아래 changes(전 → 후, 제목)로 보인다. 대상 칸에 두면 무엇을 고치는지 헷갈린다
    if (tool === 'update_event' && key === 'task_id') continue;
    if (TARGET_KEYS[key] && !(tool.startsWith('create_') && key === 'project_id')) {
      if (args[key] === undefined) continue;
      // 미리보기가 준 제목은 **그 종류의** 대상에만 — 일정 수정 카드의 업무 연결에 일정 제목이 붙던 것을 막는다
      const fromPreview = TARGET_KEYS[key] === 'task' ? preview?.task?.title : TARGET_KEYS[key] === 'event' ? preview?.event?.title : null;
      targets.push({ type: TARGET_KEYS[key], id: args[key], title: fromPreview || await targetTitle(p, TARGET_KEYS[key], args[key]) });
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
async function proposeOne(p, name, rawArgs, ctx = null) {
  const { tool, args, notes, assigneeSaid } = await normalizeCall(p.businessId, name, rawArgs, ctx ? { askerId: p.userId, ...ctx } : null);
  if (!WRITE_TOOLS.has(tool)) return { error: { code: 'NOT_FOUND', message: 'unknown_tool' } };
  const r = await proposeTool(p, tool, args);
  if (!r.ok) return { error: r.error };
  const card = await buildCard(p, tool, r.args, r.preview);
  if (notes && notes.length) card.notes = [...notes, ...(card.notes || [])];
  return { proposal: { tool, params: r.args, card, ...(assigneeSaid ? { assignee_said: assigneeSaid } : {}) } };
}

// ─────────────────────────────────────────────
// 업무 묶음(task_batch) — 2026-10-12 Fable 설계 (다). Irene: «여러 개 업무 추가하면 Q task에 그대로 추가해야 하는데
//   마음대로 줄이거나 팝아웃에서는 하나만 되고». 한 답에 create_task 가 **2개 이상**이면 카드를 N장 세우지 않고
//   Cue 바와 같은 **후보 목록 한 덩이**로 돌려준다(화면 = 기존 AiCandidateCard + [N개 추가] → /api/tasks/ai-create/confirm).
//   - create_task 는 MAX_WRITES(3, D2)에 세지 않는다 — 다른 쓰기는 D2 그대로.
//   - 레지스트리 도구가 아니라 **표현**이다. 행마다 proposeOne(검증·미리보기)을 지난 인자(cue_args)를 싣고,
//     실행은 사람이 고친 행을 executeTool 로 한 건씩(외부 AI 앱의 «대량 = HIGH» 계약 불변).
//   - 상한은 확정 라우트와 같은 값 하나(MAX_CONFIRM_CANDIDATES).
// ─────────────────────────────────────────────

/** create_task 제안 N개 → 후보 목록 한 덩이. 날짜는 워크스페이스 오늘 기준 오프셋(후보 카드가 오프셋으로 그린다). */
async function buildTaskBatch(p, taskProposals) {
  const biz = await Business.findByPk(p.businessId, { attributes: ['timezone'] });
  const { todayInTz } = require('../utils/datetime');
  const base = todayInTz(biz?.timezone || 'Asia/Seoul');
  const dayDiff = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000);
  const roster = await memberOptions(p.businessId);
  const nameOf = new Map(roster.map((o) => [o.value, o.label]));
  const candidates = taskProposals.map((pr, idx) => {
    const a = pr.params || {};
    const due = a.due_date ? dayDiff(a.due_date) : null;
    const start = a.start_date ? dayDiff(a.start_date) : (due != null ? Math.min(0, due) : 0);
    return {
      idx,
      title: a.title,
      description: a.description || '',
      estimated_hours: a.estimated_hours ?? null,
      start_offset_days: start,
      due_offset_days: due,
      duration_days: due != null ? Math.max(1, due - start) : 1,
      priority: a.priority || '',
      assignee_hint: null,
      assignee_user_id: a.assignee_user_id || null,
      assignee_display_name: a.assignee_user_id ? (nameOf.get(a.assignee_user_id) || null) : null,
      // 지목했는데 멤버에서 못 찾은 이름 — 후보 카드가 «못 찾았어요» 를 띄운다(AiCandidateCard)
      assignee_name: a.assignee_user_id ? null : (pr.assignee_said || null),
      depends_on_index: null,
      vague: false,
      selected: true,
      completed: !!a.completed,
      reviewer_count: (a.reviewer_user_ids || []).length,
      // 실행 때 그대로 쓰는 검증된 인자 — 사람이 카드에서 고친 칸(제목·담당·날짜·예상시간·중요도·완료)만 덮어쓴다
      cue_args: a,
    };
  });
  return {
    tool: 'task_batch',
    card: { summary_key: 'qhelper.tool.task_batch', count: candidates.length },
    base_date: base,
    members: roster.map((o) => ({ user_id: o.value, name: o.label })),
    candidates,
  };
}

/** 받아 둔 제안 목록 → 화면에 낼 제안. create_task 가 2개 이상이면 한 덩이(맨 앞), 1개면 보통 카드. */
async function finalizeProposals(p, accepted) {
  const tasks = accepted.filter((x) => x.tool === 'create_task');
  if (tasks.length < 2) return accepted;
  const rest = accepted.filter((x) => x.tool !== 'create_task');
  return [await buildTaskBatch(p, tasks), ...rest];
}

/** /help·음성 — tool_calls 중 첫 쓰기 하나를 제안으로. (음성은 읽기 루프 없이 이것만 쓴다) */
async function buildProposedAction(businessId, toolCalls, userId = null, platformRole = null, userText = null) {
  if (!Array.isArray(toolCalls) || !toolCalls.length || !userId) return null;
  const p = await principalOf(userId, businessId, platformRole);
  const taskCount = toolCalls.filter((tc) => tc?.function?.name === 'create_task').length;
  const ctx = userText ? { lastText: userText, userText, taskCount } : null;
  // 음성도 카드 한 장(D4) — 다만 업무를 여럿 말했으면 그 한 장이 업무 묶음이다(Fable 2026-10-12 (다))
  const tasks = []; let first = null;
  for (const tc of toolCalls) {
    const name = tc?.function?.name;
    if (!WRITE_TOOLS.has(name) && !isAlias(name)) continue;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    const r = await proposeOne(p, name, args, ctx);
    if (!r.proposal) continue;
    if (r.proposal.tool === 'create_task') { if (tasks.length < MAX_CONFIRM_CANDIDATES) tasks.push(r.proposal); }
    else if (!first) first = r.proposal;
    if (first && !tasks.length) return first;
  }
  if (tasks.length >= 2) return buildTaskBatch(p, tasks);
  return tasks[0] || first || null;
}

// ─────────────────────────────────────────────
// 읽기 루프 — 모델이 찾기 도구를 부르면 결과를 돌려주고 다시 묻는다. 상한: 라운드 4 · 읽기 호출 6 · 12초.
//   쓰기 도구가 나오면 그 자리에서 멈추고 그 라운드의 쓰기를 **제안**으로 만든다(실행 X, 최대 3장). 거절분은 이유를 모델에 돌려준다.
// ─────────────────────────────────────────────
const MAX_ROUNDS = 4; const MAX_READS = 6; const MAX_MS = 12000;
const WRITE_ONLY_CHOICE = { type: 'allowed_tools', allowed_tools: { mode: 'auto', tools: [...WRITE_TOOLS].map((name) => ({ type: 'function', function: { name } })) } };
const RESULT_CHARS = 6000;
const TASK_ONLY_CHOICE = { type: 'allowed_tools', allowed_tools: { mode: 'required', tools: [{ type: 'function', function: { name: 'create_task' } }] } };
/** 사용자 말이 «사람에게 업무를 맡겨 달라» 인가 — 지목(memberMention.findTargets) + 맡기는 말, 메일·휴가 결재·질문은 아니다. */
function looksLikeTaskRequest(text) {
  const s = String(text || '');
  if (!s || /메일|답장|회신|휴가|연차|반차|결재|[?？]|어떻게|방법|할\s*수\s*있|되나요|돼요/.test(s)) return false;
  if (!/요청|부탁|시켜|맡겨|달라고|하라고|넘겨/.test(s)) return false;
  return require('./memberMention').findTargets(s).length > 0;
}
// 한 답의 쓰기 카드 상한 — 서로 독립인 카드만(Fable 2026-10-12 D2). 넘친 호출은 모델에 too_many_writes 로 돌려준다.
const MAX_WRITES = 3;

/** 카드 중복 판정 지문 — 도구 + 정규화된 인자(키 정렬). 재시도 라운드가 받아 둔 카드를 다시 내도 한 장만 남긴다. */
function proposalKey(pr) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return `${pr.tool}|${JSON.stringify(sort(pr.params || {}))}`;
}

// onEvent(type, arg) — 흘려 보낼 때만(docs/CUE_STREAMING_DESIGN.md §2): 'delta'(글 조각) · 'reset'(흘린 글 지움) · 'status'('searching').
//   라운드 판정은 그대로이고 신호만 더한다. isCanceled() 가 참이면 다음 라운드를 시작하지 않는다(지금 라운드는 끝까지 받아 토큰을 센다).
async function converse({ p, messages, callLLM, llmOpts = {}, onEvent = null, isCanceled = null }) {
  const started = Date.now();
  const msgs = [...messages];
  // 사용자가 한 말 — 업무 담당자를 모델 추측이 아니라 이 말로 맞춘다(settleTaskAssignee)
  const userTexts = messages.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content);
  const reads = [];
  const accepted = [];            // 이 답에 낼 카드(제안) — 라운드를 건너 모인다
  const seen = new Set();
  // round_ms — 라운드(LLM 왕복)마다 걸린 시간. 로그에만 쓴다(운영에서 «어디가 느린지» 를 재는 유일한 숫자).
  let usage = { input_tokens: 0, cached_tokens: 0, output_tokens: 0, model: null, rounds: 0, round_ms: [] };
  let last = null;
  let nudged = false; let forceTask = false;   // «OO에게 요청해줘» 에 카드 없이 답했을 때 한 번 되돌린다(아래)
  const done = async (content) => {
    const out = accepted.length ? await finalizeProposals(p, accepted) : [];
    return { content: content || '', usage, reads, ...(out.length ? { proposal: out[0], proposals: out } : {}) };
  };
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const overBudget = reads.length >= MAX_READS || Date.now() - started > MAX_MS || round === MAX_ROUNDS;
    // 예산이 끝나면 쓰기 도구만 허용한다 — 더 찾지 말고 지금 아는 것으로 답하거나 제안하게.
    //   ★ 도구 **목록**은 바꾸지 않고 tool_choice(allowed_tools)로 좁힌다 — 목록이 달라지면 그 라운드는 프롬프트 캐시를
    //     전부 놓친다(도구 설명만 ≈8.2천 토큰, 2026-10-12 실측: 목록 유지 시 9,728 적중).
    if (round > 1 && isCanceled?.()) return await done(last?.content);
    const roundStarted = Date.now();
    // 흘리기 — 읽기 도구가 보이면 곧바로 «찾는 중»(앞말은 지운다). 쓰기 도구면 글을 두고 라운드 끝에 판정(Fable 결정 1).
    let streamed = false; let searching = false;
    const toSearching = () => { if (searching) return; searching = true; if (streamed) onEvent('reset'); onEvent('status', 'searching'); };
    const streamOpts = onEvent ? {
      onDelta: (t) => { if (searching) return; streamed = true; onEvent('delta', t); },
      onToolStart: (name) => { if (READ_TOOLS.has(name)) toSearching(); },
    } : {};
    const choice = forceTask ? TASK_ONLY_CHOICE : overBudget ? WRITE_ONLY_CHOICE : null;
    const r = await callLLM({ ...llmOpts, ...streamOpts, messages: msgs, tools: TOOL_SCHEMAS, ...(choice ? { toolChoice: choice } : {}) });
    last = r;
    usage = { input_tokens: usage.input_tokens + (r.input_tokens || 0), cached_tokens: usage.cached_tokens + (r.cached_tokens || 0),
      output_tokens: usage.output_tokens + (r.output_tokens || 0), model: r.model || usage.model, rounds: usage.rounds + 1,
      round_ms: [...usage.round_ms, Date.now() - roundStarted] };
    if (r.fallback) return accepted.length ? await done(r.content) : { fallback: true, usage, reads };
    const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
    if (!calls.length) {
      // «OO에게 ~ 요청해줘» 인데 카드 없이 «메시지는 못 보낸다·누구 말씀인가요» 로 답했다(2026-11-27 dev 실측 «대표님께 계약서 검토 요청해줘»).
      //   한 번만 되돌려 create_task 를 부르게 한다 — 담당자는 settleTaskAssignee 가 사용자 말로 맞춘다. 흘린 글은 지운다.
      if (!nudged && !accepted.length && round < MAX_ROUNDS && looksLikeTaskRequest(userTexts[userTexts.length - 1])) {
        nudged = true; forceTask = true;
        if (onEvent && streamed) onEvent('reset');
        msgs.push({ role: 'assistant', content: r.content || '' });
        msgs.push({ role: 'system', content: '[다시] 사용자의 방금 말은 «그 사람을 담당자로 한 업무를 만들어 달라» 는 뜻이다(메시지·메일 발송이 아니다). 되묻지 말고 create_task 를 지금 부른다 — 담당자를 [멤버] 에서 확실히 못 맞추면 assignee_name 에 사용자가 말한 그대로(«대표님» 등), 요청·부탁이면 as_request:true. 답에는 카드에서 담당자를 확인해 실행하면 된다고 한 문장.' });
        continue;
      }
      return await done(r.content);
    }
    forceTask = false;

    // 쓰기 호출이 있으면 그 라운드의 쓰기를 **전부** 제안으로(실행 X). 같은 라운드의 읽기는 버린다.
    const writes = calls.filter((c) => WRITE_TOOLS.has(c?.function?.name) || isAlias(c?.function?.name));
    if (writes.length) {
      const replies = [];
      let rejected = 0;
      // create_task 는 D2 상한(3)에 세지 않는다 — 2개 이상이면 업무 묶음 한 덩이가 된다(상한 = 확정 라우트와 같은 40)
      const isTask = (w) => w?.function?.name === 'create_task';
      let otherSeen = 0;
      for (const w of writes) {
        const task = isTask(w);
        const nTask = accepted.filter((x) => x.tool === 'create_task').length;
        const nOther = accepted.length - nTask;
        if (task ? nTask >= MAX_CONFIRM_CANDIDATES : (nOther >= MAX_WRITES || otherSeen >= MAX_WRITES)) {
          rejected += 1;
          replies.push({ id: w.id, out: { ok: false, error: task
            ? { code: 'VALIDATION_ERROR', message: 'too_many_tasks', hint: `At most ${MAX_CONFIRM_CANDIDATES} tasks per answer. Tell the user these ${MAX_CONFIRM_CANDIDATES} are ready and to ask for the rest after adding them.` }
            : { code: 'VALIDATION_ERROR', message: 'too_many_writes', hint: `At most ${MAX_WRITES} write cards per answer. Tell the user to ask for the rest after running these.` } } });
          continue;
        }
        if (!task) otherSeen += 1;
        let args = {};
        try { args = JSON.parse(w.function.arguments || '{}'); } catch { args = {}; }
        const pr = await proposeOne(p, w.function.name, args, {
          lastText: userTexts[userTexts.length - 1] || '', userText: userTexts.join('\n'),
          taskCount: writes.filter(isTask).length,
        });
        if (pr.proposal) {
          const key = proposalKey(pr.proposal);
          if (!seen.has(key)) { seen.add(key); accepted.push(pr.proposal); }
          replies.push({ id: w.id, out: { ok: true, proposed: true, note: 'Shown to the user as a confirmation card (not executed yet). Do not call it again.' } });
        } else {
          rejected += 1;
          replies.push({ id: w.id, out: { ok: false, error: pr.error } });
        }
      }
      // 모두 받아들였으면 끝 — 거절이 있으면 이유를 주고 한 번 더(설명하거나 고쳐서 다시 제안). 받아 둔 카드는 남는다.
      if (!rejected) return await done(r.content);
      if (onEvent) { searching = false; toSearching(); }
      msgs.push({ role: 'assistant', content: r.content || null, tool_calls: writes });
      for (const x of replies) msgs.push({ role: 'tool', tool_call_id: x.id, content: JSON.stringify(x.out).slice(0, RESULT_CHARS) });
      continue;
    }
    if (onEvent) toSearching();
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
  return await done(last?.content);
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
    ['file', res.file, (o) => o.file_id],
  ];
  for (const [type, o, id] of pick) {
    if (o && typeof o === 'object') return { entity_type: type, entity_id: id(o) || null, open_url: o.url || res.client?.url || res.project?.url || null };
  }
  if (res.moved_event_ids) return { entity_type: 'event', entity_id: res.moved_event_ids[0] || null, open_url: null };
  return { entity_type: null, entity_id: null, open_url: null };
}

// opts — 옛 호출부 호환(batch). 2026-10-12 턴 과금부터 Cue 카드·업무 묶음 실행은 **언제나** 계량하지 않는다(카드를 낸 /help 턴이 1회 셌다).
//   실행 문·검증·감사는 카드와 묶음이 같은 이 한 곳.
async function executeTool(actor, businessId, name, rawParams, opts = {}) {
  const p = await principalOf(actor.userId, businessId, actor.platformRole);
  // Cue 카드·업무 묶음 실행은 계량하지 않는다 — 카드를 낸 /help 턴이 1회 셌다(2026-10-12 턴 과금, Irene «권고대로»).
  p.meter = false;
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
      // 만든·붙인 화상회의 링크 — Cue 의 글 답은 카드를 누르기 전에 쓰여 링크를 말할 수 없다. 실행 결과 줄이 보여 준다.
      ...((r.meeting_url || r.event?.meeting_url) ? { meeting_url: r.meeting_url || r.event.meeting_url } : {}),
      ...(r.moved_event_ids ? { moved_ids: r.moved_event_ids, failed: r.failed || [] } : {}),
      ...(r.attendees_notified !== undefined ? { notified: r.attendees_notified } : {}),
      // 만들면서 넣은 컨펌자 — 못 넣은 사람이 있으면 결과 줄이 말한다(업무는 이미 만들어졌다 — Fable D1)
      ...(r.reviewers_added ? { reviewers_added: r.reviewers_added.length } : {}),
      ...(r.reviewers_failed ? { reviewers_failed: r.reviewers_failed.length } : {}),
      // 참조 — 같은 모양(2026-11-18 Fable 비차단 1). 만들기 전 판정이 있어 드물지만, 못 넣었으면 결과 줄이 말한다.
      ...(r.watchers_added ? { watchers_added: r.watchers_added.length } : {}),
      ...(r.watchers_failed ? { watchers_failed: r.watchers_failed.length } : {}),
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
  settleTaskAssignee,
  resolveAssigneeName,
  buildCard,
  isAlias,
};
