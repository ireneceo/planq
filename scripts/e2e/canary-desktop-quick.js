// canary-desktop-quick — 데스크탑 앱 2단계 C «빠른 업무 추가» · E «점프 목록·메뉴 동작»을 실제 앱을 띄워 잰다 (docs/DESKTOP_APP_PHASE2.md §4-3·§4-5).
//   개발 실행(PLANQ_DESKTOP_TEST=1 · 출처 dev.planq.kr)을 xvfb 위에 띄우고 puppeteer 를 CDP 로 붙인다.
//   C1 기본 단축키 상태(켜짐 · CommandOrControl+Shift+Space)
//   C2 양성 대조군 — 수식키 없는 키(A·Shift+A·Space)·흔한 키(Ctrl+C)는 main 이 거절하고 상태는 그대로
//   C3 팝아웃 창의 단축키 바꾸기는 거절(메인 창만)
//   C4 단축키(= 같은 함수) → /task-popout?quick=1 창 · 입력 칸을 가려 두었어도 보임 · 입력칸 포커스
//   C5 Enter → 업무 1건(DB) · Esc → 숨김 · 다시 → 같은 창이 떠오르고 포커스
//   E1 두 번째 실행 --pq-action=qtalk → 메인 창이 Q talk 팝아웃을 연다 · 다시 → 창 수 그대로(같은 pq-* 창)
//   E2 허용 목록 밖(--pq-action=https://…)은 무시 — 창 수·메인 주소 그대로
//   C6 로그아웃 상태에서 단축키 → 빠른 창 없이 메인 창
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
require('./lib/gate-header');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const ORIGIN = 'https://dev.planq.kr';
const DESKTOP = '/opt/planq/desktop';
const PORT = 9333 + Math.floor(Math.random() * 500);
const BIZ = 6;
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
const electronBin = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron');
const ENV = { ...process.env, PLANQ_DESKTOP_TEST: '1', PLANQ_DESKTOP_ORIGIN: ORIGIN, ELECTRON_ENABLE_LOGGING: '0' };

