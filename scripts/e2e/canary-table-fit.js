// scripts/e2e/canary-table-fit.js — 문서 표 **폭 맞춤** 계약 (2026-09-13)
//
// Irene: *"문서에서 표를 좌우로 맞추면 열이 잘 나눠져야 하는데 우측이 빈 여백이 되어 버리는데?"*
//
//   [폭 맞춤] 은 여태 열마다 **무조건 160px** 을 넣었다. 3열이면 480px 이라 편집 폭이 800px 일 때
//   오른쪽 320px 이 빈 채로 남았다. 이 계열은 **CSS·colgroup·컨테이너 폭이 합쳐진 뒤에만 존재**해서
//   정적 검사로는 못 잡는다 — 그래서 실브라우저로 픽셀을 잰다.
//
//   재는 것:
//     ⓪ **누르기 전에도** 표가 본문 폭을 채운다 — 기본 반응형(2026-09-13 Irene 추가 신고)
//     ② 누른 **뒤** 표 폭 == 본문 폭 (오른쪽 빈 여백 ≤ 2px)
//     ③ 열 폭이 서로 같다 (가장 넓은 열 − 가장 좁은 열 ≤ 2px)
//     ④ 가로 스크롤이 생기지 않는다 (scrollWidth ≤ clientWidth + 2)
//     ⑤ 반대로 **컨테이너가 좁아지면** 표를 눌러 넣지 않고 래퍼가 스크롤한다(옛 우측 잘림 회귀 차단)
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function measure(page) {
  return page.evaluate(() => {
    const table = document.querySelector('.ProseMirror table');
    if (!table) return null;
    const wrap = table.closest('.tableWrapper') || table.parentElement;
    const cells = [...table.querySelectorAll('tr:first-child > *')];
    const widths = cells.map((c) => Math.round(c.getBoundingClientRect().width));
    return {
      tableW: Math.round(table.getBoundingClientRect().width),
      wrapW: wrap ? Math.round(wrap.clientWidth) : 0,
      scrollW: wrap ? Math.round(wrap.scrollWidth) : 0,
      widths,
    };
  });
}

