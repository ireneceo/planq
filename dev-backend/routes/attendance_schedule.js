// /api/attendance — 고정 근무 일정 · 지각/미출근 판정 · 사유/인정 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §4 · §6)
//
// 열람 범위(§6): 내 일정·내 판정 = 본인 · 남의 판정·사유 = owner/admin 만 · 일정 바꾸기·인정 = owner/admin.
//   판정 값은 소켓에 싣지 않는다 — 신호만(일정 = business 방 `attendance:schedule`, 사유·인정 = 본인 + 관리자 user 방).
// server.js 에서 routes/attendance.js · attendance_fix.js 뒤에 붙는다(경로는 서로 겹치지 않는다).
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');

const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const { AttendanceException, Business, BusinessMember } = require('../models');
const { requireMember, isManager } = require('../services/attendanceAccess');
const S = require('../services/attendanceSchedule');
const P = require('../services/attendancePunctuality');
const TR = require('../services/attendanceTracking');
const { addDaysStr, dateStrInTz } = require('../utils/datetime');

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  keyGenerator: (req) => (req.user?.id ? `attn-sched-u${req.user.id}` : `attn-sched-ip${ipKeyGenerator(req.ip)}`),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

// 사유·인정은 따로 센다 — 관리자가 미출근을 몰아서 인정할 때 일정 저장과 한 몫을 나눠 쓰면 막힌다(Fable 완료 검증 비차단 3)
const exceptionLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  keyGenerator: (req) => (req.user?.id ? `attn-exc-u${req.user.id}` : `attn-exc-ip${ipKeyGenerator(req.ip)}`),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

const REASON_WINDOW_DAYS = 14;   // 본인 수정 창과 같은 14일

function audit(action, { businessId, actorUserId, targetId, oldValue, newValue }) {
  require('../services/auditService').createAuditLog({
    action, targetType: action.startsWith('attendance.exception') ? 'attendance_exception' : 'attendance_schedule', targetId: targetId || null,
    userId: actorUserId, businessId, oldValue: oldValue || null, newValue: newValue || null,
  });
}
function io() { return global.__planqIo || null; }
async function managerIds(businessId) {
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } }, attributes: ['user_id'],
  });
  return rows.map((r) => r.user_id).filter(Boolean);
}
async function emitException(businessId, userId) {
  const s = io(); if (!s) return;
  for (const uid of new Set([userId, ...(await managerIds(businessId))])) {
    try { s.to(`user:${uid}`).emit('attendance:exception', { user_id: userId }); } catch { /* 신호 실패가 저장을 무르지 않는다 */ }
  }
}
function emitSchedule(businessId) {
  const s = io(); if (!s) return;
  try { s.to(`business:${businessId}`).emit('attendance:schedule', { business_id: businessId }); } catch { /* 신호만 */ }
}
function sendErr(res, next, err) {
  if (err && typeof err.code === 'string' && Number.isInteger(err.status)) return errorResponse(res, err.code, err.status);
  return next(err);
}

// ─── GET /schedule — 내 일정(멤버) · 전부(관리자) ───────────────────
router.get('/schedule', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const tz = await S.tzOf(businessId);
    const today = dateStrInTz(new Date(), tz);
    const rows = await S.loadAll(businessId);
    const r = S.resolveFrom(rows, req.user.id, today);
    const mine = { mode: r.mode, source: r.source, ...(r.row ? {
      schedule: r.row.schedule, grace_min: r.row.grace_min, half_day_at: r.row.half_day_at, effective_from: r.row.effective_from,
    } : { schedule: null, grace_min: 0, half_day_at: null, effective_from: null }) };
    mine.tracked = await TR.isTracked(businessId, req.user.id);
    const data = { today, mine, workspace: { current: S.currentOf(rows, null, today) } };
    if (isManager(scope)) {
      data.workspace.upcoming = S.upcomingOf(rows, null, today);
      const members = await BusinessMember.findAll({
        where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] }, user_id: { [Op.ne]: null } },
        attributes: ['user_id', 'attendance_tracked'],
        limit: 2000,   // 워크스페이스 멤버 수 상한 — 목록이 아니라 설정 화면 한 벌
      });
      data.members = members.map((m) => ({
        user_id: m.user_id,
        current: S.currentOf(rows, m.user_id, today),
        upcoming: S.upcomingOf(rows, m.user_id, today),
        effective: S.resolveFrom(rows, m.user_id, today).mode,
        tracked: m.attendance_tracked !== false,   // «출퇴근 기록» 스위치(services/attendanceTracking)
      }));
    }
    return successResponse(res, data);
  } catch (err) { return sendErr(res, next, err); }
});

