// routes/client_home.js — **로그인 고객 홈**(`/home`) 의 서버 쪽 (docs/CLIENT_ENTRY_DESIGN.md §4.7 · §5 P3)
//
// ★ 고객 창구(`/g/<token>`)와 **같은 화면·같은 자료**를 로그인 고객에게 준다. 다른 것은 신원뿐이다 —
//   창구는 게스트 링크 토큰, 여기는 로그인한 사람의 **자기 고객 행**(Client.user_id = 나).
//   그래서 판정·직렬화는 전부 기존 한 벌을 부른다:
//     · 안내 자료 = routes/guest.js `entryOf`·`workspaceOf`(화이트리스트 그대로)
//     · 예약 = services/booking.js 의 같은 함수(`accountActor` 로 신원만 바꿔 넣는다)
// ★ 멤버·오너는 여기로 오지 않는다 — 고객 행이 없으면 403(accountActor). 팀은 팀 문을 쓴다.
// ★ «내 문의» 의 축은 client_id 다 — 게스트로 신청한 건도 같은 고객이면 여기서 보인다(§4.4).
const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { Conversation } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { perUserLimiter } = require('../middleware/costGuard');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const booking = require('../services/booking');
const { entryOf, workspaceOf } = require('./guest');

function fail(res, next, e) {
  if (e instanceof booking.BookingError) return errorResponse(res, e.code, e.status);
  return next(e);
}
const actorOf = (req) => booking.accountActor(req.user, Number(req.params.businessId));

// ── GET /api/client-home/:businessId — 홈 한 장에 필요한 것 ──────────────────
router.get('/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const { Business } = require('../models');
    const biz = await Business.findByPk(actor.businessId, {
      attributes: ['id', 'name', 'brand_name', 'brand_logo_url', 'brand_tagline', 'phone', 'email', 'website', 'address', 'permissions'],
    });
    // 내 대화방 — 이 고객의 customer 방 중 가장 최근. 없으면 null(화면은 «대화» 줄을 그리지 않는다).
    const conv = await Conversation.findOne({
      where: { business_id: actor.businessId, client_id: actor.client.id, channel_type: 'customer', status: 'active' },
      order: [['last_message_at', 'DESC'], ['id', 'DESC']],
      attributes: ['id', 'title'],
    });
    // 프로젝트 수 — 탭 라벨 «프로젝트 N» (§4.7). 고객 연결 두 축(client_id · 담당자 user)을 다 센다.
    const [[pc]] = await sequelize.query(
      `SELECT COUNT(DISTINCT pc.project_id) n FROM project_clients pc JOIN projects p ON p.id = pc.project_id
        WHERE p.business_id = ? AND (pc.client_id = ? OR pc.contact_user_id = ?)`,
      { replacements: [actor.businessId, actor.client.id, req.user.id] });
    return successResponse(res, {
      workspace: workspaceOf(biz),
      entry: entryOf(biz),
      client: { id: actor.client.id, name: actor.client.display_name || actor.client.company_name || null },
      conversation: conv ? { id: conv.id, title: conv.title || null } : null,
      projects_count: Number(pc.n) || 0,
    });
  } catch (e) { return fail(res, next, e); }
});

// ── 예약 — 창구와 **같은 함수**. 신원만 계정 고객이다 ─────────────────────────
router.get('/:businessId/booking/slots', authenticateToken, perUserLimiter('ch-slots', { windowMs: 60 * 1000, max: 30 }), async (req, res, next) => {
  try {
    const r = await booking.slotsForActor(await actorOf(req));
    return successResponse(res, { enabled: r.enabled, slots: r.slots, duration_minutes: r.duration, timezone: r.timezone });
  } catch (e) { return fail(res, next, e); }
});
router.get('/:businessId/booking/mine', authenticateToken, async (req, res, next) => {
  try {
    return successResponse(res, await booking.listActorBookings(await actorOf(req)));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.request) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:businessId/booking', authenticateToken, perUserLimiter('ch-book', { windowMs: 60 * 60 * 1000, max: 10 }), async (req, res, next) => {
  try {
    const ev = await booking.requestForActor(await actorOf(req), {
      start: req.body?.start, purpose: req.body?.purpose, memo: req.body?.memo,
    });
    return successResponse(res, { id: ev.id, status: ev.booking_status, start_at: ev.start_at, end_at: ev.end_at }, 'requested', 201);
  } catch (e) { return fail(res, next, e); }
});
const act = perUserLimiter('ch-book-act', { windowMs: 60 * 60 * 1000, max: 20 });
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.confirm) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:businessId/booking/:id/accept', authenticateToken, act, async (req, res, next) => {
  try {
    const { ev } = await booking.acceptForActor(await actorOf(req), req.params.id);
    return successResponse(res, { id: ev.id, status: ev.booking_status });
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.cancel) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:businessId/booking/:id/cancel', authenticateToken, act, async (req, res, next) => {
  try {
    const ev = await booking.cancelForActor(await actorOf(req), req.params.id);
    return successResponse(res, { id: ev.id, status: ev.booking_status });
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.reschedule) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:businessId/booking/:id/reschedule', authenticateToken, act, async (req, res, next) => {
  try {
    const ev = await booking.rescheduleForActor(await actorOf(req), req.params.id, { start: req.body?.start });
    return successResponse(res, { id: ev.id, status: ev.booking_status, start_at: ev.start_at, end_at: ev.end_at });
  } catch (e) { return fail(res, next, e); }
});

module.exports = router;
