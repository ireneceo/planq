// scripts/e2e/canary-table-style.js — 표 글자 서식 · 행/열 끼워넣기 (2026-10-11)
//
// Irene: *"표에는 에디터가 왜 안돼? 글자들 색상 굵기 크기 조정이 안되는데? 그리고 행사이에 행을 추가하거나
//          열 사이에 열을 추가하고 싶은 건 어떻게 해? 문서 안의 표, 표 형식 문서의 표. 어느 것이든 다 같이 체크해줘"*
//
//   A. 문서 안의 표(편집기) — 데스크탑·폰
//     ① 칸 글자를 고르고 [A] → 빨강·크게 → 그 글자가 빨강·1.25em 으로 **보인다**(계산된 스타일)
//     ② B → 굵게
//     ③ 표 안 버블 ＋행↓ / ＋열→ 로 행·열이 하나씩 는다(사이에 끼워짐)
//   B. 표 형식 문서(그리드) — 폰 390 · 태블릿 820 · 데스크탑 1440
//     ④ 행 번호 메뉴 «아래에 행 추가» → 1행 바로 밑에 새 행(줄 수 +1, 원래 2행 글자가 3행으로)
//     ⑤ 열 설정 «오른쪽에 열 추가» → 열 수 +1, 새 열이 1열 바로 오른쪽
//     ⑥ 칸을 누르고 B · 빨강 → 칸이 굵게·빨강으로 **보이고**, 새로고침 뒤에도 남는다
//     ⑦ 음성 대조군 — 서식 안 건 옆 칸은 기본색·보통 굵기
//   픽스처는 Node 에서 API 로 만들고(브라우저 안에서 만들지 않는다) 끝나면 지운다.
const { launch, login, goto, sleep, dismissBlockers, BASE, CREDS } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = 'http://127.0.0.1:3003';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function api(path, opt = {}, tok) {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } });
  return r.json().catch(() => ({}));
}

const cellText = (txt) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: txt ? [{ type: 'text', text: txt }] : [] }] });
const DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'zqtable 문서' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cellText('zqA1'), cellText('zqB1')] },
      { type: 'tableRow', content: [cellText('zqA2'), cellText('zqB2')] },
    ] },
  ],
};


