// AI 에이전트 도구 — 메뉴 Layer 판정 **한 벌** (#439 M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §1.1·§7.1).
//
//   화면에서 안 보이는 메뉴를 AI 로 보면 안 된다(설계 §5.5). 여태 tasks·directory·notes·calendar 에 같은 함수가
//   **네 벌** 있었고 «멤버 행이 없을 때» 동작이 둘로 갈려 있었다(notes 는 거절, 나머지는 통과). 여기 하나로 모은다 —
//   멤버 행이 없으면 거절한다(canConnect 가 멤버만 연결시키므로 정상 경로에선 일어나지 않는 경우다. 일어나면 닫는 쪽이 맞다).
//
//   level: 'read'  → none 이면 거절            (code menu_hidden:<menu>)
//          'write' → write 가 아니면 거절       (code menu_read_only:<menu>, none 이면 menu_hidden)
const { err } = require('./errors');

async function assertMenu(p, menu, level = 'read') {
  const { getMemberMenuLevels } = require('../../middleware/menu_permission');
  const lv = await getMemberMenuLevels(p.businessId, p.userId);
  if (!lv) throw err('PERMISSION_DENIED', 'members_only');
  if (lv.role === 'owner' || lv.role === 'admin') return;
  const v = lv.menus[menu] || 'write';
  if (v === 'none') throw err('PERMISSION_DENIED', `menu_hidden:${menu}`);
  if (level === 'write' && v !== 'write') throw err('PERMISSION_DENIED', `menu_read_only:${menu}`);
}

module.exports = { assertMenu };
