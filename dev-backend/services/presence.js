// 지금 이 대화방을 보고 있는가 — 같은 사람의 **다른 기기**가 그 방을 열어 두고 보고 있으면 채팅 푸시를 생략한다.
//   (Fable 판정 행 15, 2026-10-07 — 신고: "같은 아이디가 다른 디바이스에서 대화중인데 폰에 푸시가 계속 온다")
//
// 신호: 화면(services/socket.ts registerViewing)이 «보이는 대화방 id 목록» 을 30초마다 + 바뀔 때 보낸다.
//   서버는 소켓마다 마지막 신호를 들고 있다(socket.data.viewing = { ids, at }).
// 판정: 그 사람 소켓 중 하나라도 이 방을 90초 안에 «보고 있다» 고 했으면 참.
// ★ fail-open — 신호가 없으면(옛 번들·앱 백그라운드·서버 재시작 직후) **보낸다.** 외부 발송은 놓치는 쪽이 더 비싸다.
// ★ 메모리 판정이라 단일 프로세스 전제다(PM2 fork·instances 1). 여러 프로세스로 늘리면 adapter 가 필요하다.
const FRESH_MS = 90 * 1000;

function sanitizeIds(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.ids) ? raw.ids : []);
  return [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
}

function recordViewing(socket, raw) {
  socket.data = socket.data || {};
  socket.data.viewing = { ids: sanitizeIds(raw), at: Date.now() };
}

function isViewingConversation(io, userId, conversationId, now = Date.now()) {
  try {
    if (!io || !userId || !conversationId) return false;
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    if (!room) return false;
    for (const sid of room) {
      const s = io.sockets.sockets.get(sid);
      const v = s && s.data && s.data.viewing;
      if (v && now - v.at < FRESH_MS && v.ids.includes(Number(conversationId))) return true;
    }
  } catch { /* 판정 실패 = 보낸다 */ }
  return false;
}

module.exports = { recordViewing, isViewingConversation, sanitizeIds, FRESH_MS };
