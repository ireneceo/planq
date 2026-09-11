// canary-leave-save — 나갈 때 확정 저장 (2026-09-11, DRAFT_PERSISTENCE_DESIGN D-C3 라운드 1B)
//
//   자동저장은 debounce 다. 입력하고 그 창(0.3~2초) 안에 화면을 떠나거나·✕·새로고침·로그아웃하면
//   여태는 타이머와 함께 입력이 사라졌다 — 서버엔 안 갔고 화면은 없어졌다.
//
// ★ 판정은 둘을 같이 잰다: **떠나기 전 저장 0건**(debounce 가 아직 안 터졌다) + **떠난 뒤 저장 1건 · 서버 값 == 입력**.
//   앞쪽이 없으면 "debounce 가 늦게 터진 것" 과 "떠날 때 보낸 것" 이 구별되지 않는다.
// ★ 판정 순서상 로그아웃은 맨 마지막(세션이 끊긴다). 계정 이름은 DB 에서 원래 값으로 되돌린다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const USER = 5;
const BIZ = 5;
const SEL = (id) => `[data-testid="${id}"]`;
const q = async (sql, rep = []) => (await sequelize.query(sql, { replacements: rep }))[0];

const probe = (p, sel) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  if (!el) return null;
  return { value: el.value ?? el.textContent };
}, sel).catch(() => null);
async function handleOf(p, sel) {
  const h = await p.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0) || null, sel);
  return h.asElement();
}
async function typeAtEnd(p, sel, text) {
  const h = await handleOf(p, sel);
  if (!h) throw new Error(`입력란이 안 보인다: ${sel}`);
  await h.click();
  await p.keyboard.down('Control'); await p.keyboard.press('End'); await p.keyboard.up('Control');
  await p.keyboard.type(text);
}
async function click(p, sel) { const h = await handleOf(p, sel); if (!h) return false; await h.click(); return true; }
async function waitFor(fn, ms = 8000, step = 200) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* 이동 중 */ }
    await b.sleep(step);
  }
  return false;
}
async function nav(p, path) {
  const ok = await p.evaluate((pp) => { try { if (window.__pqTab) { window.__pqTab.navigateActive(pp); return true; } } catch { /* noop */ } return false; }, path);
  if (!ok) await b.gotoSPA(p, path); else await b.sleep(1000);
}
// 캡처한 Authorization 으로 정리 요청 — 화면을 거치지 않는다
async function apiAs(auth, method, path) {
  if (!auth) return 0;
  try { return (await fetch(b.BASE + path, { method, headers: { Authorization: auth } })).status; } catch { return 0; }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let browser = null;
  let origName = null;
  let taskId = null;
  const stamp = String(Date.now()).slice(-6);
  try {
    [{ name: origName }] = await q('SELECT name FROM users WHERE id=?', [USER]);
    await q("DELETE FROM tasks WHERE business_id=? AND title LIKE 'leave-canary %'", [BIZ]);
    const now = new Date();
    taskId = (await sequelize.query(
      'INSERT INTO tasks (business_id, title, status, assignee_id, created_by, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      { replacements: [BIZ, 'leave-canary T', 'in_progress', USER, USER, '<p>leave-canary 원래 설명</p>', now, now] }))[0];

    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await page.setViewport({ width: 1440, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 160)));
    const reqs = [];
    page.on('request', (r) => {
      const u = r.url().replace(/^https?:\/\/[^/]+/, '');
      if (!/^\/(api|qnote\/api)\//.test(u)) return;
      reqs.push({ method: r.method(), url: u, body: r.postData() || '', auth: r.headers().authorization || null });
    });
    const lastAuth = () => [...reqs].reverse().find((r) => r.auth)?.auth || null;
    await b.login(page);

    // ── ⑤ AutoSaveField — 입력 0.5초 뒤 화면을 떠난다(언마운트) ──
    const isNamePut = (r) => r.method === 'PUT' && r.url === `/api/users/${USER}`;
    await b.goto(page, '/profile');
    const NAME = SEL('profile-account-name');
    if (!(await waitFor(async () => !!(await probe(page, NAME)), 15000))) {
      push('⑤ AutoSaveField 떠나도 저장', false, '프로필 이름 입력칸을 못 찾음 — 계측 불가');
    } else {
      const since = reqs.length;
      await typeAtEnd(page, NAME, ' LV');
      await b.sleep(500);
      const before = reqs.slice(since).filter(isNamePut).length;
      await nav(page, '/tasks');
      await waitFor(async () => reqs.slice(since).some(isNamePut), 5000);
      await b.sleep(800);
      const puts = reqs.slice(since).filter(isNamePut).length;
      const [{ name: now5 }] = await q('SELECT name FROM users WHERE id=?', [USER]);
      push('⑤ AutoSaveField 입력 0.5초 뒤 화면을 떠나도 저장 — 떠나기 전 0 · 뒤 PUT 1 · 서버 == 입력',
        before === 0 && puts === 1 && now5 === `${origName} LV`, `떠나기 전=${before} 뒤=${puts} DB=${now5}`);
    }

    // ── ⑥ Q Note 새 메모 — 입력 0.3초 뒤 화면을 떠난다 ──
    const memoText = `leave-canary 메모 ${stamp}`;
    const isMemoWrite = (r) => (r.method === 'POST' || r.method === 'PUT') && /^\/qnote\/api\/sessions(\/\d+)?$/.test(r.url) && r.body.includes(stamp);
    const createdIds = [];
    page.on('response', async (res) => {
      try {
        const u = res.url().replace(/^https?:\/\/[^/]+/, '');
        if (res.request().method() !== 'POST' || u !== '/qnote/api/sessions') return;
        if (!(res.request().postData() || '').includes(stamp)) return;
        const j = await res.json();
        const id = j?.id ?? j?.data?.id;
        if (id) createdIds.push(id);
      } catch { /* noop */ }
    });
    await b.goto(page, '/notes');
    await click(page, SEL('qnote-new'));
    await b.sleep(300);
    const memoOpened = (await click(page, SEL('qnote-new-memo'))) && (await waitFor(async () => !!(await handleOf(page, '.ProseMirror')), 8000));
    if (!memoOpened) {
      push('⑥ 메모 떠나도 저장', false, '새 메모 편집기를 못 염 — 계측 불가');
    } else {
      await b.sleep(600);
      const since = reqs.length;
      await typeAtEnd(page, '.ProseMirror', memoText);
      await b.sleep(300);
      const before = reqs.slice(since).filter(isMemoWrite).length;
      await nav(page, '/tasks');
      await waitFor(async () => reqs.slice(since).some(isMemoWrite), 5000);
      await b.sleep(800);
      const writes = reqs.slice(since).filter(isMemoWrite).length;
      push('⑥ Q Note 새 메모 입력 0.3초 뒤 떠나도 저장 — 떠나기 전 0 · 뒤 저장 1(생성 중복 없음)',
        before === 0 && writes === 1, `떠나기 전=${before} 뒤=${writes} 만든 id=${JSON.stringify(createdIds)}`);
      // 정리 — 응답 본문 캡처가 비어 올 수 있다(1차 실행 id=[] → 메모가 남았다). 제목으로 찾아 지운다(앞 실행 잔여 포함).
      const auth = lastAuth();
      let leftovers = [];
      try {
        const jr = await fetch(`${b.BASE}/qnote/api/sessions/me/recent-memos?business_id=${BIZ}&limit=50&q=${encodeURIComponent('leave-canary')}`, { headers: { Authorization: auth } });
        const j = await jr.json();
        const arr = Array.isArray(j) ? j : (j?.data || j?.sessions || []);
        leftovers = arr.filter((s) => String(s.title || '').includes('leave-canary')).map((s) => s.id);
      } catch { /* noop */ }
      const ids = [...new Set([...createdIds, ...leftovers])];
      const statuses = [];
      for (const id of ids) statuses.push(await apiAs(auth, 'DELETE', `/qnote/api/sessions/${id}`));
      results[results.length - 1].details.push(`정리: 메모 ${ids.length}건 삭제 응답=${JSON.stringify(statuses)}`);
    }

    // ── ⑥-메일 새 메일 — 입력 0.5초 뒤 ✕ ──
    const isComposePut = (r) => r.method === 'PUT' && r.url === `/api/businesses/${BIZ}/email-drafts` && r.body.includes(stamp);
    await b.goto(page, '/mail');
    const composeOpened = (await waitFor(async () => click(page, SEL('mail-compose-open')), 10000))
      && (await waitFor(async () => !!(await probe(page, SEL('mail-compose-subject'))), 6000));
    if (!composeOpened) {
      push('⑥-메일 ✕ 해도 초안 저장', false, '새 메일 작성창을 못 염 — 계측 불가');
    } else {
      await b.sleep(1200);   // 서버 초안 불러오기(composeDraftReady)가 끝날 때까지
      const since = reqs.length;
      await typeAtEnd(page, SEL('mail-compose-subject'), `leave-canary 메일 ${stamp}`);
      await b.sleep(500);
      const before = reqs.slice(since).filter(isComposePut).length;
      await click(page, SEL('mail-compose-close'));
      await waitFor(async () => reqs.slice(since).some(isComposePut), 5000);
      await b.sleep(500);
      const puts = reqs.slice(since).filter(isComposePut).length;
      push('⑥-메일 새 메일 입력 0.5초 뒤 ✕ — ✕ 전 0 · 뒤 초안 PUT 1',
        before === 0 && puts === 1, `✕ 전=${before} 뒤=${puts}`);
      await apiAs(lastAuth(), 'DELETE', `/api/businesses/${BIZ}/email-drafts`);
    }

    // ── ⑥-업무 설명 — 입력 0.5초 뒤 새로고침(pagehide keepalive) ──
    const DESC = `${SEL('task-desc-editor')} .ProseMirror`;
    const isDescPut = (r) => r.method === 'PUT' && r.url === `/api/tasks/by-business/${BIZ}/${taskId}` && r.body.includes(stamp);
    await b.goto(page, `/tasks?task=${taskId}`);
    if (!(await waitFor(async () => !!(await handleOf(page, DESC)), 15000))) {
      push('⑥-업무 설명 새로고침해도 저장', false, '업무 설명 편집기를 못 찾음 — 계측 불가');
    } else {
      await b.sleep(600);
      const since = reqs.length;
      await typeAtEnd(page, DESC, ` 설명${stamp}`);
      await b.sleep(500);
      const before = reqs.slice(since).filter(isDescPut).length;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await b.sleep(3000);
      const puts = reqs.slice(since).filter(isDescPut).length;
      const [{ description }] = await q('SELECT description FROM tasks WHERE id=?', [taskId]);
      // ★ 판정은 DB 다 — 새로고침으로 죽는 문서가 보낸 keepalive 요청은 puppeteer request 이벤트에 안 잡힐 수 있다
      //   (1차 실행: 요청 관측 0 인데 DB 에는 반영). 대신 아래 대조군이 "그 반영이 pagehide 저장 덕" 임을 증명한다.
      push('⑥-업무 설명 입력 0.5초 뒤 새로고침 — 전 0 · 서버에 반영',
        before === 0 && String(description).includes(stamp), `전=${before} 요청관측=${puts} DB포함=${String(description).includes(stamp)}`);
      // 대조군 — keepalive fetch 를 막으면 같은 동작에서 서버에 **안** 남아야 한다(판정이 뒤집힌다)
      const stamp2 = `${stamp}x`;
      if (await waitFor(async () => !!(await handleOf(page, DESC)), 15000)) {
        await b.sleep(600);
        await page.evaluate(() => {
          const orig = window.fetch.bind(window);
          window.fetch = (u, init) => (init && init.keepalive ? Promise.resolve(new Response('{}')) : orig(u, init));
        });
        await typeAtEnd(page, DESC, ` 대조${stamp2}`);
        await b.sleep(500);
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
        await b.sleep(3000);
        const [{ description: d2 }] = await q('SELECT description FROM tasks WHERE id=?', [taskId]);
        push('⑥-업무 설명 대조군 — keepalive 를 막으면 서버에 안 남는다(판정이 뒤집힌다)',
          !String(d2).includes(stamp2), `막았을 때 DB포함=${String(d2).includes(stamp2)}`);
      } else {
        push('⑥-업무 설명 대조군', false, '새로고침 뒤 설명 편집기를 못 찾음 — 계측 불가');
      }
    }

    // ── ⑦ 로그아웃 — 대기 중 저장이 로그아웃 POST 보다 먼저 · 이중 클릭에도 POST 1 (맨 마지막) ──
    await b.goto(page, '/profile');
    if (!(await waitFor(async () => !!(await probe(page, NAME)), 15000))) {
      push('⑦ 로그아웃 전 저장', false, '프로필 이름 입력칸을 못 찾음 — 계측 불가');
    } else {
      const since = reqs.length;
      await typeAtEnd(page, NAME, ' LO');
      await b.sleep(300);
      const menu = (await click(page, SEL('user-menu-open'))) && (await waitFor(async () => !!(await handleOf(page, SEL('user-menu-logout'))), 3000));
      // 같은 요소를 연달아 두 번 — 메뉴가 닫히기 전에 두 번째 클릭이 들어간다
      const clicked = menu && await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); el.click(); return true; }, SEL('user-menu-logout'));
      await waitFor(async () => page.url().includes('/login'), 10000);
      await b.sleep(1000);
      const seq = reqs.slice(since);
      const putIdx = seq.findIndex(isNamePut);
      const logoutIdx = seq.findIndex((r) => r.method === 'POST' && r.url === '/api/auth/logout');
      const logoutN = seq.filter((r) => r.method === 'POST' && r.url === '/api/auth/logout').length;
      const [{ name: now7 }] = await q('SELECT name FROM users WHERE id=?', [USER]);
      push('⑦ 로그아웃 — 대기 중 저장이 먼저(토큰 살아 있을 때) · 이중 클릭에도 로그아웃 POST 1',
        clicked && putIdx >= 0 && logoutIdx > putIdx && logoutN === 1 && now7 === `${origName} LV LO`,
        `메뉴=${!!menu} 클릭=${clicked} PUT순번=${putIdx} 로그아웃순번=${logoutIdx} 로그아웃수=${logoutN} DB=${now7}`);
    }

    push('pageerror 0 (전 구간)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0');
  } catch (e) {
    results.push({ name: 'canary-leave-save', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    if (origName != null) await q('UPDATE users SET name=? WHERE id=?', [origName, USER]).catch(() => null);
    if (taskId) {
      for (const t of ['task_comments', 'task_reviewers', 'task_status_history', 'task_attachments']) {
        await q(`DELETE FROM ${t} WHERE task_id=?`, [taskId]).catch(() => null);
      }
      await q('DELETE FROM tasks WHERE id=?', [taskId]).catch(() => null);
    }
  }
  return results;
}

module.exports = { run, name: 'canary-leave-save' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 나갈 때 확정 저장 카나리 ===\n');
    for (const r of res) {
      const failed = (r.fail || 0) + (r.fatal || 0);
      bad += failed;
      console.log(`${failed ? '❌' : '✅'} ${r.name}`);
      for (const d of r.details || []) console.log(`     └ ${d}`);
    }
    console.log(`\n━━━ 총 실패: ${bad} ━━━`);
    return sequelize.close().then(() => process.exit(bad ? 1 : 0));
  });
}
