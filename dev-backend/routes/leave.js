// /api/leave — 휴가 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §5.2
//
// 상태를 바꾸는 일은 전부 services/leaveTransition.js 로 넘긴다. 이 파일은 권한과 입출력만 맡는다
//   — 라우트가 직접 status 를 고치기 시작하면 알림·감사·잔여 검사가 경로마다 갈라진다.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const { authenticateToken } = require('../middleware/auth');
const { getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../utils/response');
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { LeaveGrant, LeaveRequest, AuditLog } = require('../models');
const L = require('../services/leaveTransition');
const { ymd } = require('../utils/datetime');

async function requireMember(req, res, businessId) {
  if (!businessId) { errorResponse(res, 'business_id_required', 400); return null; }
  const scope = await getUserScope(req.user.id, Number(businessId), req.user.role);
  if (!(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return scope;
}
const isManager = (scope) => !!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin);

function serializeRequest(r) {
  return {
    id: r.id, user_id: r.user_id, leave_type: r.leave_type, unit: r.unit,
    start_date: ymd(r.start_date), end_date: ymd(r.end_date), half_kind: r.half_kind,
    hours: r.hours === null ? null : Number(r.hours),
    days_charged: Number(r.days_charged || 0),
    reason: r.reason, status: r.status,
    decided_by: r.decided_by, decided_at: r.decided_at, decide_note: r.decide_note,
    canceled_at: r.canceled_at,
    created_at: r.created_at,
  };
}

// ─── 부여 ───────────────────────────────────────────────────────
router.get('/grants', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const targetUser = req.query.user_id ? Number(req.query.user_id) : req.user.id;
    if (targetUser !== req.user.id && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId, user_id: targetUser };
    if (req.query.year) where.year = Number(req.query.year);
    const { rows, count } = await LeaveGrant.findAndCountAll({
      where, order: [['year', 'DESC'], ['id', 'DESC']], limit, offset,
    });
    return paginatedResponse(res, rows.map((g) => ({
      id: g.id, user_id: g.user_id, year: g.year, days: Number(g.days),
      note: g.note, granted_by: g.granted_by, created_at: g.created_at,
    })), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.post('/grants', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { user_id, year, days, note } = req.body;
    if (!user_id || !year || days === undefined || days === null) return errorResponse(res, 'invalid_payload', 400);
    // 음수 허용 — 정정은 기존 row 를 고치는 게 아니라 반대 부호 row 를 얹는 것이다(원장식).
    const grant = await LeaveGrant.create({
      business_id: businessId, user_id: Number(user_id), year: Number(year),
      days: Number(days), note: (note || '').slice(0, 300) || null, granted_by: req.user.id,
    });
    await AuditLog.create({
      user_id: req.user.id, business_id: businessId, action: 'leave.grant',
      entity_type: 'leave_grant', entity_id: grant.id, new_value: grant.toJSON(),
    }).catch(() => null);
    return successResponse(res, { id: grant.id, days: Number(grant.days) }, null, 201);
  } catch (err) { next(err); }
});

// ─── 잔여 ───────────────────────────────────────────────────────
router.get('/balance', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const targetUser = req.query.user_id ? Number(req.query.user_id) : req.user.id;
    if (targetUser !== req.user.id && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    return successResponse(res, await L.getBalance(businessId, targetUser, year));
  } catch (err) { next(err); }
});

// ─── 신청 ───────────────────────────────────────────────────────
router.get('/requests', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const all = req.query.scope === 'all';
    if (all && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (!all) where.user_id = req.user.id;
    else if (req.query.user_id) where.user_id = Number(req.query.user_id);
    if (req.query.status) where.status = req.query.status;
    if (req.query.year) {
      const y = Number(req.query.year);
      where.start_date = { [Op.between]: [`${y}-01-01`, `${y}-12-31`] };
    }
    const { rows, count } = await LeaveRequest.findAndCountAll({
      where, order: [['start_date', 'DESC'], ['id', 'DESC']], limit, offset,
    });
    return paginatedResponse(res, rows.map(serializeRequest), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.post('/requests', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const request = await L.createRequest({
      businessId, userId: req.user.id, payload: req.body, actorUserId: req.user.id,
    });
    return successResponse(res, serializeRequest(request), null, 201);
  } catch (err) {
    if (err instanceof L.LeaveError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

// 승인·반려는 본문이 같지만 경로는 명시 등록한다(위 attendance.js 와 같은 이유 — 정적 검사·grep 가시성).
function decisionHandler(fn) {
  return async (req, res, next) => {
    try {
      const request = await LeaveRequest.findByPk(Number(req.params.id));
      if (!request) return errorResponse(res, 'not_found', 404);
      const scope = await requireMember(req, res, request.business_id);
      if (!scope) return;
      if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
      // 본인 신청 자가승인은 owner 만 — 혼자인 워크스페이스에서 휴가를 영영 못 쓰게 되면 기능이 죽는다(§4.2).
      if (request.user_id === req.user.id && !(scope.isOwner || scope.isPlatformAdmin)) {
        return errorResponse(res, 'self_decision_forbidden', 403);
      }
      const updated = await fn({ requestId: request.id, actorUserId: req.user.id, decideNote: req.body.decide_note });
      return successResponse(res, serializeRequest(updated));
    } catch (err) {
      if (err instanceof L.LeaveError) return errorResponse(res, err.code, err.status || 400);
      next(err);
    }
  };
}
router.post('/requests/:id/approve', authenticateToken, decisionHandler(L.approve));
router.post('/requests/:id/reject', authenticateToken, decisionHandler(L.reject));

router.post('/requests/:id/cancel', authenticateToken, async (req, res, next) => {
  try {
    const request = await LeaveRequest.findByPk(Number(req.params.id));
    if (!request) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, request.business_id);
    if (!scope) return;
    const updated = await L.cancel({ requestId: request.id, actorUserId: req.user.id, isManager: isManager(scope) });
    return successResponse(res, serializeRequest(updated));
  } catch (err) {
    if (err instanceof L.LeaveError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

module.exports = router;
