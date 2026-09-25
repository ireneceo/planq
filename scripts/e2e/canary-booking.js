// scripts/e2e/canary-booking.js — 고객 창구 **상담 예약**(CLIENT_ENTRY P2)이 화면에서 끝까지 되는가
//
//   docs/CLIENT_ENTRY_DESIGN.md §4.3 · §4.4 · §4.5
//
// 서버 판정(슬롯 모양·상태 전이·한도·중복 고객·끝남 원장)은 실 HTTP 검사로 따로 잰다. 여기서 재는 것은
// **그 문이 화면에서 열리고 닫히는가**다:
//   ① 방문자: 예약 탭이 보인다(3폭) → 용건 → 시간 → 확인 → 보냄 → «내 문의» 에 «확인 대기»
//   ② 팀: 일정 상세에 처리 줄 → [승인] → 확인창이 **받는 주소**를 말한다 → 확정으로 바뀐다
//   ③ 방문자: «내 문의» 가 «확정» 으로 바뀐다
//   ④ 설정 카드에 예약 설정이 보인다(3폭)
//   ⑤ 음성 대조: 예약을 끄면 탭이 **없다**
//
// ★ 픽스처는 **Node 에서** 만든다(page.evaluate 안에서 만들면 하니스가 죽는다 — memory
//   feedback_fixture_inside_browser_kills_harness). 방문자 확인은 OTP 해시를 심고 정상 확인 흐름을 지난다.
// ★ 잔여는 판정 항목이다(cleanup:*) — 남으면 다음 실행의 슬롯이 줄어 거짓 실패가 난다.
const crypto = require('crypto');
const { launch, login, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const VIEWPORTS = [
  { w: 375, h: 740, mobile: true },
  { w: 768, h: 1024, mobile: false },
  { w: 1440, h: 900, mobile: false },
];

let _tok = null;
async function api(path, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
    });
    const j = await r.json().catch(() => ({}));
    _tok = j.data && (j.data.token || j.data.accessToken);
  }
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body };
}
async function pub(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}
let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}

