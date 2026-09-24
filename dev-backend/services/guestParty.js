// services/guestParty.js — 게스트(무로그인 링크)에게 **누구로 보이는가** — 한 술어, 네 표면.
//
// 설계: docs/GUEST_PROJECT_VIEW_DECISIONS.md §A (Fable 2026-09-24).
//   Irene: *"업무관리는 담당자 표시할지 말지 체크하게 하면 안돼? 표시 안되는게 좋은데.
//   팀이름으로 표시하고 고객만 고객이름 표시하고."*
//
// ★ 스위치는 **워크스페이스 하나**다 — `businesses.permissions.client_show_assignee`(기본 false = 숨김).
//   링크·프로젝트마다 두면 보이지 않는 상태가 링크 수만큼 생긴다.
// ★ 숨길 때 멤버는 **워크스페이스 이름**(brand_name || name). `teams` 가 아니다(운영 0행이고 조직 구조다).
// ★ 고객은 스위치와 무관하게 **언제나 고객 이름**.
// ★ 문서·파일은 멤버면 칸을 **비운다(null)** — 카드마다 회사 이름을 반복하면 소음이다.
//   업무·채팅은 남긴다 — «우리 차례인가, 고객 차례인가» · «누가 말했나» 가 뜻이 있다.
// ★ 업무 `assignee_name` · 문서 `author_name` · 파일 `uploader_name` · 채팅 `sender_name` 이 **전부 이 파일을 부른다.**
//   라우트 안에서 표시명 규칙을 다시 쓰지 않는다(옛 guest_project.js guestDisplayNames 는 여기로 옮겨 지웠다).
// ★ 이메일은 읽지 않는다 — 무인증 응답이다.

const SURFACES = ['task', 'doc', 'file', 'chat'];

/** 이 워크스페이스가 고객에게 멤버 이름을 보이는가 + 대신 쓸 이름. */
async function loadGuestPartyPolicy(businessId) {
  const { Business } = require('../models');
  const b = await Business.findByPk(businessId, { attributes: ['name', 'brand_name', 'permissions'] });
  return {
    showMembers: !!(b && b.permissions && b.permissions.client_show_assignee === true),
    workspaceName: (b && (b.brand_name || b.name)) || null,
  };
}

/**
 * @param {number} businessId
 * @param {number[]} userIds
 * @param {{ surface: 'task'|'doc'|'file'|'chat', policy?: object }} opts
 * @returns {Promise<Map<number, string|null>>}
 */
async function guestPartyLabels(businessId, userIds, { surface, policy } = {}) {
  if (!SURFACES.includes(surface)) throw new Error(`guestPartyLabels: unknown surface ${surface}`);
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  const map = new Map();
  if (!ids.length) return map;
  const { Client, User } = require('../models');
  const pol = policy || await loadGuestPartyPolicy(businessId);

  // ① 고객 — 언제나 고객 이름 (이 워크스페이스의 고객 행만)
  const clients = await Client.findAll({
    where: { business_id: businessId, user_id: ids },
    attributes: ['user_id', 'display_name', 'company_name'], raw: true,
  });
  const clientIds = new Set();
  for (const c of clients) {
    clientIds.add(c.user_id);
    map.set(c.user_id, c.display_name || c.company_name || null);
  }
  const rest = ids.filter((id) => !clientIds.has(id));
  if (!rest.length) return map;

  // ② 그 외(멤버·Cue·탈퇴자 전부)
  if (!pol.showMembers) {
    const label = (surface === 'task' || surface === 'chat') ? pol.workspaceName : null;
    for (const id of rest) map.set(id, label);
    return map;
  }
  const { getMemberNameMap } = require('./displayName');
  const [wsMap, users] = await Promise.all([
    getMemberNameMap(businessId, rest),
    User.findAll({ where: { id: rest }, attributes: ['id', 'name'], raw: true }),
  ]);
  for (const u of users) map.set(u.id, u.name || null);
  for (const [uid, v] of wsMap) if (v && v.name) map.set(uid, v.name);
  return map;
}

module.exports = { loadGuestPartyPolicy, guestPartyLabels };
