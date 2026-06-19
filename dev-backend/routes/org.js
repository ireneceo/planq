// Q조직 (Workspace Org) — D1. 부서/팀 + 멤버 소속 + 3단 대시보드 집계.
//   /api/org/:businessId/*
//   - 부서/팀 CRUD: owner/admin
//   - 멤버 배정: owner/admin
//   - overview(집계): scope 가드 (회사=owner/admin · 부서=owner/admin+부서원 · 개인=본인)
//   부서 = 표시·집계 단위 (권한 부여 축 아님). 멀티테넌트 business_id 강제.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Department, Team, BusinessMember, User, Task } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const { todayInTz, mondayOfDateStr } = require('../utils/datetime');

const ACTIVE_STATUS = { [Op.notIn]: ['completed', 'canceled'] };

// 워크스페이스 접근 + scope 부착
async function loadScope(req, res) {
  const businessId = Number(req.params.businessId);
  if (!businessId) { errorResponse(res, 'invalid_business', 400); return null; }
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  if (!isMemberOrAbove(scope) && !scope.isClient) { errorResponse(res, 'forbidden', 403); return null; }
  return { businessId, scope };
}
function canManage(scope) {
  return !!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin);
}
function broadcast(req, businessId) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit('org:updated', { businessId });
}

// ─── 부서 목록 (전 멤버) ───
router.get('/:businessId/departments', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    const depts = await Department.findAll({
      where: { business_id: ctx.businessId },
      include: [
        { model: Team, as: 'teams', attributes: ['id', 'name', 'name_en', 'sort_order'] },
        { model: User, as: 'lead', attributes: ['id', 'name'] },
      ],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    // 멤버수 (부서별)
    const counts = await BusinessMember.findAll({
      where: { business_id: ctx.businessId, removed_at: null, department_id: { [Op.ne]: null } },
      attributes: ['department_id', [require('sequelize').fn('COUNT', '*'), 'cnt']],
      group: ['department_id'], raw: true,
    });
    const cntMap = new Map(counts.map((c) => [c.department_id, Number(c.cnt)]));
    const data = depts.map((d) => {
      const j = d.toJSON();
      j.member_count = cntMap.get(d.id) || 0;
      j.teams = (j.teams || []).sort((a, b) => a.sort_order - b.sort_order);
      return j;
    });
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ─── 부서 CRUD (owner/admin) ───
router.post('/:businessId/departments', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const { name, name_en, color, lead_user_id, sort_order } = req.body || {};
    if (!name || !String(name).trim()) return errorResponse(res, 'name_required', 400);
    const dept = await Department.create({
      business_id: ctx.businessId, name: String(name).trim(),
      name_en: name_en ? String(name_en).trim() : null,
      color: color || null, lead_user_id: lead_user_id || null,
      sort_order: Number(sort_order) || 0,
    });
    broadcast(req, ctx.businessId);
    return successResponse(res, dept, '생성됨', 201);
  } catch (err) { next(err); }
});

router.put('/:businessId/departments/:id', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const dept = await Department.findOne({ where: { id: req.params.id, business_id: ctx.businessId } });
    if (!dept) return errorResponse(res, 'not_found', 404);
    const patch = {};
    for (const f of ['name', 'name_en', 'color', 'lead_user_id', 'sort_order']) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    await dept.update(patch);
    broadcast(req, ctx.businessId);
    return successResponse(res, dept);
  } catch (err) { next(err); }
});

router.delete('/:businessId/departments/:id', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const dept = await Department.findOne({ where: { id: req.params.id, business_id: ctx.businessId } });
    if (!dept) return errorResponse(res, 'not_found', 404);
    // 소속 멤버 detach + 팀 삭제 (멤버 team_id 도 detach)
    await BusinessMember.update({ department_id: null, team_id: null }, { where: { business_id: ctx.businessId, department_id: dept.id } });
    await Team.destroy({ where: { business_id: ctx.businessId, department_id: dept.id } });
    await dept.destroy();
    broadcast(req, ctx.businessId);
    return successResponse(res, { id: dept.id }, '삭제됨');
  } catch (err) { next(err); }
});

