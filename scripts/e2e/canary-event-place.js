// canary-event-place — 일정 추가 «장소» 칸 [오프라인 | 온라인] 토글 (2026-10-21)
//
//   Irene: "일정 추가에서 … 오프라인/온라인 미팅 탭 넣으면 폼이 더 심플해지지 않아?" → 권고 «장소 칸 자리 토글» 대로.
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 열면 오프라인 — 장소 칸 보임 · 링크 칸 없음 · «+ 온라인 링크도» 보임
//     ② [온라인] → 링크 칸 보임 · 장소 칸 없음
//     ③ 장소를 적고 [온라인] 으로 바꿔 링크만 적어 만들면 → DB 장소 NULL · 링크 저장(보이는 칸만 보낸다)
//     ④ «+ 장소도» 로 둘 다 열고 만들면 → 장소·링크 둘 다 저장(양성 대조군 — ③ 의 NULL 이 못 보낸 NULL 이 아님)
//   ★ 만든 일정은 판정 뒤 지운다.
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];
const T = (id) => `[data-testid="${id}"]`;
// 보이는가 — 크기 + 그 좌표에 실제로 그려지는가(elementFromPoint)
const vis = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const h = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + Math.min(8, r.height / 2));
  return !!h && (h === el || el.contains(h) || h.contains(el));
}, sel);
const click = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
async function typeInto(page, sel, text) {
  await page.evaluate((s) => { const el = document.querySelector(s); el?.scrollIntoView({ block: 'center' }); el?.focus(); }, sel);
  await page.keyboard.type(text, { delay: 5 });
}
async function openModal(page) {
  await b.goto(page, '/calendar');
  await b.dismissBlockers(page);
  await sleep(800);
  await click(page, T('calendar-new-event'));
  for (let i = 0; i < 15; i++) { await sleep(300); if (await page.$(T('new-event-place'))) break; }
}
async function findRow(title) {
  for (let i = 0; i < 15; i++) {
    await sleep(400);
    const [row] = await sql('SELECT id, location, meeting_url FROM calendar_events WHERE title=? ORDER BY id DESC LIMIT 1', [title]);
    if (row) return row;
  }
  return null;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const titles = [];
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    const stamp = Date.now();
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);

        // ①②③
        await openModal(page);
        const one = { toggle: await vis(page, T('new-event-place-toggle')), loc: await vis(page, T('new-event-location')),
          url: !!(await page.$(T('new-event-meeting-url'))), both: await vis(page, T('new-event-place-both')) };
        push(`${v.key} · ① 처음 = 오프라인: 토글·장소 칸 보임 · 링크 칸 없음 · «+ 온라인 링크도»`, one.toggle && one.loc && !one.url && one.both, JSON.stringify(one));
        const title3 = `[장소카나리] 온라인만 ${v.key} ${stamp}`; titles.push(title3);
        await typeInto(page, T('new-event-title'), title3);
        await typeInto(page, T('new-event-location'), `A동 ${stamp}`);
        await click(page, T('new-event-place-online')); await sleep(300);
        const two = { url: await vis(page, T('new-event-meeting-url')), loc: !!(await page.$(T('new-event-location'))) };
        push(`${v.key} · ② [온라인] → 링크 칸 보임 · 장소 칸 없음`, two.url && !two.loc, JSON.stringify(two));
        await typeInto(page, T('new-event-meeting-url'), 'https://meet.google.com/abc-defg-hij');
        await click(page, T('calendar-new-submit'));
        const r3 = await findRow(title3);
        push(`${v.key} · ③ 장소 적고 온라인으로 바꿔 만들면 → 장소 NULL · 링크 저장`, !!r3 && r3.location === null && r3.meeting_url === 'https://meet.google.com/abc-defg-hij', JSON.stringify(r3));

        // ④ 둘 다
        await openModal(page);
        const title4 = `[장소카나리] 둘 다 ${v.key} ${stamp}`; titles.push(title4);
        await typeInto(page, T('new-event-title'), title4);
        await click(page, T('new-event-place-both')); await sleep(300);
        const bothVis = { loc: await vis(page, T('new-event-location')), url: await vis(page, T('new-event-meeting-url')), more: !!(await page.$(T('new-event-place-both'))) };
        await typeInto(page, T('new-event-location'), `B동 ${stamp}`);
        await typeInto(page, T('new-event-meeting-url'), 'https://zoom.us/j/123');
        await click(page, T('calendar-new-submit'));
        const r4 = await findRow(title4);
        push(`${v.key} · ④ «+ 온라인 링크도» → 두 칸 보임 · 만들면 둘 다 저장(양성 대조군)`,
          bothVis.loc && bothVis.url && !bothVis.more && !!r4 && r4.location === `B동 ${stamp}` && r4.meeting_url === 'https://zoom.us/j/123', JSON.stringify({ bothVis, r4 }));
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

module.exports = { name: '일정 추가 장소 토글 — 오프라인/온라인 칸·보이는 칸만 저장·둘 다(양성 대조군)', run };
