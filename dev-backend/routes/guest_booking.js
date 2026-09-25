// routes/guest_booking.js — 고객 창구 **상담 예약**의 무인증 표면 (docs/CLIENT_ENTRY_DESIGN.md §4.3·§4.4)
//
// ★ **인증이 없는 표면이다.** guest.js 와 같은 규칙 — 토큰은 guest_common.attachGuest 하나로 풀고,
//   못 찾겠으면 404. 모든 판정(누구의 예약인가·어느 상태에서 무엇을 할 수 있나)은
//   services/booking.js **한 곳**이 한다. 여기는 한도·입력·응답 모양만.
// ★ 슬롯·신청·목록은 **창구의 확인된 개인 링크**에서만 된다(booking.assertVerifiedEntryLink).
//   공유 창구 링크로 슬롯을 물으면 «비어 있음» 열거 창구가 된다(§5 P2 «개인 링크 필수»).
// ★ 슬롯 응답은 시작 시각 배열 + 길이 + 시간대뿐이다. 누구의 무슨 일정 때문에 막혔는지는
//   계산 안에서만 쓰고 내보내지 않는다(§4.3).
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter, attachGuest } = require('./guest_common');
const booking = require('../services/booking');

/** BookingError → 응답. 한도 초과(prospect_limit)는 설명 없이 422 — 무인증 표면에 요금제 정보를 싣지 않는다. */
function fail(res, next, e) {
  if (e instanceof booking.BookingError) return errorResponse(res, e.code, e.status);
  return next(e);
}

// 신청은 IP 로도 막는다 — 링크를 여러 개 들고 돌아가며 달력을 채우는 경로(OTP 한도와 같은 이유)
//   ★ 한도는 **실패한 시도도 센다**(express-rate-limit 기본). «그 사이 슬롯이 찼음» 으로 다시 고르는 것은
//     정상 사용이라 링크당 10 · IP 당 20 으로 둔다. 달력을 채우는 것은 이 한도가 아니라
//     booking.MAX_OPEN_PER_CLIENT(대기 중 3건)가 막는다.
const requestLimitIp = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `gb-i-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});

// ── GET /:token/booking/slots ─────────────────────────────────────────────
router.get('/:token/booking/slots',
  guestLimiter('guest-book-slots', { windowMs: 60 * 1000, max: 30 }), attachGuest,
  async (req, res, next) => {
    try {
      const r = await booking.slotsForGuest(req.guest);
      return successResponse(res, {
        enabled: r.enabled, slots: r.slots, duration_minutes: r.duration, timezone: r.timezone,
      });
    } catch (e) { return fail(res, next, e); }
  });

// ── GET /:token/booking/mine ──────────────────────────────────────────────
router.get('/:token/booking/mine',
  guestLimiter('guest-book-mine', { windowMs: 60 * 1000, max: 60 }), attachGuest,
  async (req, res, next) => {
    try {
      return successResponse(res, await booking.listGuestBookings(req.guest));
    } catch (e) { return fail(res, next, e); }
  });

// ── POST /:token/booking — 신청 ───────────────────────────────────────────
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.request·confirm·cancel·reschedule) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:token/booking',
  guestLimiter('guest-book-req', { windowMs: 60 * 60 * 1000, max: 10 }), requestLimitIp, attachGuest,
  async (req, res, next) => {
    try {
      const ev = await booking.requestBooking(req.guest, {
        start: req.body?.start, purpose: req.body?.purpose, memo: req.body?.memo,
      });
      return successResponse(res, { id: ev.id, status: ev.booking_status, start_at: ev.start_at, end_at: ev.end_at }, 'requested', 201);
    } catch (e) { return fail(res, next, e); }
  });

// ── POST /:token/booking/:id/{accept|cancel|reschedule} ───────────────────
const actLimit = guestLimiter('guest-book-act', { windowMs: 60 * 60 * 1000, max: 20 });
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.request·confirm·cancel·reschedule) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:token/booking/:id/accept', actLimit, attachGuest, async (req, res, next) => {
  try {
    const { ev } = await booking.guestAccept(req.guest, req.params.id);
    return successResponse(res, { id: ev.id, status: ev.booking_status });
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.request·confirm·cancel·reschedule) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:token/booking/:id/cancel', actLimit, attachGuest, async (req, res, next) => {
  try {
    const ev = await booking.guestCancel(req.guest, req.params.id);
    return successResponse(res, { id: ev.id, status: ev.booking_status });
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 감사는 services/booking.js 전이 함수 안(booking.request·confirm·cancel·reschedule) 한 곳 — 여기서 또 쓰면 두 줄
router.post('/:token/booking/:id/reschedule', actLimit, attachGuest, async (req, res, next) => {
  try {
    const ev = await booking.guestReschedule(req.guest, req.params.id, { start: req.body?.start });
    return successResponse(res, { id: ev.id, status: ev.booking_status, start_at: ev.start_at, end_at: ev.end_at });
  } catch (e) { return fail(res, next, e); }
});

module.exports = router;
