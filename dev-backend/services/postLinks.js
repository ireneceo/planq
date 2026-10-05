// services/postLinks.js — 문서 ↔ 문서 연결(«관련 문서»)은 **양방향**이다 (2026-10-05 Irene:
//   *"문서는 한쪽 연결하면 다른 쪽도 자동으로 연결되는 거야."*)
//
// 저장소는 그대로 각 문서의 `posts.linked_post_ids`(JSON 숫자 배열) 하나다. 새 표를 만들지 않는다.
//   - 읽을 때: 내 목록 ∪ «나를 건 문서» = 그 문서의 연결 — 옛 단방향 연결도 백필 없이 양쪽에 보인다.
//   - 쓸 때: 걸면 상대 목록에도 나를 넣고, 끊으면 상대 목록에서도 나를 뺀다(어느 쪽에서 끊어도 끊긴다).
//
// ★ 상대 문서는 `silent` 로 쓴다 — updated_at 이 바뀌면 그 문서를 편집 중인 사람의 자동저장이
//   거짓 409(«다른 사람이 수정했습니다»)를 맞는다(#252 낙관적 잠금). 연결은 본문이 아니다.
// ★ 범위는 늘 같은 워크스페이스(business_id) 안이다 — 거는 것도, 상대를 고치는 것도.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const toIds = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

// 이 문서를 연결해 둔 다른 문서들(같은 워크스페이스, 삭제 안 된 것)
async function backLinkIds(post) {
  const rows = await sequelize.query(
    'SELECT id FROM posts WHERE business_id = ? AND deleted_at IS NULL AND id <> ? AND JSON_CONTAINS(linked_post_ids, ?)',
    { replacements: [post.business_id, post.id, String(post.id)], type: QueryTypes.SELECT },
  );
  return rows.map((r) => Number(r.id));
}

// 이 문서의 연결 전체(내 목록 ∪ 나를 건 문서) — 정렬은 내 목록 순서 먼저
async function effectiveLinkIds(post) {
  const own = toIds(post.linked_post_ids).filter((id) => id !== post.id);
  const back = await backLinkIds(post);
  return [...new Set([...own, ...back])];
}

// 요청을 «더한 것·뺀 것» 으로 바꾼다.
//   base(편집을 시작할 때 화면이 본 목록)가 오면 그것과 비교한다 — 그 사이 다른 사람이 건 연결을
//   화면이 몰랐다는 이유로 지우지 않는다. 없으면(옛 클라이언트) 지금 연결과 비교한다.
//   빼는 것은 **이 사람이 볼 수 있는 문서만** — 못 보는 연결은 칩으로도 안 보였으니 지운 것이 아니다.
async function resolveLinkChange({ post, user, requested, base, canRead, Post }) {
  const want = toIds(requested).filter((id) => id !== post.id);
  const effective = await effectiveLinkIds(post);
  const from = Array.isArray(base) ? toIds(base) : effective;
  const addIds = want.filter((id) => !from.includes(id) && !effective.includes(id));
  const removeCand = from.filter((id) => !want.includes(id) && effective.includes(id));

  const touch = [...new Set([...addIds, ...removeCand])];
  const rows = touch.length ? await Post.findAll({ where: { id: touch, business_id: post.business_id } }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const added = [];
  const removed = [];
  // 새로 거는 연결은 거는 사람이 볼 수 있는 문서만 — 칩에 제목이 보인다(2026-09-27 점검).
  for (const id of addIds) { const r = byId.get(id); if (r && await canRead(user, r)) added.push(r); }
  for (const id of removeCand) { const r = byId.get(id); if (r && await canRead(user, r)) removed.push(r); }

  const removedIds = new Set(removed.map((r) => r.id));
  const own = toIds(post.linked_post_ids).filter((id) => id !== post.id && !removedIds.has(id));
  for (const r of added) if (!own.includes(r.id)) own.push(r.id);
  return { next: own, added, removed };
}

// 상대 문서 쪽을 맞춘다. 돌려주는 값은 실제로 바뀐 상대 문서(방송용).
async function mirrorLinkChange(post, { added, removed }, Post) {
  const changed = [];
  for (const r of added) {
    const cur = toIds(r.linked_post_ids);
    if (cur.includes(post.id)) continue;
    await Post.update({ linked_post_ids: [...cur, post.id] },
      { where: { id: r.id, business_id: post.business_id }, silent: true, hooks: false });
    changed.push(r);
  }
  for (const r of removed) {
    const cur = toIds(r.linked_post_ids);
    if (!cur.includes(post.id)) continue;
    await Post.update({ linked_post_ids: cur.filter((id) => id !== post.id) },
      { where: { id: r.id, business_id: post.business_id }, silent: true, hooks: false });
    changed.push(r);
  }
  return changed;
}

module.exports = { backLinkIds, effectiveLinkIds, resolveLinkChange, mirrorLinkChange };
