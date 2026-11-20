// canary-mail-popout-pin — 메일 팝아웃 «연 워크스페이스에 고정» (2026-11-17 · Irene «권고대로» · Fable 설계 2단계)
//   계약: .claude/rules/workspace.md 3항 예외. 실브라우저(dev-login)로 잰다 —
//   A 메인 전환에도 팝아웃 그대로(다시 부팅 0·줄 0) · 새로고침 유지 · 정본 DB 불변 · 창 안 전환은 이 창만 ·
//     409/403 0건 · 고정 뒤 /businesses/N 이 전부 고정값 · 팝아웃이 연 다른 창은 고정 안 물려받음
//   E 못 보는 곳(비소속) 고정 시도 → 정본으로 · 그 워크스페이스 데이터 요청 0.
//   ★ 시험 계정 정본은 끝에 6 으로 되돌린다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const crypto = require('crypto');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { launch, BASE, sleep } = require('./lib/browser');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const code = (as, ws) => { const p = b64u(JSON.stringify({ as, scope: { ws }, next: '/', exp: Date.now() + 60000, n: crypto.randomUUID() })); return `v1.${p}.${b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest())}`; };
let out = []; let fail = 0; let results = [];
const ok = (c, m) => { out.push(`${c ? '✅' : '❌'} ${m}`); results.push({ name: `mailpin ${m}`.slice(0, 160), fail: c ? 0 : 1, details: [m] }); if (!c) fail++; };
const canon = async (email) => (await sequelize.query('SELECT active_business_id a FROM users WHERE email=?', { replacements: [email], type: 'SELECT' }))[0].a;
async function session(as, ws) {
  const { browser, page } = await launch();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  const tok = await page.evaluate(async (c) => { const r = await fetch('/api/auth/dev-login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) }); return (await r.json()).data.token; }, code(as, ws));
  // 전환은 서버로 직접(브라우저 밖) — 메인 창은 전환을 따라 다시 부팅하므로 그 창에서 부르면 도중에 끊긴다
  const sw = async (w) => (await fetch(BASE + '/api/auth/switch-workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ business_id: w }) })).status;
  return { browser, page, sw };
}
const chipText = (p) => p.$eval('[data-testid="mail-popout-workspace"]', (e) => e.textContent);
function track(pop, log) {
  pop.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) log.push({ u: u.replace(BASE, ''), s: r.status() }); });
}
async function run() {
  out = []; fail = 0; results = [];
  if (!process.env.DEV_LOGIN_SECRET) return [{ name: 'mailpin', unmeasured: true, details: ['DEV_LOGIN_SECRET 없음 — dev 전용 검사'] }];
  // ── A. owner — 고정 창
  const A = await session('owner', 6);
  try {
    ok(await A.sw(6) === 200, '정본 6 으로 시작');
    await A.page.goto(BASE + '/mail', { waitUntil: 'domcontentloaded' });
    await A.page.waitForSelector('[data-testid="mail-popout-open"]');
    const popP = new Promise((res) => A.browser.once('targetcreated', async (t) => res(await t.page())));
    await A.page.click('[data-testid="mail-popout-open"]');
    const pop = await popP; const log = []; track(pop, log);
    await pop.waitForSelector('[data-testid="mail-popout-workspace"]', { timeout: 30000 });
    await sleep(2500);
    ok(/\/mail-popout\?ws=6/.test(pop.url()), `팝아웃 주소 ${pop.url().replace(BASE, '')}`);
    const c1 = await chipText(pop); ok(/PlanQ 테스트/.test(c1), `처음 띠 «${c1}»`);
    await pop.evaluate(() => { window.__noReload = 1; });

    // B. 메인에서 7 로 전환 → 팝아웃은 그대로(다시 부팅 안 함)
    ok(await A.sw(7) === 200, '메인 쪽에서 정본 7 로 전환(소켓 방송)');
    await sleep(6000);
    const stay = await pop.evaluate(() => window.__noReload === 1);
    const c2 = await chipText(pop);
    ok(stay && c2 === c1, `팝아웃 안 바뀜 (다시 부팅 ${stay ? '없음' : '있음'}, 띠 «${c2}»)`);
    const bar = await pop.$('[data-testid="workspace-sync-bar"]'); ok(!bar, '팝아웃에 «바뀌었어요» 줄 없음');
    await pop.reload({ waitUntil: 'domcontentloaded' }); await pop.waitForSelector('[data-testid="mail-popout-workspace"]'); await sleep(2500);
    ok(/PlanQ 테스트/.test(await chipText(pop)), `팝아웃 새로고침해도 ws6 유지 «${await chipText(pop)}»`);
    const rows6 = await pop.$$eval('[data-testid="mail-thread-row"]', (e) => e.length);
    ok(rows6 > 0, `ws6 메일 목록 ${rows6}줄 (정본은 7)`);
    ok(await canon('owner@test.planq.kr') === 7, `DB 정본은 7 그대로 (${await canon('owner@test.planq.kr')})`);

    // C. 팝아웃 안에서 7 로 → 이 창만
    ok(await A.sw(6) === 200, '정본 다시 6');
    await sleep(3000);
    await pop.click('[data-testid="mail-popout-workspace"]'); await sleep(500);
    const items = await pop.$$eval('[data-testid="mail-popout-workspace-item"]', (e) => e.map((x) => x.textContent));
    out.push(`   고를 수 있는 곳: ${items.join(' · ')}`);
    const nav = pop.waitForNavigation({ waitUntil: 'domcontentloaded' });
    await pop.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="mail-popout-workspace-item"]')].find((x) => /브랜드/.test(x.textContent)); b && b.click(); });
    await nav; await pop.waitForSelector('[data-testid="mail-popout-workspace"]'); await sleep(2500);
    ok(/브랜드 파트너스/.test(await chipText(pop)) && /ws=7/.test(pop.url()), `창 안 전환 → «${await chipText(pop)}» ${pop.url().replace(BASE, '')}`);
    ok(await canon('owner@test.planq.kr') === 6, `DB 정본 6 그대로 (${await canon('owner@test.planq.kr')})`);

    // 네트워크: 고정 창(ws7) 요청 전수
    const after = log.filter((x) => true);
    const bad409 = after.filter((x) => x.s === 409); const bad403 = after.filter((x) => x.s === 403);
    const wrongBiz = after.filter((x) => { const m = /\/api\/businesses\/(\d+)\//.exec(x.u); return m && !['6', '7'].includes(m[1]); });
    ok(bad409.length === 0, `팝아웃 409 ${bad409.length}건 ${bad409.slice(0, 3).map((x) => x.u).join(' ')}`);
    ok(bad403.length === 0, `팝아웃 403 ${bad403.length}건 ${bad403.slice(0, 3).map((x) => x.u).join(' ')}`);
    // ws7 단계 요청이 모두 7 인지: 마지막 navigation 이후 기록
    const idx = log.findIndex((x) => /view_ws=7/.test(x.u));
    const tail = idx >= 0 ? log.slice(idx) : [];
    const not7 = tail.filter((x) => { const m = /\/api\/businesses\/(\d+)\//.exec(x.u); return m && m[1] !== '7'; });
    ok(idx >= 0 && not7.length === 0, `ws7 고정 뒤 /businesses/N 요청이 전부 7 (${tail.length}건 중 다른 곳 ${not7.length})`);
    out.push(`   ws7 단계 범위 없는 API: ${[...new Set(tail.filter((x) => !/\/api\/businesses\/\d+/.test(x.u)).map((x) => x.u.split('?')[0].replace(/\d+/g, 'N')))].join(' · ')}`);

    // D. 고정 창이 연 다른 창은 고정을 물려받지 않음
    const subP = new Promise((res) => A.browser.once('targetcreated', async (t) => res(await t.page())));
    await pop.evaluate(() => window.open('/inbox', 'pq-sub-test'));
    const sub = await subP; const slog = []; track(sub, slog); await sleep(5000);
    const subView = slog.filter((x) => /view_ws/.test(x.u));
    ok(subView.length === 0, `팝아웃이 연 /inbox 창은 고정 아님 (view_ws 요청 ${subView.length})`);
    await sub.close();
    await pop.screenshot({ path: (process.env.MAILPIN_SHOT || '/tmp') + '/pin-pop.png' });
    await pop.click('[data-testid="mail-popout-workspace"]'); await sleep(400);
    await pop.screenshot({ path: (process.env.MAILPIN_SHOT || '/tmp') + '/pin-pop-open.png' });
  } catch (e) { ok(false, 'A 예외 ' + e.message); } finally { try { await A.sw(6); } catch { /* */ } await A.browser.close(); }

  // ── F. 고정 창(ws7)에서 ws6 메일 주소를 열면 «다른 워크스페이스» 안내 → [전환해서 열기] = 이 창만 ws6 · 정본 불변
  const F = await session('owner', 6);
  try {
    await F.sw(7);   // 정본 7 — 옛 버튼(정본 전환)이면 6 으로 바뀌어 잡힌다
    const [t6] = await sequelize.query('SELECT id FROM email_threads WHERE business_id = 6 ORDER BY id DESC LIMIT 1', { type: 'SELECT' });
    await F.page.goto(`${BASE}/mail-popout?ws=7&thread=${t6.id}`, { waitUntil: 'domcontentloaded' });
    const notice = await F.page.waitForSelector('[data-testid="other-workspace-switch"]', { timeout: 30000 }).catch(() => null);
    ok(!!notice, `ws7 고정 창에 ws6 메일(${t6.id}) → «다른 워크스페이스» 안내`);
    if (notice) {
      // 처음 열 때 주소를 ws 지웠다 다시 붙이며 두세 번 그린다 — 그 사이 잠깐 그려진 안내를 잡으면 누르기 전에 사라진다(11-20 실측).
      // 자리 잡을 때까지 기다린 뒤 다시 찾는다.
      await sleep(2000);
      await F.page.waitForSelector('[data-testid="other-workspace-switch"]', { timeout: 15000 });
      // 이동 기다림을 click 과 묶는다 — 따로 두면 이동 중 «frame detached» 거절이 처리 안 된 채 러너를 통째로 죽인다(2026-11-19 밤 실측)
      await Promise.all([
        F.page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
        F.page.click('[data-testid="other-workspace-switch"]'),
      ]);
      await F.page.waitForSelector('[data-testid="mail-popout-workspace"]'); await sleep(2500);
      const u = F.page.url();
      ok(/ws=6/.test(u) && new RegExp(`thread=${t6.id}`).test(u), `전환해서 열기 → 이 창 ws6 · 보던 메일 유지 (${u.replace(BASE, '')})`);
      ok(/PlanQ 테스트/.test(await chipText(F.page)), `띠 «${await chipText(F.page)}»`);
      ok(await canon('owner@test.planq.kr') === 7, `정본 7 그대로 (${await canon('owner@test.planq.kr')})`);
      const n2 = await F.page.$('[data-testid="other-workspace-notice"]'); ok(!n2, '안내가 사라지고 메일이 열림');
    }
  } catch (e) { ok(false, 'F 예외 ' + e.message); } finally { try { await F.sw(6); } catch { /* */ } await F.browser.close(); }

  // ── E. 못 보는 워크스페이스 고정 → 정본으로 돌아감 (member1 은 ws7 비소속)
  const B = await session('member', 6);
  try {
    await B.sw(6);
    const log = []; track(B.page, log);
    await B.page.goto(BASE + '/mail-popout?ws=7', { waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector('[data-testid="mail-popout-workspace"]', { timeout: 30000 }); await sleep(2500);
    const c = await chipText(B.page);
    ok(/PlanQ 테스트/.test(c), `비소속 ws7 고정 시도 → 정본 «${c}» 로`);
    ok(!/ws=7/.test(B.page.url()), `주소에서 ws=7 지움 (${B.page.url().replace(BASE, '')})`);
    const leak = log.filter((x) => /\/api\/businesses\/7\//.test(x.u));
    ok(leak.length === 0, `ws7 데이터 요청 ${leak.length}건`);
    const v = log.find((x) => /view_ws=7/.test(x.u)); ok(v && v.s === 403, `view_ws=7 → ${v && v.s}`);
  } catch (e) { ok(false, 'E 예외 ' + e.message); } finally { await B.browser.close(); }

  return results;
}
module.exports = { run };
if (require.main === module) run().then(() => { console.log(out.join('\n')); console.log(fail ? `실패 ${fail}` : '전부 통과'); process.exit(fail ? 1 : 0); });
