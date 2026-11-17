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

    // ⓪-c 2026-11-17 — 열 폭 저장 없는 표 = 내용 기준(auto). 마지막 열에 긴 글을 치면 그 열이 넓어지고 표는 본문 폭 그대로.
    //   ⓪-d 손잡이를 끌면 그 순간 보이는 폭으로 굳혀(fixed) 끈 만큼만 바뀌고 표 폭은 그대로(오른쪽 이웃이 양보).
    await page.evaluate(() => {
      const cells = document.querySelectorAll('.ProseMirror table tr:nth-child(2) > *');
      const cell = cells[cells.length - 1];
      if (cell) {
        const p = cell.querySelector('p') || cell;
        const r = document.createRange(); r.selectNodeContents(p); r.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    });
    await page.keyboard.type('긴 글 열 — 내용 기준 표에서는 이 열이 남는 폭을 가져가야 한다 긴 글 긴 글 긴 글', { delay: 2 });
    await sleep(700);
    const typed = await measure(page);
    const layoutTyped = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror table')).tableLayout);
    push('⓪-c 내용 기준 — 긴 글 열이 넓어지고(빈 열보다 넓다) 표는 본문 폭 그대로',
      !!typed && layoutTyped === 'auto' && typed.widths[2] > typed.widths[0] + 40 && Math.abs(typed.wrapW - typed.tableW) <= 3,
      typed ? `layout ${layoutTyped} · 열 [${typed.widths.join(', ')}] · 표 ${typed.tableW}/본문 ${typed.wrapW}` : '측정 실패');
    const edge = await page.evaluate(() => {
      const c = document.querySelector('.ProseMirror table tr:first-child > *');
      const r = c.getBoundingClientRect(); return { x: r.right - 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(edge.x - 20, edge.y); await sleep(150);
    await page.mouse.move(edge.x, edge.y); await sleep(250);
    await page.mouse.down(); await sleep(100);
    await page.mouse.move(edge.x + 40, edge.y, { steps: 5 }); await page.mouse.move(edge.x + 80, edge.y, { steps: 5 });
    await page.mouse.up(); await sleep(800);
    // 손잡이 위에 마우스를 남겨 두면 아래 합성 클릭이 «또 한 번 끌기» 가 된다 — 표 밖으로 치운다
    await page.mouse.move(5, 5); await sleep(300);
    const dragged = await measure(page);
    const layoutDragged = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror table')).tableLayout);
    // 이웃이 96 까지만 양보하므로 첫 열 증가 = min(끈 만큼, 이웃 − 96). 마지막 열은 그대로(±3).
    const expectGrow = typed ? Math.min(80, typed.widths[1] - 96) : 0;
    push('⓪-d 손잡이를 끌면 첫 열은 끈 만큼(이웃이 96 까지만 양보) · 마지막 열·표 폭 그대로 · 이후 그 비율로 고정',
      !!typed && !!dragged && layoutDragged === 'fixed' && Math.abs((dragged.widths[0] - typed.widths[0]) - expectGrow) <= 15
        && Math.abs(dragged.widths[2] - typed.widths[2]) <= 3
        && Math.abs(dragged.wrapW - dragged.tableW) <= 3 && Math.min(...dragged.widths) >= 95,
      dragged ? `layout ${layoutDragged} · 열 [${typed ? typed.widths.join(', ') : '-'}] → [${dragged.widths.join(', ')}] · 표 ${dragged.tableW}/본문 ${dragged.wrapW}` : '측정 실패');

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
    await page.evaluate(() => {
      // 2026-10-12 부터 표 안 커서에는 손잡이 [표 ⋯] 만 뜨고 메뉴는 눌러야 펼친다(d2d888a3) — 손잡이를 먼저 누른다
      const h = [...document.querySelectorAll('[data-testid="editor-table-menu-open"]')].find((x) => x.offsetParent);
      if (h) h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await sleep(500);
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

    // ── ⑤ 좁아지면 — 2026-11-04 표시 기준 한 벌(components/Docs/pqTable.ts · Fable 판정 A) ──────────
    //   옛 계약(«좁아져도 저장 px 를 지키고 래퍼가 스크롤») 은 폐기 — 그 px 는 «그 사람 화면의 px» 일 뿐이라
    //   폰에서 3열 표도 가로 스크롤시켰다. 새 계약: 열 수 × 96 ≤ 본문 폭이면 **본문 폭에 맞춘다**(스크롤 없음·칸 ≥ 96),
    //   넘으면 칸 96 을 지키고 래퍼가 가로 스크롤. 어느 쪽이든 «잘림» 은 없다.
    await page.setViewport({ width: 375, height: 812 });
    await sleep(1400);
    const narrow = await measure(page);
    const narrowScroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    const fits = !!narrow && narrow.widths.length * 96 <= narrow.wrapW;
    push('⑤ 좁아지면 — 열 수×96 이 들어가면 본문 폭에 맞추고, 아니면 칸 96 을 지킨 채 래퍼가 스크롤한다',
      !!narrow && Math.min(...narrow.widths) >= 95 && (fits
        ? Math.abs(narrow.wrapW - narrow.tableW) <= 3 && narrow.scrollW <= narrow.wrapW + 3
        : narrow.scrollW > narrow.wrapW),
      narrow ? `${fits ? '맞춤' : '스크롤'} 기대 · 표 ${narrow.tableW} / 본문 ${narrow.wrapW} · scrollWidth ${narrow.scrollW} · 열 [${narrow.widths.join(', ')}]` : '측정 실패');
    push('⑤-b 좁은 폭에서도 페이지가 가로로 밀리지 않는다',
      narrowScroll.doc <= narrowScroll.win + 2,
      `문서 ${narrowScroll.doc} vs 창 ${narrowScroll.win}`);

  } finally { await browser.close(); }
  return results;
}

module.exports = { name: '문서 표 폭 맞춤 — 오른쪽 빈 여백 0 · 열 균등', run };
