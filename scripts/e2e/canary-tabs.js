// scripts/e2e/canary-tabs.js — ⑥ 멀티탭 트리 스왑(keep-alive) 카나리.
//   Fable SPIKE 게이트를 영구화: 형제 MemoryRouter 무크래시 + 탭 렌더 + keep-alive + shell 무회귀를
//   매 게이트마다 실브라우저(puppeteer)로 증명. chrome zone 에 RR 잔재가 다시 들어오면(ErrorBoundary 가
//   삼켜 pageerror=0 으로 안 보이는 크래시) 이 카나리가 잡는다.
//   세션 = health-check 계정 login → refresh 쿠키 주입(세션 오염 0). spike 플래그 on 으로 tree-swap 진입.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const FRONT = process.env.CANARY_FRONT || 'https://dev.planq.kr';
const EMAIL = 'health-check@planq.kr';
const PASSWORD = 'HealthCheck2026!';

async function getRefreshCookie() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const sc = res.headers.get('set-cookie') || '';
  const m = /refresh_token=([^;]+)/.exec(sc);
  if (!m) throw new Error('refresh 쿠키 없음 (login 실패?)');
  return m[1];
}

// body 텍스트에 ErrorBoundary/크래시 문구가 있으면 크래시(ErrorBoundary 가 삼킨 것)
const CRASH_RE = /Something went wrong|may be used only in the context of a|Minified React error/i;

