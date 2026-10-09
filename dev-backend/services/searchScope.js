// 통합 검색의 권한 범위 + 그룹별 조회 — **한 벌** (2026-10-04, AI 에이전트 M3-b · 설계 docs/AI_AGENT_M3_DESIGN.md §1.3·§5).
//
//   사람의 통합 검색(routes/search.js · GlobalSearchModal)과 AI 앱의 search_all(services/agent/tools/search.js)이
//   **같은 함수**를 부른다. 라우트 안에 두고 베끼면 «AI 는 찾는데 화면은 못 찾는다»(또는 그 반대)가 생긴다.
//   기존 여덟 그룹(tasks·posts·records·files·conversations·knowledge·clients·projects)은 routes/search.js 에서
//   **동작 무변경으로 옮겼다**(주석도 그대로). 새 다섯 그룹(mail·events·interactions·project_notes·meeting_notes)은
//   각 자료의 목록 술어를 그대로 쓴다 — 메일 accessibleAccountIds+searchFolderWhere+mailSearchCondition,
//   일정 calendarListWhere, 상담 business_id+client, 프로젝트 메모 «팀 공개 + 내 개인», 회의록 q-note session_read_allowed.
//
//   그룹 함수 모양: (ctx, M, { limit, filters }) → 행 배열(사람 응답 모양 그대로, 각 행에 match).
//     ctx     = buildScopedWheres 결과(+ userId·businessId·platformRole)
//     M       = makeMatcher(q) — 검색어·LIKE 조건·관련도 정렬
//     filters = AI 경로만 쓴다({ projectId, clientId, since, until }). 사람 경로는 넘기지 않는다 → 쿼리가 종전과 같다.
//   ★ 메뉴 Layer·고객(client) 차단은 **부르는 쪽**이 한다(사람: searchGates, AI: search_all 그룹 상태).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Task, Post, File, Conversation, KbDocument, Client, Project,
} = require('../models');
const {
  assertWorkspaceAccess, taskListWhere, fileListWhereByLevel, postListWhereByLevel,
  conversationListWhere,
} = require('../middleware/access_scope');
const { pickMatch } = require('../utils/searchMatch');
const searchGates = require('./searchGates');
// 표 셀·Q info 항목 값 검색 판정(비밀 칸 제외) — utils/searchCells 한 곳.
const { asObj, columnValueSnippet, matchesNonSecretCell } = require('../utils/searchCells');

// 판정 전 후보 행 상한 — 비밀 칸에서만 맞은 행이 자리를 먹어 정상 결과를 밀어내지 않을 만큼.
const CELL_CANDIDATE_ROWS = 500;

// ─────────────────────────────────────────────────────────────
// 권한 스코프 + 도메인별 where — `/`(검색) 과 `/recent`(검색 전 최근 항목)가 **같은 규칙**을 쓴다.
//   두 곳에 따로 적으면 "검색으로는 안 나오는데 최근 목록엔 보이는" 격리 사고가 난다.
// ─────────────────────────────────────────────────────────────
// ★ deny 센티널 방어 — `taskListWhere`/`conversationListWhere` 는 **접근 불가일 때 null 을 돌려준다.**
//   그 null 을 그대로 `findAll({ where: null })` 로 넘기면 Sequelize 는 "조건 없음" 으로 읽어
//   **전 워크스페이스 전 행**을 내준다. 거부가 전체 공개로 뒤집히는 것이다.
//   (2026-08-20 Fable 검증에서 실제 cross-tenant 누출로 확인됐다 — 신규 /recent 뿐 아니라
//    **기존 / 검색도 같은 구멍이었다.** 아래 게이트로 1차 차단하고, 이 함수로 2차 차단한다.)
// #366 — 검색·최근 목록에서 **끝난 업무는 아래로**.
//   완료/취소가 최신 수정 시각을 이유로 위를 차지하면, 지금 해야 할 업무가 limit 밖으로 밀린다.
//   (숨기지는 않는다 — 사용자 요청은 "아래로 내리던가" 였다.)
const TASK_ORDER = [
  [sequelize.literal("CASE WHEN `Task`.`status` IN ('completed','canceled') THEN 1 ELSE 0 END"), 'ASC'],
  ['updated_at', 'DESC'],
];

function deny(where) {
  return where || { id: { [Op.in]: [-1] } };
}

async function buildScopedWheres(userId, businessId, platformRole) {
  // ★ getUserScope 는 **완전 외부인에게도 truthy** 를 준다(모든 플래그 false 인 scope).
  //   그래서 `if (!scope)` 가드는 영원히 발화하지 않는다. 접근권 판정은 assertWorkspaceAccess 가 한다.
  const scope = await assertWorkspaceAccess(userId, businessId, platformRole);
  if (!scope) return null;
  // ★ `scope.role` 은 **존재하지 않는 필드**였다 — getUserScope 가 채우는 것은 `isClient`/`businessRole` 이다.
  //   그래서 이 값이 **영원히 false** 였고, 아래 4개 분기(KB·고객목록·프로젝트·KB 값검색)가 전부
  //   member 쪽으로 떨어졌다. 실측(2026-09-02 보안감사): 고객 계정으로 검색하면
  //   그 워크스페이스의 **지식베이스 전체·다른 고객 명단·참여하지 않은 프로젝트**가 나왔다.
  //   같은 계정의 목록 라우트(`/kb/documents`)는 정상적으로 403 이다 — 검색만 새고 있었다.
  const isClient = !!scope.isClient;
  return {
    userId, businessId, platformRole,
    scope, isClient,
    taskWhere: deny(await taskListWhere(userId, businessId, scope)),
    fileWhere: deny(fileListWhereByLevel(scope)),
    postWhere: deny(postListWhereByLevel(scope)),
    convWhere: deny(await conversationListWhere(userId, businessId, scope)),
  };
}

