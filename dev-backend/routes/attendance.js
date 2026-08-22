// /api/attendance — 출퇴근 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §5.1 · §6
//
// 열람 범위(§6)가 이 파일의 핵심이다:
//   · 내 시각·근무시간 → 본인 + owner/admin
//   · 동료 → **상태 뱃지만** (근무중/휴게중/퇴근). 시각·누계는 절대 나가지 않는다.
//   두 용도가 같은 serializer 를 쓰면 언젠가 필드 하나가 새어 나간다 → serializer 를 아예 분리한다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');

const { authenticateToken } = require('../middleware/auth');
const { getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../utils/response');
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { AttendanceDay, AttendanceEvent, User, BusinessMember, LeaveRequest } = require('../models');
const A = require('../services/attendanceTransition');
const { ymd } = require('../utils/datetime');

const clockLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: (req) => (req.user?.id ? `attn-u${req.user.id}` : `attn-ip${ipKeyGenerator(req.ip)}`),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '출퇴근 기록을 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' },
});

/** 멤버십 확인. client·ai 는 근태 대상이 아니다 — 전부 403. */
async function requireMember(req, res, businessId) {
  if (!businessId) { errorResponse(res, 'business_id_required', 400); return null; }
  const scope = await getUserScope(req.user.id, Number(businessId), req.user.role);
  if (!(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return scope;
}
const isManager = (scope) => !!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin);

// 본인·관리자용 — 시각과 누계를 포함한다.
function serializeDay(day, live) {
  return {
    id: day.id,
    user_id: day.user_id,
    work_date: ymd(day.work_date),
    state: day.state,
    clock_in_at: day.clock_in_at,
    clock_out_at: day.clock_out_at,
    break_started_at: day.break_started_at,
    work_sec: live ? live.work_sec : Number(day.work_total_sec || 0),
    break_sec: live ? live.break_sec : Number(day.break_total_sec || 0),
    auto_closed: !!day.auto_closed,
    admin_fixed: !!day.admin_fixed,
    note: day.note || null,
  };
}
// 동료용 — 상태 하나뿐. 여기에 필드를 더하려면 §6 을 먼저 고쳐야 한다.
function serializePresence(userId, state, onLeave) {
  return { user_id: userId, state, on_leave_today: !!onLeave };
}

// ─── GET /today ─────────────────────────────────────────────────
router.get('/today', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const workDate = await A.todayFor(businessId);
    const day = await AttendanceDay.findOne({
      where: { business_id: businessId, user_id: req.user.id, work_date: workDate },
    });
    if (!day) return successResponse(res, { work_date: workDate, state: null, day: null });
    const live = await A.liveTotals(day);
    // #208 — 자동으로 출근 처리된 경우 그 사실을 화면에 알린다.
    //   시스템이 사용자 대신 상태를 바꿨으면 **말없이 두지 않는다** — 나중에 기록을 보고
    //   "내가 언제 출근을 눌렀지?" 가 되면 그 기록 전체를 믿지 못하게 된다.
    //   되돌릴 수 있는 조건(아래 undo-auto)까지 같이 내려서, 화면이 버튼을 띄울지 스스로 정한다.
    const auto = await A.autoClockInNotice(day);
    return successResponse(res, {
      work_date: workDate, state: day.state, day: serializeDay(day, live), auto_notice: auto,
    });
  } catch (err) { next(err); }
});

// ─── 전이 4종 ───────────────────────────────────────────────────
// 본문은 한 벌이지만 **등록은 네 줄 그대로** 쓴다. 래퍼 안에 경로를 숨기면
//   grep 으로도 정적 검사(scripts/guard-invariants spalink)로도 이 경로가 보이지 않는다.
function clockHandler(fn) {
  return async (req, res, next) => {
    try {
      const businessId = Number(req.body.business_id);
      const scope = await requireMember(req, res, businessId);
      if (!scope) return;
      const day = await fn({ businessId, userId: req.user.id, actorUserId: req.user.id });
      const live = await A.liveTotals(day);
      return successResponse(res, serializeDay(day, live));
    } catch (err) {
      if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
      next(err);
    }
  };
}
router.post('/clock-in', authenticateToken, clockLimiter, clockHandler(A.clockIn));
router.post('/break-start', authenticateToken, clockLimiter, clockHandler(A.breakStart));
router.post('/break-end', authenticateToken, clockLimiter, clockHandler(A.breakEnd));
router.post('/clock-out', authenticateToken, clockLimiter, clockHandler(A.clockOut));

