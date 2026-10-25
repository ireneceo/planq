// scripts/e2e/canary-editor-ctx.js — 문서 표 안 긴 링크 줄바꿈 + 편집기 우클릭 메뉴(링크·클립보드) (2026-10-25)
//
// Irene: *"문서 테이블들이 열 안에 링크값 너무 길게 하지 말고 잘리게 하거나 엔터값 들어가게 하는 거 안될까?
//         그리고 드래그해서 하이퍼링크 넣게 하는 우측 기능들 없는데 우리 솔루션 자체의 우측기능들을 구성해서
//         여기저기 우측 기능 사용하게 못할까?"*
//
//   재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440):
//     ① 편집 표에서 띄어쓰기 없는 긴 주소 — 폰은 칸 폭 ≤ 360px(문단 상한 320 + 칸 여백) · 태블릿·데스크탑은 표가 본문 안(가로 스크롤 없음)
//        양성 대조군: 상한을 꺼 두면 그 칸이 다시 늘어난다
//     ② 글자를 고르고 우클릭 → 우리 메뉴(«링크 넣기…») · 브라우저 메뉴 안 뜸(기본 동작 막힘) — 마우스가 있는 820·1440 만
//     ③ «링크 넣기…» → 입력 칸 → «example.org/x» + Enter → 고른 글자에 https://example.org/x 링크
//     ④ 링크 위 우클릭 → «링크 열기·링크 복사·링크 빼기» · «링크 빼기» → 링크 사라짐
//     ⑤ «복사» → 끝에서 «붙여넣기» → 같은 글이 한 번 더
//     ⑥ 대조군: Shift+우클릭은 우리 메뉴를 띄우지 않는다(브라우저 메뉴) · 편집기 밖 본문 글자 위도 띄우지 않는다
//     ⑦ 도구줄 🔗 → 같은 입력 칸(옛 window.prompt 아님)
//   새 문서는 자동 임시저장되므로 끝나면 표식 글(zqedctx)로 찾아 지운다.
const { launch, login, goto, sleep, dismissBlockers, BASE } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const MARK = 'zqedctx';
const LONG = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefGHIJ/edit?usp=sharing&ouid=1234567890123456789&rtpof=true';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const html = (page) => page.evaluate(() => document.querySelector('.ProseMirror').editor.getHTML());
// 문단 «needle» 안 글자를 골라 그 위에서 우클릭할 좌표를 돌려준다
const selectWord = (page, needle) => page.evaluate((n) => {
  const ed = document.querySelector('.ProseMirror').editor;
  let from = -1;
  ed.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text.includes(n)) from = pos + node.text.indexOf(n);
  });
  if (from < 0) return null;
  ed.chain().focus().setTextSelection({ from, to: from + n.length }).run();
  const a = ed.view.coordsAtPos(from); const b = ed.view.coordsAtPos(from + n.length);
  return { x: Math.round((a.left + b.left) / 2), y: Math.round((a.top + a.bottom) / 2) };
}, needle);
const menuKeys = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="app-context-menu"] [data-testid^="app-ctx-"]')].map((b) => b.getAttribute('data-testid').replace('app-ctx-', '')));
const closeMenu = (page) => page.keyboard.press('Escape').then(() => sleep(150));

