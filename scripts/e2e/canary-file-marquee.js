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
  let folderId = null; let movedIds = []; const uploadedIds = [];
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

    // ★ 선택모드가 켜진 채로는 행 액션이 숨는다 — 그 상태로 재면 «0개» 가 나와 결함처럼 보인다.
    //   화면을 새로 연다.
    await b.goto(page, '/files');
    await b.sleep(3500);

    // ── 끌고 있는 것이 «우리 파일» 이면 업로드 오버레이를 띄우지 않는다.
    //   Irene 2026-09-20: *"파일을 드래그 해서 좌측 폴더에 넣으면 그리로 들어가는 거 아니야?
    //   왜 드래그 해서 당기면 업로드하라는 아이콘이 나와???"* — 오버레이가 안쪽을 통째로 덮어
    //   좌측 폴더 행이 드롭을 **받지 못했다**. 두 방향으로 잰다(우리 파일 / 바깥 파일).
    //   ★ dispatch 직후에 재면 **언제나 «안 뜸»** 이다 — React 가 아직 다시 그리지 않았다.
    //     처음에 그렇게 짜서 양성 쪽까지 false 로 나왔고, 하마터면 "우리 파일은 안 뜬다 ✅" 라는
    //     **뜻 없는 초록**을 받을 뻔했다. 뿌리고 → 기다리고 → 본다.
    const fireDrag = async (kind) => {
      const ok = await page.evaluate((k) => {
        const target = document.querySelector('[data-file-id]');
        if (!target) return false;
        const dt = new DataTransfer();
        if (k === 'inner') dt.setData('application/x-planq-file', 'direct-1');
        else { try { dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' })); } catch { return false; } }
        if (k === 'outer' && ![...dt.types].includes('Files')) return false;
        target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return true;
      }, kind);
      if (!ok) return null;
      await b.sleep(400);
      const shown = await page.evaluate(() => !!document.querySelector('[data-testid="docs-upload-overlay"]'));
      await page.evaluate(() => {
        const target = document.querySelector('[data-file-id]');
        if (target) target.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() }));
      });
      await b.sleep(300);
      return shown;
    };
    const onInner = await fireDrag('inner');
    const onOuter = await fireDrag('outer');
    if (onInner === null) skip('업로드 오버레이 판정', '파일 카드를 못 찾았다');
    else if (onOuter === null) skip('업로드 오버레이 판정', '합성 DataTransfer 에 File 을 못 넣었다 — 대조군 불성립');
    else {
      // 대조군이 서야 위 판정이 뜻을 갖는다. 먼저 본다.
      push('바깥 파일은 오버레이가 뜬다 (양성 대조군)', onOuter, `오버레이 ${onOuter}`);
      push('우리 파일을 끌 때는 업로드 오버레이가 안 뜬다', !onInner, `오버레이 ${onInner}`);
    }

    // ── 그리드 카드: 폴더 칩은 **출처 태그와 같은 줄**에 선다. 날짜 줄에 넣으면 날짜를 민다.
    //   Irene 2026-09-20: *"폴더이름 아래에 있는 거 이상하다고. 날짜 좁게 나오고 이게 뭐야?
    //   … 직접업로드 옆에, 업무, 회의 이런 거 옆에 나오게 배치를 해"*
    const card = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-folder-chip]')];
      if (!chips.length) return { none: true };
      const chip = chips[0];
      const cardEl = chip.closest('[data-file-id]');
      if (!cardEl) return { none: true };
      const tag = cardEl.querySelector('[data-folder-chip]')
        && [...cardEl.children].length ? cardEl.querySelector('div > div') : null;
      // 같은 부모(분류 줄) 안에 출처 태그가 있는가
      const rowKids = [...chip.parentElement.children];
      const sameRow = rowKids.length >= 2
        && Math.abs(rowKids[0].getBoundingClientRect().top - chip.getBoundingClientRect().top) <= 2;
      // 날짜가 잘리지 않는가 — 날짜 줄(마지막 meta)의 첫 span
      const metas = [...cardEl.querySelectorAll('div')].filter((d) => /\d{4}|\d+\.\d+/.test(d.textContent || '') && d.children.length);
      // 날짜 칸 = 마지막 줄의 첫 span. 글자 모양으로 찾으면 로케일마다 어긋난다("9월 8일").
      const dateSpan = cardEl.lastElementChild ? cardEl.lastElementChild.querySelector('span') : null;
      return {
        sameRow, rowKidCount: rowKids.length,
        chipTop: Math.round(chip.getBoundingClientRect().top),
        tagTop: rowKids[0] ? Math.round(rowKids[0].getBoundingClientRect().top) : null,
        dateClipped: dateSpan ? dateSpan.scrollWidth > dateSpan.clientWidth + 1 : null,
        dateText: dateSpan ? (dateSpan.textContent || '').trim() : null,
        // ★ 날짜 줄은 **카드의 마지막 줄**이다. 날짜 글자를 정규식으로 찾으려다 못 찾아
        //   판정이 null 로 빠졌다(형식이 로케일마다 다르다). 구조로 집는다.
        chipInDateLine: !!cardEl.lastElementChild
          && !!cardEl.lastElementChild.querySelector('[data-folder-chip]'),
        dateLineText: cardEl.lastElementChild ? (cardEl.lastElementChild.textContent || '').trim().slice(0, 24) : null,
        metasSeen: metas.length,
      };
    });
    if (card.none) skip('카드 — 폴더 칩 자리', '폴더에 든 파일이 화면에 없다');
    else {
      push('폴더 칩이 출처 태그와 같은 줄에 선다', card.sameRow,
        `줄 안 ${card.rowKidCount}개 · y 태그 ${card.tagTop} / 칩 ${card.chipTop}`);
      push('날짜 줄에는 폴더 칩이 없다', card.chipInDateLine === false, `마지막 줄 "${card.dateLineText}"`);
      if (card.dateClipped === null) skip('날짜가 잘리지 않는다', '날짜 칸을 못 찾았다');
      else push('날짜가 잘리지 않는다', !card.dateClipped, `"${card.dateText}"`);
    }

    // ── 목록 행의 «폴더이름 버튼» → 분류 칩 + 이동 아이콘 두 개로 갈랐다.
    //   ★ 리스트 뷰에서 잰다 — 그리드 카드에는 받기·삭제가 없어 «같은 크기인가» 를 잴 상대가 없다.
    await page.evaluate(() => {
      const b2 = document.querySelector('[data-testid="docs-view-list"]');
      if (b2) b2.click();
    });
    await b.sleep(1200);
    const row = await page.evaluate(() => {
      const moves = [...document.querySelectorAll('[data-testid^="docs-file-move-"]')];
      const siblings = moves.length
        ? [...moves[0].parentElement.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().height > 0)
        : [];
      return {
        move: moves.length,
        oldMenu: document.querySelectorAll('[data-testid^="docs-file-menu-"]').length,
        sizes: siblings.map((e) => Math.round(e.getBoundingClientRect().height)),
      };
    });
    push('행의 폴더이름 버튼이 사라졌다', row.oldMenu === 0, `옛 버튼 ${row.oldMenu}개`);
    push('행에 [이동] 아이콘이 있다', row.move >= 1, `${row.move}개`);
    if (row.sizes.length >= 2) {
      push('[이동] 이 같은 줄의 다른 아이콘과 같은 크기', new Set(row.sizes).size === 1, `높이 ${row.sizes.join('/')}`);
    } else skip('[이동] 크기 비교', `같은 줄 버튼 ${row.sizes.length}개`);
    // ── 로컬(OS) 파일을 **폴더 행 위에 바로** 떨어뜨리면 그 폴더로 올라간다.
    //   Irene 2026-09-20: *"로컬 파일로 있는 것도 폴더 위에 바로 올려서 못 넣어?"*
    //   여태는 상위 업로드 드롭존으로 흘러가 **보고 있던 폴더**로 들어갔다.
    const dropName = 'ZDROP-' + Date.now() + '.txt';
    const dropped = await page.evaluate((fid, nm) => {
      const menu = document.querySelector(`[data-testid="docs-folder-menu-${fid}"]`);
      const row = menu ? menu.closest('[data-folder-actions]').parentElement : null;
      if (!row) return 'no-row';
      const dt = new DataTransfer();
      try { dt.items.add(new File(['hello planq'], nm, { type: 'text/plain' })); } catch { return 'no-file'; }
      if (!dt.files.length) return 'no-file';
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return 'sent';
    }, folderId, dropName);
    if (dropped !== 'sent') skip('로컬 파일을 폴더에 바로 떨어뜨리기', `준비 실패(${dropped})`);
    else {
      await b.sleep(5000);
      const [got] = await sequelize.query(
        'SELECT id, folder_id FROM files WHERE file_name = :n ORDER BY id DESC LIMIT 1',
        { replacements: { n: dropName } });
      push('로컬 파일이 떨어뜨린 폴더로 올라간다',
        got.length === 1 && Number(got[0].folder_id) === Number(folderId),
        got.length ? `folder_id ${got[0].folder_id} (기대 ${folderId})` : '올라간 파일이 없다');
      if (got.length) uploadedIds.push(got[0].id);
    }
  } finally {
    try {
      if (uploadedIds.length) await sequelize.query('DELETE FROM files WHERE id IN (:ids)', { replacements: { ids: uploadedIds } });
      if (movedIds.length) await sequelize.query('UPDATE files SET folder_id=NULL WHERE id IN (:ids)', { replacements: { ids: movedIds } });
      await sequelize.query("DELETE FROM file_folders WHERE name LIKE 'ZMQ-%'");
    } catch { /* noop */ }
    try { await browser.close(); } catch { /* noop */ }
  }
  return results;
}

module.exports = { run };
