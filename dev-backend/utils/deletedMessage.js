// utils/deletedMessage.js — 삭제된 메시지는 **자리만** 남긴다.
//
// 운영 정책은 "삭제 = 마스킹" 이다 (CLAUDE.md). 원본은 DB 에 남고, 화면에는
// "삭제된 메시지입니다" 자리가 남는다. 그런데 **원문이 화면 payload 까지 갈 이유는 없다.**
//
// ★ 왜 화이트리스트인가 — 지울 필드를 열거하는 방식은 컬럼이 늘 때마다 조용히 샌다.
//   실제로 샜다: `content` 만 비웠더니 `translations`(번역 캐시는 원문 언어 사본을 함께 갖는다)와
//   `ai_sources` 로 본문이 그대로 나갔다 (2026-09-02 Fable 검증 실측 — raw JSON 스캔).
//   앞으로 Message 에 컬럼이 늘어도 여기 이름을 올리지 않는 한 나가지 않는다.
//
// ★ 호출 시점 — 표시명(applyMemberDisplayName · applyGuestDisplayName)을 **다 적용한 뒤**.
//   게스트 이름은 `meta.guest.name` 에서 오는데 meta 를 먼저 지우면 그림자 User 의 이름
//   (= 고객 표시명) 으로 떨어져 **링크 받은 제3자가 고객 본인처럼 보인다** (#259 회귀).

// 자리를 그리는 데 필요한 것만. (프론트 apiMessageToMock 이 읽는 것 기준:
//  id · conversation_id · sender_id · sender{name,name_localized,is_guest} · is_ai · created_at · is_deleted)
const KEEP = new Set([
  'id', 'conversation_id', 'sender_id', 'sender',
  'is_ai',                 // Cue 자리는 Cue 로 보여야 한다
  'created_at', 'createdAt', 'updated_at', 'updatedAt',
  'is_deleted', 'deleted_at',
  'read_by_count', 'other_count',   // 본문이 아니다 (읽음 표시)
]);

// rows: toJSON 된 plain 객체 배열 (Sequelize 인스턴스가 아니다)
function maskDeletedMessages(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  for (const msg of list) {
    if (!msg || !msg.is_deleted) continue;
    for (const key of Object.keys(msg)) {
      if (!KEEP.has(key)) delete msg[key];
    }
    // 프론트가 `m.content.trim()` 을 부른다 — undefined 면 화면이 죽는다.
    msg.content = '';
    msg.attachments = [];
    msg.reactions = [];
  }
  return rows;
}

module.exports = { maskDeletedMessages, DELETED_MESSAGE_KEEP: KEEP };
