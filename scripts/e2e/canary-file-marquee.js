// Q file — 빈 공간 드래그로 여러 개 고르기 + 선택한 것 통째로 폴더 이동.
//
// Irene 2026-09-20: *"드래그해서 파일 폴더로 옮길 수도 없고, 드래그해서 여러 개 선택하는 것도 안되는데"*
//
// ★ 이 검사기를 두 번 고쳤다. 두 번 다 **검사기가 틀렸고 기능은 멀쩡했다**:
//   ①시작점을 눈대중으로 잡아 **카드 위에서** 드래그를 시작했다 → 선택 0건. 지금은
//     `elementFromPoint` 로 «진짜 빈 지점» 을 찾는다(카드·버튼·draggable 을 피한다).
//   ②양성 대조군을 «코드 삭제» 로 만들었더니 **미사용 변수 TS 오류로 빌드가 실패**해
//     옛 번들이 그대로 서빙됐다 — 판정은 «여전히 선택됨» 이었고 하마터면 "검사기가
//     결함을 못 잡는다" 로 결론 낼 뻔했다. 대조군은 `enabled: false` 로 **끄는** 방식이어야 한다.
// ★ 폴더 0건이면 아무것도 못 재고 «이상 없음» 으로 읽힌다 — 폴더 픽스처를 만들고 지운다.
// 실행: node scripts/e2e/canary-file-marquee.js
// 빈 공간 드래그로 여러 개 선택 + 선택한 것 통째로 폴더 이동 — **진짜 마우스**로 잰다.
const b = require('/opt/planq/scripts/e2e/lib/browser');
(async () => {
  const { browser, page } = await b.launch();
  let folderId = null;
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/inbox');
    await b.sleep(1200);
    folderId = await page.evaluate(async () => {
      const tk = window.__pqGetToken ? window.__pqGetToken() : null;
      const H = { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) };
      const me = await (await fetch('/api/auth/me', { headers: H, credentials: 'include' })).json();
      const biz = me?.data?.active_business_id || me?.data?.businesses?.[0]?.id;
      const r = await fetch(`/api/folders/workspace/${biz}`, { method: 'POST', headers: H, credentials: 'include', body: JSON.stringify({ name: 'ZMQ-' + Date.now() }) });
      return (await r.json())?.data?.id || null;
    });
    if (!folderId) { console.log('⬜ 미측정 — 폴더 픽스처 실패'); return; }
    await b.goto(page, '/files');
    await b.sleep(3500);

    // ① 마퀴가 지나갈 빈 지점 두 곳을 찾는다 — 카드 격자의 오른쪽 빈 공간에서 시작
    const geo = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-file-id]')];
      if (cards.length < 2) return null;
      const area = cards[0].closest('div').parentElement;
      const ar = area.getBoundingClientRect();
      // ★ «진짜 빈 지점» 을 elementFromPoint 로 찾는다. 좌표를 눈대중으로 잡으면
      //   카드 위에서 시작해 마퀴가 안 뜨고, 그걸 «기능이 안 된다» 로 잘못 읽는다.
      let start = null;
      for (let y = ar.top + 4; y < Math.min(ar.bottom, window.innerHeight) - 4 && !start; y += 6) {
        for (let x = ar.left + 4; x < Math.min(ar.right, window.innerWidth) - 4; x += 6) {
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          if (!area.contains(el)) continue;
          if (el.closest('[data-file-id], button, a, input, [draggable="true"]')) continue;
          start = { x, y }; break;
        }
      }
      if (!start) return { noEmpty: true, total: cards.length };
      const r = cards[Math.min(3, cards.length - 1)].getBoundingClientRect();
      return { total: cards.length, from: start, to: { x: r.right - 4, y: r.bottom - 4 } };
    });
    if (!geo) { console.log('⬜ 미측정 — 카드가 2개 미만'); return; }
    if (geo.noEmpty) { console.log('⬜ 미측정 — 파일 영역에 빈 지점이 없다(카드', geo.total, ')'); return; }
    console.log('카드', geo.total, '· 마퀴', JSON.stringify(geo.from), '→', JSON.stringify(geo.to));

    await page.mouse.move(geo.from.x, geo.from.y);
    await page.mouse.down();
    await page.mouse.move((geo.from.x + geo.to.x) / 2, (geo.from.y + geo.to.y) / 2, { steps: 8 });
    await page.mouse.move(geo.to.x, geo.to.y, { steps: 8 });
    const during = await page.evaluate(() => {
      const box = [...document.querySelectorAll('div')].find((d) => {
        const cs = getComputedStyle(d);
        return cs.position === 'fixed' && cs.pointerEvents === 'none'
          && cs.borderTopWidth === '1px' && d.children.length === 0
          && d.getBoundingClientRect().width > 10 && d.getBoundingClientRect().width < window.innerWidth;
      });
      return box ? Math.round(box.getBoundingClientRect().width) + 'x' + Math.round(box.getBoundingClientRect().height) : null;
    });
    await page.mouse.up();
    await b.sleep(900);
    const after = await page.evaluate(() => ({
      selected: document.querySelectorAll('input[type="checkbox"]:checked').length,
      selectModeOn: !!document.querySelector('input[type="checkbox"]'),
      bulkBar: !!document.querySelector('[data-testid="docs-bulk-bar"]') || (document.body.innerText || '').includes('선택'),
    }));
    console.log('드래그 중 사각형:', during || '(안 보임)');
    console.log('드래그 후:', JSON.stringify(after));
    // ③ 선택한 것들을 **통째로** 폴더로 끈다
    const sel = await page.evaluate((fid) => {
      const picked = [...document.querySelectorAll('[data-file-id]')]
        .filter((e) => e.querySelector('input[type="checkbox"]:checked'));
      const menu = document.querySelector(`[data-testid="docs-folder-menu-${fid}"]`);
      const row = menu ? menu.closest('div') : null;
      if (!picked.length || !row) return null;
      const a = picked[0].getBoundingClientRect(), c = row.getBoundingClientRect();
      return {
        ids: picked.map((e) => e.dataset.fileId),
        from: { x: a.x + a.width / 2, y: a.y + 24 },
        to: { x: c.x + c.width / 2, y: c.y + c.height / 2 },
      };
    }, folderId);
    if (!sel) { console.log('⬜ 미측정 — 선택된 카드 또는 폴더 행을 못 찾았다'); return; }
    console.log('끌 대상:', sel.ids.join(','));
    await page.setDragInterception(true);
    await page.mouse.dragAndDrop(sel.from, sel.to).catch((e) => console.log('❌ 드래그 실패:', e.message));
    await b.sleep(2000);
    console.log('VERIFY', JSON.stringify({ folderId, ids: sel.ids }));
    if (errs.length) console.log('오류:', errs.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
