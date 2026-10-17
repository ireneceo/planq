// canary-marketingtags — 랜딩 마케팅 측정(GTM·GA4·Meta 픽셀)이 «정해진 곳에서만» 실리는가 (2026-10-17)
//
//   설계 docs/MARKETING_TRACKING_DESIGN.md (Fable 설계 PASS). 판정 원천 dev-frontend/src/services/marketingTags.ts.
//   재는 것: GTM 스크립트 요소(data-pq-marketing) 유무 · dataLayer 에 실제로 쌓인 이벤트(새 문서마다 sessionStorage 로 기록).
//   ★ dev CSP·네트워크와 무관하게 판정하려고 googletagmanager 요청은 이 검사가 막는다(실제로 싣는 판정은 우리 코드다).
//   ★ 대조군이 안에 있다: 한국 방문자 + 소개 페이지 = «실림» 이 먼저 보여야 «안 실림» 판정들이 빈 판정이 아니다.
//   전제: dev platform_settings.gtm_container_id 가 GTM- 모양(검사가 맞춰 두고 끝나면 되돌린다).
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = { email: 'owner@test.planq.kr', password: 'Test1234!' };
const ADMIN = { email: 'admin@test.planq.kr', password: 'Test1234!' };

// 새 문서마다: 언어·시간대 흉내 + dataLayer.push 를 sessionStorage 에 적는다(문서를 새로 읽어도 남는다).
function preload(lang) {
  return `(() => {
    try { Object.defineProperty(navigator, 'language', { get: () => '${lang}' });
          Object.defineProperty(navigator, 'languages', { get: () => ['${lang}'] }); } catch (e) {}
    const log = (x) => { try { const a = JSON.parse(sessionStorage.getItem('pqdl') || '[]');
      const o = {}; for (const k in x) { if (typeof x[k] !== 'function') o[k] = x[k]; }
      a.push(o); sessionStorage.setItem('pqdl', JSON.stringify(a)); } catch (e) {} };
    const dl = []; const orig = dl.push.bind(dl);
    dl.push = (...items) => { items.forEach((it) => { if (it && it.event && !Array.isArray(it) && !(typeof it === 'object' && 'callee' in it)) log(it); }); return orig(...items); };
    window.dataLayer = dl;
  })();`;
}

