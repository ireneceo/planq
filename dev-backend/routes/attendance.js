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
    return successResponse(res, { work_date: workDate, state: day.state, day: serializeDay(day, live) });
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
      attributes: ['id', 'kind', 'at', 'source', 'actor_user_id', 'fix_reason'],
    });
    return successResponse(res, events);
  } catch (err) { next(err); }
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
