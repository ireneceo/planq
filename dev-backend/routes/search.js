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
  getUserScope, taskListWhere, fileListWhere, postListWhere,
  conversationListWhere,
} = require('../middleware/access_scope');

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const q = String(req.query.q || '').trim();
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!q) return successResponse(res, { tasks: [], posts: [], records: [], files: [], conversations: [], knowledge: [], clients: [], projects: [] });

    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!scope) return errorResponse(res, 'forbidden', 403);

    const like = { [Op.like]: `%${q}%` };
    const isClient = scope.role === 'client';

    // 권한별 where 조건 — client 는 자기 데이터만, member/owner 는 워크스페이스 + 본인 프로젝트
    const taskWhere = await taskListWhere(req.user.id, businessId, scope);
    const fileWhere = await fileListWhere(req.user.id, businessId, scope);
    const postWhere = await postListWhere(req.user.id, businessId, scope);
    const convWhere = await conversationListWhere(req.user.id, businessId, scope);

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
