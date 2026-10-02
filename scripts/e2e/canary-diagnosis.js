// canary-diagnosis — 무료 업무체계 자가진단(#426) (2026-10-02)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440, **로그인 없이**):
//     ① /service 에 «무료 5분 자가진단» 진입 링크가 보인다
//     ② 12문항을 끝까지 누르면 결과가 뜬다 — 층별 막대 6개 · «가장 먼저 손볼 곳» 피드백 카드가 **보인다**
//     ③ 화면의 합계 = 서버가 저장한 합계(화면이 스스로 세지 않는다)
//     ④ 결과 아래 «메일로 받기» 칸이 보인다(보내지는 않는다 — 외부 발송 없음)
//     대조군: 문항을 다 안 고르면 [결과 보기] 단계로 못 간다(선택 문항 단계 진입 0)
//   ★ 검사가 만든 응답 행은 판정 뒤 지운다.
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
const QIDS = ['S1', 'S2', 'W1', 'W2', 'I1', 'I2', 'D1', 'D2', 'A1', 'A2', 'P1', 'P2'];
// 고르는 답 — 층마다 다른 합이 나오게(업무흐름 0 이 가장 약함)
const PICK = { S1: 1, S2: 1, W1: 0, W2: 0, I1: 2, I2: 1, D1: 1, D2: 2, A1: 2, A2: 2, P1: 2, P2: 1 };

const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + Math.min(12, r.width / 2), r.top + Math.min(12, r.height / 2));
  return { found: true, w: Math.round(r.width), vis: r.width > 0 && !!h && (h === el || el.contains(h)) };
}, sel);

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const [[maxRow]] = [await sql('SELECT COALESCE(MAX(id),0) m FROM diagnosis_responses')];
  const baseId = Number(maxRow.m);
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await page.goto(`${b.BASE}/service`, { waitUntil: 'domcontentloaded' });
        let link = null;
        for (let i = 0; i < 14; i++) { await sleep(500); link = await visible(page, '[data-testid="service-diagnosis-link"]'); if (link.vis) break; }
        push(`${v.key} · ① /service 에 자가진단 링크`, !!link?.vis, JSON.stringify(link));
        await page.goto(`${b.BASE}/service/diagnosis`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => { try { localStorage.removeItem('planq:diagnosis-progress'); } catch { /* */ } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 14; i++) { await sleep(400); if ((await visible(page, '[data-testid="diagnosis-start"]')).vis) break; }
        await page.evaluate(() => document.querySelector('[data-testid="diagnosis-start"]')?.click());
        // 대조군 — 첫 문항에서 다음으로 못 간다(답 없음 → «다음» 버튼 없음)
        await sleep(400);
        const noNext = await page.evaluate(() => ![...document.querySelectorAll('[data-testid="diagnosis-page"] button')].some((x) => /다음|Next/.test(x.textContent || '')));
        push(`${v.key} · 대조군: 답하기 전엔 «다음» 없음`, noNext, String(noNext));
        let clicked = 0;
        for (const q of QIDS) {
          const sel = `[data-testid="diagnosis-opt-${q}-${PICK[q]}"]`;
          for (let i = 0; i < 10; i++) { await sleep(150); if (await page.$(sel)) break; }
          const okc = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
          if (okc) clicked += 1;
        }
        await sleep(400);
        await page.evaluate(() => document.querySelector('[data-testid="diagnosis-finish"]')?.click());
        let bars = null;
        for (let i = 0; i < 14; i++) { await sleep(500); bars = await visible(page, '[data-testid="diagnosis-bars"]'); if (bars.vis) break; }
        const fb = await visible(page, '[data-testid="diagnosis-feedback-workflow"]');
        push(`${v.key} · ② 12문항(${clicked}) → 막대 · «업무흐름» 피드백 보임`, clicked === 12 && !!bars?.vis && !!fb?.vis, JSON.stringify({ clicked, bars, fb }));
        const shown = await page.evaluate(() => (document.querySelector('[data-testid="diagnosis-page"]')?.textContent || '').match(/(\d+)\s*\/\s*24/)?.[1]);
        const [row] = await sql('SELECT total FROM diagnosis_responses WHERE id>? ORDER BY id DESC LIMIT 1', [baseId]);
        push(`${v.key} · ③ 화면 합계 = 서버 합계(${row?.total})`, !!row && Number(shown) === Number(row.total), `shown=${shown}`);
        const mail = await visible(page, '[data-testid="diagnosis-mail"]');
        push(`${v.key} · ④ «메일로 받기» 칸 보임`, !!mail?.vis, JSON.stringify(mail));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sql('DELETE FROM diagnosis_responses WHERE id>? AND email IS NULL', [baseId]).catch(() => {});
  }
  return results;
}

module.exports = { name: '무료 업무체계 자가진단 (#426) — 3폭 진입·12문항·결과·서버 합계 일치', run };
