// canary-landing-firstvisit — 공개 페이지 «캐시 없는 첫 방문» 크래시 (2026-10-02)
//
//   t(key, { returnObjects: true }) 는 번역 파일이 오기 전엔 **키 문자열**을 준다. 거기에 .map 을 걸면 화면 전체가
//   ErrorBoundary 로 덮인다 — 캐시가 있는 사람(우리)은 거의 못 보고, 처음 오는 방문자만 본다.
//   2026-10-02 Fable: /about 비로그인 4/4 재현. 공용 utils/i18nArray 로 막았다.
//   재는 것: 페이지마다 **새 브라우저 컨텍스트 + 캐시 끔**으로 4번 열어 ①크래시 문구 0 ②본문 표식이 보인다.
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = [
  { path: '/about', mark: 'main, section' },
  { path: '/service/diagnosis', mark: '[data-testid="diagnosis-page"]' },
  { path: '/privacy', mark: 'main, h1' },
  { path: '/terms', mark: 'main, h1' },
];
const CRASH = /Something went wrong|문제가 발생했|오류가 발생했어요/;

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    for (const pg of PAGES) {
      let crashes = 0; let rendered = 0; const errs = [];
      for (let i = 0; i < 4; i++) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        try {
          await page.setCacheEnabled(false);
          await page.setViewport({ width: 1280, height: 900 });
          page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)));
          await page.goto(`${b.BASE}${pg.path}`, { waitUntil: 'domcontentloaded' });
          let txt = ''; let has = false;
          for (let k = 0; k < 12; k++) {
            await sleep(500);
            ({ txt, has } = await page.evaluate((sel) => ({ txt: document.body.innerText.slice(0, 2000), has: !!document.querySelector(sel) }), pg.mark));
            if (CRASH.test(txt) || (has && txt.length > 200)) break;
          }
          if (CRASH.test(txt)) crashes += 1; else if (has) rendered += 1;
        } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
      }
      push(`${pg.path} · 첫 방문 4회 — 크래시 0 · 본문 4`, crashes === 0 && rendered === 4, JSON.stringify({ crashes, rendered, errs: [...new Set(errs)].slice(0, 2) }));
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}

module.exports = { name: '공개 페이지 첫 방문 크래시 — /about·/service/diagnosis·/privacy·/terms 캐시 없이 4회', run };
