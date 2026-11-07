// canary-desktop — 데스크탑 앱(Electron) 1단계를 **실제 앱을 띄워** 잰다 (docs/DESKTOP_APP_DESIGN.md §8).
//   개발 실행(desktop/ · PLANQ_DESKTOP_TEST=1 · 출처 dev.planq.kr)을 xvfb 위에 띄우고 puppeteer 를 CDP 로 붙인다.
//   시험 다리(window.planqDesktop.__test)는 개발 실행에서만 있다 — 패키지에는 없다(desktop/scripts/check.js 가 본다).
//
//   A 다중 고정: 팝아웃 2개를 각각 핀 → 둘 다 항상 위 · 홀더 0 · 해제하면 false
//     대조군 A′: 같은 팝아웃 핀을 **보통 크롬**에서 누르면 PiP(requestWindow) 길로 들어간다 — 분기가 앞에 있다는 증거
//   B 도구당 창 1개 · C 자리 기억 · D 외부 링크(OS 브라우저 1건·창·주소 불변)
//   E 알림 1회(메인 창 숨김 + 팝아웃 열린 채 → 정확히 1 · 같은 사건 두 번 → 1 · 보고 있으면 0)
//   F 로그인 복귀(planq://oauth/native-return?code=) → 세션 + refresh client_kind='desktop' · 같은 code 재사용 거절
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
require('./lib/gate-header');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const ORIGIN = 'https://dev.planq.kr';
const API = 'http://localhost:3003';
const DESKTOP = '/opt/planq/desktop';
const PORT = 9333 + Math.floor(Math.random() * 500);
const BIZ = 6;
const CONV = 1159;   // owner(15) · member2(17) 가 참여한 시험 대화방
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function devCode(as) {
  const p = b64u(JSON.stringify({ as, scope: { ws: BIZ }, exp: Date.now() + 60000, n: crypto.randomUUID(), next: '/' }));
  return `v1.${p}.${b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest())}`;
}

async function waitFor(fn, ms = 15000, step = 300) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(step);
  }
}

// 보이는 버튼만 — Q talk 팝아웃은 같은 핀 버튼이 숨은 목록 머리와 대화 머리 두 곳에 있다
const clickVisible = (page, sel) => page.evaluate((s) => {
  const b = [...document.querySelectorAll(s)].find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
  if (b) b.click();
  return !!b;
}, sel);
const visibleAttr = (page, sel, attr) => page.evaluate((s, a) => {
  const b = [...document.querySelectorAll(s)].find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
  return b ? b.getAttribute(a) : null;
}, sel, attr);

