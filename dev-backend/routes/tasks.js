const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const { Task, User, Project, BusinessMember, Business, TaskComment, TaskDailyProgress } = require('../models');
const taskSnapshot = require('../services/task_snapshot');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// ─── 헬퍼: 주의 월요일 계산 ───
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function fridayOf(mondayStr) {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + 4);
  return d.toISOString().slice(0, 10);
}

// ─── 헬퍼: 멤버 가용시간 조회 ───
async function getMemberCapacity(userId, businessId) {
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (!bm) return { daily: 8, days: 5, rate: 1, weekly: 40 };
  const daily = Number(bm.daily_work_hours) || 8;
  const days = bm.weekly_work_days || 5;
  const rate = Number(bm.participation_rate) || 1;
  return { daily, days, rate, weekly: Math.round(daily * days * rate * 10) / 10 };
}

// ============================================
// GET /api/tasks/my-week — 이번 주 내 업무 + 가용시간 + 번다운
// ?week=2026-W16  (ISO week, 없으면 이번 주)
// ============================================
router.get('/my-week', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const businessId = req.user.active_business_id || req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    // 주 시작일 계산
    let monday;
    if (req.query.week) {
      // ISO week: 2026-W16
      const [y, w] = req.query.week.split('-W').map(Number);
      const jan1 = new Date(y, 0, 1);
      const days = (w - 1) * 7;
      jan1.setDate(jan1.getDate() + days - ((jan1.getDay() + 6) % 7));
      monday = jan1.toISOString().slice(0, 10);
    } else {
      monday = mondayOf(new Date());
    }
    const friday = fridayOf(monday);

    // 이번 주 업무 (assignee = 나, planned_week_start = 이번 주 OR due_date가 이번 주)
    const tasks = await Task.findAll({
      where: {
        business_id: businessId,
        assignee_id: userId,
        [Op.or]: [
          { planned_week_start: monday },
          { due_date: { [Op.between]: [monday, friday] } },
        ],
      },
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
      ],
      order: [['due_date', 'ASC'], ['priority_order', 'ASC'], ['created_at', 'ASC']],
    });

    // 가용시간
    const capacity = await getMemberCapacity(userId, businessId);

    // 번다운 데이터 (일별 예측 vs 실제 누적)
    const burndown = [];
    let estCum = 0, actCum = 0;
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i];

      // 이 날까지 완료된 업무의 시간 합산
      const completedByDay = tasks.filter(t =>
        t.status === 'completed' && t.completed_at && new Date(t.completed_at).toISOString().slice(0, 10) <= dateStr
      );
      const estDay = completedByDay.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
      const actDay = completedByDay.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0);
      estCum += estDay;
      actCum += actDay;

      burndown.push({ date: dateStr, label: dayLabel, estimated_cumulative: estCum, actual_cumulative: actCum });
    }

    // 집계
    const totalEstimated = tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
    const totalActual = tasks.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0);
    const totalRemaining = tasks.reduce((s, t) => {
      const est = Number(t.estimated_hours) || 0;
      const prog = (t.progress_percent || 0) / 100;
      return s + est * (1 - prog);
    }, 0);

    return successResponse(res, {
      week: monday,
      capacity,
      summary: {
        total_tasks: tasks.length,
        total_estimated: Math.round(totalEstimated * 10) / 10,
        total_actual: Math.round(totalActual * 10) / 10,
        total_remaining: Math.round(totalRemaining * 10) / 10,
      },
      burndown,
      tasks: tasks.map(t => t.toJSON()),
    });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/my-month — 이번 달 주간별 집계
// ?month=2026-04&business_id=6
// ============================================
router.get('/my-month', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const businessId = req.user.active_business_id || req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);

    const tasks = await Task.findAll({
      where: {
        business_id: businessId,
        assignee_id: userId,
        [Op.or]: [
          { planned_week_start: { [Op.between]: [firstDay.toISOString().slice(0, 10), lastDay.toISOString().slice(0, 10)] } },
          { due_date: { [Op.between]: [firstDay.toISOString().slice(0, 10), lastDay.toISOString().slice(0, 10)] } },
        ],
      },
      include: [{ model: Project, attributes: ['id', 'name'], required: false }],
      order: [['due_date', 'ASC']],
    });

    // 주간별 집계
    const weeks = [];
    let d = new Date(firstDay);
    while (d <= lastDay) {
      const wMonday = mondayOf(d);
      const wFriday = fridayOf(wMonday);
      const weekTasks = tasks.filter(t => {
        const pw = t.planned_week_start;
        const dd = t.due_date;
        return (pw && pw >= wMonday && pw <= wFriday) || (dd && dd >= wMonday && dd <= wFriday);
      });
      weeks.push({
        week_start: wMonday,
        estimated: Math.round(weekTasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0) * 10) / 10,
        actual: Math.round(weekTasks.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0) * 10) / 10,
        task_count: weekTasks.length,
      });
      d = new Date(wMonday);
      d.setDate(d.getDate() + 7);
    }

    const capacity = await getMemberCapacity(userId, businessId);

    return successResponse(res, {
      month,
      capacity,
      weeks,
      tasks: tasks.map(t => t.toJSON()),
    });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/my-year — 올해 월별 집계
