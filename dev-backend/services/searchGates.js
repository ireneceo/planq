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

/** 새 다섯 그룹(메일·일정·상담·프로젝트 메모·회의록, 2026-10-04 M3-b)을 이 사람에게 찾아 줄 것인가.
 *  화면에서 그 메뉴가 숨겨졌으면 검색에서도 안 낸다 — 각 목록 라우트의 requireMenu 와 같은 메뉴 키.
 *  고객(client)에게는 다섯 그룹 모두 내지 않는다(메일·상담·메모·회의록은 멤버 도구이고, 일정은 고객 화면이 따로 있다). */
const NEW_GROUP_MENUS = { mail: 'qmail', events: 'qcalendar', interactions: 'qsale', project_notes: 'qtask', meeting_notes: 'qnote' };
async function newGroupGates(businessId, user, isClient) {
  const out = {};
  for (const k of Object.keys(NEW_GROUP_MENUS)) out[k] = !isClient;
  if (isClient || user.platform_role === 'platform_admin') return out;
  const lv = await require('../middleware/menu_permission').getMemberMenuLevels(businessId, user.id);
  if (!lv) { for (const k of Object.keys(out)) out[k] = false; return out; }
  if (lv.role === 'owner' || lv.role === 'admin' || !lv.menus) return out;
  for (const [k, menu] of Object.entries(NEW_GROUP_MENUS)) if (lv.menus[menu] === 'none') out[k] = false;
  return out;
}

module.exports = { allowedKbIds, applyMenuGates, newGroupGates, NEW_GROUP_MENUS };
