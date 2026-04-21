const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FileFolder, File, Project } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

async function requireProjectInBusiness(projectId, businessId) {
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  return !!project;
}

// List folders of a project
router.get('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
    req.params.businessId = project.business_id; // for checkBusinessAccess compatibility
    const folders = await FileFolder.findAll({
      where: { business_id: project.business_id, project_id: project.id },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    successResponse(res, folders);
  } catch (error) {
    next(error);
  }
});

// Create folder
router.post('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
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

// Rename folder
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await requireProjectInBusiness(folder.project_id, folder.business_id))) {
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
