// canary-task-quick-search — Q task 헤더 «전체 업무에서 찾기» (2026-09-29, 운영 #430)
//
//   Irene: "내 업무 아닌거 봐야 할 때나 이미 끝난 요청받은 업무 찾을 때 탭으로 다 나눠져 있어서 불편하네."
//   재는 것 (3폭):
//     ① 헤더 버튼이 **그려져 있다**(elementFromPoint) · 폰 40 / 그 외 36px 이상
//     ② 누르면 팝오버가 화면 안에 뜨고 입력에 포커스
//     ③ **끝난 업무**(completed)와 **다른 사람 담당** 업무가 제목으로 찾아진다 — 지금 탭과 무관하게
//     ④ 결과를 누르면 그 업무 상세가 열린다(?task=<id>)
//     ⑤ 음성 대조: 없는 낱말 → 빈 상태 문구
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BIZ = 5;
const ME = 5; // health-check@planq.kr
const VPS = [
  { key: '폰 390', min: 40, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 834', min: 36, vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440', min: 36, vp: { width: 1440, height: 900 } },
];

async function search(page, term) {
  await page.evaluate(() => { const i = document.querySelector('[data-testid="qtask-quick-search-input"]'); if (i) i.focus(); });
  await page.evaluate(() => {
    const i = document.querySelector('[data-testid="qtask-quick-search-input"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('[data-testid="qtask-quick-search-input"]', term);
  await sleep(1200);
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="qtask-quick-search-row"]')).map((r) => r.innerText.replace(/\s+/g, ' ')));
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  // 픽스처 — 이미 있는 업무 중에서 고른다(만들지 않는다): 끝난 업무 1 · 남이 담당이고 **내가 만들거나 요청하지 않은** 업무 1
  //   (처음엔 담당자만 봤더니 내가 Cue 에게 요청한 업무가 잡혀, 화면이 정확히 «내가 요청» 이라 한 것을 실패로 셌다)
  const [done] = await sequelize.query(
    `SELECT id, title FROM tasks WHERE business_id=? AND status='completed' AND CHAR_LENGTH(title) >= 4 ORDER BY updated_at DESC LIMIT 1`,
    { replacements: [BIZ], type: 'SELECT' });
  const [other] = await sequelize.query(
    `SELECT id, title FROM tasks WHERE business_id=? AND assignee_id IS NOT NULL AND assignee_id<>? AND created_by<>? AND (request_by_user_id IS NULL OR request_by_user_id<>?) AND status<>'canceled' AND CHAR_LENGTH(title) >= 4 ORDER BY updated_at DESC LIMIT 1`,
    { replacements: [BIZ, ME, ME, ME], type: 'SELECT' });
  if (!done || !other) { push('픽스처', false, `끝난 업무 ${!!done} · 남의 업무 ${!!other} — 미측정`); return results; }

  const { browser } = await b.launch();
  try {
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(v.vp);
      await b.login(page);
      await b.goto(page, '/tasks');
      await b.dismissBlockers(page);
      await sleep(800);

      const btn = await page.evaluate(() => {
        const x = document.querySelector('[data-testid="qtask-quick-search"]');
        if (!x) return null;
        const r = x.getBoundingClientRect();
        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { w: Math.round(r.width), h: Math.round(r.height), painted: !!h && (h === x || x.contains(h)) };
      });
      push(`${v.key} · ① 헤더 버튼이 보인다(≥${v.min}px)`, !!btn && btn.painted && btn.w >= v.min && btn.h >= v.min, JSON.stringify(btn));
      if (!btn) { await ctx.close(); continue; }

      await page.click('[data-testid="qtask-quick-search"]');
      await sleep(500);
      const pop = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="qtask-quick-search-pop"]');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { inView: r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0, focused: document.activeElement && document.activeElement.getAttribute('data-testid') === 'qtask-quick-search-input' };
      });
      push(`${v.key} · ② 팝오버가 화면 안 · 입력에 포커스`, !!pop && pop.inView && pop.focused, JSON.stringify(pop));

      const key = (s) => s.trim().split(/\s+/).sort((a, c) => c.length - a.length)[0].slice(0, 12);
      const r1 = await search(page, key(done.title));
      push(`${v.key} · ③ 끝난 업무가 찾아진다 «${done.title.slice(0, 20)}»`, r1.some((x) => x.includes(done.title.slice(0, 15))), `결과 ${r1.length}건`);
      const r2 = await search(page, key(other.title));
      const row = r2.find((x) => x.includes(other.title.slice(0, 15)));
      push(`${v.key} · ③ 남의 업무가 찾아지고 관계가 보인다`, !!row && /다른 사람|Someone else/.test(row), row ? row.slice(0, 120) : `결과 ${r2.length}건`);

      // ④ 누르면 상세
      await page.evaluate((title) => {
        const r = Array.from(document.querySelectorAll('[data-testid="qtask-quick-search-row"]')).find((x) => x.innerText.includes(title));
        r && r.click();
      }, other.title.slice(0, 15));
      await sleep(1800);
      const at = await page.evaluate(() => location.search);
      const opened = await page.evaluate(() => !!document.querySelector('[data-pq-drawer-panel], [role="dialog"][aria-modal="true"]'));
      push(`${v.key} · ④ 누르면 그 업무 상세가 열린다`, at.includes(`task=${other.id}`) && opened, `주소 ${at} · 상세=${opened}`);

      // ⑤ 음성 대조
      await page.keyboard.press('Escape'); await sleep(500);
      await page.click('[data-testid="qtask-quick-search"]'); await sleep(400);
      const r3 = await search(page, 'zzqqxxnomatch');
      const empty = await page.evaluate(() => /맞는 업무가 없습니다|No matching tasks/.test(document.querySelector('[data-testid="qtask-quick-search-pop"]')?.innerText || ''));
      push(`${v.key} · ⑤ 음성 대조: 없는 낱말 → 빈 상태`, r3.length === 0 && empty, `결과 ${r3.length} · 빈 상태 문구 ${empty}`);
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'Q task 헤더 «전체 업무에서 찾기» (#430)', run };
