// Q file — 빈 공간 드래그로 여러 개 고르기 + 선택한 것 통째로 폴더 이동.
//
// Irene 2026-09-20: *"드래그해서 파일 폴더로 옮길 수도 없고, 드래그해서 여러 개 선택하는 것도 안되는데"*
//   실측 결과 폴더 이동 **자체는 됐고**, 막은 것은 «선택모드를 켜면 드래그가 통째로 꺼지는 것» 이었다.
//   그리고 «끌어서 여러 개 고르기» 는 아예 없던 기능이다.
//
// ★ 이 검사기를 두 번 고쳤다. 두 번 다 **검사기가 틀렸고 기능은 멀쩡했다**:
//   ①시작점을 눈대중으로 잡아 **카드 위에서** 드래그를 시작했다 → 선택 0건.
//     지금은 `elementFromPoint` 로 «진짜 빈 지점» 을 찾는다(카드·버튼·draggable 을 피한다).
//   ②양성 대조군을 «코드 삭제» 로 만들었더니 **미사용 변수 TS 오류로 빌드가 실패**해 옛 번들이
//     그대로 서빙됐다 — 판정은 «여전히 선택됨» 이었고 하마터면 "검사기가 결함을 못 잡는다" 로
//     결론 낼 뻔했다. 대조군은 `enabled: false` 로 **끄는** 방식이어야 한다.
// ★ 폴더 0건이면 아무것도 못 재고 «이상 없음» 으로 읽힌다 — 폴더 픽스처를 만들고 지운다.
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const skip = (name, msg) => results.push({ name, fail: 0, details: ['⬜ 미측정 — ' + msg] });
  const { browser, page } = await b.launch();
  let folderId = null; let movedIds = [];
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
      const r = await fetch(`/api/folders/workspace/${biz}`, {
        method: 'POST', headers: H, credentials: 'include', body: JSON.stringify({ name: 'ZMQ-' + Date.now() }) });
      return (await r.json())?.data?.id || null;
    });
    if (!folderId) { skip('마퀴 선택', '폴더 픽스처를 못 만들었다'); return results; }

    await b.goto(page, '/files');
    await b.sleep(3500);
    const geo = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-file-id]')];
      if (cards.length < 2) return null;
      const area = cards[0].closest('div').parentElement;
      const ar = area.getBoundingClientRect();
      let start = null;
      for (let y = ar.top + 4; y < Math.min(ar.bottom, window.innerHeight) - 4 && !start; y += 6) {
        for (let x = ar.left + 4; x < Math.min(ar.right, window.innerWidth) - 4; x += 6) {
          const el = document.elementFromPoint(x, y);
          if (!el || !area.contains(el)) continue;
          if (el.closest('[data-file-id], button, a, input, [draggable="true"]')) continue;
          start = { x, y }; break;
        }
      }
      if (!start) return { noEmpty: true, total: cards.length };
      const r = cards[Math.min(3, cards.length - 1)].getBoundingClientRect();
      return { total: cards.length, from: start, to: { x: r.right - 4, y: r.bottom - 4 } };
    });
    if (!geo) { skip('마퀴 선택', '카드가 2개 미만'); return results; }
    if (geo.noEmpty) { skip('마퀴 선택', `파일 영역에 빈 지점이 없다(카드 ${geo.total})`); return results; }

    await page.mouse.move(geo.from.x, geo.from.y);
    await page.mouse.down();
    await page.mouse.move((geo.from.x + geo.to.x) / 2, (geo.from.y + geo.to.y) / 2, { steps: 8 });
    await page.mouse.move(geo.to.x, geo.to.y, { steps: 8 });
    const boxSize = await page.evaluate(() => {
      const box = [...document.querySelectorAll('div')].find((d) => {
        const cs = getComputedStyle(d);
        return cs.position === 'fixed' && cs.pointerEvents === 'none' && cs.borderTopWidth === '1px'
          && d.children.length === 0 && d.getBoundingClientRect().width > 10
          && d.getBoundingClientRect().width < window.innerWidth;
      });
      return box ? Math.round(box.getBoundingClientRect().width) + 'x' + Math.round(box.getBoundingClientRect().height) : null;
    });
    await page.mouse.up();
    await b.sleep(900);
    const after = await page.evaluate(() => ({
      selected: document.querySelectorAll('input[type="checkbox"]:checked').length,
      selectMode: !!document.querySelector('input[type="checkbox"]'),
    }));
    push('끌면 선택 사각형이 그려진다', !!boxSize, `사각형 ${boxSize || '없음'}`);
    push('끌어서 여러 개가 선택된다', after.selected >= 2, `선택 ${after.selected}건`);
    push('선택모드가 자동으로 켜진다', after.selectMode, `selectMode=${after.selectMode}`);

    // 선택한 것들을 **통째로** 폴더로 끈다 — 선택모드에서 드래그가 꺼져 있으면 여기서 잡힌다
    const sel = await page.evaluate((fid) => {
      const picked = [...document.querySelectorAll('[data-file-id]')]
        .filter((e) => e.querySelector('input[type="checkbox"]:checked'));
      const menu = document.querySelector(`[data-testid="docs-folder-menu-${fid}"]`);
      const row = menu ? menu.closest('div') : null;
      if (!picked.length || !row) return null;
      const a = picked[0].getBoundingClientRect(), c = row.getBoundingClientRect();
      return { ids: picked.map((e) => e.dataset.fileId),
        from: { x: a.x + a.width / 2, y: a.y + 24 }, to: { x: c.x + c.width / 2, y: c.y + c.height / 2 } };
    }, folderId);
    if (!sel) { skip('선택한 것 통째로 이동', '선택된 카드 또는 폴더 행을 못 찾았다'); return results; }
    movedIds = sel.ids.map((x) => Number(String(x).replace('direct-', ''))).filter(Boolean);
    await page.setDragInterception(true);
    await page.mouse.dragAndDrop(sel.from, sel.to).catch(() => {});
    await b.sleep(2000);
    const [rows] = await sequelize.query('SELECT id, folder_id FROM files WHERE id IN (:ids)', { replacements: { ids: movedIds } });
    const okAll = rows.length === movedIds.length && rows.every((r) => Number(r.folder_id) === Number(folderId));
    push('선택한 것이 한 번에 옮겨진다', okAll,
      `${rows.map((r) => r.id + '→' + r.folder_id).join(' · ')} (기대 ${folderId})`);
  } finally {
    try {
      if (movedIds.length) await sequelize.query('UPDATE files SET folder_id=NULL WHERE id IN (:ids)', { replacements: { ids: movedIds } });
      await sequelize.query("DELETE FROM file_folders WHERE name LIKE 'ZMQ-%'");
    } catch { /* noop */ }
    try { await browser.close(); } catch { /* noop */ }
  }
  return results;
}

module.exports = { run };
