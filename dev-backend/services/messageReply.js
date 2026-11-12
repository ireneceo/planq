// 답장(인용) 대상 고르기 — 같은 대화의 지워지지 않은 메시지에만 건다 (2026-11-12).
// 다른 방 id 를 끼우면 조용히 버린다(null). 화면은 보이는 목록에서만 원문을 찾으므로 원문이 새지 않지만,
// 저장 값 자체도 그 방 안으로 묶는다.
const { Message } = require('../models');

async function resolveReplyTo(conversationId, raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const target = await Message.findOne({ where: { id, conversation_id: conversationId, is_deleted: false }, attributes: ['id'] });
  return target ? target.id : null;
}

module.exports = { resolveReplyTo };