// 사용자 입력의 LIKE 와일드카드(% _ \)는 리터럴로 — "%" 하나로 전건이 매칭되던 것 차단.
//   (Q Mail 검색은 이미 이 방어가 있었는데 통합검색에는 없었다.)
const escLike = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);

/** 검색어 → LIKE 조건·관련도 정렬. 검색어는 부르는 쪽이 NFC + trim 한 값을 준다(#364). */
function makeMatcher(q) {
  const qEsc = escLike(q);
  // 띄어쓰기 무시 매칭 — "워드 프레스" ↔ "워드프레스" 를 서로 찾게 한다(운영 요청).
  const qSquashed = escLike(q.replace(/\s+/g, ''));
  const like = { [Op.like]: `%${qEsc}%` };

  // 한 컬럼에 대해 [일반 LIKE, 공백제거 LIKE] 두 조건을 만든다.
  //   ★ 공백 없는 검색어일 때도 반드시 넣는다 — 그게 정작 필요한 경우다
  //     ("먼미래" 로 "먼 미래" 를 찾는 방향). 예전에 qSquashed !== qEsc 로 걸었다가
  //     이 방향이 통째로 죽어 양성 대조군에서 0건이 나왔다.
  const likeAny = (col) => {
    const conds = [{ [col]: { [Op.like]: `%${qEsc}%` } }];
    if (qSquashed) {
      conds.push(sequelize.literal(`REPLACE(\`${col}\`, ' ', '') LIKE ${sequelize.escape(`%${qSquashed}%`)}`));
    }
    return conds;
  };
  // 관련도 — 제목(이름)에 키워드가 있으면 위로. 같은 등급이면 기존 정렬(최신순) 유지.
  //   운영 요청: "제목이나 보내는 사람 등 키워드에 있는 게 우선시되고 제대로 나와야지".
  const relevance = (col) => sequelize.literal(`(CASE
      WHEN \`${col}\` LIKE ${sequelize.escape(`%${qEsc}%`)} THEN 2
      WHEN REPLACE(\`${col}\`, ' ', '') LIKE ${sequelize.escape(`%${qSquashed}%`)} THEN 1
      ELSE 0 END) DESC`);
  return { q, qEsc, qSquashed, like, likeAny, relevance };
}

const toPlain = (m) => (m && typeof m.toJSON === 'function') ? m.toJSON() : m;

// ── AI 경로 필터(사람 경로는 넘기지 않는다) ──────────────────────────
function dateRange(col, f) {
  const out = [];
  if (f && f.since) out.push({ [col]: { [Op.gte]: f.since } });
  if (f && f.until) out.push({ [col]: { [Op.lte]: f.until } });
  return out;
}

/** 이 고객에 연결된 프로젝트 id(project_clients — PlanQ 가 건 연결만). */
async function projectIdsOfClient(businessId, clientId) {
  const { ProjectClient } = require('../models');
  const rows = await ProjectClient.findAll({
    where: { client_id: clientId },
    include: [{ model: Project, attributes: ['id'], where: { business_id: businessId }, required: true }],
    attributes: ['project_id'],
  });
  return rows.map((r) => r.project_id);
}

// ═════════════════════════════════════════════════════════════
// 기존 그룹 (routes/search.js 에서 동작 무변경으로 옮김)
// ═════════════════════════════════════════════════════════════

async function searchTasks(ctx, M, { limit, filters } = {}) {
  const extra = [];
  if (filters) {
    if (filters.projectId) extra.push({ project_id: filters.projectId });
    if (filters.clientId) extra.push({ client_id: filters.clientId });
    extra.push(...dateRange('updated_at', filters));
  }
  const tasks = await Task.findAll({
    where: { ...ctx.taskWhere, [Op.and]: [{ [Op.or]: [...M.likeAny('title'), { description: M.like }] }, ...extra] },
    // description 은 **스니펫 계산에만** 쓰고 응답 전에 뺀다(아래 match 후처리).
    attributes: ['id', 'title', 'status', 'project_id', 'description'],
    limit, order: [M.relevance('title'), ...TASK_ORDER],
  }).catch(() => []);
  return tasks;
}

/** 업무 행 → 응답 모양(match 후처리). 메뉴 게이트 뒤에 부른다(사람 경로는 게이트가 배열을 비운다). */
function shapeTasks(tasks, q) {
  return tasks.map((m) => {
    const { description, ...rest } = toPlain(m);
    rest.match = pickMatch([
      { field: 'title', text: rest.title, shown: true },
      { field: 'description', text: description },
    ], q);
    return rest;
  });
}