async function managerOnly(req, res) {
  const businessId = Number(req.body.business_id || req.query.business_id);
  const scope = await requireMember(req, res, businessId);
  if (!scope) return null;
  if (!isManager(scope)) { errorResponse(res, 'forbidden', 403); return null; }
  return businessId;
}

// ─── PUT /schedule — 워크스페이스 기본 일정 (관리자 · 내일부터) ─────────
router.put('/schedule', authenticateToken, writeLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.schedule_change')
  try {
    const businessId = await managerOnly(req, res);
    if (!businessId) return;
    const { row, prev } = await S.save({ businessId, userId: null, actorUserId: req.user.id, payload: req.body || {} });
    audit('attendance.schedule_change', { businessId, actorUserId: req.user.id, targetId: row.id, oldValue: prev, newValue: row });
    emitSchedule(businessId);
    return successResponse(res, row);
  } catch (err) { return sendErr(res, next, err); }
});

// ─── PUT /schedule/members/:userId — 사람별 일정 (관리자) ─────────────
router.put('/schedule/members/:userId', authenticateToken, writeLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.schedule_member_change')
  try {
    const businessId = await managerOnly(req, res);
    if (!businessId) return;
    const userId = Number(req.params.userId);
    if (!userId) return errorResponse(res, 'invalid_user', 400);
    const { row, prev } = await S.save({ businessId, userId, actorUserId: req.user.id, payload: req.body || {} });
    audit('attendance.schedule_member_change', { businessId, actorUserId: req.user.id, targetId: row.id, oldValue: prev, newValue: row });
    emitSchedule(businessId);
    return successResponse(res, row);
  } catch (err) { return sendErr(res, next, err); }
});

// ─── PUT /members/:userId/tracking — 이 사람 «출퇴근 기록» 켜기/끄기 (관리자 · 바로 적용) ─────
//   docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md — 쓰는 문은 services/attendanceTracking.setTracked 한 곳.
router.put('/members/:userId/tracking', authenticateToken, writeLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.tracking_change')
  try {
    const businessId = await managerOnly(req, res);
    if (!businessId) return;
    const userId = Number(req.params.userId);
    if (!userId) return errorResponse(res, 'invalid_user', 400);
    if (typeof req.body?.tracked !== 'boolean') return errorResponse(res, 'invalid_tracked', 400);
    const scope = await require('../middleware/access_scope').getUserScope(req.user.id, businessId, req.user.role);
    const r = await TR.setTracked({
      businessId, userId, tracked: req.body.tracked, actorUserId: req.user.id,
      actorIsOwner: !!scope.isOwner, actorIsPlatformAdmin: !!scope.isPlatformAdmin,
    });
    if (r.changed) {
      audit('attendance.tracking_change', {
        businessId, actorUserId: req.user.id, targetId: userId,
        oldValue: { user_id: userId, tracked: r.prev }, newValue: { user_id: userId, tracked: r.tracked, closed_day_ids: r.closedDayIds },
      });
      emitSchedule(businessId);
      const s = io();
      if (s) { try { s.to(`user:${userId}`).emit('attendance:tracking', { business_id: businessId }); } catch { /* 신호만 */ } }
    }
    return successResponse(res, { user_id: userId, tracked: r.tracked, closed_day_ids: r.closedDayIds });
  } catch (err) { return sendErr(res, next, err); }
});

// ─── DELETE /schedule/:id — 예정 취소 (시작 전 행만) ────────────────
router.delete('/schedule/:id', authenticateToken, writeLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.schedule_cancel')
  try {
    const businessId = await managerOnly(req, res);
    if (!businessId) return;
    const { prev } = await S.cancel({ businessId, id: Number(req.params.id) });
    audit('attendance.schedule_cancel', { businessId, actorUserId: req.user.id, targetId: prev.id, oldValue: prev, newValue: null });
    emitSchedule(businessId);
    return successResponse(res, { canceled: true });
  } catch (err) { return sendErr(res, next, err); }
});

