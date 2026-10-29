// canary-event-place-search — 일정 «위치» 칸 장소 자동완성 (2026-10-29, Fable 설계 D4·D5·D6)
//
//   Irene: "일정에서 주소를 넣는 곳에 검색되게 못해? 구글처럼 일정에 주소검색되서 입력되면 좋겠다."
//
//   서버(/api/places/search) 응답은 요청 가로채기로 고정 후보를 준다 — 카카오 키 유무와 무관하게 화면 계약만 잰다.
//   (서버 쪽 키 없음·오류·한도는 실 HTTP 로 따로 잰다.)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 새 일정: 치면 후보 목록이 칸 아래 화면 안에 실제로 그려진다(elementFromPoint)
//     ② ↓ + Enter → «이름, 도로명주소» 가 들어가고 창은 제출되지 않는다 · 만들면 DB 위치 = 그 줄
//     ③ 업무 일정 상세: 후보가 열린 채 2.6초 → 저장(PUT) 0건(hold)
//     ④ 후보를 누르면 → PUT 정확히 1건 · DB 위치 = 고른 줄
//     ⑤ 양성 대조군: 후보가 없는 글자를 치고 2.6초 → PUT 1건(③ 의 0건이 hold 덕분임을 보인다)
//     ⑥ 후보가 열린 채 상세를 닫으면 친 글자가 저장된다(떠날 때 확정 저장은 hold 를 무시)
//   ★ 만든 일정은 판정 뒤 지운다.
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const API = process.env.E2E_API || 'http://localhost:3003';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];
const T = (id) => `[data-testid="${id}"]`;
const FIX = [
  { id: '1', name: '스타벅스 강남역점', road_address: '서울 강남구 강남대로 390', address: '서울 강남구 역삼동 825', provider: 'kakao' },
  { id: '2', name: '스타벅스 강남R점', road_address: '서울 강남구 강남대로 396', address: '서울 강남구 역삼동 826', provider: 'kakao' },
];
const LINE1 = '스타벅스 강남역점, 서울 강남구 강남대로 390';
const LINE2 = '스타벅스 강남R점, 서울 강남구 강남대로 396';

