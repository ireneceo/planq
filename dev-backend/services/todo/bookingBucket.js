// services/todo/bookingBucket.js — 확인필요의 **상담 신청** 버킷 (docs/CLIENT_ENTRY_DESIGN.md §4.5)
//
//   고객이 창구에서 신청한 상담(booking_status='requested')을 **담당 멤버**(= 일정을 만든 사람)에게.
//   [승인] [다른 시간 제안] [거절] 은 이 항목이 여는 일정 상세에서 한 번에 끝난다.
//
// ★ 한 건 = 한 버킷(숫자 배지 계약 §3). 같은 신청이 다른 두 수집기에도 걸릴 수 있어서 거기서 뺀다:
//   · collectEvents(«참석 응답»/«오늘 참석») — 담당 멤버를 «수락» 참석자로 넣고, 미확정 예약은 제외한다
//   · saleBucket ①(«답 안 한 문의») — 대기 중 신청이 있는 고객은 여기가 센다
// ★ 새 type 이라 화면이 아이콘·동사를 알아야 한다 — TodoList `type === 'booking'` · `todo.verb.schedule`.
const { Op } = require('sequelize');
const { COLLECT_LIMIT, safeToIso } = require('./common');

async function collectBookings(businessId, userId) {
  const { CalendarEvent } = require('../../models');
  const rows = await CalendarEvent.findAll({
    where: {
      business_id: businessId,
      booking_status: 'requested',
      created_by: userId,
      start_at: { [Op.gt]: new Date() },   // 지난 신청은 처리할 수 없다(승인 라우트가 409)
    },
    attributes: ['id', 'title', 'start_at', 'createdAt'],
    order: [['start_at', 'ASC']],
    limit: COLLECT_LIMIT,
  });
  const soon = Date.now() + 48 * 3600 * 1000;
  return rows.map((ev) => ({
    id: `booking-${ev.id}`,
    type: 'booking',
    priority: new Date(ev.start_at).getTime() < soon ? 'urgent' : 'today',
    verb: 'schedule',
    subject: ev.title,
    context: null,
    dueAt: safeToIso(ev.start_at),
    createdAt: safeToIso(ev.createdAt),
    link: `/calendar?event=${ev.id}`,
  }));
}

/**
 * 예약이 걸린 고객 id — saleBucket 이 겹치는 항목을 뺄 때 쓴다(한 건 = 한 버킷).
 * @param {string[]} statuses  어느 상태를 볼지
 * @param {{ upcomingOnly?: boolean }} opts  true 면 아직 시작 전인 것만
 */
async function clientIdsWithBooking(businessId, clientIds, statuses, { upcomingOnly = false } = {}) {
  if (!clientIds || !clientIds.length) return new Set();
  const { CalendarEvent, CalendarEventAttendee } = require('../../models');
  const evWhere = { business_id: businessId, booking_status: { [Op.in]: statuses } };
  if (upcomingOnly) evWhere.start_at = { [Op.gt]: new Date() };
  const rows = await CalendarEventAttendee.findAll({
    where: { client_id: { [Op.in]: clientIds } },
    include: [{ model: CalendarEvent, required: true, attributes: [], where: evWhere }],
    attributes: ['client_id'],
    raw: true,
  });
  return new Set(rows.map((r) => r.client_id));
}

module.exports = { collectBookings, clientIdsWithBooking };
