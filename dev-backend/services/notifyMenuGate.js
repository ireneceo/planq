// 알림이 여는 화면의 메뉴가 «숨김(none)» 인 멤버에게는 그 알림을 보내지 않는다 (2026-10-23)
//
// Irene: *"멤버 기본 권한이 없는 곳들의 워크스페이스 알림은 각 권한에 맞게 제한해야 해. 되고 있어?"*
//   099aec8f 가 서명(qdocs)·청구(qbill) 받는 사람만 좁혔고(services/notifyAudience.dropMenuNone), 나머지는 아니었다 —
//   회사 메일함 알림은 Q mail 이 숨김인 멤버에게도 갔고, 업무·일정·채팅·문서 댓글·설문·Q sale 도 메뉴를 보지 않았다.
//   그 알림을 누르면 화면은 «숨긴 메뉴» 안내만 낸다(MainLayout menuHidden) — 제목만 보이는 막다른 길이다.
//
// 판정 기준 = **알림 링크가 여는 화면**. 화면이 숨긴 메뉴를 가리는 표(dev-frontend/src/config/navMenus.ts
//   WORKSPACE_MENUS 의 `to` → permKey, permKeyForPath 의 «가장 긴 접두어») 와 같은 표다 — 둘 중 하나를 바꾸면 같이 바꾼다.
//   링크로 못 정하면(링크 없음·메뉴 밖 화면) 걸지 않는다 — 프로젝트·근태·급여 화면은 메뉴 권한 밖이다.
// owner/admin 은 getMemberMenuLevels 가 전권, 고객·멤버 아닌 사람은 null → 통과. 'read' 는 화면이 열리므로 통과.

const PATH_MENUS = [
  ['/talk', 'qtalk'], ['/mail', 'qmail'], ['/sale', 'qsale'], ['/tasks', 'qtask'],
  ['/calendar', 'qcalendar'], ['/notes', 'qnote'], ['/docs', 'qdocs'], ['/info', 'qinfo'],
  ['/files', 'qfile'], ['/bills', 'qbill'], ['/stats', 'insights'],
];
// 옛 서명 알림 주소(문서 id 경로) — 화면(utils/notificationLink.migrateLegacyPath)이 문서 화면으로 옮겨 연다
const LEGACY_DOCS = /^\/posts\/\d+$/;

function menuForLink(link) {
  if (typeof link !== 'string' || !link.startsWith('/')) return null;
  const p = link.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (LEGACY_DOCS.test(p)) return 'qdocs';
  let best = null;
  for (const [base, menu] of PATH_MENUS) {
    if ((p === base || p.startsWith(`${base}/`)) && (!best || base.length > best[0].length)) best = [base, menu];
  }
  return best ? best[1] : null;
}

/** 이 사람이 이 알림 화면을 못 여는가(메뉴 숨김). 판정 실패는 막는다 — 바로 앞 isWorkspaceRecipient 와 같은 fail-closed (Fable 권고) */
async function hiddenMenuFor(userId, businessId, link) {
  const menu = menuForLink(link);
  if (!menu || !businessId) return null;
  try {
    const { getMemberMenuLevels } = require('../middleware/menu_permission');
    const lv = await getMemberMenuLevels(businessId, userId);
    return lv && lv.menus && lv.menus[menu] === 'none' ? menu : null;
  } catch (e) {
    console.warn('[notify menu gate]', e.message);
    return menu;
  }
}

/** notify() 가 부른다 — 숨김이면 건너뛴 결과(모든 채널 false), 아니면 null.
 *  눌러도 «숨긴 메뉴» 안내만 나오는 알림이다. 서명·청구만 받는 사람 함수로 좁혀져 있었고 메일·업무·일정·채팅 등은 아니었다. */
async function menuSkip(userId, businessId, link) {
  const hidden = await hiddenMenuFor(userId, businessId, link);
  return hidden ? { inbox: false, email: false, push: false, skipped: `menu_none:${hidden}` } : null;
}

module.exports = { menuForLink, hiddenMenuFor, menuSkip, PATH_MENUS };
