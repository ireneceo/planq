// services/displayName.js
//
// 워크스페이스 단위 표시명 우선 — BusinessMember.name → fallback User.name.
// CLAUDE.md "계정 vs 워크스페이스 프로필 분리 (2026-05-01)":
//   users.name = 계정 이름 (로그인 ID 와 분리)
//   business_members.name = 워크스페이스별 표시명 (없으면 null → User.name fallback)
//
// 사용:
//   const { applyMemberDisplayName } = require('../services/displayName');
//   const messages = await Message.findAll({...}).then(rs => rs.map(r => r.toJSON()));
//   await applyMemberDisplayName(messages, businessId, ['sender']);   // sender.name / sender.name_localized 덮어쓰기
//
// 라우트는 응답 객체(plain JSON) 만 다룬다 — Sequelize 인스턴스 X.

const { BusinessMember } = require('../models');

// businessId × userIds → Map<userId, {name, name_localized}>.
// row 없거나 name 비어있으면 Map 에 미포함 (caller fallback 유도).
async function getMemberNameMap(businessId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length || !businessId) return new Map();
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, user_id: ids },
    attributes: ['user_id', 'name', 'name_localized'],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) {
    if (!r.name && !r.name_localized) continue;
    map.set(r.user_id, { name: r.name || null, name_localized: r.name_localized || null });
  }
  return map;
}

// items 의 path 위치(중첩 dot path 지원, 예: 'sender' 또는 'sender' / 'User')의 객체에 대해
// BusinessMember.name 으로 name/name_localized 를 덮어쓴다.
// items 는 toJSON() 된 plain object 배열을 가정.
async function applyMemberDisplayName(items, businessId, paths = ['sender']) {
  if (!Array.isArray(items) || !items.length || !businessId) return items;
  // 모든 path 의 user id 수집
  const ids = [];
  for (const it of items) {
    for (const p of paths) {
      const obj = it?.[p];
      if (obj && obj.id) ids.push(obj.id);
    }
  }
  const map = await getMemberNameMap(businessId, ids);
  if (!map.size) return items;
  for (const it of items) {
    for (const p of paths) {
      const obj = it?.[p];
      if (!obj || !obj.id) continue;
      const m = map.get(obj.id);
      if (!m) continue;
      if (m.name) obj.name = m.name;
      if (m.name_localized) obj.name_localized = m.name_localized;
      // #277 — 정본은 display_name* 한 벌이다.
      //   프론트 utils/displayName.ts 는 display_name_localized > display_name > name_localized > name
      //   순으로 읽는다. name 만 덮어쓰면, 이 헬퍼를 안 지나는 payload 가 하나라도 섞이는 순간
      //   계정명이 그대로 새어나온다(운영 #277: AI 예측 broadcast 가 정상 이름을 계정명으로 덮어썼다).
      //   여기서 우선순위 필드까지 같이 채워 두면 어느 경로로 합쳐지든 워크스페이스 표시명이 이긴다.
      //   (routes/businesses.js 의 members 응답과 같은 필드 의미 — 이중 정의 아님)
      if (m.name) obj.display_name = m.name;
      if (m.name_localized) obj.display_name_localized = m.name_localized;
    }
  }
  return items;
}

// 단일 객체 (예: 메시지 1건) — 동일 로직
async function applyMemberDisplayNameOne(item, businessId, paths = ['sender']) {
  if (!item || !businessId) return item;
  await applyMemberDisplayName([item], businessId, paths);
  return item;
}

// 단일 user 의 display name (sequelize 가 어려운 raw SQL 결과 case 등)
async function getMemberDisplayName(businessId, userId, fallbackName, fallbackLocalized) {
  if (!businessId || !userId) return { name: fallbackName || null, name_localized: fallbackLocalized || null };
  const row = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId },
    attributes: ['name', 'name_localized'],
    raw: true,
  });
  return {
    name: row?.name || fallbackName || null,
    name_localized: row?.name_localized || fallbackLocalized || null,
  };
}

/**
 * 게스트 메시지의 표시명을 **메시지 행에 박제된 값**으로 바꾼다 (#259, 2026-09-02).
 *
 * 신원(누가 썼나)은 링크의 그림자 User 이고 그 이름은 "게스트" 로 고정돼 있다.
 * 화면에 뜨는 이름은 그 메시지를 쓸 때 실려 온 `meta.guest.name` 이다.
 * **이 둘을 갈라 두는 이유**: 한 링크를 카톡방에서 여럿이 나눠 갖는 것이 이 기능의 전제라
 * (설계 §2), 이름을 사람(User)에 두면 나중 사람이 이름을 정하는 순간
 * **이미 보낸 과거 메시지의 이름까지 소급해서 바뀐다.**
 *
 * 읽는 곳이 여럿이라 **여기 한 곳**에서만 바꾼다 — 경로마다 따로 쓰면 반드시 갈라진다.
 * 이름이 없으면 건드리지 않는다(그림자 User 의 "게스트" 가 그대로 뜬다).
 *
 * @param {object|object[]} rows  toJSON 된 메시지(들)
 * @param {string} senderPath     sender 가 들어 있는 키 (기본 'sender')
 */
function applyGuestDisplayName(rows, senderPath = 'sender') {
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    if (!row) continue;
    const sender = row[senderPath];
    if (!sender || sender.is_guest !== true) continue;
    const name = row.meta && row.meta.guest && row.meta.guest.name;
    if (name) {
      sender.name = String(name);
      // 다국어 이름은 게스트에게 없다 — 남아 있으면 프론트가 그쪽을 먼저 본다.
      if ('name_localized' in sender) sender.name_localized = null;
    }
  }
  return rows;
}

module.exports = {
  getMemberNameMap,
  applyMemberDisplayName,
  applyMemberDisplayNameOne,
  getMemberDisplayName,
  applyGuestDisplayName,
};
