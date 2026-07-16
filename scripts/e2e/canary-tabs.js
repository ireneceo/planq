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

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const pageerrors = [];
    page.on('pageerror', (e) => pageerrors.push(e.message.slice(0, 160)));
    await page.setCookie({ name: 'refresh_token', value: refresh, domain: new URL(FRONT).hostname, path: '/', httpOnly: true, secure: FRONT.startsWith('https') });

    // 1) shell 경로 무회귀 (spike off) — /login·앱경로 렌더 + 크래시 0
    await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    const shellBody = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const shellOk = (await page.evaluate(() => { const el = document.querySelector('#root'); return !!el && el.children.length > 0; })) && !CRASH_RE.test(shellBody);
    results.push({ name: 'tabs:shell(flag off 무회귀)', fail: shellOk ? 0 : 1, fatal: 0, details: shellOk ? [] : ['shell 렌더/크래시: ' + shellBody.slice(0, 80)] });

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
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: 'tabs', run };
