// services/cueDrafts.js — 대기 중인 Cue 초안을 **자동으로 닫는** 한 곳 (2026-11-25 · Fable 설계 B3).
//
// 왜 — 직원이 먼저 고객에게 답해도 Cue 초안 카드가 계속 떠 있었고, 고객이 연달아 보내면 초안이 여러 개 쌓였다.
// 계약
//   - 새 칸·새 값 없음: `ai_draft_approved=false` 를 쓰되 **`ai_draft_approved_by = NULL`** = 자동 정리,
//     `by = 사람 id` = 사람이 거절(routes/projects.js reject-draft). 거절 학습·통계는 사람 거절만 본다.
//   - 불변식: 방마다 대기 초안(approved IS NULL)은 최대 1개.
//   - 조건부 UPDATE(`approved IS NULL`) — 그사이 사람이 승인한 초안은 건드리지 않는다(사람이 이긴다).
//   - 실제로 바뀐 행만 직원 방(`conv:<id>:staff`)에 message:updated — 화면은 거절 초안을 자리째 뺀다(QTalkPage).
//   - 감사 `cue.draft_superseded` — 본문은 싣지 않는다.
'use strict';
const { Op } = require('sequelize');

async function supersedePendingDrafts(conversation, { beforeMessageId, cause, io = null } = {}) {
  if (!conversation?.id || !beforeMessageId) return 0;
  try {
    const { Message } = require('../models');
    const pending = await Message.findAll({
      where: { conversation_id: conversation.id, is_ai: true, ai_mode_used: 'draft', ai_draft_approved: null, id: { [Op.lt]: beforeMessageId } },
      attributes: ['id'], raw: true,
    });
    if (!pending.length) return 0;
    const ids = pending.map((r) => r.id);
    const now = new Date();
    await Message.update(
      { ai_draft_approved: false, ai_draft_approved_by: null, ai_draft_approved_at: now },
      { where: { id: ids, ai_draft_approved: null } },
    );
    // 실제로 닫힌 것만(승인과 경합해 이미 승인된 행은 빠진다)
    const closed = await Message.findAll({ where: { id: ids, ai_draft_approved: false, ai_draft_approved_by: null }, attributes: ['id'], raw: true });
    const { createAuditLog } = require('../middleware/audit');
    for (const m of closed) {
      // 신호만(본문 없음) — 화면은 is_ai + approved=false 를 보고 자리째 뺀다(QTalkPage message:updated).
      if (io) io.to(`conv:${conversation.id}:staff`).emit('message:updated', { id: m.id, conversation_id: conversation.id, is_ai: true, ai_mode_used: 'draft', ai_draft_approved: false });
      createAuditLog({
        userId: null, businessId: conversation.business_id, action: 'cue.draft_superseded', targetType: 'Message', targetId: m.id,
        newValue: { conversation_id: conversation.id, by_message_id: beforeMessageId, cause },
      });
    }
    return closed.length;
  } catch (e) {
    console.warn('[cueDrafts.supersede]', e.message);
    return 0;
  }
}

module.exports = { supersedePendingDrafts };
