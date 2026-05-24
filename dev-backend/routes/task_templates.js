// 업무 템플릿 라우트 (사이클 N+1)
// GET    /api/task-templates                — 시스템 preset + 워크스페이스 템플릿 통합 목록
// GET    /api/task-templates/:id             — 상세 (items 포함)
// POST   /api/task-templates/:id/apply       — 템플릿 → task 일괄 생성
// POST   /api/task-templates                 — 사용자 신규 저장 (Phase 3)
// POST   /api/projects/:id/save-as-template  — 기존 프로젝트 → 템플릿 (Phase 3, 별도 라우트)

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { TaskTemplate, TaskTemplateItem, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// 워크스페이스 멤버 권한 확인
async function ensureMember(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!bm;
}

// ==========================================
// GET /api/task-templates?business_id=X[&category=Y]
// 시스템 preset (business_id NULL & is_system=true) + 워크스페이스 템플릿
// ==========================================
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id || req.user.active_business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    if (!(await ensureMember(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const where = {
      [Op.or]: [
        { is_system: true, business_id: null },
        { business_id: businessId },
      ],
    };
    if (req.query.category) where.category = String(req.query.category);

    const templates = await TaskTemplate.findAll({
      where,
      order: [['is_system', 'DESC'], ['usage_count', 'DESC'], ['created_at', 'DESC']],
    });

    return successResponse(res, templates.map(t => t.toJSON()));
  } catch (err) { next(err); }
});

// ==========================================
// GET /api/task-templates/:id — items 포함 상세
// ==========================================
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    if (!tpl) return errorResponse(res, 'not_found', 404);

    // 권한: 시스템 preset 은 모두 OK, 워크스페이스 템플릿은 멤버만
    if (!tpl.is_system) {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }

    const data = tpl.toJSON();
    data.items = (data.items || []).sort((a, b) => a.order_index - b.order_index);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ==========================================
// POST /api/task-templates/:id/apply
// body: { business_id, project_id?, start_date, assignee_map? }
// ==========================================
router.post('/:id/apply', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, start_date, assignee_map } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!start_date) return errorResponse(res, 'start_date required (YYYY-MM-DD)', 400);

    if (!(await ensureMember(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const { applyTemplate } = require('../services/templateApply');
    const result = await applyTemplate({
      templateId: Number(req.params.id),
      businessId: Number(business_id),
      projectId: project_id || null,
      startDate: String(start_date).slice(0, 10),
      assigneeMap: assignee_map || {},
      actorUserId: req.user.id,
    });

    // socket emit — Q Task 페이지 자동 반영
    const io = req.app.get('io');
    if (io && result.created.length > 0) {
      for (const t of result.created) {
        const payload = { ...t.toJSON(), actor_user_id: req.user.id };
        if (project_id) io.to(`project:${project_id}`).emit('task:new', payload);
        io.to(`business:${business_id}`).emit('task:new', payload);
      }
    }

    return successResponse(res, {
      created: result.created.map(t => t.toJSON()),
      count: result.created.length,
      template_id: result.templateId,
    });
  } catch (err) {
    if (err.message === 'template_not_found') return errorResponse(res, 'template_not_found', 404);
    if (err.message === 'forbidden_template') return errorResponse(res, 'forbidden_template', 403);
    next(err);
  }
});

// ==========================================
// PUT /api/task-templates/:id — 메타 수정 (name/description/category/is_default)
// 시스템 preset 은 platform_admin 만 수정 가능. 워크스페이스 템플릿은 멤버.
// ==========================================
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) {
      if (req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'system_preset_readonly', 403);
      }
    } else {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const { name, description, category, is_default } = req.body;
    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim().slice(0, 200);
    if (typeof description === 'string') updates.description = description.slice(0, 2000) || null;
    if (typeof category === 'string') updates.category = category.slice(0, 50) || null;
    if (typeof is_default === 'boolean') updates.is_default = is_default;
    await tpl.update(updates);
    return successResponse(res, tpl.toJSON());
  } catch (err) { next(err); }
});

