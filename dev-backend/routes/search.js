// 통합 검색 — 워크스페이스 모든 도메인을 한 번에 검색.
// GET /api/search?business_id=X&q=...&limit=10
//   결과: { tasks, posts, records, files, conversations, knowledge, clients, projects }
// 권한: 사용자 scope 기준 — client 격리 + project 멤버 한정 + KB 차단 등.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Task, Post, File, QRecord, Conversation, KbDocument, Client, Project,
} = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const {
  assertWorkspaceAccess, taskListWhere, fileListWhereByLevel, postListWhereByLevel,
  conversationListWhere,
} = require('../middleware/access_scope');


// ─────────────────────────────────────────────────────────────
// 권한 스코프 + 도메인별 where — `/`(검색) 과 `/recent`(검색 전 최근 항목)가 **같은 규칙**을 쓴다.
//   두 곳에 따로 적으면 "검색으로는 안 나오는데 최근 목록엔 보이는" 격리 사고가 난다.
// ─────────────────────────────────────────────────────────────
// ★ deny 센티널 방어 — `taskListWhere`/`conversationListWhere` 는 **접근 불가일 때 null 을 돌려준다.**
//   그 null 을 그대로 `findAll({ where: null })` 로 넘기면 Sequelize 는 "조건 없음" 으로 읽어
//   **전 워크스페이스 전 행**을 내준다. 거부가 전체 공개로 뒤집히는 것이다.
//   (2026-08-20 Fable 검증에서 실제 cross-tenant 누출로 확인됐다 — 신규 /recent 뿐 아니라
//    **기존 / 검색도 같은 구멍이었다.** 아래 게이트로 1차 차단하고, 이 함수로 2차 차단한다.)
function deny(where) {
  return where || { id: { [Op.in]: [-1] } };
}

