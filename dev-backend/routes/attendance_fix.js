// /api/attendance — 본인 수정 요청 · 어제 퇴근 확인 · 출근 묻기 답 · 관리자 확인/승인 설정
//   설계: docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §4·§5·§6 · 요청 처리 본체는 services/attendanceFix 한 곳.
//   ★ routes/attendance.js 와 같은 접두어에 **뒤에** 붙는다(server.js). 두 파일에 같은 경로를 두지 않는다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { AttendanceDay, AttendanceFixRequest, Business } = require('../models');
const A = require('../services/attendanceTransition');
const F = require('../services/attendanceFix');
const P = require('../services/attendancePrompt');
const { requireMember, isManager, serializeDay } = require('../services/attendanceAccess');
const { ymd } = require('../utils/datetime');

const fixLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  keyGenerator: (req) => (req.user?.id ? `attnfix-u${req.user.id}` : `attnfix-ip${ipKeyGenerator(req.ip)}`),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '근태 요청을 너무 자주 보냈습니다. 잠시 후 다시 시도하세요.' },
});

const SELF_FIX_WINDOW_DAYS = 14;

/** 내 다른 기기·창이 묻는 창을 닫게 — 내 개인 방에 신호만. */
function pingSelf(userId) {
  const io = A.getIO();
  if (io) { try { io.to(`user:${userId}`).emit('attendance:fix_updated', { request_id: null }); } catch { /* 신호 실패는 무시 */ } }
}

function sendErr(res, next, err) {
  if (err && typeof err.code === 'string' && Number.isInteger(err.status)) return errorResponse(res, err.code, err.status);
  return next(err);
}

/** 본인 하루 + 14일 창 확인. 실패면 응답하고 null. */
async function ownRecentDay(req, res) {
  const day = await AttendanceDay.findByPk(Number(req.params.id));
  if (!day) { errorResponse(res, 'not_found', 404); return null; }
  const scope = await requireMember(req, res, day.business_id);
  if (!scope) return null;
  if (day.user_id !== req.user.id) { errorResponse(res, 'forbidden', 403); return null; }
  const workDate = new Date(`${ymd(day.work_date)}T00:00:00Z`);
  if (Math.floor((Date.now() - workDate.getTime()) / 86400000) > SELF_FIX_WINDOW_DAYS) {
    errorResponse(res, 'self_fix_window_expired', 400); return null;
  }
  return day;
}

