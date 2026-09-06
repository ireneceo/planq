// canary-tablet-chrome — 상단 크롬(탭바·모바일헤더) 9 뷰포트 전수검사.
//
// ★ 왜 (2026-09-06 운영, Irene 안드로이드 태블릿): "태블릿 사이즈는 상단탭 기능도 그대로 있어야
//   하는 거 아니야? 왜 다 모바일처럼 나와?" → 이어서 "세로에도 넣어줘".
//   탭을 켜자 **모바일 헤더(56)와 탭바(40)가 같이 떠 96px** 이 됐고, 탭바는 도킹되지도 않은
//   사이드바 폭만큼 오른쪽으로 밀려 있었다. 좌표로만 잡히는 종류라 카나리로 박제한다.
//
// 판정 4가지:
//   ① 폭·높이 게이트대로 탭이 켜지고 꺼지는가 (폰 4 OFF / 태블릿·데스크탑 5 ON)
//   ② 상단 크롬이 **한 겹**인가 (탭바와 모바일 헤더가 동시에 뜨지 않는가)
//   ③ 사이드바가 드로어인 폭에서 탭바가 x=0 인가 (밀리면 왼쪽에 빈 띠)
//   ④ 사이드바로 가는 길이 항상 있는가 (드로어 폭 = 햄버거 / 도킹 폭 = 사이드바 자체)
const { launch, login, goto, sleep } = require('./lib/browser');

const VIEWPORTS = [
  { n: '폰세로 iPhone14',  w: 390,  h: 844,  tab: false },
  { n: '폰세로 ProMax',    w: 430,  h: 932,  tab: false },
  { n: '폰가로 iPhone14',  w: 844,  h: 390,  tab: false },
  { n: '폰가로 ProMax',    w: 932,  h: 430,  tab: false },
  { n: '태블세로 A8',      w: 600,  h: 912,  tab: true  },
  { n: '태블세로 iPad',    w: 768,  h: 1024, tab: true  },
  { n: '태블가로 A8',      w: 960,  h: 552,  tab: true  },
  { n: '태블가로 iPad',    w: 1024, h: 768,  tab: true  },
  { n: '데스크탑',         w: 1440, h: 900,  tab: true  },
];
const DOCK_BP = 1024;   // theme/breakpoints BP.tablet — 이하는 사이드바가 오프캔버스 드로어

function measure() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vis = (el) => { if (!el) return null; const cs = getComputedStyle(el); const b = box(el);
    return (cs.display !== 'none' && cs.visibility !== 'hidden' && b.w > 0 && b.h > 0) ? b : null; };
  const strip = vis(document.querySelector('[data-testid="tabstrip"]'));
  const menu  = vis(document.querySelector('[data-testid="tabstrip-menu"]'));
  // 모바일 헤더 — 탭바가 아닌, 화면 위에 가로로 꽉 찬 fixed 크롬.
  let header = null;
  for (const el of document.querySelectorAll('div')) {
    if (el.closest('[data-testid="tabstrip"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') continue;
    const b = box(el);
    if (b.y === 0 && b.x === 0 && b.w >= window.innerWidth - 1 && b.h > 0 && b.h < 130
        && el.querySelector('button')) { header = b; break; }
  }
  return { strip, menu, header, iw: window.innerWidth, ih: window.innerHeight };
}

async function run() {
  const results = [];
  let browser, page;
  try { ({ browser, page } = await launch()); }
  catch (e) { return [{ name: 'tabletchrome:launch', error: true, fatal: 1, detail: e.message }]; }
  try {
    await page.setViewport({ width: 1440, height: 900 });
    try { await login(page); }
    catch (e) { return [{ name: 'tabletchrome:login', error: true, fatal: 1, detail: e.message }]; }

    for (const v of VIEWPORTS) {
      await page.setViewport({ width: v.w, height: v.h });
      await goto(page, '/inbox');
      await sleep(600);
      let m;
      try { m = await page.evaluate(measure); }
      catch (e) { results.push({ name: `tabletchrome:${v.n}`, fail: 1, fatal: 0, details: [e.message] }); continue; }

      const drawer = v.w <= DOCK_BP;
      const stripOn = !!m.strip, headerOn = !!m.header, menuOn = !!m.menu;
      const chrome = (m.strip ? m.strip.h : 0) + (m.header ? m.header.h : 0);
      const bad = [];
      if (stripOn !== v.tab) bad.push(`탭 기대 ${v.tab ? 'ON' : 'OFF'} → 실제 ${stripOn ? 'ON' : 'OFF'}`);
      if (stripOn && headerOn) bad.push(`상단 두 겹 ${chrome}px (탭 ${m.strip.h} + 헤더 ${m.header.h})`);
      if (stripOn && drawer && m.strip.x !== 0) bad.push(`탭바 x=${m.strip.x} — 드로어 폭인데 밀림`);
      if (drawer && !headerOn && !menuOn) bad.push('사이드바로 가는 길 없음 (헤더도 햄버거도 없다)');
      if (!drawer && menuOn) bad.push('도킹 폭인데 햄버거 노출');

      // 좌표는 통과일 때도 남긴다 — 초록만 보고는 "무엇이 초록인지" 를 모른다.
      const coords = `탭=${stripOn ? `y${m.strip.y} h${m.strip.h} x${m.strip.x}` : 'off'} · 헤더=${headerOn ? `h${m.header.h}` : 'off'} · 크롬=${chrome}px · 햄버거=${menuOn ? `x${m.menu.x} ${m.menu.w}×${m.menu.h}` : '-'}`;
      results.push({
        name: `tabletchrome:${v.n} ${v.w}×${v.h}`,
        fail: bad.length ? 1 : 0, fatal: 0,
        detail: coords,
        details: [coords, ...bad],
      });
    }
  } finally { if (browser) await browser.close(); }
  return results;
}

module.exports = { name: 'tabletchrome', run };

// 단독 실행도 가능하게 — 러너 없이 좌표만 빨리 보고 싶을 때.
if (require.main === module) {
  run().then((rs) => {
    let bad = 0;
    for (const r of rs) {
      const f = (r.fail || 0) + (r.fatal || 0) + (r.error ? 1 : 0);
      bad += f;
      console.log(`${f ? '❌' : '✅'} ${r.name}  ${r.detail || ''}`);
      (r.details || []).forEach((d) => console.log('     → ' + d));
    }
    console.log(bad ? `\n❌ FAIL ${bad}` : `\n✅ PASS ${rs.length}/${rs.length}`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error('ERR', e && e.message); process.exit(2); });
}