async function run() {
  const results = [];
  const push = (name, ok, msg) => { results.push({ name, fail: ok ? 0 : 1, details: [msg] }); console.log(`${ok ? '✅' : '❌'} ${name} ${msg || ''}`); };
  const electronBin = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', electronBin, DESKTOP, `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    env: { ...process.env, PLANQ_DESKTOP_TEST: '1', PLANQ_DESKTOP_ORIGIN: ORIGIN, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,   // 끝날 때 xvfb·electron 을 묶음째 정리
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  let browser = null;
  try {
    browser = await waitFor(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }), 40000, 1000);
    if (!browser) { push('앱 실행·CDP 연결', false, stderr.slice(-400)); return results; }
    const mainPage = await waitFor(async () => (await browser.pages()).find((p) => p.url().startsWith(ORIGIN)), 20000);
    if (!mainPage) { push('메인 창이 출처를 띄움', false, (await browser.pages()).map((p) => p.url()).join(',')); return results; }
    push('메인 창이 출처를 띄움', true, mainPage.url());
    const hasBridge = await mainPage.evaluate(() => !!(window.planqDesktop && window.planqDesktop.__test && window.planqDesktop.platform));
    push('preload 다리(planqDesktop) 노출 · Node 없음', hasBridge && !(await mainPage.evaluate(() => typeof require !== 'undefined' || typeof process !== 'undefined')), '');

    // 로그인 — dev-login(owner). 쿠키가 Electron 세션에 심긴다(client_kind = desktop)
    const login = await mainPage.evaluate(async (code) => {
      const r = await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Client-Kind': 'desktop' }, body: JSON.stringify({ code }) });
      return r.status;
    }, devCode('owner'));
    await mainPage.goto(`${ORIGIN}/inbox`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    push('로그인(dev-login owner)', login === 200, `status ${login} · ${mainPage.url()}`);
    const state = () => mainPage.evaluate(() => window.planqDesktop.__test.state());

    // ── A 다중 고정 ──
    const openPop = (url, name) => mainPage.evaluate((u, n) => { window.open(u, n, 'width=520,height=780,left=200,top=120'); }, url, name);
    await openPop(`/talk-popout?conv=${CONV}`, 'pq-qtalk');
    await openPop('/task-popout', 'pq-qtask');
    const pops = await waitFor(async () => {
      const ps = (await browser.pages()).filter((p) => /-popout/.test(p.url()));
      return ps.length >= 2 ? ps : null;
    }, 20000);
    if (!pops) { push('A 팝아웃 2개 열림', false, ''); return results; }
    for (const p of pops) {
      await waitFor(() => clickVisible(p, '[data-testid="popout-pin-toggle"]'), 20000, 500);
    }
    await sleep(1200);
    let st = await state();
    const popWins = st.windows.filter((w) => /-popout/.test(w.url));
    const holders = (await Promise.all(pops.map((p) => p.evaluate(() => document.querySelectorAll('[data-testid="pin-holder"]').length + (window.documentPictureInPicture && window.documentPictureInPicture.window ? 1 : 0))))).reduce((a, b) => a + b, 0);
    push('A 팝아웃 2개 동시 «항상 위» · 홀더·PiP 0', popWins.length === 2 && popWins.every((w) => w.alwaysOnTop) && holders === 0,
      JSON.stringify({ wins: popWins.map((w) => [w.url.replace(ORIGIN, ''), w.alwaysOnTop]), holders }));
    const pressed = await Promise.all(pops.map((p) => visibleAttr(p, '[data-testid="pip-unpin"]', 'aria-pressed')));
    push('A 핀 버튼이 고정 상태를 보임', pressed.every((v) => v === 'true'), JSON.stringify(pressed));
    await clickVisible(pops[0], '[data-testid="pip-unpin"]');
    await sleep(800);
    st = await state();
    const after = st.windows.filter((w) => /-popout/.test(w.url)).map((w) => w.alwaysOnTop).sort();
    push('A 하나 해제 → 그 창만 false', JSON.stringify(after) === '[false,true]', JSON.stringify(after));

    // ── B 도구당 창 1개 ──
    const before = (await state()).windows.length;
    await openPop(`/talk-popout?conv=${CONV}`, 'pq-qtalk');
    await sleep(2000);
    const afterB = (await state()).windows.length;
    push('B 같은 도구 다시 열기 → 창 수 그대로', afterB === before, `${before} → ${afterB}`);

    // ── C 자리 기억 ──
    const talkPop = pops.find((p) => p.url().includes('/talk-popout'));
    await talkPop.evaluate(() => { window.moveTo(140, 160); });
    await sleep(800);
    const moved = (await state()).windows.find((w) => w.url.includes('/talk-popout'));
    await talkPop.evaluate(() => window.close());
    await sleep(1000);
    await openPop(`/talk-popout?conv=${CONV}`, 'pq-qtalk');
    await sleep(2500);
    const reopened = (await state()).windows.find((w) => w.url.includes('/talk-popout'));
    const near = moved && reopened && Math.abs(moved.bounds.x - reopened.bounds.x) <= 8 && Math.abs(moved.bounds.y - reopened.bounds.y) <= 8;
    push('C 닫았다 다시 열면 같은 자리(±8)', !!near, JSON.stringify({ moved: moved && moved.bounds, reopened: reopened && reopened.bounds }));

    // ── D 외부 링크 ──
    const winsD = (await state()).windows.length;
    const urlD = mainPage.url();
    await mainPage.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.com/x'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); });
    await sleep(800);
    await mainPage.evaluate(() => { window.location.href = 'https://example.com/y'; }).catch(() => null);
    await sleep(1500);
    st = await state();
    const ext = st.openExternal.filter((u) => u.startsWith('https://example.com'));
    push('D 바깥 주소 → OS 브라우저(2건) · 창 수·메인 주소 그대로', ext.length === 2 && st.windows.length === winsD && mainPage.url() === urlD,
      JSON.stringify({ ext, wins: [winsD, st.windows.length], url: mainPage.url().replace(ORIGIN, '') }));

    // ── E 알림 1회 ──
    await mainPage.evaluate(() => window.planqDesktop.__test.hideMain());
    await sleep(800);
    const m2 = await (await fetch(`${API}/api/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: devCode('member2') }) })).json();
    const say = async (text) => fetch(`${API}/api/conversations/${BIZ}/${CONV}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${m2.data.token}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(BIZ) },
      body: JSON.stringify({ content: text }),
    }).then((r) => r.status);
    const n0 = (await state()).notify.length;
    const t1 = `[확인용] 데스크탑 알림 ${Date.now()}`;
    const s1 = await say(t1);
    await waitFor(async () => (await state()).notify.length > n0, 8000);
    await sleep(2500);
    st = await state();
    const got = st.notify.slice(n0).filter((n) => (n.body || '').includes(t1.slice(0, 20)) || (n.title || '').length);
    push('E 창 숨김 + 팝아웃 열린 채 → OS 알림 정확히 1', s1 === 201 || s1 === 200 ? got.length === 1 : false, JSON.stringify({ send: s1, got: got.map((n) => [n.title, n.body]) }));
    push('E 알림 링크가 앱 안 상대경로', got[0] ? /^\/(talk|chat)/.test(got[0].link || '') : false, got[0] ? got[0].link : '');
    // 같은 사건 두 번 — main LRU(같은 id 60초) 대조: 렌더러가 같은 id 를 다시 보내면 무시
    const dupOk = await mainPage.evaluate(async () => {
      const a = await window.planqDesktop.notify({ id: 'dup-check', title: 't', body: 'b' });
      const b = await window.planqDesktop.notify({ id: 'dup-check', title: 't', body: 'b' });
      return [a, b];
    });
    push('E 같은 id 두 번 → 한 번만', dupOk[0] === true && dupOk[1] === false, JSON.stringify(dupOk));
    // 보고 있으면 0 + 카드
    await mainPage.evaluate(() => window.planqDesktop.__test.showMain());
    await mainPage.bringToFront();
    await sleep(1200);
    const looking = await mainPage.evaluate(() => document.visibilityState === 'visible' && document.hasFocus());
    const n1 = (await state()).notify.length;
    const t2 = `[확인용] 보고 있을 때 ${Date.now()}`;
    await say(t2);
    await sleep(3500);
    const n2 = (await state()).notify.length;
    const card = await mainPage.evaluate((t) => document.body.innerText.includes(t.slice(0, 12)), t2);
    push('E 창을 보고 있으면 OS 알림 0 + 앱 안 카드', looking ? (n2 === n1 && card) : false, JSON.stringify({ looking, os: n2 - n1, card }));
    // 팝아웃은 notify 를 못 쏜다(메인 창 단일 발신)
    const popNotify = await pops.find((p) => !p.isClosed()).evaluate(() => window.planqDesktop.notify({ id: `pop-${Date.now()}`, title: 'x' })).catch(() => 'err');
    push('E 팝아웃 창의 notify 는 거절', popNotify === false, String(popNotify));

    // ── F 로그인 복귀(planq://) ──
    const [[mem2]] = await sequelize.query("SELECT id FROM users WHERE email='member2@test.planq.kr'");
    const jti = `${mem2.id}-${Date.now()}-desk`;
    const code = jwt.sign({ uid: mem2.id, purpose: 'native_oauth', jti }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const sinceF = new Date(Date.now() - 1000);
    await mainPage.evaluate((u) => window.planqDesktop.__test.deepLink(u), `planq://oauth/native-return?code=${encodeURIComponent(code)}`);
    await sleep(6000);
    const [[rowF]] = await sequelize.query('SELECT client_kind, TIMESTAMPDIFF(DAY, NOW(), expires_at) d FROM refresh_tokens WHERE user_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1', { replacements: [mem2.id, sinceF] });
    push('F planq:// 복귀 → 세션 client_kind=desktop · 365일', !!rowF && rowF.client_kind === 'desktop' && rowF.d >= 364, JSON.stringify(rowF || null));
    const reuse = await fetch(`${API}/api/auth/google/native-exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client_kind: 'desktop' }) }).then((r) => r.status);
    push('F 같은 code 재사용 거절', reuse >= 400, `status ${reuse}`);
    // 다른 경로의 planq:// 는 버린다
    const urlBefore = mainPage.url();
    await mainPage.evaluate((u) => window.planqDesktop.__test.deepLink(u), 'planq://evil/path?x=1');
    await sleep(1500);
    push('F planq:// 다른 경로는 무시', mainPage.url() === urlBefore, mainPage.url().replace(ORIGIN, ''));
  } catch (e) {
    push('desktop 카나리 실행', false, `${e && e.message} · ${stderr.slice(-300)}`);
  } finally {
    try { if (browser) await browser.disconnect(); } catch { /* */ }
    try { child.kill('SIGTERM'); } catch { /* */ }
    await sleep(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ }
  }
  return results;
}

/** 대조군 A′ — 보통 크롬(앱 아님)에서 핀을 누르면 PiP 경로(requestWindow)로 간다. 분기가 «데스크탑일 때만» 갈린다는 증거 */
async function runControl() {
  const results = [];
  const push = (name, ok, msg) => { results.push({ name, fail: ok ? 0 : 1, details: [msg] }); console.log(`${ok ? '✅' : '❌'} ${name} ${msg || ''}`); };
  const { launch } = require('./lib/browser');
  const { browser, page } = await launch();
  try {
    await page.evaluateOnNewDocument(() => {
      window.__pipCalls = 0;
      // documentPictureInPicture 를 흉내 — requestWindow 가 불리는지만 센다
      // ★ 크롬의 진짜 documentPictureInPicture 는 읽기 전용 접근자라 그냥 대입하면 조용히 무시된다 — defineProperty 로 덮는다
      Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { window: null, requestWindow: async () => { window.__pipCalls += 1; throw new Error('blocked-in-test'); }, addEventListener() {}, removeEventListener() {} } });
      // 창 관리 권한 묻기는 헤드리스에서 답이 안 와 영영 기다린다 — 바로 답한다(분기와 무관)
      window.getScreenDetails = async () => ({ screens: [] });
      // 헤드리스 크롬은 «마우스 없음(hover:none)» 으로 잡혀 핀 버튼을 안 그린다 — 입력 방식만 데스크탑 마우스로(분기와 무관)
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === '(hover: none), (pointer: coarse)' ? { matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q));
    });
    await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (code) => { await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }); }, devCode('owner'));
    await page.goto(`${ORIGIN}/task-popout`, { waitUntil: 'domcontentloaded' });
    const shown = await waitFor(() => clickVisible(page, '[data-testid="popout-pin-toggle"]'), 20000, 500);
    if (!shown) {
      // 이 크롬이 핀 자체를 안 그리면(입력 방식 판정) 대조군을 잴 수 없다 — 통과로 세지 않고 실패로 남긴다
      push('A′ 대조군 — 보통 크롬에 핀 버튼', false, await page.evaluate(() => JSON.stringify({ hoverNone: matchMedia('(hover: none)').matches, coarse: matchMedia('(pointer: coarse)').matches, pip: !!window.documentPictureInPicture })));
      return results;
    }
    await sleep(2500);
    const calls = await page.evaluate(() => window.__pipCalls);
    push('A′ 대조군 — 보통 크롬은 PiP(requestWindow) 길', calls >= 1, `requestWindow ${calls}회`);
  } catch (e) {
    push('A′ 대조군 실행', false, e && e.message);
  } finally { await browser.close(); }
  return results;
}

module.exports = { run: async () => [...(await run()), ...(await runControl())], name: 'desktop' };

if (require.main === module) {
  module.exports.run().then((r) => {
    const fail = r.filter((x) => x.fail).length;
    console.log(fail ? `FAIL ${fail}` : 'PASS');
    process.exit(fail ? 1 : 0);
  });
}