// ─── PATCH /days/:id/correct — **본인 정정** (운영 #392 · 이 설계 §5·§6) ─────────────
//   #392 의 판단(«승인자가 사실을 확인할 방법이 없다 · 실무가 막힌다»)은 그대로라 기본은 바로 반영이다.
//   워크스페이스가 설정 «본인 수정은 승인 후 반영» 을 켰을 때만 승인 대기가 생긴다(docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md).
//   가드: 본인 기록만 · 사유 필수 · 최근 14일 이내만 · 미래 시각 금지.
router.patch('/days/:id/correct', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.submit(attendance.fix_request) · applyAdminFix(attendance.admin_fix) 가 쓴다
  try {
    const day = await ownRecentDay(req, res);
    if (!day) return;
    const events = Array.isArray(req.body.events) ? req.body.events : [];
    const now = Date.now();
    for (const e of events) {
      const at = new Date(e?.at);
      if (Number.isNaN(at.getTime())) return errorResponse(res, 'invalid_at', 400);
      if (at.getTime() > now + 60 * 1000) return errorResponse(res, 'future_time_not_allowed', 400);
    }
    if (!events.length) return errorResponse(res, 'events_required', 400);
    const r = await F.submit({
      day, userId: req.user.id, origin: 'manual',
      events: events.map((e) => ({ kind: e.kind, at: new Date(e.at).toISOString() })),
      reason: req.body.fix_reason, ioApp: req.app,
    });
    const live = await A.liveTotals(r.day);
    return successResponse(res, { ...serializeDay(r.day, live), pending: r.pending, request_id: r.request.id });
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /days/:id/confirm-close — 어제 자동 마감 «맞아요» (§4.1) ─────────────
router.post('/days/:id/confirm-close', authenticateToken, fixLimiter, async (req, res, next) => {
  try {
    const day = await ownRecentDay(req, res);
    if (!day) return;
    if (!day.auto_closed) return errorResponse(res, 'not_auto_closed', 400);
    if (!day.close_confirmed_at) {
      await day.update({ close_confirmed_at: new Date() });
      require('../services/auditService').createAuditLog({
        action: 'attendance.close_confirm', targetType: 'attendance_day', targetId: day.id,
        userId: req.user.id, businessId: day.business_id, oldValue: null,
        newValue: { clock_out_at: day.clock_out_at },
      });
    }
    pingSelf(req.user.id);
    return successResponse(res, serializeDay(day));
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /days/:id/fix-close — 어제 퇴근 «시각 고치기» (§4.1) ─────────────
//   마지막 퇴근 하나만 바꾼다. 사유는 자동(«퇴근 누락 — 다음 날 확인»).
router.post('/days/:id/fix-close', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.submit 가 쓴다
  try {
    const day = await ownRecentDay(req, res);
    if (!day) return;
    // 자동 마감된 날만 — 정상 퇴근한 날의 시각은 정정 창(사유 필수·관리자 알림)으로 고친다(Fable 완료 검증 B2).
    if (!day.auto_closed) return errorResponse(res, 'not_auto_closed', 400);
    if (day.state !== 'done' || !day.clock_out_at) return errorResponse(res, 'not_closed', 400);
    const at = new Date(req.body.at);
    if (Number.isNaN(at.getTime())) return errorResponse(res, 'invalid_at', 400);
    if (at.getTime() > Date.now() + 60 * 1000) return errorResponse(res, 'future_time_not_allowed', 400);
    if (at <= new Date(day.clock_in_at)) return errorResponse(res, 'out_before_in', 400);
    // 상한 = 그 근무일 다음 자정(자동 마감과 같은 상한) — 나머지 범위 검사는 submit 의 validateTimeline 이 한다.
    const r = await F.submit({
      day, userId: req.user.id, origin: 'prompt_out',
      events: [{ kind: 'clock_out', at: at.toISOString() }],
      reason: String(req.body.reason || '').trim() || '퇴근 누락 — 다음 날 확인', ioApp: req.app,
    });
    return successResponse(res, { ...serializeDay(r.day), pending: r.pending, request_id: r.request.id });
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /prompt-answer — 출근 묻기 «아직이에요»·«오늘은 안 해요» (§3.3) ─────────────
router.post('/prompt-answer', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 묻기 답(아직·오늘은 안 해요)은 기록 변경이 아니다(설계 §7)
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const r = await P.answerPrompt({ businessId, userId: req.user.id, answer: req.body.answer });
    pingSelf(req.user.id);
    return successResponse(res, r);
  } catch (err) { return sendErr(res, next, err); }
});

// ─── GET /fix-requests — 본인(mine) / 대표·관리자(all) ─────────────
router.get('/fix-requests', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const all = req.query.scope === 'all';
    if (all && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (!all) where.user_id = req.user.id;
    if (req.query.status) {
      const list = String(req.query.status).split(',').filter((s) => F.STATUSES.includes(s));
      if (list.length) where.status = list;
    }
    if (req.query.date) where.work_date = String(req.query.date).slice(0, 10);
    const { rows, count } = await AttendanceFixRequest.findAndCountAll({
      where, order: [['created_at', 'DESC'], ['id', 'DESC']], limit, offset,
    });
    // 고정 근무면 «지각 25분 → 정상» 처럼 판정 변화를 붙인다(docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §5.4)
    const list = await require('../services/attendancePunctuality').attachToFixRequests(businessId, await F.serializeList(rows, businessId));
    return paginatedResponse(res, list, count, { limit, page, offset });
  } catch (err) { return sendErr(res, next, err); }
});

async function managerScope(req, res) {
  const businessId = Number(req.body.business_id);
  const scope = await requireMember(req, res, businessId);
  if (!scope) return null;
  if (!isManager(scope)) { errorResponse(res, 'forbidden', 403); return null; }
  return businessId;
}

// ─── POST /fix-requests/confirm — «확인함» (끔 모드, 여러 건) ─────────────
router.post('/fix-requests/confirm', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.confirm(attendance.fix_confirm) 가 쓴다
  try {
    const businessId = await managerScope(req, res);
    if (!businessId) return;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500) : [];
    if (!ids.length) return errorResponse(res, 'ids_required', 400);
    return successResponse(res, await F.confirm({ businessId, ids, actorUserId: req.user.id }));
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /fix-requests/:id/approve · /reject (켬 모드) ─────────────
router.post('/fix-requests/:id/approve', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.approve 가 쓴다
  try {
    const businessId = await managerScope(req, res);
    if (!businessId) return;
    const r = await F.approve({ businessId, id: req.params.id, actorUserId: req.user.id, decideNote: req.body.decide_note, ioApp: req.app });
    return successResponse(res, (await F.serializeList([r.request], businessId))[0]);
  } catch (err) { return sendErr(res, next, err); }
});
router.post('/fix-requests/:id/reject', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.reject 가 쓴다
  try {
    const businessId = await managerScope(req, res);
    if (!businessId) return;
    const r = await F.reject({ businessId, id: req.params.id, actorUserId: req.user.id, decideNote: req.body.decide_note, ioApp: req.app });
    return successResponse(res, (await F.serializeList([r.request], businessId))[0]);
  } catch (err) { return sendErr(res, next, err); }
});

// ─── POST /fix-requests/:id/withdraw — 본인이 대기를 거둔다 ─────────────
router.post('/fix-requests/:id/withdraw', authenticateToken, fixLimiter, async (req, res, next) => { // audit-exempt: 감사는 services/attendanceFix.withdraw 가 쓴다
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const r = await F.withdraw({ businessId, id: req.params.id, userId: req.user.id });
    return successResponse(res, (await F.serializeList([r.request], businessId))[0]);
  } catch (err) { return sendErr(res, next, err); }
});

// ─── GET/PUT /fix-settings — 설정 «본인 수정은 승인 후 반영» (대표·관리자) ─────────────
router.get('/fix-settings', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const b = await Business.findByPk(businessId, { attributes: ['attendance_fix_approval'] });
    const pending = await AttendanceFixRequest.count({ where: { business_id: businessId, status: 'pending' } });
    const unconfirmed = await AttendanceFixRequest.count({ where: { business_id: businessId, status: 'applied' } });
    return successResponse(res, { attendance_fix_approval: !!b?.attendance_fix_approval, pending, unconfirmed });
  } catch (err) { return sendErr(res, next, err); }
});
router.put('/fix-settings', authenticateToken, fixLimiter, async (req, res, next) => {
  try {
    const businessId = await managerScope(req, res);
    if (!businessId) return;
    const b = await Business.findByPk(businessId);
    const prev = !!b.attendance_fix_approval;
    const next_ = !!req.body.attendance_fix_approval;
    if (prev !== next_) {
      await b.update({ attendance_fix_approval: next_ });
      require('../services/auditService').createAuditLog({
        action: 'attendance.fix_settings', targetType: 'business', targetId: businessId,
        userId: req.user.id, businessId, oldValue: { attendance_fix_approval: prev }, newValue: { attendance_fix_approval: next_ },
      });
    }
    // 켬→끔 이어도 이미 대기 중인 건은 그대로 대기(승인/반려 가능) — 화면에 «대기 n건» 을 보인다.
    const pending = await AttendanceFixRequest.count({ where: { business_id: businessId, status: 'pending' } });
    return successResponse(res, { attendance_fix_approval: next_, pending });
  } catch (err) { return sendErr(res, next, err); }
});

module.exports = router;
