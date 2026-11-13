// OS 푸시 배지의 채팅 안읽음 — 목록과 **같은 술어**(access_scope.conversationListWhere) 한 곳 (2026-11-06).
//   옛 SQL 은 프로젝트·고객 방을 전부 세서 멤버 배지가 58, 목록 안읽음은 4 로 갈렸다(Fable 검증 실측 · badges.md 계약).
//   사적 방·숨은 프로젝트·«멤버는 참여한 방만»(participantOnlyScope)이 저절로 따라온다.
// platformroom-exempt: 배지는 목록과 같은 범위(안내방 포함 — 목록에 보이고 안읽음도 센다)를 센다
'use strict';

async function chatUnreadForBadge(userId, businessId) {
  const { conversationListWhere } = require('../middleware/access_scope');
  const { Conversation } = require('../models');
  const { sequelize } = require('../config/database');
  const lw = await conversationListWhere(userId, Number(businessId));
  if (!lw) return 0;
  const cids = (await Conversation.findAll({ where: { ...lw, status: 'active', archived_at: null }, attributes: ['id'], raw: true })).map((r) => r.id);
  if (!cids.length) return 0;
  const [rows] = await sequelize.query(
    `SELECT COUNT(m.id) AS cnt
       FROM messages m
       LEFT JOIN conversation_participants cp /* own-row: 읽음 커서는 viewer 포함 */
         ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid
      WHERE m.conversation_id IN (:cids)
        AND m.sender_id != :uid
        AND (m.is_deleted IS NULL OR m.is_deleted = 0)
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
        AND cp.muted_at IS NULL /* 알림 끈 방은 앱 아이콘 숫자에서 뺀다(docs/QTALK_MUTE_DESIGN.md §3-4) */`,
    { replacements: { uid: userId, cids } }
  );
  return Number(rows[0]?.cnt || 0);
}

module.exports = { chatUnreadForBadge };
