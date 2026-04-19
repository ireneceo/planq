const express = require('express');
const router = express.Router();
const {
  Project, ProjectProcessPart, ProjectProcessColumn, ProjectStatusOption,
  BusinessMember,
} = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

async function loadProjectOrGuard(req, res) {
  const project = await Project.findByPk(req.params.projectId);
  if (!project) { errorResponse(res, 'project_not_found', 404); return null; }
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: project.business_id } });
  if (!bm) { errorResponse(res, 'forbidden', 403); return null; }
  req._project = project;
  return project;
}

// ──────────────────────────────────────────────
// Status options
// ──────────────────────────────────────────────
router.get('/:projectId/status-options', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const rows = await ProjectStatusOption.findAll({ where: { project_id: req._project.id }, order: [['order_index', 'ASC']] });
    return successResponse(res, rows);
  } catch (err) { next(err); }
});

router.post('/:projectId/status-options', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const { status_key, label, color } = req.body || {};
    if (!status_key?.trim() || !label?.trim()) return errorResponse(res, 'status_key and label required', 400);
    const maxOrder = await ProjectStatusOption.max('order_index', { where: { project_id: req._project.id } });
    const row = await ProjectStatusOption.create({
      project_id: req._project.id,
      status_key: status_key.trim(),
      label: label.trim(),
      color: color?.trim() || null,
      order_index: (maxOrder || 0) + 1,
    });
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.patch('/:projectId/status-options/:optId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectStatusOption.findOne({ where: { id: req.params.optId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const { label, color, order_index } = req.body || {};
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (color !== undefined) updates.color = color;
    if (order_index !== undefined) updates.order_index = order_index;
    await row.update(updates);
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.delete('/:projectId/status-options/:optId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectStatusOption.findOne({ where: { id: req.params.optId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    await row.destroy();
    return successResponse(res, { id: Number(req.params.optId), deleted: true });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Custom columns
// ──────────────────────────────────────────────
router.get('/:projectId/process-columns', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const rows = await ProjectProcessColumn.findAll({ where: { project_id: req._project.id }, order: [['order_index', 'ASC']] });
    return successResponse(res, rows);
  } catch (err) { next(err); }
});

router.post('/:projectId/process-columns', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const { col_key, label, col_type } = req.body || {};
    if (!col_key?.trim() || !label?.trim()) return errorResponse(res, 'col_key and label required', 400);
    const type = ['text', 'date', 'select', 'number'].includes(col_type) ? col_type : 'text';
    const maxOrder = await ProjectProcessColumn.max('order_index', { where: { project_id: req._project.id } });
    const row = await ProjectProcessColumn.create({
      project_id: req._project.id,
      col_key: col_key.trim(),
      label: label.trim(),
      col_type: type,
      order_index: (maxOrder || 0) + 1,
    });
    return successResponse(res, row);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return errorResponse(res, 'duplicate_col_key', 409);
    next(err);
  }
});

router.patch('/:projectId/process-columns/:colId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectProcessColumn.findOne({ where: { id: req.params.colId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const { label, col_type, order_index } = req.body || {};
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (col_type && ['text', 'date', 'select', 'number'].includes(col_type)) updates.col_type = col_type;
    if (order_index !== undefined) updates.order_index = order_index;
    await row.update(updates);
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.delete('/:projectId/process-columns/:colId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectProcessColumn.findOne({ where: { id: req.params.colId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    await row.destroy();
    return successResponse(res, { id: Number(req.params.colId), deleted: true });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// Process parts (hierarchical rows)
// ──────────────────────────────────────────────
router.get('/:projectId/process-parts', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const rows = await ProjectProcessPart.findAll({ where: { project_id: req._project.id }, order: [['order_index', 'ASC']] });
    return successResponse(res, rows);
  } catch (err) { next(err); }
});

router.post('/:projectId/process-parts', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const { depth1, depth2, depth3, description, status_key, link, notes, extra } = req.body || {};
    const maxOrder = await ProjectProcessPart.max('order_index', { where: { project_id: req._project.id } });
    const row = await ProjectProcessPart.create({
      business_id: req._project.business_id,
      project_id: req._project.id,
      depth1: depth1 || null,
      depth2: depth2 || null,
      depth3: depth3 || null,
      description: description || null,
      status_key: status_key || null,
      link: link || null,
      notes: notes || null,
      extra: extra || null,
      order_index: (maxOrder || 0) + 1,
    });
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.patch('/:projectId/process-parts/:partId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectProcessPart.findOne({ where: { id: req.params.partId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const { depth1, depth2, depth3, description, status_key, link, notes, extra, order_index } = req.body || {};
    const updates = {};
    for (const [k, v] of Object.entries({ depth1, depth2, depth3, description, status_key, link, notes, extra, order_index })) {
      if (v !== undefined) updates[k] = v;
    }
    await row.update(updates);
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.delete('/:projectId/process-parts/:partId', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadProjectOrGuard(req, res))) return;
    const row = await ProjectProcessPart.findOne({ where: { id: req.params.partId, project_id: req._project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    await row.destroy();
    return successResponse(res, { id: Number(req.params.partId), deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
