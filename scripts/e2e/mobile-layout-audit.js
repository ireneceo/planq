// 모바일 레이아웃 감사 (2026-08-25) — "메뉴마다 2단·3단 형태가 다 다르다" 를 실측으로 잡는다.
//
// 추측으로 고치면 계속 다르다. 페이지마다 아래를 **재서** 표로 만든다:
//   ① 고정 헤더가 콘텐츠를 가리는가 (헤더 아래 첫 콘텐츠의 top 이 헤더 bottom 보다 위면 가려짐)
//   ② 가로로 넘치는가 (documentElement.scrollWidth > clientWidth)
//   ③ 패널이 몇 개 떠 있고 각각 폭이 얼마인가 (2단·3단이 폰에서 겹쳐 보이는 원인)
//   ④ 화면 밖으로 나간 고정 요소(우하단 FAB 등)가 콘텐츠를 덮는가
const { launch, login, gotoSPA, sleep, BASE } = require('./lib/browser');

const ROUTES = [
  ['확인필요', '/inbox'],
  ['Q Talk', '/talk'],
  ['Q Task', '/tasks'],
  ['Q Mail', '/mail'],
  ['Q Note', '/notes'],
  ['Q docs', '/docs'],
  ['Q File', '/files'],
  ['캘린더', '/calendar'],
  ['프로젝트', '/projects'],
  ['고객', '/business/clients'],
  ['설정', '/business/settings'],
];

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const out = { vw, vh, overflowX: document.documentElement.scrollWidth - vw, issues: [] };

    // 고정 헤더 목록 (position:fixed 이고 화면 상단에 붙은 것)
    const fixed = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      // ★ 높이 상한이 없으면 좌측 메뉴 드로어(전체 높이 fixed)를 헤더로 잡는다 — 첫 측정이 그렇게 거짓말했다.
      return r.height > 8 && r.height < 120 && r.width > vw * 0.6 && r.top <= 4;
    });
    const headerBottom = fixed.reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
    out.headerBottom = Math.round(headerBottom);

    // 콘텐츠 상단 — 고정 헤더가 아닌 것 중 화면 안에서 가장 위에 있는 "글자를 가진" 요소
    const isInFixed = (el) => fixed.some((f) => f.contains(el));
    let contentTop = Infinity; let sample = '';
    for (const el of document.querySelectorAll('h1,h2,h3,button,a,input,label,p,span')) {
      if (isInFixed(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.top < -50 || r.top > vh) continue;
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      if (r.top < contentTop) { contentTop = r.top; sample = txt.slice(0, 24); }
    }
    out.contentTop = Number.isFinite(contentTop) ? Math.round(contentTop) : null;
    out.contentSample = sample;
    if (headerBottom > 0 && Number.isFinite(contentTop) && contentTop < headerBottom - 2) {
      out.issues.push(`헤더가 콘텐츠를 가림 (헤더 ${Math.round(headerBottom)}px > 콘텐츠 ${Math.round(contentTop)}px · "${sample}")`);
    }
    if (out.overflowX > 2) out.issues.push(`가로 넘침 ${out.overflowX}px`);

    // 패널 — aside/main 중 화면에 보이는 것들의 폭
    const panels = [...document.querySelectorAll('aside, main, [data-panel]')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 100 && r.left < vw && r.right > 0;
    }).map((el) => ({
      tag: el.tagName.toLowerCase(),
      w: Math.round(el.getBoundingClientRect().width),
      pct: Math.round((el.getBoundingClientRect().width / vw) * 100),
    }));
    out.panels = panels;
    // 폰에서 두 패널이 동시에 보이면 드릴다운 규칙이 깨진 것
    const wide = panels.filter((p) => p.pct >= 25);
    if (wide.length >= 2) out.issues.push(`패널 ${wide.length}개 동시 노출 (${wide.map((p) => p.pct + '%').join(' + ')}) — 폰은 한 번에 하나여야`);
    return out;
  });
}

(async () => {
  const { browser, page } = await launch({ mobile: true });
  let fail = 0;
  try {
    await login(page);
    await page.goto(BASE + '/inbox', { waitUntil: 'networkidle2' });
    await sleep(1500);
    console.log(`\n=== 모바일 레이아웃 감사 (${BASE} · 375px) ===\n`);
    for (const [name, path] of ROUTES) {
      try {
        await gotoSPA(page, path);
        await sleep(1200);
        // 사이드 메뉴가 열려 있으면 닫는다(열린 상태로 재면 전부 "가려짐" 으로 나온다)
        await page.evaluate(() => {
          const bd = [...document.querySelectorAll('div')].find((d) => {
            const cs = getComputedStyle(d);
            const r = d.getBoundingClientRect();
            return cs.position === 'fixed' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9
              && /rgba?\(([0-9]+,\s*){2}[0-9]+,\s*0?\.[0-9]+\)/.test(cs.backgroundColor);
          });
          if (bd) bd.click();
        }).catch(() => {});
        await sleep(400);
        const m = await measure(page);
        const mark = m.issues.length ? '❌' : '✅';
        console.log(`${mark} ${name.padEnd(8)} ${path}`);
        console.log(`     헤더바닥 ${m.headerBottom}px · 콘텐츠상단 ${m.contentTop}px · 패널 ${m.panels.map((p) => p.pct + '%').join(',') || '없음'}`);
        for (const is of m.issues) { console.log(`     └ ${is}`); fail++; }
      } catch (e) {
        console.log(`⚠️ ${name} — 측정 실패: ${e.message.slice(0, 80)}`);
      }
    }
    console.log(`\n━━━ 문제 ${fail}건 ━━━`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})();
