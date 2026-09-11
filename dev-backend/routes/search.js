// 통합 검색 — 워크스페이스 모든 도메인을 한 번에 검색.
// GET /api/search?business_id=X&q=...&limit=10
//   결과: { tasks, posts, records, files, conversations, knowledge, clients, projects }
//   각 결과에 `match: { field, snippet } | null` — "왜 이 결과가 여기 있는가" (2026-09-11).
//     field   = 맞은 필드 (title·description·content·category·table·file_name·name·company·email·body·value)
//     snippet = 그 필드가 목록 행에 **안 보일 때만** 매칭 주변 평문 창(≤160자). 보이면 null.
//     규칙: utils/searchMatch.js — 프론트 하이라이트(utils/searchMatch.ts)와 같은 정규식.
//     ★ 본문 전체는 응답에 싣지 않는다(스니펫 계산에 쓴 컬럼은 내보내기 전에 뺀다).
//     ★ 비밀(secret) 항목 값에서는 스니펫을 만들지 않는다.
// 권한: 사용자 scope 기준 — client 격리 + project 멤버 한정 + KB 차단 등.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Task, Post, File, Conversation, KbDocument, Client, Project,
} = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const {
  assertWorkspaceAccess, taskListWhere, fileListWhereByLevel, postListWhereByLevel,
  conversationListWhere,
} = require('../middleware/access_scope');
const { pickMatch, makeSnippet, textMatches, toPlainText } = require('../utils/searchMatch');


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
    scope, isClient,
    taskWhere: deny(await taskListWhere(userId, businessId, scope)),
    fileWhere: deny(fileListWhereByLevel(scope)),
    postWhere: deny(postListWhereByLevel(scope)),
    convWhere: deny(await conversationListWhere(userId, businessId, scope)),
  };
}

const asObj = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

// 셀·항목 값 → 검색용 평문. 배열(multi_select)은 쉼표로, 객체는 버린다(구조값에서 문장을 지어내지 않는다).
const cellText = (raw) => {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.filter((x) => x != null && typeof x !== 'object').join(', ');
  if (typeof raw === 'object') return '';
  return String(raw);
};

// { 항목명: 값 } 에서 **비밀이 아닌** 첫 매칭 → "항목명: …값…" 스니펫. 없으면 null.
//   columns: [{ id, name, type }] — type==='secret' 인 칸은 후보에서 뺀다.
function columnValueSnippet(columns, values, q) {
  const cols = Array.isArray(columns) ? columns : [];
  const vals = values && typeof values === 'object' ? values : {};
  const secretIds = new Set(cols.filter((c) => c && c.type === 'secret').map((c) => String(c.id)));
  const nameOf = new Map(cols.filter(Boolean).map((c) => [String(c.id), c.name || c.label || '']));
  for (const [colId, raw] of Object.entries(vals)) {
    if (secretIds.has(String(colId))) continue;
    const text = toPlainText(cellText(raw));
    if (!text || !textMatches(text, q)) continue;
    const name = nameOf.get(String(colId)) || '';
    const sn = makeSnippet(text, q, { plain: true, max: name ? Math.max(40, 150 - name.length) : 158 });
    const body = sn ? sn.display : text.slice(0, 150);
    return name ? `${name}: ${body}` : body;
  }
  return null;
}

// 셀 값 → 판정용 원자 문자열들. 구조값(배열·객체)은 안의 원시값까지 편다.
//   각 원자는 **SQL 이 보는 JSON 표기 그대로**(이스케이프 포함) — 아래 판정이 SQL 후보 조건보다 넓어지지 않게.
const cellAtoms = (raw, out = []) => {
  if (raw == null) return out;
  if (Array.isArray(raw)) { for (const x of raw) cellAtoms(x, out); return out; }
  if (typeof raw === 'object') { for (const x of Object.values(raw)) cellAtoms(x, out); return out; }
  out.push(JSON.stringify(String(raw)).slice(1, -1));
  return out;
};

