const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const { Task, User, Project, BusinessMember, Business, TaskComment, TaskDailyProgress, TaskStatusHistory, TaskReviewer, TaskLink, Client, ProjectClient, AuditLog } = require('../models');
const taskSnapshot = require('../services/task_snapshot');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, taskListWhere, canAccessTask, isMemberOrAbove, assertAssignable, assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { getProgressBaselines, deltaOf, estDoneOf, actDoneOf } = require('../services/progressBaseline');
const { todayInTz, mondayOfDateStr, addDaysStr, mondayOfIsoWeek, tzOffsetOf } = require('../utils/datetime');
const { rruleFromRecurrence, sanitizeRRule } = require('../services/rruleFromRecurrence');
// N+34 — 워크스페이스 표시명 helper. BusinessMember.name 우선, User.name fallback.
// 사용자 호소: "담당자 이름이 워크스페이스 프로필 이름이 아니야" — User.name 직접 사용 회귀 fix.
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');
// §8.5 — 고객용 task 직렬화 (공수 시간·예측 출처·내부 메타·internal 댓글 차단)
const { serializeTaskForClient, serializeTasksForClient } = require('../utils/taskClientView');
// 생성·전이는 행동 계층 단일 착지점을 지난다 (사람도 Cue 도 같은 문).
const taskActions = require('../services/actions/task_actions');
const { myWeekWhere } = require('../services/weekTaskSet');
const { modelFor: llmModelFor } = require('../services/llm');

// 행동의 주체 — 사람이 HTTP 로 들어온 경우. req 는 감사 로그의 IP 맥락에만 쓴다.
function actorFrom(req) {
  return {
    kind: 'user',
    userId: req.user.id,
    onBehalfOfUserId: null,
    platformRole: req.user.platform_role || null,
    req,
  };
}

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

// ─── 멤버 가용시간 — services/memberCapacity 단일 원천 (#288) ───
//   여기 있던 사본은 `weekly = daily × days × rate` 라 **휴일을 빼지 않았다**. 화면은 받아서
//   daily × (days − holidays) × rate 로 다시 계산했고, 보고서 쪽은 또 다른 공식을 썼다(3벌).
//   이제 공식은 서비스 한 곳뿐이고, weekly 도 화면과 같은 값이 된다.
const { getMemberCapacity, getMemberCapacityForWeek } = require('../services/memberCapacity');

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
    // 요청이 명시한 워크스페이스가 우선, 없을 때만 사용자의 활성 워크스페이스.
    //   (여태 active 가 req.user 에 실리지 않아 사실상 query 만 동작했다. active 를 싣게 되면서
    //    순서를 그대로 두면 화면이 지정한 워크스페이스를 active 가 덮어써 목록이 뒤바뀐다.)
    const businessId = Number(req.query.business_id || req.user.active_business_id);
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
    //  - not_started: 이번 주 계획(planned_week_start) / 이번 주 마감 / 지연(마감 과거) 일 때. 마감 없는 backlog 만 제외
    //  - in_progress/reviewing/revision_requested/waiting: 날짜 무관 전부 (착수한 업무는 끝까지 책임)
    // ★ 집합은 메인 QTaskPage 의 weekSet 과 **미러**다 (QTaskPage.tsx weekSet memo).
    //   한쪽만 고치면 두 화면의 우선순위 번호가 갈린다 — 실제로 reviewer·관여완료 분기가 빠져 있어
    //   팝아웃 번호가 메인보다 밀리는 결함이 났다(2026-07-28 Fable 설계 게이트 판정).
    //   반드시 양쪽 같이 수정할 것.
    const uid = Number(userId);   // literal 삽입 전 정수 강제 (인젝션 차단)
    // 집합 정의는 services/weekTaskSet.js 가 정본이다 — 보고서 빌더들이 각자 사본을 갖고 있다가
    //   "날짜 없는 backlog 가 모든 과거 주에 소급 포함" · "주 스코프 없이 전체 업무 합산" 결함을
    //   냈다(#223). 여기와 그쪽이 같은 함수를 쓰게 해서 정의가 다시 갈라지지 않게 한다.
    const tasks = await Task.findAll({
      // ★ tzOffset 을 넘겨야 completed_at(UTC 저장)이 **워크스페이스 주간 경계**와 같은 축에서 비교된다.
      //   안 넘기면 KST 새벽 완료분이 전날로 계산돼 이번 주에서 사라진다(2026-08-24 운영 실측).
      where: myWeekWhere(uid, businessId, monday, sunday, { tzOffset: tzOffsetOf(tz) }),
      // 컨펌자 수 — 팝아웃/리스트의 퀵액션 분기(체크 완료 vs 컨펌 요청)가 이 값으로 갈린다.
      //   ★ attributes 는 반드시 { include: [...] } 형태 — 배열로 나열하면 전 컬럼이 날아간다.
      attributes: {
        include: [
          [literal('(SELECT COUNT(*) FROM task_reviewers WHERE task_id = `Task`.`id`)'), 'reviewer_count'],
        ],
      },
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        // 관점별 라벨·퀵액션 분기가 all-tasks 와 같은 근거로 판정되게 reviewer row 를 같이 준다.
        { model: TaskReviewer, as: 'reviewers', attributes: ['id', 'user_id', 'state', 'is_client'], required: false },
      ],
      order: [['due_date', 'ASC'], ['priority_order', 'ASC'], ['created_at', 'ASC']],
    });

    // ★ 집계(가용시간·번다운·요약)는 **담당자-only 부분집합**으로 고정한다.
    //   tasks 를 넓힌 채 그대로 합산하면 남의 업무 시간이 내 번다운·남은시간에 섞인다
    //   (인사이트 카드와 팝아웃 헤더가 동시에 오염). 목록만 넓히고 계산은 그대로.
    const mine = tasks.filter(t => t.assignee_id === uid);

    // 가용시간 — #208: 그 주에 승인된 휴가만큼 실질 가용시간이 줄어든다.
    //   기존 키(weekly 등)는 그대로 두고 weekly_effective/leave_days 를 **더한다**.
    //   휴가가 없으면 weekly_effective === weekly 라 기존 화면과 값이 같다.
    const capacity = await getMemberCapacityForWeek(userId, businessId, monday);

    // ★ 번다운 계산을 제거했다 (2026-08-19).
    //   ① 계산이 틀려 있었다 — `completedByDay` 가 이미 "그날까지 누적" 인데 `estCum += estDay` 로
    //      다시 누적해 화요일에 월요일 분이 재차 더해졌다(삼각 인플레). actCum 도 같은 구조.
    //   ② 더 중요한 건 **소비처가 0** 이었다는 것이다. 화면의 그래프는 /daily-progress 기반
    //      라이브 계산과 services/weeklyReviewSnapshot.buildBurndownData(Δ-기준선) 를 쓴다.
    //      즉 이건 같은 값의 **세 번째 공식**이었고 정의 자체도 정본과 달랐다
    //      (완료 시점 예측 raw 합, 이월 기준선 없음).
    //   틀린 공식을 고쳐서 살려두면 다음 사람이 그걸 정본으로 읽는다 — 필요해지면
    //   buildBurndownData 를 호출할 것.
    // 집계 — mine 기준 (위 주석 참조)
    const totalEstimated = mine.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
    const totalActual = mine.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0);
    const totalRemaining = mine.reduce((s, t) => {
      const est = Number(t.estimated_hours) || 0;
      const prog = (t.progress_percent || 0) / 100;
      return s + est * (1 - prog);
    }, 0);

    const tasksJson = tasks.map(t => t.toJSON());
    await applyMemberDisplayName(tasksJson, businessId, ['assignee']);
    // #250 ③청크 — 업무 태그. **belongsToMany include 를 쓰지 않는다**(위 findAll 은 이미
    //   reviewer_count literal 을 달고 있고, M:N include 는 count·subquery 를 오염시킨다).
    //   task_id IN (...) 배치 2차 쿼리 1회 — routes/task_tags.js 가 정본, 사본 금지.
    // ★ 멤버에게만 싣는다. 이 라우트는 `assertBusinessAccess` 라 **client 도 통과**하는데
    //   serializeTasksForClient(BLOCKED_FIELDS) 를 태우지 않는다 — 무조건 실으면 '수금지연' 같은
    //   내부 운영 라벨이 고객 화면에 그대로 나간다(Fable 실증 F2). all-tasks 와 같은 게이트.
    const tagScope = await getUserScope(uid, businessId, req.user.platform_role);
    if (!tagScope.isClient) await require('./task_tags').attachTagsTo(tasksJson, businessId);
    return successResponse(res, {
      week: monday,
      // ★ 2026-08-24 (Irene: "모든 시간은 워크스페이스 시간이야. 절대 미스 없게") —
      //   "오늘" 과 타임존을 **서버가 정본으로 내려준다.** 팝아웃이 브라우저 tz 를 추측해 쓰던 것을
      //   없애기 위한 축이다(다른 tz 기기에서 팝아웃의 '오늘' 이 하루 어긋났다).
      timezone: tz,
      today: require('../utils/datetime').todayInTz(tz),
      capacity,
      summary: {
        total_tasks: mine.length,
        total_estimated: Math.round(totalEstimated * 10) / 10,
        total_actual: Math.round(totalActual * 10) / 10,
        total_remaining: Math.round(totalRemaining * 10) / 10,
      },
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
    // 요청이 명시한 워크스페이스가 우선, 없을 때만 사용자의 활성 워크스페이스.
    //   (여태 active 가 req.user 에 실리지 않아 사실상 query 만 동작했다. active 를 싣게 되면서
    //    순서를 그대로 두면 화면이 지정한 워크스페이스를 active 가 덮어써 목록이 뒤바뀐다.)
    const businessId = Number(req.query.business_id || req.user.active_business_id);
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

    // #208 — 월간도 같은 정의를 쓴다. 주마다 휴가가 다르므로 주 단위로 실질치를 얹는다
    //   (월 전체를 한 번에 빼면 어느 주가 비었는지 화면이 알 수 없다).
    const capacity = await getMemberCapacity(userId, businessId);
    for (const w of weeks) {
      const c = await getMemberCapacityForWeek(userId, businessId, w.week_start);
      w.capacity = c.weekly;
      w.capacity_effective = c.weekly_effective;
      w.leave_days = c.leave_days;
    }

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
    // 요청이 명시한 워크스페이스가 우선, 없을 때만 사용자의 활성 워크스페이스.
    //   (여태 active 가 req.user 에 실리지 않아 사실상 query 만 동작했다. active 를 싣게 되면서
    //    순서를 그대로 두면 화면이 지정한 워크스페이스를 active 가 덮어써 목록이 뒤바뀐다.)
    const businessId = Number(req.query.business_id || req.user.active_business_id);
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
    // 요청이 명시한 워크스페이스가 우선, 없을 때만 사용자의 활성 워크스페이스.
    //   (여태 active 가 req.user 에 실리지 않아 사실상 query 만 동작했다. active 를 싣게 되면서
    //    순서를 그대로 두면 화면이 지정한 워크스페이스를 active 가 덮어써 목록이 뒤바뀐다.)
    const businessId = Number(req.query.business_id || req.user.active_business_id);
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

    // 시간/진행율은 담당자만 수정 가능 (planned_week_start 는 누구나)
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
    // ★ priority_order 는 여기서 받지 않는다 (#250 ②청크). 유일한 쓰기 경로는
    //   POST /api/tasks/priority/{toggle,reindex} 다 — 재인덱스가 정본 집합 전체를 원자적으로
    //   다시 매기는 연산이라, 행 하나만 고치는 문을 남겨두면 프론트 재인덱스가 부활해 단일화가 무의미해진다.
    //   조용히 무시하지 않고 400 으로 알린다(옛 클라이언트의 침묵 실패 방지).
    if (req.body.priority_order !== undefined) {
      return errorResponse(res, 'priority_order 는 /api/tasks/priority/toggle 로만 변경할 수 있습니다', 400);
    }

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
      // #277 — raw toJSON() 은 사람 정보가 없다. 프론트가 spread 병합이라 표시명이 실린 행에
      //   이 payload 가 도착해도 덮어쓰진 않지만, 규약을 한 벌로 모아 두지 않으면 다음 emit
      //   지점에서 또 갈라진다. 전 emit 지점을 serializeTaskForBroadcast 경유로 통일.
      const { serializeTaskForBroadcast } = require('../services/taskBroadcast');
      const base = await serializeTaskForBroadcast(task.id, task.business_id);
      const payload = { ...(base || task.toJSON()), actor_user_id: req.user.id };
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
    const { business_id, project_id, title, description, assignee_id, due_date,
      estimated_hours, category, source_message_id, conversation_id, planned_week_start, start_date,
      cue_kind, cue_context_ref, recurrence_rule, workstream_id } = req.body;

    // 생성은 행동 계층 단일 착지점을 지난다 (services/actions/task_actions.js).
    //   권한·요청자 자동 컨펌자·Cue 실행·socket·알림·감사가 전부 그 안에서 일어난다 — Cue 도 같은 문.
    const result = await taskActions.createTask(actorFrom(req), {
      businessId: business_id, projectId: project_id, title, description,
      assigneeId: assignee_id, dueDate: due_date, startDate: start_date,
      estimatedHours: estimated_hours, category, sourceMessageId: source_message_id,
      conversationId: conversation_id, plannedWeekStart: planned_week_start,
      cueKind: cue_kind, cueContextRef: cue_context_ref,
      recurrenceRule: recurrence_rule, workstreamId: workstream_id,
    }, { autoAiEstimate: true });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);

    // 응답 — 이 경로는 includes(project·assignee·requester) + 표시명이 붙은 형태를 돌려준다
    const full = await Task.findByPk(result.data.task.id, {
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
    });
    const fullJson = full.toJSON();
    await applyMemberDisplayName([fullJson], business_id, ['assignee', 'requester']);
    return successResponse(res, fullJson);
  } catch (err) { next(err); }
});


