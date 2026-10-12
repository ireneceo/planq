// canary-landing-gnb — 랜딩 상단 메뉴 정리 (2026-10-12 Fable 판정)
//
//   Irene: "랜딩페이지 GNB가 너무 많은데 … 전체 다 판단 좀 해줘. fable이"
//   계약: 데스크탑 메뉴는 기능·요금제·컨설팅·리소스▾·소개 / 리소스 = 시작 가이드·도움말·인사이트 /
//         우측 [앱 다운로드](글자) KO·EN [문의](outline) [로그인] [무료로 시작]. 폰·태블릿 시트는 가입 버튼 바로 아래 앱 다운로드
//         (스크롤 없이 첫 화면 — 2026-10-12 Irene «앱 다운로드 … 아예 없애면 어떻게 해? 상단에서»).
//         홈 히어로 아래 «시작 가이드» 한 줄 · 요금제 하단 → 컨설팅 · 컨설팅 → 요금제 · 소개는 PlanQ 가 먼저, 창업자 이야기가 뒤.
//   재는 것: 보이는가(elementFromPoint) · 한 줄 · 가로 넘침 · 눌러서 같은 창 이동.
//   대조군: LGNB_CONTROL=1 — 문의 버튼과 리소스 패널을 숨기는 CSS 를 심는다. 판정이 뒤집혀야 이 검사를 믿는다.
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTROL = process.env.LGNB_CONTROL === '1';
const CONTROL_CSS = '[data-testid="landing-gnb-contact"]{visibility:hidden!important} [data-testid="landing-gnb-resources-panel"]{display:none!important} [data-testid="landing-mobile-sheet"] a[href="/app"]{display:none!important} [data-testid="landing-gnb-app"]{visibility:hidden!important}';
const WIDTHS = [390, 820, 1024, 1440];
const RES = ['/start', '/guide', '/insights'];

// 요소가 실제로 그려져 손가락/마우스가 닿는가 — 페이지에 함수로 심는다(CSP 가 문자열 eval 을 막는 페이지가 있다)
const VIS_FN = 'window.__pqVis';
function installVis() {
  window.__pqVis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const h = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2)); return !!h && el.contains(h); };
}