// ─── GET /my ────────────────────────────────────────────────────
router.get('/my', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId, user_id: req.user.id };
    if (req.query.from && req.query.to) where.work_date = { [Op.between]: [req.query.from, req.query.to] };
    const { rows, count } = await AttendanceDay.findAndCountAll({
      where, order: [['work_date', 'DESC']], limit, offset,
    });
    return paginatedResponse(res, rows.map((d) => serializeDay(d)), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /team (owner/admin) ────────────────────────────────────
router.get('/team', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (req.query.date) where.work_date = req.query.date;
    else if (req.query.from && req.query.to) where.work_date = { [Op.between]: [req.query.from, req.query.to] };
    const { rows, count } = await AttendanceDay.findAndCountAll({
      where, order: [['work_date', 'DESC'], ['user_id', 'ASC']], limit, offset,
    });
    return paginatedResponse(res, rows.map((d) => serializeDay(d)), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /presence (멤버 전원 — 뱃지만) ─────────────────────────
router.get('/presence', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const workDate = await A.todayFor(businessId);
    const days = await AttendanceDay.findAll({
      where: { business_id: businessId, work_date: workDate },
      attributes: ['user_id', 'state'],
    });
    // 오늘 승인된 휴가 — 이것도 뱃지 한 칸이다("휴가중인 줄 모르고 컨펌 요청" 방지, §6).
    const leaves = await LeaveRequest.findAll({
      where: {
        business_id: businessId, status: 'approved',
        start_date: { [Op.lte]: workDate }, end_date: { [Op.gte]: workDate },
      },
      attributes: ['user_id'],
    });
    const onLeave = new Set(leaves.map((l) => l.user_id));
    const byUser = new Map(days.map((d) => [d.user_id, d.state]));
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null },
      attributes: ['user_id'],
    });
    const out = members.map((m) => serializePresence(m.user_id, byUser.get(m.user_id) || null, onLeave.has(m.user_id)));
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// ─── PATCH /days/:id — 관리자 정정 ──────────────────────────────
router.patch('/days/:id', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const updated = await A.applyAdminFix({
      dayId: day.id,
      events: req.body.events,
      fixReason: req.body.fix_reason,
      actorUserId: req.user.id,
    });
    return successResponse(res, serializeDay(updated));
  } catch (err) {
    if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

// ─── PATCH /days/:id/note — 본인 메모 ───────────────────────────
router.patch('/days/:id/note', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (day.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    await day.update({ note: (req.body.note || '').slice(0, 500) || null });
    return successResponse(res, serializeDay(day));
  } catch (err) { next(err); }
});

// ─── GET /days/:id/events — 원장 (본인·관리자) ─────────────────
router.get('/days/:id/events', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (day.user_id !== req.user.id && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const events = await AttendanceEvent.findAll({
      // 스코프: 위에서 day 의 business_id 로 멤버십을 확인했다(canAccess 상위 검사).
      where: { attendance_day_id: day.id },
      order: [['at', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'kind', 'at', 'source', 'actor_user_id', 'fix_reason', 'superseded_at'],
    });
    return successResponse(res, events);
  } catch (err) { next(err); }
});

// ─── GET /stats — 월별 통계 (§8.1) ──────────────────────────────
// owner/admin 은 전원, member 는 본인만. member 가 남의 수치를 보는 길은 여기에도 없다.
//
// ★ overtime 은 **참고치**다. 법정 연장근로가 아니라 "그날 기준시간을 얼마나 넘겼나" 일 뿐이고,
//   유연근무라 어떤 날은 넘고 어떤 날은 모자란 것이 정상이다. 화면 라벨에도 그렇게 적는다.
router.get('/stats', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? String(req.query.month)
      : (await A.todayFor(businessId)).slice(0, 7);
    const from = `${month}-01`;
    const to = (() => {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m, 0));     // 그 달의 마지막 날
      return d.toISOString().slice(0, 10);
    })();

    const manager = isManager(scope);
    const where = { business_id: businessId, work_date: { [Op.between]: [from, to] } };
    if (!manager) where.user_id = req.user.id;

    const days = await AttendanceDay.findAll({
      where,
      attributes: ['user_id', 'work_date', 'clock_in_at', 'clock_out_at', 'work_total_sec', 'break_total_sec', 'auto_closed'],
    });

    // 근무 기준시간·부서는 멤버 설정에서 온다 — 초과 판정의 분모다.
    const memberWhere = { business_id: businessId, removed_at: null };
    if (!manager) memberWhere.user_id = req.user.id;
    const members = await BusinessMember.findAll({
      where: memberWhere,
      attributes: ['user_id', 'daily_work_hours', 'department_id'],
    });
    const byUser = new Map(members.map((m) => [m.user_id, m]));

    // 승인된 휴가 — 유급·무급을 나눠 센다(무급은 잔여를 깎지 않는다).
    const leaveWhere = {
      business_id: businessId, status: 'approved',
      start_date: { [Op.lte]: to }, end_date: { [Op.gte]: from },
    };
    if (!manager) leaveWhere.user_id = req.user.id;
    const leaves = await LeaveRequest.findAll({
      where: leaveWhere,
      attributes: ['user_id', 'leave_type', 'days_charged'],
    });

    const acc = new Map();
    const row = (uid) => {
      if (!acc.has(uid)) {
        acc.set(uid, {
          user_id: uid, work_days: 0, work_sec: 0, break_sec: 0,
          overtime_sec: 0, auto_closed_count: 0,
          in_minutes: [], out_minutes: [],
          leave_used_paid: 0, leave_used_unpaid: 0,
          department_id: byUser.get(uid)?.department_id || null,
        });
      }
      return acc.get(uid);
    };
    const minutesOf = (dt) => {
      if (!dt) return null;
      const d = new Date(dt);
      return d.getHours() * 60 + d.getMinutes();
    };
    for (const d of days) {
      const r = row(d.user_id);
      r.work_days += 1;
      r.work_sec += Number(d.work_total_sec || 0);
      r.break_sec += Number(d.break_total_sec || 0);
      if (d.auto_closed) r.auto_closed_count += 1;
      const dailySec = (Number(byUser.get(d.user_id)?.daily_work_hours) || 8) * 3600;
      r.overtime_sec += Math.max(0, Number(d.work_total_sec || 0) - dailySec);
      const mi = minutesOf(d.clock_in_at);
      if (mi !== null) r.in_minutes.push(mi);
      const mo = minutesOf(d.clock_out_at);
      if (mo !== null) r.out_minutes.push(mo);
    }
    for (const l of leaves) {
      const r = row(l.user_id);
      if (l.leave_type === 'paid') r.leave_used_paid += Number(l.days_charged || 0);
      else r.leave_used_unpaid += Number(l.days_charged || 0);
    }

    const avg = (arr) => {
      if (!arr.length) return null;
      const m = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    const round1 = (n) => Math.round(n * 10) / 10;
    const out = [...acc.values()].map((r) => ({
      user_id: r.user_id,
      department_id: r.department_id,
      work_days: r.work_days,
      work_hours: round1(r.work_sec / 3600),
      break_hours: round1(r.break_sec / 3600),
      overtime_hours: round1(r.overtime_sec / 3600),
      avg_clock_in: avg(r.in_minutes),
      avg_clock_out: avg(r.out_minutes),
      auto_closed_count: r.auto_closed_count,
      leave_used_paid: round1(r.leave_used_paid),
      leave_used_unpaid: round1(r.leave_used_unpaid),
    })).sort((a, b) => b.work_hours - a.work_hours);

    // 부서 롤업 — 부서가 없는 멤버는 묶지 않는다(없는 소속을 만들어내지 않는다).
    const deptAcc = new Map();
    for (const r of out) {
      if (!r.department_id) continue;
      const d = deptAcc.get(r.department_id) || { department_id: r.department_id, members: 0, work_hours: 0, overtime_hours: 0, leave_used_paid: 0 };
      d.members += 1;
      d.work_hours += r.work_hours;
      d.overtime_hours += r.overtime_hours;
      d.leave_used_paid += r.leave_used_paid;
      deptAcc.set(r.department_id, d);
    }
    const departments = [...deptAcc.values()].map((d) => ({
      ...d,
      work_hours: round1(d.work_hours),
      overtime_hours: round1(d.overtime_hours),
      leave_used_paid: round1(d.leave_used_paid),
    }));

    return successResponse(res, { month, from, to, scope: manager ? 'team' : 'me', members: out, departments });
  } catch (err) { next(err); }
});