// ============================================
// POST /api/tasks/ai-create — 자연어 한 줄 → AI 가 다중 업무 분해 (미리보기, DB 저장 X)
// body: { business_id, project_id?, prompt, target_date?, language? }
// response: { candidates: [...], reasoning, today, fallback }
// ============================================
// 비용폭탄 H-b — AI 업무분해는 외부 LLM 비용(max 2000 tok). per-user 6/분 + 60/일 (재생성 포함 UX 여유).
const aiCreateLimiter = require('../middleware/costGuard').perUserDaily('ai-create', { perMin: 6, perDay: 60, message: 'AI 업무 추가를 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' });
// #354 루틴 설계 — 출력이 6배라 별도 버킷. 블록 수정→재생성이 매번 1콜이므로 하루 12회는 줘야
//   "수정 세 번 하면 오늘 못 씀" 이 안 된다. 일반 분해(60/일)와 예산을 나눠 서로를 안 태운다.
const aiRoutineLimiter = require('../middleware/costGuard').perUserDaily('ai-routine', { perMin: 2, perDay: 12, message: '루틴 설계를 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' });
// 두 리미터 중 **이번 요청의 모드에 맞는 것만** 태운다. 둘 다 걸면 루틴 1회가
//   일반 분해 예산까지 같이 깎아, 리미터를 나눈 의도가 사라진다.
const aiCreateModeLimiter = (req, res, next) => {
  const chain = String(req.body?.mode || '') === 'routine' ? aiRoutineLimiter : aiCreateLimiter;
  let i = 0;
  const step = (err) => (err ? next(err) : (i < chain.length ? chain[i++](req, res, step) : next()));
  step();
};
router.post('/ai-create', authenticateToken, aiCreateModeLimiter, async (req, res, next) => {
  try {
    const { business_id, project_id, prompt, target_date, language, mode, instruction, instructions, base_candidates, base_areas } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!prompt || !String(prompt).trim()) return errorResponse(res, 'prompt required', 400);
    if (String(prompt).length > 4000) return errorResponse(res, 'prompt_too_long', 400);

    // #354 — 모드 화이트리스트. 모르는 값은 조용히 낙하시키지 않고 **거절**한다.
    const AI_MODES = ['quick', 'routine'];
    const effectiveMode = mode == null || mode === '' ? null : (AI_MODES.includes(String(mode)) ? String(mode) : undefined);
    if (effectiveMode === undefined) return errorResponse(res, 'unknown_mode', 400);
    // 루틴 설계는 영역(워크스트림)을 만들어 배치하는 일이라 프로젝트 없이는 성립하지 않는다.
    if (effectiveMode === 'routine' && !project_id) return errorResponse(res, 'project_id required for routine mode', 400);

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id, removed_at: null } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    // 비용폭탄 H-b — Cue 월간 액션 플랜 게이트 (aiTaskPlanner 는 recordUsage 만 하고 차단 안 하던 구멍).
    {
      const planEngine = require('../services/plan');
      const planCan = await planEngine.can(business_id, 'use_cue', { actions: 1 });
      if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, business_id));
    }

    // 담당자 후보 풀 — Cue(AI) 포함. "Cue 에게 시켜줘" 는 정상 기능이다.
    //   (앞서 좀비 업무를 막으려고 풀에서 뺐었는데, 정석은 confirm 에 실행 트리거를 붙이는 것 —
    //    아래 executeForTask. 기능을 빼는 게 아니라 빠진 트리거를 채운다.)
    // 운영 #263 — "ai로 업무추가하면 담당자로 내가 안나오고 이상한 1, 2 라고 표시되는데."
    //   원인은 **후보 풀과 표시 목록의 기준이 달랐던 것**이다. 여기서는 해제된 멤버(removed_at)와
    //   아직 수락 안 한 초대행(user_id NULL)까지 후보로 넘겼는데, 화면의 멤버 목록은 그것들을 뺀다.
    //   그래서 매칭된 user_id 를 화면이 못 찾아 이름 자리에 `#2` 같은 날 id 가 떴다.
    //   (이름이 빈 행은 LLM 프롬프트에도 `  - ` 로 들어가 매칭을 오염시킨다.)
    //   → 양쪽 기준을 같게 만든다: 현직 멤버 + user_id 있는 행 + 이름 있는 행만.
    const memberRows = await BusinessMember.findAll({
      where: { business_id, removed_at: null, user_id: { [Op.ne]: null } },
      attributes: ['user_id', 'role', 'job_title', 'expertise', 'name'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    });
    const members = memberRows
      .map(m => ({
        user_id: m.user_id,
        name: m.name || m.user?.name || '',
        account_name: m.user?.name || '',   // #90 — 이름 지정 매칭(워크스페이스명/계정명 둘 다)
        job_title: m.job_title || '',
        expertise: m.expertise || '',
        role: m.role || '',
      }))
      .filter(m => m.name.trim());   // 이름 없는 후보는 고를 수도, 보여줄 수도 없다

    // ★ business_id 를 WHERE 에 반드시 건다. findByPk 만 쓰면 **다른 워크스페이스의 프로젝트
    //   이름·설명이 그대로 LLM 프롬프트에 실린다** — 클라이언트가 보낸 id 를 믿은 셈이라
    //   남의 워크스페이스 내용을 읽어내는 경로가 된다(멀티테넌트 격리 위반).
    let projectContext = '';
    let projectRow = null;
    if (project_id) {
      projectRow = await Project.findOne({
        where: { id: project_id, business_id },
        attributes: ['id', 'name', 'description', 'strategy_context', 'strategy_goal'],
      });
      if (!projectRow) return errorResponse(res, 'project_not_found', 404);
      projectContext = `${projectRow.name}${projectRow.description ? ' — ' + String(projectRow.description).slice(0, 200) : ''}`;
    }

    // #353 ② — 업무그룹(워크스트림) 이름을 LLM 에 알려준다. 안 알려주면 이름을 지어내고,
    //   지어낸 이름은 confirm 의 보수 매칭에서 전부 미배치로 떨어져 기능이 있으나 마나가 된다.
    let workstreamNames = [];
    if (project_id) {
      const { ProjectWorkstream } = require('../models');
      // ★ 컬럼은 `title` 이다 — `name` 으로 읽으면 SQL 이 통째로 죽어(Unknown column) AI 업무추가 전체가 500 이 된다.
      const wsRows = await ProjectWorkstream.findAll({
        where: { project_id, business_id }, attributes: ['title'], order: [['order_index', 'ASC'], ['id', 'ASC']], limit: 30,
      });
      workstreamNames = wsRows.map((w) => w.title).filter(Boolean);
    }

    // #354 — 루틴 설계는 "이미 돌고 있는 것" 을 알아야 한다.
    //   ① 부하 요약: 새로 제안한 루틴만 세면 실제 부담을 절반만 보여준다(기존 반복이 이미 매일 돈다).
    //   ② 중복 방지: 같은 루틴을 또 만들지 않게 LLM 에 알려준다.
    //   반복 parent 만 — 생성된 회차(recurrence_parent_id 있는 행)까지 세면 같은 루틴을 여러 번 센다.
    let existingRecurring = [];
    if (effectiveMode === 'routine' && project_id) {
      const rows = await Task.findAll({
        where: {
          business_id, project_id,
          recurrence_rule: { [Op.ne]: null },
          recurrence_parent_id: null,
          status: { [Op.notIn]: ['completed', 'canceled'] },
        },
        attributes: ['id', 'title', 'recurrence_rule', 'workstream_id'],
        order: [['id', 'ASC']], limit: 60,
      });
      existingRecurring = rows.map((t) => ({
        id: t.id, title: t.title, recurrence_rule: t.recurrence_rule, workstream_id: t.workstream_id,
      }));
    }

    const tz = await getWorkspaceTz(business_id);
    const todayLocal = todayInTz(tz);

    const { planTasksFromPrompt } = require('../services/aiTaskPlanner');
    const result = await planTasksFromPrompt({
      prompt,
      businessId: business_id,
      projectContext,
      members,
      workstreams: workstreamNames,
      targetDate: target_date || null,
      todayLocal,
      language: language || (req.user.language === 'en' ? 'en' : 'ko'),
      // ★ 화이트리스트를 **명시**한다. 예전엔 `mode === 'quick' ? 'quick' : null` 이라
      //   모르는 모드가 전부 조용히 일반 분해로 떨어졌다 — 사용자는 "루틴 설계를 눌렀는데
      //   왜 일반 업무가 나오지" 로 겪는다(CLAUDE.md 「상태값 규약」: 알 수 없는 값은 보이게).
      //   모드를 늘릴 때는 반드시 이 배열에 넣고, 응답 mode 에코로 프론트가 대조한다.
      mode: effectiveMode,
      instruction: instruction || null,  // 운영 — 재생성 지시 (단건 — 옛 호출 호환)
      // 운영 #312 — 누적 지시 + 직전 후보. 안 넘기면 재생성이 매번 처음으로 되돌아간다.
      instructions: Array.isArray(instructions) ? instructions : null,
      baseCandidates: Array.isArray(base_candidates) ? base_candidates.slice(0, 30) : null,
      // #354 — 루틴 모드 전용 입력. 다른 모드에서는 undefined 라 프롬프트가 그대로다.
      //   전략은 **읽기만** 한다 — 루틴 설계가 전략 필드를 쓰지 않는 것은 Fable 판정(#358 게이트가 먼저).
      strategy: effectiveMode === 'routine' && projectRow
        ? { context: projectRow.strategy_context || null, goal: projectRow.strategy_goal || null }
        : null,
      existingRecurring: effectiveMode === 'routine' ? existingRecurring : null,
      baseAreas: Array.isArray(base_areas) ? base_areas.slice(0, 12) : null,
    });

    // ★ 응답이 상한에서 잘려 아무것도 못 건진 경우 — 200 + 빈 목록으로 내보내지 않는다.
    //   그러면 화면이 "더 구체적으로 입력해 주세요" 를 띄우는데, 그건 정반대 처방이다.
    if (result.error === 'output_truncated') {
      return errorResponse(res, 'output_truncated', 422);
    }

    return successResponse(res, {
      // ★ mode 에코 — 프론트가 "내가 보낸 모드로 실제 처리됐는지" 를 대조한다.
      //   없으면 서버가 조용히 다른 모드로 처리해도 화면은 알 길이 없다.
      mode: effectiveMode,
      candidates: result.candidates,
      areas: result.areas || [],                       // #354 — 루틴 모드에서만 채워진다
      routine_shortfall: result.routine_shortfall || null,
      existing_recurring: existingRecurring,           // 부하 요약의 "이미 돌고 있는 것"
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
    const { business_id, project_id, candidates, base_date, context, mode: confirmMode, areas } = req.body;
    // 탭 문맥 기본값 — "오늘 나의 업무" / "이번 주 나의 업무" 에서 만들면 그 목록 안에 남아야 한다.
    //   화면이 결정해 보내고(어느 탭에서 만들었는지는 화면만 안다), 서버는 **후보가 스스로 날짜를
    //   들고 오지 않았을 때만** 채운다 — LLM 이 정한 날짜를 덮어쓰지 않는다.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const defaultDueDate = DATE_RE.test(String(req.body.default_due_date || '')) ? String(req.body.default_due_date) : null;
    const defaultWeekStart = DATE_RE.test(String(req.body.default_planned_week_start || '')) ? String(req.body.default_planned_week_start) : null;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return errorResponse(res, 'candidates array required', 400);
    }
    // #354 — 후보 수 상한. 여태 상한이 **없어서** 조작된 요청 하나로 수백 건이 생성될 수 있었다.
    //   루틴이든 아니든 같은 캡을 건다.
    const MAX_CONFIRM_CANDIDATES = 40;
    if (candidates.length > MAX_CONFIRM_CANDIDATES) {
      return errorResponse(res, `too_many_candidates (max ${MAX_CONFIRM_CANDIDATES})`, 400);
    }
    const isRoutineConfirm = String(confirmMode || '') === 'routine';
    if (isRoutineConfirm && !project_id) return errorResponse(res, 'project_id required for routine mode', 400);

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id, removed_at: null } });
    if (!bm && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    // 컨텍스트 연결 — 채팅/메일 작업대에서 등록하면 그 대화·스레드에 붙는다 (안 붙으면 그 자리 리스트에 안 보인다).
    //   클라이언트가 보낸 id 를 믿지 않는다 — 이 워크스페이스 소유인지 재검증하고, 메일이면 고객도 상속.
    let ctxFields = {};
    if (context && typeof context === 'object') {
      const convId = Number(context.conversation_id) || null;
      const thrId = Number(context.email_thread_id) || null;
      if (convId) {
        const { Conversation } = require('../models');
        const conv = await Conversation.findOne({ where: { id: convId, business_id }, attributes: ['id', 'project_id'] });
        if (!conv) return errorResponse(res, 'conversation_not_found', 404);
        // 행동 계층 params 는 camelCase 다 — snake_case 로 넘기면 조용히 버려진다(업무가 대화·메일에서 끊긴다)
        ctxFields = { conversationId: conv.id };
      } else if (thrId) {
        const { EmailThread } = require('../models');
        const th = await EmailThread.findOne({ where: { id: thrId, business_id }, attributes: ['id', 'project_id', 'client_id'] });
        if (!th) return errorResponse(res, 'thread_not_found', 404);
        ctxFields = { emailThreadId: th.id, ...(th.client_id ? { clientId: th.client_id } : {}) };
      }
    }

    const tz = await getWorkspaceTz(business_id);
    const todayLocal = base_date && /^\d{4}-\d{2}-\d{2}$/.test(base_date)
      ? base_date
      : todayInTz(tz);
    const created = [];
    const actor = actorFrom(req);

    // #353 ② — 후보의 workstream_hint(이름) → 실제 workstream_id. **이 프로젝트 것만** 대조한다.
    //   매칭은 보수적으로: 공백·대소문자만 무시한 정확 일치. 부분 일치를 허용하면 "리서치" 가
    //   "리서치 운영" 에 붙는 식으로 조용히 오배치된다 — 못 찾으면 미배치가 옳다(담당자 매칭과 같은 규칙).
    const wsByName = new Map();
    if (project_id) {
      const { ProjectWorkstream } = require('../models');
      const wsRows = await ProjectWorkstream.findAll({ where: { project_id, business_id }, attributes: ['id', 'title'] });
      for (const w of wsRows) {
        if (w.title) wsByName.set(String(w.title).replace(/\s+/g, '').toLowerCase(), w.id);
      }
    }
    const matchWorkstream = (hint) => {
      if (!hint || !wsByName.size) return null;
      return wsByName.get(String(hint).replace(/\s+/g, '').toLowerCase()) || null;
    };

    // ── #354 루틴 확정 ① 영역(워크스트림) 먼저 착지 ──────────────────────────
    //   순서가 고정이다: 영역 → 업무 → 링크. 업무가 workstream_id 를 들고 태어나야
    //   회차 상속(recurringTaskGenerator)이 그 영역을 물려준다 — 나중에 붙이면 이미 난 회차가 빈다.
    //
    //   ★ 여기서 워크스트림을 직접 만들면 POST /projects/:id/workstreams 라우트의
    //     loadProjectOrForbidden 게이트를 **우회**한다. BusinessMember 검사만으로는
    //     남의 워크스페이스 project_id 에 영역을 꽂을 수 있으므로 소속을 직접 확인한다.
    const areaIdxToWsId = new Map();
    let workstreamsCreated = 0; let workstreamsMatched = 0;
    let routineProject = null;
    if (isRoutineConfirm) {
      routineProject = await Project.findOne({ where: { id: project_id, business_id }, attributes: ['id', 'name', 'business_id'] });
      if (!routineProject) return errorResponse(res, 'project_not_found', 404);

      const { ProjectWorkstream } = require('../models');
      const adopted = (Array.isArray(areas) ? areas : []).filter((a) => a && a.adopted !== false && String(a.title || '').trim());
      if (adopted.length > 12) return errorResponse(res, 'too_many_areas (max 12)', 400);

      let orderBase = await ProjectWorkstream.count({ where: { project_id, business_id } });
      for (const a of adopted) {
        const title = String(a.title).trim().slice(0, 200);
        const key = title.replace(/\s+/g, '').toLowerCase();
        const areaIdx = Number.isInteger(a.idx) ? a.idx : null;
        // 이미 있는 영역이면 **재사용**한다. 여기가 정규화를 planner 와 같게 유지해야 하는 이유다 —
        //   어긋나면 "Research" 가 두 벌 생긴다.
        const existingId = wsByName.get(key);
        if (existingId) {
          if (areaIdx !== null) areaIdxToWsId.set(areaIdx, existingId);
          workstreamsMatched++;
          continue;
        }
        const ws = await ProjectWorkstream.create({
          business_id, project_id,
          title,
          description: a.description ? String(a.description).slice(0, 1000) : null,
          order_index: orderBase++,
          status: 'active',
          created_by: req.user.id,
          source: 'ai',
        });
        wsByName.set(key, ws.id);
        if (areaIdx !== null) areaIdxToWsId.set(areaIdx, ws.id);
        workstreamsCreated++;
        // ★ 이 파일의 감사 기록은 AuditLog.create 직접 호출이다(createAuditLog 헬퍼를 import 하지 않는다).
        //   헬퍼를 그냥 부르면 이 분기만 ReferenceError 로 죽는데, 문법검사·빌드는 전부 통과한다.
        await AuditLog.create({
          user_id: req.user.id, business_id,
          action: 'project.workstream_create', target_type: 'ProjectWorkstream', target_id: ws.id,
          new_value: { title, project_id, via: 'ai_routine_confirm' },
        }).catch(() => null);
      }
      // 열려 있는 캔버스에 즉시 나타나야 한다 — 안 하면 새로고침해야 보인다(운영안정성 16번).
      //   ★ 이벤트 이름을 지어내지 말 것. 캔버스가 실제로 듣는 것은 projects.js 의 broadcastCanvas 가
      //     쏘는 `project:updated`(+`inbox:refresh`) 다. 다른 이름으로 쏘면 **수신부가 0곳**이라
      //     "브로드캐스트는 했는데 화면은 그대로" 가 된다.
      if (workstreamsCreated > 0) {
        try {
          const io = req.app?.get('io');
          if (io) {
            const payload = { id: Number(project_id), business_id: Number(business_id), actor_user_id: req.user.id };
            io.to(`business:${business_id}`).emit('project:updated', payload);
            io.to(`project:${project_id}`).emit('project:updated', payload);
            io.to(`business:${business_id}`).emit('inbox:refresh', { reason: 'workstream_new', project_id: Number(project_id) });
          }
        } catch (e) { console.warn('[ai-routine] canvas broadcast', e.message); }
      }
    }

    // #353 ④ — depends_on_index 는 여태 확정 시점에 **버려졌다**(task_links 생성 0건).
    //   생성이 끝난 뒤 한 번에 착지시킨다 — 루프 안에서 걸면 아직 안 만들어진 후보를 가리킬 수 있고,
    //   중간 실패 시 멈추는 부분 성공 계약과도 충돌한다.
    const idxToTaskId = new Map();
    const pendingLinks = [];

    // 후보를 하나씩 실제 업무로 — 생성은 행동 계층 단일 착지점을 지난다.
    //   중간에 실패하면 그 지점에서 멈춘다(이미 만든 것은 남는다) — 프론트의 부분 성공 UX 계약이다.
    for (const c of candidates) {
      const title = String(c.title || '').trim().slice(0, 200);
      if (!title) continue;
      const startOff = Number.isInteger(c.start_offset_days) ? c.start_offset_days : null;
      const dueOff = Number.isInteger(c.due_offset_days) ? c.due_offset_days : null;
      const rawEstimated = Number.isFinite(Number(c.estimated_hours)) && Number(c.estimated_hours) > 0
        ? Number(c.estimated_hours) : null;

      // #237 "완료로 추가" — 이미 끝난 일의 기록. Irene: "완료된 업무로 **오늘 업무날짜로**".
      //   ★ 완료된 일에 다음 회차는 없다 → 반복은 서버가 null 로 끊는다(후보가 뭘 들고 왔든).
      //     안 끊으면 recurringTaskGenerator 가 닫힌 업무에서 다음 회차를 계속 낳는다.
      const wantCompleted = c.completed === true || c.completed === 'true';
      const dueStr = dueOff !== null ? addDaysStr(todayLocal, dueOff) : (wantCompleted ? todayLocal : null);

      // #353 ① — 후보가 RRULE 을 직접 들고 오면 그것을 쓴다(평일·말일·BYSETPOS·분기·종료조건).
      //   클라이언트가 보낸 값이므로 **여기서 다시 검증한다** — 프리셋 폴백은 그대로 남긴다(하위호환).
      const rrFromCandidate = wantCompleted ? null : sanitizeRRule(c.recurrence_rule).rule;
      const effectiveRule = rrFromCandidate
        || ((!wantCompleted && dueOff !== null) ? rruleFromRecurrence(c.recurrence, addDaysStr(todayLocal, dueOff)) : null);

      // #353 ③ — 장문 실행 지침은 description(요약) 뒤에 이어 붙여 저장한다.
      //   후보 응답에서는 두 필드가 분리돼 있어야 미리보기가 요약만 보여줄 수 있다 — 병합은 저장 시점에.
      const descBase = c.description ? String(c.description).slice(0, 2000) : '';
      const instr = c.instruction ? String(c.instruction).slice(0, 8000) : '';
      const mergedDescription = instr
        ? (descBase ? `${descBase}\n\n${instr}` : instr)
        : (descBase || null);

      const result = await taskActions.createTask(actor, {
        businessId: business_id,
        projectId: project_id || null,
        ...ctxFields,
        title,
        description: mergedDescription,
        // ★ `|| req.user.id` 를 두면 **항상 명시값**이 되어 프로젝트 기본담당자 체인이
        //   영원히 죽은 코드가 된다. 미지정은 미지정으로 넘기고, 체인(기본담당자→PM→생성자)은
        //   createTask 가 판단한다 — 사람·AI·Cue 가 같은 규칙을 쓰게 하는 지점이다.
        assigneeId: c.assignee_user_id || null,
        startDate: startOff !== null ? addDaysStr(todayLocal, startOff) : null,
        //   ★ 기본값은 **후보가 날짜를 안 정했을 때만** 쓴다.
        dueDate: dueStr || defaultDueDate,
        //   주차 버킷 — "이번 주 나의 업무" 술어가 이 값으로 맞춰진다(브라우저가 계산한 월요일이
        //   아니라 화면이 서버에서 받은 주 시작이어야 tz 로 어긋나지 않는다).
        plannedWeekStart: defaultWeekStart,
        estimatedHours: rawEstimated,
        // 정기 루틴 — 마감일이 첫 발생일이므로 없으면 반복 불가(task_actions 가 due 없는 반복을 거절한다).
        //   ★ 게이트는 **원래 dueStr** 로 본다. 탭 기본값으로 채워진 날짜에 반복을 걸면,
        //     날짜를 안 정한 후보가 규칙만 들고 왔을 때 사용자가 시키지도 않은 정기업무가 태어난다.
        recurrenceRule: (dueStr && effectiveRule) ? effectiveRule : null,
        // #353 ② — 업무그룹 배치. task_actions 가 프로젝트 소속인지 다시 검증한다(오배치·테넌트 차단).
        // #354 — 루틴 모드는 영역 인덱스로 **id 직결**한다. 이름 왕복 매칭은 방금 만든 영역을
        //   문자열로 다시 찾는 셈이라 정규화가 한 톨만 어긋나도 미배치가 된다.
        //   루틴이 아니면 종전대로 이름 힌트 매칭(하위호환).
        workstreamId: (isRoutineConfirm && Number.isInteger(c.area_ref) && areaIdxToWsId.has(c.area_ref))
          ? areaIdxToWsId.get(c.area_ref)
          : matchWorkstream(c.workstream_hint),
      }, {
        // 이 경로의 고유 규칙 (통일 금지 — 프론트가 이 차이에 기대고 있다):
        keepEstimateForCue: true,          // 담당=Cue 면 요청 업무여도 예측시간을 남긴다
        autoReviewerIsClient: false,       // 자동 컨펌자는 항상 내부(옛 동작)
        estimation: rawEstimated ? { value: rawEstimated, source: 'ai', model: llmModelFor('task_plan') } : null,
      });
      // 담당자 배정 실패의 에러 문자열은 이 경로만 다르다 (프론트 분기 계약) → 재매핑
      if (!result.ok) {
        const code = String(result.code).startsWith('cannot_assign:')
          ? result.code.replace('cannot_assign:', 'assignee_not_assignable:')
          : result.code;
        return errorResponse(res, code, result.http || 400);
      }

      // #237 — 완료로 추가. **행동 계층 complete() 를 지난다** (createTask 에 status:'completed' 를
      //   넘기면 completed_at·이력·Focus 종료·broadcast·요청자 알림이 빠진 반쪽 완료가 된다).
      //   실패해도 생성은 되돌리지 않는다 — 업무는 남기고 사유만 실어 보낸다:
      //     only_assignee / not_ready_for_complete = 담당자가 남이거나 컨펌자가 붙은 요청 업무.
      let completedSkipped = null;
      if (wantCompleted) {
        const cr = await taskActions.complete(result.data.task, actor);
        if (!cr.ok) completedSkipped = cr.code || 'complete_failed';
      }

      const full = await Task.findByPk(result.data.task.id, {
        include: [
          { model: Project, attributes: ['id', 'name'], required: false },
          { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
          { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
        ],
      });
      const fullJson = full.toJSON();
      await applyMemberDisplayName([fullJson], business_id, ['assignee', 'requester']);
      if (completedSkipped) fullJson.completed_skipped = completedSkipped;
      created.push(fullJson);

      // #353 ④ — 후보 순번 → 실제 업무 id. 링크는 전 후보 생성 후 한 번에 건다.
      const selfIdx = Number.isInteger(c.idx) ? c.idx : created.length - 1;
      idxToTaskId.set(selfIdx, result.data.task.id);
      if (Number.isInteger(c.depends_on_index) && c.depends_on_index !== selfIdx) {
        pendingLinks.push({ from: selfIdx, to: c.depends_on_index });
      }
      // #354 — 루틴 파이프라인(일간 → 주간 → 월간)은 단일 의존이 아니라 **여러 갈래**다.
      //   depends_on_index 하나로는 표현이 안 돼 pipeline_refs 배열을 같은 착지점으로 보낸다.
      if (isRoutineConfirm && Array.isArray(c.pipeline_refs)) {
        for (const ref of c.pipeline_refs.slice(0, 5)) {
          if (Number.isInteger(ref) && ref !== selfIdx) pendingLinks.push({ from: selfIdx, to: ref });
        }
      }
    }

    // #353 ④ — 관련 업무 링크 착지. 선택 해제돼 만들어지지 않은 후보를 가리키는 링크는 조용히 건너뛴다
    //   (사용자가 일부만 고르는 것은 정상 흐름이다 — 그것 때문에 생성 전체를 실패시키지 않는다).
    // ※ 알려진 한계: 위 루프가 **중간에 실패해 return** 하면 여기까지 오지 못하므로, 그때까지 만들어진
    //   업무들 사이의 링크는 걸리지 않는다(업무는 남는다 — 부분 성공 계약). 사용자가 상세에서 직접 걸 수 있다.
    let linked = 0;
    for (const { from, to } of pendingLinks) {
      const a = idxToTaskId.get(from);
      const b = idxToTaskId.get(to);
      if (!a || !b || a === b) continue;
      const [x, y] = sortPair(a, b);
      try {
        const [link, isNew] = await TaskLink.findOrCreate({
          where: { task_a_id: x, task_b_id: y },
          defaults: { task_a_id: x, task_b_id: y, link_type: 'related', created_by: req.user.id },
        });
        if (isNew) {
          linked += 1;
          await AuditLog.create({
            user_id: req.user.id, business_id,
            action: 'task_link.added', target_type: 'TaskLink', target_id: link.id,
            new_value: { source_task_id: a, target_task_id: b, via: 'ai_create_confirm' },
          }).catch(() => null);
        }
      } catch (e) {
        console.warn('[ai-create/confirm] task link failed', a, b, e.message);
      }
    }

    // #354 — 착지 결과를 전부 실어 보낸다. 모달이 "영역 3개 만들고 2개는 기존 것 재사용, 업무 16건,
    //   링크 12건" 을 그대로 보여줄 수 있어야 부분 성공도 사용자가 읽을 수 있다.
    return successResponse(res, {
      created, count: created.length, linked,
      workstreams_created: workstreamsCreated,
      workstreams_matched: workstreamsMatched,
    });
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
// GET /:businessId/participation-suggestion — 실작업률(participation_rate) 실측 제안 (WORK_FLOW §6 / U5)
//   최근 28일 포커스 실측시간(캡 적용) ÷ 명목 근무시간(rate 제외) = 측정된 실작업률.
//   추측(85%) 대신 데이터로 제안. 충분한 신호(누적 8h+) 있을 때만 반환, 아니면 null.
// ============================================
router.get('/by-business/:businessId/participation-suggestion', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // #208 — 여기만 휴가 차감을 **하지 않는다**(의도적). 참여율 추천의 분모는 명목 근무시간이라,
    //   휴가로 분모를 줄이면 "쉰 주" 가 참여율을 인위적으로 끌어올린다. 4주 창이라 영향도 작다.
    const cap = await getMemberCapacity(req.user.id, businessId);
    const nominalPerWeek = cap.daily * Math.max(0, cap.days - cap.holidays); // rate 제외 — 측정 대상이 rate 자체
    const WEEKS = 4;
    if (nominalPerWeek <= 0) return successResponse(res, { suggested_rate: null });

    const tz = await getWorkspaceTz(businessId);
    const { dateStrInTz } = require('../utils/datetime');
    const today = todayInTz(tz);
    const from = addDaysStr(today, -28);
    const { FocusSession } = require('../models');
    const sessions = await FocusSession.findAll({
      where: { user_id: req.user.id, business_id: businessId },
      attributes: ['started_at', 'ended_at', 'state', 'pause_total_sec', 'paused_at', 'last_activity_at'],
    });
    let focusSec = 0;
    for (const s of sessions) {
      const wd = dateStrInTz(s.started_at, tz);
      if (wd >= from && wd <= today) focusSec += (typeof s.computeActualSeconds === 'function' ? s.computeActualSeconds() : 0);
    }
    const focusHours = focusSec / 3600;
    const nominal = nominalPerWeek * WEEKS;
    // 신뢰성 게이트 — 포커스를 "주 업무 추적 도구"로 쓸 때만 focus/nominal 이 참여율의 신뢰 신호가 된다.
    //   포커스가 명목의 40% 미만이면 그 비율은 '참여율'이 아니라 '포커스 사용률'(드문드문 사용) → 오안내 방지 위해 제안 안 함.
    //   (예: 명목 120h 인데 포커스 8h=7% → 실제 참여율 85% 여도 7% 로 오안내될 위험 → null)
    const COVERAGE_MIN = 0.4;
    if (nominal <= 0 || focusHours < COVERAGE_MIN * nominal) {
      return successResponse(res, { suggested_rate: null, focus_hours: Math.round(focusHours * 10) / 10 });
    }
    const rate = Math.min(1, Math.max(0.1, focusHours / nominal));
    return successResponse(res, {
      suggested_rate: Math.round(rate * 100) / 100,
      suggested_percent: Math.round(rate * 100),
      focus_hours: Math.round(focusHours * 10) / 10,
      weeks: WEEKS,
      current_percent: Math.round((cap.rate || 1) * 100),
    });
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

    const { title, description, body, assignee_id, status, due_date, start_date, estimated_hours, actual_hours, progress_percent, category, planned_week_start, project_id, recurrence_rule, workstream_id, is_milestone, hold_reason, miss_policy } = req.body;
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
    // #349 — 미수행 회차 정책. 시리즈 부모에만 의미가 있다(회차 인스턴스는 자기 정책을 갖지 않는다).
    //   값 검증은 여기서 한다 — ENUM 밖 값이 오면 DB 가 에러를 내고 그 에러는 사용자에게 안 보인다.
    if (miss_policy !== undefined && ['carry', 'auto_skip'].includes(miss_policy)) {
      updates.miss_policy = miss_policy;
    }

    // 정기업무 — recurrence_rule 갱신: null 로 보내면 해제, RRULE 문자열이면 검증 후 next_occurrence_at 재계산
    if (recurrence_rule !== undefined) {
      if (recurrence_rule === null || recurrence_rule === '') {
        updates.recurrence_rule = null;
        updates.next_occurrence_at = null;
      } else {
        const finalDue = (due_date !== undefined ? due_date : task.due_date);
        if (!finalDue) return errorResponse(res, 'due_date is required for recurring tasks', 400);
        // ★ 생성 경로와 **같은 관문**을 지난다 (Fable 구현 검증 2026-08-30 권고).
        //   수정만 열어 두면 만들 때 막힌 값을 고칠 때 넣을 수 있다.
        const checked = sanitizeRRule(recurrence_rule);
        if (!checked.rule) return errorResponse(res, `Invalid recurrence_rule: ${checked.reason}`, 400);
        const { computeNextOccurrence } = require('../services/recurringTaskGenerator');
        updates.recurrence_rule = checked.rule;
        updates.next_occurrence_at = computeNextOccurrence(checked.rule, finalDue, 1);
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
    //
    // ★ #206 R1 — 보류/외부컨펌 중에는 이 자동 전환을 **정지**한다.
    //   보류 중 진행률 100 을 입력했다고 업무가 소리없이 completed 로 닫히면 안 된다(보류 선언 무시).
    //   전진하려면 명시적으로 해제(resume)한 뒤 진행한다. 프론트(QTaskPage)도 같은 가드를 갖는다.
    const holdBlocksAutoSync = ['on_hold', 'external_review'].includes(task.status)
      && updates.status === undefined;
    if (holdBlocksAutoSync) {
      // 자동 전환 없음 — 진행률만 저장된다
    } else if (updates.progress_percent === 100 && task.status !== 'completed' && updates.status === undefined) {
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
    // 규칙 자체는 services/taskTransition.canEnterStatus 단일 원천 (P0 — Cue(AI)가 이 가드를
    // 우회해 직접 status 를 쓰던 구멍을 막으면서, 사람 경로도 같은 함수를 지나게 정렬).
    if (status !== undefined) {
      const { canEnterStatus } = require('../services/taskTransition');
      // #206 — fromStatus 를 넘겨야 on_hold/external_review 진입 매트릭스까지 검사된다
      const gate = await canEnterStatus(task.id, status, { fromStatus: task.status });
      if (!gate.ok) return errorResponse(res, gate.reason, 400);
    }

    // #206 보류 사유 — **on_hold 인 동안에만** 의미가 있다.
    //   보류가 아닌 업무에 사유가 남으면 해제 후에도 유령 사유가 배너에 되살아난다.
    //   이번 요청이 on_hold 진입이거나 이미 on_hold 인 경우에만 반영하고, 그 외엔 무시한다.
    if (hold_reason !== undefined) {
      const enteringHold = status === 'on_hold';
      if (enteringHold || task.status === 'on_hold') {
        updates.hold_reason = hold_reason ? String(hold_reason).trim().slice(0, 500) || null : null;
      }
    }

    // #206 — 드롭다운으로 직접 status 를 바꾸는 경로에서도 보류 필드를 정합하게 유지한다.
    //   on_hold 진입: 복귀 목적지 저장 / on_hold 이탈: 초기화 (액션 계층 hold·resume 과 같은 규칙)
    //   ★ 외부컨펌(external_review)도 같은 장치를 쓴다 — 컨펌 대기(reviewing) 중에 고객 확인을
    //     받으러 나갔다가 **그 라운드로 돌아와야** 한다(#302). 복귀 지점을 안 남기면 resume 이
    //     in_progress 로 떨어뜨려 컨펌 라운드가 사라진다.
    if (status !== undefined && status !== task.status) {
      if (status === 'on_hold' || status === 'external_review') {
        updates.hold_prev_status = task.status;
      } else if (['on_hold', 'external_review'].includes(task.status)) {
        updates.hold_prev_status = null;
        updates.hold_reason = null;
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
      // #206 보류 사유 — 상태를 바꿀 수 있는 사람이 사유도 쓴다 (같은 집합)
      hold_reason: () => isAssignee || isCreator || isOwnerOrAdmin,
      assignee_id: () => isCreator || isOwnerOrAdmin,
      // 운영 #279 (2026-08-16) — 담당자 포함. 여태 담당자가 빠져 있어 "요청받은 업무" 의 기간을
      //   담당자가 잡으려 하면 403 → 화면엔 "저장 실패" 만 떴다. 근본은 규칙이 두 벌이었던 것:
      //   CLAUDE.md 운영 정책은 "마감 연장은 담당자 이상" 인데 여기 코드와 PERMISSION_MATRIX §5.7 은
      //   담당자를 뺐다. 담당자가 자기 일의 착수일·마감을 못 잡으면 "마감 책임은 담당자" 라는
      //   Q Task 의 전제와 모순된다. status·title·project_id 가 이미 isAssignee 를 포함하는 흐름과도 정합.
      //   발주자 보호는 ①기존 due_change 이력(아래 TaskStatusHistory) ②요청자 알림으로 한다.
      //   ★ recurrence_rule 은 열지 않는다 — 반복 정의는 의뢰 명세(발주자 영역)다. 그리고
      //     recurringTaskGenerator 는 next_occurrence_at 만 신뢰하고 그 값은 recurrence_rule 이
      //     payload 에 있을 때만 재계산되므로, 담당자의 due 단독 변경은 시리즈를 옮기지 않는다.
      due_date: () => isAssignee || isCreator || isOwnerOrAdmin,
      start_date: () => isAssignee || isCreator || isOwnerOrAdmin,
      planned_week_start: () => isCreator || isAssignee || isOwnerOrAdmin,
      recurrence_rule: () => isCreator || isOwnerOrAdmin,
      // #349 — 반복 규칙과 **같은 축**이다. 빠뜨리면 담당자가 아닌 멤버는 물론 client 까지
      //   (assertBusinessAccess 는 client 도 통과시킨다) 남의 시리즈를 auto_skip 으로 바꿔
      //   cron 이 타인의 회차를 자동 취소하게 만들 수 있다(Fable 실측 200). 규칙을 나란히 둔다.
      miss_policy: () => isCreator || isOwnerOrAdmin,
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

    // ── 반복 규칙은 **시리즈의 것**이다 — 회차에서 바꿔도 부모에 적용한다 ──────────
    //   Irene: "반복설정을 바꿀 수가 없어. 처음 업무에서만 수정되는 것 같은데."
    //   판단은 services/taskSeriesRecurrence 한 곳에 있다(라우트마다 흩어지면 반드시 갈라진다).
    //   ★ 빼내기는 권한 검사(FIELD_RULES) 통과 **이후**, task.update **이전**이어야 한다.
    const seriesRecur = require('../services/taskSeriesRecurrence');
    const seriesRuleChange = seriesRecur.extractSeriesRuleChange(task, updates);

    await task.update(updates);

    const ruleRes = await seriesRecur.applySeriesRuleChange({
      task, updates, businessId, seriesRuleChange,
      scope: req.body.series_scope,
      actorId: myId,
      isOwnerOrAdmin,
      // 필요할 때만 계산한다 (scope='all' 일 때만) — 모든 업무 저장에 tz 쿼리를 얹지 않는다.
      getToday: async () => todayInTz(await getWorkspaceTz(businessId)),
    });
    if (!ruleRes.ok) return errorResponse(res, ruleRes.code, ruleRes.http);
    const seriesRuleApplied = ruleRes.reset;

    // ── 정기업무 시리즈 전파 (2026-08-25) ───────────────────────────────
    //   반복업무는 부모 1건 + 회차별 행이고, 회차는 **생성 시점에 부모 내용을 복사**한다.
    //   그래서 여태 내용을 고쳐도 이미 만들어진 회차는 그대로였다(Irene: "왜 모두 안 바뀌어?").
    //   Q 캘린더 반복 일정은 이미 '이 일정만/이후 모두/전체' 를 묻는다 — 업무만 규칙이 갈라져 있었다.
    //   series_scope: 'single'(기본·기존 동작) | 'future'(이 회차 이후) | 'all'(전 회차)
    //   ★ 전파 대상은 "시리즈가 공유하는 내용"뿐이다. 회차마다 달라야 하는 값
    //     (status·진행률·실적시간·마감일·결과물 body·완료시각)은 절대 건드리지 않는다.
    const seriesScope = String(req.body.series_scope || 'single').toLowerCase();
    let seriesApplied = 0;
    if (seriesScope === 'future' || seriesScope === 'all') {
      const SERIES_FIELDS = ['title', 'description', 'category', 'assignee_id', 'estimated_hours', 'workstream_id', 'is_milestone'];
      const propagate = {};
      for (const f of SERIES_FIELDS) if (updates[f] !== undefined) propagate[f] = updates[f];
      if (Object.keys(propagate).length > 0) {
        const parentId = task.recurrence_parent_id || task.id;
        const where = {
          business_id: businessId,
          id: { [Op.ne]: task.id },
          status: { [Op.notIn]: ['canceled'] },
          [Op.or]: [{ id: parentId }, { recurrence_parent_id: parentId }],
        };
        if (seriesScope === 'future' && task.due_date) {
          // 이 회차 이후 = 마감일이 같거나 뒤인 회차. 부모(템플릿)는 앞으로 생길 회차의 원본이므로 항상 포함한다.
          where[Op.and] = [{ [Op.or]: [{ id: parentId }, { due_date: { [Op.gte]: task.due_date } }] }];
        }
        seriesApplied = (await Task.update(propagate, { where }))[0] || 0;
      }
    }

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

    // #208 — **업무가 진행중이면 그게 근무중이다.** 따로 출근을 누르게 하지 않는다.
    //   ★ 이 블록이 위 focus 블록과 분리돼 있어야 하는 이유:
    //     ① 근태는 Focus 기능과 무관하다. `focus_enabled=false` 인 사람도 출퇴근은 기록해야 하는데,
    //        위 게이트 안에 두면 그 사람은 업무를 시작해도 영영 '미출근' 으로 남는다.
    //     ② 이 경로는 FocusSession 을 직접 만들고 `/api/focus/start` 라우트를 거치지 않는다 —
    //        그 라우트에만 훅을 걸어두면 화면에서 진행 시작을 눌러도 근태가 모른다
    //        (운영 지적: "업무를 시작하고 진행중이면 근무중 아니야?", "서로 동기화가 안되고 있네").
    //   미출근일 때만 개입한다. 퇴근한 사람을 자동 재출근시키지는 않는다.
    if (updates.status === 'in_progress' && prev.status !== 'in_progress' && task.assignee_id === req.user.id) {
      await require('../services/attendanceTransition')
        .autoClockInOnFocus({ businessId: task.business_id, userId: req.user.id })
        .catch(() => null);
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
        // ★ 2026-08-25 — 여태 사용자 **id 원문**을 넣어 히스토리에 "5 → 1000279" 로 보였다.
        //   사람이 읽는 기록인데 내부 식별자를 노출한 것. 이름으로 바꾼다(옛 행은 읽는 쪽에서 가린다).
        const [fromU, toU] = await Promise.all([
          prev.assignee_id ? User.findByPk(prev.assignee_id, { attributes: ['id', 'name', 'username'] }) : null,
          updates.assignee_id ? User.findByPk(updates.assignee_id, { attributes: ['id', 'name', 'username'] }) : null,
        ]);
        const nm = (u) => (u ? (u.name || u.username || `#${u.id}`) : '—');
        events.push({
          event_type: 'assignee_change',
          target_user_id: updates.assignee_id,
          note: `${nm(fromU)} → ${nm(toU)}`,
        });
      }
      if (updates.due_date !== undefined && String(updates.due_date) !== String(prev.due_date)) {
        events.push({ event_type: 'due_change', note: `${fmtDate(prev.due_date)} → ${fmtDate(updates.due_date)}` });
      }
      if (updates.title !== undefined && updates.title !== prev.title) {
        events.push({ event_type: 'title_change', note: `${prev.title} → ${updates.title}` });
      }
      if (updates.project_id !== undefined && updates.project_id !== prev.project_id) {
        // 같은 이유 — 프로젝트 id 대신 이름
        const [fromP, toP] = await Promise.all([
          prev.project_id ? Project.findByPk(prev.project_id, { attributes: ['id', 'name'] }) : null,
          updates.project_id ? Project.findByPk(updates.project_id, { attributes: ['id', 'name'] }) : null,
        ]);
        events.push({
          event_type: 'project_change',
          note: `${fromP ? fromP.name : '—'} → ${toP ? toP.name : '—'}`,
        });
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

    // #81 — 담당자를 Cue 로 변경하면 자동 실행 (cue_kind 없으면 executor 가 추론). 기존 업무를 Cue 에게 맡기는 경로.
    if (updates.assignee_id !== undefined && updates.assignee_id && updates.assignee_id !== prev.assignee_id) {
      try {
        const cueBiz = await Business.findByPk(businessId, { attributes: ['cue_user_id'] });
        if (cueBiz?.cue_user_id && updates.assignee_id === cueBiz.cue_user_id) {
          const { executeForTask } = require('../services/cue_task_executor');
          executeForTask(task.id, { triggeredBy: req.user.id })
            .then((r) => console.log('[cue_task_executor] PUT', task.id, r.ok ? 'ok' : `skip: ${r.reason}`))
            .catch((e) => console.error('[cue_task_executor] PUT crash', e.message));
        }
      } catch (e) { console.warn('[task PUT cue check]', e.message); }
    }

    // Socket.IO: project + business room 양쪽 broadcast
    // 토스터가 본인 관련자인지 정확히 판단하도록 reviewer_ids 도 payload 에 포함.
    // (Task.toJSON 은 raw 컬럼만이라 TaskReviewer 별도 조회)
    // actor_user_id — 액션을 수행한 사용자 ID. 토스터가 "본인 액션 알림 자기에게 표시" 차단용.
    const io = req.app.get('io');
    if (io) {
      // #277 — 표시명 포함 직렬화 단일 지점. 부가 필드(actor·reviewer)는 caller 가 얹는다.
      const { serializeTaskForBroadcast } = require('../services/taskBroadcast');
      const base = await serializeTaskForBroadcast(task.id, task.business_id);
      const payload = { ...(base || task.toJSON()), actor_user_id: req.user.id };
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
          titleSpec: { feature: 'task', action: 'task_assigned', subject: `"${task.title}"` }, body: `"${task.title}"`,
          link: taskLink, ctaLabel: '업무 보기', workspaceName: wsName,
        }).catch((e) => console.warn('[notify reassign]', e.message));
      }
      // 운영 #279 — 기간(마감) 변경 알림.
      //   담당자에게 마감 편집을 열었으므로, 발주자가 "내가 준 마감이 조용히 밀린" 상태를 겪으면 안 된다.
      //   이력(TaskStatusHistory event_type='due_change')은 위에서 이미 남는다 — 여기서는 알림만.
      //   방향: 바꾼 사람이 담당자면 요청자에게, 요청자/owner 면 담당자에게. 본인 제외.
      if (updates.due_date !== undefined && String(updates.due_date) !== String(prev.due_date)) {
        const fmt = (d) => (d ? String(d).slice(0, 10) : '—');
        const requesterId = task.request_by_user_id || task.created_by;
        const targetId = (req.user.id === task.assignee_id) ? requesterId : task.assignee_id;
        if (targetId && targetId !== req.user.id) {
          notify({
            userId: targetId, businessId: task.business_id, eventKind: 'task',
            titleSpec: { feature: 'task', action: 'task_due_changed', subject: `"${task.title}"` },
            body: `"${task.title}" — ${fmt(prev.due_date)} → ${fmt(updates.due_date)}`,
            link: taskLink, ctaLabel: '업무 보기', workspaceName: wsName,
          }).catch((e) => console.warn('[notify due_change]', e.message));
        }
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
              titleSpec: { feature: 'task', action: 'task_completed', subject: `"${task.title}"` }, body: `"${task.title}"`,
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
            titleSpec: { feature: 'task', action: 'task_review_request', subject: `"${task.title}"` }, body: `"${task.title}" 검토를 요청받았습니다.`,
            link: taskLink, ctaLabel: '검토하기', workspaceName: wsName,
            excludeUserId: req.user.id,
          }).catch((e) => console.warn('[notify reviewing]', e.message));
        }
        // revision_requested → 담당자에게
        if (newStatus === 'revision_requested' && task.assignee_id && task.assignee_id !== req.user.id) {
          notify({
            userId: task.assignee_id, businessId: task.business_id, eventKind: 'task',
            titleSpec: { feature: 'task', action: 'task_revision', subject: `"${task.title}"` }, body: `"${task.title}"` ,
            link: taskLink, ctaLabel: '수정 시작', workspaceName: wsName,
          }).catch((e) => console.warn('[notify revision]', e.message));
        }
        // #206 보류 / 외부컨펌 / 해제 → 담당자 + 의뢰자 (§13. 드롭다운 경로도 알림이 나가야 한다)
        // #281 — 제목은 문자열이 아니라 행위 코드로 넘긴다. 수신자 언어 해석은 notify() 가 한다.
        const HOLD_ACTIONS = {
          on_hold: 'task_hold',
          external_review: 'task_external_review',
        };
        const holdAction = HOLD_ACTIONS[newStatus]
          || (['on_hold', 'external_review'].includes(prev.status)
            ? (prev.status === 'external_review' ? 'task_external_review_done' : 'task_resumed')
            : null);
        if (holdAction) {
          const audience = [...new Set(
            [task.assignee_id, task.request_by_user_id || task.created_by].filter(Boolean)
          )];
          notifyMany({
            userIds: audience, businessId: task.business_id, eventKind: 'task',
            titleSpec: { feature: 'task', action: holdAction, subject: `"${task.title}"` },
            body: task.hold_reason ? `"${task.title}" — ${task.hold_reason}` : `"${task.title}"`,
            link: taskLink, ctaLabel: '업무 보기', workspaceName: wsName,
            excludeUserId: req.user.id,
          }).catch((e) => console.warn('[notify hold]', e.message));
        }
      }
    } catch (e) { console.warn('[task PUT notify outer]', e.message); }

    // series_applied — 프론트가 "N개 회차에 반영됨" 을 사용자에게 보여줄 수 있게 (조용한 전파 금지).
    //   series_rule_reset — 반복 주기를 바꿔서 **비운** 미착수 회차 수(새 규칙으로 다시 생성된다).
    return successResponse(res, {
      ...task.toJSON(),
      series_applied: seriesApplied,
      series_rule_reset: seriesRuleApplied,
    });
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
      // #277 — include 만 하고 표시명 헬퍼를 빼면 계정명이 실린다. 이미 조회된 인스턴스라
      //   추가 쿼리 없이 표시명만 입힌다(serializeLoadedTasks).
      const { serializeLoadedTasks } = require('../services/taskBroadcast');
      const [baseJson] = await serializeLoadedTasks([full], src.business_id);
      const payload = { ...(baseJson || full.toJSON()), actor_user_id: req.user.id };
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

    // ─── #90 — 자동추출 업무의 원본(출처) 링크 resolve (대화/메일) ───
    // 채팅·메일에서 자동추출된 업무가 어디서 왔는지 돌아갈 수 있게 라벨+라우트 제공.
    // 고객에게는 내부 라우트 노출 안 함 (serializeTaskForClient 이전이지만 isClient 가드).
    if (!scope.isClient) {
      json.source_ref = await buildSourceRef(task);
    }

    // #250 ③청크 — 업무 태그. **드로어의 유일한 데이터 소스가 이 라우트다.**
    //   여기서 tags 를 안 실으면 드로어가 빈 배열을 들고 시작해, 사용자가 태그 하나를 "추가" 하는
    //   순간 PUT tag_ids 가 기존 태그를 빼고 나가 **소리없이 삭제**된다(Fable 실증 F1 — 데이터 손실).
    //   client 는 바로 아래 serializeTaskForClient 가 BLOCKED_FIELDS 로 tags 를 걷어낸다.
    await require('./task_tags').attachTagsTo([json], task.business_id);

    // 회차(인스턴스)는 **자기 규칙이 없다** — 규칙은 시리즈 부모의 것이다.
    //   그래서 회차 상세만 보면 반복 설정을 화면에 그릴 수가 없었고, 그 때문에 편집 UI 자체가
    //   부모에서만 열려 있었다(Irene: "처음 업무에서만 수정되는 것 같은데").
    //   여기서 시리즈 규칙과 첫 회차일을 같이 내려 회차에서도 같은 UI 를 그린다.
    if (task.recurrence_parent_id) {
      const parent = await Task.findOne({
        where: { id: task.recurrence_parent_id, business_id: task.business_id },
        attributes: ['id', 'recurrence_rule', 'due_date', 'miss_policy'],
      });
      if (parent) {
        json.series_recurrence_rule = parent.recurrence_rule || null;
        json.series_due_date = parent.due_date || null;
        json.series_miss_policy = parent.miss_policy || null;
      }
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

// ─── 헬퍼: #90 원본 출처 링크 빌드 (대화/메일/노트) ───
//  자동추출 업무가 어느 대화·메일에서 왔는지 라벨+상대경로 라우트로 반환.
//  business 격리 — 다른 워크스페이스 자원이면 null.
async function buildSourceRef(task) {
  try {
    const { Conversation, EmailThread } = require('../models');
    if (task.email_thread_id) {
      const th = await EmailThread.findByPk(task.email_thread_id, { attributes: ['id', 'subject', 'business_id'] }).catch(() => null);
      if (th && th.business_id === task.business_id) {
        return { type: 'email', id: th.id, label: th.subject || `mail ${th.id}`, route: `/mail?thread=${th.id}` };
      }
    }
    if (task.conversation_id) {
      const conv = await Conversation.findByPk(task.conversation_id, { attributes: ['id', 'title', 'business_id'] }).catch(() => null);
      if (conv && conv.business_id === task.business_id) {
        return { type: 'conversation', id: conv.id, label: conv.title || `chat ${conv.id}`, route: `/talk/${conv.id}` };
      }
    }
    if (task.qnote_session_id) {
      // Q Note 는 별도 서비스 — id 만 노출 (라우트 없음, 라벨만)
      return { type: 'meeting', id: task.qnote_session_id, label: `Q Note #${task.qnote_session_id}`, route: null };
    }
  } catch { /* best-effort — 실패해도 상세는 정상 */ }
  return null;
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
    const result = await executeForTask(task.id, { triggeredBy: req.user.id });
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
    // 댓글 생성·알림·Cue 재실행은 행동 계층이 소유한다 (services/actions/task_actions.js).
    const result = await taskActions.createComment(actorFrom(req), task, {
      content: req.body?.content,
      visibility: req.body?.visibility,
    });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
    return successResponse(res, result.data);
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
// GET /api/tasks/context — 대화·메일·프로젝트 컨텍스트의 업무 3분류
//   ?business_id= & (project_id | conversation_id | email_thread_id) & limit=8
//
// Q Talk 우측 패널 / Q Mail 맥락 패널이 같은 데이터를 본다 (두 화면 = 하나의 작업대).
// "업무를 추가했으면 그 자리에서 리스트도 보여야 한다" (Irene) — 프로젝트 업무 / 내 할 일 /
// 요청한 업무 3분류. 세 버킷은 겹칠 수 있다(내 할 일은 프로젝트 업무의 부분집합) — 관점이 다르다.
//
// 패널 하나 열 때 4~6번 왕복하던 것을 1회로. 각 버킷은 프리뷰(limit) + total.
// ============================================
router.get('/context', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id required', 400);

    const scope = await getUserScope(req.user.id, businessId);
    // 후보·요청 정보는 내부 자산 — 외부 고객에게는 이 섹션 자체를 주지 않는다
    if (!isMemberOrAbove(scope) && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const projectId = Number(req.query.project_id) || null;
    const conversationId = Number(req.query.conversation_id) || null;
    const emailThreadId = Number(req.query.email_thread_id) || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);

    // 스코프 where — 우선순위 project > conversation > email_thread
    let scopeWhere = null;
    let scopeKind = null;
    if (projectId) {
      const p = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
      if (!p) return errorResponse(res, 'project_not_found', 404);
      scopeWhere = { project_id: projectId };
      scopeKind = 'project';
    } else if (conversationId) {
      const { Conversation } = require('../models');
      const conv = await Conversation.findOne({ where: { id: conversationId, business_id: businessId }, attributes: ['id', 'project_id'] });
      if (!conv) return errorResponse(res, 'conversation_not_found', 404);
      // 대화가 프로젝트에 속하면 그 프로젝트 업무까지 (채팅 = 프로젝트의 창구)
      scopeWhere = conv.project_id
        ? { [Op.or]: [{ conversation_id: conversationId }, { project_id: conv.project_id }] }
        : { conversation_id: conversationId };
      scopeKind = 'conversation';
    } else if (emailThreadId) {
      const { EmailThread } = require('../models');
      const th = await EmailThread.findOne({ where: { id: emailThreadId, business_id: businessId }, attributes: ['id', 'project_id', 'client_id'] });
      if (!th) return errorResponse(res, 'thread_not_found', 404);
      // 메일이 프로젝트/고객에 연결돼 있으면 그 맥락의 업무까지 함께 (맥락 패널의 존재 이유)
      const ors = [{ email_thread_id: emailThreadId }];
      if (th.project_id) ors.push({ project_id: th.project_id });
      if (th.client_id) ors.push({ client_id: th.client_id });
      scopeWhere = ors.length > 1 ? { [Op.or]: ors } : ors[0];
      scopeKind = 'email_thread';
    } else {
      return errorResponse(res, 'scope required (project_id | conversation_id | email_thread_id)', 400);
    }

    const baseWhere = {
      business_id: businessId,
      ...scopeWhere,
      // 끝난 업무는 최근 7일만 (작업대는 지금 할 일을 보는 곳)
      [Op.and]: [{
        [Op.or]: [
          { status: { [Op.notIn]: ['completed', 'canceled'] } },
          { updated_at: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      }],
    };

    const include = [
      { model: Project, attributes: ['id', 'name'], required: false },
      { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
    ];
    const order = [['due_date', 'ASC'], ['id', 'DESC']];

    const myWhere = { ...baseWhere, assignee_id: req.user.id };
    const reqWhere = {
      ...baseWhere,
      [Op.and]: [
        ...baseWhere[Op.and],
        { [Op.or]: [{ request_by_user_id: req.user.id }, { created_by: req.user.id }] },
        { assignee_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: req.user.id }] } },
      ],
    };

    const [all, mine, requested] = await Promise.all([
      Task.findAndCountAll({ where: baseWhere, include, order, limit, distinct: true }),
      Task.findAndCountAll({ where: myWhere, include, order, limit, distinct: true }),
      Task.findAndCountAll({ where: reqWhere, include, order, limit, distinct: true }),
    ]);

    const serialize = (rows) => rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due_date: t.due_date,
      project_id: t.project_id,
      project_name: t.Project?.name || null,
      assignee_id: t.assignee_id,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      progress_percent: t.progress_percent,
    }));

    const data = {
      scope: scopeKind,
      project_tasks: { items: serialize(all.rows), total: all.count },
      my_tasks: { items: serialize(mine.rows), total: mine.count },
      requested: { items: serialize(requested.rows), total: requested.count },
    };
    // 리스트에 계정명이 새어 나오지 않게 — 워크스페이스 표시명 우선
    for (const key of ['project_tasks', 'my_tasks', 'requested']) {
      await applyMemberDisplayName(data[key].items, businessId, ['assignee']);
    }
    return successResponse(res, data);
  } catch (err) { next(err); }
});

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
    // 🔒 업무 후보는 내부 자산 — 외부 고객(client) 차단.
    //   assertBusinessAccess 는 client 도 통과시키는데(자기 task 조회용) 이 라우트는 그 뒤로
    //   클라이언트 스코핑이 전혀 없어, 고객이 참여하지도 않은 내부 대화의 후보(제목·설명·담당자 실명)를
    //   그대로 받아갔다. 형제 라우트(projects.js:2098)는 이미 client 403 — 여기만 누락돼 있었다.
    const { getUserScope: getScope, isMemberOrAbove } = require('../middleware/access_scope');
    const candScope = await getScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(candScope)) return errorResponse(res, 'forbidden', 403);
    const { TaskCandidate, Project: ProjectModel } = require('../models');
    const projs = await ProjectModel.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] });
    const projIds = projs.map(p => p.id);
    const projMap = new Map(projs.map(p => [p.id, p.name]));
    // ★ 프로젝트 축만 보면 **메일 후보가 영영 안 보인다**(project_id 없음). 실제로 그랬다 —
    //   메일에서 뽑은 후보는 그 스레드를 열었을 때의 우측 패널에서만 보였고, 업무 인박스에는
    //   한 번도 오지 않았다. 그래서 "만들어도 아무도 안 보는 후보" 가 된다.
    //   메일 후보는 business_id 로 직접 격리해 같이 모은다(Op.or 로 한 쿼리).
    //   ※ 프로젝트가 하나도 없어도 메일 후보는 있을 수 있으므로 조기 return 하지 않는다.
    const { EmailThread } = require('../models');
    const candWhere = projIds.length > 0
      ? { status: 'pending', [Op.or]: [{ project_id: projIds }, { business_id: businessId, email_thread_id: { [Op.ne]: null } }] }
      : { status: 'pending', business_id: businessId, email_thread_id: { [Op.ne]: null } };
    const cands = await TaskCandidate.findAll({
      where: candWhere,
      include: [
        { model: User, as: 'guessedAssignee', attributes: ['id', 'name', 'name_localized'], required: false },
        // 메일 후보의 맥락 — 어느 메일에서 나왔는지 보여주려면 제목이 필요하다.
        { model: EmailThread, attributes: ['id', 'subject', 'status'], required: false },
      ],
      order: [['extracted_at', 'DESC']],
      limit: 20,
    });
    const candsJson = cands
      // 보관·스팸 스레드의 후보는 올리지 않는다 (손 뗀 대화다)
      .filter(c => !c.EmailThread || !['archived', 'spam'].includes(String(c.EmailThread.status)))
      .map(c => ({
        ...c.toJSON(),
        project_name: projMap.get(c.project_id),
        // 출처 표시 — 화면이 "어디서 왔는지" 를 말할 수 있게
        source: c.email_thread_id ? 'mail' : 'chat',
        email_subject: c.EmailThread ? c.EmailThread.subject : null,
      }));
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
    const myIdSet = new Set(myTasks.map(t => t.id));
    // WORK_FLOW §6-C — task_ids 로 이번 주 업무 집합 스코핑 (없으면 전체 = 후방호환).
    //   안 좁히면 est_used/act_used 가 그 사용자의 *전체* 업무를 합산해 진척선이 비현실값(153h)으로 박힘.
    //   보안: 클라이언트가 보낸 id 도 본인 소유와 교집합만 인정.
    //   ★ #254 — 파라미터가 **있으면 빈 값이어도** scoped 다. 옛 코드는 빈 문자열을 "미지정" 으로 보고
    //     전체 업무로 폴백했는데, 그러면 "이번 주 대상 0건" 인 화면에 그 사용자의 전체 누적이 그려진다.
    const hasParam = req.query.task_ids != null;
    let ids;
    if (hasParam) {
      const requested = String(req.query.task_ids).split(',').map(Number).filter(Boolean);
      ids = requested.filter(id => myIdSet.has(id));   // 보안: 본인 소유와 교집합만
    } else {
      ids = [...myIdSet];
    }
    const scoped = hasParam;
    const taskIdSet = new Set(ids);
    // 포커스 세션이 있으면 task 없이도(이미 삭제 등) 실측은 보여야 하나, 표준 경로상 ids 기준 충분.

    // ── 모든 날짜 버킷 미리 생성 (스냅샷 없어도 구조 유지) ──
    const byDate = new Map();
    let cur = from;
    while (cur <= to) {
      byDate.set(cur, { date: cur, est_used: 0, act_used: 0, focus_hours: 0 });
      cur = addDaysStr(cur, 1);
    }

    // 업무별 기준선 (services/progressBaseline 단일 원천 — 보고서·주간보고와 같은 함수)
    const { baseAct, baseEst, estNow } = await getProgressBaselines(ids, from);

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
        // ★ 2026-08-24 (Irene 확정) — 두 선은 **같은 축(진행률)** 위에 있다:
        //     진척(예상시간) = 예측시간 × 진행률   /   실제 업무시간 = 실제시간 × 진행률
        //   기준선 차감(Δ)은 두 선에서 걷어냈다 — 실제시간을 아래로 정정하면 Δ 가 0 으로 클램프되어
        //   진행률 100% 인 업무가 그 주 내내 0 만 기여했다(운영 실측 #385). 정의는
        //   services/progressBaseline.js 가 정본이고 보고서·주간보고가 같은 함수를 쓴다.
        // ★ 예측 정정 면역은 유지 — 스냅샷에 박제된 옛 예측(est) 대신 **지금 예측**으로 환산한다.
        bucket.est_used += estDoneOf(estNow, s.task_id, s.progress_percent, est);
        bucket.act_used += actDoneOf(act, s.progress_percent);
      }
    }

    // ── 2) 포커스 실측 시간 (운영 #57/#58/#59) ──
    // 그래프 actual 라인의 핵심 = "포커스타임으로 측정된 실제 업무시간".
    // 스냅샷은 cron 아침 기준이라 진행중 업무에 그날 측정한 포커스 시간이 누락됨 →
    // FocusSession 실측값을 시작일(워크스페이스 tz) 에 귀속해 일별 합산. active 세션은 라이브(지금까지).
    // 누적(focusCum) 으로 만들어 프론트의 단조증가 actual 라인과 정합. snapshot actual 과 max → 포커스/수동 둘 다 보존.
    const { FocusSession } = require('../models');
    // ★ 2026-08-24 — 실제선이 `실제시간 × 진행률` 이 되었으므로 포커스 실측도 **같은 축으로 환산**한다.
    //   raw 시간을 그대로 더하면 오늘 점만 다른 단위가 섞여 선이 튄다.
    const progNow = new Map();
    if (ids.length > 0) {
      // business_id 를 같이 건다 — ids 는 이미 본인 소유와 교집합이지만 테넌트 스코프는 명시한다.
      const prRows = await Task.findAll({
        where: { id: ids, business_id: businessId },
        attributes: ['id', 'progress_percent'],
      });
      for (const r of prRows) progNow.set(Number(r.id), Number(r.progress_percent) || 0);
    }
    const focusSessions = await FocusSession.findAll({
      where: { user_id: req.user.id, business_id: businessId },
      // last_activity_at — #94 방치 캡(computeActualSeconds) 정확 적용 / task_id — §6-C 주별 스코핑.
      attributes: ['task_id', 'started_at', 'ended_at', 'state', 'pause_total_sec', 'paused_at', 'last_activity_at'],
    });
    for (const s of focusSessions) {
      // §6-C — 이번 주 업무 집합으로 스코핑된 경우, 그 집합의 task focus 만 계상 (무지정/타 업무 제외).
      if (scoped && !taskIdSet.has(s.task_id)) continue;
      const wd = dateStrInTz(s.started_at, tz);
      if (wd < from || wd > to) continue;
      const sec = typeof s.computeActualSeconds === 'function' ? s.computeActualSeconds() : 0;
      if (sec <= 0) continue;
      if (!byDate.has(wd)) byDate.set(wd, { date: wd, est_used: 0, act_used: 0, focus_hours: 0 });
      byDate.get(wd).focus_hours += (sec / 3600) * ((progNow.get(Number(s.task_id)) || 0) / 100);
    }

    // ── 3) actual 라인 계산 (정렬된 날짜 순) ──
    //   actual_hours 는 누적 running total(스냅샷이 매일 같은 누적값) + 포커스에서 자동 누적됨 → 스냅샷이 진실값(리스트와 동일).
    //   옛 버그 #101/#103: 주간 포커스 누적(focusCum)을 max 로 덮어써 리스트값(예: 4h)을 10.5h로 부풀리고,
    //   과거일에도 포커스 누적이 섞여 월/화가 같게 보임. → 스냅샷 누적을 단조 보정해 쓰고, 오늘만 아침 이후 라이브 포커스 가산.
    const todayStr = dateStrInTz(new Date(), tz);
    const sorted = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    let focusCum = 0;
    let actMax = 0;
    for (const b of sorted) {
      focusCum += b.focus_hours;
      actMax = Math.max(actMax, b.act_used);  // 스냅샷 누적 actual — 결측/감소 보정(단조 증가)
      const liveFocus = (b.date === todayStr) ? b.focus_hours : 0;  // 오늘만: 아침 스냅샷 이후 측정한 포커스 가산
      b.act_used = Math.round((actMax + liveFocus) * 10) / 10;
      b.focus_cumulative = Math.round(focusCum * 10) / 10;  // 참고용 유지(프론트 호환)
      b.est_used = Math.round(b.est_used * 10) / 10;
      delete b.focus_hours;
    }

    // 기준선은 **선 계산에서 빠졌다**(2026-08-24 Irene 정의). 여기 남는 이유는 하나 —
    //   프론트가 "진행률이 그 주 시작보다 내려갔다(되돌림)" 를 판정하는 데 쓴다.
    const bases = {};
    for (const id of ids) {
      const a = baseAct.get(Number(id)) || 0;
      const e = baseEst.get(Number(id)) || 0;
      if (a || e) bases[id] = { act: Math.round(a * 100) / 100, est_done: Math.round(e * 100) / 100 };
    }
    return successResponse(res, { days: sorted, bases });
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
      // SPA 라우트는 복수형 `/tasks` — 단수 `/task` 는 라우트가 없어 대시보드로 튕겼다
      appUrl: canAccess ? `/tasks?task=${task.id}` : null,
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
    const q = String(req.query.q || '').normalize('NFC').trim();   // #364 검색어 조합형 통일
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
