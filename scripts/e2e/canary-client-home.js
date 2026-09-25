// scripts/e2e/canary-client-home.js — **로그인 고객 홈** `/home` (CLIENT_ENTRY P3)
//
//   docs/CLIENT_ENTRY_DESIGN.md §4.7 · §5 P3
//
// 재는 것:
//   서버 — 고객만 200(멤버·남의 워크스페이스 403) · 응답 화이트리스트 · 계정 고객 예약(같은 함수) →
//          팀 승인 → «내 문의» 확정 + **고객 앱 알림 1건**(팀이 바꾼 것만 알린다)
//   화면 — 고객 로그인 착지가 /home · 3폭 탭 가시성 · 사이드바 «홈» · 예약 끝까지(데스크탑)
//   음성 대조 — 오너가 /home 을 열면 /dashboard 로 간다 · 예약을 끄면 탭이 없다
//
// ★ 임시 고객 계정은 Node 에서 만든다(약관 **버전까지** 채운다 — 안 채우면 재동의 모달이 «열린 것처럼» 위조한다).
// ★ 정리는 판정 항목이다. 설정 원복은 finally 맨 앞 별도 단계(canary-booking 과 같은 이유).
const { launch, login, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const VIEWPORTS = [
  { w: 375, h: 740, mobile: true },
  { w: 768, h: 1024, mobile: false },
  { w: 1440, h: 900, mobile: false },
];
const HOME_KEYS = 'client,conversation,entry,projects_count,workspace';

let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}
async function loginToken(email, password) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  return j.data && (j.data.token || j.data.accessToken);
}
async function call(tok, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}
async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false };
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 12), r.top + r.height / 2);
    return { ok: !!hit && (el === hit || el.contains(hit)), w: Math.round(r.width), h: Math.round(r.height),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, sel);
}
async function click(page, sel) {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await page.click(sel);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const unmeasured = (name, msg) => results.push({ name, unmeasured: true, details: [`⚪ ${msg}`] });
  const st = { biz: null, perms: undefined, uid: null, clientId: null, events: [] };
  const cred = { email: `clienthome-canary-${Date.now()}@example.com`, password: 'ClientHome2026!x' };
  let browser = null;

  try {
    const ownerTok = await loginToken(CREDS.email, CREDS.password);
    const me = await call(ownerTok, '/api/auth/me');
    st.biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    if (!st.biz) { unmeasured('고객 홈 픽스처', '워크스페이스 없음'); return results; }
    const [bz] = await sql('SELECT permissions FROM businesses WHERE id=?', [st.biz]);
    st.perms = bz.permissions;

    // ── 픽스처: 임시 고객 계정 + 고객 행 + 예약 켜기
    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [uidRow] = await _seq.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, email_verified_at, active_business_id,
         terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, 'ClientHome Canary', ?, 'user', NOW(), ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `chc${Date.now()}`, st.biz, ps?.terms_version || '1.0', ps?.privacy_version || '1.0'] });
    st.uid = uidRow;
    const [cid] = await _seq.query(
      `INSERT INTO clients (business_id, user_id, display_name, invite_email, kind, status, created_at, updated_at)
       VALUES (?, ?, '홈검사 고객', ?, 'customer', 'active', NOW(), NOW())`,
      { replacements: [st.biz, st.uid, cred.email] });
    st.clientId = cid;
    await call(ownerTok, `/api/businesses/${st.biz}/customer-entry`, { method: 'PUT',
      body: JSON.stringify({ booking: { enabled: true, duration: 30, lead_hours: 0, daily_max: 4 } }) });

    const cTok = await loginToken(cred.email, cred.password);
    if (!cTok) { unmeasured('고객 홈', '임시 고객 로그인 실패'); return results; }

    // ── 서버
    const h = await call(cTok, `/api/client-home/${st.biz}`);
    const keys = Object.keys(h.body?.data || {}).sort().join(',');
    push('서버: 고객 홈 200 · 키 화이트리스트', h.status === 200 && keys === HOME_KEYS, `${h.status} ${keys}`);
    push('서버: 응답에 멤버 id·이메일 원문 없음', !/"user_id"|"business_id"|"owner/.test(h.text), '');
    const mem = await call(ownerTok, `/api/client-home/${st.biz}`);
    push('서버: 멤버(오너)는 403 — 고객 문이 아니다', mem.status === 403, String(mem.status));
    const other = await call(cTok, `/api/client-home/${st.biz === 1 ? 2 : 1}`);
    push('서버: 남의 워크스페이스 403', other.status === 403, String(other.status));
    const sl = await call(cTok, `/api/client-home/${st.biz}/booking/slots`);
    const slots = sl.body?.data?.slots || [];
    push('서버: 계정 고객 슬롯 200', sl.status === 200 && slots.length > 0, `${sl.status} n=${slots.length}`);
    const rq = await call(cTok, `/api/client-home/${st.biz}/booking`, { method: 'POST', body: JSON.stringify({ start: slots[0], purpose: 'quote' }) });
    const evId = rq.body?.data?.id;
    if (evId) st.events.push(evId);
    const cl = await sql('SELECT COUNT(*) n FROM clients WHERE business_id=? AND invite_email=?', [st.biz, cred.email]);
    push('서버: 계정 고객 신청 201 · 고객 행 추가 없음(자기 행 사용)', rq.status === 201 && Number(cl[0].n) === 1, `${rq.status} clients=${cl[0].n}`);
    const ap = await call(ownerTok, `/api/calendar/booking/${st.biz}/${evId}/approve`, { method: 'POST', body: '{}' });
    await sleep(1500);
    const mine = await call(cTok, `/api/client-home/${st.biz}/booking/mine`);
    const row = (mine.body?.data || []).find((x) => x.id === evId);
    const notes = await sql("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND created_at > NOW() - INTERVAL 5 MINUTE", [st.uid]);
    push('서버: 팀 승인 → 고객 «내 문의» 확정 + 고객 앱 알림 1건', ap.status === 200 && row?.status === 'confirmed' && Number(notes[0].n) >= 1,
      `approve=${ap.status} mine=${row?.status} notes=${notes[0].n}`);
    // ★ 팀 동작 1회 = 고객 메일 **정확히 1통** (Fable FAIL D1 — 앱 알림이 메일 채널까지 태워 2통이었다)
    const mailsApprove = await sql("SELECT template FROM email_logs WHERE to_email=? AND created_at > NOW() - INTERVAL 5 MINUTE", [cred.email]);
    const confirmMails = mailsApprove.filter((m) => m.template === 'guest_booking_confirmed').length;
    const notifyMails = mailsApprove.filter((m) => /^notify/.test(m.template || '')).length;
    push('서버: 팀 승인 → 고객 메일 정확히 1통(확정 안내) · 알림 메일 0', confirmMails === 1 && notifyMails === 0,
      JSON.stringify(mailsApprove.map((m) => m.template)));
    // ★ 계정 고객이 제안을 수락하면 담당에게 알림 (Fable FAIL D2 — via==='guest' 일 때만 보냈다)
    const sl2 = (await call(cTok, `/api/client-home/${st.biz}/booking/slots`)).body?.data?.slots || [];
    const rq2 = await call(cTok, `/api/client-home/${st.biz}/booking`, { method: 'POST', body: JSON.stringify({ start: sl2[0], purpose: 'other' }) });
    const ev2 = rq2.body?.data?.id;
    if (ev2) st.events.push(ev2);
    const future = new Date(Date.now() + 6 * 86400000); future.setUTCMinutes(0, 0, 0);
    await call(ownerTok, `/api/calendar/booking/${st.biz}/${ev2}/propose`, { method: 'POST', body: JSON.stringify({ start: future.toISOString() }) });
    const ownerId = me.body?.data?.id ?? me.body?.data?.user?.id;
    const [nb] = await sql('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND created_at > NOW() - INTERVAL 10 MINUTE', [ownerId]);
    const acc = await call(cTok, `/api/client-home/${st.biz}/booking/${ev2}/accept`, { method: 'POST', body: '{}' });
    await sleep(1200);
    const [na] = await sql('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND created_at > NOW() - INTERVAL 10 MINUTE', [ownerId]);
    push('서버: 계정 고객 수락 → 담당(오너)에게 알림 1건', acc.status === 200 && Number(na.n) - Number(nb.n) === 1,
      `accept=${acc.status} owner notes ${nb.n}→${na.n}`);
    const rc = await call(ownerTok, `/api/calendar/booking/${st.biz}/${evId}/recipient`);
    push('서버: 받는 주소 = 고객 계정 이메일(게스트 링크 없음)', rc.body?.data?.email === cred.email, JSON.stringify(rc.body?.data));

    // ── 화면
    ({ browser } = await launch());
    {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 45000 });
        // 로그인 칸은 autoComplete 로 찾는다(type="text" 라 email 선택자가 안 맞는다).
        await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });
        await page.type('input[autocomplete="username"]', cred.email);
        await page.type('input[autocomplete="current-password"]', cred.password);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => /\/(home|dashboard)/.test(location.pathname), { timeout: 20000 }).catch(() => null);
        const path = await page.evaluate(() => location.pathname);
        push('화면: 고객 로그인 착지 = /home', path === '/home', path);
      } finally { await page.close().catch(() => {}); }
    }
    for (const vp of VIEWPORTS) {
      const ctxV = await browser.createBrowserContext();
      const page = await ctxV.newPage();
      try {
        await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
        await login(page, cred);
        await page.goto(`${BASE}/home`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="home-tab-book"]', { timeout: 15000 }).catch(() => null);
        const tabs = {};
        for (const k of ['home-tab-info', 'home-tab-book', 'home-tab-mine', 'home-go-projects', 'home-go-bills']) tabs[k] = await visible(page, `[data-testid="${k}"]`);
        const ok = Object.values(tabs).every((v) => v && v.ok) && !tabs['home-tab-info'].hscroll;
        push(`화면@${vp.w}: 홈 탭 5개가 보이고 가로 넘침 없음`, ok, JSON.stringify(Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v && v.ok]))));
        if (vp.w === 1440) {
          const nav = await visible(page, '[data-testid="nav-home"]');
          push('화면@1440: 사이드바 «홈» 이 보인다', !!nav?.ok, JSON.stringify(nav));
          // 예약 끝까지
          await click(page, '[data-testid="home-tab-book"]');
          await click(page, '[data-testid="entry-book-purpose-new_project"]');
          await click(page, '[data-testid="entry-book-next1"]');
          await page.waitForSelector('[data-testid="entry-book-slots"] button', { timeout: 15000 });
          await click(page, '[data-testid="entry-book-slots"] button');
          await click(page, '[data-testid="entry-book-next2"]');
          await click(page, '[data-testid="entry-book-submit"]');
          await page.waitForSelector('[data-testid="entry-book-sent"]', { timeout: 15000 }).catch(() => null);
          const sent = await visible(page, '[data-testid="entry-book-sent"]');
          const rows = await sql(`SELECT e.id FROM calendar_events e JOIN calendar_event_attendees a ON a.event_id=e.id
            WHERE a.client_id=? AND e.booking_status='requested'`, [st.clientId]);
          rows.forEach((r) => st.events.push(r.id));
          push('화면: 홈에서 예약 신청 → 보냄 + 일정 requested 1건', !!sent?.ok && rows.length === 1, `sent=${!!sent?.ok} rows=${rows.length}`);
          await click(page, '[data-testid="entry-book-go-mine"]');
          await page.waitForSelector('[data-testid="entry-mine-bookings"]', { timeout: 15000 }).catch(() => null);
          const n = await page.$$eval('[data-testid^="entry-booking-"][data-status]', (els) => els.length).catch(() => 0);
          push('화면: «내 문의» 에 세 건(확정 2 · 대기 1)', n === 3, `n=${n}`);
        }
      } finally { await page.close().catch(() => {}); await ctxV.close().catch(() => {}); }
    }
    // 음성 대조 ① — 오너는 /dashboard 로. ★ 새 컨텍스트 — 앞의 고객 세션(쿠키·탭 상태)과 섞이면
    //   오너로 로그인해도 고객 홈이 그려진다(실측: 같은 컨텍스트에서 home:true). 신원마다 컨텍스트를 가른다.
    {
      const ctx1 = await browser.createBrowserContext();
      const page = await ctx1.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await login(page);
        await page.goto(`${BASE}/home`, { waitUntil: 'networkidle2', timeout: 45000 });
        // ★ 창 주소만 보지 않는다 — 탭 모드는 탭 안 라우터가 이동하고, 같은 브라우저의 앞선 고객 세션 탭 상태가
        //   남아 있으면 주소 갱신이 늦다(1.5초 판정에서 거짓 실패). **화면 내용**으로 기다렸다가 잰다.
        await page.waitForFunction(() => location.pathname === '/dashboard'
          || Array.from(document.querySelectorAll('[data-testid="page-header"]')).some((e) => /대시보드|Dashboard/.test(e.textContent || '')),
        { timeout: 15000 }).catch(() => null);
        const r = await page.evaluate(() => ({ path: location.pathname, home: !!document.querySelector('[data-testid="client-home"]') }));
        push('음성 대조: 오너가 /home 을 열면 고객 홈이 아니라 대시보드', !r.home && r.path === '/dashboard', JSON.stringify(r));
      } finally { await page.close().catch(() => {}); await ctx1.close().catch(() => {}); }
    }
    // 음성 대조 ② — 예약을 끄면 탭이 없다
    //   ★ **새 브라우저 컨텍스트**에서 연다 — 같은 컨텍스트는 localStorage(탭 상태)를 공유해서, 바로 앞
    //     오너 세션의 탭(대시보드)이 되살아나 고객 홈이 아예 안 그려진다(실측: info=false).
    await call(ownerTok, `/api/businesses/${st.biz}/customer-entry`, { method: 'PUT', body: JSON.stringify({ booking: { enabled: false } }) });
    {
      const ctx2 = await browser.createBrowserContext();
      const page = await ctx2.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await login(page, cred);
        await page.goto(`${BASE}/home?tab=book`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="home-tab-info"]', { timeout: 15000 }).catch(() => null);
        const hasTab = !!(await page.$('[data-testid="home-tab-book"]'));
        const info = !!(await page.$('[data-testid="home-body-info"]'));
        push('음성 대조: 예약을 끄면 탭이 없고 ?tab=book 은 안내로', !hasTab && info, `tab=${hasTab} info=${info}`);
      } finally { await page.close().catch(() => {}); await ctx2.close().catch(() => {}); }
    }
  } catch (e) {
    push('고객 홈 검사 실행', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (st.biz && st.perms !== undefined) await sql('UPDATE businesses SET permissions=? WHERE id=?', [JSON.stringify(st.perms), st.biz]);
    } catch (e) { results.push({ name: 'cleanup:clienthome-perms', fail: 1, details: [`🔴 ${e.message}`] }); }
    try {
      const evs = st.clientId ? (await sql('SELECT DISTINCT event_id FROM calendar_event_attendees WHERE client_id=?', [st.clientId])).map((r) => r.event_id) : [];
      if (evs.length) {
        await sql('DELETE FROM client_interactions WHERE calendar_event_id IN (?)', [evs]);
        await sql('DELETE FROM calendar_event_gcal_links WHERE event_id IN (?)', [evs]).catch(() => null);
        await sql('DELETE FROM calendar_event_attendees WHERE event_id IN (?)', [evs]);
        await sql('DELETE FROM calendar_events WHERE id IN (?)', [evs]);
      }
      if (st.clientId) {
        await sql('DELETE FROM client_stage_history WHERE client_id=?', [st.clientId]);
        await sql('DELETE FROM clients WHERE id=?', [st.clientId]);
      }
      if (st.uid) {
        await sql('DELETE FROM notifications WHERE user_id=?', [st.uid]);
        await sql('DELETE FROM refresh_tokens WHERE user_id=?', [st.uid]).catch(() => null);
        await sql('DELETE FROM users WHERE id=?', [st.uid]);
      }
      await sql('DELETE FROM email_logs WHERE to_email=?', [cred.email]).catch(() => null);
      const left = st.uid ? (await sql('SELECT COUNT(*) n FROM users WHERE id=?', [st.uid]))[0].n : 0;
      const leftC = st.clientId ? (await sql('SELECT COUNT(*) n FROM clients WHERE id=?', [st.clientId]))[0].n : 0;
      results.push({ name: 'cleanup:clienthome', fail: Number(left) || Number(leftC) ? 1 : 0, hasCanary: true,
        details: [`일정 ${evs.length} · 고객 · 계정 삭제 · 남음 계정 ${left} 고객 ${leftC} · 설정 원복`] });
    } catch (e) { results.push({ name: 'cleanup:clienthome', fail: 1, details: [`🔴 정리 실패: ${e.message}`] }); }
  }
  return results;
}

module.exports = { run };
