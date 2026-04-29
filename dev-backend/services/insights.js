// 사이클 D4 — 능동 인사이트.
// 사용자가 묻기 전에 Cue 가 패턴을 감지해서 카드로 알려준다.
// 분석 항목 (가벼움 — DB 쿼리만, LLM 없음):
//   1) 지연 task 누적 (5건 이상)
//   2) 24h 내 일정 (회의·마감 임박)
//   3) 컨펌 대기 5건 이상 (내가 컨펌해야 할 task)
//   4) overdue 청구서 (owner/admin 만)
//   5) 받은 서명 요청 (만료 임박)
const { Op } = require('sequelize');
const { Task, TaskReviewer, CalendarEvent, Invoice, SignatureRequest } = require('../models');

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
  const pendingReviews = await TaskReviewer.count({
    where: { user_id: userId, state: 'pending' },
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

  // 4) overdue 청구서 (owner/admin)
  if (userRole === 'owner' || userRole === 'admin') {
    const overdueInvoices = await Invoice.count({
      where: {
        business_id: businessId,
        status: 'overdue',
      },
    });
    if (overdueInvoices > 0) {
      insights.push({
        id: `overdue_invoices_${overdueInvoices}`,
        kind: 'overdue_invoices',
        severity: 'urgent',
        title: `연체 청구서 ${overdueInvoices}건`,
        body: '결제 기한이 지난 청구서가 있어요. 입금 알림 또는 독촉 처리가 필요합니다.',
        action: { label: 'Q Bill 열기', link: '/bills?tab=invoices' },
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
