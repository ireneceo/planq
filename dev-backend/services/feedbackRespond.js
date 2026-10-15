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
  // 답이 있으면 «아직 안 읽음» 으로 되돌린다 — 확인필요·문의·피드백 메뉴 배지가 이것을 센다(routes/dashboard).
  //   상태만 바꾸고 답 글이 없는 회신(«검토 중» 등)은 읽을 답이 없으므로 건드리지 않는다.
  const nextResponse = updates.admin_response !== undefined ? updates.admin_response : item.admin_response;
  if (nextResponse && String(nextResponse).trim()) updates.reply_seen_at = null;
  await item.update(updates);
  if (updates.reply_seen_at === null && item.user_id) {
    // 배지가 바로 오르게 — 보고자 개인 방으로 신호만(useInboxCount 가 다시 센다)
    try {
      const io = (ioApp && typeof ioApp.get === 'function' && ioApp.get('io')) || global.__planqIo || null;
      if (io) io.to(`user:${item.user_id}`).emit('inbox:refresh', { reason: 'feedback_reply' });
    } catch { /* 신호 실패는 무시 — 탭 복귀·포커스에 다시 센다 */ }
  }

  if (item.user_id) {
    const { notify } = require('../routes/notifications');
    // 받는 사람의 언어로 — notify 가 제목·본문·버튼 함수에 수신자 언어를 넘긴다(#457: 영어 사용자에게 한국어 제목이 갔다)
    const LABEL = {
      ko: { done: '완료', wontfix: '보류', reviewing: '검토 중', pending: '접수' },
      en: { done: 'resolved', wontfix: 'on hold', reviewing: 'in review', pending: 'received' },
    };
    const L = (lang) => (lang === 'en' ? 'en' : 'ko');
    const sending = notify({
      userId: item.user_id,
      businessId: item.business_id || null,
      eventKind: 'feedback',
      // 문의(kind 'inquiry')에 답해도 «피드백 …» 이라 적혔다(2026-10-15) — 종류대로 부른다.
      title: (lang) => (L(lang) === 'en'
        ? `${item.kind === 'inquiry' ? 'Inquiry' : 'Feedback'} ${LABEL.en[item.status] || LABEL.en.pending} — ${item.title}`
        : `${item.kind === 'inquiry' ? '문의' : '피드백'} ${LABEL.ko[item.status] || LABEL.ko.pending} — ${item.title}`),
      body: (lang) => (item.admin_response ? String(item.admin_response).slice(0, 300)
        : (L(lang) === 'en' ? 'The PlanQ team has replied.' : '운영팀이 회신했습니다.')),
      link: '/me/feedback',
      ctaLabel: (lang) => (L(lang) === 'en' ? 'View my feedback' : '내역 보기'),
      actorUserId: actorUserId || null,
      ioApp,
    }).catch(() => null);
    if (waitNotify) await sending;
  }
  return item;
}

module.exports = { respondToFeedback, ALLOWED_STATUS };
