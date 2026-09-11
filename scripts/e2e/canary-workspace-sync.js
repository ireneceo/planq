// canary-workspace-sync — 워크스페이스를 바꾸면 **모든 창이 따라오는가** (2026-09-11)
//
//   Irene: "팝아웃에서 업무리스트가 워크스페이스 바꾸니까 다 없어졌는데 다시 바꿔도 돌아가지 않아.
//           워크스페이스 바뀌는게 팝아웃에도 연결되어서 저장되어야지. 모든 페이지가 하나의 워크스페이스로만 연결되어야지."
//   설계: docs/WORKSPACE_SCOPE_DESIGN.md C4 — 서버 emit(user:N) + BroadcastChannel + WorkspaceSyncGuard
//
// 재는 것 (health-check 계정 — 워크스페이스 A=5, B=73 두 곳 소속):
//   ① 메인 창에서 A→B 전환(실제 전환기 클릭) → 두 번째 메인 탭은 /talk 로 재부팅 · 팝아웃은 **제자리 재부팅** 후 B 로 조회
//   ② 다시 A 로 → 팝아웃이 **A 로 돌아온다** (신고 원문 그대로)
//   ③ 입력 중인 탭은 재부팅하지 않고 줄만 띄운다 · 친 글자 보존 · "지금 전환" 누르면 이동
//   ④ 사칭 토큰의 전환은 403
//   ⑤ 음성 대조군 — 전환이 없으면 아무 창도 재부팅하지 않는다(가만히 둔 8초)
//   ★ 끝나면 계정의 active_business_id 를 원래 값으로 되돌린다(다른 스위트가 이 계정을 쓴다)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const USER = 5;
const A = 5;
const B = 73;
const API = process.env.E2E_API || 'http://127.0.0.1:3003';