/** 요소가 **보이는가** — 크기 + 그 좌표가 자기 자신인가(조상 클리핑·덮개). */
async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, w: r.width, h: r.height };
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 12), r.top + r.height / 2);
    return { ok: !!hit && (el === hit || el.contains(hit)), w: Math.round(r.width), h: Math.round(r.height),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, sel);
}
async function click(page, sel) {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); }, sel);
  await page.click(sel);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const unmeasured = (name, msg) => results.push({ name, unmeasured: true, details: [`⚪ ${msg}`] });
  const cleanup = { links: [], entryIssued: null, emails: [], permsBefore: undefined, biz: null };
  let browser = null;

  try {
    const me = await api('/api/auth/me');
    const biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    if (!biz) { unmeasured('예약 픽스처', '워크스페이스 없음'); return results; }
    cleanup.biz = biz;
    const [bz] = await sql('SELECT permissions FROM businesses WHERE id=?', [biz]);
    cleanup.permsBefore = bz.permissions;

    // ── 픽스처: 예약 켜기(리드 0) · 창구 · 확인된 방문자
    const on = await api(`/api/businesses/${biz}/customer-entry`, { method: 'PUT',
      body: JSON.stringify({ booking: { enabled: true, duration: 30, lead_hours: 0, daily_max: 4 } }) });
    if (on.status !== 200) { unmeasured('예약 픽스처', `예약 켜기 ${on.status}`); return results; }
    const li = await api(`/api/businesses/${biz}/customer-entry/link`, { method: 'POST', body: '{}' });
    if (!li.body?.data?.url) { unmeasured('예약 픽스처', `창구 발급 ${li.status}`); return results; }
    if (li.status === 201) cleanup.entryIssued = li.body.data.id;
    const entry = li.body.data.url.split('/g/')[1];
    const mail = `bk-canary-${Date.now()}@example.com`;
    cleanup.emails.push(mail);
    await pub(`/api/guest/${entry}/notify/request`, { method: 'POST',
      body: JSON.stringify({ name: '예약검사', email: mail, consent: true, locale: 'ko' }) });
    const kid = await sql('SELECT id FROM guest_links WHERE contact_email=? ORDER BY id DESC LIMIT 1', [mail]);
    if (!kid.length) { unmeasured('예약 픽스처', '개인 링크 생성 실패'); return results; }
    cleanup.links.push(kid[0].id);
    const code = '975311';
    await sql('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0, otp_locked_until=NULL WHERE id=?',
      [crypto.createHash('sha256').update(code).digest('hex'), kid[0].id]);
    const v = await pub(`/api/guest/${entry}/notify/verify`, { method: 'POST', body: JSON.stringify({ email: mail, code }) });
    const ptok = v.body?.data?.personal_token;
    if (!ptok) { unmeasured('예약 픽스처', '확인 실패'); return results; }

    ({ browser } = await launch());

    // ── ① 방문자 — 3폭에서 탭·용건이 보인다
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
        await page.goto(`${BASE}/g/${ptok}?tab=book`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="entry-book-purpose-quote"]', { timeout: 15000 }).catch(() => null);
        const tab = await visible(page, '[data-testid="guest-tab-book"]');
        const opt = await visible(page, '[data-testid="entry-book-purpose-quote"]');
        push(`방문자@${vp.w}: 예약 탭·용건이 보인다`, !!tab?.ok && !!opt?.ok && !opt.hscroll,
          `tab=${JSON.stringify(tab)} purpose=${JSON.stringify(opt)}`);
        if (vp.w === 375) {
          await click(page, '[data-testid="entry-book-purpose-quote"]');
          await click(page, '[data-testid="entry-book-next1"]');
          await page.waitForSelector('[data-testid="entry-book-slots"] button', { timeout: 15000 }).catch(() => null);
          const slot = await visible(page, '[data-testid="entry-book-slots"] button');
          push('방문자@375: 시간 버튼이 보이고 가로 넘침 없음', !!slot?.ok && !slot.hscroll, JSON.stringify(slot));
        }
      } finally { await page.close().catch(() => {}); }
    }

    // ── 신청 끝까지 (데스크탑)
    let eventId = null;
    {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(`${BASE}/g/${ptok}?tab=book`, { waitUntil: 'networkidle2', timeout: 45000 });
        await click(page, '[data-testid="entry-book-purpose-quote"]');
        await click(page, '[data-testid="entry-book-next1"]');
        await page.waitForSelector('[data-testid="entry-book-slots"] button', { timeout: 15000 });
        await click(page, '[data-testid="entry-book-slots"] button');
        await click(page, '[data-testid="entry-book-next2"]');
        const sum = await visible(page, '[data-testid="entry-book-summary"]');
        push('방문자: 확인 단계 요약이 보인다', !!sum?.ok, JSON.stringify(sum));
        await click(page, '[data-testid="entry-book-submit"]');
        await page.waitForSelector('[data-testid="entry-book-sent"]', { timeout: 15000 }).catch(() => null);
        const sent = await visible(page, '[data-testid="entry-book-sent"]');
        const rows = await sql(`SELECT e.id, e.booking_status FROM calendar_events e JOIN calendar_event_attendees a ON a.event_id=e.id
          JOIN clients c ON c.id=a.client_id WHERE c.business_id=? AND c.invite_email=?`, [biz, mail]);
        eventId = rows[0]?.id || null;
        // ★ «보냈다» 화면만 보면 안 된다 — 실제로 한 건이 생겼는가를 DB 로 같이 잰다.
        push('방문자: [신청 보내기] → 보냄 화면 + 일정 1건 requested', !!sent?.ok && rows.length === 1 && rows[0].booking_status === 'requested',
          `sent=${!!sent?.ok} rows=${JSON.stringify(rows)}`);
        await click(page, '[data-testid="entry-book-go-mine"]');
        await page.waitForSelector(`[data-testid="entry-booking-${eventId}"]`, { timeout: 15000 }).catch(() => null);
        const st = await page.$eval(`[data-testid="entry-booking-${eventId}"]`, (el) => el.getAttribute('data-status')).catch(() => null);
        push('방문자: «내 문의» 에 확인 대기로 보인다', st === 'requested', `status=${st}`);
      } finally { await page.close().catch(() => {}); }
    }

    // ── ② 팀 — 일정 상세에서 승인. 확인창이 받는 주소를 말하는가
    if (eventId) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await login(page);
        await page.goto(`${BASE}/calendar?event=${eventId}`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="event-booking-approve"]', { timeout: 20000 }).catch(() => null);
        const bar = await visible(page, '[data-testid="event-booking-bar"]');
        push('팀: 일정 상세에 예약 처리 줄 + [승인]', !!bar?.ok && !!(await page.$('[data-testid="event-booking-approve"]')), JSON.stringify(bar));
        if (await page.$('[data-testid="event-booking-approve"]')) {
          await click(page, '[data-testid="event-booking-approve"]');
          // ★ 일정 상세 드로어도 aria-modal 이다 — 첫 것을 집으면 드로어를 읽는다(실제로 그랬다).
          //   확인창은 그 위에 뜨므로 **마지막** aria-modal 이 확인창이다.
          await page.waitForFunction((m) => {
            const all = document.querySelectorAll('[aria-modal="true"]');
            const d = all[all.length - 1];
            return all.length >= 2 && d && d.textContent.includes(m);
          }, { timeout: 10000 }, mail).catch(() => null);
          const dlg = await page.evaluate(() => {
            const all = document.querySelectorAll('[aria-modal="true"]');
            return all.length >= 2 ? (all[all.length - 1].textContent || '').slice(0, 300) : `(대화상자 ${all.length}개)`;
          });
          push('팀: 승인 확인창이 받는 주소를 적는다', dlg.includes(mail), dlg.slice(0, 120));
          // 확인 버튼 = 대화상자 안의 마지막 버튼(취소·확인 순서)
          await page.evaluate(() => {
            const all = document.querySelectorAll('[aria-modal="true"]');
            const d = all.length >= 2 ? all[all.length - 1] : null;
            const bs = d ? Array.from(d.querySelectorAll('button')) : [];
            const ok = bs[bs.length - 1];
            if (ok) ok.click();
          });
          await page.waitForFunction(() => document.querySelector('[data-testid="event-booking-bar"]')?.getAttribute('data-status') === 'confirmed',
            { timeout: 15000 }).catch(() => null);
          const st = await page.$eval('[data-testid="event-booking-bar"]', (el) => el.getAttribute('data-status')).catch(() => null);
          const [db] = await sql('SELECT booking_status FROM calendar_events WHERE id=?', [eventId]);
          push('팀: 승인 → 화면·DB 모두 확정', st === 'confirmed' && db?.booking_status === 'confirmed', `screen=${st} db=${db?.booking_status}`);
        }
      } finally { await page.close().catch(() => {}); }

      // ── ③ 방문자 — 확정으로 바뀌었는가
      const pg = await browser.newPage();
      try {
        await pg.setViewport({ width: 768, height: 1024 });
        await pg.goto(`${BASE}/g/${ptok}?tab=mine`, { waitUntil: 'networkidle2', timeout: 45000 });
        await pg.waitForSelector(`[data-testid="entry-booking-${eventId}"]`, { timeout: 15000 }).catch(() => null);
        const st = await pg.$eval(`[data-testid="entry-booking-${eventId}"]`, (el) => el.getAttribute('data-status')).catch(() => null);
        push('방문자: «내 문의» 가 확정으로 바뀐다', st === 'confirmed', `status=${st}`);
      } finally { await pg.close().catch(() => {}); }
    } else {
      unmeasured('팀 승인·방문자 확정', '신청이 만들어지지 않아 잴 수 없다');
    }

    // ── ④ 설정 카드 — 3폭
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
        await login(page);
        await page.goto(`${BASE}/business/settings/permissions`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="entry-booking-toggle"]', { timeout: 15000 }).catch(() => null);
        const tg = await visible(page, '[data-testid="entry-booking-toggle"]');
        const hr = await visible(page, '[data-testid="entry-hours-mon"]');
        const checked = await page.$eval('[data-testid="entry-booking-toggle"]', (el) => el.getAttribute('aria-checked')).catch(() => null);
        push(`설정@${vp.w}: 예약 스위치(켜짐)·근무시간이 보인다`, !!tg?.ok && !!hr?.ok && checked === 'true' && !hr.hscroll,
          `toggle=${JSON.stringify(tg)} hours=${JSON.stringify(hr)} checked=${checked}`);
      } finally { await page.close().catch(() => {}); }
    }

    // ── ⑤ 음성 대조 — 끄면 탭이 없다(같은 방문자, 같은 주소)
    await api(`/api/businesses/${biz}/customer-entry`, { method: 'PUT', body: JSON.stringify({ booking: { enabled: false } }) });
    {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(`${BASE}/g/${ptok}?tab=book`, { waitUntil: 'networkidle2', timeout: 45000 });
        await page.waitForSelector('[data-testid="guest-tab-info"]', { timeout: 15000 }).catch(() => null);
        const hasTab = !!(await page.$('[data-testid="guest-tab-book"]'));
        const infoBody = !!(await page.$('[data-testid="guest-tab-body-info"]'));
        push('음성 대조: 예약을 끄면 탭이 없고 ?tab=book 은 안내로 떨어진다', !hasTab && infoBody, `tab=${hasTab} info=${infoBody}`);
      } finally { await page.close().catch(() => {}); }
    }
  } catch (e) {
    push('예약 검사 실행', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    // ── 정리 — 자식 → 부모 순. 남으면 실패로 센다.
    try {
      const biz = cleanup.biz;
      if (biz) {
        const clientIds = cleanup.emails.length
          ? (await sql('SELECT id FROM clients WHERE business_id=? AND invite_email IN (?)', [biz, cleanup.emails])).map((r) => r.id) : [];
        const evIds = clientIds.length
          ? (await sql('SELECT DISTINCT event_id FROM calendar_event_attendees WHERE client_id IN (?)', [clientIds])).map((r) => r.event_id) : [];
        if (evIds.length) {
          await sql('DELETE FROM client_interactions WHERE calendar_event_id IN (?)', [evIds]);
          await sql('DELETE FROM calendar_event_gcal_links WHERE event_id IN (?)', [evIds]).catch(() => null);
          await sql('DELETE FROM calendar_event_attendees WHERE event_id IN (?)', [evIds]);
          await sql('DELETE FROM calendar_events WHERE id IN (?)', [evIds]);
        }
        const rooms = cleanup.links.length
          ? (await sql('SELECT conversation_id FROM guest_links WHERE id IN (?) AND conversation_id IS NOT NULL', [cleanup.links])).map((r) => r.conversation_id) : [];
        const shadows = cleanup.links.length
          ? (await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [cleanup.links])).map((r) => r.guest_user_id).filter(Boolean) : [];
        if (cleanup.links.length) await sql('DELETE FROM guest_links WHERE id IN (?)', [cleanup.links]);
        if (rooms.length) {
          await sql('DELETE FROM messages WHERE conversation_id IN (?)', [rooms]);
          await sql('DELETE FROM conversation_participants WHERE conversation_id IN (?)', [rooms]);
          await sql('DELETE FROM conversations WHERE id IN (?)', [rooms]);
        }
        if (clientIds.length) {
          await sql('DELETE FROM client_stage_history WHERE client_id IN (?)', [clientIds]);
          await sql('DELETE FROM clients WHERE id IN (?)', [clientIds]);
        }
        if (shadows.length) await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [shadows]).catch(() => null);
        if (cleanup.entryIssued) {
          await sql('DELETE FROM guest_links WHERE parent_link_id=?', [cleanup.entryIssued]);
          await sql('DELETE FROM guest_links WHERE id=?', [cleanup.entryIssued]);
        }
        if (cleanup.emails.length) await sql('DELETE FROM email_logs WHERE to_email IN (?)', [cleanup.emails]);
        if (cleanup.permsBefore !== undefined) {
          await sql('UPDATE businesses SET permissions=? WHERE id=?', [JSON.stringify(cleanup.permsBefore), biz]);
        }
        const leftC = cleanup.emails.length
          ? (await sql('SELECT COUNT(*) n FROM clients WHERE invite_email IN (?)', [cleanup.emails]))[0].n : 0;
        const leftE = evIds.length ? (await sql('SELECT COUNT(*) n FROM calendar_events WHERE id IN (?)', [evIds]))[0].n : 0;
        results.push({ name: 'cleanup:booking', fail: Number(leftC) || Number(leftE) ? 1 : 0, hasCanary: true,
          details: [`고객 ${clientIds.length} · 일정 ${evIds.length} 삭제 · 남음 고객 ${leftC} 일정 ${leftE} · 설정 원복`] });
      }
    } catch (e) {
      results.push({ name: 'cleanup:booking', fail: 1, details: [`🔴 정리 실패: ${e.message}`] });
    }
  }
  return results;
}

module.exports = { run };
