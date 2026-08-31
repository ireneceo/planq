const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FileFolder, File, Project, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, canAccessProject, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

async function requireProjectInBusiness(projectId, businessId) {
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  return !!project;
}

// member 이상 (쓰기 액션용)
async function assertMemberWrite(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!bm;
}

// List folders of a project — client 도 자기 참여 프로젝트면 통과
router.get('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
    const scope = await getUserScope(req.user.id, project.business_id, req.user.platform_role);
    if (!(await canAccessProject(req.user.id, project, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    req.params.businessId = project.business_id;
    const folders = await FileFolder.findAll({
      where: { business_id: project.business_id, project_id: project.id },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    successResponse(res, folders);
  } catch (error) {
    next(error);
  }
});

// ─── 워크스페이스 폴더 (프로젝트에 속하지 않는 파일) ──────────────────────
//   Irene 2026-08-31: "우리 q 파일 리스트에 폴더 기능 넣고"
//   여태 폴더 라우트가 **전부 /projects/:projectId** 라, 프로젝트 없는 파일(운영 파일의 95%)은
//   폴더를 만들 길이 아예 없었다. 파일 쪽 배관은 이미 준비돼 있다 —
//   files.js 의 verifyFolderOwnership 은 projectId 가 없으면 business_id 만 본다.
//   ★ 권한·정렬 규칙은 프로젝트 폴더와 **같은 것**을 쓴다(두 벌로 갈라지지 않게).
router.get('/workspace/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
      return errorResponse(res, 'forbidden', 403);
    }
    const folders = await FileFolder.findAll({
      where: { business_id: businessId, project_id: null },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']],
    });
    successResponse(res, folders);
  } catch (error) { next(error); }
});

router.post('/workspace/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMemberWrite(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
    if (parentId) {
      const parent = await FileFolder.findOne({
        where: { id: parentId, business_id: businessId, project_id: null },
      });
      if (!parent) return errorResponse(res, 'Invalid parent_id', 400);
    }
    // 같은 자리에 같은 이름 두 개는 만들지 않는다 — 목록에서 구별이 안 된다.
    const dup = await FileFolder.findOne({
      where: { business_id: businessId, project_id: null, parent_id: parentId, name },
    });
    if (dup) return successResponse(res, dup);

    const row = await FileFolder.create({
      business_id: businessId, project_id: null, parent_id: parentId,
      name, sort_order: 0, created_by: req.user.id,
    });
    successResponse(res, row, 'Folder created', 201);
  } catch (error) { next(error); }
});

// Create folder
router.post('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
    if (!(await assertMemberWrite(req.user.id, project.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;

    if (parentId) {
      const parent = await FileFolder.findOne({
        where: { id: parentId, business_id: project.business_id, project_id: project.id }
      });
      if (!parent) return errorResponse(res, 'Invalid parent_id', 400);
    }

    const folder = await FileFolder.create({
      business_id: project.business_id,
      project_id: project.id,
      parent_id: parentId,
      name,
      sort_order: Number(req.body.sort_order) || 0,
      created_by: req.user.id
    });
    successResponse(res, folder, 'Folder created', 201);
  } catch (error) {
    next(error);
  }
});

// Reorder folder (up/down within same parent)
router.put('/:id/reorder', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const direction = req.body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return errorResponse(res, 'direction must be "up" or "down"', 400);
    }

    const siblings = await FileFolder.findAll({
      where: {
        business_id: folder.business_id,
        project_id: folder.project_id,
        parent_id: folder.parent_id
      },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });

    const idx = siblings.findIndex(s => s.id === folder.id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) {
      return errorResponse(res, 'already at boundary', 400);
    }

    // 인접 swap (전체 sort_order 재계산으로 안정화)
    const reordered = [...siblings];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];

    const t = await sequelize.transaction();
    try {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sort_order !== i) {
          reordered[i].sort_order = i;
          await reordered[i].save({ transaction: t });
        }
      }
      await t.commit();
      successResponse(res, { siblings: reordered.map(r => ({ id: r.id, sort_order: r.sort_order })) }, 'Reordered');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

// Rename folder
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // ★ 워크스페이스 폴더(project_id = null)는 프로젝트 검사 대상이 아니다.
    //   여태 이 줄이 무조건 돌아 `requireProjectInBusiness(null, ...)` 가 항상 실패했다 —
    //   폴더가 프로젝트에만 있던 시절에는 드러나지 않던 전제다(실측: 이름 변경 403).
    if (folder.project_id && !(await requireProjectInBusiness(folder.project_id, folder.business_id))) {
      return errorResponse(res, 'Access denied', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    folder.name = name;
    await folder.save();
    successResponse(res, folder, 'Folder renamed');
  } catch (error) {
    next(error);
  }
});

// Delete folder (재귀: 하위 폴더 삭제, 안 파일은 parent 또는 루트로 이동)
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const t = await sequelize.transaction();
    try {
      // 재귀 수집
      const allFolderIds = [folder.id];
      const queue = [folder.id];
      while (queue.length) {
        const pid = queue.shift();
        const children = await FileFolder.findAll({
          where: { parent_id: pid }, transaction: t
        });
        for (const c of children) {
          allFolderIds.push(c.id);
          queue.push(c.id);
        }
      }

      // 안 파일은 parent_id 로 이동 (null = 루트)
      await File.update(
        { folder_id: folder.parent_id },
        { where: { folder_id: { [Op.in]: allFolderIds } }, transaction: t }
      );

      // 폴더 삭제 (자식 먼저 → 루트 마지막)
      for (let i = allFolderIds.length - 1; i >= 0; i--) {
        await FileFolder.destroy({ where: { id: allFolderIds[i] }, transaction: t });
      }

      await t.commit();
      successResponse(res, { removed_folders: allFolderIds.length }, 'Folder deleted');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