const timeOrigin = (p) => p.evaluate(() => performance.timeOrigin).catch(() => null);
async function waitFor(fn, ms = 8000, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* 재부팅 중 evaluate 실패는 기다린다 */ }
    await b.sleep(step);
  }
  return false;
}
// ★ 누를 창을 앞으로 — headless 는 뒤에 있는 탭의 click 이 IntersectionObserver 를 기다리다 멈춘다
//   (첫 실행: tab2 를 연 뒤 main 이 뒤로 밀려 Runtime.callFunctionOn protocolTimeout FATAL)
async function switchVia(page, bizId) {
  await page.bringToFront();
  await page.click('[data-testid="ws-switcher-trigger"]');
  await page.waitForSelector(`[data-testid="ws-switcher-item-${bizId}"]`, { visible: true, timeout: 5000 });
  await page.click(`[data-testid="ws-switcher-item-${bizId}"]`);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let browser = null;
  const [[orig]] = await sequelize.query('SELECT active_business_id FROM users WHERE id=?', { replacements: [USER] });
  try {
    await sequelize.query('UPDATE users SET active_business_id=? WHERE id=?', { replacements: [A, USER] });
    const launched = await b.launch();
    browser = launched.browser;
    const main = launched.page;
    await main.setViewport({ width: 1440, height: 900 });
    await b.login(main);
    await b.goto(main, '/tasks');
    await b.sleep(1500);

    // 팝아웃 — 실제 사용자 경로와 같은 window.open (이름 pq-qtask)
    const popTarget = browser.waitForTarget((t) => t.url().includes('/task-popout'), { timeout: 15000 });
    await main.evaluate(() => { window.open('/task-popout', 'pq-qtask', 'width=420,height=720'); });
    const pop = await (await popTarget).page();
    await pop.setViewport({ width: 420, height: 720 });
    const popBiz = [];
    pop.on('request', (r) => { const m = /my-week\?business_id=(\d+)/.exec(r.url()); if (m) popBiz.push(Number(m[1])); });
    await b.sleep(3000);

    const tab2 = await browser.newPage();
    await tab2.setViewport({ width: 1440, height: 900 });
    await b.goto(tab2, '/notes');
    await b.sleep(2500);

    // ⑤ 음성 대조군 — 가만히 두면 아무도 재부팅하지 않는다
    const t0pop = await timeOrigin(pop); const t0tab = await timeOrigin(tab2);
    await b.sleep(8000);
    push('⑤ 전환이 없으면 재부팅 0 (대조군)', (await timeOrigin(pop)) === t0pop && (await timeOrigin(tab2)) === t0tab,
      `팝아웃 ${t0pop === (await timeOrigin(pop)) ? '그대로' : '재부팅됨'} · 탭2 ${t0tab === (await timeOrigin(tab2)) ? '그대로' : '재부팅됨'}`);

    // ① A → B
    popBiz.length = 0;
    await switchVia(main, B);
    const tabMoved = await waitFor(async () => tab2.url().includes('/talk') && (await timeOrigin(tab2)) !== t0tab);
    const popRebooted = await waitFor(async () => (await timeOrigin(pop)) !== t0pop && pop.url().includes('/task-popout'));
    const popOnB = await waitFor(async () => popBiz.includes(B), 8000);
    const [[s1]] = await sequelize.query('SELECT active_business_id FROM users WHERE id=?', { replacements: [USER] });
    push('① A→B 전환 — 두 번째 탭 /talk · 팝아웃 제자리 재부팅 후 B 조회', tabMoved && popRebooted && popOnB && Number(s1.active_business_id) === B,
      `탭2 이동=${tabMoved} (${tab2.url().replace(b.BASE, '')}) · 팝아웃 재부팅=${popRebooted} (${pop.url().replace(b.BASE, '')}) · 팝아웃 조회 biz=${[...new Set(popBiz)].join(',') || '없음'} · 정본=${s1.active_business_id}`);

    // ② B → A — 신고: "다시 바꿔도 돌아가지 않아"
    await b.sleep(2500);
    const t1pop = await timeOrigin(pop);
    popBiz.length = 0;
    await main.waitForSelector('[data-testid="ws-switcher-trigger"]', { visible: true, timeout: 15000 });
    await b.sleep(1000);
    await switchVia(main, A);
    const popBack = await waitFor(async () => (await timeOrigin(pop)) !== t1pop, 8000);
    const popOnA = await waitFor(async () => popBiz.includes(A) && !popBiz.includes(B), 8000);
    push('② B→A — 팝아웃이 A 로 돌아온다(신고 재현)', popBack && popOnA, `팝아웃 재부팅=${popBack} · 조회 biz=${[...new Set(popBiz)].join(',') || '없음'}`);

    // ③ 입력 중인 탭은 보류 — 줄만, 글자 보존, "지금 전환" 으로 이동
    await b.sleep(2500);
    await b.goto(tab2, '/notes');
    await b.sleep(2500);
    const probeText = 'ws-sync 입력 보존';
    // ★ 탭 모드는 keep-alive 로 **숨은 탭 화면**의 입력란도 DOM 에 있다 — 첫 번째 것을 잡으면 보이지 않는 칸이라
    //   focus() 가 먹지 않는다(첫 재실행: 포커스=false). 화면에 보이는 입력란만 고른다.
    const focusInfo = await tab2.evaluate((txt) => {
      const all = [...document.querySelectorAll('input[type="search"], input[placeholder], textarea')];
      const visible = all.filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && !e.readOnly);
      const el = visible[0];
      if (!el) return { ok: false, all: all.length, visible: 0 };
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, txt); el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: document.activeElement === el, all: all.length, visible: visible.length };
    }, probeText);
    const focused = focusInfo.ok;
    const t2tab = await timeOrigin(tab2);
    await main.waitForSelector('[data-testid="ws-switcher-trigger"]', { visible: true, timeout: 15000 });
    await b.sleep(1000);
    await switchVia(main, B);
    const barShown = await waitFor(async () => !!(await tab2.$('[data-testid="workspace-sync-bar"]')), 8000);
    const kept = await tab2.evaluate((txt) => { const el = document.activeElement; return !!el && el.value === txt; }, probeText).catch(() => false);
    const notRebooted = (await timeOrigin(tab2)) === t2tab;
    push('③ 입력 중 탭 — 재부팅 없이 줄만 · 글자 보존', focused && barShown && kept && notRebooted,
      `포커스=${focused} 줄=${barShown} 글자보존=${kept} 재부팅없음=${notRebooted}`);
    if (barShown) {
      await tab2.bringToFront();
      await tab2.click('[data-testid="workspace-sync-apply"]');
      const applied = await waitFor(async () => (await timeOrigin(tab2)) !== t2tab && tab2.url().includes('/talk'), 8000);
      push('③ "지금 전환" 누르면 이동', applied, `이동=${applied} (${tab2.url().replace(b.BASE, '')})`);
    }

    // ④ 사칭 토큰 전환 403
    const imp = jwt.sign({ userId: USER, id: USER, impersonator: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const r = await fetch(`${API}/api/auth/switch-workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imp}` }, body: JSON.stringify({ business_id: A }) });
    const [[s4]] = await sequelize.query('SELECT active_business_id FROM users WHERE id=?', { replacements: [USER] });
    push('④ 사칭 중 전환 403 · 정본 그대로', r.status === 403 && Number(s4.active_business_id) === B, `status=${r.status} 정본=${s4.active_business_id}`);

    // ⑥ 전파를 놓친 창 — 서버가 409 workspace_stale 로 알리면 따라간다 (설계 단계 3~5, 2026-09-11)
    //   정본만 A 로 바꾸고 emit 은 하지 않는다(이벤트 유실 재현). 메인 창은 여전히 B 를 믿는다.
    //   메인 창의 확인필요 조회(/api/dashboard/todo?business_id=) 에서 **범위만 지워** 서버가 헤더로 채우게 한다
    //   → 헤더 B ≠ 정본 A → 409 → apiFetch → WorkspaceSyncGuard 가 A 로 재부팅.
    //   ★ 음성 대조군을 먼저 — 정본이 B 일 때 같은 조작은 200 이고 재부팅이 없어야 한다(재부팅이 409 때문임을 증명).
    await main.bringToFront();
    await b.goto(main, '/talk');
    await b.sleep(2500);
    const wsHeaders = [];
    let stripScope = false;
    await main.setRequestInterception(true);
    main.on('request', (rq) => {
      const u = rq.url();
      if (u.includes('/api/')) { const h = rq.headers()['x-workspace-id']; if (h) wsHeaders.push(Number(h)); }
      if (stripScope && /\/api\/dashboard\/todo\?business_id=\d+/.test(u)) {
        return rq.continue({ url: u.replace(/\?business_id=\d+&?/, '?') });
      }
      return rq.continue();
    });
    const kick = () => main.evaluate(() => { window.dispatchEvent(new CustomEvent('inbox:refresh')); window.dispatchEvent(new Event('focus')); });
    stripScope = true;
    wsHeaders.length = 0;
    const t6a = await timeOrigin(main);
    await kick();
    await b.sleep(5000);
    push('⑥ 대조군: 헤더 == 정본이면 범위를 지워도 재부팅 0 · 요청에 X-Workspace-Id=B',
      (await timeOrigin(main)) === t6a && wsHeaders.length > 0 && wsHeaders.every((h) => h === B),
      `재부팅=${(await timeOrigin(main)) !== t6a} · 헤더=${[...new Set(wsHeaders)].join(',') || '없음'}`);

    await sequelize.query('UPDATE users SET active_business_id=? WHERE id=?', { replacements: [A, USER] });
    const t6b = await timeOrigin(main);
    await kick();
    const followed = await waitFor(async () => (await timeOrigin(main)) !== t6b, 10000);
    stripScope = false;
    wsHeaders.length = 0;
    await b.sleep(3500);
    push('⑥ 정본만 바뀐 창(이벤트 유실) — 409 를 받고 A 로 따라간다 · 이후 요청 헤더 A',
      followed && wsHeaders.length > 0 && wsHeaders.every((h) => h === A),
      `재부팅=${followed} (${main.url().replace(b.BASE, '')}) · 이후 헤더=${[...new Set(wsHeaders)].join(',') || '없음'}`);
    await main.setRequestInterception(false).catch(() => null);
  } catch (e) {
    results.push({ name: 'canary-workspace-sync', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await sequelize.query('UPDATE users SET active_business_id=? WHERE id=?', { replacements: [orig.active_business_id, USER] }).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-workspace-sync' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 워크스페이스 전환 전파 카나리 ===\n');
    for (const r of res) {
      const isBad = (r.fail || 0) + (r.fatal || 0) > 0;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'} ${r.name}`);
      (r.details || []).forEach((d) => console.log('     └ ' + d));
    }
    console.log(`\n총 문제: ${bad}`);
    sequelize.close().catch(() => null);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