async function run() {
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);
    await goto(page, '/docs');
    await sleep(2500);
    await dismissBlockers(page).catch(() => {});

    // 새 문서 (초안) — 저장하지 않는다. 표만 넣고 폭을 잰 뒤 창을 버린다.
    const openedNew = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="docs-new"]');
      if (!b) return false; b.click(); return true;
    });
    if (openedNew) {
      await sleep(700);
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="docs-new-blank"]');
        if (b) b.click();
      });
      await sleep(2200);
    }
    const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror'));
    if (!hasEditor) {
      push('문서 편집기 열기', false, '새 문서 편집기를 열지 못했다 — 판정 불가(실패)');
      return results;
    }

    // 표 삽입
    await page.evaluate(() => {
      const ed = document.querySelector('.ProseMirror');
      if (ed) ed.focus();
      const b = document.querySelector('[data-testid="editor-insert-table"]');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(1200);
    const before = await measure(page);
    if (!before || !before.widths.length) {
      push('표 삽입', false, '표가 만들어지지 않았다 — 판정 불가(실패)');
      return results;
    }

    // ⓪ **기본값**이 이미 맞아야 한다 (Irene: "기본 반응형 안잡아줘?")
    //   prosemirror-tables 가 표에 인라인 min-width 를 써서 스타일시트의 100% 를 덮는다 —
    //   그 탓에 새 표가 max-content(실측 290px)에 머물러 872px 본문 안에서 테두리가
    //   내용까지만 그려졌다. 버튼을 누르기 **전**에 재는 것이 이 계약이다.
    const gap0 = before.wrapW - before.tableW;
    const spread0 = Math.max(...before.widths) - Math.min(...before.widths);
    push('⓪ 표를 만들면 **누르지 않아도** 본문 폭을 채운다',
      Math.abs(gap0) <= 3,
      `표 ${before.tableW} / 본문 ${before.wrapW} (오른쪽 여백 ${gap0})`);
    push('⓪-b 만들자마자 열 폭이 서로 같다',
      spread0 <= 3, `열 폭 [${before.widths.join(', ')}] · 최대−최소 ${spread0}`);

    // 일부러 한 열을 좁혀 "제각각" 상태를 만든다 — 그래야 ②③ 이 의미를 갖는다.
    //   (표를 막 만들면 열이 이미 균등이라 대조군이 안 된다)
    await page.evaluate(() => {
      const table = document.querySelector('.ProseMirror table');
      const cols = table ? table.querySelectorAll('col') : [];
      if (cols.length) { cols[0].style.width = '80px'; }
    });
    await sleep(300);

    // 커서를 표 안에 두고 [폭 맞춤]
    await page.evaluate(() => {
      const cell = document.querySelector('.ProseMirror table td, .ProseMirror table th');
      if (cell) {
        const r = document.createRange(); r.selectNodeContents(cell); r.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }
    });
    await sleep(900);
    const btn = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="editor-table-even-cols"]');
      if (!b) return false;
      // 버블 메뉴 버튼은 mousedown 에서 동작한다(포커스 유지)
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return true;
    });
    if (!btn) {
      push('[폭 맞춤] 버튼을 찾았다', false, '표 버블 메뉴가 뜨지 않았다 — 판정 불가(실패)');
      return results;
    }
    await sleep(1200);
    const after = await measure(page);
    if (!after) { push('폭 맞춤 후 측정', false, '표가 사라졌다'); return results; }

    const gapBefore = before.wrapW - before.tableW;
    const gapAfter = after.wrapW - after.tableW;
    const spread = Math.max(...after.widths) - Math.min(...after.widths);

    push('① 측정 전제 — 표가 본문 폭을 쓰고 있다(래퍼 폭 > 0)',
      after.wrapW > 200, `래퍼 폭 ${after.wrapW}`);
    // 위에서 한 열을 80px 로 **일부러 좁혀** 제각각으로 만들어 두었다 — 그래서 ②③ 이 의미를 갖는다.
    push('② [폭 맞춤] 뒤 오른쪽 빈 여백이 없다 (표 폭 == 본문 폭)',
      Math.abs(gapAfter) <= 3,
      `전 표 ${before.tableW}/본문 ${before.wrapW} (여백 ${gapBefore}) → 후 표 ${after.tableW}/본문 ${after.wrapW} (여백 ${gapAfter})`);
    push('③ 열 폭이 서로 같다',
      spread <= 3, `열 폭 [${after.widths.join(', ')}] · 최대−최소 ${spread}`);
    push('④ 가로 스크롤이 생기지 않는다',
      after.scrollW <= after.wrapW + 3, `scrollWidth ${after.scrollW} vs clientWidth ${after.wrapW}`);

    // ── ⑤ 좁아지면 **눌러 넣지 않는다** (옛 '우측 잘림' 회귀 차단) ──────────
    //   min-width:100% 를 !important 로 올렸으므로 좁은 표는 늘어난다. 그 반대쪽 —
    //   컨테이너가 표보다 좁아지면 표는 자연폭을 지키고 **래퍼가 가로 스크롤**해야 한다.
    //   (창을 좁히는 것이 열을 늘리는 것보다 같은 조건을 더 정확히 만든다)
    await page.setViewport({ width: 375, height: 812 });
    await sleep(1400);
    const narrow = await measure(page);
    const narrowScroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    push('⑤ 컨테이너가 좁아져도 표를 눌러 넣지 않는다 (래퍼가 가로 스크롤)',
      !!narrow && narrow.tableW > narrow.wrapW && narrow.scrollW > narrow.wrapW,
      narrow ? `표 ${narrow.tableW} / 본문 ${narrow.wrapW} · scrollWidth ${narrow.scrollW}` : '측정 실패');
    push('⑤-b 좁은 폭에서도 페이지가 가로로 밀리지 않는다',
      narrowScroll.doc <= narrowScroll.win + 2,
      `문서 ${narrowScroll.doc} vs 창 ${narrowScroll.win}`);

  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '문서 표 폭 맞춤 — 오른쪽 빈 여백 0 · 열 균등', run };
