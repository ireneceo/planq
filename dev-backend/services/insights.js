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
    insights.push({
      id: `overdue_tasks_${overdueTasks}`,
      kind: 'overdue_tasks',
      severity: overdueTasks >= 8 ? 'urgent' : 'warning',
      title: `지연 업무 ${overdueTasks}건이 쌓여 있어요`,
      body: `마감이 지난 미완료 업무 ${overdueTasks}건. Q Task 의 지연 뱃지 클릭으로 빠르게 갱신할 수 있어요.`,
      action: { label: 'Q Task 열기', link: '/tasks' },
    });
  }

  // 2) 24h 내 일정
  const upcomingEvents = await CalendarEvent.findAll({
    where: {
      business_id: businessId,
      start_at: { [Op.between]: [now, tomorrowEnd] },
    },
    attributes: ['id', 'title', 'start_at'],
    order: [['start_at', 'ASC']],
    limit: 3,
  });
  if (upcomingEvents.length > 0) {
    const next = upcomingEvents[0];
    insights.push({
      id: `upcoming_event_${next.id}`,
      kind: 'upcoming_event',
      severity: 'today',
      title: upcomingEvents.length === 1
        ? `다가오는 일정: ${next.title}`
        : `24시간 안에 일정 ${upcomingEvents.length}건`,
      body: upcomingEvents.map(e => `· ${e.title} (${new Date(e.start_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })})`).join('\n'),
      action: { label: '캘린더 열기', link: '/calendar' },
    });
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
      where: { business_id: businessId, status: { [Op.in]: ['reviewing', 'revision_requested'] } },
    }],
  });
  if (pendingReviews >= 5) {
    insights.push({
      id: `pending_reviews_${pendingReviews}`,
      kind: 'pending_reviews',
      severity: 'warning',
      title: `컨펌 대기 ${pendingReviews}건`,
      body: '내가 컨펌해야 할 업무가 쌓이고 있어요. 인박스에서 빠르게 처리하세요.',
      action: { label: '확인 필요 열기', link: '/inbox' },
    });
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
      const fmtAmount = (amt, cur) => {
        const n = Number(amt || 0);
        const sym = { USD: '$', EUR: '€', JPY: '¥', CNY: '¥' }[cur];
        return sym ? `${sym}${n.toLocaleString('en-US')}` : `${n.toLocaleString('ko-KR')}원`;
      };
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
      const body = unpaid.length === 1
        ? `${firstName ? `${firstName} 님에게 ` : '고객에게 '}청구한 ${fmtAmount(firstOwed, first.currency)}이 결제 기한(${firstDue})을 지났는데 아직 입금되지 않았어요. 입금을 확인했다면 입금 처리하고, 아니면 결제 독촉을 보내세요. (워크스페이스 구독료가 아니라 고객에게 청구한 금액이에요.)`
        : `고객에게 청구한 금액 중 결제 기한이 지난 미입금 청구서가 ${unpaid.length}건 있어요. 입금 확인 또는 결제 독촉이 필요해요. (워크스페이스 구독료와는 별개예요.)`;
      insights.push({
        id: `overdue_invoices_${unpaid.length}`,
        kind: 'overdue_invoices',
        severity: 'urgent',
        title: `미입금 청구서 ${unpaid.length}건 (미수금)`,
        body,
        action: { label: '미수금 관리', link: '/bills?tab=invoices' },
      });
    }
  }

  // 5) 받은 서명 요청 — 만료 24h 이내
  if (userEmail) {
    const expSoon = await SignatureRequest.count({
      where: {
        signer_email: userEmail,
        status: { [Op.in]: ['sent', 'viewed'] },
        expires_at: { [Op.between]: [now, tomorrowEnd] },
      },
    });
    if (expSoon > 0) {
      insights.push({
        id: `signature_expiring_${expSoon}`,
        kind: 'signature_expiring',
        severity: 'urgent',
        title: `서명 만료 임박 ${expSoon}건`,
        body: '24시간 안에 만료되는 서명 요청이 있어요. 즉시 서명하지 않으면 다시 보내달라고 요청해야 합니다.',
        action: { label: '받은 서명 보기', link: '/docs?tab=received-signatures' },
      });
    }
  }

  return insights;
}

module.exports = { buildInsights };
