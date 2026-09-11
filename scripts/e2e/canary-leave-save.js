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
  let seriesId = null;
  let series2Id = null;
  const stamp = String(Date.now()).slice(-6);
  try {
    [{ name: origName }] = await q('SELECT name FROM users WHERE id=?', [USER]);
    await q("DELETE FROM tasks WHERE business_id=? AND title LIKE 'leave-canary %'", [BIZ]);
    const now = new Date();
    taskId = (await sequelize.query(
      'INSERT INTO tasks (business_id, title, status, assignee_id, created_by, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      { replacements: [BIZ, 'leave-canary T', 'in_progress', USER, USER, '<p>leave-canary 원래 설명</p>', now, now] }))[0];
    // 반복 업무(시리즈 부모) — 설명은 적용 범위를 물어야 저장된다(라운드 2 결함 A)
    seriesId = (await sequelize.query(
      'INSERT INTO tasks (business_id, title, status, assignee_id, created_by, description, recurrence_rule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      { replacements: [BIZ, 'leave-canary S', 'in_progress', USER, USER, '<p>leave-canary 반복 원래</p>', 'FREQ=WEEKLY', now, now] }))[0];
    // 두 번째 반복 업무 — 업무 전환 뒤 옛 글이 이쪽으로 새는지(Fable 라운드 2 결함 1)
    series2Id = (await sequelize.query(
      'INSERT INTO tasks (business_id, title, status, assignee_id, created_by, description, recurrence_rule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      { replacements: [BIZ, 'leave-canary S2', 'in_progress', USER, USER, '<p>leave-canary 반복2 원래</p>', 'FREQ=WEEKLY', now, now] }))[0];

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

    // ── ⑧ 반복 업무 설명 — 입력 0.5초 뒤 새로고침: 서버로 안 나간다(범위를 물어야 함) · 로컬 본 · 다시 열면 복원 줄 · 지우기 ──
    const seriesKey = `planq:draft:task-description:${USER}:${BIZ}:${seriesId}`;
    const isSeriesDescPut = (r) => r.method === 'PUT' && r.url === `/api/tasks/by-business/${BIZ}/${seriesId}` && r.body.includes(stamp);
    const visibleText = (sel) => page.evaluate((s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0);
      return el ? el.textContent : null;
    }, sel).catch(() => null);
    await b.goto(page, `/tasks?task=${seriesId}`);
    if (!(await waitFor(async () => !!(await handleOf(page, DESC)), 15000))) {
      push('⑧ 반복 업무 설명 새로고침', false, '반복 업무 설명 편집기를 못 찾음 — 계측 불가');
    } else {
      await b.sleep(600);
      const since = reqs.length;
      await typeAtEnd(page, DESC, ` 반복${stamp}`);
      await b.sleep(500);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await waitFor(async () => !!(await handleOf(page, DESC)), 15000);
      await b.sleep(1500);
      const puts = reqs.slice(since).filter(isSeriesDescPut).length;
      const [{ description: sd }] = await q('SELECT description FROM tasks WHERE id=?', [seriesId]);
      const rec = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, seriesKey);
      const shown = String(await visibleText(DESC) || '').includes(stamp);
      const note = !!(await handleOf(page, SEL('draft-note')));
      push('⑧ 반복 업무 설명 새로고침 — 서버 PUT 0 · DB 불변 · 로컬 본(series) · 다시 열면 복원되어 보인다 + 복원 줄',
        puts === 0 && !String(sd).includes(stamp) && !!rec && rec.series === true && String(rec.value).includes(stamp) && shown && note,
        `PUT=${puts} DB포함=${String(sd).includes(stamp)} 로컬=${rec ? `series=${rec.series}` : 'null'} 화면=${shown} 복원줄=${note}`);
      const cleared = await click(page, SEL('draft-clear'));
      await b.sleep(800);
      const afterText = String(await visibleText(DESC) || '');
      const afterRec = await page.evaluate((k) => localStorage.getItem(k), seriesKey);
      push('⑧ 복원 줄 "지우기" — 원래 설명으로 돌아가고 로컬 본 삭제',
        cleared && !afterText.includes(stamp) && afterText.includes('반복 원래') && afterRec === null,
        `클릭=${cleared} 화면원래=${afterText.includes('반복 원래')} 로컬=${afterRec}`);
    }

    // ── ⑧-전환 반복 업무 설명을 쓰다 **다른 반복 업무로 전환** — 옛 글이 새 업무에 저장·표시·박히지 않는다(Fable 라운드 2 결함 1) ──
    const s2Key = `planq:draft:task-description:${USER}:${BIZ}:${series2Id}`;
    await b.goto(page, `/tasks?task=${seriesId}`);
    if (!(await waitFor(async () => !!(await handleOf(page, DESC)), 15000))) {
      push('⑧-전환 옛 글이 새 업무로 가지 않는다', false, '반복 업무 설명 편집기를 못 찾음 — 계측 불가');
    } else {
      await b.sleep(600);
      const since = reqs.length;
      await typeAtEnd(page, DESC, ` 전환${stamp}`);
      await b.sleep(400);
      await nav(page, `/tasks?task=${series2Id}`);
      const onS2 = await waitFor(async () => String(await visibleText(DESC) || '').includes('반복2 원래'), 12000);
      await b.sleep(3000);   // 옛 debounce(2초)·blur 가 터질 시간
      const askOnS2 = !!(await handleOf(page, SEL('series-scope-cancel')));
      if (askOnS2) await click(page, SEL('series-scope-cancel'));
      await b.sleep(500);
      const s2Text = String(await visibleText(DESC) || '');
      const putS2 = reqs.slice(since).filter((r) => r.method === 'PUT' && r.url === `/api/tasks/by-business/${BIZ}/${series2Id}`).length;
      const [{ description: dS2 }] = await q('SELECT description FROM tasks WHERE id=?', [series2Id]);
      const recs = await page.evaluate((a, c) => ({ s1: localStorage.getItem(a), s2: localStorage.getItem(c) }), seriesKey, s2Key);
      let s1Rec = null;
      try { s1Rec = recs.s1 ? JSON.parse(recs.s1) : null; } catch { s1Rec = null; }
      push('⑧-전환 반복 업무 설명을 쓰다 다른 반복 업무로 — 새 업무에 범위 물음·옛 글·PUT·로컬 본 0 · 옛 업무 로컬 본에만 남는다',
        onS2 && !askOnS2 && !s2Text.includes(stamp) && putS2 === 0 && !String(dS2).includes(stamp) && recs.s2 === null
          && !!s1Rec && s1Rec.series === true && String(s1Rec.value).includes(`전환${stamp}`),
        `S2열림=${onS2} S2범위물음=${askOnS2} S2화면옛글=${s2Text.includes(stamp)} S2PUT=${putS2} S2DB옛글=${String(dS2).includes(stamp)} S2로컬=${recs.s2 ? '있음' : 'null'} S1로컬=${s1Rec ? `series=${s1Rec.series}` : 'null'}`);
      await page.evaluate((a) => localStorage.removeItem(a), seriesKey);
    }

    // ── ⑧-물음 범위 물음이 떠 있는 채 새로고침 — 그 설명이 로컬 본으로 남는다(Fable 라운드 2 결함 2) ──
    await b.goto(page, `/tasks?task=${seriesId}`);
    if (!(await waitFor(async () => !!(await handleOf(page, DESC)), 15000))) {
      push('⑧-물음 범위 물음 뜬 채 새로고침', false, '반복 업무 설명 편집기를 못 찾음 — 계측 불가');
    } else {
      await b.sleep(600);
      await typeAtEnd(page, DESC, ` 물음${stamp}`);
      // debounce(2초) 가 터지면 범위 물음이 뜬다 — 그 상태에서 새로고침
      const asked = await waitFor(async () => !!(await handleOf(page, SEL('series-scope-cancel'))), 6000);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await b.sleep(2000);
      let rec = null;
      try { rec = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), seriesKey); } catch { rec = null; }
      const [{ description: dS1 }] = await q('SELECT description FROM tasks WHERE id=?', [seriesId]);
      push('⑧-물음 범위 물음이 떠 있는 채 새로고침 — 로컬 본(series)에 남고 서버엔 안 간다',
        asked && !!rec && rec.series === true && String(rec.value).includes(`물음${stamp}`) && !String(dS1).includes(`물음${stamp}`),
        `물음뜸=${asked} 로컬=${rec ? `series=${rec.series}` : 'null'} DB반영=${String(dS1).includes(`물음${stamp}`)}`);
      await page.evaluate((k) => localStorage.removeItem(k), seriesKey);
      await b.goto(page, `/tasks?task=${seriesId}`);   // ⑨ 는 깨끗한 화면에서
      await waitFor(async () => !!(await handleOf(page, DESC)), 15000);
      await b.sleep(600);
    }

    // ── ⑨ 반복 업무 설명을 쓰다 로그아웃 — 멈추고 확인창 · 취소는 그대로 · 범위 골라 저장하면 로그아웃이 이어진다 ──
    const isLogoutPost = (r) => r.method === 'POST' && r.url === '/api/auth/logout';
    if (!(await waitFor(async () => !!(await handleOf(page, DESC)), 8000))) {
      push('⑨ 로그아웃 확인창', false, '반복 업무 설명 편집기를 못 찾음 — 계측 불가');
    } else {
      const since = reqs.length;
      await typeAtEnd(page, DESC, ` 반복2${stamp}`);
      await b.sleep(500);
      // ★ 실제 흐름: 사용자 메뉴를 누르면 설명 에디터가 blur 되고, 반복 업무라 **범위 물음이 먼저 뜬다**.
      //   (첫 실행: 이 창이 메뉴를 가려 로그아웃이 눌리지 않았다 — 그리고 여기서 취소하면 글이 어디에도 없었다)
      await click(page, SEL('user-menu-open'));
      const askShown = await waitFor(async () => !!(await handleOf(page, SEL('series-scope-cancel'))), 5000);
      if (askShown) await click(page, SEL('series-scope-cancel'));
      await b.sleep(600);
      const parked = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, seriesKey);
      const stillShown = String(await visibleText(DESC) || '').includes(`반복2${stamp}`);
      push('⑨ 범위 물음 취소 — 쓴 설명이 로컬 본(series)으로 남고 에디터에도 그대로',
        askShown && !!parked && parked.series === true && String(parked.value).includes(`반복2${stamp}`) && stillShown,
        `범위물음=${askShown} 로컬=${parked ? `series=${parked.series}` : 'null'} 에디터=${stillShown}`);
      await page.keyboard.press('Escape');   // 열려 있을 수 있는 사용자 메뉴 닫기
      await b.sleep(300);
      const openLogout = async () => {
        if (!(await handleOf(page, SEL('user-menu-logout')))) {
          if (!(await click(page, SEL('user-menu-open')))) return false;
        }
        if (!(await waitFor(async () => !!(await handleOf(page, SEL('user-menu-logout'))), 3000))) return false;
        return click(page, SEL('user-menu-logout'));
      };
      await openLogout();
      const dlg1 = await waitFor(async () => !!(await handleOf(page, SEL('leave-decision'))), 8000);
      const post1 = reqs.slice(since).filter(isLogoutPost).length;
      const onApp1 = !page.url().includes('/login');
      push('⑨ 반복 업무 설명을 쓰다 로그아웃 — 로그아웃이 멈추고 확인창 · 로그아웃 POST 0',
        dlg1 && post1 === 0 && onApp1, `확인창=${dlg1} 로그아웃POST=${post1} 앱에남음=${onApp1}`);
      await click(page, SEL('leave-cancel'));
      await b.sleep(800);
      const gone = !(await handleOf(page, SEL('leave-decision')));
      const post2 = reqs.slice(since).filter(isLogoutPost).length;
      const recKept = !!(await page.evaluate((k) => localStorage.getItem(k), seriesKey));
      push('⑨ 확인창 취소 — 닫히고 로그아웃 안 나감 · 로컬 본 유지', gone && post2 === 0 && recKept, `닫힘=${gone} 로그아웃POST=${post2} 로컬=${recKept}`);
      await openLogout();
      const dlg2 = await waitFor(async () => !!(await handleOf(page, SEL('leave-decision'))), 8000);
      const picked = dlg2 && (await click(page, SEL('leave-scope-single')));
      await b.sleep(200);
      const saved = picked && (await click(page, SEL('leave-save')));
      await waitFor(async () => page.url().includes('/login'), 12000);
      await b.sleep(1000);
      const seq = reqs.slice(since);
      const putIdx = seq.findIndex((r) => r.method === 'PUT' && r.url === `/api/tasks/by-business/${BIZ}/${seriesId}` && r.body.includes(`반복2${stamp}`) && r.body.includes('"series_scope":"single"'));
      const logoutIdx = seq.findIndex(isLogoutPost);
      const logoutN = seq.filter(isLogoutPost).length;
      const [{ description: sd2 }] = await q('SELECT description FROM tasks WHERE id=?', [seriesId]);
      push('⑨ 범위(이 회차만) 골라 저장 — series_scope PUT 뒤 로그아웃 POST 1 · 서버 반영',
        !!saved && putIdx >= 0 && logoutIdx > putIdx && logoutN === 1 && String(sd2).includes(`반복2${stamp}`),
        `확인창=${dlg2} 선택=${picked} 저장클릭=${saved} PUT순번=${putIdx} 로그아웃순번=${logoutIdx} 로그아웃수=${logoutN} DB반영=${String(sd2).includes(`반복2${stamp}`)}`);
      await b.login(page);   // ⑦ 이 이어서 로그인 상태를 쓴다
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
    for (const id of [taskId, seriesId, series2Id].filter(Boolean)) {
      for (const t of ['task_comments', 'task_reviewers', 'task_status_history', 'task_attachments']) {
        await q(`DELETE FROM ${t} WHERE task_id=?`, [id]).catch(() => null);
      }
      await q('DELETE FROM tasks WHERE recurrence_parent_id=?', [id]).catch(() => null);
      await q('DELETE FROM tasks WHERE id=?', [id]).catch(() => null);
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
