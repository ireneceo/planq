const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const { Task, User, Project, BusinessMember, Business, TaskComment, TaskDailyProgress, TaskStatusHistory, TaskReviewer, TaskLink, Client, ProjectClient, AuditLog } = require('../models');
const taskSnapshot = require('../services/task_snapshot');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, taskListWhere, canAccessTask, isMemberOrAbove, assertAssignable, assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { todayInTz, mondayOfDateStr, addDaysStr, mondayOfIsoWeek } = require('../utils/datetime');
// N+34 — 워크스페이스 표시명 helper. BusinessMember.name 우선, User.name fallback.
// 사용자 호소: "담당자 이름이 워크스페이스 프로필 이름이 아니야" — User.name 직접 사용 회귀 fix.
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');
// §8.5 — 고객용 task 직렬화 (공수 시간·예측 출처·내부 메타·internal 댓글 차단)
const { serializeTaskForClient, serializeTasksForClient } = require('../utils/taskClientView');

// 업무의 "오늘/이번 주/마감 지연" 경계는 워크스페이스 타임존 기준.
// 아래 헬퍼는 Asia/Seoul 워크스페이스에서 00:00~23:59 이 하루의 경계가 되도록 보장한다.
async function getWorkspaceTz(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  return biz?.timezone || 'Asia/Seoul';
}

function fridayOf(mondayStr) {
  return addDaysStr(mondayStr, 4);
}

// N+63 — task 변경 socket broadcast helper. CLAUDE.md §16 (b) 박제 정합.
// 호출자가 io.to(...).emit('task:new'|'task:updated'|'task:deleted', payload) 마치고 inbox 동기화도 같이 보장.
// 사용자 호소 "확인 다 했는데 안 없어져" — inbox count hook 이 'inbox:refresh' 만 listen 하기 때문에 task 변경 broadcast 가 task:* event 만 emit 하면 누락.
function broadcastInboxRefresh(io, businessId, projectId, reason, taskId) {
  if (!io || !businessId) return;
  const payload = { reason, task_id: taskId };
  io.to(`business:${businessId}`).emit('inbox:refresh', payload);
  if (projectId) io.to(`project:${projectId}`).emit('inbox:refresh', payload);
}

// ─── 헬퍼: 멤버 가용시간 조회 ───
async function getMemberCapacity(userId, businessId) {
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (!bm) return { daily: 8, days: 5, rate: 1, holidays: 0, weekly: 40 };
  const daily = Number(bm.daily_work_hours) || 8;
  const days = bm.weekly_work_days || 5;
  const rate = Number(bm.participation_rate) || 1;
  const holidays = Number(bm.weekly_holidays) || 0;  // 운영 #50
  return { daily, days, rate, holidays, weekly: Math.round(daily * days * rate * 10) / 10 };
}

// ─── 헬퍼: business 접근 권한 확인 (platform_admin/owner/member/client 통과) ───
//  PERMISSION_MATRIX §5/§7 — client 도 자기 task 조회/댓글 가능해야 하므로 통과시킨다.
//  쓰기는 라우트별로 추가 가드 (member only).
async function assertBusinessAccess(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const scope = await getUserScope(userId, businessId, platformRole);
  // isAdmin(워크스페이스 admin, N+21) 포함 — 옛 코드는 누락되어 admin 이 tasks 라우트 전체 403 이었음.
  return scope.isOwner || scope.isMember || scope.isAdmin || scope.isClient;
}