// ★ 표 셀·Q info 항목 값 검색의 **단일 판정** (#334 → 2026-09-11 표 분기까지).
//   SQL 은 values JSON 을 통째로 LIKE 해 **후보만** 좁힌다 — 거기엔 비밀 칸 값과 칸 id(JSON 키)가 섞여 있다.
//   결과에 올리는 것은 **비밀이 아닌 칸** 하나라도 SQL 과 같은 규칙(부분일치 / 공백 제거 부분일치)으로 맞을 때뿐이다.
//   판정 규칙을 SQL 보다 넓히지 않는다 — 넓히면 비밀 칸이 후보로 끌어온 행이 비밀 아닌 칸의 느슨한 규칙으로
//   통과해, "결과가 뜨는가" 가 다시 비밀 값에 좌우된다.
//   호출부는 SQL 에 두 조건(`LIKE :like` · `REPLACE(…,' ','') LIKE :likeSq`)을 **둘 다** 건다.
function matchesNonSecretCell(columns, values, q) {
  const cols = Array.isArray(columns) ? columns : [];
  const vals = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const secretIds = new Set(cols.filter((c) => c && c.type === 'secret').map((c) => String(c.id)));
  const needle = q.toLowerCase();
  const needleSquashed = q.replace(/\s+/g, '').toLowerCase();
  for (const [colId, raw] of Object.entries(vals)) {
    if (secretIds.has(String(colId))) continue;
    for (const atom of cellAtoms(raw)) {
      const v = atom.toLowerCase();
      if (!v) continue;
      if (needle && v.includes(needle)) return true;
      if (needleSquashed && v.replace(/ /g, '').includes(needleSquashed)) return true;
    }
  }
  return false;
}

// 판정 전 후보 행 상한 — 비밀 칸에서만 맞은 행이 자리를 먹어 정상 결과를 밀어내지 않을 만큼.
const CELL_CANDIDATE_ROWS = 500;

