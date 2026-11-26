// canary-ws-last-path — 워크스페이스를 바꾸면 **그 워크스페이스에서 마지막에 보던 화면**으로 가는가 (2026-11-26)
//
//   Irene: "왜 이전 워크스페이스에서 있던 메뉴로 맞춰서 새워크스페이스로 가는 거야?
//           각각 워크스페이스에서 보던 마지막 메뉴에 들어간 있는상태로 이동해야지."
//   코드: utils/workspaceLastPath(기록·읽기) · hooks/useRememberWorkspacePath(MainLayout) · config/navMenus.workspaceSwitchLanding
//
// 재는 것 (health-check 계정 — A=5, B=73 두 곳 소속, 1440 폭 실제 전환기 클릭):
//   ① 기억이 없으면 종전(11-18) — A /docs 에서 B 로 → B /docs (보던 메뉴 첫 화면)
//   ② B 에서 /calendar 로 옮긴 뒤 A 로 → A 는 **/docs**(A 의 마지막). 옛 동작이면 /calendar — 그래서 이 줄이 대조군이다
//   ③ 다시 B 로 → **/calendar**(B 의 마지막)
//   ④ 쿼리까지 복원 — A 에서 /tasks?view=… 처럼 쿼리가 붙은 화면 → B → A 면 같은 쿼리
//   ⑤ 기록이 섞이지 않는다 — 저장소의 A·B 값이 각자 마지막 화면(전환 순간 앞 워크스페이스 경로가 새 키에 박히지 않음)
//   ★ 끝나면 active_business_id 를 원래 값으로 되돌린다
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const USER = 5;
const A = 5;
const B = 73;

async function waitFor(fn, ms = 15000, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const v = await fn(); if (v) return v; } catch { /* 재부팅 중 */ }
    await b.sleep(step);
  }
  return null;
}
async function switchVia(page, bizId) {
  await page.bringToFront();
  const item = `[data-testid="ws-switcher-item-${bizId}"]`;
  for (let i = 0; ; i++) {
    try {
      await page.waitForSelector('[data-testid="ws-switcher-trigger"]', { visible: true, timeout: 15000 });
      await page.click('[data-testid="ws-switcher-trigger"]');
      await page.waitForSelector(item, { visible: true, timeout: 5000 });
      break;
    } catch (e) {
      if (i >= 2) throw e;
      await b.sleep(1500);
    }
  }
  const t0 = await page.evaluate(() => performance.timeOrigin).catch(() => null);
  await page.click(item);
  // 전환은 문서 이동(재부팅)이다 — 새 문서가 뜨고 전환기가 다시 보일 때까지
  await waitFor(async () => (await page.evaluate(() => performance.timeOrigin)) !== t0);
  await page.waitForSelector('[data-testid="ws-switcher-trigger"]', { visible: true, timeout: 20000 }).catch(() => null);
  await b.sleep(1500);
}
const here = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const readMem = (page) => page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.endsWith('planq:ws-last-path')) out[k] = localStorage.getItem(k);
  }
  return out;
});

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let browser = null;
  const [[orig]] = await sequelize.query('SELECT active_business_id FROM users WHERE id=?', { replacements: [USER] });
  try {
    await sequelize.query('UPDATE users SET active_business_id=? WHERE id=?', { replacements: [A, USER] });
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    // 기억을 비우고 시작(이 기기에 이전 실행 값이 남아 있을 수 있다)
    await page.evaluate(() => {
      const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.endsWith('planq:ws-last-path')) ks.push(k); }
      ks.forEach((k) => localStorage.removeItem(k));
    });
    await b.goto(page, '/docs');
    await b.sleep(2000);

    // ① 기억 없음 → 보던 메뉴 첫 화면
    await switchVia(page, B);
    const p1 = here(page);
    push('① 기억 없는 B — 보던 메뉴(/docs) 첫 화면', p1.startsWith('/docs'), `착지 ${p1}`);

    // ② B 에서 /calendar → A 로 → A 의 마지막(/docs)
    await b.goto(page, '/calendar');
    await b.sleep(2000);
    await switchVia(page, A);
    const p2 = here(page);
    push('② B /calendar → A — A 의 마지막 /docs (옛 동작이면 /calendar)', p2.startsWith('/docs'), `착지 ${p2}`);

    // ③ 다시 B → B 의 마지막(/calendar)
    await switchVia(page, B);
    const p3 = here(page);
    push('③ A → B — B 의 마지막 /calendar', p3.startsWith('/calendar'), `착지 ${p3}`);

    // ④ 쿼리까지 — A 에서 쿼리 붙은 화면
    await switchVia(page, A);
    const withQuery = '/tasks?tab=all';
    await b.goto(page, withQuery);
    await b.sleep(2000);
    const aBefore = here(page);   // 화면이 쿼리를 다시 쓸 수 있다 — 실제로 남은 주소를 기준으로 본다
    await switchVia(page, B);
    const p4b = here(page);
    await switchVia(page, A);
    const p4 = here(page);
    push('④ 쿼리까지 복원 — A 로 돌아오면 떠날 때 주소 그대로', p4 === aBefore && p4b.startsWith('/calendar'), `떠날 때 ${aBefore} · B ${p4b} · 돌아온 A ${p4}`);

    // ⑤ 저장소 — A·B 값이 각자
    const mem = await readMem(page);
    const vals = Object.values(mem).map((v) => { try { return JSON.parse(v); } catch { return {}; } });
    const m = vals.find((v) => v && v[String(A)] && v[String(B)]) || {};
    push('⑤ 기록이 섞이지 않는다 — A=떠날 때 주소 · B=/calendar', m[String(A)] === aBefore && String(m[String(B)] || '').startsWith('/calendar'),
      `저장 ${JSON.stringify(mem)}`);
  } catch (e) {
    results.push({ name: 'canary-ws-last-path', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await sequelize.query('UPDATE users SET active_business_id=? WHERE id=?', { replacements: [orig.active_business_id, USER] }).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-ws-last-path' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 워크스페이스별 마지막 화면 카나리 ===\n');
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