// ★ 서버 메모리가 빠듯하면 헤드리스가 죽는다(Target crashed) — 판정마다 새 브라우저를 띄우고 닫는다.
async function open(_unused, { lang = 'ko-KR', tz = 'Asia/Seoul', login = null } = {}) {
  const browser = (await b.launch()).browser;
  const ctx0 = await browser.createBrowserContext();
  const ctx = { newPage: () => ctx0.newPage(), close: async () => { await ctx0.close().catch(() => {}); await browser.close().catch(() => {}); } };
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateTimezone(tz);
  await page.evaluateOnNewDocument(preload(lang));
  // dev nginx CSP 는 아직 GTM 을 막는다(적용은 sudo) — 막히면 요청이 네트워크까지 안 와서 «요청 0» 이 빈 판정이 된다.
  //   CSP 를 우회해 «우리 코드가 싣으려 했는가» 를 요청으로 잰다(요청은 아래에서 막는다). ① 의 요청 > 0 이 대조군.
  await page.setBypassCSP(true);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (/googletagmanager\.com|connect\.facebook\.net|google-analytics\.com/.test(u)) { page.__tagReqs = (page.__tagReqs || 0) + 1; return r.abort(); }
    return r.continue();
  });
  if (login) await b.login(page, login);
  return { ctx, page };
}
async function go(page, path) {
  await page.goto(`${b.BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
}
const state = (page) => page.evaluate(() => ({
  path: location.pathname + location.search,
  script: !!document.querySelector('script[data-pq-marketing]'),
  banner: !!document.querySelector('[data-testid="consent-banner"]'),
  events: JSON.parse(sessionStorage.getItem('pqdl') || '[]'),
}));
const names = (s) => s.events.map((e) => e.event);

async function setGtm(browser, value) {
  const { ctx, page } = await open(browser, { login: ADMIN });
  try {
    return await page.evaluate(async (v) => {
      const lr = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.planq.kr', password: 'Test1234!' }) });
      const tok = (await lr.json()).data.token;
      const r = await fetch('/api/admin/platform-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ gtm_container_id: v }) });
      return r.status;
    }, value);
  } finally { await ctx.close().catch(() => {}); }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '').slice(0, 600)] });
  let browser = null;
  let before = null;
  try {
    browser = {};   // 판정마다 open() 이 자기 브라우저를 띄운다
    before = await (await fetch(`${b.BASE}/api/platform/info`)).json().then((j) => j?.data?.gtm_container_id || '').catch(() => '');
    if (before !== 'GTM-PLANQDEV') await setGtm(browser, 'GTM-PLANQDEV');

    // ① 대조군 — 한국 방문자 · 소개 페이지 · 토큰 섞인 주소: 실리고, 페이지뷰가 가고, 주소엔 utm 만
    let { ctx, page } = await open(browser);
    try {
      await go(page, '/features?utm_source=naver&invite=SECRET123');
      const s = await state(page);
      const pv = s.events.find((e) => e.event === 'pq_page_view');
      s.reqs = page.__tagReqs || 0;   // 요청 판정의 대조군 — 실릴 때는 요청이 잡혀야 ④ 의 «요청 0» 을 믿는다
      push('① 한국 방문자 /features — GTM 실림 · 띠 보임 · pq_page_view(page_type=features) · 주소에 utm 만(토큰 없음)',
        s.script && s.reqs > 0 && s.banner && pv && pv.page_type === 'features' && /utm_source=naver/.test(pv.page_location) && !/SECRET123/.test(JSON.stringify(s.events)),
        JSON.stringify({ script: s.script, reqs: s.reqs, banner: s.banner, pv }));
      // ② SPA 이동 → 요금제: 페이지뷰·요금제 보기 · 가입 링크 클릭 = CTA
      await page.evaluate(() => { const a = document.querySelector('header a[href="/pricing"]'); if (a) a.click(); });
      await sleep(2000);
      await page.evaluate(() => { const a = [...document.querySelectorAll('main a[href^="/register"]')][0]; if (a) a.click(); });
      await sleep(2500);
      const s2 = await state(page);
      const n = names(s2);
      const cta = s2.events.find((e) => e.event === 'pq_cta_click' && e.cta_target === 'register');
      push('② 요금제로 이동 → pq_view_pricing · 가입 버튼 → pq_cta_click(target=register) · /register 에서 pq_signup_view',
        n.includes('pq_view_pricing') && cta && cta.cta_target === 'register' && n.includes('pq_signup_view') && s2.script,
        JSON.stringify({ n, cta, path: s2.path }));
      // ③ 범위 밖으로(SPA 로 /login) → 문서를 새로 읽어 스크립트가 사라진다
      await page.evaluate(() => { window.__pqOld = 1; history.pushState({}, '', '/login'); dispatchEvent(new PopStateEvent('popstate')); });
      await sleep(3000);
      const s3 = await page.evaluate(() => ({ old: !!window.__pqOld, script: !!document.querySelector('script[data-pq-marketing]'), path: location.pathname }));
      push('③ 태그를 실은 문서에서 /login 으로 → 문서 새로 읽힘 · GTM 없음', !s3.old && !s3.script && s3.path === '/login', JSON.stringify(s3));
    } catch (e) { push('①~③ 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }

    // ④ 범위 밖 주소 — 비로그인이어도 안 실린다
    for (const p of ['/login', '/register?redirect=/invite/abcdefghijklmnopqrstu', '/c/notatoken', '/public/posts/notatoken', '/g/notatoken']) {
      ({ ctx, page } = await open(browser));
      try {
        await go(page, p);
        // ★ 초대 가입 주소(잘못된 토큰)는 화면이 멈춘다(운영도 같음 — 이 기능과 무관한 기존 결함, 2026-10-17 보고) —
        //   그때는 페이지 안을 못 읽으므로 «GTM 요청이 한 번도 안 나갔다» 로 판정한다(스크립트를 붙이면 요청이 나간다).
        const s = await Promise.race([state(page), sleep(8000).then(() => null)]);
        const reqs = page.__tagReqs || 0;
        if (!s) push(`④ ${p} — GTM 요청 0 (화면이 멈춰 안쪽은 못 읽음)`, reqs === 0, JSON.stringify({ reqs }));
        else push(`④ ${p} — GTM 안 실림 · 이벤트 0 · 띠 없음 · 요청 0`, !s.script && s.events.length === 0 && !s.banner && reqs === 0, JSON.stringify({ script: s.script, n: names(s), banner: s.banner, reqs }));
      } catch (e) { push(`④ ${p} 오류`, false, e.message); } finally { await ctx.close().catch(() => {}); }
    }

    // ⑤ 한국 밖 방문자 — 허용 전엔 안 실림 · 거부하면 다시 와도 안 실림 · 허용하면 그 자리에서 실림
    ({ ctx, page } = await open(browser, { lang: 'en-US', tz: 'America/New_York' }));
    try {
      await go(page, '/en/pricing');
      const s0 = await state(page);
      await page.click('[data-testid="consent-reject"]'); await sleep(800);
      await go(page, '/en/features');
      const s1 = await state(page);
      push('⑤a 영어·뉴욕 방문자 — 허용 전 안 실림 · 띠에 거부 버튼 · 거부 뒤 다른 페이지도 안 실림·띠 없음',
        !s0.script && s0.banner && s0.events.length === 0 && !s1.script && !s1.banner && s1.events.length === 0, JSON.stringify({ s0: { script: s0.script, banner: s0.banner }, s1: { script: s1.script, banner: s1.banner, n: names(s1) } }));
    } catch (e) { push('⑤a 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }
    ({ ctx, page } = await open(browser, { lang: 'en-US', tz: 'America/New_York' }));
    try {
      await go(page, '/en/features');
      await page.click('[data-testid="consent-accept"]'); await sleep(1500);
      const s = await state(page);
      push('⑤b 허용 누르면 그 자리에서 GTM 실림 · 페이지뷰 1', s.script && names(s).filter((x) => x === 'pq_page_view').length === 1 && !s.banner, JSON.stringify({ script: s.script, n: names(s) }));
    } catch (e) { push('⑤b 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }

    // ⑥ 로그인한 사람 — 소개 페이지여도 안 실림
    ({ ctx, page } = await open(browser, { login: OWNER }));
    try {
      await go(page, '/features');
      const s = await state(page);
      push('⑥ 로그인한 사람 /features — GTM 안 실림 · 이벤트 0', !s.script && s.events.length === 0, JSON.stringify({ script: s.script, n: names(s) }));
      // ⑦ 가입 완료 착지 — pq_sign_up 한 번 → 앱으로(새 문서) · 다시 와도 두 번 안 보냄
      await page.evaluate(() => { try { localStorage.removeItem('planq:mkt-signup-sent'); sessionStorage.removeItem('pqdl'); } catch (e) {} });
      await page.goto(`${b.BASE}/register?done=1&method=google`, { waitUntil: 'domcontentloaded' });
      await sleep(6000);
      const s7 = await state(page);
      const su = s7.events.filter((e) => e.event === 'pq_sign_up');
      await page.goto(`${b.BASE}/register?done=1&method=google`, { waitUntil: 'domcontentloaded' });
      await sleep(6000);
      const s7b = await state(page);
      push('⑦ /register?done=1 — pq_sign_up(method=google) 1건 → /inbox(GTM 없음) · 다시 와도 2건째 없음',
        su.length === 1 && su[0].method === 'google' && s7.path.startsWith('/inbox') && !s7.script
          && s7b.events.filter((e) => e.event === 'pq_sign_up').length === 1 && s7b.path.startsWith('/inbox'),
        JSON.stringify({ su, path: s7.path, script: s7.script, again: s7b.events.filter((e) => e.event === 'pq_sign_up').length, path2: s7b.path }));
    } catch (e) { push('⑥⑦ 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }

    // ⑨ 공유 링크 토큰이 referrer 로 새지 않는다 — (a) 공유 페이지의 «홈으로» 는 noreferrer (b) 그래도 같은 사이트 referrer 가 오면 출처만
    ({ ctx, page } = await open(browser));
    try {
      await go(page, '/public/tasks/notatokenSECRET9');
      const link = await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="/"]')][0]; return a ? { rel: a.getAttribute('rel') || '' } : null; });
      await page.goto(`${b.BASE}/features`, { waitUntil: 'domcontentloaded', referer: `${b.BASE}/c/SECRETTOKEN9` });
      await sleep(2500);
      const r = await page.evaluate(() => ({ ref: document.referrer, script: !!document.querySelector('script[data-pq-marketing]') }));
      const ext = await (async () => { await page.goto(`${b.BASE}/pricing`, { waitUntil: 'domcontentloaded', referer: 'https://search.naver.com/search?q=planq' }); await sleep(2500);
        return page.evaluate(() => document.referrer); })();
      // 대조군 — 태그를 안 싣는 주소(/login)에서는 덮지 않으므로 같은 referrer 가 토큰째 보여야 한다(흉내가 실제로 먹는가)
      await page.goto(`${b.BASE}/login`, { waitUntil: 'domcontentloaded', referer: `${b.BASE}/c/SECRETTOKEN9` }); await sleep(1500);
      const ctl = await page.evaluate(() => document.referrer);
      r.ctl = ctl;
      push('⑨ 공유 페이지 «홈으로» rel=noreferrer · 같은 사이트 공유 주소 referrer → 출처만(토큰 없음) · 밖 referrer(검색)는 그대로',
        link && /noreferrer/.test(link.rel) && r.script && !/SECRET/.test(r.ref) && /SECRETTOKEN9/.test(ctl) && /search\.naver\.com/.test(ext), JSON.stringify({ link, r, ext }));
    } catch (e) { push('⑨ 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }

    // ⑩ 돌아갈 곳(공유 링크 토큰)이 실린 가입 주소 — 가입 완료 처리에서도 싣지 않는다(마지막 방어선 ensureLoaded)
    ({ ctx, page } = await open(browser, { login: OWNER }));
    try {
      await page.evaluate(() => { try { localStorage.removeItem('planq:mkt-signup-sent'); sessionStorage.removeItem('pqdl'); } catch (e) {} });
      await page.goto(`${b.BASE}/register?done=1&method=google&redirect=%2Fc%2FSECRETTOKEN9`, { waitUntil: 'domcontentloaded' });
      await sleep(5000);
      const s = await state(page);
      push('⑩ /register?done=1&redirect=/c/<토큰> — GTM 요청 0 · pq_sign_up 없음', (page.__tagReqs || 0) === 0 && !names(s).includes('pq_sign_up'),
        JSON.stringify({ reqs: page.__tagReqs || 0, n: names(s), path: s.path }));
    } catch (e) { push('⑩ 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }

    // ⑧ 스위치 — ID 를 비우면 한국 방문자 소개 페이지에서도 안 실림(띠도 없음)
    await setGtm(browser, '');
    ({ ctx, page } = await open(browser));
    try {
      await go(page, '/features');
      const s = await state(page);
      push('⑧ ID 비움 → 안 실림 · 띠 없음 · 이벤트 0', !s.script && !s.banner && s.events.length === 0, JSON.stringify({ script: s.script, banner: s.banner, n: names(s) }));
    } catch (e) { push('⑧ 오류', false, e.message); } finally { await ctx.close().catch(() => {}); }
  } catch (e) {
    push('오류', false, e.message.slice(0, 300));
  } finally {
    try { if (browser) await setGtm(browser, before || ''); } catch { /* 되돌리기 실패는 결과에 안 넣는다 */ }
    // 브라우저는 판정마다 닫혔다
  }
  return results;
}

module.exports = { name: '랜딩 마케팅 측정 — 싣는 곳·동의·범위 밖 새로 읽기·가입 전환·스위치', run };
