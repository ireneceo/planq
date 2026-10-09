// 대화방 사건을 «워크스페이스 전체» 로 알리는 문 — 한 곳 (2026-10-09 보안 점검 2차 D3).
//
// 왜: 새 메시지·반응·업무 후보는 `conv:<id>`(그 방을 열어 둔 사람) 말고도 워크스페이스 방(`business:<id>`)으로
//   같이 나간다 — 목록의 안읽음·토스터가 그것으로 움직인다. 그런데 사적 대화방(사람을 골라 만든 팀 대화)은
//   **참여자만** 본다. 워크스페이스 방으로 보내면 목록을 막아도 본문이 전원 소켓에 간다.
//   → 사적 방이면 참여자 각자의 `user:` 방(모든 소켓이 연결 때 자동으로 든다)으로만 보낸다. 그 밖은 종전대로.
//   `business:` 방으로 이 사건들을 직접 보내지 않는다 — 가드 `--category=broadcast`(checkConvBroadcast)가 막는다.
'use strict';

async function emitConvWide(io, conv, event, payload) {
  if (!io || !conv) return;
  const { isPrivateConversation } = require('../middleware/access_scope');
  if (await isPrivateConversation(conv)) {
    const { ConversationParticipant } = require('../models');
    const parts = await ConversationParticipant.findAll({
      where: { conversation_id: conv.id }, attributes: ['user_id'], raw: true,
    });
    for (const p of parts) if (p.user_id) io.to(`user:${p.user_id}`).emit(event, payload);
    return;
  }
  if (conv.business_id) io.to(`business:${conv.business_id}`).emit(event, payload);
}

module.exports = { emitConvWide };
