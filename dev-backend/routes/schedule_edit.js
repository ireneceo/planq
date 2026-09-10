// 일정 일괄 수정 — 미리보기 · 적용 · 되돌리기.
//
// Irene 2026-09-10: *"전체적으로 잡고 싶거나 변경해야 할 때 엄두가 안나. 특히 기간들."*
//
// ★ 이 라우트의 **핵심 계약 셋**
//   ① **미리보기는 절대 쓰지 않는다.** 사용자가 전후를 보고 누르기 전까지 DB 는 그대로다.
//      그래서 preview 는 `services/scheduleEdit.js` 의 순수 함수만 부르고 인스턴스를 만들지 않는다.
//   ② **적용은 행동 계층 한 문으로.** `task_actions.updateSchedule` 를 부른다 — 직접 UPDATE 하면
//      이력·알림·소켓이 이 경로에만 빠진다(그 파일 머리말이 기록한 사고).
//   ③ **되돌리기의 근거는 원장뿐이다.** `schedule_batches.items` 의 before 를 역으로 같은 액션에
//      태운다. 원장이 없으면 되돌릴 수 없고, 되돌릴 수 없으면 사용자는 이 기능을 안 쓴다.
//
// ★ 게이트는 형제 라우트와 **같은 함수**(services/projectAccess.loadProjectOrForbidden).
//   그리고 쓰기는 `role === 'client'` 를 따로 막는다 — 그 함수는 "들어올 수 있는가" 만 답한다.
//
// ★ `requireMenu` 를 쓰지 않는 이유: `routes/projects.js` 가 **0번** 쓴다. 그 미들웨어는
//   `business_id` 를 params/body/query 에서 찾는데 프로젝트 경로에는 그 값이 없고, 프로젝트를
//   불러와야 알 수 있다. 형제 라우트의 계약(프로젝트 게이트 + 역할 검사)을 그대로 따른다.
//   권한은 세 겹이다 — ①프로젝트 접근 ②client 차단 ③액션이 업무별로 다시 판정.
const express = require('express');

const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const { Task, ScheduleBatch, User } = require('../models');
const { loadProjectOrForbidden } = require('../services/projectAccess');
const { dateOnlyOf } = require('../utils/dateOnly');
const S = require('../services/scheduleEdit');
const taskActions = require('../services/actions/task_actions');
const { writeAudit } = require('../services/auditService');

// 외부 quota 는 없지만 **여러 건을 한 번에 바꾸는** 라우트라 per-user 제한을 건다
// (CLAUDE.md 운영 안정성 1 — 한 사람이 반복 호출로 원장을 채우지 못하게).
let perUserLimiter = null;
try { ({ perUserLimiter } = require('../middleware/costGuard')); } catch { /* 없으면 무제한 */ }
const limit = (name, max) => (perUserLimiter
  ? perUserLimiter(name, { windowMs: 60 * 1000, max })
  : (req, res, next) => next());

const MAX_TASKS = 500;   // 한 번에 다루는 상한 — 그 이상은 프로젝트를 쪼개야 한다

/** 이 프로젝트에서 일정 수정 대상이 되는 업무들. 완료·취소는 기본 제외. */
async function loadTargets(project, { includeClosed = false } = {}) {
  const rows = await Task.findAll({
    where: { project_id: project.id, business_id: project.business_id },
    attributes: ['id', 'title', 'status', 'start_date', 'due_date', 'workstream_id'],
    // tasks 에는 프로젝트 내 순서 컬럼이 없다 — 시작일(없으면 마감일)로 세운다.
    order: [['start_date', 'ASC'], ['due_date', 'ASC'], ['id', 'ASC']],
    limit: MAX_TASKS + 1,
  });
  const norm = rows.map((r) => ({
    id: r.id, title: r.title, status: r.status,
    start_date: dateOnlyOf(r.start_date),
    due_date: dateOnlyOf(r.due_date),
    workstream_id: r.workstream_id,
  }));
  return {
    all: norm,
    targets: norm.filter((t) => S.isEditable(t, { includeClosed })),
    overflow: rows.length > MAX_TASKS,
  };
}