// ?year=2026&business_id=6
// ============================================
router.get('/my-year', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const businessId = req.user.active_business_id || req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const year = Number(req.query.year) || new Date().getFullYear();
    const tasks = await Task.findAll({
      where: {
        business_id: businessId,
        assignee_id: userId,
        [Op.or]: [
          { planned_week_start: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } },
          { due_date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } },
        ],
      },
    });

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const mStr = `${year}-${String(m).padStart(2, '0')}`;
      const monthTasks = tasks.filter(t => {
        const pw = t.planned_week_start;
        const dd = t.due_date;
        return (pw && pw.startsWith(mStr)) || (dd && dd.startsWith(mStr));
      });
      months.push({
        month: mStr,
        estimated: Math.round(monthTasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0) * 10) / 10,
        actual: Math.round(monthTasks.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0) * 10) / 10,
        task_count: monthTasks.length,
      });
    }

    return successResponse(res, { year, months });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/backlog — 미배정 업무 (planned_week_start = null)
// ?business_id=6
// ============================================
router.get('/backlog', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.user.active_business_id || req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
    const where = {
      business_id: businessId,
      planned_week_start: null,
      status: { [Op.notIn]: ['completed', 'canceled'] },
    };
    // member는 자기 업무 + 미배정만
    if (bm && bm.role !== 'owner') {
      where[Op.or] = [{ assignee_id: req.user.id }, { assignee_id: null }];
    }

    const tasks = await Task.findAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
      ],
      order: [['priority_order', 'ASC'], ['created_at', 'DESC']],
    });

    return successResponse(res, tasks.map(t => t.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// PATCH /api/tasks/:id/time — 예측/실제시간/진행율 업데이트 (AutoSave)
// ============================================
router.patch('/:id/time', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);

    // 권한: 담당자 또는 업무 생성자 또는 워크스페이스 owner
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: task.business_id } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    if (bm.role !== 'owner' && task.assignee_id !== req.user.id && task.created_by !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }

    const updates = {};
    if (req.body.estimated_hours !== undefined) updates.estimated_hours = Number(req.body.estimated_hours) || 0;
    if (req.body.actual_hours !== undefined) updates.actual_hours = Number(req.body.actual_hours) || 0;
    if (req.body.progress_percent !== undefined) updates.progress_percent = Math.max(0, Math.min(100, Number(req.body.progress_percent) || 0));
    if (req.body.planned_week_start !== undefined) updates.planned_week_start = req.body.planned_week_start || null;
    if (req.body.priority_order !== undefined) updates.priority_order = req.body.priority_order;

    // 진행율 100% → 자동 완료 / 100% 미만으로 줄이면 완료 해제
    if (updates.progress_percent === 100 && task.status !== 'completed') {
      updates.status = 'completed';
      updates.completed_at = new Date();
    } else if (updates.progress_percent !== undefined && updates.progress_percent < 100 && task.status === 'completed') {
      updates.status = 'in_progress';
      updates.completed_at = null;
    }

    await task.update(updates);
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks — 업무 생성 (Q Talk 메시지→할일 포함)
// ============================================
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, title, description, assignee_id, due_date, priority,
      estimated_hours, category, source_message_id, conversation_id, planned_week_start } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!title || !String(title).trim()) return errorResponse(res, 'title required', 400);

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id } });
    if (!bm) return errorResponse(res, 'forbidden', 403);

    const task = await Task.create({
      business_id,
      project_id: project_id || null,
      title: String(title).trim(),
      description: description || null,
      assignee_id: assignee_id || req.user.id,
      due_date: due_date || null,
      estimated_hours: estimated_hours || null,
      category: category || null,
      source_message_id: source_message_id || null,
      conversation_id: conversation_id || null,
      planned_week_start: planned_week_start || null,
      created_by: req.user.id,
    });

    const full = await Task.findByPk(task.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
      ],
    });

    // Socket.IO
    const io = req.app.get('io');
    if (io && project_id) {
      io.to(`project:${project_id}`).emit('task:new', full.toJSON());
    }

    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// 기존 호환: GET /by-business/:businessId — 업무 목록
