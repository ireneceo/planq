// routes/booking_admin.js — 상담 예약 **팀 쪽** 동작 (멤버용, 인증 필수). docs/CLIENT_ENTRY_DESIGN.md §4.5
//
//   확인필요의 «상담 신청» 항목과 Q calendar 상세 드로어가 같은 네 문을 부른다 — 한 곳에서 끝난다.
//   누가 할 수 있나·어느 상태에서 되는가는 services/booking.js **한 곳**이 판정한다.
// ★ `/api/calendar` 에 **calendar.js 앞**으로 마운트한다 — 그 파일의 와일드카드가 `booking/...` 을
//   먹지 않게(calendar_sync.js 와 같은 이유, 라우트 순서 함정).
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const booking = require('../services/booking');

const chain = [authenticateToken, checkBusinessAccess, requireMenu('qcalendar', 'write')];

function fail(res, next, e) {
  if (e instanceof booking.BookingError) return errorResponse(res, e.code, e.status);
  return next(e);
}
const out = (ev, extra = {}) => ({
  id: ev.id, booking_status: ev.booking_status, start_at: ev.start_at, end_at: ev.end_at,
  meeting_url: ev.meeting_url || null, ...extra,
});

// 확인창이 적을 받는 주소 — 보내는 곳과 **같은 함수**(booking.recipientLinkOf)로 찾는다.
router.get('/booking/:businessId/:eventId/recipient', ...chain, async (req, res, next) => {
  try {
    return successResponse(res, await booking.guestRecipientOf(req.user, Number(req.params.businessId), req.params.eventId));
  } catch (e) { return fail(res, next, e); }
});

// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.confirm·propose·decline·cancel) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/booking/:businessId/:eventId/approve', ...chain, async (req, res, next) => {
  try {
    const { ev, meetWarning } = await booking.teamApprove(req.user, Number(req.params.businessId), req.params.eventId,
      { createMeeting: req.body?.create_meeting === true });
    return successResponse(res, out(ev, { meet_warning: meetWarning || null }));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.confirm·propose·decline·cancel) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/booking/:businessId/:eventId/propose', ...chain, async (req, res, next) => {
  try {
    const { ev } = await booking.teamPropose(req.user, Number(req.params.businessId), req.params.eventId, { start: req.body?.start });
    return successResponse(res, out(ev));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.confirm·propose·decline·cancel) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/booking/:businessId/:eventId/decline', ...chain, async (req, res, next) => {
  try {
    const { ev } = await booking.teamDecline(req.user, Number(req.params.businessId), req.params.eventId);
    return successResponse(res, out(ev));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.confirm·propose·decline·cancel) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/booking/:businessId/:eventId/cancel', ...chain, async (req, res, next) => {
  try {
    const { ev } = await booking.teamCancel(req.user, Number(req.params.businessId), req.params.eventId);
    return successResponse(res, out(ev));
  } catch (e) { return fail(res, next, e); }
});

module.exports = router;