// Post: 기본 (title/content/category) + table kind 면 q_record_rows.values 도 매치
async function searchPosts(ctx, M, { limit, filters } = {}) {
  const { postWhere, businessId } = ctx;
  const { q, qEsc, qSquashed, like } = M;
  const extra = [];
  if (filters) {
    if (filters.projectId) extra.push({ project_id: filters.projectId });
    // 문서에는 고객 칸이 없다 — 고객에 연결된 프로젝트(project_clients)의 문서만(PlanQ 가 건 연결)
    if (filters.clientId) {
      const pids = await projectIdsOfClient(businessId, filters.clientId);
      extra.push({ project_id: { [Op.in]: pids.length ? pids : [-1] } });
    }
    extra.push(...dateRange('updated_at', filters));
  }
  // 1) 기본 매치
  const basicMatches = await Post.findAll({
    where: { ...postWhere, [Op.and]: [{ [Op.or]: [...M.likeAny('title'), { content_text: like }, { category: like }] }, ...extra] },
    // content_text 는 스니펫 계산에만 — 응답 전에 뺀다
    attributes: ['id', 'title', 'category', 'project_id', 'kind', 'content_text'],
    limit, order: [M.relevance('title'), ['updated_at', 'DESC']],
  }).catch(() => []);
  // 2) 표 셀 검색 — kind='table' 인 post 의 연결 q_record_rows.values
  //   ★ 2026-09-11: 옛 코드는 SQL 후보(values JSON 통째 LIKE)를 **그대로 결과로** 썼다.
  //     그래서 **비밀 칸 값으로 검색해도 그 표가 떴다** — 값은 안 보여도 "이 값을 가진 표가 있다" 가 샌다
  //     (Q info 항목 검색 #334 와 같은 구멍). 칸 id(JSON 키 "c1a2…")로도 걸렸다.
  //     후보는 칸 정의(q_records.columns)와 같이 읽고 matchesNonSecretCell 로 판정한다.
  //     정의가 없는 표는 어느 칸이 비밀인지 모르므로 INNER JOIN 으로 뺀다(fail-closed).
  const tableSql =
    'SELECT p.id AS post_id, qr.columns AS cols, r.`values` AS vals ' +
    'FROM posts p ' +
    'JOIN q_records qr ON qr.id = p.q_record_id AND qr.business_id = :bid ' +
    'JOIN q_record_rows r ON r.q_record_id = p.q_record_id ' +
    // paranoid 는 raw SQL 에 안 걸린다 — 지운 문서가 검색에 뜨지 않게 손으로 건다
    'WHERE p.business_id = :bid AND p.deleted_at IS NULL AND p.kind = \'table\' ' +
    'AND (LOWER(CAST(r.`values` AS CHAR)) LIKE LOWER(:like) ' +
    "OR REPLACE(LOWER(CAST(r.`values` AS CHAR)), ' ', '') LIKE LOWER(:likeSq)) " +
    `ORDER BY p.updated_at DESC, p.id, r.position LIMIT ${CELL_CANDIDATE_ROWS}`;
  const tableRows = await sequelize.query(tableSql,
    { replacements: { bid: businessId, like: `%${qEsc}%`, likeSq: `%${qSquashed}%` }, type: sequelize.QueryTypes.SELECT },
  ).catch((err) => { console.error('[search] table cell match err:', err.message); return []; });
  // 판정 통과한 표만, 처음 맞은 순서(최신 수정순)대로. 스니펫도 같은 행에서(비밀 칸 제외 — columnValueSnippet).
  const cellSnippetByPost = new Map();
  const tableMatches = [];
  for (const row of tableRows) {
    const cols = asObj(row.cols);
    const vals = asObj(row.vals);
    if (!matchesNonSecretCell(cols, vals, q)) continue;
    if (!cellSnippetByPost.has(row.post_id)) { tableMatches.push({ id: row.post_id }); cellSnippetByPost.set(row.post_id, null); }
    if (!cellSnippetByPost.get(row.post_id)) cellSnippetByPost.set(row.post_id, columnValueSnippet(cols, vals, q));
  }
  // ★ raw SQL 은 `business_id` 만 걸고 **가시등급(postWhere)을 안 본다.**
  //   실측(2026-09-02 보안감사): 이 분기로 고객·평멤버에게 **L3 워크스페이스 전용 문서**와
  //   **참여하지 않은 프로젝트의 표**가 나왔다(셀 값 "아마존 계정" 등).
  //   raw 결과는 후보일 뿐이다 — 같은 술어(postWhere)로 **다시 걸러** 통과한 것만 쓴다.
  const tableIds = tableMatches.map((m) => m.id).filter((id) => !basicMatches.some((b) => b.id === id));
  let allowedTable = [];
  if (tableIds.length > 0) {
    allowedTable = await Post.findAll({
      // business_id 를 명시한다 — postWhere 에 이미 들어 있지만, **이 쿼리만 보고도**
      //   워크스페이스 경계가 보여야 한다(가드도 사람도 그 표시로 읽는다).
      where: { ...postWhere, business_id: businessId, [Op.and]: [{ id: { [Op.in]: tableIds } }, ...extra] },
      attributes: ['id', 'title', 'category', 'project_id', 'kind'],
      order: [['updated_at', 'DESC']],
    }).catch(() => []);
  }
  // 합치기 (id 기준 dedup)
  const seen = new Set(basicMatches.map((m) => m.id));
  const merged = [...basicMatches.map((m) => (m.toJSON ? m.toJSON() : m))];
  for (const m of allowedTable) if (!seen.has(m.id)) { merged.push(m.toJSON ? m.toJSON() : m); seen.add(m.id); }
  const out = merged.slice(0, limit);

  // 3) match — 제목·분류는 행에 보인다. 본문은 스니펫. 표 셀은 **권한 필터를 통과한 문서만**,
  //    그 문서의 셀에서 비밀이 아닌 첫 매칭 값을 스니펫으로.
  for (const p of out) {
    p.match = pickMatch([
      { field: 'title', text: p.title, shown: true },
      { field: 'category', text: p.category, shown: true },
      { field: 'content', text: p.content_text },
    ], q);
    delete p.content_text;
  }
  for (const p of out) {
    if (p.match || p.kind !== 'table' || !cellSnippetByPost.has(p.id)) continue;
    p.match = { field: 'table', snippet: cellSnippetByPost.get(p.id) };
  }
  const needTable = out.filter((p) => !p.match && p.kind === 'table').map((p) => p.id);
  if (needTable.length > 0) {
    const cellRows = await sequelize.query(
      'SELECT p.id AS post_id, qr.columns AS cols, r.`values` AS vals ' +
      'FROM posts p ' +
      'JOIN q_records qr ON qr.id = p.q_record_id AND qr.business_id = :bid ' +
      'JOIN q_record_rows r ON r.q_record_id = p.q_record_id ' +
      'WHERE p.business_id = :bid AND p.deleted_at IS NULL AND p.id IN (:ids) ' +
      'AND LOWER(CAST(r.`values` AS CHAR)) LIKE LOWER(:like) ' +
      'ORDER BY p.id, r.position LIMIT 200',
      { replacements: { bid: businessId, ids: needTable, like: `%${qEsc}%` }, type: sequelize.QueryTypes.SELECT },
    ).catch((err) => { console.error('[search] table snippet err:', err.message); return []; });
    const snipByPost = new Map();
    for (const row of cellRows) {
      if (snipByPost.get(row.post_id)) continue;
      const sn = columnValueSnippet(asObj(row.cols), asObj(row.vals), q);
      if (sn) snipByPost.set(row.post_id, sn);
    }
    for (const p of out) {
      if (p.match || p.kind !== 'table') continue;
      // 비밀 칸에서만 맞았으면 스니펫 없이 "표 셀" 만 — 값을 내보내지 않는다.
      p.match = { field: 'table', snippet: snipByPost.get(p.id) || null };
    }
  }
  // 4) 둘째 줄(작성자 · 작성일 · 프로젝트) — 제목이 같은 문서를 가를 수 있게(2026-10-07, Irene 승인).
  //    위 매치·정렬은 건드리지 않고 **이미 걸러진 id** 만 한 번 더 읽는다(권한 판정은 위 postWhere 그대로).
  //    표시명은 문서 목록과 같은 함수(applyMemberDisplayName) — 같은 사람이 화면마다 다른 이름이면 안 된다.
  if (out.length) {
    const { User } = require('../models');
    const meta = await Post.findAll({
      where: { business_id: businessId, id: { [Op.in]: out.map((p) => p.id) } },
      attributes: ['id', 'created_at'],
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
      ],
    }).catch(() => []);
    const rows = meta.map((m) => m.toJSON());
    await require('./displayName').applyMemberDisplayName(rows, businessId, ['author']).catch(() => {});
    const byId = new Map(rows.map((m) => [m.id, m]));
    for (const p of out) {
      const m = byId.get(p.id);
      if (!m) continue;
      p.created_at = m.created_at;
      p.author = m.author ? { id: m.author.id, name: m.author.name, name_localized: m.author.name_localized || null } : null;
      p.project = m.Project ? { id: m.Project.id, name: m.Project.name } : null;
    }
  }
  return out;
}

