// services/searchGates.js — 통합검색(routes/search.js)의 권한 보조 판정 (2026-09-27 보안 점검).
//   search.js 가 500줄 한도를 넘지 않게 이곳에 둔다. 판정의 정본은 각 목록 라우트와 같은 술어다.
const { KbDocument } = require('../models');

/** raw SQL 후보(칸 값 검색) 중 **kbWhere 를 통과하는 id** — raw SQL 은 권한 술어를 모른다.
 *  전에는 이 재필터가 없어 남의 «나만 보기» Q info 가 칸 값으로 검색됐다. */
async function allowedKbIds(rawRows, kbWhere, businessId) {
  if (!rawRows || !rawRows.length) return new Set();
  const rows = await KbDocument.findAll({ where: { ...kbWhere, business_id: businessId, id: rawRows.map((r) => r.id) }, attributes: ['id'] });
  return new Set(rows.map((r) => r.id));
}

/** 목록 라우트가 requireMenu 로 막는 메뉴(Q task·Q sale)가 «숨김(none)» 인 멤버에게는 검색 결과도 비운다.
 *  (Q sale 을 숨긴 멤버에게 고객 명단·이메일이 검색됐다.) 배열을 제자리에서 비운다. */
async function applyMenuGates({ tasks, clients }, businessId, user, isClient) {
  if (isClient || user.platform_role === 'platform_admin') return;
  const lv = await require('../middleware/menu_permission').getMemberMenuLevels(businessId, user.id);
  if (!lv || !lv.menus) return;
  if (lv.menus.qtask === 'none') tasks.length = 0;
  if (lv.menus.qsale === 'none') clients.length = 0;
}

module.exports = { allowedKbIds, applyMenuGates };