// ─── POST /undo-auto-clock-in — 자동 출근 되돌리기 ─────────────
//   업무를 시작해서 자동으로 출근 처리됐는데 그게 아니었을 때(잘못 눌렀다·남의 업무를 정리했다 등).
//   ★ 사용자가 스스로 한 행동이 하나라도 섞여 있으면 되돌리지 않는다 — 그건 되돌리기가 아니라
//     기록 삭제다. 그 경우는 관리자 정정으로 간다.
router.post('/undo-auto-clock-in', authenticateToken, clockLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const day = await A.undoAutoClockIn({ businessId, userId: req.user.id });
    return successResponse(res, { undone: !!day });
  } catch (err) {
    if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

// ─── GET/PUT /settings — 개인 설정 ─────────────────────────────
router.get('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id, { attributes: ['auto_clock_in_on_focus'] });
    return successResponse(res, { auto_clock_in_on_focus: u?.auto_clock_in_on_focus !== false });
  } catch (err) { next(err); }
});
router.put('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    if (!u) return errorResponse(res, 'not_found', 404);
    await u.update({ auto_clock_in_on_focus: !!req.body.auto_clock_in_on_focus });
    return successResponse(res, { auto_clock_in_on_focus: !!u.auto_clock_in_on_focus });
  } catch (err) { next(err); }
});

module.exports = router;