/** 연산을 돌려 변경안을 만든다. **쓰지 않는다.** */
function buildPlan(op, targets, params) {
  if (op === 'shift') {
    const days = Number(params && params.days);
    if (!Number.isFinite(days) || days === 0) return { error: 'invalid_days' };
    const changes = [];
    for (const t of targets) {
      const p = S.shiftTask(t, days);
      if (!p) continue;
      if (p.start_date === t.start_date && p.due_date === t.due_date) continue;
      changes.push({ id: t.id, ...p });
    }
    return { changes };
  }
  if (op === 'compress') {
    const r = S.compressToTarget(targets, params && params.target_due);
    if (!r) return { error: 'invalid_target' };
    return { changes: r.changes, meta: { anchor: r.anchor, from: r.from, to: r.to, ratio: r.ratio } };
  }
  return { error: 'unknown_op' };
}

/** 변경안 + 경고를 화면이 그릴 모양으로. */
function decorate(plan, ctx) {
  const byId = new Map(ctx.all.map((t) => [t.id, t]));
  const items = plan.changes.map((c) => {
    const before = byId.get(c.id);
    return {
      task_id: c.id,
      title: before ? before.title : null,
      before: { start_date: before ? before.start_date : null, due_date: before ? before.due_date : null },
      after: { start_date: c.start_date ?? (before && before.start_date) ?? null, due_date: c.due_date ?? (before && before.due_date) ?? null },
    };
  });
  // 화면이 "왜 그렇게 됐는지" 를 말할 수 있어야 한다 — 경고를 숨기지 않는다.
  const warnings = [];
  const weekendAdjusted = items.filter((i) => {
    const raw = plan.changes.find((c) => c.id === i.task_id);
    return raw && raw.due_date && S.isWeekend(S._toUTC(raw.due_date)) === false
      && i.after.due_date !== i.before.due_date;
  });
  void weekendAdjusted;   // 개별 표기는 화면이 before/after 로 보여준다
  const closedSkipped = ctx.all.filter((t) => S.CLOSED.includes(t.status)).length;
  if (closedSkipped) warnings.push({ kind: 'closed_skipped', count: closedSkipped });
  const noDate = ctx.all.filter((t) => !t.start_date && !t.due_date && !S.CLOSED.includes(t.status)).length;
  if (noDate) warnings.push({ kind: 'no_date_skipped', count: noDate });
  if (ctx.overflow) warnings.push({ kind: 'too_many_tasks', limit: MAX_TASKS });

  // 순서 역전 — **고치지 않고 알린다.** 기준은 "원래 일정 순서의 보존".
  const breaks = S.detectOrderBreaks(items);
  if (breaks.length) warnings.push({ kind: 'order_break', tasks: breaks.slice(0, 10), count: breaks.length });

  return { items, warnings };
}

// ─── POST /api/projects/:id/schedule/preview — **쓰지 않는다** ───
router.post('/:id/schedule/preview', authenticateToken,
  limit('schedule-preview', 30), async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);

      const { op, params, prompt, include_closed: includeClosed } = req.body || {};
      const ctx = await loadTargets(project, { includeClosed: !!includeClosed });
      const plan = buildPlan(op, ctx.targets, params);
      if (plan.error) return errorResponse(res, plan.error, 400);

      const view = decorate(plan, ctx);
      // 무엇을 물어봤고 무엇을 제안했는지 남긴다(applied_at NULL = 아직 적용 안 됨).
      const batch = await ScheduleBatch.create({
        business_id: project.business_id, project_id: project.id, created_by: req.user.id,
        prompt: prompt ? String(prompt).slice(0, 2000) : null,
        op: String(op).slice(0, 30), params: params || null,
        items: view.items, warnings: view.warnings,
      });
      return successResponse(res, {
        batch_id: batch.id, op, params: params || null,
        meta: plan.meta || null,
        total_tasks: ctx.all.length, target_count: ctx.targets.length,
        ...view,
      });
    } catch (err) { next(err); }
  });