async function buildScopedWheres(userId, businessId, platformRole) {
  // ★ getUserScope 는 **완전 외부인에게도 truthy** 를 준다(모든 플래그 false 인 scope).
  //   그래서 `if (!scope)` 가드는 영원히 발화하지 않는다. 접근권 판정은 assertWorkspaceAccess 가 한다.
  const scope = await assertWorkspaceAccess(userId, businessId, platformRole);
  if (!scope) return null;
  const isClient = scope.role === 'client';
  return {
    scope, isClient,
    taskWhere: deny(await taskListWhere(userId, businessId, scope)),
    fileWhere: deny(fileListWhereByLevel(scope)),
    postWhere: deny(postListWhereByLevel(scope)),
    convWhere: deny(await conversationListWhere(userId, businessId, scope)),
  };
}

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
        limit, order: [['updated_at', 'DESC']],
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
    const q = String(req.query.q || '').trim();
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

    const like = { [Op.like]: `%${q}%` };

    // 권한별 where 조건 — client 는 자기 데이터만, member/owner 는 워크스페이스 + 본인 프로젝트
    // 사이클 N+9: file/post 는 옵션 A (visibility/vlevel 단계별) 적용
    const { taskWhere, fileWhere, postWhere, convWhere } = w;

    // Q record 권한 — 워크스페이스 멤버 모두 read 가능. read_policy='owner' 면 owner+admin 만.
    // client 는 일단 차단 (PERMISSION_MATRIX §7).
    const recordWhere = isClient
      ? { id: -1 } // 매치 안 되도록
      : {
          business_id: businessId,
          ...(scope.role === 'member' ? { read_policy: 'all' } : {}),
        };

    // KB — client 는 차단 (memory project_client_permission_matrix)
    const kbWhere = isClient ? { id: -1 } : { business_id: businessId };

    // Client 목록 — client 자신은 본인만, member/owner 는 워크스페이스 전체
    const clientWhere = isClient
      ? { id: scope.clientId || -1 }
      : { business_id: businessId };

    // Project — client 는 자기 프로젝트만
    const projectWhere = isClient
      ? { id: { [Op.in]: scope.allowedProjectIds || [] } }
      : { business_id: businessId };

    // 병렬 검색 — 각 where 에 keyword 추가
    const [tasks, posts, records, files, conversations, knowledge, clients, projects] = await Promise.all([
      Task.findAll({
        where: { ...taskWhere, [Op.and]: [{ [Op.or]: [{ title: like }, { description: like }] }] },
        attributes: ['id', 'title', 'status', 'project_id'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
      // Post: 기본 (title/content/category) + table kind 면 q_record_rows.values 도 매치
      (async () => {
        // 1) 기본 매치
        const basicMatches = await Post.findAll({
          where: { ...postWhere, [Op.and]: [{ [Op.or]: [{ title: like }, { content_text: like }, { category: like }] }] },
          attributes: ['id', 'title', 'category', 'project_id', 'kind'],
          limit, order: [['updated_at', 'DESC']],
        }).catch(() => []);
        // 2) 표 셀 검색 — kind='table' 인 post 의 연결 q_record_rows.values 에서 LIKE
        const { QRecord, QRecordRow } = require('../models');
        const tableSql =
          'SELECT DISTINCT p.id, p.title, p.category, p.project_id, p.kind, p.updated_at ' +
          'FROM posts p JOIN q_record_rows r ON r.q_record_id = p.q_record_id ' +
          'WHERE p.business_id = :bid AND p.kind = \'table\' ' +
          'AND LOWER(CAST(r.`values` AS CHAR)) LIKE LOWER(:like) ' +
          `ORDER BY p.updated_at DESC LIMIT ${Number(limit)}`;
        const tableMatches = await sequelize.query(tableSql,
          { replacements: { bid: businessId, like: `%${q}%` }, type: sequelize.QueryTypes.SELECT }
        ).catch(err => { console.error('[search] table cell match err:', err.message); return []; });
        // 합치기 (id 기준 dedup)
        const seen = new Set(basicMatches.map(m => m.id));
        const merged = [...basicMatches.map(m => m.toJSON ? m.toJSON() : m)];
        for (const m of tableMatches) if (!seen.has(m.id)) { merged.push(m); seen.add(m.id); }
        return merged.slice(0, limit);
      })().catch(() => []),
      QRecord.findAll({
        where: { ...recordWhere, [Op.and]: [{ [Op.or]: [{ name: like }, { category: like }, { description: like }] }] },
        attributes: ['id', 'name', 'category', 'project_id'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
      File.findAll({
        where: { ...fileWhere, [Op.and]: [{ file_name: like }, { deleted_at: null }] },
        attributes: ['id', 'file_name', 'file_size', 'mime_type'],
        limit, order: [['created_at', 'DESC']],
      }).catch(() => []),
      Conversation.findAll({
        where: { ...convWhere, [Op.and]: [{ [Op.or]: [{ title: like }, { display_name: like }] }] },
        attributes: ['id', 'title', 'display_name', 'project_id'],
        limit, order: [['last_message_at', 'DESC']],
      }).catch(() => []),
      // KbDocument (Q info) — title/body + custom_values JSON 매치
      (async () => {
        const baseHits = await KbDocument.findAll({
          where: { ...kbWhere, [Op.and]: [{ [Op.or]: [{ title: like }, { body: like }] }] },
          attributes: ['id', 'title', 'category', 'scope'],
          limit, order: [['updated_at', 'DESC']],
        }).catch(() => []);
        if (isClient) return baseHits;
        const valHits = await sequelize.query(
          'SELECT id, title, category, scope FROM kb_documents ' +
          'WHERE business_id = :bid ' +
          'AND (custom_values IS NOT NULL AND LOWER(CAST(custom_values AS CHAR)) LIKE LOWER(:like)) ' +
          `ORDER BY updated_at DESC LIMIT ${Number(limit)}`,
          { replacements: { bid: businessId, like: `%${q}%` }, type: sequelize.QueryTypes.SELECT }
        ).catch(err => { console.error('[search] kb val err:', err.message); return []; });
        const seen = new Set(baseHits.map(m => m.id));
        const merged = [...baseHits.map(m => m.toJSON ? m.toJSON() : m)];
        for (const m of valHits) if (!seen.has(m.id)) { merged.push(m); seen.add(m.id); }
        return merged.slice(0, limit);
      })().catch(() => []),
      Client.findAll({
        where: { ...clientWhere, [Op.and]: [{ [Op.or]: [{ display_name: like }, { company_name: like }, { email: like }] }] },
        attributes: ['id', 'display_name', 'company_name', 'email'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
      Project.findAll({
        where: { ...projectWhere, [Op.and]: [{ name: like }] },
        attributes: ['id', 'name', 'status'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
    ]);

    const toPlain = (m) => (m && typeof m.toJSON === 'function') ? m.toJSON() : m;
    successResponse(res, {
      tasks: tasks.map(toPlain),
      posts: posts.map(toPlain),
      records: records.map(toPlain),
      files: files.map(toPlain),
      conversations: conversations.map(toPlain),
      knowledge: knowledge.map(toPlain),
      clients: clients.map(toPlain),
      projects: projects.map(toPlain),
    });
  } catch (err) { next(err); }
});

module.exports = router;
