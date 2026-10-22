// routes/member_overview.js — 멤버 상세의 «연결 프로젝트 · 업무 · 히스토리» (2026-10-22 Fable 판정 5, docs/PEOPLE_PROFILE_UNIFY_DESIGN.md)
//
//   GET /api/businesses/:businessId/members/:userId/overview
//   Irene: *"멤버도 연결된 프로젝트랑 업무리스트, 히스토리가 보이게 해주고"*
//
//   ★ **보는 사람 기준**이다 — 대상 멤버가 볼 수 있는 것이 아니라, 지금 보는 사람이 볼 수 있는 것 중 대상과 연결된 것.
//     대상 기준으로 모으면 L1(나만 보기) 업무·숨은 프로젝트가 동료에게 샌다. 판정은 access_scope 한 곳:
//       프로젝트 = 대상이 참여(project_members) ∩ projectScopeWhere(보는 사람)
//       업무     = (대상이 담당 ∨ 작성 ∨ 요청) ∩ taskListWhere(보는 사람) — 둘 다 Op.and 안(최상위 키는 덮인다)
//       히스토리 = 그 업무에서 대상이 한 일(task_status_history.actor_user_id = 대상) 최근 50
//   ★ audit_logs 는 싣지 않는다 — owner/admin 의 활동 보기는 GET /api/activity/:biz?actor= 가 이미 있다(같은 값의 공식 두 벌 금지).
//   ★ 단가·급여·휴가·메일 없음. projects.visibility 를 직접 읽지 않는다.
//   ★ /api/businesses 접두어를 businesses.js 와 나눈다 — «/:businessId/members/:userId/overview» 꼬리만(server.js 에서 앞에 붙는다).
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { BusinessMember, Project, ProjectMember, Task, TaskStatusHistory } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination } = require('../middleware/errorHandler');
const { getUserScope, projectScopeWhere, taskListWhere } = require('../middleware/access_scope');

const ACTIVE = ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested', 'done_feedback'];
const TASK_ATTRS = ['id', 'title', 'status', 'due_date', 'project_id', 'assignee_id', 'created_by', 'request_by_user_id', 'completed_at', 'updated_at'];

router.get('/:businessId/members/:userId/overview', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    const targetId = Number(req.params.userId) || 0;
    const target = await BusinessMember.findOne({
      where: { business_id: bizId, user_id: targetId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
      attributes: ['user_id'],
    });
    if (!target) return errorResponse(res, 'not_found', 404);

    const scope = await getUserScope(req.user.id, bizId, req.user.platform_role);
    // checkBusinessAccess 는 고객도 통과시킬 수 있다 — 동료의 업무·프로젝트는 멤버 이상만
    if (!scope.isPlatformAdmin && !scope.isOwner && !scope.isAdmin && !scope.isMember) return errorResponse(res, 'forbidden', 403);

    // ① 프로젝트
    const pmRows = await ProjectMember.findAll({ where: { user_id: targetId }, attributes: ['project_id', 'role', 'is_pm'], raw: true });
    const pmMap = new Map(pmRows.map((r) => [Number(r.project_id), r]));
    let projects = [];
    if (pmMap.size) {
      const and = [{ id: { [Op.in]: [...pmMap.keys()] } }];
      const pw = projectScopeWhere(scope, 'id');
      if (pw) and.push(pw);
      const rows = await Project.findAll({
        where: { business_id: bizId, [Op.and]: and },
        attributes: ['id', 'name', 'status', 'color', 'start_date', 'end_date'],
        order: [['status', 'ASC'], ['id', 'DESC']],
        limit: 200,
      });
      projects = rows.map((p) => {
        const pm = pmMap.get(Number(p.id)) || {};
        return { id: p.id, name: p.name, status: p.status, color: p.color || null, start_date: p.start_date, end_date: p.end_date, role: pm.role || null, is_pm: !!pm.is_pm };
      });
    }

    // ② 업무 — 보는 사람 술어 안에서 대상과 연결된 것
    const viewWhere = await taskListWhere(req.user.id, bizId, scope);
    let active = []; let done = []; let counts = { active: 0, done: 0 };
    let taskIds = [];
    if (viewWhere) {
      const { limit } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
      const mine = { [Op.or]: [{ assignee_id: targetId }, { created_by: targetId }, { request_by_user_id: targetId }] };
      const base = { business_id: bizId, [Op.and]: [viewWhere, mine] };
      const projName = new Map(projects.map((p) => [Number(p.id), p.name]));
      const ser = (t) => ({
        id: t.id, title: t.title, status: t.status, due_date: t.due_date, project_id: t.project_id,
        project_name: t.project_id ? (projName.get(Number(t.project_id)) || null) : null,
        role: Number(t.assignee_id) === targetId ? 'assignee' : Number(t.request_by_user_id) === targetId ? 'requester' : 'creator',
        completed_at: t.completed_at, updated_at: t.updated_at,
      });
      const [a, d, ca, cd] = await Promise.all([
        Task.findAll({ where: { ...base, status: { [Op.in]: ACTIVE } }, attributes: TASK_ATTRS, order: [['due_date', 'ASC'], ['id', 'DESC']], limit }),
        Task.findAll({ where: { ...base, status: 'completed' }, attributes: TASK_ATTRS, order: [['completed_at', 'DESC'], ['id', 'DESC']], limit: 30 }),
        Task.count({ where: { ...base, status: { [Op.in]: ACTIVE } } }),
        Task.count({ where: { ...base, status: 'completed' } }),
      ]);
      // 프로젝트 이름 — 대상이 참여 안 한 프로젝트의 업무도 있다(보는 사람이 그 프로젝트를 볼 수 있을 때만 이름을 붙인다)
      const extraPids = [...new Set([...a, ...d].map((t) => Number(t.project_id)).filter((id) => id && !projName.has(id)))];
      if (extraPids.length) {
        const and = [{ id: { [Op.in]: extraPids } }];
        const pw = projectScopeWhere(scope, 'id');
        if (pw) and.push(pw);
        for (const p of await Project.findAll({ where: { business_id: bizId, [Op.and]: and }, attributes: ['id', 'name'] })) projName.set(Number(p.id), p.name);
      }
      active = a.map(ser); done = d.map(ser); counts = { active: ca, done: cd };
      taskIds = [...a, ...d].map((t) => t.id);
    }

    // ③ 히스토리 — 위 업무에서 대상이 한 일
    let history = [];
    if (taskIds.length) {
      const titles = new Map([...active, ...done].map((t) => [Number(t.id), t.title]));
      const rows = await TaskStatusHistory.findAll({
        where: { task_id: { [Op.in]: taskIds }, actor_user_id: targetId },
        attributes: ['id', 'task_id', 'event_type', 'from_status', 'to_status', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit: 50,
      });
      history = rows.map((h) => ({
        id: h.id, task_id: h.task_id, task_title: titles.get(Number(h.task_id)) || null,
        event_type: h.event_type, from_status: h.from_status, to_status: h.to_status, at: h.created_at,
      }));
    }

    res.set('Cache-Control', 'no-store');
    return successResponse(res, { projects, tasks: { active, done, counts }, history });
  } catch (e) { next(e); }
});

module.exports = router;