// ─── 팀 CRUD (owner/admin) ───
router.post('/:businessId/teams', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const { department_id, name, name_en, sort_order } = req.body || {};
    if (!name || !String(name).trim()) return errorResponse(res, 'name_required', 400);
    const dept = await Department.findOne({ where: { id: department_id, business_id: ctx.businessId } });
    if (!dept) return errorResponse(res, 'invalid_department', 400);
    const team = await Team.create({
      business_id: ctx.businessId, department_id: dept.id,
      name: String(name).trim(), name_en: name_en ? String(name_en).trim() : null,
      sort_order: Number(sort_order) || 0,
    });
    broadcast(req, ctx.businessId);
    return successResponse(res, team, '생성됨', 201);
  } catch (err) { next(err); }
});

router.put('/:businessId/teams/:id', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const team = await Team.findOne({ where: { id: req.params.id, business_id: ctx.businessId } });
    if (!team) return errorResponse(res, 'not_found', 404);
    const patch = {};
    for (const f of ['name', 'name_en', 'sort_order']) if (req.body[f] !== undefined) patch[f] = req.body[f];
    await team.update(patch);
    broadcast(req, ctx.businessId);
    return successResponse(res, team);
  } catch (err) { next(err); }
});

router.delete('/:businessId/teams/:id', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const team = await Team.findOne({ where: { id: req.params.id, business_id: ctx.businessId } });
    if (!team) return errorResponse(res, 'not_found', 404);
    await BusinessMember.update({ team_id: null }, { where: { business_id: ctx.businessId, team_id: team.id } });
    await team.destroy();
    broadcast(req, ctx.businessId);
    return successResponse(res, { id: team.id }, '삭제됨');
  } catch (err) { next(err); }
});

// ─── 멤버 배정 (owner/admin) — 부서/팀/직책 ───
router.put('/:businessId/members/:userId/assignment', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    if (!canManage(ctx.scope)) return errorResponse(res, 'forbidden', 403);
    const bm = await BusinessMember.findOne({ where: { business_id: ctx.businessId, user_id: req.params.userId, removed_at: null } });
    if (!bm) return errorResponse(res, 'member_not_found', 404);
    const { department_id, team_id, job_title } = req.body || {};
    const patch = {};
    if (department_id !== undefined) {
      if (department_id === null) { patch.department_id = null; patch.team_id = null; }
      else {
        const dept = await Department.findOne({ where: { id: department_id, business_id: ctx.businessId } });
        if (!dept) return errorResponse(res, 'invalid_department', 400);
        patch.department_id = dept.id;
      }
    }
    if (team_id !== undefined) {
      if (team_id === null) patch.team_id = null;
      else {
        const targetDept = patch.department_id !== undefined ? patch.department_id : bm.department_id;
        const team = await Team.findOne({ where: { id: team_id, business_id: ctx.businessId } });
        if (!team || team.department_id !== targetDept) return errorResponse(res, 'invalid_team', 400); // 팀은 배정 부서 하위만
        patch.team_id = team.id;
      }
    }
    if (job_title !== undefined) patch.job_title = job_title ? String(job_title).slice(0, 100) : null;
    await bm.update(patch);
    broadcast(req, ctx.businessId);
    return successResponse(res, { user_id: bm.user_id, department_id: bm.department_id, team_id: bm.team_id, job_title: bm.job_title });
  } catch (err) { next(err); }
});