async function searchFiles(ctx, M, { limit, filters } = {}) {
  const extra = [];
  if (filters) {
    if (filters.projectId) extra.push({ project_id: filters.projectId });
    if (filters.clientId) extra.push({ client_id: filters.clientId });
    extra.push(...dateRange('created_at', filters));
  }
  const files = await File.findAll({
    // 이름·설명·태그 — Q file 화면 검색과 같은 범위(2026-10-07: 통합 검색만 이름으로 찾아 «파일 화면에선 찾히는데» 가 됐다)
    where: { ...ctx.fileWhere, [Op.and]: [{ [Op.or]: [...M.likeAny('file_name'), { description: M.like }, sequelize.where(sequelize.cast(sequelize.col('tags'), 'CHAR'), M.like)] }, { deleted_at: null }, ...extra] },
    attributes: ['id', 'file_name', 'file_size', 'mime_type', 'description', 'tags'],
    limit, order: [M.relevance('file_name'), ['created_at', 'DESC']],
  }).catch(() => []);
  return files.map((m) => {
    const { description, tags, ...o } = toPlain(m);
    o.match = pickMatch([
      { field: 'file_name', text: o.file_name, shown: true },
      { field: 'description', text: description },
      { field: 'tag', text: Array.isArray(tags) ? tags.join(' ') : (tags || '') },
    ], M.q);
    return o;
  });
}

async function searchConversations(ctx, M, { limit } = {}) {
  const conversations = await Conversation.findAll({
    // ★ 권한 조건도 Op.and 를 쓴다(사적 대화방 — 2026-10-09 D3) — 펼친 뒤 [Op.and] 를 새로 주면 **덮어써서** 권한이 사라진다. 합친다.
    where: { ...ctx.convWhere, [Op.and]: [...(ctx.convWhere[Op.and] || []), { [Op.or]: [...M.likeAny('title'), ...M.likeAny('display_name')] }] },
    attributes: ['id', 'title', 'display_name', 'project_id'],
    limit, order: [M.relevance('title'), ['last_message_at', 'DESC']],
  }).catch(() => []);
  return conversations.map((m) => {
    const o = toPlain(m);
    // 목록은 display_name || title 을 그린다 — 안 그려진 쪽에서 맞았으면 그 이름을 스니펫으로.
    const shownName = o.display_name || o.title;
    o.match = pickMatch([
      { field: 'title', text: shownName, shown: true },
      { field: 'title', text: o.display_name ? o.title : null },
    ], M.q);
    return o;
  });
}