// ============================================
router.get('/by-business/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
    if (!bm) return errorResponse(res, 'forbidden', 403);

    const where = { business_id: businessId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.assignee_id) where.assignee_id = Number(req.query.assignee_id);

    const tasks = await Task.findAll({
      where,
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: Project, attributes: ['id', 'name'], required: false },
      ],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, tasks.map(t => t.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// PUT /:businessId/:id — 업무 수정
// ============================================
router.put('/by-business/:businessId/:id', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!task) return errorResponse(res, 'task_not_found', 404);

    const { title, description, assignee_id, status, priority, due_date, estimated_hours, actual_hours, progress_percent, category, planned_week_start } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (assignee_id !== undefined) updates.assignee_id = assignee_id;
    if (status !== undefined) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours;
    if (actual_hours !== undefined) updates.actual_hours = actual_hours;
    if (progress_percent !== undefined) updates.progress_percent = progress_percent;
    if (category !== undefined) updates.category = category;
    if (planned_week_start !== undefined) updates.planned_week_start = planned_week_start;

    if (status === 'completed' && task.status !== 'completed') updates.completed_at = new Date();

    await task.update(updates);
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// DELETE /:businessId/:id — 업무 삭제
// ============================================
router.delete('/by-business/:businessId/:id', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!task) return errorResponse(res, 'task_not_found', 404);
    await task.destroy();
    return successResponse(res, { id: Number(req.params.id), deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/:id/detail — 업무 상세 (댓글 포함)
// ============================================
router.get('/:id/detail', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: TaskComment, as: 'comments', include: [{ model: User, as: 'author', attributes: ['id', 'name'] }], required: false },
        { model: TaskDailyProgress, as: 'daily_progress', required: false },
      ],
      order: [
        [{ model: TaskComment, as: 'comments' }, 'createdAt', 'ASC'],
        [{ model: TaskDailyProgress, as: 'daily_progress' }, 'snapshot_date', 'ASC'],
      ],
    });
    if (!task) return errorResponse(res, 'task_not_found', 404);
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks/:id/comments — 댓글 추가
// ============================================
router.post('/:id/comments', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: task.business_id } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    const { content } = req.body || {};
    if (!content || !String(content).trim()) return errorResponse(res, 'content_required', 400);
    const comment = await TaskComment.create({
      task_id: task.id,
      user_id: req.user.id,
      content: String(content).trim(),
    });
    const full = await TaskComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    });
    // Socket.IO
    const io = req.app.get('io');
    if (io) io.to(`task:${task.id}`).emit('comment:new', full.toJSON());
    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/requested-comments — 내가 요청한 업무들의 최신 댓글
// ============================================
router.get('/requested-comments', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    // 내가 만든 업무 (assignee != me)
    const myRequested = await Task.findAll({
      where: { business_id: businessId, created_by: req.user.id, assignee_id: { [Op.ne]: req.user.id } },
      attributes: ['id', 'title'],
    });
    const taskIds = myRequested.map(t => t.id);
    if (taskIds.length === 0) return successResponse(res, []);
    const comments = await TaskComment.findAll({
      where: { task_id: taskIds },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name'] },
        { model: Task, attributes: ['id', 'title'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    return successResponse(res, comments.map(c => c.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/extracted-candidates — 전체업무 탭용: Q Talk 추출 후보
// ============================================
router.get('/extracted-candidates', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id;
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    const { TaskCandidate, Project: ProjectModel } = require('../models');
    const projs = await ProjectModel.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] });
    const projIds = projs.map(p => p.id);
    const projMap = new Map(projs.map(p => [p.id, p.name]));
    if (projIds.length === 0) return successResponse(res, []);
    const cands = await TaskCandidate.findAll({
      where: { project_id: projIds, status: 'pending' },
      include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'], required: false }],
      order: [['extracted_at', 'DESC']],
      limit: 20,
    });
    return successResponse(res, cands.map(c => ({ ...c.toJSON(), project_name: projMap.get(c.project_id) })));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/daily-progress — 기간 내 일별 스냅샷
// ?business_id=6&from=2026-04-13&to=2026-04-19
// ============================================
router.get('/daily-progress', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const from = req.query.from, to = req.query.to;
    if (!businessId || !from || !to) return errorResponse(res, 'business_id/from/to required', 400);

    const myTasks = await Task.findAll({
      where: { business_id: businessId, assignee_id: req.user.id },
      attributes: ['id'],
    });
    const ids = myTasks.map(t => t.id);
    if (ids.length === 0) return successResponse(res, { days: [] });

    const snaps = await TaskDailyProgress.findAll({
      where: { task_id: ids, snapshot_date: { [require('sequelize').Op.between]: [from, to] } },
      attributes: ['task_id', 'snapshot_date', 'progress_percent', 'actual_hours', 'estimated_hours'],
      order: [['snapshot_date', 'ASC']],
    });

    // 일별 집계 — est_used = estimated × progress%, act_used = actual × progress%
    const byDate = new Map();
    for (const s of snaps) {
      const d = s.snapshot_date;
      if (!byDate.has(d)) byDate.set(d, { date: d, est_used: 0, act_used: 0 });
      const bucket = byDate.get(d);
      const prog = (s.progress_percent || 0) / 100;
      const est = Number(s.estimated_hours) || 0;
      const act = Number(s.actual_hours) || 0;
      bucket.est_used += est * prog;
      bucket.act_used += act * prog;
    }

    return successResponse(res, { days: Array.from(byDate.values()) });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks/snapshot — 수동 스냅샷 트리거 (테스트/관리자용)
// ============================================
router.post('/snapshot', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'admin_only', 403);
    }
    const result = req.body?.backfill_from && req.body?.backfill_to
      ? await taskSnapshot.backfillPeriod(req.body.backfill_from, req.body.backfill_to)
      : await taskSnapshot.snapshotAllTasks();
    return successResponse(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
