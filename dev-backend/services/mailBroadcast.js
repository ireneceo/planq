// 메일 실시간 broadcast — 단일 착지점 (CLAUDE.md §16: 모든 mutation 라우트 필수)
//
// ★ 2026-08-24 (Irene: "답변필요 없어졌는데도 좌측 Q mail 숫자가 안없어져")
//   라우트들은 `mail:updated` 만 쏘고 있었다. 그런데 **사이드바 뱃지는 `inbox:refresh` 만 듣는다**
//   (frontend hooks/useInboxCount). 그래서 답변 완료·답변 불필요를 눌러도 숫자가 그대로 남았다.
//   memory feedback_notify_trigger_required — "broadcast 는 수신부까지가 기능이다".
//
//   전이 라우트가 7개라 라우트마다 두 번 쏘게 하면 반드시 하나가 빠진다.
//   → 여기 한 곳에서 처리한다. payload 에 reply_needed 가 실려 있으면 뱃지 갱신도 같이 쏜다.
function broadcastMail(req, businessId, event, payload) {
  const io = req.app.get('io');
  if (!io) return;
  const room = `business:${businessId}`;
  io.to(room).emit(event, payload);
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'reply_needed')) {
    io.to(room).emit('inbox:refresh', { reason: 'mail_reply_needed' });
  }
}

module.exports = { broadcastMail };
