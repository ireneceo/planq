// canary-event-notify — #462 일정 알림 선택 (2026-10-07)
//
//   김미정(#462): "일정 추가할 때 참여자에게 알림 보낼지 말지 선택 안하고 다 가는 거야? 시간 수정할 땐 어떻게 되는 건데?"
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 등록 창에서 참석자를 고르면 «참석자 N명에게 알림 보내기» 체크가 **보이고** 기본 켜짐 · 메시지 칸이 보인다
//     ② 일정 상세에서 장소를 바꾸면 «변경 알림을 보낼까요?» 창이 뜨고 받는 사람 이름 = 서버 notify-recipients
//     ③ [알리지 않고 저장] → 장소는 저장 · 알림 0건(음성)
//     ④ 다시 바꾸고 [알리고 저장] → 참석자에게 «일정 변경» 알림 1건(양성 대조군 — ③의 0이 못 잰 0이 아님)
//   ★ 만든 일정·임시 멤버는 판정 뒤 지운다.
const b = require('./lib/browser');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:3003';
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const call = async (uid, path, opt = {}) => {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(uid), ...(opt.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body };
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + Math.min(8, r.height / 2));
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 && !!h && (h === el || el.contains(h) || h.contains(el)), text: (el.closest('label') || el).textContent.slice(0, 200) };
}, sel);
const changeNotes = (uid, evId, since) => sql("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND entity_type='calendar_event' AND entity_id=? AND created_at>=? AND title LIKE '%일정 변경%'", [uid, evId, since]).then((r) => Number(r[0].n));

async function setLocation(page, value) {
  // 상세의 장소 입력(자동저장 — blur 로 저장)
  await page.evaluate((v) => {
    const el = document.querySelector('[data-testid="event-location-input"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await sleep(200);
  await page.evaluate(() => { const el = document.activeElement; if (el) el.blur(); });
}

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const st = { events: [], users: [] };
  let browser = null;
  try {
    const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
    const biz = owner.biz;
    const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1').then((x) => [x]);
    const stamp = Date.now();
    const NAME = `알림카나리${String(stamp).slice(-5)}`;
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, active_business_id, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [`evnot-${stamp}@test.planq.kr`, await bcrypt.hash('EvNot2026!', 4), NAME, `evnot${stamp}`, biz, ps[0]?.terms_version || '1.0', ps[0]?.privacy_version || '1.0'] });
    st.users.push(uid);
    await sql('INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, \'member\', NOW(), NOW(), NOW())', [biz, uid]);

    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        // ① 등록 창 — 참석자 고르기 → 체크·메시지 칸
        await b.goto(page, '/calendar');
        await b.dismissBlockers(page);
        await sleep(800);
        await page.evaluate(() => document.querySelector('[data-testid="calendar-new-event"]')?.click());
        await sleep(1000);
        const typed = await page.evaluate(() => {
          const lab = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === '참석자');
          const field = lab && lab.parentElement;
          const inp = field && field.querySelector('input');
          if (!inp) return false;
          inp.scrollIntoView({ block: 'center' }); inp.focus(); return true;
        });
        if (typed) { await page.keyboard.type(NAME, { delay: 20 }); await sleep(700); await page.keyboard.press('Enter'); await sleep(500); }
        const chk = await visible(page, '[data-testid="new-event-notify-attendees"]');
        const state = await page.evaluate(() => ({
          checked: !!document.querySelector('[data-testid="new-event-notify-attendees"]')?.checked,
          msg: !!document.querySelector('[data-testid="new-event-notify-message"]'),
        }));
        push(`${v.key} · ① 등록 창 «참석자 1명에게 알림 보내기» 보임·기본 켜짐·메시지 칸`, typed && chk.vis && state.checked && state.msg && /1명/.test(chk.text || ''), JSON.stringify({ typed, chk, state }));
        await page.keyboard.press('Escape'); await sleep(400);

        // ②③④ 상세 — 장소 변경 → 묻는 창
        const s = new Date(Date.now() + 2 * 86400000); s.setMinutes(0, 0, 0);
        const cr = await call(owner.id, `/api/calendar/by-business/${biz}`, { method: 'POST', body: JSON.stringify({
          title: `알림카나리 ${v.key} ${stamp}`, start_at: s.toISOString(), end_at: new Date(+s + 3600000).toISOString(), category: 'meeting', visibility: 'business',
          attendees: [{ user_id: uid }], notify: { send: false },
        }) });
        const evId = cr.body?.data?.id; if (evId) st.events.push(evId);
        const since = new Date(Date.now() - 1000);
        await b.goto(page, `/calendar?event=${evId}`);
        await b.dismissBlockers(page);
        await sleep(1500);
        await setLocation(page, `A동 ${stamp}`);
        let dlg = null;
        for (let i = 0; i < 12; i++) { await sleep(400); dlg = await visible(page, '[data-testid="event-change-notify"]'); if (dlg.vis) break; }
        const rr = await call(owner.id, `/api/calendar/by-business/${biz}/${evId}/notify-recipients`, { method: 'POST' });
        const nm = (rr.body?.data?.names || [])[0];
        push(`${v.key} · ② 장소 변경 → «변경 알림을 보낼까요?» · 이름 = 서버(${nm})`, !!dlg?.vis && !!nm && (dlg.text || '').includes(nm), JSON.stringify(dlg));
        await page.evaluate(() => document.querySelector('[data-testid="event-change-notify-skip"]')?.click());
        await sleep(1500);
        const [row1] = await sql('SELECT location FROM calendar_events WHERE id=?', [evId]);
        const n3 = await changeNotes(uid, evId, since);
        push(`${v.key} · ③ [알리지 않고 저장] → 저장됨 · 알림 0`, row1?.location === `A동 ${stamp}` && n3 === 0, JSON.stringify({ loc: row1?.location, n3 }));
        // ④ 양성 대조군
        await setLocation(page, `B동 ${stamp}`);
        for (let i = 0; i < 12; i++) { await sleep(400); dlg = await visible(page, '[data-testid="event-change-notify"]'); if (dlg.vis) break; }
        await page.evaluate(() => document.querySelector('[data-testid="event-change-notify-send"]')?.click());
        let n4 = 0;
        for (let i = 0; i < 12; i++) { await sleep(500); n4 = await changeNotes(uid, evId, since); if (n4 > 0) break; }
        const [row2] = await sql('SELECT location FROM calendar_events WHERE id=?', [evId]);
        push(`${v.key} · ④ [알리고 저장] → «일정 변경» 알림 1건(양성 대조군)`, n4 === 1 && row2?.location === `B동 ${stamp}`, JSON.stringify({ n4, loc: row2?.location }));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of st.events) {
      await sql("DELETE FROM notifications WHERE entity_type='calendar_event' AND entity_id=?", [id]).catch(() => {});
      await sql('DELETE FROM calendar_event_attendees WHERE event_id=?', [id]).catch(() => {});
      await sql('DELETE FROM calendar_events WHERE id=?', [id]).catch(() => {});
    }
    for (const id of st.users) {
      await sql('DELETE FROM notifications WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM refresh_tokens WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM business_members WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM users WHERE id=?', [id]).catch(() => {});
    }
  }
  return results;
}

module.exports = { name: '일정 알림 선택 (#462) — 등록 체크·변경 확인창·알리지 않음 0·알리기 1', run };
