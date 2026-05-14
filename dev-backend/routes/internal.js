// Internal API — 서비스 간 통신 (Q Note Python ↔ Node)
// 인증: x-internal-api-key 헤더 (process.env.INTERNAL_API_KEY 와 동일)
//
// 사용처:
//   - Q Note Python 의 visibility 검사 시 project membership / user project IDs 확인
//
// 절대 외부 노출 금지 (nginx 가 /api/internal/* 차단 또는 localhost 만 허용).

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ProjectMember, Project, BusinessMember } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

function requireInternalKey(req, res, next) {
  const key = req.header('x-internal-api-key');
  if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
    return errorResponse(res, 'forbidden', 403);
  }
  next();
}

router.use(requireInternalKey);

// ─── 특정 user 가 특정 project 의 멤버인지 ───
// GET /api/internal/project-membership/:userId/:projectId
router.get('/project-membership/:userId/:projectId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const projectId = Number(req.params.projectId);
    if (!userId || !projectId) return errorResponse(res, 'invalid_ids', 400);

    const pm = await ProjectMember.findOne({
      where: { user_id: userId, project_id: projectId },
      attributes: ['user_id', 'role'],
    });
    if (pm) return successResponse(res, { member: true, role: pm.role });

    // 프로젝트 owner 의 워크스페이스 오너도 멤버로 간주
    const project = await Project.findByPk(projectId, { attributes: ['business_id'] });
    if (!project) return successResponse(res, { member: false });
    const bm = await BusinessMember.findOne({
      where: { user_id: userId, business_id: project.business_id, role: 'owner' },
      attributes: ['user_id'],
    });
    return successResponse(res, { member: !!bm, role: bm ? 'workspace_owner' : null });
  } catch (err) { next(err); }
});

// ─── 사용자의 project IDs ───
// GET /api/internal/user-project-ids/:userId?business_id=N
router.get('/user-project-ids/:userId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    if (!userId) return errorResponse(res, 'invalid_user_id', 400);

    const where = { user_id: userId };
    const rows = await ProjectMember.findAll({
      where,
      attributes: ['project_id'],
      include: businessId
        ? [{ model: Project, attributes: ['id', 'business_id'], where: { business_id: businessId }, required: true }]
        : [],
    });
    const projectIds = rows.map((r) => r.project_id);

    // 워크스페이스 owner 는 자기 워크스페이스의 모든 project 멤버로 간주
    if (businessId) {
      const bm = await BusinessMember.findOne({
        where: { user_id: userId, business_id: businessId, role: 'owner' },
      });
      if (bm) {
        const allProjects = await Project.findAll({
          where: { business_id: businessId },
          attributes: ['id'],
        });
        for (const p of allProjects) {
          if (!projectIds.includes(p.id)) projectIds.push(p.id);
        }
      }
    }
    return successResponse(res, { project_ids: projectIds });
  } catch (err) { next(err); }
});

module.exports = router;
