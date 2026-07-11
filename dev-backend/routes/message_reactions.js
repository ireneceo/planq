// 메시지 이모지 리액션 (#138)
//
// 토글 방식 — 같은 사용자가 같은 메시지에 같은 이모지를 다시 누르면 취소.
// 접근 제어: 그 메시지가 속한 대화방에 접근 가능한 사람만 (canAccessConversation — client 격리 포함).
// 실시간: business room + conv room 으로 broadcast (CLAUDE.md 운영 안정성 16번).
// 조회 전용 라우트는 없다 — 리액션은 메시지 목록에 동봉되어 내려간다 (N+1 방지 + 죽은 API 방지).
const express = require('express');
const router = express.Router();
const { Message, MessageReaction, Conversation, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, canAccessConversation } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');

// 허용 이모지 — 임의 문자열 저장 금지(스토리지·렌더 오염 차단). 채팅 리액션 표준 세트.
const ALLOWED = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '✅', '🔥'];

// 메시지 → 대화방 로드 + 접근 검사
async function loadMessageOrFail(req, res) {
  const businessId = Number(req.params.businessId);
  const message = await Message.findByPk(req.params.messageId);
  if (!message) { errorResponse(res, 'message_not_found', 404); return null; }

  const conv = await Conversation.findOne({
    where: { id: message.conversation_id, business_id: businessId },
  });
  if (!conv) { errorResponse(res, 'conversation_not_found', 404); return null; }
  if (!(await canAccessConversation(req.user.id, conv, req.scope))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return { message, conv };
}

// 한 메시지의 리액션을 이모지별로 묶어 반환 (프론트가 칩으로 렌더)
async function serializeReactions(messageId, businessId, meId) {
  const rows = await MessageReaction.findAll({
    where: { message_id: messageId, business_id: businessId },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'] }],
    order: [['id', 'ASC']],
  });
  const plain = rows.map((r) => r.toJSON());
  await applyMemberDisplayName(plain, businessId, ['user']);

  const byEmoji = new Map();
  for (const r of plain) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, users: [], mine: false });
    const g = byEmoji.get(r.emoji);
    g.count += 1;
    g.users.push({ id: r.user_id, name: r.user?.name || null });
    if (r.user_id === meId) g.mine = true;
  }
  return [...byEmoji.values()];
}

function broadcast(req, message, reactions) {
  const io = req.app.get('io') || global.__planqIo;
  if (!io) return;
  const payload = { message_id: message.id, conversation_id: message.conversation_id, reactions };
  io.to(`conv:${message.conversation_id}`).emit('message:reaction', payload);
  io.to(`business:${message.business_id || Number(req.params.businessId)}`).emit('message:reaction', payload);
}

// POST /api/messages/:businessId/:messageId/reactions  { emoji } — 토글
router.post('/:businessId/:messageId/reactions', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const emoji = String(req.body?.emoji || '');
    if (!ALLOWED.includes(emoji)) return errorResponse(res, 'unsupported_emoji', 400);

    const loaded = await loadMessageOrFail(req, res);
    if (!loaded) return;
    const businessId = Number(req.params.businessId);
    const { message } = loaded;

    // 삭제된 메시지("삭제된 메시지" 로 마스킹된 것)에는 반응을 달 수 없다 (Fable 경고 1).
    if (message.is_deleted) return errorResponse(res, 'message_deleted', 400);

    const existing = await MessageReaction.findOne({
      where: { message_id: message.id, user_id: req.user.id, emoji, business_id: businessId },
    });
    let toggled;
    if (existing) {
      await existing.destroy();
      toggled = 'removed';
    } else {
      try {
        await MessageReaction.create({
          message_id: message.id, user_id: req.user.id, business_id: businessId, emoji,
        });
        toggled = 'added';
      } catch (e) {
        // 동시 클릭 — UNIQUE 충돌은 이미 달린 것으로 취급 (에러 아님)
        if (e?.name !== 'SequelizeUniqueConstraintError') throw e;
        toggled = 'added';
      }
    }

    const reactions = await serializeReactions(message.id, businessId, req.user.id);
    broadcast(req, message, reactions);
    return successResponse(res, { toggled, emoji, reactions });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.ALLOWED_EMOJIS = ALLOWED;