async function run() {
  const results = [];
  let refresh;
  try { refresh = await getRefreshCookie(); }
  catch (e) { return [{ name: 'tabs:login', error: true, fatal: 1, detail: e.message }]; }

  // fake-device: 마이크 track-alive 검사(#6)용 — 실제 하드웨어 없이 getUserMedia 성립.
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const pageerrors = [];
    page.on('pageerror', (e) => pageerrors.push(e.message.slice(0, 160)));
    await page.setCookie({ name: 'refresh_token', value: refresh, domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https') });

    // 1) opt-out/롤백 무회귀 — 플래그를 명시 off('0') 하면 기존 shell(BrowserRouter, 탭바 없음) 로 렌더.
    //    기본값이 전역 on 이 됐으므로, 이 검사는 opt-out·롤백 경로가 무회귀임을 보장한다.
    await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => { localStorage.setItem('planq_tabs_spike', '0'); localStorage.setItem('planq_tabs_beta', '0'); });
    await page.goto(`${FRONT}/tasks`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const shellBody = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const shellRendered = await page.evaluate(() => { const el = document.querySelector('#root'); return !!el && el.children.length > 0 && document.body.innerText.length > 20; });
    const noStripOff = await page.evaluate(() => !document.querySelector('[data-testid="tabstrip"]'));
    const shellOk = shellRendered && noStripOff && !CRASH_RE.test(shellBody);
    results.push({ name: 'tabs:opt-out 무회귀(off=기존 shell·탭바 없음)', fail: shellOk ? 0 : 1, fatal: 0, details: shellOk ? [] : [`rendered=${shellRendered} noStrip=${noStripOff} ` + shellBody.slice(0, 70)] });

    // 2) tree-swap 부팅 (spike on) — 형제 MemoryRouter 무크래시 + 탭 스트립 렌더
    await page.goto(`${FRONT}/tasks`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => localStorage.setItem('planq_tabs_spike', '1'));
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    const boot = await page.evaluate(() => { const el = document.querySelector('#root'); return !!el && el.children.length > 0 && document.body.innerText.length > 20; });
    const body = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const strip = await page.evaluate(() => !!document.querySelector('[data-testid="tabstrip"]'));
    const crashed = CRASH_RE.test(body) || pageerrors.length > 0;
    results.push({ name: 'tabs:tree-swap 부팅(무크래시·탭렌더)', fail: (boot && strip && !crashed) ? 0 : 1, fatal: 0, details: (boot && strip && !crashed) ? [] : [`boot=${boot} strip=${strip} pageerr=${pageerrors.length}`, body.slice(0, 90)] });

    // 3) keep-alive — 탭 2개 동시 alive + 전환 무크래시 (window.__pqTab 훅)
    let ka = { ok: false, detail: '' };
    try {
      const hasHook = await page.evaluate(() => !!window.__pqTab);
      if (hasHook) {
        await page.evaluate(() => window.__pqTab.newTab('/talk'));
        await new Promise((r) => setTimeout(r, 2000));
        const n = await page.evaluate(() => window.__pqTab.getSnapshot().tabs.filter((t) => t.alive).length);
        const firstId = await page.evaluate(() => window.__pqTab.getSnapshot().tabs[0].id);
        await page.evaluate((id) => window.__pqTab.setActive(id), firstId);
        await new Promise((r) => setTimeout(r, 1000));
        const noCrash = pageerrors.length === 0 && !CRASH_RE.test(await page.evaluate(() => document.body.innerText.slice(0, 200)));
        ka.ok = n === 2 && noCrash;
        ka.detail = `alive=${n} 전환후크래시=${!noCrash}`;
      } else ka.detail = '__pqTab 훅 없음';
    } catch (e) { ka.detail = e.message; }
    results.push({ name: 'tabs:keep-alive(2탭 동시 alive·전환)', fail: ka.ok ? 0 : 1, fatal: 0, details: ka.ok ? [] : [ka.detail] });

    const hasHook = await page.evaluate(() => !!window.__pqTab);

    // 4) 뒤로가기 — 활성 탭 안에서 네비 후 브라우저 back → 무크래시 + 탭 유지 (PopstateBridge 히스토리 통합)
    let back = { ok: false, detail: '__pqTab 훅 없음' };
    if (hasHook) {
      try {
        await page.evaluate(() => window.__pqTab.navigateActive('/tasks/all'));
        await new Promise((r) => setTimeout(r, 800));
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
        await new Promise((r) => setTimeout(r, 1000));
        const tabsAlive = await page.evaluate(() => window.__pqTab.getSnapshot().tabs.length);
        const noCrash = pageerrors.length === 0 && !CRASH_RE.test(await page.evaluate(() => document.body.innerText.slice(0, 200)));
        back.ok = tabsAlive >= 1 && noCrash;
        back.detail = `tabs=${tabsAlive} 크래시=${!noCrash}`;
      } catch (e) { back.detail = e.message; }
    }
    results.push({ name: 'tabs:뒤로가기(히스토리 통합·무크래시)', fail: back.ok ? 0 : 1, fatal: 0, details: back.ok ? [] : [back.detail] });

    // 5) F5 복원 — reload 후 sessionStorage 에서 탭셋 복원 + 무크래시
    let f5 = { ok: false, detail: '' };
    try {
      const before = hasHook ? await page.evaluate(() => window.__pqTab.getSnapshot().tabs.length) : 0;
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2500));
      const after = await page.evaluate(() => (window.__pqTab ? window.__pqTab.getSnapshot().tabs.length : 0));
      const body5 = await page.evaluate(() => document.body.innerText.slice(0, 200));
      const strip5 = await page.evaluate(() => !!document.querySelector('[data-testid="tabstrip"]'));
      f5.ok = after >= 1 && after >= before - 1 && strip5 && !CRASH_RE.test(body5);
      f5.detail = `before=${before} after=${after} strip=${strip5}`;
    } catch (e) { f5.detail = e.message; }
    results.push({ name: 'tabs:F5 복원(sessionStorage 탭셋)', fail: f5.ok ? 0 : 1, fatal: 0, details: f5.ok ? [] : [f5.detail] });

    // 6) 마이크 track-alive — 활성 탭에서 getUserMedia → 탭 전환(숨김 display:none+inert) → 스트림 track 유지
    //   Q Note 녹음이 탭 전환에도 안 끊기는지의 브라우저 레벨 프록시. fake-device 로 하드웨어 없이 검증.
    let mic = { ok: false, detail: '__pqTab 훅 없음' };
    if (await page.evaluate(() => !!window.__pqTab)) {
      try {
        const gum = await page.evaluate(async () => {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            window.__micTrack = s.getAudioTracks()[0];
            return window.__micTrack ? window.__micTrack.readyState : 'no-track';
          } catch (e) { return 'gum-fail:' + e.name; }
        });
        if (gum === 'live') {
          // 다른 탭 새로 열어 활성 전환 → 원 탭 숨김
          await page.evaluate(() => window.__pqTab.newTab('/dashboard'));
          await new Promise((r) => setTimeout(r, 1500));
          const stillLive = await page.evaluate(() => window.__micTrack && window.__micTrack.readyState === 'live');
          await page.evaluate(() => { try { window.__micTrack && window.__micTrack.stop(); } catch { /* noop */ } });
          mic.ok = !!stillLive && pageerrors.length === 0;
          mic.detail = `전환후 track=${stillLive ? 'live' : 'ended'}`;
        } else { mic.detail = 'getUserMedia=' + gum; }
      } catch (e) { mic.detail = e.message; }
    }
    results.push({ name: 'tabs:마이크 track-alive(숨은탭 스트림 유지)', fail: mic.ok ? 0 : 1, fatal: 0, details: mic.ok ? [] : [mic.detail] });
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: 'tabs', run };
