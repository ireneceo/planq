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
    // 그 워크스페이스 문서의 «누가 같이 쓰고 있나» 방에서도 뺀다(services/postPresence).
    await require('./postPresence').dropUserFromBusiness(io, userId, businessId);
  } catch (e) {
    console.warn('[socketRevoke] leaveBusinessRooms', e.message);
  }
}

/** 계정 전체 회수(정지·삭제) — 모든 연결을 끊는다. 인증 미들웨어가 다시 붙는 것을 막는다. */
function disconnectUser(io, userId) {
  if (!io || !userId) return;
  try { io.in(`user:${userId}`).disconnectSockets(true); } catch (e) { console.warn('[socketRevoke] disconnectUser', e.message); }
}

/**
 * 프로젝트가 «참여 멤버만» 이 되었거나 프로젝트 멤버가 빠졌을 때 — 이제 못 보는 직원의 소켓을
 * 그 프로젝트 방·그 프로젝트 대화방에서 내보낸다(2026-10-16 멤버 프로젝트 가시성 · Fable 재검증 B).
 *   볼 수 있는 사람 = access_scope.hiddenProjectAudience(프로젝트 멤버 ∪ owner/admin). 대화방은 그 방 참여자도 남긴다.
 *   고객 방(`…:client`)은 건드리지 않는다 — 고객의 가시성은 프로젝트 고객 관계로 따로 정해진다.
 *   전체 공개(audience=null)면 할 일이 없다.
 */
async function leaveHiddenProjectRooms(io, projectId) {
  if (!io || !projectId) return;
  try {
    const aud = await require('../middleware/access_scope').hiddenProjectAudience(projectId);
    if (!aud) return;
    const { Conversation, ConversationParticipant } = require('../models');
    const convs = await Conversation.findAll({ where: { project_id: projectId }, attributes: ['id'], raw: true });
    const checks = [[`project:${projectId}`, aud]];
    for (const c of convs) {
      const parts = (await ConversationParticipant.findAll({ where: { conversation_id: c.id }, attributes: ['user_id'], raw: true }))
        .map((p) => Number(p.user_id));
      const allowed = new Set([...aud, ...parts]);
      checks.push([`conv:${c.id}`, allowed], [`conv:${c.id}:staff`, allowed]);
    }
    for (const [room, allowed] of checks) {
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        const uid = Number(s.userId ?? s.data?.userId);
        // 고객 소켓은 conv:<id> 방에 참여자로 들어 있다 — 참여자는 allowed 에 있으므로 남는다.
        if (!uid || !allowed.has(uid)) s.leave(room);
      }
    }
  } catch (e) {
    console.warn('[socketRevoke] leaveHiddenProjectRooms', e.message);
  }
}

module.exports = { leaveBusinessRooms, disconnectUser, leaveHiddenProjectRooms };
