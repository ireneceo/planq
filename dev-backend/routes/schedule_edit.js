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
  // (주말 보정은 연산이 이미 한다 — S.toBusinessDay. 개별 표기는 화면이 before/after 로 보여준다.)
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

      const body = req.body || {};
      const { prompt, include_closed: includeClosed } = body;
      let { op, params } = body;

      // 말로 온 것은 **규칙 기반**으로 읽는다(services/scheduleEdit.parseIntent).
      //   ★ LLM 을 쓰지 않는 이유: 이 해석의 결과가 곧 날짜를 바꾸는 명령이다. "2주" 를 14 로
      //     읽었는지 20 으로 읽었는지 사용자는 알 수 없고 매번 달라지는 것을 반증할 수도 없다.
      //     못 알아들으면 **추측하지 않고** `unparsed` 를 돌려준다 — 화면이 직접 입력으로 떨어뜨린다.
      if (!op && prompt) {
        const intent = S.parseIntent(prompt, dateOnlyOf(new Date()));
        if (!intent) return errorResponse(res, 'unparsed', 400);
        op = intent.op; params = intent.params;
      }

      const ctx = await loadTargets(project, { includeClosed: !!includeClosed });
      const plan = buildPlan(op, ctx.targets, params);
      if (plan.error) return errorResponse(res, plan.error, 400);

      const view = decorate(plan, ctx);
      // 무엇을 물어봤고 무엇을 제안했는지 남긴다(applied_at NULL = 아직 적용 안 됨).
      const batch = await ScheduleBatch.create({
        business_id: project.business_id, project_id: project.id, created_by: req.user.id,
        prompt: prompt ? String(prompt).slice(0, 2000) : null,
        // ★ include_closed 를 원장에 남긴다 — 적용 때 "완료 업무를 포함하기로 했었는가" 를 알아야 한다.
        //   여태 남기지 않아, 미리보기에서 완료 업무를 포함해도 적용은 전부 task_closed 로 실패했다(W3).
        op: String(op).slice(0, 30), params: { ...(params || {}), include_closed: !!includeClosed },
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

// ─── 적용·되돌리기 공통 ───
// ★ 2026-09-11 (Fable 게이트 경고 ②) — 안정 계약. 여태 apply 는 미리보기의 before 와 **지금 값을
//   대조하지 않고** after 로 덮었고, 전건 실패해도 applied_at 을 찍었다. 그러면
//     · 미리보기를 띄워 둔 사이 담당자가 고친 마감이 **소리 없이 되돌려진다**
//     · "적용됨" 원장이 거짓이 되고, 되돌리기는 **적용된 적 없는 업무까지** before 로 덮는다
//   그래서 아래 넷을 지킨다.
//     ① **한 번만 지나간다** — applied_at/reverted_at 을 조건부 UPDATE 로 먼저 **선점**한다.
//        두 요청이 동시에 와도 하나만 affectedRows 1 을 받는다.
//     ② **남이 바꾼 것은 덮지 않는다** — 업무별로 지금 값이 기대값(적용: before, 되돌리기: after)과
//        다르면 건너뛰고 이유를 돌려준다.
//     ③ **아무것도 안 바뀌었으면 적용이 아니다** — 선점을 풀고 409.
//     ④ **업무별 결과를 원장에 남긴다** (items[].result) — 되돌리기는 적용된 것만 본다.
//        결과가 없는 옛 원장(이 수정 전에 적용된 것)은 ②의 값 대조만으로 판정한다.
const rangeOf = (task) => ({ start_date: dateOnlyOf(task.start_date), due_date: dateOnlyOf(task.due_date) });
const sameRange = (a, b) => ((a && a.start_date) || null) === ((b && b.start_date) || null)
  && ((a && a.due_date) || null) === ((b && b.due_date) || null);

/**
 * 받는 사람당 **요약 1통.** 업무마다 보내면 수백 건 이동이 수백 통의 푸시가 된다(외부 발송 quota).
 * 대상 = 바뀐 업무의 담당자 + 의뢰자, 바꾼 본인 제외 — 업무 1건 변경(notifyScheduleChange)과 같은 집합.
 */
function notifyBatchAudience(project, actorUserId, tasks) {
  const byUser = new Map();
  for (const t of tasks) {
    for (const uid of [t.assignee_id, t.request_by_user_id || t.created_by]) {
      if (!uid || Number(uid) === Number(actorUserId)) continue;
      if (!byUser.has(uid)) byUser.set(uid, new Map());
      byUser.get(uid).set(t.id, t.title);
    }
  }
  if (!byUser.size) return;
  const { notify } = require('./notifications');
  for (const [userId, titlesById] of byUser) {
    const titles = [...titlesById.values()];
    const head = titles.slice(0, 3).map((x) => `"${x}"`).join(', ');
    notify({
      userId, businessId: project.business_id, eventKind: 'task', actorUserId,
      titleSpec: { feature: 'task', action: 'task_schedule_bulk_changed', subject: `"${project.name}"` },
      body: titles.length > 3 ? `${head} +${titles.length - 3}` : head,
      link: `/projects/p/${project.id}?tab=tasks`,
      entityType: 'project', entityId: project.id,
    }).catch((e) => console.warn('[schedule_edit notify]', e.message));
  }
}

// ─── POST /api/projects/:id/schedule/apply — 사람이 누른 뒤에만 ───
router.post('/:id/schedule/apply', authenticateToken,
  limit('schedule-apply', 10), async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);

      const batchId = Number((req.body || {}).batch_id);
      if (!Number.isInteger(batchId)) return errorResponse(res, 'batch_id_required', 400);
      const scope = { id: batchId, business_id: project.business_id, project_id: project.id };
      const batch = await ScheduleBatch.findOne({ where: scope });
      if (!batch) return errorResponse(res, 'batch_not_found', 404);
      if (batch.applied_at) return errorResponse(res, 'already_applied', 409);

      // ① 선점
      const [claimed] = await ScheduleBatch.update({ applied_at: new Date() }, { where: { ...scope, applied_at: null } });
      if (!claimed) return errorResponse(res, 'already_applied', 409);

      const actor = { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req };
      const outcome = new Map();     // task_id → { result, code?, current? }
      const appliedTasks = [];
      let crash = null;
      try {
        for (const item of (batch.items || [])) {
          const task = await Task.findOne({ where: { id: item.task_id, business_id: project.business_id, project_id: project.id } });
          if (!task) { outcome.set(item.task_id, { result: 'skipped', code: 'task_not_found' }); continue; }
          // ② 미리보기 뒤에 누가 바꿨으면 덮지 않는다
          const now = rangeOf(task);
          if (!sameRange(now, item.before)) {
            outcome.set(item.task_id, { result: 'skipped', code: 'changed_since_preview', current: now });
            continue;
          }
          // ★ 완료·취소 업무 규칙 (2026-09-11 Fable 게이트 W3) — **한 곳에 적는다.**
          //   · 사람이 업무 하나를 직접 고칠 때(routes/tasks.js PUT)는 완료 업무의 날짜도 바꿀 수 있다 —
          //     화면(TaskDetailDrawer canEditDates)이 그렇게 열려 있고, 실수한 날짜를 바로잡는 길이다.
          //   · 일괄 수정은 **기본 제외**다(지난 일정을 소급하면 걸린 시간 기록이 거짓이 된다).
          //     미리보기에서 include_closed 로 **명시적으로 포함한 경우에만** 적용한다.
          //   · 미리보기 뒤에 완료로 바뀐 업무는 포함하지 않았으므로 건너뛴다 — 실패가 아니라 상태 변화다.
          const includeClosed = !!(batch.params && batch.params.include_closed);
          if (!includeClosed && S.CLOSED.includes(task.status)) {
            outcome.set(item.task_id, { result: 'skipped', code: 'closed_since_preview' });
            continue;
          }
          // ★ 액션이 권한·경계를 다시 본다. 알림은 아래 요약 1통.
          const r = await taskActions.updateSchedule(task, actor, {
            start_date: item.after.start_date, due_date: item.after.due_date, notify: false, allowClosed: includeClosed,
          });
          if (r.ok) { outcome.set(item.task_id, { result: 'applied' }); appliedTasks.push(task); }
          else outcome.set(item.task_id, { result: 'failed', code: r.code });
        }
      } catch (err) { crash = err; }

      const ledger = (batch.items || []).map((it) => ({ ...it, ...(outcome.get(it.task_id) || {}) }));
      const notApplied = ledger.filter((it) => it.result && it.result !== 'applied')
        .map((it) => ({ task_id: it.task_id, result: it.result, code: it.code, current: it.current }));

      // ③ 아무것도 안 바뀌었으면 선점을 푼다 — 원장의 items 는 미리보기 그대로 둔다
      if (!appliedTasks.length) {
        await ScheduleBatch.update({ applied_at: null }, { where: scope });
        if (crash) throw crash;
        return errorResponse(res, 'nothing_applied', 409, { data: { batch_id: batch.id, applied: 0, not_applied: notApplied } });
      }

      // ④ 업무별 결과를 원장에 — 도중 예외여도 이미 바뀐 것은 되돌릴 수 있게 남긴다
      await ScheduleBatch.update({ items: ledger }, { where: scope });
      await writeAudit({
        user_id: req.user.id, business_id: project.business_id,
        action: 'project.schedule_apply', target_type: 'ScheduleBatch', target_id: batch.id,
        new_value: { op: batch.op, params: batch.params, applied: appliedTasks.length, not_applied: notApplied.length, crashed: !!crash },
      }).catch(() => null);
      notifyBatchAudience(project, req.user.id, appliedTasks);
      if (crash) throw crash;

      return successResponse(res, {
        batch_id: batch.id,
        applied: appliedTasks.length,
        skipped: notApplied.filter((x) => x.result === 'skipped'),
        failed: notApplied.filter((x) => x.result === 'failed'),
        items: appliedTasks.map((t) => ({ task_id: t.id })),
      });
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
      if (!Number.isInteger(batchId)) return errorResponse(res, 'batch_id_required', 400);
      const scope = { id: batchId, business_id: project.business_id, project_id: project.id };
      const batch = await ScheduleBatch.findOne({ where: scope });
      if (!batch) return errorResponse(res, 'batch_not_found', 404);
      if (!batch.applied_at) return errorResponse(res, 'not_applied', 400);
      if (batch.reverted_at) return errorResponse(res, 'already_reverted', 409);

      // ① 선점
      const [claimed] = await ScheduleBatch.update(
        { reverted_at: new Date(), reverted_by: req.user.id },
        { where: { ...scope, reverted_at: null, applied_at: { [Op.ne]: null } } },
      );
      if (!claimed) return errorResponse(res, 'already_reverted', 409);

      const actor = { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req };
      const revertedTasks = []; const notReverted = [];
      let crash = null;
      try {
        for (const item of (batch.items || [])) {
          // ④ 적용되지 않은 업무는 되돌릴 것이 없다 — 여기서 before 로 덮으면 남의 값을 지운다
          if (item.result && item.result !== 'applied') continue;
          const task = await Task.findOne({ where: { id: item.task_id, business_id: project.business_id, project_id: project.id } });
          if (!task) { notReverted.push({ task_id: item.task_id, result: 'skipped', code: 'task_not_found' }); continue; }
          const now = rangeOf(task);
          if (sameRange(now, item.before)) continue;   // 이미 원래 값 — 할 일 없음(옛 원장의 미적용 항목)
          // ② 적용 뒤에 누가 또 바꿨으면 덮지 않는다
          if (!sameRange(now, item.after)) {
            notReverted.push({ task_id: item.task_id, result: 'skipped', code: 'changed_since_apply', current: now });
            continue;
          }
          // ★ before 로 되돌린다. 완료된 업무도 — 적용 때 바꾼 것이므로 "지난 일정 소급" 이 아니라 **원상 복귀**다.
          const r = await taskActions.updateSchedule(task, actor, {
            start_date: item.before.start_date, due_date: item.before.due_date, allowClosed: true, notify: false,
          });
          if (r.ok) revertedTasks.push(task);
          else notReverted.push({ task_id: item.task_id, result: 'failed', code: r.code });
        }
      } catch (err) { crash = err; }

      // ③ 아무것도 안 되돌렸으면 선점을 푼다
      if (!revertedTasks.length) {
        await ScheduleBatch.update({ reverted_at: null, reverted_by: null }, { where: scope });
        if (crash) throw crash;
        return errorResponse(res, 'nothing_reverted', 409, { data: { batch_id: batch.id, reverted: 0, not_reverted: notReverted } });
      }

      await writeAudit({
        user_id: req.user.id, business_id: project.business_id,
        action: 'project.schedule_revert', target_type: 'ScheduleBatch', target_id: batch.id,
        new_value: { reverted: revertedTasks.length, not_reverted: notReverted.length, crashed: !!crash },
      }).catch(() => null);
      notifyBatchAudience(project, req.user.id, revertedTasks);
      if (crash) throw crash;

      return successResponse(res, {
        batch_id: batch.id,
        reverted: revertedTasks.length,
        skipped: notReverted.filter((x) => x.result === 'skipped'),
        failed: notReverted.filter((x) => x.result === 'failed'),
      });
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