/** 두 번째 실행 — 단일 실행 잠금이 인자를 첫 실행에 넘기고 곧 꺼진다(점프 목록 항목을 누른 것과 같은 길) */
function secondInstance(arg) {
  return new Promise((res) => {
    const c = spawn('xvfb-run', ['-a', electronBin, DESKTOP, arg, '--no-sandbox'], { env: ENV, stdio: 'ignore', detached: true });
    const t = setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } res('timeout'); }, 20000);
    c.on('exit', (code) => { clearTimeout(t); res(code); });
  });
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => { results.push({ name, fail: ok ? 0 : 1, details: [msg || ''] }); console.log(`${ok ? '✅' : '❌'} ${name} ${msg || ''}`); };
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', electronBin, DESKTOP, `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    env: ENV, stdio: ['ignore', 'ignore', 'pipe'], detached: true,
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
  let browser = null;
  let ownerId = null;
  try {
    browser = await waitFor(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }), 40000, 1000);
    if (!browser) { push('앱 실행·CDP 연결', false, stderr.slice(-400)); return results; }
    const mainPage = await waitFor(async () => (await browser.pages()).find((p) => p.url().startsWith(ORIGIN)), 20000);
    if (!mainPage) { push('메인 창이 출처를 띄움', false, ''); return results; }
    const login = await mainPage.evaluate(async (code) => {
      const r = await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Client-Kind': 'desktop' }, body: JSON.stringify({ code }) });
      return r.status;
    }, devCode('owner'));
    await mainPage.goto(`${ORIGIN}/inbox`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    push('로그인(dev-login owner)', login === 200, `status ${login}`);
    const state = () => mainPage.evaluate(() => window.planqDesktop.__test.state());

    // ── C1 기본 상태 ──
    const s0 = await mainPage.evaluate(() => window.planqDesktop.getShortcut());
    push('C1 단축키 기본 켜짐 · Ctrl+Shift+Space', !!s0 && s0.enabled === true && s0.accel === 'CommandOrControl+Shift+Space',
      JSON.stringify(s0));
    push('C1 전역 등록 성공(xvfb)', !!s0 && s0.registered === true, JSON.stringify(s0 && { registered: s0.registered, error: s0.error }));

    // ── C2 양성 대조군 — 거절돼야 할 키 ──
    const bad = await mainPage.evaluate(async () => {
      const out = {};
      for (const k of ['A', 'Shift+A', 'Space', 'Ctrl+C', 'Ctrl+Shift', 'Super+K']) {
        const r = await window.planqDesktop.setShortcut({ accel: k });
        out[k] = r && !r.ok ? r.error : `ACCEPTED:${r && r.state && r.state.accel}`;
      }
      return out;
    });
    const s1 = await mainPage.evaluate(() => window.planqDesktop.getShortcut());
    push('C2 수식키 없는 키 거절(needs_modifier)', bad.A === 'needs_modifier' && bad['Shift+A'] === 'needs_modifier' && bad.Space === 'needs_modifier', JSON.stringify(bad));
    push('C2 흔한 키·형식 오류 거절', bad['Ctrl+C'] === 'common_key' && bad['Ctrl+Shift'] === 'invalid' && bad['Super+K'] === 'invalid', JSON.stringify(bad));
    push('C2 거절 뒤 단축키 그대로', s1 && s1.accel === s0.accel && s1.registered === s0.registered, JSON.stringify(s1));
    // 정상 키는 받는다(음성 대조 — 검증이 다 막는 것이 아님) → 기본값으로 되돌림
    const good = await mainPage.evaluate(async () => {
      const a = await window.planqDesktop.setShortcut({ accel: 'Ctrl+Alt+K' });
      const b = await window.planqDesktop.setShortcut({ accel: 'CommandOrControl+Shift+Space' });
      return [a && a.ok, a && a.state && a.state.accel, b && b.ok];
    });
    push('C2 대조 — Ctrl+Alt+K 는 받음 · 기본값 복귀', good[0] === true && good[1] === 'Control+Alt+K' && good[2] === true, JSON.stringify(good));
    const offOn = await mainPage.evaluate(async () => {
      const a = await window.planqDesktop.setShortcut({ enabled: false });
      const b = await window.planqDesktop.setShortcut({ enabled: true });
      return [a && a.state.enabled, a && a.state.registered, b && b.state.enabled, b && b.state.registered];
    });
    push('C2 끄기 → 등록 해제 · 켜기 → 다시 등록', JSON.stringify(offOn) === '[false,false,true,true]', JSON.stringify(offOn));

    // ── C3 팝아웃 창의 단축키 바꾸기 거절 ──
    await mainPage.evaluate(() => { window.open('/talk-popout', 'pq-qtalk-c3', 'width=480,height=600'); });
    const pop = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('/talk-popout')), 20000);
    const popSet = pop ? await waitFor(() => pop.evaluate(async () => (window.planqDesktop ? window.planqDesktop.setShortcut({ accel: 'Ctrl+Alt+J' }) : null)), 15000) : null;
    push('C3 팝아웃 창의 setShortcut 거절(not_main)', !!popSet && popSet.ok === false && popSet.error === 'not_main', JSON.stringify(popSet));
    if (pop) await pop.close().catch(() => {});
    await sleep(800);

    // ── C4 빠른 추가 창 — 할 일 입력을 가려 둔 사람도 보인다 ──
    [[{ id: ownerId }]] = await sequelize.query("SELECT id FROM users WHERE email='owner@test.planq.kr'");
    const secKey = `u${ownerId}::planq:taskPopout:sections`;
    const prevSec = await mainPage.evaluate((k) => { const v = localStorage.getItem(k); localStorage.setItem(k, JSON.stringify({ cue: true, add: false, view: false })); return v; }, secKey);
    await mainPage.evaluate(() => window.planqDesktop.__test.quickAdd());
    const quick = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('/task-popout?quick=1')), 20000);
    if (!quick) { push('C4 빠른 추가 창 열림', false, (await browser.pages()).map((p) => p.url()).join(',')); return results; }
    const focused = await waitFor(() => quick.evaluate(() => {
      const el = document.activeElement;
      return el && el.getAttribute('data-testid') === 'task-popout-quickadd-input' ? true : null;
    }), 20000);
    let st = await state();
    const qw = st.windows.find((w) => w.quick);
    push('C4 /task-popout?quick=1 창 보임', !!qw && qw.visible, JSON.stringify(qw || null));
    push('C4 입력 칸 가림 설정이어도 보이고 포커스', !!focused, '');
    // 대조 — 같은 설정의 보통 팝아웃에는 입력 칸이 없다(가림 설정이 실제로 먹고 있다는 증거)
    await mainPage.evaluate(() => { window.open('/task-popout', 'pq-qtask-c4', 'width=480,height=600'); });
    const plain = await waitFor(async () => (await browser.pages()).find((p) => /\/task-popout$/.test(p.url())), 20000);
    const plainHas = plain ? await waitFor(() => plain.evaluate(() => (document.querySelector('[data-testid="task-popout-count"]') ? String(!!document.querySelector('[data-testid="task-popout-quickadd-input"]')) : null)), 20000) : null;
    push('C4 대조 — 보통 팝아웃은 입력 칸 가려짐', plainHas === 'false', String(plainHas));
    if (plain) await plain.close().catch(() => {});
    await mainPage.evaluate((k, v) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }, secKey, prevSec);

    // ── C5 저장 · Esc 숨김 · 다시 띄우기 ──
    const title = `[확인용] 빠른 추가 ${Date.now()}`;
    await quick.type('[data-testid="task-popout-quickadd-input"]', title);
    await quick.keyboard.press('Enter');
    const row = await waitFor(async () => {
      const [[r]] = await sequelize.query('SELECT id, assignee_id FROM tasks WHERE business_id = ? AND title = ? LIMIT 1', { replacements: [BIZ, title] });
      return r || null;
    }, 10000, 500);
    push('C5 Enter → 업무 1건 저장(내 담당)', !!row && row.assignee_id === ownerId, JSON.stringify(row || null));
    // 대조 — CDP 키(Escape)는 before-input-event 를 거치지 않아 창이 그대로여야 한다(판정이 «아무 키나 숨김» 이 아니라는 것)
    await quick.keyboard.press('Escape');
    await sleep(600);
    const stillShown = (await state()).windows.find((w) => w.quick);
    // 진짜 키 입력 길 — 다른 키(A)는 숨기지 않고 Escape 만 숨긴다
    await mainPage.evaluate(() => window.planqDesktop.__test.quickKey('A'));
    await sleep(600);
    const afterA = (await state()).windows.find((w) => w.quick);
    push('C5 대조 — Escape 아닌 키는 창 그대로', !!afterA && afterA.visible, JSON.stringify({ cdpEsc: stillShown && stillShown.visible, afterA: afterA && afterA.visible }));
    await mainPage.evaluate(() => window.planqDesktop.__test.quickKey('Escape'));
    await sleep(800);
    st = await state();
    const hidden = st.windows.find((w) => w.quick);
    push('C5 Esc → 창 숨김(닫지 않음)', !!hidden && hidden.visible === false, JSON.stringify(hidden || null));
    await quick.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await mainPage.evaluate(() => window.planqDesktop.__test.quickAdd());
    await sleep(1000);
    st = await state();
    const again = st.windows.filter((w) => w.quick);
    const refocus = await waitFor(() => quick.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid') === 'task-popout-quickadd-input') || null), 5000);
    push('C5 다시 → 같은 창이 보이고 입력칸 포커스', again.length === 1 && again[0].id === hidden.id && again[0].visible && !!refocus, JSON.stringify({ again, refocus: !!refocus }));
    await mainPage.evaluate(() => window.planqDesktop.__test.quickKey('Escape'));

    // ── E1 점프 목록 동작(두 번째 실행 인자) ──
    const countTalk = async () => (await state()).windows.filter((w) => w.url.includes('/talk-popout')).length;
    const t0 = await countTalk();
    const code1 = await secondInstance('--pq-action=qtalk');
    const opened = await waitFor(async () => ((await countTalk()) > t0 ? true : null), 15000);
    push('E1 --pq-action=qtalk → Q talk 팝아웃 열림', !!opened, `second exit ${code1} · talk ${t0} → ${await countTalk()}`);
    const winsE = (await state()).windows.length;
    await secondInstance('--pq-action=qtalk');
    await sleep(2500);
    push('E1 다시 → 창 수 그대로(같은 pq-* 창)', (await state()).windows.length === winsE, `${winsE} → ${(await state()).windows.length}`);
    // ── E2 허용 목록 밖 ──
    const urlE = mainPage.url();
    await secondInstance('--pq-action=https://example.com/evil');
    await secondInstance('--pq-action=../../settings');
    await sleep(2500);
    st = await state();
    push('E2 허용 목록 밖 인자 무시 — 창 수·메인 주소 그대로 · 바깥 열기 0',
      st.windows.length === winsE && mainPage.url() === urlE && !st.openExternal.some((u) => u.includes('example.com/evil')),
      JSON.stringify({ wins: [winsE, st.windows.length], url: mainPage.url().replace(ORIGIN, '') }));
    // quick-task 인자 → 빠른 창
    await secondInstance('--pq-action=quick-task');
    await sleep(1500);
    st = await state();
    push('E1 --pq-action=quick-task → 빠른 추가 창 보임', st.windows.some((w) => w.quick && w.visible), '');

    // ── C6 로그아웃이면 메인 창 ──
    await quick.close().catch(() => {});
    await sleep(800);
    await mainPage.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); });
    await mainPage.evaluate(() => window.planqDesktop.__test.hideMain());
    await sleep(500);
    await mainPage.evaluate(() => window.planqDesktop.__test.quickAdd());
    await sleep(7000);
    st = await state();
    const mainW = st.windows.find((w) => w.main);
    push('C6 로그아웃 상태 단축키 → 빠른 창 없음 · 메인 창 보임', !st.windows.some((w) => w.quick) && !!mainW && mainW.visible,
      JSON.stringify(st.windows.map((w) => [w.url.replace(ORIGIN, ''), w.visible, w.quick, w.main])));
  } catch (e) {
    push('desktop-quick 카나리 실행', false, `${e && e.message} · ${stderr.slice(-300)}`);
  } finally {
    try { if (browser) await browser.disconnect(); } catch { /* */ }
    try { child.kill('SIGTERM'); } catch { /* */ }
    await sleep(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ }
  }
  return results;
}

module.exports = { run, name: 'desktop-quick' };

if (require.main === module) {
  run().then((r) => {
    const fail = r.filter((x) => x.fail).length;
    console.log(fail ? `FAIL ${fail}` : 'PASS');
    process.exit(fail ? 1 : 0);
  });
}