// 보이는 것만 누른다 — 데스크탑 탭 모드는 앞서 연 화면을 숨긴 채 살려 두어 같은 data-testid 가 여러 벌이다
async function clickVisible(page, sel) {
  const box = await page.evaluate((q) => {
    // offsetParent 는 position:fixed(포털 메뉴)에서 늘 null 이다 — checkVisibility 로 숨김(display:none 조상)만 거른다
    const el = [...document.querySelectorAll(q)].find((e) => { const r = e.getBoundingClientRect(); return (e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null) && r.width > 0 && r.height > 0; });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) throw new Error(`보이는 요소 없음: ${sel}`);
  await page.mouse.click(box.x, box.y);
}

async function partDocTable(width, docId) {
  const tag = `[문서 표 ${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    await goto(page, `/docs?post=${docId}`);
    await sleep(2500);
    await dismissBlockers(page).catch(() => {});
    const edit = await page.$('[data-testid="post-edit"]');
    if (!edit) { push(`${tag} 편집 열기`, false, '편집 버튼 없음 — 판정 불가(실패)'); return; }
    await edit.click();
    await sleep(1800);
    // zqA1 글자를 고른다
    const ok = await page.evaluate(() => {
      const td = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes('zqA1'));
      const tn = td && td.querySelector('p') && td.querySelector('p').firstChild;
      if (!tn) return false;
      (document.querySelector('.ProseMirror')).focus();
      const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, tn.textContent.length);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    });
    if (!ok) { push(`${tag} 칸 글자 고르기`, false, '표 칸을 못 찾음'); return; }
    await sleep(400);
    await clickVisible(page, '[data-testid="editor-style-open"]');
    await sleep(300);
    const popVisible = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="editor-style-pop"]');
      if (!p) return false;
      const r = p.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
      return r.width > 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1 && !!hit && p.contains(hit);
    });
    push(`${tag} ① [A] 메뉴가 화면 안에 보인다`, popVisible, `보임 ${popVisible}`);
    await clickVisible(page, '[data-testid="editor-style-color-red"]');
    await sleep(200);
    await clickVisible(page, '[data-testid="editor-style-size-large"]');
    await sleep(300);
    const st = await page.evaluate(() => {
      const td = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes('zqA1'));
      const sp = td && td.querySelector('span[style]');
      const tdB = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes('zqB1'));
      const pB = tdB && tdB.querySelector('p');
      return {
        color: sp ? getComputedStyle(sp).color : '', fs: sp ? parseFloat(getComputedStyle(sp).fontSize) : 0,
        base: pB ? parseFloat(getComputedStyle(pB).fontSize) : 0, baseColor: pB ? getComputedStyle(pB).color : '',
      };
    });
    push(`${tag} ① 고른 칸 글자 빨강 · 크게(1.25배)`, st.color === 'rgb(220, 38, 38)' && Math.abs(st.fs / st.base - 1.25) < 0.05,
      `색 ${st.color} · 크기 ${st.fs}/${st.base}`);
    push(`${tag} ⑦ 옆 칸은 그대로(음성 대조군)`, st.baseColor !== 'rgb(220, 38, 38)', `옆 칸 색 ${st.baseColor}`);
    // ② 굵게 — 툴바 B (title 굵게)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'B' && x.closest('[class]') && x.offsetParent);
      b && b.click();
    });
    await sleep(300);
    const bold = await page.evaluate(() => {
      const td = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes('zqA1'));
      return !!(td && td.querySelector('strong'));
    });
    push(`${tag} ② 표 칸 글자 굵게`, bold, `strong ${bold}`);
    // ③ 버블 ＋행↓ · ＋열→ (표 안 커서일 때)
    const count = () => page.evaluate(() => {
      const t = document.querySelector('.ProseMirror table');
      return t ? { rows: t.querySelectorAll('tr').length, cols: t.querySelector('tr').children.length } : null;
    });
    const before = await count();
    await page.evaluate(() => {
      const td = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes('zqA1'));
      const tn = td.querySelector('p').lastChild;
      const r = document.createRange(); r.selectNodeContents(td.querySelector('p')); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return !!tn;
    });
    await sleep(600);
    const clickBubble = (re) => page.evaluate((src) => {
      const rx = new RegExp(src);
      const b = [...document.querySelectorAll('.pq-editor-bubble button')].find((x) => rx.test(x.textContent || '') && x.offsetParent);
      if (!b) return false;
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return true;
    }, re.source);
    const r1 = await clickBubble(/행↓|row ?↓|Row ?below/i);
    await sleep(400);
    const c1 = await clickBubble(/열→|col.*→|Col.*right/i);
    await sleep(400);
    const after = await count();
    const order = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map((tr) => tr.children[0].textContent.trim()).join('|'));
    push(`${tag} ③ 버블로 행·열이 사이에 끼워진다`, r1 && c1 && after && before && after.rows === before.rows + 1 && after.cols === before.cols + 1 && /^zqA1\|\|zqA2/.test(order),
      `버블 ${r1}/${c1} · 행 ${before && before.rows}→${after && after.rows} · 열 ${before && before.cols}→${after && after.cols} · 첫 열 «${order}»`);
  } finally { await browser.close(); }
}

async function partGrid(width, postId) {
  const tag = `[표 문서 ${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));   // 떠날 때 확인창이 뜨면 정지하지 않게
    await goto(page, `/docs?post=${postId}`);
    await sleep(2800);
    await dismissBlockers(page).catch(() => {});
    // ⓪ 보기 화면은 읽기 전용 — 행 메뉴가 없어야 한다(음성 대조군)
    const viewMenus = (await page.$$('[data-testid="table-row-menu"]')).length;
    const viewBar = !!(await page.$('[data-testid="table-format-bar"]'));
    push(`${tag} ⓪ 보기 화면엔 편집 메뉴·서식 줄 없음`, viewMenus === 0 && !viewBar, `메뉴 ${viewMenus} · 서식 줄 ${viewBar}`);
    await clickVisible(page, '[data-testid="post-edit"]');
    await sleep(2200);
    const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="table-cell-"]')].filter((e) => e.offsetParent !== null)
      .reduce((m, td) => { const i = td.getAttribute('data-testid').split('-')[2]; m[i] = (m[i] || 0) + 1; return m; }, {}));
    const firstColTexts = () => page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((e) => e.offsetParent !== null)
      .map((tr) => { const td = tr.querySelector('[data-testid^="table-cell-"]'); const inp = td && td.querySelector('input,textarea'); return inp ? inp.value : (td ? td.textContent.trim() : null); })
      .filter((x) => x !== null).join('|'));
    const r0 = await rows();
    if (!Object.keys(r0).length) { push(`${tag} 표 그리드 열기`, false, '칸을 못 찾음 — 판정 불가(실패)'); return; }
    const before = await firstColTexts();
    // ④ 1행 메뉴 → 아래에 행 추가
    await clickVisible(page, '[data-testid="table-row-menu"]');
    await sleep(300);
    const menuOk = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="table-row-menu-pop"]');
      if (!m) return false;
      const r = m.getBoundingClientRect();
      return r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
    });
    await clickVisible(page, '[data-testid="table-row-insert-below"]');
    await sleep(1200);
    const afterRows = await firstColTexts();
    push(`${tag} ④ «아래에 행 추가» 가 1행 바로 밑에 끼워진다`, menuOk && afterRows.split('|').length === before.split('|').length + 1 && afterRows.startsWith('zqR1||zqR2'),
      `메뉴 보임 ${menuOk} · «${before}» → «${afterRows}»`);
    // ⑤ 1열 설정 → 오른쪽에 열 추가
    const heads0 = await page.evaluate(() => [...document.querySelectorAll('thead th')].filter((e) => e.offsetParent !== null).length);
    await clickVisible(page, 'thead th:nth-child(2) div div');
    await sleep(500);
    const ins = await page.$('[data-testid="table-col-insert-right"]');
    if (ins) { await clickVisible(page, '[data-testid="table-col-insert-right"]'); await sleep(1200); }
    const heads1 = await page.evaluate(() => [...document.querySelectorAll('thead th')].filter((e) => e.offsetParent !== null).map((th) => th.textContent.trim()));
    push(`${tag} ⑤ «오른쪽에 열 추가» 로 1열 바로 옆에 새 열`, !!ins && heads1.length === heads0 + 1 && heads1[1].startsWith('zqColA') && !heads1[2].startsWith('zqColB'),
      `버튼 ${!!ins} · 머리 ${heads0} → ${heads1.length} «${heads1.slice(1, 4).join(' / ')}»`);
    // ⑥ 1행 1열 칸을 누르고 B · 빨강
    await clickVisible(page, '[data-testid^="table-cell-0-"]');
    await sleep(300);
    await clickVisible(page, '[data-testid="table-format-bold"]');
    await sleep(900);
    await clickVisible(page, '[data-testid="table-format-open"]');
    await sleep(300);
    await clickVisible(page, '[data-testid="table-format-color-red"]');
    await sleep(1200);
    const look = () => page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-testid^="table-cell-0-"]')].filter((e) => e.offsetParent !== null);
      const td = cells[0];
      const inp = td && (td.querySelector('input,textarea') || td);
      const td2 = cells[1];
      const inp2 = td2 && (td2.querySelector('input,textarea') || td2);
      const cs = inp ? getComputedStyle(inp) : null; const cs2 = inp2 ? getComputedStyle(inp2) : null;
      return { color: cs && cs.color, weight: cs && cs.fontWeight, color2: cs2 && cs2.color, weight2: cs2 && cs2.fontWeight };
    });
    const l1 = await look();
    push(`${tag} ⑥ 고른 칸이 굵게·빨강으로 보인다`, l1.color === 'rgb(220, 38, 38)' && Number(l1.weight) >= 700, `색 ${l1.color} · 굵기 ${l1.weight}`);
    push(`${tag} ⑦ 옆 칸은 기본(음성 대조군)`, l1.color2 !== 'rgb(220, 38, 38)' && Number(l1.weight2) < 700, `옆 칸 색 ${l1.color2} · 굵기 ${l1.weight2}`);
    await goto(page, `/docs?post=${postId}`);   // 새로 열기 = 보기(읽기 전용) 화면
    await sleep(2800);
    const l2 = await look();
    push(`${tag} ⑥ 다시 열어도(보기 화면) 서식이 남는다`, l2.color === 'rgb(220, 38, 38)' && Number(l2.weight) >= 700, `색 ${l2.color} · 굵기 ${l2.weight}`);
    const pageW = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, w: window.innerWidth }));
    push(`${tag} 페이지가 가로로 밀리지 않는다`, pageW.d <= pageW.w + 2, `문서 ${pageW.d} / 창 ${pageW.w}`);
  } finally { await browser.close(); }
}