// KB — client 는 차단 (memory project_client_permission_matrix)
//   멤버는 볼 수 있는 문서만(목록·상세와 같은 술어 — 2026-09-27 전에는 워크스페이스 전체였다).
function kbWhereOf(ctx) {
  return ctx.isClient ? { id: -1 } : require('../middleware/access_scope').kbDocumentsListWhereByLevel(ctx.scope);
}

// KbDocument (Q info) — title/body + custom_values JSON 매치
async function searchKnowledge(ctx, M, { limit, filters } = {}) {
  const { businessId, isClient } = ctx;
  const { q, qEsc, qSquashed, like } = M;
  const kbWhere = kbWhereOf(ctx);
  const extra = [];
  if (filters) {
    if (filters.projectId) extra.push({ project_id: filters.projectId });
    if (filters.clientId) extra.push({ client_id: filters.clientId });
    extra.push(...dateRange('updated_at', filters));
  }
  const baseHits = await KbDocument.findAll({
    // business_id 명시 — kbWhere 에 이미 있지만 이 쿼리만 봐도 경계가 보여야 한다
    where: { ...kbWhere, business_id: businessId, [Op.and]: [{ [Op.or]: [...M.likeAny('title'), { body: like }] }, ...extra] },
    // body 는 스니펫 계산에만 — 응답 전에 뺀다
    attributes: ['id', 'title', 'category', 'scope', 'body'],
    limit, order: [M.relevance('title'), ['updated_at', 'DESC']],
  }).catch(() => []);
  const withMatch = (m) => {
    const o = m.toJSON ? m.toJSON() : { ...m };
    o.match = pickMatch([
      { field: 'title', text: o.title, shown: true },
      { field: 'body', text: o.body },
    ], q);
    delete o.body;
    return o;
  };
  if (isClient) return baseHits.map(withMatch);
  // #334 — 항목 값 검색. custom_values JSON 을 통째로 CAST 해 LIKE 하면
  //   **비밀번호·API 키 문자열로 검색해도 그 정보가 결과에 뜬다.**
  //   SQL 로 후보만 좁히고, 어떤 항목에서 맞았는지는 여기서 판정한다 —
  //   secret 타입 항목에서만 맞은 문서는 **결과에서 뺀다**(값을 아는 사람에게만 뜨는 것도 노출이다).
  const rawValHits = await sequelize.query(
    'SELECT id, title, category, scope, custom_columns, custom_values FROM kb_documents ' +
    // paranoid 는 raw SQL 에 안 걸린다 — 지운 정보가 검색에 뜨지 않게 손으로 건다
    'WHERE business_id = :bid AND deleted_at IS NULL ' +
    'AND custom_values IS NOT NULL AND (LOWER(CAST(custom_values AS CHAR)) LIKE LOWER(:like) ' +
    "OR REPLACE(LOWER(CAST(custom_values AS CHAR)), ' ', '') LIKE LOWER(:likeSq)) " +
    `ORDER BY updated_at DESC LIMIT ${CELL_CANDIDATE_ROWS}`,
    { replacements: { bid: businessId, like: `%${qEsc}%`, likeSq: `%${qSquashed}%` }, type: sequelize.QueryTypes.SELECT },
  ).catch((err) => { console.error('[search] kb val err:', err.message); return []; });

  // raw SQL 은 권한 술어를 모른다 — 같은 kbWhere 로 다시 거른다(services/searchGates).
  //   AI 경로 필터(프로젝트·고객·기간)도 같은 재필터에 싣는다.
  const allowedIds = extra.length
    ? await searchGates.allowedKbIds(rawValHits, { ...kbWhere, [Op.and]: extra }, businessId)
    : await searchGates.allowedKbIds(rawValHits, kbWhere, businessId);
  // 비밀 아닌 항목 중 하나라도 맞으면 통과. 전부 secret 에서만 맞았으면 제외 — 표 셀과 같은 판정 한 곳.
  const valHits = rawValHits.filter((row) => allowedIds.has(row.id)).filter((row) => (
    matchesNonSecretCell(asObj(row.custom_columns), asObj(row.custom_values), q)
  )).map(({ custom_columns: cc, custom_values: cv, ...rest }) => ({
    ...rest,
    // 스니펫도 **비밀이 아닌 칸에서만** — 위 필터와 같은 기준(columnValueSnippet 이 secret 을 건너뛴다)
    match: { field: 'value', snippet: columnValueSnippet(asObj(cc), asObj(cv), q) },
  }));
  const seen = new Set(baseHits.map((m) => m.id));
  const merged = baseHits.map(withMatch);
  for (const m of valHits) if (!seen.has(m.id)) { merged.push(m); seen.add(m.id); }
  return merged.slice(0, limit);
}

