// 실시간(소켓) 접근 회수 — HTTP 는 매 요청 권한을 다시 보지만 소켓 룸은 들어온 뒤로 다시 보지 않는다.
//   그래서 워크스페이스에서 내보낸 멤버·정지한 계정이 연결이 끊길 때까지 그 워크스페이스 방송을
//   계속 받았다(2026-10-09 보안점검). 권한이 줄어드는 문에서 여기를 부른다.
'use strict';

/**
 * 한 워크스페이스의 룸(business·그 워크스페이스 대화방·프로젝트)에서만 내보낸다.
 * 다른 워크스페이스 실시간은 그대로 둔다 — 소켓을 통째로 끊으면 화면이 다시 붙지 않는다
 * (서버가 끊은 연결은 socket.io 가 자동 재연결하지 않는다).
 */
async function leaveBusinessRooms(io, userId, businessId) {
  if (!io || !userId || !businessId) return;
  try {
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    if (!sockets.length) return;
    const { Conversation, Project } = require('../models');
    const [convs, projs] = await Promise.all([
      Conversation.findAll({ where: { business_id: businessId }, attributes: ['id'], raw: true }),
      Project.findAll({ where: { business_id: businessId }, attributes: ['id'], raw: true }),
    ]);
    const rooms = new Set([`business:${businessId}`]);
    for (const c of convs) { rooms.add(`conv:${c.id}`); rooms.add(`conv:${c.id}:staff`); }
    for (const p of projs) { rooms.add(`project:${p.id}`); rooms.add(`project:${p.id}:client`); }
    for (const s of sockets) {
      for (const r of [...s.rooms]) if (rooms.has(r)) s.leave(r);
    }
  } catch (e) {
    console.warn('[socketRevoke] leaveBusinessRooms', e.message);
  }
}

/** 계정 전체 회수(정지·삭제) — 모든 연결을 끊는다. 인증 미들웨어가 다시 붙는 것을 막는다. */
function disconnectUser(io, userId) {
  if (!io || !userId) return;
  try { io.in(`user:${userId}`).disconnectSockets(true); } catch (e) { console.warn('[socketRevoke] disconnectUser', e.message); }
}

module.exports = { leaveBusinessRooms, disconnectUser };