// ─── POST /api/projects/:id/schedule/apply — 사람이 누른 뒤에만 ───
router.post('/:id/schedule/apply', authenticateToken,
  limit('schedule-apply', 10), async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);

      const batchId = Number((req.body || {}).batch_id);
      if (!Number.isInteger(batchId)) return errorResponse(res, 'batch_id_required', 400);
      const batch = await ScheduleBatch.findOne({
        where: { id: batchId, business_id: project.business_id, project_id: project.id },
      });
      if (!batch) return errorResponse(res, 'batch_not_found', 404);
      if (batch.applied_at) return errorResponse(res, 'already_applied', 409);

      const actor = { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req };
      const applied = []; const failed = [];
      for (const item of (batch.items || [])) {
        const task = await Task.findOne({ where: { id: item.task_id, business_id: project.business_id, project_id: project.id } });
        if (!task) { failed.push({ task_id: item.task_id, code: 'task_not_found' }); continue; }
        // ★ 액션이 권한·경계를 다시 본다. 미리보기 시점과 지금 사이에 바뀌었을 수 있다.
        const r = await taskActions.updateSchedule(task, actor, {
          start_date: item.after.start_date, due_date: item.after.due_date,
        });
        if (r.ok) applied.push({ task_id: item.task_id, changed: r.data.changed });
        else failed.push({ task_id: item.task_id, code: r.code });
      }
      await batch.update({ applied_at: new Date() });
      await writeAudit({
        user_id: req.user.id, business_id: project.business_id,
        action: 'project.schedule_apply', target_type: 'ScheduleBatch', target_id: batch.id,
        new_value: { op: batch.op, params: batch.params, applied: applied.length, failed: failed.length },
      }).catch(() => null);

      return successResponse(res, { batch_id: batch.id, applied: applied.length, failed, items: applied });
    } catch (err) { next(err); }
  });

// ─── POST /api/projects/:id/schedule/revert — 한 번에 되돌린다 ───
router.post('/:id/schedule/revert', authenticateToken,
  limit('schedule-revert', 10), async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);

      const batchId = Number((req.body || {}).batch_id);
      const batch = await ScheduleBatch.findOne({
        where: { id: batchId, business_id: project.business_id, project_id: project.id },
      });
      if (!batch) return errorResponse(res, 'batch_not_found', 404);
      if (!batch.applied_at) return errorResponse(res, 'not_applied', 400);
      if (batch.reverted_at) return errorResponse(res, 'already_reverted', 409);

      const actor = { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req };
      const reverted = []; const failed = [];
      for (const item of (batch.items || [])) {
        const task = await Task.findOne({ where: { id: item.task_id, business_id: project.business_id, project_id: project.id } });
        if (!task) { failed.push({ task_id: item.task_id, code: 'task_not_found' }); continue; }
        // ★ before 를 그대로 되돌린다. 완료된 업무도 되돌린다 —
        //   적용 때 바꾼 것이므로 원복은 "지난 일정 소급" 이 아니라 **원상 복귀**다.
        const r = await taskActions.updateSchedule(task, actor, {
          start_date: item.before.start_date, due_date: item.before.due_date, allowClosed: true,
        });
        if (r.ok) reverted.push({ task_id: item.task_id }); else failed.push({ task_id: item.task_id, code: r.code });
      }
      await batch.update({ reverted_at: new Date(), reverted_by: req.user.id });
      await writeAudit({
        user_id: req.user.id, business_id: project.business_id,
        action: 'project.schedule_revert', target_type: 'ScheduleBatch', target_id: batch.id,
        new_value: { reverted: reverted.length, failed: failed.length },
      }).catch(() => null);

      return successResponse(res, { batch_id: batch.id, reverted: reverted.length, failed });
    } catch (err) { next(err); }
  });

// ─── GET /api/projects/:id/schedule/batches — 최근 수정 이력(되돌리기 대상 찾기) ───
router.get('/:id/schedule/batches', authenticateToken,
  async (req, res, next) => {
    try {
      const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      const rows = await ScheduleBatch.findAll({
        where: { business_id: project.business_id, project_id: project.id, applied_at: { [Op.ne]: null } },
        include: [{ model: User, as: 'creator', attributes: ['id', 'name'], required: false }],
        order: [['id', 'DESC']], limit: 20,
      });
      return successResponse(res, rows.map((b) => ({
        id: b.id, op: b.op, params: b.params, prompt: b.prompt,
        count: Array.isArray(b.items) ? b.items.length : 0,
        applied_at: b.applied_at, reverted_at: b.reverted_at,
        by: b.creator ? { id: b.creator.id, name: b.creator.name } : null,
        created_at: b.createdAt ?? b.created_at,
      })));
    } catch (err) { next(err); }
  });

module.exports = router;