async function run() {
  const lg = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(CREDS) });
  const tok = lg.data && (lg.data.token || lg.data.access_token || lg.data.accessToken);
  const u = lg.data && lg.data.user;
  const biz = u && (u.active_business_id || u.business_id);
  const made = [];
  try {
    if (!tok || !biz) { push('픽스처 로그인', false, '토큰·워크스페이스 없음'); return results; }
    // A 픽스처 — 표가 든 문서
    const d = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqtable-doc', content_json: DOC, kind: 'doc' }) }, tok);
    // B 픽스처 — 표 문서(기본 3열 + 빈 행 1) → 1열 이름·행 값 채우기
    const g = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqtable-grid', kind: 'table' }) }, tok);
    const docId = d.data && d.data.id; const gridId = g.data && g.data.id;
    if (docId) made.push(docId); if (gridId) made.push(gridId);
    const recId = g.data && g.data.q_record_id;
    if (!docId || !gridId || !recId) { push('픽스처 만들기', false, JSON.stringify({ d: !!docId, g: !!gridId, recId })); return results; }
    const rec = await api(`/api/records/${recId}`, {}, tok);
    const cols = rec.data.columns.map((c, i) => (i === 0 ? { ...c, name: 'zqColA' } : i === 1 ? { ...c, name: 'zqColB' } : c));
    await api(`/api/records/${recId}`, { method: 'PUT', body: JSON.stringify({ columns: cols }) }, tok);
    const c0 = cols[0].id;
    await api(`/api/records/${recId}/rows/${rec.data.rows[0].id}`, { method: 'PUT', body: JSON.stringify({ values: { [c0]: 'zqR1' } }) }, tok);
    await api(`/api/records/${recId}/rows`, { method: 'POST', body: JSON.stringify({ values: { [c0]: 'zqR2' } }) }, tok);

    for (const w of [1440, 390]) await partDocTable(w, docId).catch((e) => push(`[문서 표 ${w}] 실행`, false, e.message));
    for (const w of [390, 820, 1440]) {
      // 폭마다 같은 시작 상태 — 앞 폭에서 늘린 행·열·서식을 되돌린다
      await api(`/api/records/${recId}`, { method: 'PUT', body: JSON.stringify({ columns: cols }) }, tok);
      const cur = await api(`/api/records/${recId}`, {}, tok);
      for (const r of cur.data.rows) {
        const v = r.values || {};
        if (v[c0] !== 'zqR1' && v[c0] !== 'zqR2') await api(`/api/records/${recId}/rows/${r.id}`, { method: 'DELETE' }, tok);
        else if (v._fmt) await api(`/api/records/${recId}/rows/${r.id}`, { method: 'PUT', body: JSON.stringify({ values: { _fmt: {} } }) }, tok);
      }
      await partGrid(w, gridId).catch((e) => push(`[표 문서 ${w}] 실행`, false, e.message));
    }
  } finally {
    for (const id of made) {
      const [[p]] = await sequelize.query('SELECT q_record_id FROM posts WHERE id = ?', { replacements: [id] }).catch(() => [[{}]]);
      if (p && p.q_record_id) {
        await sequelize.query('DELETE FROM q_record_audits WHERE q_record_id = ?', { replacements: [p.q_record_id] }).catch(() => {});
        await sequelize.query('DELETE FROM q_record_rows WHERE q_record_id = ?', { replacements: [p.q_record_id] }).catch(() => {});
      }
      await sequelize.query('DELETE FROM post_revisions WHERE post_id = ?', { replacements: [id] }).catch(() => {});
      await sequelize.query('DELETE FROM posts WHERE id = ?', { replacements: [id] }).catch(() => {});
      if (p && p.q_record_id) await sequelize.query('DELETE FROM q_records WHERE id = ?', { replacements: [p.q_record_id] }).catch(() => {});
    }
    push('정리 — 검사 문서 삭제', true, `${made.length}건`);
  }
  return results;
}

module.exports = { name: '표 글자 서식 · 행/열 끼워넣기 (문서 안 표 + 표 문서)', run };
