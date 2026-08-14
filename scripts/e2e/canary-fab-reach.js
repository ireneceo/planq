// canary-fab-reach — 우하단 도크 FAB 이 **실제로 눌리는가**를 실브라우저로 감시한다.
//
// 왜 런타임 카나리인가 (정적 검사가 원리적으로 못 잡는다):
//   겹침은 두 파일의 CSS 가 **합쳐진 뒤에야** 존재한다. RightDock 은 `right:20 bottom:16 z:120`,
//   PwaInstallBanner 는 `right:16 bottom:16 z:8500` — 각각만 보면 둘 다 정상이다.
//   같은 화면에 얹히는 순간 배너가 FAB 을 통째로 덮어 **모든 페이지에서 도크가 안 눌린다**.
//   2026-08-14 실측: /dashboard·/tasks·/talk·/calendar·/docs 전부 `elementFromPoint(FAB중심)` 이
//   배너의 버튼을 돌려줬다(도달 0/5). 코드 리뷰·빌드·정적 가드 전부 통과한 채 운영에 있었다.
//
// 판정 2축 (하나라도 걸리면 실패):
//   ① 도달성 — FAB 중심의 최상단 요소가 FAB(또는 그 자손)인가
//   ② 침범   — FAB 사각형과 겹치는 **다른 fixed 요소**가 있는가
//      ②가 필요한 이유: ①만 보면 "중심 1px 은 비었지만 절반이 가려진" 상태를 통과시킨다.
//      클릭 좌표 운에 판정이 흔들리면 가드가 조용히 죽는다.
const { launch, login, goto, gotoSPA, sleep } = require('./lib/browser');

const DESKTOP_ROUTES = ['/dashboard', '/tasks', '/talk', '/calendar', '/docs'];
const VP_DESKTOP = { width: 1500, height: 950 };

// 주의: 브라우저 안에서 실행된다 — Node 스코프 상수를 참조할 수 없다.
const PROBE = () => {
  const fab = document.querySelector('[data-testid="right-dock-fab"]');
  if (!fab) return { fabPresent: false };
  const r = fab.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { fabPresent: false };
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const name = (el) => {
    if (!el) return '(없음)';
    const id = el.getAttribute && el.getAttribute('data-testid');
    const al = el.getAttribute && el.getAttribute('aria-label');
    return el.tagName + (id ? `[${id}]` : '') + (al ? `("${String(al).slice(0, 24)}")` : '');
  };
  const top = document.elementFromPoint(cx, cy);
  const reaches = !!(top && (top === fab || fab.contains(top)));

  const intruders = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el === fab || el.contains(fab) || fab.contains(el)) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    if (cs.pointerEvents === 'none') return;   // 클릭을 통과시키는 컨테이너는 침범이 아니다
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    if (b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) return;
    intruders.push(`${name(el)} z=${cs.zIndex} rect=${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`);
  });

  return { fabPresent: true, reaches, top: name(top), intruders };
};

async function probeRoute(page, route, label) {
  const out = await page.evaluate(PROBE);
  if (!out.fabPresent) {
    // FAB 이 없는 화면은 판정 대상이 아니다(팝아웃·공개 표면 등). 다만 워크스페이스 화면에서
    // 사라졌다면 그것대로 회귀이므로 눈에 보이게 남긴다.
    return { route: label, leaked: false, detail: '⚪ FAB 없음 (판정 제외)' };
  }
  const bad = !out.reaches || out.intruders.length > 0;
  const detail = bad
    ? `— 도달=${out.reaches ? 'O' : 'X'}(최상단 ${out.top})` +
      (out.intruders.length ? ` · 침범 ${out.intruders.length}건: ${out.intruders.join(' | ')}` : '')
    : '— 도달 O · 침범 0';
  return { route: label, leaked: bad, detail };
}

async function run() {
  const results = [];
  const { browser, page } = await launch();
  try {
    await page.setViewport(VP_DESKTOP);
    await login(page);
    await goto(page, DESKTOP_ROUTES[0]);
    for (const route of DESKTOP_ROUTES) {
      if (route !== DESKTOP_ROUTES[0]) { await gotoSPA(page, route); await sleep(1200); }
      try {
        results.push(await probeRoute(page, route, `desktop ${route}`));
      } catch (e) {
        results.push({ route: `desktop ${route}`, error: e.message });
      }
    }
  } catch (e) {
    results.push({ route: 'desktop', error: e.message, fatal: 1 });
  } finally {
    await browser.close();
  }

  // 모바일 — FAB 은 48×48 이고 InstallPromptBanner 가 bottom 80 으로 이미 비켜 있다(그 전례가 정본).
  const m = await launch({ mobile: true });
  try {
    await login(m.page);
    await goto(m.page, '/dashboard');
    await sleep(800);
    results.push(await probeRoute(m.page, '/dashboard', 'mobile /dashboard'));
  } catch (e) {
    results.push({ route: 'mobile /dashboard', error: e.message });
  } finally {
    await m.browser.close();
  }

  return results;
}

module.exports = { run, name: 'canary-fab-reach' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 도크 FAB 도달성 카나리 (우하단 겹침) ===\n');
    for (const r of res) {
      const isBad = r.leaked || r.error || r.fatal;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'}  ${r.route} ${r.detail || r.error || ''}`);
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
