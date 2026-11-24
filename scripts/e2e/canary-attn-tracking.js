// canary-attn-tracking — 멤버별 «출퇴근 안 함» (2026-11-24 · docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md)
//
//   재는 것(폰 390 · 태블릿 834 · 데스크탑 1440):
//     대표 — 설정 › 근태 관리 «사람별 일정·출퇴근» 줄의 스위치가 **보이고 눌린다**(elementFromPoint) ·
//            끄기는 확인창(aria-modal) 뒤에만 저장 · 확인 뒤 DB 값 false · 줄 설명이 «출퇴근 안 함»
//     멤버 — 꺼지면 근태 페이지에 출퇴근 위젯 대신 안내 한 줄 · 켜져 있을 땐 위젯(양성 대조군)
//   ★ 끝나면 대상 멤버를 켜진 상태로 되돌린다(attendance_tracked_since 도 원래 값).
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const OWNER = { email: 'owner@test.planq.kr', password: 'Test1234!' };
const MATE = { email: 'member2@test.planq.kr', password: 'Test1234!' };
const BIZ = 6;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];

async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, w: Math.round(r.width), h: Math.round(r.height), hit: !!h && (h === el || el.contains(h)), inView: r.left >= 0 && r.right <= innerWidth + 1 };
  }, sel);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const [mate] = await sql('SELECT u.id, bm.attendance_tracked t, bm.attendance_tracked_since s FROM users u JOIN business_members bm ON bm.user_id=u.id AND bm.business_id=? WHERE u.email=?', [BIZ, MATE.email]);
  if (!mate) { push('픽스처', false, 'member2 없음'); return results; }
  const setTracked = (v) => sql('UPDATE business_members SET attendance_tracked=? WHERE business_id=? AND user_id=?', [v ? 1 : 0, BIZ, mate.id]);
  const dbTracked = async () => Number((await sql('SELECT attendance_tracked t FROM business_members WHERE business_id=? AND user_id=?', [BIZ, mate.id]))[0].t);
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    for (const [i, v] of VPS.entries()) {
      // ── 대표: 스위치
      await setTracked(true);
      let ctx = await browser.createBrowserContext();
      let page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page, OWNER);
        await b.goto(page, '/business/settings/attendance');
        await b.dismissBlockers(page);
        const sel = `[data-testid="attn-tracking-toggle-${mate.id}"]`;
        await page.waitForSelector(sel, { timeout: 15000 }).catch(() => null);
        const vis = await visible(page, sel);
        push(`${v.key} · 대표: «출퇴근 기록» 스위치가 보이고 눌린다`, vis.found && vis.hit && vis.inView && vis.w >= 30, JSON.stringify(vis));
        if (!vis.found) continue;
        await page.click(sel);
        await sleep(500);
        const dlg = await page.evaluate(() => !!document.querySelector('[aria-modal="true"]'));
        const beforeConfirm = await dbTracked();
        push(`${v.key} · 끄기는 확인창 먼저(아직 저장 안 함)`, dlg && beforeConfirm === 1, `dialog ${dlg} · db ${beforeConfirm}`);
        // 확인창 버튼은 화면 언어를 따른다 — 한국어 화면에 «Cancel» 이 나왔다(2026-11-24 Irene 실사용)
        const btnTexts = await page.evaluate(() => { const d = document.querySelector('[aria-modal="true"]'); return d ? [...d.querySelectorAll('button')].map((x) => (x.textContent || '').trim()).filter(Boolean) : []; });
        push(`${v.key} · 확인창 취소 버튼이 «취소»(영어 «Cancel» 아님)`, btnTexts.includes('취소') && !btnTexts.includes('Cancel'), btnTexts.join('|'));
        // 확인 버튼 — 확인창 안의 마지막 버튼(variant warning 의 확인)
        await page.evaluate(() => {
          const d = document.querySelector('[aria-modal="true"]');
          const btns = d ? [...d.querySelectorAll('button')].filter((x) => /끄기|Turn off/.test(x.textContent || '')) : [];
          if (btns.length) btns[btns.length - 1].click();
        });
        let after = 1;
        for (let k = 0; k < 10 && after === 1; k++) { await sleep(400); after = await dbTracked(); }
        push(`${v.key} · 확인 뒤 저장(DB false)`, after === 0, `db ${after}`);
        await sleep(600);
        const desc = await page.evaluate((id) => document.querySelector(`[data-testid="attn-schedule-member-${id}"] [data-testid="attn-schedule-member-desc"]`)?.textContent || '', mate.id);
        push(`${v.key} · 줄 설명이 «출퇴근 안 함»`, /출퇴근 안 함|No check-in/.test(desc), desc.slice(0, 60));
      } catch (e) { push(`${v.key} · 대표 오류`, false, e.message.slice(0, 160)); } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }

      // ── 멤버: 꺼진 상태 → 안내 / 켜진 상태 → 위젯(양성 대조군)
      for (const on of [false, true]) {
        await setTracked(on);
        ctx = await browser.createBrowserContext();
        page = await ctx.newPage();
        try {
          await page.setViewport(v.vp);
          if (v.touch) await page.setUserAgent(UA);
          await b.login(page, MATE);
          await b.goto(page, '/attendance');
          await b.dismissBlockers(page);
          await sleep(1500);
          const st = await page.evaluate(() => {
            const n = document.querySelector('[data-testid="attn-not-tracked"]');
            const w = [...document.querySelectorAll('[data-testid="attn-widget"]')].filter((x) => x.getBoundingClientRect().width > 0).length;
            let hit = false;
            if (n) { n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); hit = !!h && n.contains(h); }
            // 꺼진 워크스페이스에서는 자동 출근·출근 묻기 스위치도 없어야 한다(2026-11-24 Irene 실사용)
            const sw = document.querySelectorAll('#attn-auto-clockin, [data-testid="attn-prompt-toggle"]').length;
            return { notice: !!n, hit, widgets: w, sw };
          });
          if (!on) push(`${v.key} · 멤버(꺼짐): 위젯 0 · 안내 보임 · 스위치 0`, st.notice && st.hit && st.widgets === 0 && st.sw === 0, JSON.stringify(st));
          else push(`${v.key} · 멤버(켜짐, 대조군): 위젯 보임 · 안내 없음 · 스위치 2`, !st.notice && st.widgets >= 1 && st.sw === 2, JSON.stringify(st));
        } catch (e) { push(`${v.key} · 멤버 오류`, false, e.message.slice(0, 160)); } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
      }
      void i;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sql('UPDATE business_members SET attendance_tracked=?, attendance_tracked_since=? WHERE business_id=? AND user_id=?', [mate.t, mate.s, BIZ, mate.id]).catch(() => null);
    const back = await dbTracked().catch(() => -1);
    results.push({ name: 'cleanup: 대상 멤버 원래 값', fail: back === Number(mate.t) ? 0 : 1, details: [`${back}`] });
  }
  return results;
}

module.exports = { name: '멤버별 «출퇴근 안 함» — 설정 스위치·확인창·멤버 화면 3폭', run };
