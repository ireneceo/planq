// 프로젝트 연결(참조) — 문서·파일을 소속 말고 다른 프로젝트에도 건다 (2026-10-27, docs/PROJECT_REFS_DESIGN.md · Fable GO-WITH-CHANGES).
//
//   ★ /api 에 마운트한다. 경로: /projects/:id/refs…(프로젝트 쪽) · /project-refs/:type/:id(항목 상세의 연결 칩).
//     routes/projects.js 에는 `/:id/refs` 가 없다 — 겹치지 않는다(가드 duproute 는 파일 안만 본다).
//   ★ 판정·쓰기·감사·실시간은 services/projectRefs 한 곳. 기존 문서 목록(GET /api/posts?project_id=)은 건드리지 않는다.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { User, Conversation } = require('../models');
const { loadProjectOrForbidden } = require('../services/projectAccess');
const projectRefs = require('../services/projectRefs');

const send = (res, r) => (r.ok ? successResponse(res, r.data) : errorResponse(res, r.code, r.http));

// GET /api/projects/:id/refs?type=post — 프로젝트 문서 탭의 «연결됨» 행(보는 사람이 원본을 읽을 수 있는 것만)
router.get('/projects/:id/refs', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (String(req.query.type || 'post') !== 'post') return errorResponse(res, 'invalid_entity_type', 400);
    const { rows, homes } = await projectRefs.linkedPostsForProject(req.user, project, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
      ],
      // 임시저장은 작성자에게만 — 문서 목록과 같은 축(#252)
      extraWhere: { [Op.or]: [{ status: { [Op.ne]: 'draft' } }, { author_id: req.user.id }] },
    });
    const { serialize: serializePost } = require('../services/postSerialize');
    const items = rows.map((r) => ({
      ...serializePost(r),
      // 소속 프로젝트는 보는 사람이 볼 수 있을 때만 이름을 싣는다(숨은 프로젝트 이름이 새지 않게)
      project: homes.get(Number(r.project_id)) || null,
      linked: true,
    }));
    await require('../services/displayName').applyMemberDisplayName(items, project.business_id, ['author', 'editor']);
    return successResponse(res, items);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/refs  { entity_type: 'post'|'file', entity_id }
router.post('/projects/:id/refs', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/projectRefs.link 가 쓴다(project_ref.link)
  try {
    send(res, await projectRefs.link({
      req, projectId: req.params.id, entityType: String(req.body?.entity_type || ''), entityId: req.body?.entity_id,
    }));
  } catch (err) { next(err); }
});

// DELETE /api/projects/:id/refs/:type/:entityId
router.delete('/projects/:id/refs/:type/:entityId', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/projectRefs.unlink 가 쓴다(project_ref.unlink)
  try {
    send(res, await projectRefs.unlink({
      req, projectId: req.params.id, entityType: req.params.type, entityId: req.params.entityId,
    }));
  } catch (err) { next(err); }
});

// GET /api/project-refs/:type/:id — 항목 상세의 «연결» 칩. 원본을 못 읽으면 404(존재를 알리지 않는다).
router.get('/project-refs/:type/:id', authenticateToken, async (req, res, next) => {
  try {
    const type = req.params.type;
    if (!projectRefs.ENTITY_TYPES.includes(type)) return errorResponse(res, 'invalid_entity_type', 400);
    const e = await projectRefs.loadEntity(type, Number(req.params.id));
    if (!e || !(await projectRefs.canRead(req.user, type, e))) return errorResponse(res, 'not_found', 404);
    return successResponse(res, await projectRefs.listForEntity(req.user, type, e));
  } catch (err) { next(err); }
});

module.exports = router;