// ==========================================
// PUT /api/task-templates/:id/items — items 일괄 교체 (전체 재생성)
// body: { items: [{ title, description?, start_offset_days, duration_days, estimated_hours?, priority?, role_hint? }] }
// 시스템 preset 은 platform_admin 만, 워크스페이스 템플릿은 멤버.
// ==========================================
router.put('/:id/items', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) {
      if (req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'system_preset_readonly', 403);
      }
    } else {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return errorResponse(res, 'items array required', 400);

    // 기존 items 모두 삭제 후 재생성
    await TaskTemplateItem.destroy({ where: { template_id: tpl.id } });

    let totalDur = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const title = String(it.title || '').trim().slice(0, 500);
      if (!title) continue;
      const off = Number.isInteger(it.start_offset_days) ? it.start_offset_days : 0;
      const dur = Math.max(1, Number.isInteger(it.duration_days) ? it.duration_days : 1);
      const end = off + dur;
      if (end > totalDur) totalDur = end;
      await TaskTemplateItem.create({
        template_id: tpl.id,
        order_index: i,
        title,
        description: it.description ? String(it.description).slice(0, 2000) : null,
        start_offset_days: off,
        duration_days: dur,
        estimated_hours: Number.isFinite(Number(it.estimated_hours)) && Number(it.estimated_hours) > 0
          ? Number(it.estimated_hours) : null,
        priority: ['urgent', 'high', 'normal', 'low'].includes(it.priority) ? it.priority : 'normal',
        role_hint: it.role_hint ? String(it.role_hint).slice(0, 100) : null,
      });
    }
    await tpl.update({ task_count: items.length, total_duration_days: totalDur });

    const full = await TaskTemplate.findByPk(tpl.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    const data = full.toJSON();
    data.items = (data.items || []).sort((a, b) => a.order_index - b.order_index);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ==========================================
// DELETE /api/task-templates/:id — 워크스페이스 템플릿만 (시스템 preset X)
// ==========================================
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) return errorResponse(res, 'system_preset_readonly', 403);
    if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const snap = { name: tpl.name, category: tpl.category, business_id: tpl.business_id, is_system: tpl.is_system };
    await tpl.destroy(); // CASCADE 로 items 도 삭제
    // 사이클 N+54 — audit. 템플릿 삭제 = 콘텐츠 mutation (다른 사용자 적용 영향)
    require('../services/auditService').logAudit(req, {
      action: 'task_template.delete',
      targetType: 'task_template',
      targetId: tpl.id,
      businessId: snap.business_id,
      oldValue: snap,
    });
    return successResponse(res, { deleted: true, id: tpl.id });
  } catch (err) { next(err); }
});

// ==========================================
// POST /api/projects/:id/save-as-template — 기존 프로젝트 → 템플릿
// body: { name, description?, category? }
// 프로젝트의 모든 task 를 가장 빠른 start_date 기준 offset 으로 변환.
// 워크스페이스 템플릿 (is_system=false) 으로 생성.
// ==========================================
router.post('/from-project/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const { Task, Project, BusinessMember } = require('../models');
    const projectId = Number(req.params.projectId);
    const { name, description, category } = req.body;
    if (!name || !String(name).trim()) return errorResponse(res, 'name required', 400);

    const project = await Project.findByPk(projectId);
    if (!project) return errorResponse(res, 'project_not_found', 404);

    if (!(await ensureMember(req.user.id, project.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const tasks = await Task.findAll({
      where: { project_id: projectId, business_id: project.business_id },
      order: [['start_date', 'ASC'], ['created_at', 'ASC']],
    });
    const datedTasks = tasks.filter(t => t.start_date && t.due_date);
    if (datedTasks.length === 0) {
      return errorResponse(res, 'no_dated_tasks — 프로젝트에 시작/마감 날짜가 있는 업무가 없습니다.', 400);
    }

    // 가장 빠른 start_date 를 base 로
    const baseStr = datedTasks.reduce((min, t) => {
      const s = String(t.start_date).slice(0, 10);
      return s < min ? s : min;
    }, '9999-12-31');

    const baseDate = new Date(baseStr + 'T00:00:00Z');
    const dayMs = 86400000;
    const calcOffset = (dateStr) => Math.round((new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z') - baseDate) / dayMs);

    // role_hint 자동 추출 — assignee 의 BusinessMember.job_title 사용
    const assigneeIds = Array.from(new Set(datedTasks.map(t => t.assignee_id).filter(Boolean)));
    const memberRows = assigneeIds.length > 0
      ? await BusinessMember.findAll({ where: { user_id: assigneeIds, business_id: project.business_id } })
      : [];
    const userToHint = {};
    memberRows.forEach(m => { userToHint[m.user_id] = m.job_title || null; });

    let totalDur = 0;
    const tpl = await TaskTemplate.create({
      business_id: project.business_id,
      name: String(name).trim().slice(0, 200),
      description: description ? String(description).slice(0, 2000) : null,
      category: category ? String(category).slice(0, 50) : 'custom',
      is_system: false,
      is_default: false,
      task_count: datedTasks.length,
      total_duration_days: 0, // 아래에서 갱신
      created_by: req.user.id,
    });

    for (let i = 0; i < datedTasks.length; i++) {
      const t = datedTasks[i];
      const off = calcOffset(t.start_date);
      const due = calcOffset(t.due_date);
      const dur = Math.max(1, due - off);
      const endOffset = off + dur;
      if (endOffset > totalDur) totalDur = endOffset;

      await TaskTemplateItem.create({
        template_id: tpl.id,
        order_index: i,
        title: t.title,
        description: t.description || null,
        start_offset_days: off,
        duration_days: dur,
        estimated_hours: t.estimated_hours || null,
        priority: 'normal',
        role_hint: userToHint[t.assignee_id] || null,
      });
    }

    await tpl.update({ total_duration_days: totalDur });

    const full = await TaskTemplate.findByPk(tpl.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    return successResponse(res, full.toJSON(), 'saved_as_template', 201);
  } catch (err) { next(err); }
});

module.exports = router;