async function searchClients(ctx, M, { limit, filters } = {}) {
  const { businessId, isClient, scope } = ctx;
  // Client 목록 — client 자신은 본인만, member/owner 는 워크스페이스 전체
  //   ★ 필드명 주의 — `clientId`(단수)도 존재하지 않는다. getUserScope 는 `clientIds` 배열을 준다.
  const clientWhere = isClient
    ? { business_id: businessId, id: { [Op.in]: scope.clientIds.length ? scope.clientIds : [-1] } }
    : { business_id: businessId };
  const extra = [];
  if (filters) {
    if (filters.clientId) extra.push({ id: filters.clientId });
    if (filters.projectId) {
      const { ProjectClient } = require('../models');
      const ids = (await ProjectClient.findAll({ where: { project_id: filters.projectId }, attributes: ['client_id'] })).map((r) => r.client_id);
      extra.push({ id: { [Op.in]: ids.length ? ids : [-1] } });
    }
  }
  const clients = await Client.findAll({
    // 멀티테넌트 — clientWhere 는 위에서 구성되지만 호출 지점에도 명시한다
    //   (검색 블록이 길어지며 조건이 눈에서 멀어졌다. 중복이지만 실제 제약이라 안전하다).
    // ★ `email` 컬럼은 clients 에 없다(invite_email / billing_contact_email 이다).
    //   없는 컬럼을 where·attributes 에 쓰면 쿼리가 통째로 throw 하는데, 아래 .catch(()=>[]) 가
    //   그걸 삼켜 **고객 검색이 늘 "결과 없음"** 이었다. 조용한 죽음 — 화면에도 로그에도 안 남는다.
    //   (2026-08-21 발견. 실측: Unknown column 'Client.email' in 'where clause')
    where: { ...clientWhere, business_id: businessId, [Op.and]: [{ [Op.or]: [
      ...M.likeAny('display_name'), ...M.likeAny('company_name'),
      { invite_email: M.like }, { billing_contact_email: M.like },
    ] }, ...extra] },
    // status·sales_stage 는 결과 행의 배지 — 검색에서 바로 "어떤 고객인지" 가 보인다(Q sale §12-7)
    attributes: ['id', 'display_name', 'company_name', 'invite_email', 'billing_contact_email', 'status', 'sales_stage'],
    limit, order: [M.relevance('display_name'), ['updated_at', 'DESC']],
  }).catch(() => []);
  return clients;
}

function shapeClients(clients, q) {
  return clients.map((m) => {
    const o = toPlain(m);
    const shownName = o.display_name || o.company_name;
    o.match = pickMatch([
      { field: 'name', text: shownName, shown: true },
      { field: 'company', text: o.display_name ? o.company_name : null },
      // 이메일은 목록의 보조줄에 **맞은 주소**를 그린다 — snippet 에 그 주소 전체를 싣는다.
      { field: 'email', text: o.invite_email },
      { field: 'email', text: o.billing_contact_email },
    ], q);
    return o;
  });
}

async function searchProjects(ctx, M, { limit, filters } = {}) {
  const { businessId, isClient, scope } = ctx;
  // Project — client 는 자기 프로젝트만
  //   ★ `allowedProjectIds` 도 없는 필드다 — 고객이 닿는 프로젝트는 `projectClientProjectIds`.
  const projectWhere = isClient
    ? { business_id: businessId, id: { [Op.in]: scope.projectClientProjectIds.length ? scope.projectClientProjectIds : [-1] } }
    : { business_id: businessId };
  const extra = [];
  if (filters) {
    if (filters.projectId) extra.push({ id: filters.projectId });
    if (filters.clientId) {
      const pids = await projectIdsOfClient(businessId, filters.clientId);
      extra.push({ id: { [Op.in]: pids.length ? pids : [-1] } });
    }
  }
  const projects = await Project.findAll({
    where: { ...projectWhere, [Op.and]: [{ [Op.or]: M.likeAny('name') }, ...extra] },
    attributes: ['id', 'name', 'status'],
    limit, order: [M.relevance('name'), ['updated_at', 'DESC']],
  }).catch(() => []);
  return projects.map((m) => {
    const o = toPlain(m);
    o.match = pickMatch([{ field: 'name', text: o.name, shown: true }], M.q);
    return o;
  });
}

// ═════════════════════════════════════════════════════════════
// 새 그룹 (M3-b 확정 §12-⑤) — 사람 검색과 AI search_all 이 같이 부른다.
//   ★ 고객(client)에게는 부르지 않는다(부르는 쪽이 막는다). 아래 함수들은 멤버 이상을 전제로 짠다.
// ═════════════════════════════════════════════════════════════

