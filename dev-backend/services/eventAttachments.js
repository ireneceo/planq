// 일정 미팅자료(#411) — **붙일 수 있는가** 를 판정하는 한 곳.
//
// 일정 생성(services/actions/event_actions.js)과 상세에서 붙이기(routes/calendar_materials.js)가
// 같은 함수를 부른다. 베껴 두면 한쪽만 고쳐진다 — 2026-09-27 점검에서 «붙이는 사람이 볼 수 있는 것만»
// 을 생성 쪽에만 넣었다면, 상세에서 붙이는 문이 남의 «나만 보기» 자료를 참석자에게 흘리는 통로가 된다.
//
// 규칙
//   - 워크스페이스 축을 DB 에 되묻는다(id 를 받았다고 붙이지 않는다).
//   - **붙이는 사람이 읽을 수 있는 것만**(공유·참조 다섯 규칙 ⑤ — 읽기와 같은 술어).
//   - 파일·문서 **정확히 하나**. 둘 다이거나 둘 다 아니면 버린다(반쪽 행을 만들지 않는다).
//   - 같은 자료를 두 번 붙이지 않는다(이미 붙은 것은 `existing` 으로 넘겨 거른다).
const as = require('../middleware/access_scope');

/**
 * @param {object} p
 * @param {Array<{file_id?:number, post_id?:number}>} p.atts
 * @param {number} p.businessId
 * @param {number} p.userId        붙이는 사람
 * @param {number} p.eventId
 * @param {Set<string>} [p.existing] 이미 붙은 키(`f12` / `p7`)
 * @param {number} [p.startOrder]
 * @param {object} [p.transaction]
 * @returns {Promise<Array<object>>} bulkCreate 할 행
 */
async function attachableRows({ atts, businessId, userId, eventId, existing, startOrder = 0, transaction }) {
  const list = Array.isArray(atts) ? atts : [];
  if (!list.length) return [];
  const { File, Post } = require('../models');
  const wantFiles = list.map((a) => Number(a.file_id)).filter(Boolean);
  const wantPosts = list.map((a) => Number(a.post_id)).filter(Boolean);
  const scope = await as.getUserScope(userId, businessId);
  const okFiles = new Set();
  for (const f of (wantFiles.length ? await File.findAll({ where: { business_id: businessId, id: wantFiles, deleted_at: null }, transaction }) : [])) {
    if (await as.canDownloadFile(scope, userId, f)) okFiles.add(f.id);
  }
  const okPosts = new Set();
  for (const p of (wantPosts.length ? await Post.findAll({ where: { business_id: businessId, id: wantPosts }, transaction }) : [])) {
    const readable = scope.isClient ? await as.canAccessPost(userId, p, scope) : await as.canAccessPostByLevel(userId, p, scope);
    if (readable) okPosts.add(p.id);
  }
  const seen = new Set(existing || []);
  const rows = [];
  list.forEach((a, i) => {
    const fid = Number(a.file_id) || null;
    const pid = Number(a.post_id) || null;
    if (!!fid === !!pid) return;
    const key = fid ? `f${fid}` : `p${pid}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (fid && !okFiles.has(fid)) return;
    if (pid && !okPosts.has(pid)) return;
    rows.push({ business_id: businessId, event_id: eventId, file_id: fid, post_id: pid,
      sort_order: startOrder + i, created_by: userId });
  });
  return rows;
}

const keyOf = (row) => (row.file_id ? `f${row.file_id}` : `p${row.post_id}`);

module.exports = { attachableRows, keyOf };