// ─── 3단 대시보드 집계 ───
//   scope=company (owner/admin) | department&department_id (owner/admin 또는 해당 부서원) | personal (본인)
router.get('/:businessId/overview', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadScope(req, res); if (!ctx) return;
    const { businessId, scope } = ctx;
    const reqScope = req.query.scope === 'company' || req.query.scope === 'department' ? req.query.scope : 'personal';
    const deptId = req.query.department_id ? Number(req.query.department_id) : null;

    // 접근 가드
    if (reqScope === 'company' && !canManage(scope)) return errorResponse(res, 'forbidden', 403);
    // 내 멤버십 (부서 판정)
    const myBm = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id, removed_at: null }, attributes: ['department_id'] });
    if (reqScope === 'department') {
      if (!deptId) return errorResponse(res, 'department_id_required', 400);
      const allowed = canManage(scope) || (myBm && myBm.department_id === deptId);
      if (!allowed) return errorResponse(res, 'forbidden', 403);
    }

    // tz 경계
    const biz = await require('../models').Business.findByPk(businessId, { attributes: ['timezone'] });
    const tz = biz?.timezone || 'Asia/Seoul';
    const todayStr = todayInTz(tz);
    const weekStartStr = mondayOfDateStr(todayStr);

    // 대상 멤버 set
    const memberWhere = { business_id: businessId, removed_at: null };
    if (reqScope === 'department') memberWhere.department_id = deptId;
    if (reqScope === 'personal') memberWhere.user_id = req.user.id;
    const members = await BusinessMember.findAll({
      where: memberWhere,
      attributes: ['user_id', 'name', 'department_id', 'team_id', 'job_title'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    });
    const memberIds = members.map((m) => m.user_id).filter(Boolean);

    // 업무 집계 (assignee 기준)
    const taskWhere = { business_id: businessId };
    if (memberIds.length > 0) taskWhere.assignee_id = { [Op.in]: memberIds };
    else taskWhere.assignee_id = { [Op.in]: [-1] };

    const [activeTasks, doneThisWeek, overdue, allForBreakdown] = await Promise.all([
      Task.count({ where: { ...taskWhere, status: ACTIVE_STATUS } }),
      Task.count({ where: { ...taskWhere, status: 'completed', updated_at: { [Op.gte]: new Date(`${weekStartStr}T00:00:00+09:00`) } } }),
      Task.count({ where: { ...taskWhere, status: ACTIVE_STATUS, due_date: { [Op.lt]: todayStr } } }),
      Task.findAll({ where: taskWhere, attributes: ['assignee_id', 'status', 'due_date'], raw: true }),
    ]);

    // 멤버별 breakdown
    const byMember = members.map((m) => {
      const mine = allForBreakdown.filter((t) => t.assignee_id === m.user_id);
      const active = mine.filter((t) => !['completed', 'canceled'].includes(t.status)).length;
      const od = mine.filter((t) => !['completed', 'canceled'].includes(t.status) && t.due_date && String(t.due_date).slice(0, 10) < todayStr).length;
      return { user_id: m.user_id, name: m.name || m.user?.name || '—', department_id: m.department_id, team_id: m.team_id, job_title: m.job_title, active, overdue: od };
    });

    // 부서별 breakdown (company scope 에서만)
    let byDepartment = [];
    if (reqScope === 'company') {
      const depts = await Department.findAll({ where: { business_id: businessId }, attributes: ['id', 'name', 'color'], order: [['sort_order', 'ASC']] });
      const allMembers = await BusinessMember.findAll({ where: { business_id: businessId, removed_at: null }, attributes: ['user_id', 'department_id'] });
      const deptOfUser = new Map(allMembers.map((m) => [m.user_id, m.department_id]));
      byDepartment = depts.map((d) => {
        const duids = allMembers.filter((m) => m.department_id === d.id).map((m) => m.user_id);
        const dtasks = allForBreakdown.filter((t) => duids.includes(t.assignee_id));
        return {
          id: d.id, name: d.name, color: d.color,
          member_count: duids.length,
          active: dtasks.filter((t) => !['completed', 'canceled'].includes(t.status)).length,
        };
      });
      // 미배정
      const unassigned = allMembers.filter((m) => !m.department_id).map((m) => m.user_id);
      if (unassigned.length > 0) {
        const utasks = allForBreakdown.filter((t) => unassigned.includes(t.assignee_id));
        byDepartment.push({ id: null, name: null, color: null, member_count: unassigned.length, active: utasks.filter((t) => !['completed', 'canceled'].includes(t.status)).length });
      }
      void deptOfUser;
    }

    return successResponse(res, {
      scope: reqScope, department_id: deptId,
      members: members.length, activeTasks, doneThisWeek, overdue,
      byMember, byDepartment,
    });
  } catch (err) { next(err); }
});

module.exports = router;
