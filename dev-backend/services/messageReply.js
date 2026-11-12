// 답장(인용) 대상 고르기 — 같은 대화의 지워지지 않은 메시지에만 건다 (2026-11-12).
// 다른 방 id 를 끼우면 조용히 버린다(null). 화면은 보이는 목록에서만 원문을 찾으므로 원문이 새지 않지만,
// 저장 값 자체도 그 방 안으로 묶는다.
// ★ 보내는 사람이 고객이면 **고객에게 보이는 메시지만**(목록과 같은 술어). 안 그러면 고객이 id 를 하나씩 넣어
//   응답이 null 인지로 «내가 못 보는 내부 메모가 그 id 에 있다» 를 알아낸다(Fable 2026-11-12 B1 — 자리도 안 보인다).
const { Op } = require('sequelize');
const { Message } = require('../models');
const { CLIENT_VISIBLE_MESSAGE_WHERE } = require('../utils/messageVisibility');

async function resolveReplyTo(conv, userId, raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { getUserScope } = require('../middleware/access_scope');
  const viewer = await getUserScope(userId, conv.business_id).catch(() => null);
  // 판정을 못 하면 좁은 쪽(고객 기준)으로 떨어진다
  const where = { [Op.and]: [{ id, conversation_id: conv.id, is_deleted: { [Op.not]: true } }] };
  if (!viewer || viewer.isClient) where[Op.and].push(CLIENT_VISIBLE_MESSAGE_WHERE);
  const target = await Message.findOne({ where, attributes: ['id'] });
  return target ? target.id : null;
}

module.exports = { resolveReplyTo };
