// 멘션 파서 — 댓글/메시지 본문에서 @username 패턴 찾고 워크스페이스 멤버에 매핑
//
// 패턴: @[A-Za-z0-9_가-힣.-]{2,30}  (영문/한글/숫자 + . _ -, 2~30자)
// 매핑 우선순위: User.username == 매치 → User.name == 매치
//
// 결과: 매칭된 user_id 배열 (중복 제거, 작성자 본인 제외)

const { Op } = require('sequelize');
const { User, BusinessMember } = require('../models');

const MENTION_RE = /@([A-Za-z0-9_가-힣.\-]{2,30})/g;

function extractMentionTokens(text) {
  if (!text || typeof text !== 'string') return [];
  const tokens = new Set();
  let m;
  while ((m = MENTION_RE.exec(text)) !== null) {
    tokens.add(m[1]);
  }
  return [...tokens];
}

// 워크스페이스 멤버 중에서 username/name 일치하는 user_id 반환
async function resolveMentions(text, businessId, excludeUserId = null) {
  const tokens = extractMentionTokens(text);
  if (tokens.length === 0) return [];

  // 워크스페이스 멤버의 user_id 화이트리스트
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: ['user_id'],
  });
  const memberIds = members.map((m) => m.user_id);
  if (memberIds.length === 0) return [];

  // username 또는 name 으로 매칭
  const users = await User.findAll({
    where: {
      id: { [Op.in]: memberIds },
      [Op.or]: [
        { username: { [Op.in]: tokens } },
        { name: { [Op.in]: tokens } },
      ],
    },
    attributes: ['id', 'username', 'name'],
  });
  const ids = new Set(users.map((u) => u.id));
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

module.exports = { extractMentionTokens, resolveMentions, MENTION_RE };
