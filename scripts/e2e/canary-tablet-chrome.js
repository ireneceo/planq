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
//   ⑤ 오버레이 기준선(--chrome-top)이 **크롬이 끝나는 자리**와 정확히 같은가
//      (2026-09-06 Irene: "업무상세 열면 가로 세로 모두 상단 헤더에 딱 안맞고 틀어져").
//      값이 40 으로 하드코딩돼 있어 상태바(safe-top)만큼 어긋났다 — 웹은 safe-top 0 이라
//      데스크탑에서는 영영 안 드러난다. 그래서 **상태바가 있는 상태를 만들어** 잰다.
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
  // 오버레이 기준선을 **실제로 해석시켜** 잰다. custom property 의 getPropertyValue 는
  // 'calc(...)' 같은 토큰을 그대로 주므로 px 비교가 안 된다 — 탐침을 띄워 좌표로 받는다.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;width:1px;height:0;pointer-events:none;top:var(--chrome-top, 0px)';
  document.body.appendChild(probe);
  const chromeTopPx = Math.round(probe.getBoundingClientRect().y);
  // --pq-chrome-bottom = **상단 크롬이 끝나는 y**. 우측 곁패널 8곳이 전부 이 토큰(또는
  // belowTabs/belowChrome 조각)을 가리키므로, 이 값이 맞으면 그 패널들이 다 맞는다.
  probe.style.top = 'var(--pq-chrome-bottom, 0px)';
  const chromeBottomPx = Math.round(probe.getBoundingClientRect().y);
  probe.remove();
  return { strip, menu, header, chromeTopPx, chromeBottomPx, iw: window.innerWidth, ih: window.innerHeight };
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
      // ⑤ 오버레이 기준선(--chrome-top) — **모드마다 기대값이 다르다. 둘 다 못 박는다.**
      //   · 탭 모드(태블릿·데스크탑): 드로어는 탭바 **아래**에서 시작해야 한다. 탭바는 브라우저
      //     크롬이라 앱 오버레이가 덮으면 안 된다(#199). 기준선 = 크롬이 끝나는 자리.
      //   · 미러 모드(폰): 상세 드로어는 **전면**(width:100vw, CLAUDE.md 반응형 드로어 ≤640)
      //     이라 기준선 0 이 맞다. 헤더 아래로 내리면 폰 상세가 좁아진다 — 여기를 "고치면"
      //     Irene 이 확정한 iOS 기준을 깨는 것이다(2026-09-06 "테블릿 말하는 건데",
      //     "모바일 망치지 말고"). 그래서 0 을 **기대값으로** 적어 둔다.
      const chromeBottom = stripOn ? m.strip.y + m.strip.h : (headerOn ? m.header.y + m.header.h : 0);
      const expectBaseline = v.tab ? chromeBottom : 0;
      // ⑥ --pq-chrome-bottom 은 **모드 불문** 크롬이 끝나는 자리여야 한다. 폰이면 모바일 헤더
      //    아래, 탭 모드면 탭바 아래. Irene 이 말한 "어떤 디바이스든" 이 이 한 줄이다.
      if (m.chromeBottomPx !== chromeBottom) {
        bad.push(`--pq-chrome-bottom ${m.chromeBottomPx}px ≠ 크롬 끝 ${chromeBottom}px`);
      }
      if (m.chromeTopPx !== expectBaseline) {
        bad.push(`오버레이 기준선 ${m.chromeTopPx}px ≠ 기대 ${expectBaseline}px`
          + (v.tab ? ` (크롬 끝 ${chromeBottom} — ${Math.abs(m.chromeTopPx - chromeBottom)}px 어긋나 헤더를 파고든다)`
                   : ' (폰 상세는 전면이라 0 이어야 한다)'));
      }

      // 좌표는 통과일 때도 남긴다 — 초록만 보고는 "무엇이 초록인지" 를 모른다.
      const mkCoords = () => `탭=${stripOn ? `y${m.strip.y} h${m.strip.h} x${m.strip.x}` : 'off'} · 헤더=${headerOn ? `h${m.header.h}` : 'off'} · 크롬=${chrome}px · 햄버거=${menuOn ? `x${m.menu.x} ${m.menu.w}×${m.menu.h}` : '-'} · 기준선=${m.chromeTopPx} · 크롬끝토큰=${m.chromeBottomPx}/${chromeBottom}${m.nativeNote ? ' · ' + m.nativeNote : ''}`;
      // ★ 네이티브 모사 패스 — 브라우저는 --pq-safe-top 이 0 이라 이 계열 버그가 **재현되지 않는다**.
      //   'pq-android' 를 붙이면 index.css 의 규칙이 상태바 자리(≥24px)를 실제로 만든다.
      //   이 패스가 없으면 "기준선 40 = 크롬 끝 40" 으로 초록이 나오는데, 정작 기기에서는
      //   기준선 40 · 크롬 끝 64 로 24px 어긋난다(Irene 신고 그대로).
      let nativeBad = [];
      if (v.tab) {
        const nm = await page.evaluate((fn) => {
          document.documentElement.classList.add('pq-android');
          // eslint-disable-next-line no-eval
          const r = eval('(' + fn + ')')();
          document.documentElement.classList.remove('pq-android');
          return r;
        }, measure.toString());
        const nStrip = nm.strip, nHeader = nm.header;
        const nBottom = nStrip ? nStrip.y + nStrip.h : (nHeader ? nHeader.y + nHeader.h : 0);
        if (!nStrip) nativeBad.push('네이티브 모사: 탭바 사라짐');
        else if (nStrip.h <= m.strip.h) nativeBad.push(`네이티브 모사가 안 걸림 — 탭바 높이 ${nStrip.h} (상태바 자리가 안 생겼다)`);
        else if (nm.chromeTopPx !== nBottom) nativeBad.push(`네이티브 기준선 ${nm.chromeTopPx}px ≠ 크롬 끝 ${nBottom}px (${Math.abs(nm.chromeTopPx - nBottom)}px 어긋남)`);
        else if (nm.chromeBottomPx !== nBottom) nativeBad.push(`네이티브 --pq-chrome-bottom ${nm.chromeBottomPx}px ≠ 크롬 끝 ${nBottom}px`);
        if (nativeBad.length) bad.push(...nativeBad);
        else bad.length === 0 && (m.nativeNote = `네이티브 모사 탭바 h${nStrip.h} 기준선 ${nm.chromeTopPx} ✓`);
      }

      const coords = mkCoords();
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