/** 메일 — 접근 가능 계정(공용 + 내 개인) ∩ 스팸 제외 전 폴더 + 사람 메일 검색과 같은 조건. */
async function searchMail(ctx, M, { limit, filters } = {}) {
  const { EmailThread } = require('../models');
  const { accessibleAccountIds } = require('./mailIdentity');
  const { searchFolderWhere } = require('./mailFolders');
  const { mailSearchCondition } = require('./mailSearchWhere');
  const acctIds = await accessibleAccountIds(ctx.businessId, ctx.userId);
  if (!acctIds.length) return [];
  const search = mailSearchCondition(M.q, ctx.businessId);
  if (!search) return [];
  const conds = [
    { business_id: ctx.businessId },
    { account_id: { [Op.in]: acctIds } },
    searchFolderWhere('all', ctx.userId, ctx.businessId),
    search.cond,
  ];
  if (filters) {
    if (filters.clientId) conds.push({ client_id: filters.clientId });
    if (filters.projectId) conds.push({ project_id: filters.projectId });
    conds.push(...dateRange('last_message_at', filters));
  }
  const rows = await EmailThread.findAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'subject', 'last_message_at', 'last_message_preview', 'client_id', 'project_id', 'account_id', 'labels'],
    order: [search.relevanceOrder, ['last_message_at', 'DESC'], ['id', 'DESC']],
    limit,
  }).catch((e) => { console.error('[search] mail err:', e.message); return []; });
  const out = rows.map((r) => ({
    id: r.id, subject: r.subject || null, last_message_at: r.last_message_at,
    client_id: r.client_id || null, project_id: r.project_id || null, account_id: r.account_id,
    _preview: r.last_message_preview, _labels: Array.isArray(r.labels) ? r.labels : [],
  }));
  if (out.length) {
    // «왜 걸렸나» — 메일 목록과 같은 판정(mailSearchMatch)
    const { attachMailMatches } = require('./mailSearchMatch');
    const probe = out.map((o) => ({ id: o.id, subject: o.subject, last_message_preview: o._preview, labels: o._labels }));
    await attachMailMatches(probe, { query: M.q, businessId: ctx.businessId }).catch(() => {});
    probe.forEach((p, i) => { out[i].match = p.match || null; });
  }
  for (const o of out) { delete o._preview; delete o._labels; }
  return out;
}

/** 일정 — 캘린더 목록과 같은 술어(calendarListWhere). 반복 일정은 한 번(펼치지 않는다). */
async function searchEvents(ctx, M, { limit, filters } = {}) {
  const { CalendarEvent, CalendarEventAttendee } = require('../models');
  const { calendarListWhere } = require('../middleware/access_scope');
  const cbase = await calendarListWhere(ctx.userId, ctx.businessId, ctx.scope);
  if (!cbase) return [];
  const conds = [cbase, { business_id: ctx.businessId }, { [Op.or]: [...M.likeAny('title'), { description: M.like }, { location: M.like }] }];
  if (filters) {
    if (filters.projectId) conds.push({ project_id: filters.projectId });
    if (filters.clientId) {
      const att = await CalendarEventAttendee.findAll({ where: { client_id: filters.clientId }, attributes: ['event_id'] });
      const ids = [...new Set(att.map((x) => x.event_id))];
      conds.push({ id: { [Op.in]: ids.length ? ids : [-1] } });
    }
    conds.push(...dateRange('start_at', filters));
  }
  const rows = await CalendarEvent.findAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'title', 'description', 'location', 'start_at', 'end_at', 'all_day', 'project_id'],
    order: [M.relevance('title'), ['start_at', 'DESC'], ['id', 'DESC']],
    limit,
  }).catch((e) => { console.error('[search] events err:', e.message); return []; });
  return rows.map((r) => {
    const { description, location, ...rest } = toPlain(r);
    rest.match = pickMatch([
      { field: 'title', text: rest.title, shown: true },
      { field: 'description', text: description },
      { field: 'location', text: location },
    ], M.q);
    return rest;
  });
}

/** 상담 기록 — 이 워크스페이스 고객의 응대 기록(삭제 제외). 메뉴 qsale 은 부르는 쪽이 본다. */
async function searchInteractions(ctx, M, { limit, filters } = {}) {
  const { ClientInteraction } = require('../models');
  const conds = [
    { business_id: ctx.businessId }, { deleted_at: null },
    { [Op.or]: [...M.likeAny('title'), { body: M.like }, { summary: M.like }] },
  ];
  if (filters) {
    if (filters.clientId) conds.push({ client_id: filters.clientId });
    if (filters.projectId) conds.push({ project_id: filters.projectId });
    conds.push(...dateRange('occurred_at', filters));
  }
  const rows = await ClientInteraction.findAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'client_id', 'project_id', 'kind', 'title', 'body', 'summary', 'occurred_at'],
    order: [M.relevance('title'), ['occurred_at', 'DESC'], ['id', 'DESC']],
    limit,
  }).catch((e) => { console.error('[search] interactions err:', e.message); return []; });
  const cids = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  const nameOf = new Map(cids.length ? (await Client.findAll({ where: { id: cids, business_id: ctx.businessId }, attributes: ['id', 'display_name', 'company_name'] }))
    .map((c) => [c.id, c.display_name || c.company_name || null]) : []);
  return rows.map((r) => {
    const { body, summary, ...rest } = toPlain(r);
    rest.client_name = nameOf.get(rest.client_id) || null;
    rest.match = pickMatch([
      { field: 'title', text: rest.title, shown: true },
      { field: 'body', text: body },
      { field: 'summary', text: summary },
    ], M.q);
    return rest;
  });
}

/** 프로젝트 메모가 보이는 범위 — 팀 공개(internal) + 내 개인(personal). 남의 개인 메모는 절대 아니다.
 *  AI 도구 list_project_notes(services/agent/tools/directory.js)와 같은 술어. */
function projectNoteVisibleWhere(userId) {
  return { [Op.or]: [{ visibility: 'internal' }, { visibility: 'personal', author_user_id: userId }] };
}