// GET /api/search/recent?business_id=X&limit=5
//   운영 #305 — "검색이랑 상단 탭 열 때 최신글이나 문서 등 이런거 보여주는 거 기본 아니야? 검색 전에."
//   빈 검색창은 아무것도 못 하는 화면이었다. 열자마자 **최근에 손댄 것**을 보여주면
//   대부분의 이동은 타이핑 없이 끝난다.
//   ★ 검색과 같은 권한 규칙(buildScopedWheres)을 쓴다 — 여기만 느슨하면 그게 곧 유출이다.
router.get('/recent', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const w = await buildScopedWheres(req.user.id, businessId, req.user.platform_role);
    if (!w) return errorResponse(res, 'forbidden', 403);

    const [posts, tasks, files, conversations] = await Promise.all([
      Post.findAll({
        where: w.postWhere, attributes: ['id', 'title', 'category', 'project_id', 'kind'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
      Task.findAll({
        where: w.taskWhere, attributes: ['id', 'title', 'status', 'project_id'],
        limit, order: TASK_ORDER,
      }).catch(() => []),
      File.findAll({
        where: { ...w.fileWhere, deleted_at: null }, attributes: ['id', 'file_name', 'file_size', 'mime_type'],
        limit, order: [['created_at', 'DESC']],
      }).catch(() => []),
      Conversation.findAll({
        where: w.convWhere, attributes: ['id', 'title', 'display_name', 'project_id'],
        limit, order: [['last_message_at', 'DESC']],
      }).catch(() => []),
    ]);

    const toPlain = (m) => (m && typeof m.toJSON === 'function') ? m.toJSON() : m;
    return successResponse(res, {
      posts: posts.map(toPlain),
      tasks: tasks.map(toPlain),
      files: files.map(toPlain),
      conversations: conversations.map(toPlain),
    });
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    // ★ #364 — 검색어도 조합형(NFC)으로 통일한다. 맥에서 복사한 검색어는 분해형(NFD)이라
    //   눈에는 같아 보여도 저장값과 바이트가 달라 LIKE 가 한 건도 못 찾는다(조용한 실패).
    //   저장측은 services/filename.js 가 NFC 로 통일한다 — 양쪽 축을 맞춰야 의미가 있다.
    const q = String(req.query.q || '').normalize('NFC').trim();
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!q) return successResponse(res, { tasks: [], posts: [], records: [], files: [], conversations: [], knowledge: [], clients: [], projects: [] });

    // ★ 2026-08-20 — 여기가 **비멤버에게 타 워크스페이스 업무·대화를 내주고 있었다**(Fable 실측).
    //   옛 코드는 `getUserScope` 결과를 `if (!scope)` 로 검사했는데, 그 함수는 완전 외부인에게도
    //   truthy(모든 플래그 false)를 준다 → 403 이 영원히 안 난다. 이어 taskListWhere/conversationListWhere
    //   가 거부 뜻으로 돌려준 null 이 `where: null` = **조건 없음**으로 해석돼 전 워크스페이스가 샜다.
    //   접근권 판정을 assertWorkspaceAccess 로 바꾸고, where 는 deny() 로 2차 차단한다(buildScopedWheres 와 동일 계약).
    const w = await buildScopedWheres(req.user.id, businessId, req.user.platform_role);
    if (!w) return errorResponse(res, 'forbidden', 403);
    const { scope, isClient } = w;

    // 사용자 입력의 LIKE 와일드카드(% _ \)는 리터럴로 — "%" 하나로 전건이 매칭되던 것 차단.
    //   (Q Mail 검색은 이미 이 방어가 있었는데 통합검색에는 없었다.)
    const escLike = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);
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

    // 권한별 where 조건 — client 는 자기 데이터만, member/owner 는 워크스페이스 + 본인 프로젝트
    // 사이클 N+9: file/post 는 옵션 A (visibility/vlevel 단계별) 적용
    const { taskWhere, fileWhere, postWhere, convWhere } = w;

    // (#359 — 옛 Q record 검색 분기를 걷어내면서 recordWhere 도 함께 제거. 죽은 권한식을 남기면
    //  다음 사람이 "레코드 검색이 있다" 고 읽는다.)

    // KB — client 는 차단 (memory project_client_permission_matrix)
    const kbWhere = isClient ? { id: -1 } : { business_id: businessId };

    // Client 목록 — client 자신은 본인만, member/owner 는 워크스페이스 전체
    //   ★ 필드명 주의 — `clientId`(단수)도 존재하지 않는다. getUserScope 는 `clientIds` 배열을 준다.
    const clientWhere = isClient
      ? { business_id: businessId, id: { [Op.in]: scope.clientIds.length ? scope.clientIds : [-1] } }
      : { business_id: businessId };

    // Project — client 는 자기 프로젝트만
    //   ★ `allowedProjectIds` 도 없는 필드다 — 고객이 닿는 프로젝트는 `projectClientProjectIds`.
    const projectWhere = isClient
      ? { business_id: businessId, id: { [Op.in]: scope.projectClientProjectIds.length ? scope.projectClientProjectIds : [-1] } }
      : { business_id: businessId };

    // 병렬 검색 — 각 where 에 keyword 추가
    const [tasks, posts, records, files, conversations, knowledge, clients, projects] = await Promise.all([
      Task.findAll({
        where: { ...taskWhere, [Op.and]: [{ [Op.or]: [...likeAny('title'), { description: like }] }] },
        // description 은 **스니펫 계산에만** 쓰고 응답 전에 뺀다(아래 match 후처리).
        attributes: ['id', 'title', 'status', 'project_id', 'description'],
        limit, order: [relevance('title'), ...TASK_ORDER],
      }).catch(() => []),
      // Post: 기본 (title/content/category) + table kind 면 q_record_rows.values 도 매치
      (async () => {
        // 1) 기본 매치
        const basicMatches = await Post.findAll({
          where: { ...postWhere, [Op.and]: [{ [Op.or]: [...likeAny('title'), { content_text: like }, { category: like }] }] },
          // content_text 는 스니펫 계산에만 — 응답 전에 뺀다
          attributes: ['id', 'title', 'category', 'project_id', 'kind', 'content_text'],
          limit, order: [relevance('title'), ['updated_at', 'DESC']],
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
          { replacements: { bid: businessId, like: `%${qEsc}%`, likeSq: `%${qSquashed}%` }, type: sequelize.QueryTypes.SELECT }
        ).catch(err => { console.error('[search] table cell match err:', err.message); return []; });
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
            where: { ...postWhere, business_id: businessId, [Op.and]: [{ id: { [Op.in]: tableIds } }] },
            attributes: ['id', 'title', 'category', 'project_id', 'kind'],
            order: [['updated_at', 'DESC']],
          }).catch(() => []);
        }
        // 합치기 (id 기준 dedup)
        const seen = new Set(basicMatches.map(m => m.id));
        const merged = [...basicMatches.map(m => m.toJSON ? m.toJSON() : m)];
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
            { replacements: { bid: businessId, ids: needTable, like: `%${qEsc}%` }, type: sequelize.QueryTypes.SELECT }
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
        return out;
      })().catch(() => []),
      // #359 — 폐지된 "Q record" 잔재. 검색에서 뺀다.
      //   Q record 메뉴는 이미 폐지돼 Q docs 의 표(kind='table')로 흡수됐다(App.tsx:122, /records → /docs).
      //   그런데 검색만 옛 그룹을 계속 냈다. 운영 실측(2026-08-21): q_records 6건 중 5건은 이미 post 로
      //   흡수돼 **같은 것이 "문서" 와 "레코드" 두 번** 뜨고, 나머지 1건은 연결된 post 가 없어 클릭하면
      //   그 항목이 아니라 문서 목록으로 떨어진다. 사용자에겐 "이게 뭔지 모르겠는 중복 결과" 다(#359 원문).
      //   표 안의 셀 내용 검색은 위 posts 분기가 q_record_rows 조인으로 이미 담당한다 — 잃는 기능이 없다.
      //   응답 키는 빈 배열로 남긴다: 옛 프론트 번들이 아직 살아 있을 수 있어 undefined 로 깨뜨리지 않는다.
      Promise.resolve([]),
      File.findAll({
        where: { ...fileWhere, [Op.and]: [{ [Op.or]: likeAny('file_name') }, { deleted_at: null }] },
        attributes: ['id', 'file_name', 'file_size', 'mime_type'],
        limit, order: [relevance('file_name'), ['created_at', 'DESC']],
      }).catch(() => []),
      Conversation.findAll({
        where: { ...convWhere, [Op.and]: [{ [Op.or]: [...likeAny('title'), ...likeAny('display_name')] }] },
        attributes: ['id', 'title', 'display_name', 'project_id'],
        limit, order: [relevance('title'), ['last_message_at', 'DESC']],
      }).catch(() => []),
      // KbDocument (Q info) — title/body + custom_values JSON 매치
      (async () => {
        const baseHits = await KbDocument.findAll({
          // business_id 명시 — kbWhere 에 이미 있지만 이 쿼리만 봐도 경계가 보여야 한다
          where: { ...kbWhere, business_id: businessId, [Op.and]: [{ [Op.or]: [...likeAny('title'), { body: like }] }] },
          // body 는 스니펫 계산에만 — 응답 전에 뺀다
          attributes: ['id', 'title', 'category', 'scope', 'body'],
          limit, order: [relevance('title'), ['updated_at', 'DESC']],
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
          { replacements: { bid: businessId, like: `%${qEsc}%`, likeSq: `%${qSquashed}%` }, type: sequelize.QueryTypes.SELECT }
        ).catch(err => { console.error('[search] kb val err:', err.message); return []; });

        // 비밀 아닌 항목 중 하나라도 맞으면 통과. 전부 secret 에서만 맞았으면 제외 — 표 셀과 같은 판정 한 곳.
        const valHits = rawValHits.filter((row) => (
          matchesNonSecretCell(asObj(row.custom_columns), asObj(row.custom_values), q)
        )).map(({ custom_columns: cc, custom_values: cv, ...rest }) => ({
          ...rest,
          // 스니펫도 **비밀이 아닌 칸에서만** — 위 필터와 같은 기준(columnValueSnippet 이 secret 을 건너뛴다)
          match: { field: 'value', snippet: columnValueSnippet(asObj(cc), asObj(cv), q) },
        }));
        const seen = new Set(baseHits.map(m => m.id));
        const merged = baseHits.map(withMatch);
        for (const m of valHits) if (!seen.has(m.id)) { merged.push(m); seen.add(m.id); }
        return merged.slice(0, limit);
      })().catch(() => []),
      Client.findAll({
        // 멀티테넌트 — clientWhere 는 위에서 구성되지만 호출 지점에도 명시한다
        //   (검색 블록이 길어지며 조건이 눈에서 멀어졌다. 중복이지만 실제 제약이라 안전하다).
        // ★ `email` 컬럼은 clients 에 없다(invite_email / billing_contact_email 이다).
        //   없는 컬럼을 where·attributes 에 쓰면 쿼리가 통째로 throw 하는데, 아래 .catch(()=>[]) 가
        //   그걸 삼켜 **고객 검색이 늘 "결과 없음"** 이었다. 조용한 죽음 — 화면에도 로그에도 안 남는다.
        //   (2026-08-21 발견. 실측: Unknown column 'Client.email' in 'where clause')
        where: { ...clientWhere, business_id: businessId, [Op.and]: [{ [Op.or]: [
          ...likeAny('display_name'), ...likeAny('company_name'),
          { invite_email: like }, { billing_contact_email: like },
        ] }] },
        attributes: ['id', 'display_name', 'company_name', 'invite_email', 'billing_contact_email'],
        limit, order: [relevance('display_name'), ['updated_at', 'DESC']],
      }).catch(() => []),
      Project.findAll({
        where: { ...projectWhere, [Op.and]: [{ [Op.or]: likeAny('name') }] },
        attributes: ['id', 'name', 'status'],
        limit, order: [relevance('name'), ['updated_at', 'DESC']],
      }).catch(() => []),
    ]);

    const toPlain = (m) => (m && typeof m.toJSON === 'function') ? m.toJSON() : m;

    // ── match 후처리 — 후보 순서 = 우선순위. 행에 보이는 필드를 앞에 둔다. ──
    const taskOut = tasks.map((m) => {
      const { description, ...rest } = toPlain(m);
      rest.match = pickMatch([
        { field: 'title', text: rest.title, shown: true },
        { field: 'description', text: description },
      ], q);
      return rest;
    });
    const fileOut = files.map((m) => {
      const o = toPlain(m);
      o.match = pickMatch([{ field: 'file_name', text: o.file_name, shown: true }], q);
      return o;
    });
    const convOut = conversations.map((m) => {
      const o = toPlain(m);
      // 목록은 display_name || title 을 그린다 — 안 그려진 쪽에서 맞았으면 그 이름을 스니펫으로.
      const shownName = o.display_name || o.title;
      o.match = pickMatch([
        { field: 'title', text: shownName, shown: true },
        { field: 'title', text: o.display_name ? o.title : null },
      ], q);
      return o;
    });
    const clientOut = clients.map((m) => {
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
    const projectOut = projects.map((m) => {
      const o = toPlain(m);
      o.match = pickMatch([{ field: 'name', text: o.name, shown: true }], q);
      return o;
    });

    successResponse(res, {
      tasks: taskOut,
      posts: posts.map(toPlain),
      records: records.map(toPlain),
      files: fileOut,
      conversations: convOut,
      knowledge: knowledge.map(toPlain),
      clients: clientOut,
      projects: projectOut,
    });
  } catch (err) { next(err); }
});

module.exports = router;
