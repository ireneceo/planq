// 고객 창구 퍼널 — 통계 «유입» 탭 (docs/CLIENT_ENTRY_DESIGN.md §5 P3).
//
//   ① 방문자 확인  창구(scope='workspace')에서 이메일을 확인해 개인 링크를 받은 사람
//   ② 예약 신청    고객이 신청한 상담(calendar_events.booking_status IS NOT NULL)
//   ③ 확정        ② 중 지금 confirmed 인 것 (끝난 상담도 confirmed 로 남는다 — 끝남은 파생값)
//   ④ 고객 등록    ③ 의 고객 중 정식 고객(clientQuota.billableClientWhere — 문의 고객 prospect 만 뺀다)
//
// ★ 설계 문서는 ① 을 `guest_links.use_count` 로 적었지만 **그 컬럼은 없다.** 익명 방문은 세지 않는다
//   (쿠키·IP 를 남기지 않는 것이 창구의 원칙이다). 확인한 방문자는 행이 생기고 생성 시각이 있어
//   기간 필터를 그대로 탄다.
// ★ ② 는 로그인 고객(/home)의 신청도 센다 — 그 사람은 ① 을 거치지 않으므로 ①→② 전환율은
//   100% 를 넘을 수 있다. 화면이 그 사실을 한 줄로 말한다.
// ★ 모든 쿼리에 business_id. 코호트 기준은 «그 기간에 생긴 것» 하나다(②③④ 는 같은 신청 묶음).

const { Op } = require('sequelize');
const { GuestLink, CalendarEvent, CalendarEventAttendee, Client } = require('../models');
const { billableClientWhere } = require('./clientQuota');

async function buildEntryFunnel(businessId, period) {
  const between = { [Op.between]: [new Date(period.from + ' 00:00:00'), new Date(period.to + ' 23:59:59')] };

  const visitors = await GuestLink.count({
    where: { business_id: businessId, scope: 'workspace', kind: 'personal', created_at: between },
  });

  const bookings = await CalendarEvent.findAll({
    where: { business_id: businessId, booking_status: { [Op.ne]: null }, created_at: between },
    attributes: ['id', 'booking_status'],
    include: [{
      model: CalendarEventAttendee, as: 'attendees', required: false,
      where: { client_id: { [Op.ne]: null } }, attributes: ['client_id'],
    }],
  });

  const byStatus = { requested: 0, proposed: 0, confirmed: 0, declined: 0, canceled: 0 };
  const confirmedClientIds = new Set();
  for (const ev of bookings) {
    byStatus[ev.booking_status] = (byStatus[ev.booking_status] || 0) + 1;
    if (ev.booking_status === 'confirmed') {
      for (const a of ev.attendees || []) confirmedClientIds.add(a.client_id);
    }
  }

  let registered = 0;
  if (confirmedClientIds.size) {
    registered = await Client.count({
      where: { [Op.and]: [billableClientWhere(businessId), { id: [...confirmedClientIds] }] },
    });
  }

  return {
    period: { from: period.from, to: period.to, label: period.label },
    steps: {
      visitors,
      requested: bookings.length,
      confirmed: byStatus.confirmed,
      registered,
    },
    breakdown: {
      pending: byStatus.requested + byStatus.proposed,
      declined: byStatus.declined,
      canceled: byStatus.canceled,
    },
  };
}

module.exports = { buildEntryFunnel };
