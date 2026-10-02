// canary-sale-extract — 상담 기록에서 업무 추출(#382, 2026-10-02)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 상담 기록 행에 [업무 추출] 이 **보인다**(좌표 + elementFromPoint)
//     ② 누르면 공용 AI 업무 추가 창이 열리고, 입력칸에 그 기록이 **전문으로** 채워져 있다
//        — 본문 140자 뒤에 둔 표식이 들어 있어야 한다(타임라인 미리보기는 140자에서 잘린다 — 그걸로 채우면 실패)
//   ★ 만든 상담 기록은 판정 뒤 지운다. AI 분해(LLM)는 부르지 않는다 — 비용 없이 «무엇이 채워지는가» 만 잰다.
const b = require('./lib/browser');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
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
const MARK = 'EXTRACT_TAIL_MARK';

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const made = [];
  let browser = null;
  try {
    const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
    const biz = owner.biz;
    const [cl] = await sql("SELECT id FROM clients WHERE business_id=? AND status<>'archived' ORDER BY id DESC LIMIT 1", [biz]);
    if (!cl) { push('픽스처', false, '고객 없음', { unmeasured: true }); return results; }
    const body = `카나리 상담 메모 — 견적서 보내기, 다음 주 미팅 잡기. ${'가'.repeat(160)} ${MARK}`;
    const r = await call(owner.id, `/api/sale/${biz}/clients/${cl.id}/interactions`, { method: 'POST', body: JSON.stringify({ kind: 'call', title: '카나리 통화', body, occurred_at: new Date().toISOString() }) });
    const iid = r.body?.data?.id;
    if (!iid) { push('픽스처', false, `상담 기록 생성 실패 ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`, { unmeasured: true }); return results; }
    made.push(iid);

    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await b.goto(page, `/sale/${cl.id}`);
        await b.dismissBlockers(page);
        const sel = `[data-testid="sale-record-extract-${iid}"]`;
        let vis = null;
        for (let i = 0; i < 14; i++) {
          await sleep(500);
          vis = await page.evaluate((s) => {
            const el = document.querySelector(s);
            if (!el) return { found: false };
            el.scrollIntoView({ block: 'center' });
            const rc = el.getBoundingClientRect();
            const h = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
            return { found: true, w: Math.round(rc.width), vis: rc.width > 0 && !!h && (h === el || el.contains(h)) };
          }, sel);
          if (vis.vis) break;
        }
        push(`${v.key} · ① [업무 추출] 이 보인다`, !!vis?.vis, JSON.stringify(vis));
        await page.evaluate((s) => document.querySelector(s)?.click(), sel);
        let filled = null;
        for (let i = 0; i < 10; i++) {
          await sleep(400);
          filled = await page.evaluate((mk) => {
            const ta = document.querySelector('[aria-modal="true"] textarea');
            return ta ? { has: ta.value.includes(mk), title: ta.value.includes('카나리 통화'), len: ta.value.length } : null;
          }, MARK);
          if (filled && filled.has) break;
        }
        push(`${v.key} · ② AI 창이 열리고 기록 전문이 채워진다(140자 뒤 표식 포함)`, !!filled && filled.has && filled.title, JSON.stringify(filled));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const id of made) await sql('DELETE FROM client_interactions WHERE id=?', [id]).catch(() => {});
  }
  return results;
}

module.exports = { name: '상담 기록 업무 추출 (#382) — 3폭 보임·AI 창에 기록 전문', run };
