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

module.exports = {
  getMemberNameMap,
  applyMemberDisplayName,
  applyMemberDisplayNameOne,
  getMemberDisplayName,
};
