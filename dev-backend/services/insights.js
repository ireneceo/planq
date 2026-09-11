// 사이클 D4 — 능동 인사이트.
// 사용자가 묻기 전에 Cue 가 패턴을 감지해서 카드로 알려준다.
// 분석 항목 (가벼움 — DB 쿼리만, LLM 없음):
//   1) 지연 task 누적 (5건 이상)
//   2) 24h 내 일정 (회의·마감 임박)
//   3) 컨펌 대기 5건 이상 (내가 컨펌해야 할 task)
//   4) overdue 청구서 (owner/admin 만)
//   5) 받은 서명 요청 (만료 임박)
const { Op } = require('sequelize');
const { Task, TaskReviewer, CalendarEvent, Invoice, SignatureRequest, Client } = require('../models');
// 카드 문구는 **여기서 만들지 않는다** — 코드+원시값만 담고 routes/insights.js 가
// 보는 사람의 언어·타임존으로 해석한다 (services/statsInsights.js 헤더 참조).
const { cueCard, num, money, text, dateOnly, eventList, party } = require('./statsInsights');

async function buildInsights({ userId, businessId, userRole, userEmail }) {
  if (!userId || !businessId) return [];
  const insights = [];
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  // 1) 지연 task — 마감 지났고 미완료
  const overdueTasks = await Task.count({
    where: {
      business_id: businessId,
      assignee_id: userId,
      due_date: { [Op.lt]: todayStart },
      status: { [Op.notIn]: ['completed', 'canceled'] },
    },
  });
  if (overdueTasks >= 3) {
    insights.push(cueCard('cue_overdue_tasks', { count: num(overdueTasks) }, {
      id: `overdue_tasks_${overdueTasks}`,
      kind: 'overdue_tasks',
      severity: overdueTasks >= 8 ? 'urgent' : 'warning',
    }));
  }

  // 2) 24h 내 일정
  //   ★ 2026-09-11 — **볼 수 있는 일정만.** `business_id` 만 보면 동료의 개인(L1) 일정 제목이
  //     이 카드에 뜬다. 캘린더 목록·오늘의 리뷰와 **같은 술어**(access_scope.calendarListWhere)를 쓴다 —
  //     오늘의 리뷰가 같은 이유로 이미 고친 것(2026-09-05 Fable F2)을 여기만 빠뜨리고 있었다.
  const { calendarListWhere } = require('../middleware/access_scope');
  const calWhere = await calendarListWhere(userId, businessId);
  const upcomingEvents = calWhere ? await CalendarEvent.findAll({
    where: { [Op.and]: [calWhere, { start_at: { [Op.between]: [now, tomorrowEnd] } }] },
    attributes: ['id', 'title', 'start_at'],
    order: [['start_at', 'ASC']],
    limit: 3,
  }) : [];
  if (upcomingEvents.length > 0) {
    const next = upcomingEvents[0];
    // ★ 날짜 문자열을 여기서 만들지 않는다 — 옛 코드는 'ko-KR' + 'Asia/Seoul' 을 박아 둬서
    //   다른 지역·언어 사용자에게 남의 시간대로 보였다. 해석은 보는 사람 기준으로 한 번.
    insights.push(cueCard(
      upcomingEvents.length === 1 ? 'cue_upcoming_event_one' : 'cue_upcoming_events',
      {
        name: text(next.title),
        count: num(upcomingEvents.length),
        list: eventList(upcomingEvents.map((e) => ({ title: e.title, start_at: e.start_at }))),
      },
      { id: `upcoming_event_${next.id}`, kind: 'upcoming_event' },
    ));
  }

  // 3) 컨펌 대기 (내가 reviewer 인 pending task)
  // 회귀 fix: raw TaskReviewer.count 는 (a) business_id 미필터 → 타 워크스페이스 reviewer 까지 합산,
  // (b) task 가 reviewing → in_progress 로 돌아가도 state='pending' 잔존분 합산 → 인박스 실제 건수와 불일치.
  // dashboard 인박스 confirm 쿼리와 동일하게 Task join + business_id + status 필터로 카운트 정합.
  const pendingReviews = await TaskReviewer.count({
    where: { user_id: userId, state: 'pending' },
    include: [{
      model: Task,
      required: true,
      attributes: [],
      // 외부컨펌으로 넘어간 컨펌 단계도 포함 — services/reviewStage 단일 원천 (확인필요 수집기와 같은 술어)
      where: { business_id: businessId, [Op.and]: [require('./reviewStage').stageWhere()] },
    }],
  });
  if (pendingReviews >= 5) {
    insights.push(cueCard('cue_pending_reviews', { count: num(pendingReviews) }, {
      id: `pending_reviews_${pendingReviews}`, kind: 'pending_reviews',
    }));
  }

  // 4) 미수금 — 고객이 기한까지 결제하지 않은 청구서 (owner/admin)
  //    #69: "연체 청구서"는 워크스페이스 구독료가 아니라 "내가 고객에게 청구한 금액의 미입금"임을 명확히.
  //    입금확인 대기(notify_paid_at)·이미 완납 건은 제외 → 실제 독촉이 필요한 건만.
  if (userRole === 'owner' || userRole === 'admin') {
    const overdueList = await Invoice.findAll({
      where: {
        business_id: businessId,
        status: 'overdue',
        notify_paid_at: null,                       // 고객이 송금 알림한 건은 '입금 확인 대기'에서 별도 관리
      },
      attributes: ['id', 'invoice_number', 'recipient_business_name', 'client_id', 'grand_total', 'paid_amount', 'due_date', 'currency'],
      order: [['due_date', 'ASC']],
      limit: 50,
    }).catch(() => []);
    // 미수 잔액 > 0 인 건만 (부분 결제 후 잔액)
    const unpaid = overdueList.filter(inv => Number(inv.grand_total || 0) > Number(inv.paid_amount || 0));
    if (unpaid.length > 0) {
      // 고객명 채우기 (recipient_business_name 없으면 Client 에서)
      const first = unpaid[0];
      let firstName = first.recipient_business_name || '';
      if (!firstName && first.client_id) {
        const cli = await Client.findOne({ where: { id: first.client_id, business_id: businessId }, attributes: ['company_name', 'display_name'] }).catch(() => null);
        firstName = cli?.company_name || cli?.display_name || '';
      }
      // DATEONLY 는 string('2026-06-10') 또는 Date 객체로 올 수 있음 (memory 박제) — 둘 다 YYYY-MM-DD 로
      const rawDue = first.due_date;
      const firstDue = rawDue
        ? (typeof rawDue === 'string' ? rawDue.slice(0, 10) : new Date(rawDue).toISOString().slice(0, 10))
        : '';
      const firstOwed = Number(first.grand_total || 0) - Number(first.paid_amount || 0);
      insights.push(cueCard(
        unpaid.length === 1 ? 'cue_overdue_invoice_one' : 'cue_overdue_invoices',
        {
          count: num(unpaid.length),
          amount: money(firstOwed, first.currency || 'KRW'),
          due: dateOnly(firstDue),
          // 이름을 모를 때의 총칭·호칭('님')은 party() 가 언어별로 처리한다.
          who: party(firstName),
        },
        { id: `overdue_invoices_${unpaid.length}`, kind: 'overdue_invoices' },
      ));
    }
  }

  // 5) 받은 서명 요청 — 만료 24h 이내
  if (userEmail) {
    // ★ 2026-09-11 — 워크스페이스 축을 건다. 여태 서명자 이메일만 봐서 **다른 워크스페이스의
    //   서명 요청**까지 이 워크스페이스 카드에 셌다(확인필요 collectSignatures 와 같은 결함·같은 수리).
    const expSoon = await SignatureRequest.count({
      where: {
        business_id: businessId,
        signer_email: userEmail,
        status: { [Op.in]: ['sent', 'viewed'] },
        expires_at: { [Op.between]: [now, tomorrowEnd] },
      },
    });
    if (expSoon > 0) {
      insights.push(cueCard('cue_signature_expiring', { count: num(expSoon) }, {
        id: `signature_expiring_${expSoon}`, kind: 'signature_expiring',
      }));
    }
  }

  return insights;
}

module.exports = { buildInsights };