// ============================================
// GET /api/tasks/my-week — 이번 주 내 업무 + 가용시간 + 번다운
// ?week=2026-W16  (ISO week, 없으면 이번 주)
// ============================================
router.get('/my-week', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const businessId = Number(req.user.active_business_id || req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(userId, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    // 주 시작일 계산 — 워크스페이스 타임존 기준 "오늘"
    const tz = await getWorkspaceTz(businessId);
    let monday;
    if (req.query.week) {
      monday = mondayOfIsoWeek(req.query.week);
    } else {
      monday = mondayOfDateStr(todayInTz(tz));
    }
    const friday = fridayOf(monday);
    const sunday = addDaysStr(monday, 6);

    // "이번 주 나의 업무" canonical 규칙 (docs/WORK_FLOW_DESIGN.md §5) — 프론트 week 필터와 동일.
    //  - completed/canceled: completed_at 이 이번 주 (완료시점 기준)
    //  - not_started: 이번 주 계획(planned_week_start) 또는 이번 주 마감(due) 일 때만 (옛 backlog 제외)
    //  - in_progress/reviewing/revision_requested/waiting: 날짜 무관 전부 (착수한 업무는 끝까지 책임)
    const tasks = await Task.findAll({
      where: {
        business_id: businessId,
        assignee_id: userId,
        [Op.or]: [
          {
            status: { [Op.in]: ['completed', 'canceled'] },
            completed_at: { [Op.between]: [`${monday} 00:00:00`, `${sunday} 23:59:59`] },
          },
          {
            status: 'not_started',
            [Op.or]: [
              { planned_week_start: monday },
              { due_date: { [Op.between]: [monday, sunday] } },
            ],
          },
          { status: { [Op.in]: ['in_progress', 'reviewing', 'revision_requested', 'waiting'] } },
        ],
      },
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
      order: [['due_date', 'ASC'], ['priority_order', 'ASC'], ['created_at', 'ASC']],
    });

    // 가용시간
    const capacity = await getMemberCapacity(userId, businessId);

    // 번다운 데이터 (일별 예측 vs 실제 누적) — 워크스페이스 tz 기준 날짜
    const { dateStrInTz } = require('../utils/datetime');
    const burndown = [];
    let estCum = 0, actCum = 0;
    for (let i = 0; i < 5; i++) {
      const dateStr = addDaysStr(monday, i);
      const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i];

      // 이 날까지 완료된 업무의 시간 합산 — completed_at 은 UTC, 워크스페이스 tz 날짜로 변환
      const completedByDay = tasks.filter(t =>
        t.status === 'completed' && t.completed_at && dateStrInTz(t.completed_at, tz) <= dateStr
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

    const tasksJson = tasks.map(t => t.toJSON());
    await applyMemberDisplayName(tasksJson, businessId, ['assignee']);
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
      tasks: tasksJson,
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
    const businessId = Number(req.user.active_business_id || req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(userId, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const tz = await getWorkspaceTz(businessId);
    const month = req.query.month || todayInTz(tz).slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const firstDayStr = `${y}-${String(m).padStart(2, '0')}-01`;
    // 다음 달 1일 - 1일 = 월말
    const nextMonthFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDayStr = addDaysStr(nextMonthFirst, -1);

    const tasks = await Task.findAll({
      where: {
        business_id: businessId,
        assignee_id: userId,
        [Op.or]: [
          { planned_week_start: { [Op.between]: [firstDayStr, lastDayStr] } },
          { due_date: { [Op.between]: [firstDayStr, lastDayStr] } },
        ],
      },
      include: [{ model: Project, attributes: ['id', 'name'], required: false }],
      order: [['due_date', 'ASC']],
    });

    // 주간별 집계
    const weeks = [];
    let cursor = firstDayStr;
    while (cursor <= lastDayStr) {
      const wMonday = mondayOfDateStr(cursor);
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
      cursor = addDaysStr(wMonday, 7);
    }

    const capacity = await getMemberCapacity(userId, businessId);

    const tasksJson = tasks.map(t => t.toJSON());
    await applyMemberDisplayName(tasksJson, businessId, ['assignee']);
    return successResponse(res, {
      month,
      capacity,
      weeks,
      tasks: tasksJson,
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
    const businessId = Number(req.user.active_business_id || req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(userId, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const tz = await getWorkspaceTz(businessId);
    const year = Number(req.query.year) || Number(todayInTz(tz).slice(0, 4));
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
        const pw = t.planned_week_start ? String(t.planned_week_start).slice(0, 10) : null;
        const dd = t.due_date ? String(t.due_date).slice(0, 10) : null;
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
    const businessId = Number(req.user.active_business_id || req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    // backlog (미배정 업무) 는 member 이상만 — client 는 본인 task 만 봄
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden', 403);
    }
    const where = {
      business_id: businessId,
      planned_week_start: null,
      status: { [Op.notIn]: ['completed', 'canceled'] },
    };
    // member는 자기 업무 + 미배정만
    if (bm && bm.role !== 'owner') {
      where[Op.or] = [{ assignee_id: req.user.id }, { assignee_id: null }];
    }

    // 사이클 N+50 — pagination. backlog 누적 가능 — default 200 / max 500
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await Task.findAndCountAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
      order: [['priority_order', 'ASC'], ['created_at', 'DESC']],
      limit, offset,
      distinct: true,
    });

    const tasksJson = rows.map(t => t.toJSON());
    await applyMemberDisplayName(tasksJson, businessId, ['assignee']);
    return paginatedResponse(res, tasksJson, count, { limit, page, offset });
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

    // 시간/진행율은 담당자만 수정 가능 (priority_order/planned_week_start 는 누구나)
    const isAssignee = task.assignee_id === req.user.id;
    const wantsHourFields = req.body.estimated_hours !== undefined
      || req.body.actual_hours !== undefined
      || req.body.progress_percent !== undefined;
    if (wantsHourFields && !isAssignee && bm.role !== 'owner') {
      return errorResponse(res, 'only_assignee_can_edit_hours', 403);
    }

    const updates = {};
    if (req.body.estimated_hours !== undefined) updates.estimated_hours = Number(req.body.estimated_hours) || 0;
    if (req.body.actual_hours !== undefined) {
      updates.actual_hours = Number(req.body.actual_hours) || 0;
      // 사용자 직접 입력 → 자동 누적 정지 (회색 → 검정 톤 전환)
      updates.actual_source = 'user';
    }
    if (req.body.progress_percent !== undefined) updates.progress_percent = Math.max(0, Math.min(100, Number(req.body.progress_percent) || 0));
    if (req.body.planned_week_start !== undefined) updates.planned_week_start = req.body.planned_week_start || null;
    if (req.body.priority_order !== undefined) updates.priority_order = req.body.priority_order;

    // 진행율 100% ↔ status 자동 전환 (사이클 N+6)
    // reviewer 분기:
    //   - reviewer 0명 (1인 task) → 100% = 자동 completed
    //   - reviewer ≥ 1명 (컨펌 필요) → 100% 입력해도 자동 completed 차단. status in_progress 유지.
    //     사용자가 명시적으로 "확인 요청 보내기" 버튼 클릭 → submit-review → reviewing 으로 전환
    //   - 100% 미만으로 줄이면 completed 해제 (양쪽 공통)
    if (updates.progress_percent === 100 && task.status !== 'completed') {
      const { TaskReviewer } = require('../models');
      const revCount = await TaskReviewer.count({ where: { task_id: task.id } });
      if (revCount === 0) {
        updates.status = 'completed';
        updates.completed_at = new Date();
      }
      // reviewer 있으면 status 변경 X (in_progress 유지) — 사용자가 명시 컨펌 요청 보내야 함
    } else if (updates.progress_percent !== undefined && updates.progress_percent < 100 && task.status === 'completed') {
      updates.status = 'in_progress';
      updates.completed_at = null;
    }

    // 사용자 명시 입력 값 — update 전에 캡쳐 (이전값과 다를 때만 이력 기록)
    const prevEst = Number(task.estimated_hours) || 0;
    await task.update(updates);
    if (req.body.estimated_hours !== undefined && updates.estimated_hours !== prevEst) {
      try {
        const { recordUserEstimate } = require('./task_estimations');
        await recordUserEstimate(task.id, updates.estimated_hours, req.user.id);
      } catch { /* ignore */ }
    }
    // 실시간 — 시간/진행률/자동 status 전환이 다른 화면(리스트·드로어·다른 사용자)에 즉시 반영 (운영 #19 #11)
    const io = req.app.get('io');
    if (io) {
      const payload = task.toJSON();
      payload.actor_user_id = req.user.id;
      if (task.project_id) io.to(`project:${task.project_id}`).emit('task:updated', payload);
      io.to(`business:${task.business_id}`).emit('task:updated', payload);
      broadcastInboxRefresh(io, task.business_id, task.project_id, 'task_time_updated', task.id);
    }
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks — 업무 생성 (Q Talk 메시지→할일 포함)
// ============================================
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, title, description, assignee_id, due_date, priority,
      estimated_hours, category, source_message_id, conversation_id, planned_week_start, start_date,
      cue_kind, cue_context_ref, recurrence_rule } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!title || !String(title).trim()) return errorResponse(res, 'title required', 400);

    // 워크스페이스 접근권 확인 — 멤버(owner/member) OR 클라이언트
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id } });
    let isClient = false;
    if (!bm) {
      const cl = await Client.findOne({ where: { user_id: req.user.id, business_id } });
      if (!cl) return errorResponse(res, 'forbidden', 403);
      isClient = true;
    }

    // source / request_by 자동 판정:
    //   담당자 ≠ 생성자 → 내부 요청 (생성자가 요청자)
    //   담당자 = 생성자 → 본인 수동 업무
    const finalAssignee = assignee_id || req.user.id;
    const isInternalRequest = finalAssignee !== req.user.id;

    // 클라이언트(고객): 자기 자신에게 업무 생성 금지 — '요청 추가' (멤버에게 요청) 만 허용
    if (isClient && !isInternalRequest) {
      return errorResponse(res, 'Clients can only request tasks to members, not assign to themselves.', 403);
    }

    // D2-b (#66) — 담당자 배정 게이트 (보안민감). 본인 외 다른 사람을 담당자로 지정할 때만 검증.
    //   멤버=전체 / 외부 파트너=그 프로젝트 참여자만 / 그 외 user_id=차단(타 워크스페이스·유령).
    if (finalAssignee !== req.user.id) {
      const chk = await assertAssignable(finalAssignee, business_id, project_id || null);
      if (!chk.ok) return errorResponse(res, `cannot_assign:${chk.reason}`, 403);
    }

    // 사이클 N+19 — PERMISSION_MATRIX §5.7 정렬:
    // 요청 케이스 (담당자 ≠ 작성자) 에서는 예측시간/반복설정 작성 권한 없음.
    // 담당자가 ack 후 본인 캐파에 맞춰 정한다. 조용히 무시 (사용자 friction ↓).
    const effectiveEstimatedHours = isInternalRequest ? null : (estimated_hours || null);
    const effectiveRecurrenceRule = isInternalRequest ? null : (recurrence_rule || null);
    if (isInternalRequest && (estimated_hours || recurrence_rule)) {
      console.warn('[tasks.POST] requester=' + req.user.id + ' assignee=' + finalAssignee + ' — estimated_hours/recurrence_rule sanitized (책임선 분리)');
    }

    // 정기업무 — recurrence_rule 들어오면 due_date 필수, RRULE 검증, next_occurrence_at 계산
    let nextOccurrenceAt = null;
    if (effectiveRecurrenceRule) {
      if (!due_date) {
        return errorResponse(res, 'due_date is required for recurring tasks (it serves as the first occurrence)', 400);
      }
      const { RRule } = require('rrule');
      const { computeNextOccurrence } = require('../services/recurringTaskGenerator');
      try {
        RRule.parseString(effectiveRecurrenceRule);
      } catch (e) {
        return errorResponse(res, `Invalid recurrence_rule: ${e.message}`, 400);
      }
      // parent 자체가 첫 occurrence (count=1) → 다음 occurrence 계산
      const next = computeNextOccurrence(effectiveRecurrenceRule, due_date, 1);
      nextOccurrenceAt = next ? next.toISOString().slice(0, 10) : null;
    }

    const task = await Task.create({
      business_id,
      project_id: project_id || null,
      title: String(title).trim(),
      description: description || null,
      assignee_id: finalAssignee,
      due_date: due_date || null,
      start_date: start_date || null,
      estimated_hours: effectiveEstimatedHours,
      category: category || null,
      source_message_id: source_message_id || null,
      conversation_id: conversation_id || null,
      planned_week_start: planned_week_start || null,
      created_by: req.user.id,
      source: isInternalRequest ? 'internal_request' : 'manual',
      request_by_user_id: isInternalRequest ? req.user.id : null,
      // 사이클 P8 — Cue 팀원화
      cue_kind: cue_kind || null,
      cue_context_ref: cue_context_ref || null,
      // 정기업무 — parent 시리즈 (instance 는 cron 이 자동 생성)
      recurrence_rule: effectiveRecurrenceRule,
      recurrence_parent_id: null,
      next_occurrence_at: nextOccurrenceAt,
    });

    // 요청업무(internal_request) — 요청자를 컨펌자(reviewer)로 자동 등록 → 컨펌 필수화.
    // 담당자가 곧장 '완료' 하지 못하고 '확인요청'(submit-review) → 요청자 승인 흐름 강제.
    // (책임선 = 권한선: 요청자=발주자가 결과물 컨펌 권한을 가짐. memory feedback_responsibility_line)
    // 담당자===요청자(자기 자신에게 요청)면 컨펌 불필요 → 스킵.
    if (isInternalRequest && finalAssignee && finalAssignee !== req.user.id) {
      try {
        await TaskReviewer.findOrCreate({
          where: { task_id: task.id, user_id: req.user.id },
          defaults: { task_id: task.id, user_id: req.user.id, is_client: isClient, added_by_user_id: req.user.id },
        });
      } catch (e) { console.warn('[task POST auto-reviewer]', e.message); }
    }

    // 사이클 P8 — assignee=Cue && cue_kind 면 비동기 자동 실행
    try {
      const biz = await Business.findByPk(business_id, { attributes: ['cue_user_id'] });
      if (biz?.cue_user_id && finalAssignee === biz.cue_user_id && cue_kind) {
        const { executeForTask } = require('../services/cue_task_executor');
        executeForTask(task.id).then(r => {
          console.log('[cue_task_executor]', task.id, r.ok ? 'ok' : `skip: ${r.reason}`);
        }).catch(e => console.error('[cue_task_executor] crash', e.message));
      }
    } catch (e) {
      console.warn('[task POST cue check]', e.message);
    }

    const full = await Task.findByPk(task.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
    });

    // #87 — assignee/requester 이름 워크스페이스 표시명으로 (emit·return 모두 동일 적용)
    const fullJson = full.toJSON();
    await applyMemberDisplayName([fullJson], business_id, ['assignee', 'requester']);

    // Socket.IO: project room + business room 양쪽 emit (Q Task 페이지가 business 룸 구독)
    // actor_user_id — 토스터가 본인 액션 알림 자기에게 표시 차단용.
    const io = req.app.get('io');
    if (io) {
      const newTaskPayload = { ...fullJson, actor_user_id: req.user.id };
      if (project_id) io.to(`project:${project_id}`).emit('task:new', newTaskPayload);
      if (business_id) io.to(`business:${business_id}`).emit('task:new', newTaskPayload);
      broadcastInboxRefresh(io, business_id, project_id, 'task_new', full.id);
    }

    // 알림: 담당자 ≠ 생성자 일 때만 — 본인이 본인에게 만든 업무는 noise
    if (isInternalRequest && finalAssignee) {
      try {
        const { notify } = require('./notifications');
        const biz = await Business.findByPk(business_id, { attributes: ['name', 'brand_name'] });
        notify({
          userId: finalAssignee,
          businessId: business_id,
          eventKind: 'task',
          title: '새 업무가 배정되었습니다',
          body: `"${full.title}"${full.due_date ? ` · 마감 ${String(full.due_date).slice(0, 10)}` : ''}`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${task.id}`,
          ctaLabel: '업무 보기',
          workspaceName: biz?.brand_name || biz?.name || null,
        }).catch((e) => console.warn('[notify task assigned]', e.message));
      } catch (e) { console.warn('[notify task assigned outer]', e.message); }
    }

    // 자동 AI 예측 — title 있고 estimated_hours 미입력 시 백그라운드 LLM 호출
    // → tasks.estimated_hours 자동 채움 + task_estimations source='ai' row + socket task:updated emit
    // 사용자가 직접 입력한 값은 source='user' 로 덮을 때만 우선
    if (full.title && (!full.estimated_hours || Number(full.estimated_hours) === 0) && !cue_kind) {
      setImmediate(async () => {
        try {
          const { callAiEstimate, AI_MODEL } = require('./task_estimations');
          const { TaskEstimation } = require('../models');
          const ai = await callAiEstimate(full.title, full.description || '');
          if (!ai || !ai.hours) return;
          // task 가 아직 존재하는지 확인 — 빠른 삭제·테스트 cleanup 케이스에서 FK 에러 방지
          const stillExists = await Task.findByPk(task.id, { attributes: ['id'] });
          if (!stillExists) return;
          // tasks.estimated_hours 동기 (UI 표시용)
          await Task.update({ estimated_hours: ai.hours }, { where: { id: task.id } });
          await TaskEstimation.create({
            task_id: task.id,
            business_id: task.business_id,
            value: ai.hours,
            source: 'ai',
            model: AI_MODEL,
          });
          // socket emit — 프론트 자동 갱신
          // latest_estimation_source 명시 노출 (toJSON 만으로는 literal 컬럼 누락 → frontend 회색 분기 안 됨)
          if (io) {
            const updated = await Task.findByPk(task.id, {
              include: [
                { model: Project, attributes: ['id', 'name'], required: false },
                { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
                { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
              ],
            });
            if (updated) {
              const payload = {
                ...updated.toJSON(),
                latest_estimation_source: 'ai',  // 방금 ai estimation row 만들었으므로 확정
                actor_user_id: req.user.id,
                ai_estimate: true,
              };
              if (project_id) io.to(`project:${project_id}`).emit('task:updated', payload);
              io.to(`business:${business_id}`).emit('task:updated', payload);
              broadcastInboxRefresh(io, business_id, project_id, 'task_ai_estimate', updated.id);
            }
          }
        } catch (e) { console.warn('[auto-ai-estimate]', e.message); }
      });
    }

    return successResponse(res, fullJson);
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks/ai-create — 자연어 한 줄 → AI 가 다중 업무 분해 (미리보기, DB 저장 X)
// body: { business_id, project_id?, prompt, target_date?, language? }
// response: { candidates: [...], reasoning, today, fallback }
// ============================================
router.post('/ai-create', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, prompt, target_date, language, mode, instruction } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!prompt || !String(prompt).trim()) return errorResponse(res, 'prompt required', 400);

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const memberRows = await BusinessMember.findAll({
      where: { business_id },
      attributes: ['user_id', 'role', 'job_title', 'expertise', 'name'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    });
    const members = memberRows.map(m => ({
      user_id: m.user_id,
      name: m.name || m.user?.name || '',
      job_title: m.job_title || '',
      expertise: m.expertise || '',
      role: m.role || '',
    }));

    let projectContext = '';
    if (project_id) {
      const p = await Project.findByPk(project_id, { attributes: ['name', 'description'] });
      if (p) projectContext = `${p.name}${p.description ? ' — ' + String(p.description).slice(0, 200) : ''}`;
    }

    const tz = await getWorkspaceTz(business_id);
    const todayLocal = todayInTz(tz);

    const { planTasksFromPrompt } = require('../services/aiTaskPlanner');
    const result = await planTasksFromPrompt({
      prompt,
      businessId: business_id,
      projectContext,
      members,
      targetDate: target_date || null,
      todayLocal,
      language: language || (req.user.language === 'en' ? 'en' : 'ko'),
      mode: mode === 'quick' ? 'quick' : null,
      instruction: instruction || null,  // 운영 — 재생성 지시
    });

    return successResponse(res, {
      candidates: result.candidates,
      reasoning: result.reasoning,
      fallback: result.fallback,
      today: todayLocal,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks/ai-create/confirm — candidates → Task 일괄 생성
// body: { business_id, project_id?, candidates: [...] }
// response: { created: [Task...], count }
// ============================================
router.post('/ai-create/confirm', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, candidates, base_date } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return errorResponse(res, 'candidates array required', 400);
    }

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const tz = await getWorkspaceTz(business_id);
    const todayLocal = base_date && /^\d{4}-\d{2}-\d{2}$/.test(base_date)
      ? base_date
      : todayInTz(tz);
    const { TaskEstimation } = require('../models');
    const io = req.app.get('io');
    const created = [];

    for (const c of candidates) {
      const title = String(c.title || '').trim().slice(0, 200);
      if (!title) continue;
      const startOff = Number.isInteger(c.start_offset_days) ? c.start_offset_days : null;
      const dueOff = Number.isInteger(c.due_offset_days) ? c.due_offset_days : null;
      const startDate = startOff !== null ? addDaysStr(todayLocal, startOff) : null;
      const dueDate = dueOff !== null ? addDaysStr(todayLocal, dueOff) : null;
      const finalAssignee = c.assignee_user_id || req.user.id;
      const isInternalRequest = finalAssignee !== req.user.id;
      const estimatedHours = Number.isFinite(Number(c.estimated_hours)) && Number(c.estimated_hours) > 0
        ? Number(c.estimated_hours) : null;

      const task = await Task.create({
        business_id,
        project_id: project_id || null,
        title,
        description: c.description ? String(c.description).slice(0, 2000) : null,
        assignee_id: finalAssignee,
        start_date: startDate,
        due_date: dueDate,
        estimated_hours: estimatedHours,
        created_by: req.user.id,
        source: isInternalRequest ? 'internal_request' : 'manual',
        request_by_user_id: isInternalRequest ? req.user.id : null,
      });

      // 요청업무 — 요청자를 컨펌자로 자동 등록 (단일 생성 경로와 동일 정책, 컨펌 필수화)
      if (isInternalRequest && finalAssignee && finalAssignee !== req.user.id) {
        try {
          await TaskReviewer.findOrCreate({
            where: { task_id: task.id, user_id: req.user.id },
            defaults: { task_id: task.id, user_id: req.user.id, is_client: false, added_by_user_id: req.user.id },
          });
        } catch (e) { console.warn('[ai-create auto-reviewer]', e.message); }
      }

      // task_estimations source='ai' — AI 추천값 박제 (사용자 인라인 수정 시 source='user' row 추가됨)
      if (estimatedHours) {
        try {
          await TaskEstimation.create({
            task_id: task.id,
            business_id: task.business_id,
            value: estimatedHours,
            source: 'ai',
            model: 'gpt-4o-mini',
          });
        } catch (e) { console.warn('[ai-create/confirm] TaskEstimation', e.message); }
      }

      const full = await Task.findByPk(task.id, {
        include: [
          { model: Project, attributes: ['id', 'name'], required: false },
          { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
          { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
        ],
      });
      // #87 — 워크스페이스 표시명 (push·return·broadcast 동일)
      const fullJson = full.toJSON();
      await applyMemberDisplayName([fullJson], business_id, ['assignee', 'requester']);
      created.push(fullJson);

      if (io) {
        const payload = { ...fullJson, actor_user_id: req.user.id };
        if (project_id) io.to(`project:${project_id}`).emit('task:new', payload);
        io.to(`business:${business_id}`).emit('task:new', payload);
        broadcastInboxRefresh(io, business_id, project_id, 'task_new', full.id);
      }
    }

    return successResponse(res, { created, count: created.length });
  } catch (err) { next(err); }
});

// ============================================
// 기존 호환: GET /by-business/:businessId — 업무 목록
// ============================================
router.get('/by-business/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!scope.isPlatformAdmin && !scope.isOwner && !scope.isMember && !scope.isClient) {
      return errorResponse(res, 'forbidden', 403);
    }
    // client 면 자기 관련 task 만 화이트리스트
    const baseWhere = await taskListWhere(req.user.id, businessId, scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);

    const where = { ...baseWhere };
    if (req.query.status) where.status = req.query.status;
    if (req.query.assignee_id) where.assignee_id = Number(req.query.assignee_id);

    // Pagination — 누적 task 1000+ 시 전체 응답 폭발 방지.
    // 클라이언트 호환: limit 미지정이면 기본 500 (현재 프론트는 전체 받아 클라이언트 필터링 — 단계적 전환 위해 큰 default).
    // 1.x 에서 cursor 기반(due_date+id) 으로 전환 예정. 이번 패치는 hard cap.
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const { rows, count } = await Task.findAndCountAll({
      where,
      attributes: {
        include: [
          // 최신 estimation source — AI 자동 예측 task 시각 분기용 (회색 + ✨)
          [literal('(SELECT source FROM task_estimations WHERE task_id = `Task`.`id` ORDER BY id DESC LIMIT 1)'), 'latest_estimation_source'],
        ],
      },
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'email', 'name_localized'] },
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name'], required: false },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });
    res.set('X-Total-Count', String(count));
    res.set('X-Limit', String(limit));
    res.set('X-Offset', String(offset));
    let plain = rows.map(t => t.toJSON());
    await applyMemberDisplayName(plain, businessId, ['assignee', 'creator', 'requester']);
    // 업무 활동(댓글·상태변경 등) 안 읽음 뱃지 — 안 읽은 task 알림 기준 (운영 #5). 클라이언트 제외.
    if (!scope.isClient) {
      try {
        const { Notification } = require('../models');
        const unread = await Notification.findAll({
          where: { user_id: req.user.id, entity_type: 'task', read_at: null },
          attributes: ['entity_id'],
        });
        const unreadSet = new Set(unread.map(n => Number(n.entity_id)));
        plain.forEach(t => { t.has_unread = unreadSet.has(t.id); });
      } catch (e) { /* 뱃지는 부가정보 — 실패해도 목록은 정상 */ }
    }
    // §8.5 — 고객에겐 공수 시간·예측 출처 제거 (목록에서도 누수 차단)
    if (scope.isClient) plain = serializeTasksForClient(plain);
    return successResponse(res, plain);
  } catch (err) { next(err); }
});

// ============================================
// GET /by-business/:businessId/assignable-externals?project_id=X
// D2-b (#66) — 담당자/컨펌자 picker 용 "프로젝트 참여 외부 파트너" 후보.
//   user 계정이 연결된 active Client 중, 그 프로젝트(ProjectClient)에 참여한 대상만.
//   멤버 전용 (picker 는 내부 화면). project_id 없으면 [] (외부인은 프로젝트 스코프 필수).
// 반환: [{ user_id, client_id, kind, name }]
// ============================================
router.get('/by-business/:businessId/assignable-externals', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const projectId = Number(req.query.project_id);
    if (!projectId) return successResponse(res, []);
    // 프로젝트가 이 워크스페이스 소속인지 확인 (cross-tenant 차단)
    const project = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
    if (!project) return successResponse(res, []);

    // 이 워크스페이스의 active + user 계정 보유 Client 맵 (user_id / client_id 양쪽 색인)
    const clients = await Client.findAll({
      where: { business_id: businessId, status: 'active', user_id: { [Op.ne]: null } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'], required: false }],
    });
    const resolveName = (c) => {
      const dl = c.display_name_localized;
      if (dl && typeof dl === 'object') { const v = dl.ko || dl.en || Object.values(dl)[0]; if (v) return v; }
      return c.display_name || c.user?.name || c.company_name || c.invite_email || `파트너 ${c.id}`;
    };
    const byUserId = new Map();
    const byClientId = new Map();
    for (const c of clients) {
      const entry = { user_id: c.user_id, client_id: c.id, kind: c.kind || 'customer', name: resolveName(c), company_name: c.company_name || null };
      byUserId.set(c.user_id, entry);
      byClientId.set(c.id, entry);
    }

    // 이 프로젝트의 ProjectClient → user 계정 보유 + active 인 것만 후보로
    const pcs = await ProjectClient.findAll({
      where: { project_id: projectId },
      attributes: ['contact_user_id', 'client_id'],
    });
    const out = new Map();
    for (const pc of pcs) {
      let entry = null;
      if (pc.contact_user_id && byUserId.has(pc.contact_user_id)) entry = byUserId.get(pc.contact_user_id);
      else if (pc.client_id && byClientId.has(pc.client_id)) entry = byClientId.get(pc.client_id);
      if (entry) out.set(entry.user_id, entry);
    }
    return successResponse(res, [...out.values()]);
  } catch (err) { next(err); }
});

// ============================================
// PUT /:businessId/:id — 업무 수정
// ============================================
router.put('/by-business/:businessId/:id', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const task = await Task.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!task) return errorResponse(res, 'task_not_found', 404);

    const { title, description, body, assignee_id, status, priority, due_date, start_date, estimated_hours, actual_hours, progress_percent, category, planned_week_start, project_id, recurrence_rule, workstream_id, is_milestone } = req.body;
    const updates = {};
    if (is_milestone !== undefined) updates.is_milestone = !!is_milestone;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (body !== undefined) updates.body = body;
    if (start_date !== undefined) updates.start_date = start_date;
    if (assignee_id !== undefined) updates.assignee_id = assignee_id;
    if (status !== undefined) updates.status = status;
    if (due_date !== undefined) updates.due_date = due_date;
    if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours;
    if (actual_hours !== undefined) {
      updates.actual_hours = actual_hours;
      updates.actual_source = 'user';  // 사용자 직접 입력 → 자동 누적 정지
    }
    if (progress_percent !== undefined) updates.progress_percent = progress_percent;
    if (category !== undefined) updates.category = category;
    if (planned_week_start !== undefined) updates.planned_week_start = planned_week_start;
    // 정기업무 — recurrence_rule 갱신: null 로 보내면 해제, RRULE 문자열이면 검증 후 next_occurrence_at 재계산
    if (recurrence_rule !== undefined) {
      if (recurrence_rule === null || recurrence_rule === '') {
        updates.recurrence_rule = null;
        updates.next_occurrence_at = null;
      } else {
        const finalDue = (due_date !== undefined ? due_date : task.due_date);
        if (!finalDue) return errorResponse(res, 'due_date is required for recurring tasks', 400);
        try {
          const { RRule } = require('rrule');
          RRule.parseString(recurrence_rule);
        } catch (e) {
          return errorResponse(res, `Invalid recurrence_rule: ${e.message}`, 400);
        }
        const { computeNextOccurrence } = require('../services/recurringTaskGenerator');
        updates.recurrence_rule = recurrence_rule;
        updates.next_occurrence_at = computeNextOccurrence(recurrence_rule, finalDue, 1);
      }
    }
    // 프로젝트 이관 허용 — 같은 business 내 프로젝트여야 함
    if (project_id !== undefined) {
      if (project_id === null) {
        updates.project_id = null;
      } else {
        const { Project } = require('../models');
        const target = await Project.findOne({ where: { id: project_id, business_id: task.business_id } });
        if (!target) return errorResponse(res, 'invalid_project', 400);
        updates.project_id = project_id;
      }
    }

    // D3 #65 — 워크스트림 귀속. 이 업무가 속한(또는 이번에 이관될) 프로젝트의 workstream 만 허용.
    if (workstream_id !== undefined) {
      if (workstream_id === null) {
        updates.workstream_id = null;
      } else {
        const { ProjectWorkstream } = require('../models');
        const effectiveProjectId = (updates.project_id !== undefined ? updates.project_id : task.project_id);
        if (!effectiveProjectId) return errorResponse(res, 'invalid_workstream', 400);
        const ws = await ProjectWorkstream.findOne({ where: { id: workstream_id, project_id: effectiveProjectId } });
        if (!ws) return errorResponse(res, 'invalid_workstream', 400);
        updates.workstream_id = workstream_id;
      }
    }

    // D2-b (#66) — 담당자 변경 게이트 (보안민감). 새 담당자가 바뀌고 null 이 아닐 때만 검증.
    //   대상 project 는 이번 변경(project_id)이 있으면 그 값, 없으면 기존 task.project_id.
    //   멤버=전체 / 외부 파트너=그 프로젝트 참여자만 / 그 외=차단.
    if (updates.assignee_id !== undefined && updates.assignee_id !== null
        && updates.assignee_id !== task.assignee_id) {
      const targetProjectId = (updates.project_id !== undefined ? updates.project_id : task.project_id);
      const chk = await assertAssignable(updates.assignee_id, businessId, targetProjectId);
      if (!chk.ok) return errorResponse(res, `cannot_assign:${chk.reason}`, 403);
    }

    // 완료 전환 시 progress 자동 100 (양방향 일관) — sync with PATCH /api/tasks/:id/time 로직
    if (status === 'completed' && task.status !== 'completed') {
      updates.completed_at = new Date();
      if ((Number(task.progress_percent) || 0) < 100 && updates.progress_percent === undefined) {
        updates.progress_percent = 100;
      }
    }

    // 진행율 → status 자동 전환 (PATCH /time 과 동일 — 단일 진실 원천 회복)
    // reviewer 분기: ≥1명이면 100% 입력해도 자동 completed 차단 (사용자 명시 컨펌 요청 필요)
    if (updates.progress_percent === 100 && task.status !== 'completed' && updates.status === undefined) {
      const revCount = await TaskReviewer.count({ where: { task_id: task.id } });
      if (revCount === 0) {
        updates.status = 'completed';
        updates.completed_at = new Date();
      }
    } else if (updates.progress_percent !== undefined && updates.progress_percent < 100 && task.status === 'completed' && updates.status === undefined) {
      updates.status = 'in_progress';
      updates.completed_at = null;
    }

    // Reviewer 가드 (사이클 N+6) — reviewer 0명이면 reviewing/revision_requested 단계 진입 금지.
    // submit-review 라우트는 이미 가드 (no_reviewers_add_first), recalcStatusFromReviewers 도 reviewer 0명이면 변경 안 함.
    // 이 PUT 라우트가 status 직접 변경 경로라 같은 가드 필요 — 일관성 회복.
    if (status === 'reviewing' || status === 'revision_requested') {
      const revCount = await TaskReviewer.count({ where: { task_id: task.id } });
      if (revCount === 0) {
        return errorResponse(res, 'no_reviewers_assigned', 400);
      }
    }

    // 완료 해제 시 progress 자동 조정 (사이클 N+6, 단일 진실 원천):
    // status: completed → active status 전환이고 progress_percent === 100 이면 자동 90 (마무리 단계 의미).
    // status=in_progress + progress=100% 모순 차단. UI 진입점 (리스트 체크박스, 우측 패널, 칸반) 모두 자동 일관.
    if (status !== undefined && status !== 'completed' && status !== 'canceled' && task.status === 'completed') {
      updates.completed_at = null;
      if ((Number(task.progress_percent) || 0) === 100 && updates.progress_percent === undefined) {
        updates.progress_percent = 90;
      }
    }

    // 변경 사항 스냅샷 (history 기록용) — update 직전에 비교
    const prev = {
      status: task.status, assignee_id: task.assignee_id, due_date: task.due_date,
      title: task.title, project_id: task.project_id,
    };

    // 필드별 권한 정책 (사이클 N+5 — PERMISSION_MATRIX §5.7 책임선 분리)
    //   - title/category   → 작성자 OR 담당자 OR workspace owner OR admin
    //   - description (의뢰)→ 작성자 OR owner OR admin (담당자 빠짐 — 의뢰 명세는 발주자 영역)
    //   - body (결과물)     → 담당자 OR admin (owner 빠짐 — 수행자 영역. 변경 필요 시 컨펌 반려 워크플로우로)
    //   - status            → 담당자 OR 작성자 OR owner OR admin
    //   - assignee/due/start/recurrence → 작성자 OR owner OR admin
    //   - project_id        → owner OR admin (큰 결정)
    //   - estimated/actual/progress → 담당자 OR owner OR admin
    const myId = req.user.id;
    const isCreator = task.created_by === myId;
    const isAssignee = task.assignee_id === myId;
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    // 운영 #36 — owner 판정을 getUserScope 단일 경유로 통일.
    //   - businesses.owner_id 본인(=BM 'owner' row 미존재) 도 owner 인정 (#14 와 동일 fallback, 이제 getUserScope 내장)
    //   - 워크스페이스 admin(BusinessMember.role='admin') 도 owner 급 전권 (CLAUDE.md §5.7 — project_id 등 "owner OR admin").
    //     옛 isWsOwner 는 BM role='owner' 만 봐서 admin·owner_id-only owner 가 전부 403 → 프로젝트 변경 등 "저장 실패".
    const myScope = await getUserScope(myId, task.business_id, req.user.platform_role);
    const isWsAdmin = myScope.isAdmin;
    const isOwnerOrAdmin = isPlatformAdmin || myScope.isOwner || isWsAdmin;

    const FIELD_RULES = {
      title: () => isCreator || isAssignee || isOwnerOrAdmin,
      description: () => isCreator || isOwnerOrAdmin,                 // 담당자 빠짐 (의뢰자 영역)
      body: () => isAssignee || isPlatformAdmin || isWsAdmin,         // owner 빠짐, admin 백도어 (수행자 영역, §5.7)
      category: () => isCreator || isAssignee || isOwnerOrAdmin,
      status: () => isAssignee || isCreator || isOwnerOrAdmin,
      assignee_id: () => isCreator || isOwnerOrAdmin,
      due_date: () => isCreator || isOwnerOrAdmin,
      start_date: () => isCreator || isOwnerOrAdmin,
      planned_week_start: () => isCreator || isAssignee || isOwnerOrAdmin,
      recurrence_rule: () => isCreator || isOwnerOrAdmin,
      next_occurrence_at: () => isCreator || isOwnerOrAdmin,
      // 운영 #42 (정책 완화, 2026-06-16) — 프로젝트 이관은 '내 업무 정리'로 보고 담당자·작성자도 허용.
      //   기존엔 owner/admin 전용(#37)이라 PM(member)이 본인 담당 업무도 못 옮겨 막힘 호소.
      //   이제 담당자/작성자/owner/admin 모두 이관 가능 (초기 분류·재분류 일관). §5.7 갱신.
      project_id: () => isAssignee || isCreator || isOwnerOrAdmin,
      workstream_id: () => isAssignee || isCreator || isOwnerOrAdmin,
      is_milestone: () => isAssignee || isCreator || isOwnerOrAdmin,
      estimated_hours: () => isAssignee || isOwnerOrAdmin,
      actual_hours: () => isAssignee || isOwnerOrAdmin,
      progress_percent: () => isAssignee || isOwnerOrAdmin,
      completed_at: () => isAssignee || isCreator || isOwnerOrAdmin,
    };
    const denied = [];
    for (const f of Object.keys(updates)) {
      const rule = FIELD_RULES[f];
      if (rule && !rule()) denied.push(f);
    }
    if (denied.length > 0) {
      return errorResponse(res, `forbidden_fields:${denied.join(',')}`, 403);
    }

    await task.update(updates);

    // N+32 — 옵션 A 통합 동기: task status ↔ Focus session 자동 연결
    //   - in_progress 진입 (담당자 본인 + focus_enabled=true): 기존 활성 stop → 새 session active
    //   - in_progress 이탈 (담당자 본인): 활성 session 자동 stop (end_reason='status_change')
    // 사용자 의도: "진행 시작 누르면 단계이동 같이 움직여야지" (2중 구조 통합)
    if (updates.status !== undefined && updates.status !== prev.status && task.assignee_id === req.user.id) {
      try {
        const { FocusSession, User } = require('../models');
        const u = await User.findByPk(req.user.id, { attributes: ['focus_enabled'] });
        if (u && u.focus_enabled) {
          if (updates.status === 'in_progress' && prev.status !== 'in_progress') {
            await FocusSession.update(
              { state: 'stopped', ended_at: new Date(), end_reason: 'switch' },
              { where: { user_id: req.user.id, state: { [Op.in]: ['active', 'paused'] } } }
            );
            await FocusSession.create({
              user_id: req.user.id,
              business_id: task.business_id,
              task_id: task.id,
              state: 'active',
              started_at: new Date(),
              last_activity_at: new Date(),
            });
          } else if (prev.status === 'in_progress' && updates.status !== 'in_progress') {
            await FocusSession.update(
              { state: 'stopped', ended_at: new Date(), end_reason: 'status_change' },
              { where: { user_id: req.user.id, task_id: task.id, state: { [Op.in]: ['active', 'paused'] } } }
            );
          }
        }
      } catch (e) {
        console.warn('[task PUT] focus auto sync failed:', e.message);
      }
    }

    // 단계이동·주요 필드 변경 history 기록 (워크플로우 외 직접 PUT 도 추적)
    try {
      const actorId = req.user.id;
      const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
      const events = [];
      if (updates.status !== undefined && updates.status !== prev.status) {
        events.push({ event_type: 'status_change', from_status: prev.status, to_status: updates.status });
      }
      if (updates.assignee_id !== undefined && updates.assignee_id !== prev.assignee_id) {
        events.push({ event_type: 'assignee_change', target_user_id: updates.assignee_id, note: `${prev.assignee_id || '—'} → ${updates.assignee_id || '—'}` });
      }
      if (updates.due_date !== undefined && String(updates.due_date) !== String(prev.due_date)) {
        events.push({ event_type: 'due_change', note: `${fmtDate(prev.due_date)} → ${fmtDate(updates.due_date)}` });
      }
      if (updates.title !== undefined && updates.title !== prev.title) {
        events.push({ event_type: 'title_change', note: `${prev.title} → ${updates.title}` });
      }
      if (updates.project_id !== undefined && updates.project_id !== prev.project_id) {
        events.push({ event_type: 'project_change', note: `${prev.project_id || '—'} → ${updates.project_id || '—'}` });
      }
      if (events.length > 0) {
        await Promise.all(events.map((e) => TaskStatusHistory.create({
          task_id: task.id, actor_user_id: actorId, ...e,
        })));
      }
    } catch (e) {
      // history 기록 실패는 전체 PUT 을 깨뜨리지 않도록 silent (로그만)
      console.warn('[task PUT] history record failed:', e.message);
    }

    // Socket.IO: project + business room 양쪽 broadcast
    // 토스터가 본인 관련자인지 정확히 판단하도록 reviewer_ids 도 payload 에 포함.
    // (Task.toJSON 은 raw 컬럼만이라 TaskReviewer 별도 조회)
    // actor_user_id — 액션을 수행한 사용자 ID. 토스터가 "본인 액션 알림 자기에게 표시" 차단용.
    const io = req.app.get('io');
    if (io) {
      const payload = task.toJSON();
      payload.actor_user_id = req.user.id;
      try {
        const TaskReviewer = require('../models').TaskReviewer;
        const reviewers = await TaskReviewer.findAll({
          where: { task_id: task.id }, attributes: ['user_id'],
        });
        payload.reviewer_user_ids = reviewers.map(r => r.user_id);
      } catch { /* 실패해도 broadcast 자체는 진행 */ }
      if (task.project_id) io.to(`project:${task.project_id}`).emit('task:updated', payload);
      io.to(`business:${task.business_id}`).emit('task:updated', payload);
      broadcastInboxRefresh(io, task.business_id, task.project_id, 'task_updated', task.id);
    }

    // 알림: status 변경 / 담당자 변경에 따라 요청자/담당자/리뷰어에게 알림
    try {
      const { notify, notifyMany } = require('./notifications');
      const Business = require('../models').Business;
      const TaskReviewer = require('../models').TaskReviewer;
      const biz = await Business.findByPk(task.business_id, { attributes: ['name', 'brand_name'] });
      const wsName = biz?.brand_name || biz?.name || null;
      const taskLink = `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${task.id}`;

      // 담당자 변경 → 새 담당자에게 알림 (본인이 본인을 담당자로 지정 시 skip)
      if (updates.assignee_id !== undefined && updates.assignee_id !== prev.assignee_id
          && updates.assignee_id && updates.assignee_id !== req.user.id) {
        notify({
          userId: updates.assignee_id, businessId: task.business_id, eventKind: 'task',
          title: '새 업무가 배정되었습니다', body: `"${task.title}"`,
          link: taskLink, ctaLabel: '업무 보기', workspaceName: wsName,
        }).catch((e) => console.warn('[notify reassign]', e.message));
      }
      // 상태 변경
      if (updates.status !== undefined && updates.status !== prev.status) {
        const newStatus = updates.status;
        // completed → 요청자/생성자에게
        if (newStatus === 'completed') {
          const requesterId = task.request_by_user_id || task.created_by;
          if (requesterId && requesterId !== req.user.id) {
            notify({
              userId: requesterId, businessId: task.business_id, eventKind: 'task',
              title: '요청한 업무가 완료되었습니다', body: `"${task.title}"`,
              link: taskLink, ctaLabel: '결과 확인', workspaceName: wsName,
            }).catch((e) => console.warn('[notify completed]', e.message));
          }
        }
        // reviewing → 리뷰어 전체에게
        if (newStatus === 'reviewing') {
          const reviewers = await TaskReviewer.findAll({
            where: { task_id: task.id }, attributes: ['user_id'],
          });
          notifyMany({
            userIds: reviewers.map((r) => r.user_id), businessId: task.business_id, eventKind: 'task',
            title: '업무 검토 요청', body: `"${task.title}" 검토를 요청받았습니다.`,
            link: taskLink, ctaLabel: '검토하기', workspaceName: wsName,
            excludeUserId: req.user.id,
          }).catch((e) => console.warn('[notify reviewing]', e.message));
        }
        // revision_requested → 담당자에게
        if (newStatus === 'revision_requested' && task.assignee_id && task.assignee_id !== req.user.id) {
          notify({
            userId: task.assignee_id, businessId: task.business_id, eventKind: 'task',
            title: '업무 수정 요청', body: `"${task.title}"` ,
            link: taskLink, ctaLabel: '수정 시작', workspaceName: wsName,
          }).catch((e) => console.warn('[notify revision]', e.message));
        }
      }
    } catch (e) { console.warn('[task PUT notify outer]', e.message); }

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// DELETE /:businessId/:id — 업무 삭제
// 권한: platform_admin, 워크스페이스 owner, 또는 본인(created_by/assignee_id/request_by_user_id) 중 하나
// ============================================
router.delete('/by-business/:businessId/:id', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const userId = req.user.id;
    const task = await Task.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!task) return errorResponse(res, 'task_not_found', 404);

    // 사이클 N+5 — PERMISSION_MATRIX §5.7 정책 강화:
    //   admin / owner = 항상 삭제 가능
    //   작성자 = 댓글·이력 0건일 때만 (실수 정정용 안전핀)
    //   담당자·요청자만으로는 삭제 불가 — task 발주 후 임의 삭제 차단
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    let isOwner = false;
    if (!isPlatformAdmin) {
      const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
      if (!bm) return errorResponse(res, 'forbidden', 403);
      // N+93 — admin 도 삭제 가능 (CLAUDE.md §5.7 "DELETE task → owner/admin"). 옛 코드는 owner 만 봐서 admin 차단됨.
      isOwner = bm.role === 'owner' || bm.role === 'admin';
      // 운영 #14 — BusinessMember.role 이 'owner' 로 안 박혀있어도 businesses.owner_id 본인이면 owner 로 인정.
      if (!isOwner) {
        const biz = await Business.findByPk(businessId, { attributes: ['owner_id'] });
        if (biz && biz.owner_id === userId) isOwner = true;
      }
    }
    if (!isPlatformAdmin && !isOwner) {
      // 작성자 본인이 만든 task — "타인의 관여" 가 없을 때만 삭제 허용 (실수 정정용 안전핀).
      const isCreator = task.created_by === userId;
      if (!isCreator) return errorResponse(res, 'forbidden_delete — only workspace owner or task creator (untouched task) can delete', 403);
      // 운영 #14 — 작성자 본인이 만든 status_history(자동 누적)·본인 댓글은 잠금 사유에서 제외.
      // 타인(다른 user)이 댓글·리뷰어·상태변경으로 관여한 경우에만 차단 → 책임선 보호는 유지하면서
      // 본인만 만진 test task 정리 가능.
      const [cmtCnt, histCnt, revCnt] = await Promise.all([
        TaskComment.count({ where: { task_id: task.id, user_id: { [Op.ne]: userId } } }),
        TaskStatusHistory.count({ where: { task_id: task.id, actor_user_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: userId }] } } }),
        TaskReviewer.count({ where: { task_id: task.id, user_id: { [Op.ne]: userId } } }),
      ]);
      if (cmtCnt > 0 || histCnt > 0 || revCnt > 0) {
        return errorResponse(res, 'forbidden_delete — task has activity (comments/history/reviewers). Ask workspace owner.', 403);
      }
    }

    const meta = { id: Number(req.params.id), project_id: task.project_id, business_id: task.business_id };

    // TaskReviewer/TaskAttachment/TaskStatusHistory 는 FK onDelete: CASCADE 설정됨.
    // TaskComment · TaskDailyProgress 는 cascade 없음 → 수동 삭제 + 원자화.
    //
    // 정기업무 (N+40): tasks.recurrence_parent_id FK 가 DDL ON DELETE 미명시 (default RESTRICT).
    // parent (recurrence_rule != null && recurrence_parent_id == null) 삭제 시 자식 인스턴스가
    // 있으면 FK constraint 에러. 정책:
    //   - 자식 인스턴스의 recurrence_parent_id = null 로 detach (인스턴스는 독립 task 로 남김 — 데이터 보존)
    //   - parent 의 next_occurrence_at 도 어차피 같이 사라지므로 향후 자동 생성 중단
    const { sequelize } = require('../config/database');
    const t = await sequelize.transaction();
    try {
      const isRecurringParent = task.recurrence_rule && !task.recurrence_parent_id;
      if (isRecurringParent) {
        await Task.update(
          { recurrence_parent_id: null },
          { where: { recurrence_parent_id: task.id }, transaction: t },
        );
      }
      // 운영 #14 — documents.task_id 는 ON DELETE NO ACTION(RESTRICT). 연결 문서가 있으면 task.destroy 가
      //   FK 제약으로 실패(500) → 사용자 "삭제 안 됨". task_id = null 로 detach 하여 문서는 독립 자료로 보존.
      const { Document } = require('../models');
      await Document.update({ task_id: null }, { where: { task_id: task.id }, transaction: t });
      await TaskComment.destroy({ where: { task_id: task.id }, transaction: t });
      await TaskDailyProgress.destroy({ where: { task_id: task.id }, transaction: t });
      await task.destroy({ transaction: t });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    // Socket.IO
    const io = req.app.get('io');
    if (io) {
      if (meta.project_id) io.to(`project:${meta.project_id}`).emit('task:deleted', meta);
      io.to(`business:${meta.business_id}`).emit('task:deleted', meta);
      broadcastInboxRefresh(io, meta.business_id, meta.project_id, 'task_deleted', meta.id);
    }

    return successResponse(res, { id: meta.id, deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// ============================================
// POST /api/tasks/:id/copy — 업무 복제 (메타 deep clone, history/comments 제외)
// body: { } 또는 { project_id?, after_priority_order? }
// ============================================
router.post('/:id/copy', authenticateToken, async (req, res, next) => {
  try {
    const src = await Task.findByPk(req.params.id);
    if (!src) return errorResponse(res, 'not_found', 404);

    if (!(await assertBusinessAccess(req.user.id, src.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    // 복제 제목 — "원제목 (복사)"
    const copyTitle = src.title + ' (복사)';

    // N+63 — 사용자 요구 "담당자랑 날짜 리셋". body(결과물) 와 description(의뢰)·메타는 복사.
    // 새 업무는 처음부터 시작 — assignee/due_date/start_date/planned_week_start 모두 null.
    const copy = await Task.create({
      business_id: src.business_id,
      project_id: src.project_id,
      title: copyTitle.slice(0, 200),
      description: src.description,
      body: src.body,
      assignee_id: null,
      due_date: null,
      start_date: null,
      estimated_hours: src.estimated_hours,
      category: src.category,
      conversation_id: src.conversation_id,
      planned_week_start: null,
      created_by: req.user.id,
      source: 'manual',
      // 새 task — 진행/완료 상태는 처음부터
      status: 'not_started',
      progress_percent: 0,
      actual_hours: null,
      completed_at: null,
    });

    const full = await Task.findByPk(copy.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
    });

    // socket emit
    const io = req.app.get('io');
    if (io) {
      const payload = { ...full.toJSON(), actor_user_id: req.user.id };
      if (src.project_id) io.to(`project:${src.project_id}`).emit('task:new', payload);
      io.to(`business:${src.business_id}`).emit('task:new', payload);
      broadcastInboxRefresh(io, src.business_id, src.project_id, 'task_copy', full.id);
    }

    return successResponse(res, full.toJSON(), 'copied', 201);
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/:id/detail — 업무 상세 (댓글 포함)
// ============================================
router.get('/:id/detail', authenticateToken, async (req, res, next) => {
  try {
    const { TaskAttachment } = require('../models');
    const task = await Task.findByPk(req.params.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
        {
          model: TaskComment, as: 'comments', required: false,
          include: [
            { model: User, as: 'author', attributes: ['id', 'name'] },
            { model: TaskAttachment, as: 'attachments', required: false, include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] },
          ],
        },
        { model: TaskDailyProgress, as: 'daily_progress', required: false },
      ],
      order: [
        [{ model: TaskComment, as: 'comments' }, 'createdAt', 'ASC'],
        [{ model: TaskDailyProgress, as: 'daily_progress' }, 'snapshot_date', 'ASC'],
      ],
    });
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // Client 는 internal/personal 댓글 제외
    let json = task.toJSON();
    // N+34 — assignee/creator/requester 이름 워크스페이스 표시명으로 덮어쓰기
    await applyMemberDisplayNameOne(json, task.business_id, ['assignee', 'creator', 'requester']);
    // #87 — 댓글 작성자도 워크스페이스 표시명으로 (업무 상세 본문)
    if (Array.isArray(json.comments)) {
      await applyMemberDisplayName(json.comments, task.business_id, ['author']);
    }
    // latest_estimation_source 명시 노출 — drawer 가 회색 분기 표시하려면 필요 (사이클 N+6)
    try {
      const { TaskEstimation } = require('../models');
      const lastEst = await TaskEstimation.findOne({
        where: { task_id: task.id }, order: [['id', 'DESC']], attributes: ['source'],
      });
      json.latest_estimation_source = lastEst ? lastEst.source : null;
    } catch { json.latest_estimation_source = null; }

    // ─── 사이클 P8.1 — Cue 결과 메타 (출처 resolve + 최근 실행 이벤트) ───
    if (task.cue_kind) {
      json.cue_meta = await buildCueMeta(task);
    }

    // §8.5 — 고객에겐 내부 운영 데이터(공수 시간·예측 출처·일별 스냅샷·Cue 메타) 제거 + shared 댓글만
    if (scope.isClient) json = serializeTaskForClient(json);

    // 업무 열람 시 해당 업무의 안 읽은 알림 읽음 처리 → 리스트 뱃지 해제 + 좌측 종 동기화 (운영 #5)
    try {
      const { Notification } = require('../models');
      const [n] = await Notification.update(
        { read_at: new Date() },
        { where: { user_id: req.user.id, entity_type: 'task', entity_id: task.id, read_at: null } },
      );
      if (n > 0) {
        const io = req.app.get('io');
        if (io) io.to(`user:${req.user.id}`).emit('notification:refresh');
      }
    } catch (e) { /* 부가 — 실패해도 상세는 정상 */ }

    return successResponse(res, json);
  } catch (err) { next(err); }
});

// ─── 헬퍼: Cue task 메타 빌드 (cue_kind 없으면 호출하지 않음) ───
//  - sources: cue_context_ref 안의 ID 들을 라벨/링크로 resolve
//  - last_event: AuditLog 최근 cue.task_* 이벤트
async function buildCueMeta(task) {
  const { Conversation, Post, KbDocument, AuditLog } = require('../models');
  const ref = task.cue_context_ref || {};
  const sources = [];

  if (ref.conversation_id) {
    const conv = await Conversation.findByPk(ref.conversation_id, {
      attributes: ['id', 'title', 'business_id'],
    }).catch(() => null);
    if (conv && conv.business_id === task.business_id) {
      sources.push({ type: 'conversation', id: conv.id, label: conv.title || `chat ${conv.id}` });
    }
  }
  if (Array.isArray(ref.post_ids) && ref.post_ids.length) {
    const posts = await Post.findAll({
      where: { id: ref.post_ids, business_id: task.business_id },
      attributes: ['id', 'title'],
    }).catch(() => []);
    posts.forEach(p => sources.push({ type: 'post', id: p.id, label: p.title || `post ${p.id}` }));
  }
  if (Array.isArray(ref.kb_doc_ids) && ref.kb_doc_ids.length) {
    const docs = await KbDocument.findAll({
      where: { id: ref.kb_doc_ids, business_id: task.business_id },
      attributes: ['id', 'title'],
    }).catch(() => []);
    docs.forEach(d => sources.push({ type: 'kb_document', id: d.id, label: d.title || `doc ${d.id}` }));
  }
  if (ref.meeting_id) {
    // Q Note 는 별도 Python 서비스 — id 만 노출
    sources.push({ type: 'meeting', id: ref.meeting_id, label: `meeting ${ref.meeting_id}` });
  }

  const lastLog = await AuditLog.findOne({
    where: {
      target_type: 'Task',
      target_id: task.id,
      action: { [Op.in]: ['cue.task_executed', 'cue.task_failed', 'cue.task_skipped'] },
    },
    order: [['created_at', 'DESC']],
    attributes: ['action', 'new_value', 'created_at'],
  }).catch(() => null);

  return {
    kind: task.cue_kind,
    context_ref: ref,
    sources,
    last_event: lastLog ? {
      action: lastLog.action,
      at: lastLog.created_at,
      detail: lastLog.new_value || null,
    } : null,
  };
}

// ============================================
// POST /api/tasks/:id/cue/rerun — Cue 자동실행 재실행
// ============================================
router.post('/:id/cue/rerun', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    if (!task.cue_kind) return errorResponse(res, 'not_a_cue_task', 400);

    // 워크스페이스 멤버 이상만 재실행 가능 (Cue 결과는 내부 작업)
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    if (!(scope.isPlatformAdmin || scope.isOwner || scope.isMember)) {
      return errorResponse(res, 'forbidden', 403);
    }

    const { executeForTask } = require('../services/cue_task_executor');
    const result = await executeForTask(task.id);
    if (!result.ok) {
      return errorResponse(res, result.reason || 'cue_execution_failed', 422);
    }
    const refreshed = await Task.findByPk(task.id);
    const json = refreshed.toJSON();
    json.cue_meta = await buildCueMeta(refreshed);
    return successResponse(res, json);
  } catch (err) { next(err); }
});

// ============================================
// POST /api/tasks/:id/comments — 댓글 추가
// ============================================
router.post('/:id/comments', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { content, visibility } = req.body || {};
    if (!content || !String(content).trim()) return errorResponse(res, 'content_required', 400);
    // Client 는 shared 댓글만, internal/personal 작성 금지
    const visAllowed = ['personal', 'internal', 'shared'];
    let finalVis = visAllowed.includes(visibility) ? visibility : 'shared';
    if (scope.isClient) finalVis = 'shared';
    const comment = await TaskComment.create({
      task_id: task.id,
      user_id: req.user.id,
      content: String(content).trim(),
      visibility: finalVis,
    });
    const full = await TaskComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    // #87 — 댓글 작성자 워크스페이스 표시명으로 (emit·return 동일)
    const fullJson = full.toJSON();
    await applyMemberDisplayName([fullJson], task.business_id, ['author']);
    // Socket.IO
    const io = req.app.get('io');
    if (io) io.to(`task:${task.id}`).emit('comment:new', fullJson);

    // 멘션 알림 + N+63 일반 댓글 알림 (shared / internal 가시성만)
    let mentionedSet = new Set();
    if (finalVis !== 'personal') {
      try {
        const { resolveMentions } = require('../services/mention_parser');
        const mentioned = await resolveMentions(comment.content, task.business_id, req.user.id);
        mentionedSet = new Set(mentioned);
        const Business = require('../models').Business;
        const biz = await Business.findByPk(task.business_id, { attributes: ['name', 'brand_name'] });
        const previewBody = comment.content.length > 140 ? comment.content.slice(0, 140) + '…' : comment.content;
        const wsName = biz?.brand_name || biz?.name || null;
        const link = `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${task.id}`;

        // (a) 멘션 알림 (별도 토글 — comment_mention)
        if (mentioned.length > 0) {
          const { notifyMany } = require('./notifications');
          notifyMany({
            userIds: mentioned, businessId: task.business_id, eventKind: 'comment_mention',
            title: `업무 댓글에서 언급됨 — ${task.title}`,
            body: previewBody, link, ctaLabel: '댓글 보기', workspaceName: wsName,
            actorUserId: req.user.id, entityType: 'task', entityId: task.id, ioApp: io,
          }).catch((e) => console.warn('[notify comment_mention task]', e.message));
        }

        // (b) N+63 — 일반 댓글 알림 (사용자 호소 #5). assignee + creator + reviewers (작성자/멘션됨 제외).
        //     eventKind='task' 통합 (별도 'comment' kind 도입은 다음 사이클).
        const { TaskReviewer } = require('../models');
        const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id }, attributes: ['user_id'] });
        const recipientSet = new Set();
        if (task.assignee_id) recipientSet.add(task.assignee_id);
        if (task.created_by) recipientSet.add(task.created_by);
        if (task.request_by_user_id) recipientSet.add(task.request_by_user_id);
        for (const r of reviewers) if (r.user_id) recipientSet.add(r.user_id);
        recipientSet.delete(req.user.id);  // 작성자 본인 제외
        for (const m of mentionedSet) recipientSet.delete(m);  // 멘션됨 제외 (중복 차단)
        // Client 가 internal 댓글에 알림 받으면 안 됨 — client_id 인 사용자 필터 (생략 — visibility 가 internal 이면 backend 가 이미 차단)
        if (recipientSet.size > 0) {
          const { notifyMany } = require('./notifications');
          const authorName = req.user.email?.split('@')[0] || '누군가';
          notifyMany({
            userIds: [...recipientSet], businessId: task.business_id, eventKind: 'task',
            title: `${authorName} 님이 업무 댓글을 남김 — ${task.title}`,
            body: previewBody, link, ctaLabel: '댓글 보기', workspaceName: wsName,
            actorUserId: req.user.id, entityType: 'task', entityId: task.id, ioApp: io,
          }).catch((e) => console.warn('[notify task comment]', e.message));
        }
      } catch (e) { console.warn('[mention task outer]', e.message); }
    }

    // 사이클 N+27 — Cue 가 assignee 이고 cue_kind 있는 task 의 새 댓글이면 Cue 가 댓글 읽고 task.body 업데이트 + 답글 댓글
    // 조건: 댓글 작성자가 Cue 자신이 아니어야 (무한 루프 방지) + reviewing 상태 (1차 결과 받은 후 추가 지시)
    try {
      const Business = require('../models').Business;
      const biz = await Business.findByPk(task.business_id, { attributes: ['cue_user_id'] });
      const isCueAssigned = biz?.cue_user_id && biz.cue_user_id === task.assignee_id && task.cue_kind;
      const isAuthorNotCue = req.user.id !== biz?.cue_user_id;
      const isReviewable = task.status === 'reviewing' || task.status === 'revision_requested';
      if (isCueAssigned && isAuthorNotCue && isReviewable) {
        setImmediate(async () => {
          try {
            const { executeForTask } = require('../services/cue_task_executor');
            const r = await executeForTask(task.id, { commentNote: comment.content });
            if (r.ok) {
              // Cue 답글 댓글 추가 (사용자에게 "반영했어요" 알림)
              const replyComment = await TaskComment.create({
                task_id: task.id, user_id: biz.cue_user_id,
                content: '댓글을 반영해 결과를 업데이트했어요. 위 본문을 확인해주세요.',
                visibility: 'shared',
              });
              const replyFull = await TaskComment.findByPk(replyComment.id, {
                include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
              });
              if (io && replyFull) {
                const replyJson = replyFull.toJSON();
                await applyMemberDisplayName([replyJson], task.business_id, ['author']);
                io.to(`task:${task.id}`).emit('comment:new', replyJson);
              }
              console.log('[cue_task_executor comment]', task.id, 'ok');
            } else {
              console.log('[cue_task_executor comment]', task.id, 'skip:', r.reason);
            }
          } catch (e) { console.error('[cue_task_executor comment crash]', e.message); }
        });
      }
    } catch (e) { console.warn('[comment cue check]', e.message); }

    return successResponse(res, fullJson);
  } catch (err) { next(err); }
});

// ============================================
// PUT /api/tasks/:id/comments/:commentId — 본인 댓글 편집
// 정책: 본인만 (workspace owner / platform_admin 도 X). 다른 사람 발화 위변조 차단.
// ============================================
router.put('/:id/comments/:commentId', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const comment = await TaskComment.findOne({ where: { id: req.params.commentId, task_id: task.id } });
    if (!comment) return errorResponse(res, 'comment_not_found', 404);
    if (comment.user_id !== req.user.id) {
      return errorResponse(res, 'only_author_can_edit', 403);
    }
    const { content } = req.body || {};
    if (!content || !String(content).trim()) return errorResponse(res, 'content_required', 400);
    await comment.update({ content: String(content).trim() });
    const full = await TaskComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    // #87 — 댓글 작성자 워크스페이스 표시명으로 (emit·return 동일)
    const fullJson = full.toJSON();
    await applyMemberDisplayName([fullJson], task.business_id, ['author']);
    const io = req.app.get('io');
    if (io) io.to(`task:${task.id}`).emit('comment:updated', fullJson);
    return successResponse(res, fullJson);
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/tasks/:id/comments/:commentId — 본인 댓글 삭제
// 정책: 본인만. 작성 직후 실수 정리. 분쟁 시 owner 가 별도 admin 도구로 처리.
// ============================================
router.delete('/:id/comments/:commentId', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const comment = await TaskComment.findOne({ where: { id: req.params.commentId, task_id: task.id } });
    if (!comment) return errorResponse(res, 'comment_not_found', 404);
    if (comment.user_id !== req.user.id) {
      return errorResponse(res, 'only_author_can_delete', 403);
    }
    await comment.destroy();
    const io = req.app.get('io');
    if (io) io.to(`task:${task.id}`).emit('comment:deleted', { id: Number(req.params.commentId), task_id: task.id });
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/requested-comments — 내가 요청한 업무들의 최신 댓글
// ============================================
// ============================================
// GET /api/tasks/requested — 내가 요청한 업무 (created_by=me AND assignee != me)
// ============================================
router.get('/requested', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    // 사이클 N+50 — pagination. default 200 / max 500
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await Task.findAndCountAll({
      where: {
        business_id: businessId,
        created_by: req.user.id,
        assignee_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: req.user.id }] },
      },
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
      order: [['due_date', 'ASC'], ['priority_order', 'ASC'], ['created_at', 'DESC']],
      limit, offset,
      distinct: true,
    });
    const tasksJson = rows.map((t) => t.toJSON());
    await applyMemberDisplayName(tasksJson, businessId, ['assignee']);
    return paginatedResponse(res, tasksJson, count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.get('/requested-comments', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
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
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Task, attributes: ['id', 'title'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    const commentsJson = comments.map(c => c.toJSON());
    await applyMemberDisplayName(commentsJson, businessId, ['author']);
    return successResponse(res, commentsJson);
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/extracted-candidates — 전체업무 탭용: Q Talk 추출 후보
// ============================================
router.get('/extracted-candidates', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { TaskCandidate, Project: ProjectModel } = require('../models');
    const projs = await ProjectModel.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] });
    const projIds = projs.map(p => p.id);
    const projMap = new Map(projs.map(p => [p.id, p.name]));
    if (projIds.length === 0) return successResponse(res, []);
    const cands = await TaskCandidate.findAll({
      where: { project_id: projIds, status: 'pending' },
      include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name', 'name_localized'], required: false }],
      order: [['extracted_at', 'DESC']],
      limit: 20,
    });
    const candsJson = cands.map(c => ({ ...c.toJSON(), project_name: projMap.get(c.project_id) }));
    await applyMemberDisplayName(candsJson, businessId, ['guessedAssignee']);
    return successResponse(res, candsJson);
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
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const tz = await getWorkspaceTz(businessId);
    const { dateStrInTz } = require('../utils/datetime');

    const myTasks = await Task.findAll({
      where: { business_id: businessId, assignee_id: req.user.id },
      attributes: ['id'],
    });
    const ids = myTasks.map(t => t.id);
    // 포커스 세션이 있으면 task 없이도(이미 삭제 등) 실측은 보여야 하나, 표준 경로상 ids 기준 충분.

    // ── 모든 날짜 버킷 미리 생성 (스냅샷 없어도 구조 유지) ──
    const byDate = new Map();
    let cur = from;
    while (cur <= to) {
      byDate.set(cur, { date: cur, est_used: 0, act_used: 0, focus_hours: 0 });
      cur = addDaysStr(cur, 1);
    }

    // ── 1) 스냅샷 기반 est_used / 수동 actual (포커스 미사용자·완료업무) ──
    if (ids.length > 0) {
      const snaps = await TaskDailyProgress.findAll({
        where: { task_id: ids, snapshot_date: { [require('sequelize').Op.between]: [from, to] } },
        attributes: ['task_id', 'snapshot_date', 'progress_percent', 'actual_hours', 'estimated_hours'],
        order: [['snapshot_date', 'ASC']],
      });
      for (const s of snaps) {
        // 운영 #35 — snapshot_date 가 Date 객체라 Map 키로 쓰면 참조 동일성 때문에 같은 날짜가
        // 합쳐지지 않아 요일별 집계가 깨짐(매 행이 별도 버킷). 'YYYY-MM-DD' 문자열로 정규화해 정확히 누적.
        const sd = s.snapshot_date;
        const d = (sd instanceof Date) ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10);
        if (!byDate.has(d)) byDate.set(d, { date: d, est_used: 0, act_used: 0, focus_hours: 0 });
        const bucket = byDate.get(d);
        const prog = (s.progress_percent || 0) / 100;
        const est = Number(s.estimated_hours) || 0;
        const act = Number(s.actual_hours) || 0;
        bucket.est_used += est * prog;
        // 실제시간 = 실제 입력시간(actual_hours)만. (예측×진행률 fallback 금지 — 예측 라인과 동일해지는 버그.
        //  실제 미입력이면 actual 라인은 낮게 유지되어 "진척은 됐지만 시간 미입력"을 정직하게 보여줌. Irene 2026-06-16)
        bucket.act_used += act;
      }
    }

    // ── 2) 포커스 실측 시간 (운영 #57/#58/#59) ──
    // 그래프 actual 라인의 핵심 = "포커스타임으로 측정된 실제 업무시간".
    // 스냅샷은 cron 아침 기준이라 진행중 업무에 그날 측정한 포커스 시간이 누락됨 →
    // FocusSession 실측값을 시작일(워크스페이스 tz) 에 귀속해 일별 합산. active 세션은 라이브(지금까지).
    // 누적(focusCum) 으로 만들어 프론트의 단조증가 actual 라인과 정합. snapshot actual 과 max → 포커스/수동 둘 다 보존.
    const { FocusSession } = require('../models');
    const focusSessions = await FocusSession.findAll({
      where: { user_id: req.user.id, business_id: businessId },
      attributes: ['started_at', 'ended_at', 'state', 'pause_total_sec', 'paused_at'],
    });
    for (const s of focusSessions) {
      const wd = dateStrInTz(s.started_at, tz);
      if (wd < from || wd > to) continue;
      const sec = typeof s.computeActualSeconds === 'function' ? s.computeActualSeconds() : 0;
      if (sec <= 0) continue;
      if (!byDate.has(wd)) byDate.set(wd, { date: wd, est_used: 0, act_used: 0, focus_hours: 0 });
      byDate.get(wd).focus_hours += sec / 3600;
    }

    // ── 3) 누적 포커스 → act_used 와 max 병합 (정렬된 날짜 순) ──
    const sorted = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    let focusCum = 0;
    for (const b of sorted) {
      focusCum += b.focus_hours;
      b.focus_cumulative = Math.round(focusCum * 10) / 10;
      // actual 라인 = max(스냅샷 누적 actual, 포커스 누적). 포커스 미사용자는 스냅샷, 포커스 사용자는 실측.
      b.act_used = Math.round(Math.max(b.act_used, focusCum) * 10) / 10;
      b.est_used = Math.round(b.est_used * 10) / 10;
      delete b.focus_hours;
    }

    return successResponse(res, { days: sorted });
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

// ============================================
// 공유 링크 (사이클 N+4 — 통합 공유 시스템)
// POST   /api/tasks/:id/share          → token 발급/조회
// DELETE /api/tasks/:id/share          → 무효화
// ============================================
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 권한 — 작성자 / 담당자 / owner / platform_admin (멤버 아닌 외부 client 차단)
    if (scope.isClient && task.created_by !== req.user.id && task.assignee_id !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }

    const { applyShareUpdate } = require('../services/share_helper');
    const r = await applyShareUpdate(task, req.body || {});
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/tasks/${r.token}`;
    return successResponse(res, {
      share_token: r.token,
      share_url: url,
      shared_at: r.shared_at,
      share_expires_at: r.share_expires_at,
      password_set: r.password_set,
    });
  } catch (err) { next(err); }
});

router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await task.update({
      share_token: null,
      shared_at: null,
      share_password_hash: null,
      share_expires_at: null,
    });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// ============================================
// 공개 미리보기 (인증 X) — /api/public/tasks/:token
// 응답 — read-only 메타. 댓글·첨부·내부 진행기록 X (개인정보 보호)
// ============================================
router.get('/public/by-token/:token', async (req, res, next) => {
  try {
    // N+44 — share_expires_at WHERE 조건 제거. 만료된 token 도 일단 가져와서 410 + share_expired 응답 통일.
    const task = await Task.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
        { model: User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name'], required: false },
      ],
      attributes: ['id', 'title', 'description', 'status', 'priority_order', 'progress_percent',
        'start_date', 'due_date', 'category', 'shared_at', 'share_expires_at', 'share_password_hash',
        'business_id', 'project_id', 'created_by', 'assignee_id'],
    });
    if (!task) return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(task, res)) return;
    const v = await verifySharePassword(task, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    return successResponse(res, {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      progress_percent: task.progress_percent,
      start_date: task.start_date,
      due_date: task.due_date,
      category: task.category,
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      creator: task.creator ? { id: task.creator.id, name: task.creator.name } : null,
      project: task.Project ? { id: task.Project.id, name: task.Project.name } : null,
      workspace: task.Business ? { id: task.Business.id, name: task.Business.brand_name || task.Business.name } : null,
      shared_at: task.shared_at,
    });
  } catch (err) { next(err); }
});

// ============================================
// Smart Routing — auth-check (이 사용자가 PlanQ 안에서 직접 볼 수 있나?)
// 응답: { canAccess: boolean, appUrl: string }
// ============================================
router.get('/public/by-token/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    // N+44 — 410 통일 패턴
    const task = await Task.findOne({ where: { share_token: req.params.token } });
    if (!task) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(task, res)) return;
    const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
    const canAccess = await canAccessTask(req.user.id, task, scope);
    return successResponse(res, {
      canAccess: !!canAccess,
      appUrl: canAccess ? `/task?task=${task.id}` : null,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// 관련 업무 링크 (task_links 양방향)
// ─────────────────────────────────────────────

// 정렬 헬퍼 — 양방향이므로 항상 a < b 로 저장
function sortPair(idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  return [a, b];
}

// 같은 워크스페이스 + 접근 권한 검증 후 task 반환
async function loadTaskWithAccess(taskId, userId, platformRole) {
  const task = await Task.findByPk(taskId);
  if (!task) return null;
  const scope = await getUserScope(userId, task.business_id, platformRole);
  const ok = await canAccessTask(userId, task, scope);
  return ok ? task : null;
}

// GET /api/tasks/:id/links — 양방향 조회
router.get('/:id/links', authenticateToken, async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const task = await loadTaskWithAccess(taskId, req.user.id, req.user.platform_role);
    if (!task) return errorResponse(res, 'not_found_or_forbidden', 404);

    const links = await TaskLink.findAll({
      where: { [Op.or]: [{ task_a_id: taskId }, { task_b_id: taskId }] },
      include: [
        { model: Task, as: 'taskA', attributes: ['id', 'title', 'status', 'project_id', 'due_date', 'assignee_id'] },
        { model: Task, as: 'taskB', attributes: ['id', 'title', 'status', 'project_id', 'due_date', 'assignee_id'] },
      ],
      order: [['created_at', 'DESC']],
    });

    // 응답: 항상 "상대 task" 관점으로 normalize (taskA / taskB 중 내가 아닌 쪽)
    const normalized = links.map((l) => {
      const other = l.task_a_id === taskId ? l.taskB : l.taskA;
      return {
        link_id: l.id,
        link_type: l.link_type,
        created_at: l.created_at,
        task: other ? other.toJSON() : null,
      };
    }).filter((x) => x.task);

    return successResponse(res, normalized);
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/links body: { target_task_id }
router.post('/:id/links', authenticateToken, async (req, res, next) => {
  try {
    const sourceId = Number(req.params.id);
    const targetId = Number(req.body?.target_task_id);
    if (!targetId) return errorResponse(res, 'target_task_id_required', 400);
    if (sourceId === targetId) return errorResponse(res, 'cannot_link_self', 400);

    const source = await loadTaskWithAccess(sourceId, req.user.id, req.user.platform_role);
    if (!source) return errorResponse(res, 'source_not_found_or_forbidden', 404);

    const target = await loadTaskWithAccess(targetId, req.user.id, req.user.platform_role);
    if (!target) return errorResponse(res, 'target_not_found_or_forbidden', 404);

    // 다른 워크스페이스 task 연결 차단 (멀티테넌트 격리)
    if (source.business_id !== target.business_id) {
      return errorResponse(res, 'cross_workspace_link_forbidden', 403);
    }

    const [a, b] = sortPair(sourceId, targetId);
    try {
      const link = await TaskLink.create({
        task_a_id: a, task_b_id: b,
        link_type: 'related',
        created_by: req.user.id,
      });
      await AuditLog.create({
        user_id: req.user.id,
        business_id: source.business_id,
        action: 'task_link.added',
        target_type: 'TaskLink',
        target_id: link.id,
        new_value: { source_task_id: sourceId, target_task_id: targetId },
      }).catch(() => null);
      return successResponse(res, { link_id: link.id }, 'linked', 201);
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        return errorResponse(res, 'already_linked', 409);
      }
      throw e;
    }
  } catch (err) { next(err); }
});

// DELETE /api/tasks/:id/links/:targetId
router.delete('/:id/links/:targetId', authenticateToken, async (req, res, next) => {
  try {
    const sourceId = Number(req.params.id);
    const targetId = Number(req.params.targetId);
    const source = await loadTaskWithAccess(sourceId, req.user.id, req.user.platform_role);
    if (!source) return errorResponse(res, 'source_not_found_or_forbidden', 404);

    const [a, b] = sortPair(sourceId, targetId);
    const link = await TaskLink.findOne({ where: { task_a_id: a, task_b_id: b } });
    if (!link) return errorResponse(res, 'link_not_found', 404);

    await link.destroy();
    await AuditLog.create({
      user_id: req.user.id,
      business_id: source.business_id,
      action: 'task_link.removed',
      target_type: 'TaskLink',
      target_id: link.id,
      old_value: { source_task_id: sourceId, target_task_id: targetId },
    }).catch(() => null);

    return successResponse(res, null, 'unlinked');
  } catch (err) { next(err); }
});

// GET /api/tasks/by-business/:businessId/search?q=&exclude_id=&limit=
// 같은 워크스페이스 task 제목 검색 (관련 업무 picker 용)
router.get('/by-business/:businessId/search', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const q = String(req.query.q || '').trim();
    const excludeId = req.query.exclude_id ? Number(req.query.exclude_id) : null;
    const excludeIds = String(req.query.exclude_ids || '').split(',').map((s) => Number(s)).filter((n) => !isNaN(n));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    if (!q || q.length < 1) return successResponse(res, []);

    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    const where = await taskListWhere(req.user.id, businessId, scope);
    where.title = { [Op.like]: `%${q}%` };
    const allExcluded = [...excludeIds];
    if (excludeId) allExcluded.push(excludeId);
    if (allExcluded.length > 0) where.id = { [Op.notIn]: allExcluded };

    const rows = await Task.findAll({
      where,
      include: [{ model: Project, attributes: ['id', 'name'], required: false }],
      attributes: ['id', 'title', 'status', 'project_id', 'due_date', 'assignee_id'],
      order: [['updated_at', 'DESC']],
      limit,
    });

    return successResponse(res, rows.map((r) => r.toJSON()));
  } catch (err) { next(err); }
});

module.exports = router;