// ─── GET /punctuality — 문제 있는 날만 (본인 / 관리자 전원) ─────────────
//   행 없는 미출근 날도 여기서 나온다(근태 행이 없어 /my·/team 에는 없다).
router.get('/punctuality', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return errorResponse(res, 'invalid_range', 400);
    if (addDaysStr(from, P.MAX_RANGE_DAYS - 1) < to) return errorResponse(res, 'range_too_long', 400);
    let userIds = null;
    const wanted = req.query.user_id ? Number(req.query.user_id) : null;
    if (!isManager(scope)) {
      if (wanted && wanted !== req.user.id) return errorResponse(res, 'forbidden', 403);
      userIds = [req.user.id];
    } else if (wanted) userIds = [wanted];
    const { anyFixed, results, dayIdOf } = await P.judgeDays({ businessId, userIds, from, to });
    const out = [];
    for (const [key, punct] of results) {
      if (!P.hasIssue(punct)) continue;
      const [uid, date] = key.split('|');
      out.push({ user_id: Number(uid), work_date: date, day_id: dayIdOf.get(key) || null, punct });
    }
    out.sort((a, b) => (a.work_date === b.work_date ? a.user_id - b.user_id : (a.work_date < b.work_date ? 1 : -1)));
    return successResponse(res, { fixed: anyFixed, items: out });
  } catch (err) { return sendErr(res, next, err); }
});

/** 그날 판정 하나(사유·인정 전에 «판정 대상이고 문제 있는 날» 인지 본다). */
async function punctOf(businessId, userId, date) {
  const { results } = await P.judgeDays({ businessId, userIds: [userId], from: date, to: date });
  return results.get(`${userId}|${date}`) || null;
}

// ─── POST /exceptions/reason — 본인 사유 (14일 안) ───────────────────
router.post('/exceptions/reason', authenticateToken, exceptionLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.exception_reason')
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const date = String(req.body.work_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(res, 'invalid_date', 400);
    const today = dateStrInTz(new Date(), await S.tzOf(businessId));
    if (date > today || date < addDaysStr(today, -REASON_WINDOW_DAYS)) return errorResponse(res, 'out_of_window', 400);
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) return errorResponse(res, 'reason_required', 400);
    const p = await punctOf(businessId, req.user.id, date);
    if (!P.hasIssue(p)) return errorResponse(res, 'no_issue', 409);
    const where = { business_id: businessId, user_id: req.user.id, work_date: date };
    const [row] = await AttendanceException.findOrCreate({ where, defaults: where });
    const prev = { reason: row.reason || null };
    await row.update({ reason, reason_at: new Date() });
    audit('attendance.exception_reason', { businessId, actorUserId: req.user.id, targetId: row.id, oldValue: prev, newValue: { work_date: date, reason } });
    emitException(businessId, req.user.id);
    return successResponse(res, { work_date: date, reason });
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /exceptions/excuse — 관리자 인정/취소 (자기 자신 ✕, 대표는 가능) ──
router.post('/exceptions/excuse', authenticateToken, exceptionLimiter, async (req, res, next) => { // audit-exempt: 감사는 아래 audit('attendance.exception_excuse')
  try {
    const businessId = await managerOnly(req, res);
    if (!businessId) return;
    const userId = Number(req.body.user_id);
    const date = String(req.body.work_date || '').slice(0, 10);
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(res, 'invalid_input', 400);
    if (userId === req.user.id) {
      const biz = await Business.findByPk(businessId, { attributes: ['owner_id'] });
      if (biz?.owner_id !== req.user.id) return errorResponse(res, 'self_excuse_not_allowed', 403);
    }
    // 이 워크스페이스 멤버(빠진 사람 포함 — 지난 기록 인정)만 — 없는 사람에게 빈 행을 만들지 않는다(Fable 비차단 1)
    const member = await BusinessMember.unscoped().findOne({
      where: { business_id: businessId, user_id: userId, role: { [Op.in]: ['owner', 'admin', 'member'] } }, attributes: ['id'],
    });
    if (!member) return errorResponse(res, 'member_not_found', 404);
    const excused = !!req.body.excused;
    const note = req.body.note ? String(req.body.note).trim().slice(0, 300) : null;
    const p = await punctOf(businessId, userId, date);
    if (excused && !P.hasIssue(p)) return errorResponse(res, 'no_issue', 409);
    const where = { business_id: businessId, user_id: userId, work_date: date };
    const [row] = await AttendanceException.findOrCreate({ where, defaults: where });
    const prev = { excused: !!row.excused, excuse_note: row.excuse_note || null };
    await row.update(excused
      ? { excused: true, excused_by: req.user.id, excused_at: new Date(), excuse_note: note }
      : { excused: false, excused_by: req.user.id, excused_at: new Date(), excuse_note: note });
    audit('attendance.exception_excuse', { businessId, actorUserId: req.user.id, targetId: row.id, oldValue: prev, newValue: { user_id: userId, work_date: date, excused, excuse_note: note } });
    emitException(businessId, userId);
    return successResponse(res, { user_id: userId, work_date: date, excused });
  } catch (err) { return sendErr(res, next, err); }
});

module.exports = router;