async function apiLogin() {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) });
  const j = await r.json();
  return { tok: j.data.token || j.data.accessToken, biz: j.data.user.active_business_id || j.data.user.business_id };
}
async function createEvent(auth, title) {
  const start = new Date(Date.now() + 86400000); start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const r = await fetch(`${API}/api/calendar/by-business/${auth.biz}`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth.tok}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(auth.biz) },
    body: JSON.stringify({ title, start_at: start.toISOString(), end_at: end.toISOString(), all_day: false }),
  });
  const j = await r.json();
  return { id: j.data?.id, date: start.toISOString().slice(0, 10) };
}
// 후보 목록이 실제로 보이고 화면 안에 있는가
const listVisible = (page) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { ok: false, why: 'none' };
  const r = el.getBoundingClientRect();
  const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
  const item = el.querySelector('[role="option"]');
  const ir = item?.getBoundingClientRect();
  const h = ir ? document.elementFromPoint(ir.left + 10, ir.top + ir.height / 2) : null;
  return { ok: r.width > 0 && r.height > 0 && inView && !!h && item.contains(h), rect: [r.left, r.top, r.right, r.bottom].map(Math.round) };
}, T('event-location-suggestions'));
async function typeInto(page, sel, text) {
  await page.evaluate((s) => { const el = document.querySelector(s); el?.scrollIntoView({ block: 'center' }); el?.focus(); }, sel);
  await page.keyboard.type(text, { delay: 10 });
}
async function waitList(page) { for (let i = 0; i < 20; i++) { await sleep(150); if (await page.$(T('event-location-suggestions'))) return true; } return false; }
const locOf = async (id) => (await sql('SELECT location FROM calendar_events WHERE id=?', [id]))[0]?.location ?? null;

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const titles = [];
  let browser = null;
  try {
    const auth = await apiLogin();
    browser = (await b.launch()).browser;
    const stamp = Date.now();
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const puts = [];
      let curEvent = null;
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const u = req.url();
          if (u.includes('/api/places/search')) {
            const q = decodeURIComponent((u.split('q=')[1] || '').replace(/\+/g, ' '));
            const data = q.includes('스타') ? FIX : [];
            return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
          }
          if (req.method() === 'PUT' && curEvent && u.includes(`/${curEvent}`) && u.includes('/api/calendar')) puts.push(u);
          return req.continue();
        });
        await b.login(page);

        // ①② 새 일정
        await b.goto(page, '/calendar');
        await b.dismissBlockers(page);
        await sleep(800);
        await page.evaluate((s) => document.querySelector(s)?.click(), T('calendar-new-event'));
        for (let i = 0; i < 15; i++) { await sleep(300); if (await page.$(T('new-event-location'))) break; }
        const title = `[장소검색카나리] ${v.key} ${stamp}`; titles.push(title);
        await typeInto(page, T('new-event-title'), title);
        await typeInto(page, T('new-event-location'), '스타벅');
        await waitList(page);
        const lv = await listVisible(page);
        push(`${v.key} · ① 새 일정: 후보 목록이 칸 아래 화면 안에 그려짐`, lv.ok, JSON.stringify(lv));
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await sleep(400);
        const st = await page.evaluate((s) => ({ val: document.querySelector(s)?.value, modal: !!document.querySelector('[data-testid="calendar-new-submit"]'), list: !!document.querySelector('[data-testid="event-location-suggestions"]') }), T('new-event-location'));
        await page.evaluate((s) => document.querySelector(s)?.click(), T('calendar-new-submit'));
        let row = null;
        for (let i = 0; i < 15 && !row; i++) { await sleep(400); [row] = await sql('SELECT id, location FROM calendar_events WHERE title=? ORDER BY id DESC LIMIT 1', [title]); }
        push(`${v.key} · ② ↓+Enter → «이름, 도로명주소» · 창 그대로(제출 안 됨) · 만들면 DB 위치 일치`,
          st.val === LINE1 && st.modal && !st.list && row?.location === LINE1, JSON.stringify({ st, row }));

        // ③④⑤⑥ 업무 일정 상세
        const ev = await createEvent(auth, `[장소검색카나리] 상세 ${v.key} ${stamp}`); titles.push(`[장소검색카나리] 상세 ${v.key} ${stamp}`);
        curEvent = ev.id;
        await b.goto(page, `/calendar?date=${ev.date}&event=${ev.id}`);
        await b.dismissBlockers(page);
        for (let i = 0; i < 20; i++) { await sleep(300); if (await page.$(T('event-location-input'))) break; }
        await typeInto(page, T('event-location-input'), '스타벅');
        const opened = await waitList(page);
        const lv2 = await listVisible(page);
        await sleep(2600);
        push(`${v.key} · ③ 상세: 후보 열린 채 2.6초 → 저장 0건(반쪽 입력 안 감)`, opened && lv2.ok && puts.length === 0 && (await locOf(ev.id)) === null, JSON.stringify({ lv2, puts: puts.length }));
        await page.evaluate(() => {
          const items = document.querySelectorAll('[data-testid="event-location-suggestion"]');
          const it = items[1]; if (!it) return;
          it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        });
        await sleep(2500);
        const loc4 = await locOf(ev.id);
        push(`${v.key} · ④ 후보 누름 → 저장 정확히 1건 · DB 위치 = 고른 줄`, puts.length === 1 && loc4 === LINE2, JSON.stringify({ puts: puts.length, loc4 }));

        // ⑤ 양성 대조군 — 후보 없는 글자
        puts.length = 0;
        await page.evaluate((s) => { const el = document.querySelector(s); el.focus(); el.select(); }, T('event-location-input'));
        await page.keyboard.type('3층 회의실', { delay: 10 });
        await sleep(2900);
        const loc5 = await locOf(ev.id);
        push(`${v.key} · ⑤ 대조군: 후보 없는 글자 → 2초 뒤 저장 1건(③ 의 0건은 hold 덕분)`, puts.length === 1 && loc5 === '3층 회의실', JSON.stringify({ puts: puts.length, loc5 }));

        // ⑥ 후보 열린 채 닫기
        puts.length = 0;
        await page.evaluate((s) => { const el = document.querySelector(s); el.focus(); el.select(); }, T('event-location-input'));
        await page.keyboard.type('스타벅', { delay: 10 });
        await waitList(page);
        await page.evaluate(() => {
          const btn = document.querySelector('[data-pq-drawer-panel] button[aria-label="close"]') || document.querySelector('button[aria-label="close"]');
          btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await sleep(2500);
        const loc6 = await locOf(ev.id);
        push(`${v.key} · ⑥ 후보 열린 채 상세 닫기 → 친 글자 저장(떠날 때 확정 저장)`, loc6 === '스타벅', JSON.stringify({ puts: puts.length, loc6 }));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const title of titles) {
      const rows = await sql('SELECT id FROM calendar_events WHERE title=?', [title]).catch(() => []);
      for (const { id } of rows) {
        await sql("DELETE FROM notifications WHERE entity_type='calendar_event' AND entity_id=?", [id]).catch(() => {});
        await sql('DELETE FROM calendar_event_attendees WHERE event_id=?', [id]).catch(() => {});
        await sql('DELETE FROM calendar_events WHERE id=?', [id]).catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { name: '일정 위치 장소 자동완성 — 3폭 목록 보임·고르기·저장 보류(hold)·대조군·닫을 때 저장', run };