async function open(browser, w, path) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: w < 700 ? 844 : 900 });
  await page.goto(`${b.BASE}${path}`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 25; i++) { await sleep(300); if (await page.$('header nav, header button[aria-label]')) break; }
  await sleep(500);
  if (CONTROL) await page.addStyleTag({ content: CONTROL_CSS });
  await page.evaluate(installVis);
  return { ctx, page };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name: (CONTROL ? '[대조군] ' : '') + name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    for (const w of WIDTHS) {
      const desktop = w >= 1024;
      // ① 상단 메뉴
      let { ctx, page } = await open(browser, w, '/features');
      try {
        if (desktop) {
          const g = await page.evaluate((vis) => {
            const V = window.__pqVis;
            const nav = document.querySelector('header nav');
            const links = [...nav.querySelectorAll(':scope > a')].map((a) => ({ href: a.getAttribute('href'), v: V(a) }));
            const res = document.querySelector('[data-testid="landing-gnb-resources"]');
            const right = ['[data-testid="landing-gnb-app"]', '[data-testid="landing-gnb-contact"]', 'header a[href="/login"]', 'header a[href="/register"]'].map((s) => V(document.querySelector(s)));
            const all = [...nav.querySelectorAll(':scope > a'), res, ...['[data-testid="landing-gnb-app"]', '[data-testid="landing-gnb-contact"]', 'header a[href="/login"]', 'header a[href="/register"]'].map((s) => document.querySelector(s))].filter(Boolean);
            const mids = all.map((x) => { const q = x.getBoundingClientRect(); return Math.round(q.top + q.height / 2); });
            return { links, res: V(res), right, oneLine: Math.max(...mids) - Math.min(...mids) <= 2, tall: all.filter((x) => x.getBoundingClientRect().height > 37).length,
              overflow: document.documentElement.scrollWidth - innerWidth };
          }, VIS_FN);
          const hrefs = g.links.map((x) => x.href).join(',');
          push(`${w}px · ① 메뉴 = 기능·요금제·컨설팅·소개 + 리소스 · 우측 앱 다운로드·문의·로그인·무료로 시작 · 한 줄 · 넘침 0`,
            hrefs === '/features,/pricing,/service,/about' && g.links.every((x) => x.v) && g.res && g.right.every(Boolean) && g.oneLine && g.tall === 0 && g.overflow <= 0, JSON.stringify(g));
          // ② 리소스 — 마우스를 올리면 열리고, 네 항목이 보이고, 누르면 같은 창으로 간다
          await page.hover('[data-testid="landing-gnb-resources"]');
          await sleep(300);
          const r = await page.evaluate((vis, RES) => { const V = window.__pqVis; const p = document.querySelector('[data-testid="landing-gnb-resources-panel"]');
            return { open: !!p, items: RES.map((h) => V(p && p.querySelector(`a[href="${h}"]`))) }; }, VIS_FN, RES);
          const appInPanel = await page.evaluate(() => !!document.querySelector('[data-testid="landing-gnb-resources-panel"] a[href="/app"]'));
          push(`${w}px · ② 리소스 열림 · 시작 가이드·도움말·인사이트 보임 · 앱 다운로드는 묶음 밖`,
            r.open && r.items.every(Boolean) && !appInPanel, JSON.stringify({ ...r, appInPanel }));
          // ②b 앱 다운로드 — 패널을 열지 않아도 상단에 보이고, 누르면 같은 창 /app
          await page.keyboard.press('Escape'); await page.mouse.move(5, 500); await sleep(300);
          const appVis = await page.evaluate(() => window.__pqVis(document.querySelector('[data-testid="landing-gnb-app"]')));
          let went = null;
          if (appVis) { await page.click('[data-testid="landing-gnb-app"]'); await sleep(800); went = await page.evaluate(() => location.pathname); }
          const pages = (await ctx.pages()).length;
          push(`${w}px · ②b 앱 다운로드가 상단에 바로 보임 · 눌러 같은 창 /app`, appVis && went === '/app' && pages === 1, JSON.stringify({ appVis, went, pages }));
          await page.goto(`${b.BASE}/features`, { waitUntil: 'domcontentloaded' }); await sleep(1200);
          if (CONTROL) await page.addStyleTag({ content: CONTROL_CSS });
          // ③ 스크롤 뒤(흰 GNB)에도 문의가 보인다 · Esc 로 패널이 닫힌다
          await page.evaluate(installVis);
          await page.evaluate(() => window.scrollTo(0, 600)); await sleep(400);
          // 마우스를 리소스에 올렸다가 누른다 — 올려서 열린 직후의 클릭이 메뉴를 닫으면 안 된다
          await page.hover('[data-testid="landing-gnb-resources"]'); await sleep(250);
          await page.click('[data-testid="landing-gnb-resources"]'); await sleep(200);
          const before = !!(await page.$('[data-testid="landing-gnb-resources-panel"]'));
          await page.keyboard.press('Escape'); await sleep(200);
          const after = !!(await page.$('[data-testid="landing-gnb-resources-panel"]'));
          const contact = await page.evaluate((vis) => window.__pqVis(document.querySelector('[data-testid="landing-gnb-contact"]')), VIS_FN);
          push(`${w}px · ③ 스크롤 뒤 문의 보임 · 누르면 열리고 Esc 로 닫힘`, contact && before && !after, JSON.stringify({ contact, before, after }));
        } else {
          // ① 좁은 폭 — 메뉴 버튼 → 시트 안에 전부. 앱 다운로드는 가입 버튼 바로 아래 — 스크롤 없이 보인다
          await page.click('header button[aria-label]'); await sleep(400);
          const appFirst = await page.evaluate(() => window.__pqVis(document.querySelector('[data-testid="landing-mobile-sheet"] a[href="/app"]')));
          push(`${w}px · ①a 메뉴 시트를 연 첫 화면에 앱 다운로드 보임(스크롤 없이)`, appFirst, JSON.stringify({ appFirst }));
          const want = ['/register', '/login', '/app', '/features', '/pricing', '/service', '/about', ...RES, '/contact'];
          const s = await page.evaluate(async (vis, want) => { const V = window.__pqVis;
            const sheet = document.querySelector('[data-testid="landing-mobile-sheet"]'); if (!sheet) return { sheet: false };
            const order = [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href'));
            const seen = {};
            for (const h of want) { const a = sheet.querySelector(`a[href="${h}"]`); if (a) { a.scrollIntoView({ block: 'center' }); await new Promise((ok) => setTimeout(ok, 60)); } seen[h] = V(a); }
            return { sheet: true, order, seen, overflow: document.documentElement.scrollWidth - innerWidth };
          }, VIS_FN, want);
          push(`${w}px · ① 메뉴 시트 — 무료로 시작·로그인 → 앱 다운로드 → 기능·요금제·컨설팅·소개 → 리소스 3 → 문의 · 모두 닿음 · 넘침 0`,
            s.sheet && s.order.join(',') === want.join(',') && Object.values(s.seen).every(Boolean) && s.overflow <= 0, JSON.stringify(s));
        }
      } catch (e) { push(`${w}px · ① 오류`, false, e.message.slice(0, 200)); }
      finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }

      // ④ 홈 — 히어로 아래 «시작 가이드» 한 줄이 첫 화면에 보인다(스크롤 없이)
      ({ ctx, page } = await open(browser, w, '/'));
      try {
        await sleep(1200);   // 히어로 등장 애니메이션
        const h = await page.evaluate((vis) => { const a = document.querySelector('[data-testid="home-start-guide-link"]'); return { vis: window.__pqVis(a), href: a && a.getAttribute('href'), overflow: document.documentElement.scrollWidth - innerWidth }; }, VIS_FN);
        push(`${w}px · ④ 홈 첫 화면에 «시작 가이드» 한 줄 · 넘침 0`, h.vis && h.href === '/start' && h.overflow <= 0, JSON.stringify(h));
      } catch (e) { push(`${w}px · ④ 오류`, false, e.message.slice(0, 200)); }
      finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }

      // ⑤ 요금제 ↔ 컨설팅 서로 잇는 한 줄
      ({ ctx, page } = await open(browser, w, '/pricing'));
      try {
        const p = await page.evaluate(async (vis) => { const band = document.querySelector('[data-testid="pricing-consulting-band"]'); if (!band) return { band: false };
          band.scrollIntoView({ block: 'center' }); await new Promise((ok) => setTimeout(ok, 900));
          const a = band.querySelector('a[href="/service"]'); return { band: true, vis: window.__pqVis(a), overflow: document.documentElement.scrollWidth - innerWidth }; }, VIS_FN);
        push(`${w}px · ⑤ 요금제 하단 → 컨설팅 한 줄 보임 · 넘침 0`, p.band && p.vis && p.overflow <= 0, JSON.stringify(p));
      } catch (e) { push(`${w}px · ⑤ 오류`, false, e.message.slice(0, 200)); }
      finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
      ({ ctx, page } = await open(browser, w, '/service'));
      try {
        const sv = await page.evaluate(async (vis) => { const a = document.querySelector('[data-testid="service-pricing-link"]'); if (!a) return { found: false };
          a.scrollIntoView({ block: 'center' }); await new Promise((ok) => setTimeout(ok, 200)); return { found: true, vis: window.__pqVis(a), overflow: document.documentElement.scrollWidth - innerWidth }; }, VIS_FN);
        push(`${w}px · ⑥ 컨설팅 → 요금제 역링크 보임 · 넘침 0`, sv.found && sv.vis && sv.overflow <= 0, JSON.stringify(sv));
      } catch (e) { push(`${w}px · ⑥ 오류`, false, e.message.slice(0, 200)); }
      finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }

      // ⑦ 소개 — PlanQ 정의가 먼저, 하는 일 10개, 창업자 이야기는 뒤, 컨설팅 한 줄
      ({ ctx, page } = await open(browser, w, '/about'));
      try {
        const a = await page.evaluate(async (vis) => { const V = window.__pqVis;
          const h1 = (document.querySelector('h1') || {}).textContent || '';
          const feat = document.querySelector('[data-testid="about-features-link"]');
          const story = document.querySelector('[data-testid="about-founder-story"]');
          const order = feat && story ? !!(feat.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
          const cards = feat ? feat.parentElement.querySelectorAll('div > div > div').length : 0;
          let featVis = false; if (feat) { feat.scrollIntoView({ block: 'center' }); await new Promise((ok) => setTimeout(ok, 900)); featVis = V(feat); }
          const consult = document.querySelector('main a[href="/service"]');
          let consultVis = false; if (consult) { consult.scrollIntoView({ block: 'center' }); await new Promise((ok) => setTimeout(ok, 900)); consultVis = V(consult); }
          return { h1, order, cards, featVis, consultVis, overflow: document.documentElement.scrollWidth - innerWidth };
        }, VIS_FN);
        push(`${w}px · ⑦ 소개 — 제목이 슬로건 · 하는 일 → 창업자 이야기 순 · 기능·컨설팅 링크 보임 · 넘침 0`,
          /일이 일이 되지 않게|WORK, JUST WORK/i.test(a.h1) && a.order && a.featVis && a.consultVis && a.overflow <= 0, JSON.stringify(a));
      } catch (e) { push(`${w}px · ⑦ 오류`, false, e.message.slice(0, 200)); }
      finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}

module.exports = { name: '랜딩 상단 메뉴 정리 — 메뉴 5·리소스 묶음·문의 버튼·시트·홈 시작 가이드·요금제↔컨설팅·소개 (4폭)', run };