async function searchProjectNotes(ctx, M, { limit, filters } = {}) {
  const { ProjectNote } = require('../models');
  const conds = [projectNoteVisibleWhere(ctx.userId), { body: M.like }];
  if (filters) {
    if (filters.projectId) conds.push({ project_id: filters.projectId });
    if (filters.clientId) {
      const pids = await projectIdsOfClient(ctx.businessId, filters.clientId);
      conds.push({ [Op.or]: [{ client_id: filters.clientId }, { project_id: { [Op.in]: pids.length ? pids : [-1] } }] });
    }
    conds.push(...dateRange('created_at', filters));
  }
  const rows = await ProjectNote.findAll({
    where: { [Op.and]: conds },
    // 워크스페이스 묶음은 프로젝트 조인이 건다(메모 행에는 business_id 가 없다)
    include: [{ model: Project, attributes: ['id', 'name'], where: { business_id: ctx.businessId }, required: true }],
    attributes: ['id', 'project_id', 'visibility', 'body', 'created_at'],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
  }).catch((e) => { console.error('[search] project_notes err:', e.message); return []; });
  return rows.map((r) => {
    const j = toPlain(r);
    return {
      id: j.id, project_id: j.project_id, project_name: j.Project ? j.Project.name : null,
      visibility: j.visibility, created_at: j.created_at,
      match: pickMatch([{ field: 'body', text: j.body }], M.q),
    };
  });
}

/** 회의록 — q-note internal/search(session_read_allowed). 실패하면 `{ status:'unavailable' }` — 빈 결과로 위장하지 않는다. */
async function searchMeetingNotes(ctx, M, { limit, filters } = {}) {
  const { searchNotes } = require('./qnoteContext');
  const r = await searchNotes({ businessId: ctx.businessId, userId: ctx.userId, query: M.q, limit: Math.min(10, limit || 5), snippetChars: 400 });
  if (r.status !== 'ok') return { status: 'unavailable', items: [] };
  let items = r.items;
  if (filters) {
    if (filters.projectId) items = items.filter((x) => Number(x.project_id) === Number(filters.projectId));
    if (filters.clientId) items = items.filter((x) => Number(x.client_id) === Number(filters.clientId));
    if (filters.since) items = items.filter((x) => x.created_at && new Date(x.created_at) >= filters.since);
    if (filters.until) items = items.filter((x) => x.created_at && new Date(x.created_at) <= filters.until);
  }
  return {
    status: 'ok',
    items: items.map((x) => ({
      id: x.id, title: x.title, created_at: x.created_at, project_id: x.project_id || null, client_id: x.client_id || null,
      is_mine: !!x.is_mine,
      match: pickMatch([{ field: 'title', text: x.title, shown: true }, { field: 'summary', text: x.snippet }], M.q)
        || (x.snippet ? { field: 'summary', snippet: String(x.snippet).slice(0, 158) } : null),
    })),
  };
}


/**
 * 통합 검색 둘째 줄 — 업무(담당·작성·마감·프로젝트) · 파일(올린 사람·날짜·프로젝트). 2026-10-07 Irene:
 *   "통합검색에서 업무 검색되면 담당자, 작성자 표시하고 … 파일검색도, 기본 인지가능하게".
 *   매치·정렬·권한을 건드리지 않고 **이미 걸러진 id** 만 다시 읽는다(문서 searchPosts 4) 와 같은 방식).
 */
async function attachResultMeta({ tasks = [], files = [] }, businessId) {
  const { User, Task: T, File: F } = require('../models');
  const dn = require('./displayName');
  if (tasks.length) {
    const rows = (await T.findAll({
      where: { business_id: businessId, id: { [Op.in]: tasks.map((x) => x.id) } },
      attributes: ['id', 'due_date', 'assignee_id', 'created_by'],
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
      ],
    }).catch(() => [])).map((r) => r.toJSON());
    await dn.applyMemberDisplayName(rows, businessId, ['assignee', 'creator']).catch(() => {});
    const by = new Map(rows.map((r) => [r.id, r]));
    for (const t of tasks) {
      const r = by.get(t.id); if (!r) continue;
      t.due_date = r.due_date || null;
      t.assignee = r.assignee ? { id: r.assignee.id, name: r.assignee.name } : null;
      t.creator = r.creator ? { id: r.creator.id, name: r.creator.name } : null;
      t.project = r.Project ? { id: r.Project.id, name: r.Project.name } : null;
    }
  }
  if (files.length) {
    const rows = (await F.findAll({
      where: { business_id: businessId, id: { [Op.in]: files.map((x) => x.id) } },
      attributes: ['id', 'created_at', 'uploader_id'],
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
      ],
    }).catch(() => [])).map((r) => r.toJSON());
    await dn.applyMemberDisplayName(rows, businessId, ['uploader']).catch(() => {});
    const by = new Map(rows.map((r) => [r.id, r]));
    for (const f of files) {
      const r = by.get(f.id); if (!r) continue;
      f.created_at = r.created_at;
      f.uploader = r.uploader ? { id: r.uploader.id, name: r.uploader.name } : null;
      f.project = r.Project ? { id: r.Project.id, name: r.Project.name } : null;
    }
  }
}

module.exports = {
  attachResultMeta,
  TASK_ORDER, CELL_CANDIDATE_ROWS, deny, buildScopedWheres, escLike, makeMatcher, kbWhereOf,
  searchTasks, shapeTasks, searchPosts, searchFiles, searchConversations, searchKnowledge,
  searchClients, shapeClients, searchProjects,
  searchMail, searchEvents, searchInteractions, searchProjectNotes, searchMeetingNotes,
  projectNoteVisibleWhere, projectIdsOfClient,
};
