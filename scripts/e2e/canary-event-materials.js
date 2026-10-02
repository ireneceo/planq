// canary-event-materials — 일정 미팅자료(#411, 2026-10-02)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 일정 상세에 「미팅자료」 칸이 **보인다**(좌표 + elementFromPoint — 크기만 재면 잘린 것을 놓친다)
//     ② 붙인 자료 수 = 서버 수(2) · 이름이 보인다
//     ③ [+ 자료 추가] 를 누르면 고르는 칸(공용 AttachmentField 드롭존)이 열린다
//     ④ 자료를 떼면 «참석자 N명(이름)에게 알릴까요?» 줄이 뜨고, 이름은 서버 dry 와 같다
//     ⑤ [알리지 않음] 을 누르면 사라지고 **알림은 0건**(누르기 전에는 보내지 않는다 — 음성 대조군)
//     대조군: 미팅자료가 0건인 일정을 **비작성 멤버**가 열면 칸 자체가 없다
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

// testid 요소가 화면에 실제로 그려지는가
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + Math.min(8, r.height / 2));
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 && !!h && (h === el || el.contains(h)), text: el.textContent.slice(0, 200) };
}, sel);

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const st = { events: [], users: [] };
  let browser = null;
  try {
    const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
    const biz = owner.biz;
    const files = await sql('SELECT id, file_name FROM files WHERE business_id=? AND uploader_id=? AND deleted_at IS NULL AND vlevel IN (\'L3\',\'L4\') ORDER BY id DESC LIMIT 2', [biz, owner.id]);
    if (files.length < 2) { push('픽스처', false, '붙일 L3 파일 2개 없음', { unmeasured: true }); return results; }
    // 임시 멤버(참석자) — 알림 대상 이름 확인용
    const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1').then((x) => [x]);
    const stamp = Date.now();
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, active_business_id, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [`evmat-${stamp}@test.planq.kr`, await bcrypt.hash('EvMat2026!', 4), '카나리참석자', `evmat${stamp}`, biz, ps[0]?.terms_version || '1.0', ps[0]?.privacy_version || '1.0'] });
    st.users.push(uid);
    await sql('INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, \'member\', NOW(), NOW(), NOW())', [biz, uid]);

    const mk = async (title, atts) => {
      const s = new Date(Date.now() + 2 * 86400000); s.setMinutes(0, 0, 0);
      const r = await call(owner.id, `/api/calendar/by-business/${biz}`, { method: 'POST', body: JSON.stringify({
        title, start_at: s.toISOString(), end_at: new Date(+s + 3600000).toISOString(), category: 'meeting', visibility: 'business',
        attendees: [{ user_id: uid }], attachments: atts,
      }) });
      if (r.body?.data?.id) st.events.push(r.body.data.id);
      return r.body?.data?.id;
    };

    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const evId = await mk(`카나리 미팅자료 ${v.key}`, files.map((f) => ({ file_id: f.id })));
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await b.goto(page, `/calendar?event=${evId}`);
        await b.dismissBlockers(page);
        let sec = null;
        for (let i = 0; i < 12; i++) { await sleep(500); sec = await visible(page, '[data-testid="event-materials"]'); if (sec.vis) break; }
        push(`${v.key} · ① 「미팅자료」 칸이 보인다`, !!sec?.vis, JSON.stringify(sec));
        const names = await page.evaluate((fn) => {
          const box = document.querySelector('[data-testid="event-materials"]');
          return fn.map((n) => !!box && box.textContent.includes(n));
        }, files.map((f) => f.file_name));
        push(`${v.key} · ② 붙인 자료 2건 이름이 보인다`, names.every(Boolean), JSON.stringify(names));

        // ③ 추가 → 고르는 칸
        await page.evaluate(() => document.querySelector('[data-testid="event-materials-add"]')?.click());
        await sleep(600);
        const picker = await page.evaluate(() => {
          const box = document.querySelector('[data-testid="event-materials"]');
          return !!box && !!box.querySelector('input[type="file"]');
        });
        push(`${v.key} · ③ [+ 자료 추가] → 고르는 칸이 열린다`, picker, String(picker));

        // ④ 떼기 → 묻는 줄
        const since = new Date(Date.now() - 1000);
        const removed = await page.evaluate(() => {
          const box = document.querySelector('[data-testid="event-materials"]');
          const btn = box && [...box.querySelectorAll('button')].find((x) => x.textContent.trim() === '×' && !x.hasAttribute('data-attach-download'));
          if (!btn) return false;
          btn.click(); return true;
        });
        let ask = null;
        for (let i = 0; i < 12 && removed; i++) { await sleep(500); ask = await visible(page, '[data-testid="event-materials-ask"]'); if (ask.vis) break; }
        const dry = await call(owner.id, `/api/calendar/by-business/${biz}/${evId}/notify-materials`, { method: 'POST', body: JSON.stringify({ dry: true }) });
        const nm = (dry.body?.data?.names || [])[0];
        push(`${v.key} · ④ 떼면 «알릴까요?» 줄 · 이름 = 서버 dry(${nm})`, removed && !!ask?.vis && !!nm && ask.text.includes(nm), JSON.stringify({ removed, ask }));
        const left = await sql('SELECT COUNT(*) n FROM calendar_event_attachments WHERE event_id=?', [evId]);
        push(`${v.key} · 떼면 서버도 1건`, Number(left[0].n) === 1, String(left[0].n));

        // ⑤ 알리지 않음 → 사라지고 알림 0
        await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="event-materials-ask"]');
          const btn = bar && [...bar.querySelectorAll('button')].find((x) => x.getAttribute('data-testid') !== 'event-materials-notify');
          btn?.click();
        });
        await sleep(800);
        const gone = await page.evaluate(() => !document.querySelector('[data-testid="event-materials-ask"]'));
        const sent = await sql("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND entity_type='calendar_event' AND entity_id=? AND created_at>=?", [uid, evId, since]);
        push(`${v.key} · ⑤ [알리지 않음] → 줄 사라짐 · 알림 0건`, gone && Number(sent[0].n) === 0, JSON.stringify({ gone, sent: sent[0].n }));
        // ⑥ 양성 대조군 — 남은 1건을 떼고 [알리기] 를 누르면 알림이 **생긴다**(⑤ 의 0건이 «못 잰 0» 이 아님을 증명)
        if (v.key.startsWith('데스크탑')) {
          await call(owner.id, `/api/calendar/by-business/${biz}/${evId}/attachments`, { method: 'POST', body: JSON.stringify({ attachments: files.map((f) => ({ file_id: f.id })) }) });
          await page.evaluate(() => {
            const box = document.querySelector('[data-testid="event-materials"]');
            [...box.querySelectorAll('button')].find((x) => x.textContent.trim() === '×' && !x.hasAttribute('data-attach-download'))?.click();
          });
          let bar = null;
          for (let i = 0; i < 12; i++) { await sleep(500); bar = await visible(page, '[data-testid="event-materials-notify"]'); if (bar.vis) break; }
          await page.evaluate(() => document.querySelector('[data-testid="event-materials-notify"]')?.click());
          let n2 = 0;
          for (let i = 0; i < 12; i++) { await sleep(500); n2 = Number((await sql("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND entity_type='calendar_event' AND entity_id=? AND created_at>=?", [uid, evId, since]))[0].n); if (n2 > 0) break; }
          push(`${v.key} · ⑥ 양성 대조군: [알리기] → 참석자 알림 생김`, !!bar?.vis && n2 > 0, JSON.stringify({ bar: bar?.vis, n2 }));
        }
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }

    // 대조군 — 자료 0건 일정을 비작성 멤버가 열면 칸 자체가 없다(편집 권한도 없으므로)
    {
      const evId = await mk('카나리 미팅자료 대조군', []);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(VPS[2].vp);
        await b.login(page, { email: `evmat-${stamp}@test.planq.kr`, password: 'EvMat2026!' });
        await b.goto(page, `/calendar?event=${evId}`);
        await b.dismissBlockers(page);
        let title = false;
        for (let i = 0; i < 12; i++) { await sleep(500); title = await page.evaluate(() => document.body.textContent.includes('카나리 미팅자료 대조군')); if (title) break; }
        const sec = await page.evaluate(() => !!document.querySelector('[data-testid="event-materials"]'));
        push('대조군 · 자료 0건 + 비작성 멤버 → 칸 없음(상세는 열림)', title && !sec, JSON.stringify({ title, sec }), title ? {} : { unmeasured: true });
      } catch (e) {
        push('대조군 · 오류', false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of st.events) await sql('DELETE FROM calendar_events WHERE id=?', [id]).catch(() => {});
    for (const id of st.users) {
      await sql('DELETE FROM notifications WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM refresh_tokens WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM business_members WHERE user_id=?', [id]).catch(() => {});
      await sql('DELETE FROM users WHERE id=?', [id]).catch(() => {});
    }
  }
  return results;
}

module.exports = { name: '일정 미팅자료 (#411) — 3폭 보임·추가·떼기·알릴까요·대조군', run };
