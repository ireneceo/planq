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

// ─── 알림 ───────────────────────────────────────────────────────
// #208 후속 (2026-08-25) — 여태 이 파일에는 notify 호출이 **한 건도 없었다**.
//   팀원이 휴가를 신청해도 승인권자에게 아무 신호가 가지 않아, 관리자가 근태 화면을
//   직접 열어보지 않으면 신청이 있는지 알 수 없었다(Irene 지적).
//   CLAUDE.md 운영 안정성 13번 "상태 전이 라우트는 notify 호출 강제" 를 지킨다.
//   event_kind 'leave' 는 ENUM 에 이미 있었다(배선만 빠져 있었다) — 스키마 변경 없음.
const LEAVE_TYPE_LABEL = {
  annual: '연차', half: '반차', sick: '병가', special: '경조', unpaid: '무급', other: '기타',
};
function leavePeriodText(r) {
  const s = ymd(r.start_date);
  const e = ymd(r.end_date);
  return s === e ? s : `${s} ~ ${e}`;
}
/** 승인권자(owner·admin) user_id 목록. 관리자가 0명이면 빈 배열 — notifyMany 가 알아서 no-op. */
async function managerUserIds(businessId) {
  const { BusinessMember } = require('../models');
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
    attributes: ['user_id'],
  });
  return rows.map((m) => m.user_id);
}
/** 신청자 표시명 — 워크스페이스 프로필 우선(applyMemberDisplayName 정책과 같은 우선순위). */
async function actorName(businessId, userId) {
  const { BusinessMember, User } = require('../models');
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId }, attributes: ['name'],
  });
  if (bm && bm.name) return bm.name;
  const u = await User.findByPk(userId, { attributes: ['name', 'username'] });
  return (u && (u.name || u.username)) || '팀원';
}
/**
 * 휴가 알림 발송. 실패해도 요청 자체는 성공시킨다 —
 * 다만 삼키지 말고 로그에는 남긴다(조용한 죽음 방지: feedback_completed_but_dead_features).
 */
async function notifyLeave(req, { request, event }) {
  try {
    const { notify, notifyMany } = require('./notifications');
    const { Business } = require('../models');
    const biz = await Business.findByPk(request.business_id, { attributes: ['name', 'brand_name'] });
    const wsName = biz ? (biz.brand_name || biz.name) : undefined;
    const typeLabel = LEAVE_TYPE_LABEL[request.leave_type] || request.leave_type;
    const period = leavePeriodText(request);
    const ioApp = req.app;
    const link = '/attendance';

    if (event === 'requested') {
      const who = await actorName(request.business_id, request.user_id);
      const ids = await managerUserIds(request.business_id);
      await notifyMany({
        userIds: ids, businessId: request.business_id, eventKind: 'leave',
        title: '휴가 신청 — 승인 필요',
        body: `${who} · ${typeLabel} ${period}${request.reason ? ` · ${request.reason}` : ''}`,
        link, ctaLabel: '근태에서 확인', workspaceName: wsName,
        excludeUserId: request.user_id,   // 본인이 관리자여도 자기 신청 알림은 받지 않는다
        actorUserId: request.user_id, entityType: 'leave_request', entityId: request.id, ioApp,
      });
      return;
    }
    // 승인·반려·취소 — 신청자에게
    const titleMap = {
      approved: '휴가가 승인되었습니다',
      rejected: '휴가가 반려되었습니다',
      canceled: '휴가 신청이 취소되었습니다',
    };
    await notify({
      userId: request.user_id, businessId: request.business_id, eventKind: 'leave',
      title: titleMap[event] || '휴가 상태 변경',
      body: `${typeLabel} ${period}${request.decide_note ? ` · ${request.decide_note}` : ''}`,
      link, ctaLabel: '근태 열기', workspaceName: wsName,
      actorUserId: request.decided_by || null, entityType: 'leave_request', entityId: request.id, ioApp,
    });
  } catch (e) {
    console.warn('[leave notify]', event, e.message);
  }
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
    await notifyLeave(req, { request, event: 'requested' });
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
      await notifyLeave(req, { request: updated, event: updated.status === 'approved' ? 'approved' : 'rejected' });
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
    // 취소는 방향이 둘이다 — 관리자가 취소하면 신청자에게, 본인이 취소하면 승인권자에게 알린다.
    if (req.user.id === updated.user_id) {
      const who = await actorName(updated.business_id, updated.user_id);
      const ids = await managerUserIds(updated.business_id);
      try {
        const { notifyMany } = require('./notifications');
        await notifyMany({
          userIds: ids, businessId: updated.business_id, eventKind: 'leave',
          title: '휴가 신청이 취소되었습니다',
          body: `${who} · ${LEAVE_TYPE_LABEL[updated.leave_type] || updated.leave_type} ${leavePeriodText(updated)}`,
          link: '/attendance', ctaLabel: '근태 열기',
          excludeUserId: updated.user_id,
          actorUserId: req.user.id, entityType: 'leave_request', entityId: updated.id, ioApp: req.app,
        });
      } catch (e) { console.warn('[leave notify] cancel', e.message); }
    } else {
      await notifyLeave(req, { request: updated, event: 'canceled' });
    }
    return successResponse(res, serializeRequest(updated));
  } catch (err) {
    if (err instanceof L.LeaveError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

module.exports = router;
