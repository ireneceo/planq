// 문서 편집 중 좌측 리스트를 접어도 화면이 남아 있는가
//   운영 (Irene 2026-08-28): "문서에서 좌측메뉴 닫으면 편집하던 화면이 하얗게 돼."
//
//   원인: 접으면 Sidebar 가 조건부 렌더로 DOM 에서 사라지는데 그리드가 첫 칸을 0px 로 남겨두면
//   남은 본문(section)이 그 0px 칸에 들어가 화면이 통째로 없어진다.
//   ★ **보기 모드에서는 재현되지 않는다** — 편집까지 들어가야 난다. 첫 조사에서 이것 때문에
//     "정상" 으로 오판할 뻔했다.
//
//   불변식: 접은 뒤 본문 에디터의 폭이 접기 전보다 **넓어야** 한다(리스트 자리를 물려받으므로).
//   반증 실측 — 옛 코드: 접은 후 에디터 폭 0px(그리드 "0px 1376px"), 수정 후: 1328px.
const b = require('./lib/browser');

const measure = () => {
  const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
  let grid = null;
  for (const g of document.querySelectorAll('div,main,section')) {
    const cs = getComputedStyle(g);
    if (cs.display !== 'grid') continue;
    const bb = g.getBoundingClientRect();
    if (bb.width < 500 || bb.height < 300) continue;
    grid = { cols: cs.gridTemplateColumns,
      kids: [...g.children].filter((c) => { const k = getComputedStyle(c); return k.position !== 'absolute' && k.position !== 'fixed' && k.display !== 'none'; })
        .map((c) => c.tagName.toLowerCase() + ':' + Math.round(c.getBoundingClientRect().width)) };
    break;
  }
  return { editorW: ed ? Math.round(ed.getBoundingClientRect().width) : -1, grid };
};

async function run() {
  const results = [];
  for (const vw of [1440, 1000]) {
    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: vw, height: 900 });
      await b.login(page);
      await b.goto(page, '/docs');
      await b.sleep(2500);
      // 리스트가 접힌 상태로 저장돼 있으면 먼저 편다
      await page.evaluate(() => { for (const el of document.querySelectorAll('button')) {
        const t = (el.getAttribute('aria-label') || '').trim(); if (/열기|expand/i.test(t)) { el.click(); return; } } });
      await b.sleep(1200);
      const opened = await page.evaluate(() => { const r = document.querySelector('[data-testid="docs-row"]'); if (!r) return false; r.click(); return true; });
      await b.sleep(2500);
      const edited = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((e) => /^편집$/.test((e.textContent || '').trim()) && e.offsetParent !== null);
        if (!btn) return false; btn.click(); return true;
      });
      await b.sleep(2000);
      const before = await page.evaluate(measure);
      // 검사 대상이 성립했는지부터 — 문서를 못 열었거나 편집에 못 들어갔으면 **판정 불가(실패)**
      if (!opened || !edited || before.editorW <= 0) {
        results.push({ name: `${vw}px`, ok: false,
          msg: `🔴 판정 불가 — 문서열기 ${opened} · 편집진입 ${edited} · 접기 전 에디터 ${before.editorW}px` });
        continue;
      }
      await page.evaluate(() => { for (const el of document.querySelectorAll('button')) {
        const t = (el.getAttribute('aria-label') || '').trim(); if (/^(리스트|목록)?\s*접기$/.test(t)) { el.click(); return; } } });
      await b.sleep(1600);
      const after = await page.evaluate(measure);
      const ok = after.editorW > before.editorW;
      results.push({ name: `${vw}px`, ok,
        msg: ok
          ? `에디터 ${before.editorW} → ${after.editorW}px (넓어짐) · cols ${after.grid ? after.grid.cols : '?'}`
          : `🔴 접으니 에디터가 ${before.editorW} → ${after.editorW}px · cols ${after.grid ? after.grid.cols : '?'} · 자식 ${after.grid ? after.grid.kids.join(',') : '?'}` });
    } catch (e) {
      results.push({ name: `${vw}px`, ok: false, msg: 'ERROR: ' + e.message.slice(0, 140) });
    } finally { await browser.close(); }
  }
  return results;
}


// ★ 하니스 러너(run.js printSuite)는 **r.fail(숫자)** 을 센다. {ok, msg} 만 돌려주면 bad=0 이 되어
//   **게이트에서 영원히 통과**한다 — 단독 실행은 실패하는데 러너는 ✅ 를 찍는다(2026-08-28 실측).
//   결과를 러너 계약으로 변환한다: { name, fail: 0|1, details: [메시지] }.
function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}

module.exports = { run: async () => toRunnerShape(await run()), name: 'docs-collapse' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 문서 편집 중 리스트 접기 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
