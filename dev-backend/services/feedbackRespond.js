// 피드백 회신 — 한 곳. 관리자 화면(PATCH /api/feedback/:id/respond)과 개발완료 회신 스크립트
//   (scripts/feedback-reply.js)가 같은 함수를 쓴다. 베끼면 한쪽만 알림을 안 보낸다.
//   상태 + 답글 저장 → 보고자에게 알림(myhistory 에서 답을 본다).
const ALLOWED_STATUS = ['pending', 'reviewing', 'done', 'wontfix'];

// waitNotify — 스크립트는 알림까지 기다린다(프로세스가 먼저 끝나면 알림이 안 나간다). 라우트는 기다리지 않는다.
async function respondToFeedback(item, { status, admin_response, actorUserId, ioApp, waitNotify = false } = {}) {
  const updates = {};
  if (status && ALLOWED_STATUS.includes(status)) updates.status = status;
  if (typeof admin_response === 'string') updates.admin_response = admin_response.slice(0, 5000);
  if (Object.keys(updates).length === 0) return item;
  updates.responded_by = actorUserId || null;
  updates.responded_at = new Date();
  await item.update(updates);

  if (item.user_id) {
    const { notify } = require('../routes/notifications');
    const statusLabel = item.status === 'done' ? '완료'
      : item.status === 'wontfix' ? '보류'
      : item.status === 'reviewing' ? '검토 중' : '접수';
    const sending = notify({
      userId: item.user_id,
      businessId: item.business_id || null,
      eventKind: 'feedback',
      title: `피드백 ${statusLabel} — ${item.title}`,
      body: item.admin_response ? String(item.admin_response).slice(0, 300) : '운영팀이 회신했습니다.',
      link: '/me/feedback',
      ctaLabel: '내역 보기',
      actorUserId: actorUserId || null,
      ioApp,
    }).catch(() => null);
    if (waitNotify) await sending;
  }
  return item;
}

module.exports = { respondToFeedback, ALLOWED_STATUS };