async function oneWidth(width) {
  const tag = `${width}`;
  const { browser, page } = await launch();
  try {
    await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    await goto(page, '/docs');
    await sleep(2500);
    await dismissBlockers(page).catch(() => {});
    await page.evaluate(() => { const b = document.querySelector('[data-testid="docs-new"]'); if (b) b.click(); });
    await sleep(700);
    await page.evaluate(() => { const b = document.querySelector('[data-testid="docs-new-blank"]'); if (b) b.click(); });
    await sleep(2200);
    if (!(await page.$('.ProseMirror'))) { push(`[${tag}] 새 문서 편집기 열기`, false, '편집기를 못 열었다 — 판정 불가(실패)'); return; }
    await page.click('.ProseMirror');
    await page.keyboard.type(MARK);
    await page.keyboard.press('Enter');
    await sleep(3500);   // 새 문서 첫 자동저장(편집기가 다시 그려진다) 뒤에 잰다
    await page.evaluate((mark, long) => {
      const ed = document.querySelector('.ProseMirror').editor;
      const cell = (c) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: c }] });
      const head = (t) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
      ed.commands.setContent({ type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: `${mark} 링크걸기 대상 문단 복사원본 입니다` }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [head('항목'), head('링크'), head('메모')] },
          { type: 'tableRow', content: [cell([{ type: 'text', text: '견적' }]), cell([{ type: 'text', text: long, marks: [{ type: 'link', attrs: { href: long } }] }]), cell([{ type: 'text', text: '메모' }])] },
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: '끝줄' }] },
      ] }, { emitUpdate: true });
    }, MARK, LONG);
    await sleep(600);

    // ① 표 칸 폭
    const measure = () => page.evaluate(() => {
      const t = [...document.querySelectorAll('.ProseMirror table')].find((x) => x.innerText.includes('견적'));
      if (!t) return null;
      const host = t.closest('.tableWrapper') || t.parentElement;
      return { cell: Math.round(t.rows[1].cells[1].getBoundingClientRect().width), table: Math.round(t.getBoundingClientRect().width), host: host.clientWidth };
    });
    const m = await measure();
    // 폰은 세 칸 하한(96)만으로 본문을 넘어 가로 스크롤이 정상 — 칸 폭으로, 넓은 폭은 «표가 본문 안» 으로 판정
    //   (남는 자리는 min-width:100% 로 열들이 나눠 가지므로 칸 폭 자체는 상한보다 클 수 있다)
    const okW = !!m && (width < 700 ? m.cell <= 360 : m.table <= m.host);
    push(`[${tag}] ① 표 긴 주소 ${width < 700 ? '칸 ≤ 360px' : '— 표가 본문 안(가로 스크롤 없음)'}`, okW, m ? `칸 ${m.cell} · 표 ${m.table} / 본문 ${m.host}` : '표 없음');
    await page.evaluate(() => { const s = document.createElement('style'); s.id = 'zq-ctl'; s.textContent = '.ProseMirror table p{max-width:none!important}'; document.head.appendChild(s); });
    await sleep(200);
    const mc = await measure();
    await page.evaluate(() => document.getElementById('zq-ctl')?.remove());
    push(`[${tag}] ① 양성 대조군: 상한을 끄면 칸이 다시 늘어난다`, !!mc && !!m && mc.cell > m.cell + 30, mc ? `칸 ${m && m.cell} → ${mc.cell}` : '표 없음');

    // ⑦ 도구줄 🔗
    await selectWord(page, '링크걸기');
    await page.evaluate(() => document.querySelector('[data-testid="editor-link"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await sleep(250);
    const toolForm = await page.$('[data-testid="app-ctx-link-form"]');
    push(`[${tag}] ⑦ 도구줄 🔗 → 링크 입력 칸`, !!toolForm, toolForm ? '열림' : '안 열림');
    if (toolForm) await page.keyboard.press('Escape');
    await sleep(150);

    if (width < 700) { await sleep(2500); return; }   // 폰은 우클릭 대신 길게 누르기(브라우저 몫) — 메뉴 시험은 마우스 폭만

    // ② 고른 글자 위 우클릭
    const pt = await selectWord(page, '링크걸기');
    const prevP = page.evaluate(() => new Promise((res) => {
      const h = (e) => { document.removeEventListener('contextmenu', h); setTimeout(() => res(e.defaultPrevented), 0); };
      document.addEventListener('contextmenu', h);
      setTimeout(() => res('no-event'), 3000);
    }));
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
    const dp = await prevP;
    await sleep(200);
    const keys = await menuKeys(page);
    push(`[${tag}] ② 고른 글자 우클릭 → 우리 메뉴(링크 넣기) · 브라우저 메뉴 막힘`, keys.includes('ed-link') && keys.includes('ed-copy') && dp === true, `${keys.join(',')} · prevented=${dp}`);

    // ③ 링크 넣기
    await page.click('[data-testid="app-ctx-ed-link"]').catch(() => {});
    await sleep(250);
    if (await page.$('[data-testid="app-ctx-link-input"]')) {
      await page.type('[data-testid="app-ctx-link-input"]', 'example.org/x');
      await page.keyboard.press('Enter');
      await sleep(300);
    }
    const h3 = await html(page);
    push(`[${tag}] ③ 링크 넣기 → 고른 글자에 https://example.org/x`, /<a [^>]*href="https:\/\/example\.org\/x"[^>]*>링크걸기<\/a>/.test(h3), (h3.match(/<a [^>]*>링크걸기<\/a>/) || ['링크 없음'])[0]);

    // ④ 링크 위 우클릭 → 열기·복사·빼기
    const pt2 = await selectWord(page, '링크걸기');
    await page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; const { from } = ed.state.selection; ed.commands.setTextSelection(from + 1); });
    await page.mouse.click(pt2.x, pt2.y, { button: 'right' });
    await sleep(200);
    const keys4 = await menuKeys(page);
    const hasAll = ['ed-link-open', 'ed-link-copy', 'ed-link-remove'].every((k) => keys4.includes(k));
    if (keys4.includes('ed-link-remove')) await page.click('[data-testid="app-ctx-ed-link-remove"]');
    await sleep(250);
    const h4 = await html(page);
    push(`[${tag}] ④ 링크 위 우클릭 → 열기·복사·빼기 · 빼기 → 링크 사라짐`, hasAll && !/example\.org\/x/.test(h4), `${keys4.join(',')} · 남음=${/example\.org\/x/.test(h4)}`);

    // ⑤ 복사 → 붙여넣기
    const pt5 = await selectWord(page, '복사원본');
    await page.mouse.click(pt5.x, pt5.y, { button: 'right' });
    await sleep(200);
    await page.click('[data-testid="app-ctx-ed-copy"]').catch(() => {});
    await sleep(200);
    await page.evaluate(() => document.querySelector('.ProseMirror').editor.chain().focus('end').run());
    const endPt = await page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; const c = ed.view.coordsAtPos(ed.state.selection.from); return { x: Math.round(c.left), y: Math.round((c.top + c.bottom) / 2) }; });
    await page.mouse.click(endPt.x, endPt.y, { button: 'right' });
    await sleep(200);
    await page.click('[data-testid="app-ctx-ed-paste"]').catch(() => {});
    await sleep(600);
    const n5 = ((await html(page)).match(/복사원본/g) || []).length;
    push(`[${tag}] ⑤ 복사 → 끝에서 붙여넣기 → «복사원본» 2번`, n5 === 2, `${n5}번`);

    // ⑥ 대조군 — Shift+우클릭 · 편집기 밖
    const pt6 = await selectWord(page, '대상');
    await page.keyboard.down('Shift');
    await page.mouse.click(pt6.x, pt6.y, { button: 'right' });
    await page.keyboard.up('Shift');
    await sleep(200);
    const shiftMenu = !!(await page.$('[data-testid="app-context-menu"]'));
    await closeMenu(page);
    const outside = await page.evaluate(() => {
      const el = [...document.querySelectorAll('p, span, div')].find((x) => x.childElementCount === 0 && x.textContent.trim().length > 3 && !x.closest('.ProseMirror, a, button, [contenteditable], input, textarea, [data-pq-context], [data-ctx-tab-id]') && x.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) };
    });
    let outsideMenu = null;
    if (outside) { await page.mouse.click(outside.x, outside.y, { button: 'right' }); await sleep(200); outsideMenu = !!(await page.$('[data-testid="app-context-menu"]')); await closeMenu(page); }
    push(`[${tag}] ⑥ 대조군: Shift+우클릭·편집기 밖 글자 → 우리 메뉴 없음`, !shiftMenu && outsideMenu === false, `shift=${shiftMenu} · 밖=${outsideMenu}`);
    await sleep(2500);   // 자동 임시저장이 표식 글을 저장할 때까지 — 정리에서 찾을 수 있게
  } finally {
    await browser.close();
  }
}

async function run() {
  const since = new Date(Date.now() - 60 * 1000);
  try {
    for (const w of (process.env.W ? [Number(process.env.W)] : [390, 820, 1440])) await oneWidth(w);
  } finally {
    const [rows] = await sequelize.query('SELECT id FROM posts WHERE created_at >= ? AND (content_json LIKE ? OR content_text LIKE ? OR title LIKE ?)', { replacements: [since, `%${MARK}%`, `%${MARK}%`, `%${MARK}%`] }).catch(() => [[]]);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await sequelize.query('DELETE FROM post_revisions WHERE post_id IN (?)', { replacements: [ids] }).catch(() => {});
      await sequelize.query('DELETE FROM posts WHERE id IN (?)', { replacements: [ids] }).catch(() => {});
    }
    push('정리 — 검사 문서 삭제', true, `${ids.length}건`);
  }
  return results;
}

module.exports = { name: '문서 표 긴 링크 줄바꿈 + 편집기 우클릭 메뉴(링크·클립보드) (3폭)', run };
