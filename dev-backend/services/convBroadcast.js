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
  // 프로젝트·고객 방 — 관리자(owner/admin, 열린 문화) ∪ 그 방에 참여한 직원에게만 `user:` 방으로(2026-11-06 Irene · Fable 검증 FAIL ②).
  //   멤버(member)는 참여한 방만 본다(access_scope.participantOnlyScope) — `business:` 방으로 보내면 비참여 멤버 소켓에 본문(내부메모 포함)이 간다.
  //   숨은 프로젝트(2026-10-16)도 이 청중에 들어간다(관리자는 모든 프로젝트를 본다). 고객 참여자는 종전대로 여기서 보내지 않는다(내부 메시지가 섞일 수 있다).
  if (!conv.business_id) return;
  const { ConversationParticipant, BusinessMember, Business } = require('../models');
  const { Op } = require('sequelize');
  const parts = (await ConversationParticipant.findAll({ where: { conversation_id: conv.id }, attributes: ['user_id'], raw: true }))
    .map((p) => Number(p.user_id)).filter(Boolean);
  const staff = await BusinessMember.findAll({
    where: { business_id: conv.business_id, removed_at: null, user_id: { [Op.ne]: null },
      [Op.or]: [{ role: { [Op.in]: ['owner', 'admin'] } }, ...(parts.length ? [{ user_id: { [Op.in]: parts } }] : [])] },
    attributes: ['user_id'], raw: true,
  });
  const aud = new Set(staff.map((s) => Number(s.user_id)));
  const biz = await Business.findByPk(conv.business_id, { attributes: ['owner_id'], raw: true });
  if (biz?.owner_id) aud.add(Number(biz.owner_id));
  for (const id of aud) io.to(`user:${id}`).emit(event, payload);
}

module.exports = { emitConvWide };
