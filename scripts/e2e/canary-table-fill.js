// scripts/e2e/canary-table-fill.js — 표 칸·열·행 채우기 색 (2026-10-12)
//
// Irene: *"문서 표에서 열에 색상넣게 기능 넣어줄 수 있어? 글자굵게하고 색상도"*
//
//   A. 문서 안의 표(편집기) — 폰 390 · 태블릿 820 · 데스크탑 1440
//     ① 표 안 커서 → 버블 [칸 색] 팝오버가 화면 안에 보이고 누를 수 있다(elementFromPoint)
//     ② 기본 범위 «열 전체» + 하늘 → 1열 칸 전부가 하늘색, 2열은 그대로(음성 대조군)
//     ③ 범위 «고른 칸» + 노랑 → 그 칸만 노랑, 같은 열의 다른 칸은 하늘 그대로
//     ④ «없음» → 지워진다
//   B. 저장본 보기 — 칸 색이 든 JSON 을 API 로 저장 → 보기 화면(읽기 전용)에 색이 보인다 · PDF/워드 변환에도 실린다
//   C. 표 문서(그리드) — 3폭
//     ⑤ 열 설정 «열 색» 연두 → 저장 → 머리칸·그 열 칸이 연두, 옆 열은 그대로 · API 에 bg 저장
//     ⑥ 다시 열어도(보기 화면) 남는다 · 칸 서식 배경(_fmt.bg)이 있으면 그것이 위
//   픽스처는 Node 에서 API 로 만들고 끝나면 지운다.
const { launch, login, goto, sleep, dismissBlockers, CREDS } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = 'http://127.0.0.1:3003';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });
const SKY = 'rgb(219, 234, 254)', YELLOW = 'rgb(254, 249, 195)', MINT = 'rgb(220, 252, 231)';

async function api(path, opt = {}, tok) {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } });
  return r.json().catch(() => ({}));
}
const cell = (txt, fill) => ({ type: 'tableCell', attrs: fill ? { backgroundColor: fill } : {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: txt }] }] });
const docOf = (fillA2) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'zqfill 문서' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('zqA1'), cell('zqB1')] },
      { type: 'tableRow', content: [cell('zqA2', fillA2), cell('zqB2')] },
    ] },
  ],
});

async function clickVisible(page, sel) {
  const box = await page.evaluate((q) => {
    const el = [...document.querySelectorAll(q)].find((e) => { const r = e.getBoundingClientRect(); return (e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null) && r.width > 0 && r.height > 0; });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) throw new Error(`보이는 요소 없음: ${sel}`);
  await page.mouse.click(box.x, box.y);
}
const bgOf = (page) => page.evaluate(() => {
  const m = {};
  document.querySelectorAll('.ProseMirror td, .ProseMirror th').forEach((td) => {
    if (!(td.checkVisibility ? td.checkVisibility() : true)) return;
    const k = td.textContent.trim(); if (/^zq[AB][12]$/.test(k)) m[k] = getComputedStyle(td).backgroundColor;
  });
  return m;
});
const caretIn = (page, txt) => page.evaluate((t) => {
  const td = [...document.querySelectorAll('.ProseMirror td')].find((x) => x.textContent.includes(t) && (x.checkVisibility ? x.checkVisibility() : true));
  if (!td) return false;
  document.querySelector('.ProseMirror').focus();
  const r = document.createRange(); r.selectNodeContents(td.querySelector('p')); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  return true;
}, txt);

async function partDocTable(width, docId) {
  const tag = `[문서 표 ${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await goto(page, `/docs?post=${docId}`);
    await sleep(2600);
    await dismissBlockers(page).catch(() => {});
    // B — 저장본 보기(읽기 전용): zqA2 가 노랑으로 저장돼 있다
    const view = await bgOf(page);
    push(`${tag} B 보기 화면에 저장된 칸 색이 보인다`, view.zqA2 === YELLOW && view.zqA1 !== YELLOW, JSON.stringify(view));
    await clickVisible(page, '[data-testid="post-edit"]');
    await sleep(1800);
    if (!(await caretIn(page, 'zqA1'))) { push(`${tag} 표 칸 커서`, false, '칸 못 찾음'); return; }
    await sleep(700);
    await clickVisible(page, '[data-testid="editor-table-fill-open"]');
    await sleep(400);
    const pop = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="editor-table-fill-pop"]');
      if (!p) return { ok: false };
      const sw = p.querySelector('[data-testid="editor-table-fill-blue"]').getBoundingClientRect();
      const hit = document.elementFromPoint(sw.left + sw.width / 2, sw.top + sw.height / 2);
      const r = p.getBoundingClientRect();
      return { ok: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && !!hit && p.contains(hit),
        colOn: p.querySelector('[data-testid="editor-table-fill-scope-col"]').getAttribute('aria-checked') === 'true', r: [r.left, r.top, r.right, r.bottom].map(Math.round) };
    });
    push(`${tag} ① [칸 색] 팝오버가 화면 안에 보이고 누를 수 있다 · 기본 범위 열 전체`, pop.ok && pop.colOn, JSON.stringify(pop));
    await clickVisible(page, '[data-testid="editor-table-fill-blue"]');
    await sleep(400);
    const b1 = await bgOf(page);
    push(`${tag} ② 열 전체 하늘 — 1열 두 칸 다, 2열은 그대로`, b1.zqA1 === SKY && b1.zqA2 === SKY && b1.zqB1 !== SKY && b1.zqB2 !== SKY, JSON.stringify(b1));
    await clickVisible(page, '[data-testid="editor-table-fill-scope-cell"]');
    await sleep(150);
    await clickVisible(page, '[data-testid="editor-table-fill-yellow"]');
    await sleep(400);
    const b2 = await bgOf(page);
    push(`${tag} ③ 고른 칸만 노랑 — 같은 열 다른 칸은 하늘 그대로`, b2.zqA1 === YELLOW && b2.zqA2 === SKY && b2.zqB1 !== YELLOW, JSON.stringify(b2));
    await clickVisible(page, '[data-testid="editor-table-fill-scope-row"]');
    await sleep(150);
    await clickVisible(page, '[data-testid="editor-table-fill-none"]');
    await sleep(400);
    const b3 = await bgOf(page);
    push(`${tag} ④ 행 전체 «없음» — 1행 두 칸이 지워지고 2행은 그대로`, b3.zqA1 !== YELLOW && b3.zqA1 !== SKY && b3.zqA2 === SKY, JSON.stringify(b3));
    const pageW = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, w: innerWidth }));
    push(`${tag} 페이지가 가로로 밀리지 않는다`, pageW.d <= pageW.w + 2, `문서 ${pageW.d} / 창 ${pageW.w}`);
  } finally { await browser.close(); }
}

async function partGrid(width, postId, recId, tok) {
  const tag = `[표 문서 ${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await goto(page, `/docs?post=${postId}`);
    await sleep(2800);
    await dismissBlockers(page).catch(() => {});
    await clickVisible(page, '[data-testid="post-edit"]');
    await sleep(2200);
    await clickVisible(page, 'thead th:nth-child(2) div div');
    await sleep(500);
    const sw = await page.$('[data-testid="table-col-fill-green"]');
    if (!sw) { push(`${tag} ⑤ 열 설정에 «열 색»`, false, '견본 없음'); return; }
    await clickVisible(page, '[data-testid="table-col-fill-green"]');
    await sleep(150);
    await page.evaluate(() => {
      const d = document.querySelector('[aria-modal="true"]');
      const b = d && [...d.querySelectorAll('button')].find((x) => /^(저장|Save)$/.test(x.textContent.trim()));
      b && b.click();
    });
    await sleep(1400);
    const look = () => page.evaluate(() => {
      const vis = (e) => (e.checkVisibility ? e.checkVisibility() : true);
      const heads = [...document.querySelectorAll('thead th')].filter(vis);
      const rowCells = (i) => [...document.querySelectorAll(`[data-testid^="table-cell-${i}-"]`)].filter(vis);
      return { h1: heads[1] && getComputedStyle(heads[1]).backgroundColor, h2: heads[2] && getComputedStyle(heads[2]).backgroundColor,
        r0c0: rowCells(0)[0] && getComputedStyle(rowCells(0)[0]).backgroundColor, r0c1: rowCells(0)[1] && getComputedStyle(rowCells(0)[1]).backgroundColor,
        r1c0: rowCells(1)[0] && getComputedStyle(rowCells(1)[0]).backgroundColor };
    });
    const l1 = await look();
    const rec = await api(`/api/records/${recId}`, {}, tok);
    const savedBg = rec.data && rec.data.columns[0].bg;
    // 2행 1열은 칸 서식 배경(_fmt.bg=yellow, 글자 배경 팔레트 #FEF08A)이 있다 → 그것이 위
    push(`${tag} ⑤ 열 색 연두 — 머리칸·그 열 칸 연두 · 옆 열 그대로 · 저장 bg=green`,
      l1.h1 === MINT && l1.r0c0 === MINT && l1.h2 !== MINT && l1.r0c1 !== MINT && savedBg === 'green', JSON.stringify({ ...l1, savedBg }));
    push(`${tag} ⑥ 칸 서식 배경이 있는 칸은 그 색이 위`, l1.r1c0 === 'rgb(254, 240, 138)', `2행 1열 ${l1.r1c0}`);
    await goto(page, `/docs?post=${postId}`);
    await sleep(2800);
    const l2 = await look();
    push(`${tag} ⑥ 다시 열어도(보기 화면) 열 색이 남는다`, l2.h1 === MINT && l2.r0c0 === MINT && l2.h2 !== MINT, JSON.stringify(l2));
    const pageW = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, w: innerWidth }));
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
    const d = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqfill-doc', content_json: docOf('#FEF9C3'), kind: 'doc' }) }, tok);
    const g = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqfill-grid', kind: 'table' }) }, tok);
    const docId = d.data && d.data.id; const gridId = g.data && g.data.id; const recId = g.data && g.data.q_record_id;
    if (docId) made.push(docId); if (gridId) made.push(gridId);
    if (!docId || !gridId || !recId) { push('픽스처 만들기', false, JSON.stringify({ docId, gridId, recId })); return results; }
    // B — 서버 변환: PDF HTML · 워드에 칸 색이 실리고, 모양이 틀린 값은 버린다(음성 대조군)
    const { richBodyToHtml } = require('/opt/planq/dev-backend/services/pdfTemplates');
    const bad = docOf('red;background:url(x)');
    const html = richBodyToHtml(docOf('#FEF9C3'), null, '');
    const htmlBad = richBodyToHtml(bad, null, '');
    push('B PDF 변환: 칸 색 실림 · 이상한 값은 버림', /<td style="background-color:#FEF9C3">/.test(html) && !/url\(/.test(htmlBad) && !/<td style=/.test(htmlBad), html.match(/<td[^>]*>/g).join(' '));
    const { buildDocx } = require('/opt/planq/dev-backend/services/docxService');
    const buf = await buildDocx({ title: 'x', content: docOf('#FEF9C3') });
    const xml = await new Promise((res) => {
      const { execFileSync } = require('child_process'); const fs = require('fs'); const p = `/tmp/zqfill-${process.pid}.docx`;
      fs.writeFileSync(p, buf); try { res(execFileSync('unzip', ['-p', p, 'word/document.xml']).toString()); } catch { res(''); } finally { fs.unlinkSync(p); }
    });
    push('B 워드 변환: 칸 음영 FEF9C3', /w:fill="FEF9C3"/.test(xml), `음영 ${(xml.match(/w:fill="[0-9A-F]+"/g) || []).join(',')}`);

    const rec = await api(`/api/records/${recId}`, {}, tok);
    const cols = rec.data.columns.map((c, i) => (i === 0 ? { ...c, name: 'zqColA' } : i === 1 ? { ...c, name: 'zqColB' } : c));
    const c0 = cols[0].id;
    await api(`/api/records/${recId}/rows/${rec.data.rows[0].id}`, { method: 'PUT', body: JSON.stringify({ values: { [c0]: 'zqR1' } }) }, tok);
    await api(`/api/records/${recId}/rows`, { method: 'POST', body: JSON.stringify({ values: { [c0]: 'zqR2', _fmt: { [c0]: { bg: 'yellow' } } } }) }, tok);
    // 서버 검증: 이상한 열 색 값은 저장되지 않는다(음성 대조군)
    await api(`/api/records/${recId}`, { method: 'PUT', body: JSON.stringify({ columns: cols.map((c, i) => (i === 0 ? { ...c, bg: '#ff0000' } : c)) }) }, tok);
    const rb = await api(`/api/records/${recId}`, {}, tok);
    push('C 서버: 팔레트 key 가 아닌 열 색은 버린다', rb.data.columns[0].bg === undefined, `bg=${rb.data.columns[0].bg}`);

    for (const w of [1440, 820, 390]) {
      await api(`/api/posts/${docId}`, { method: 'PUT', body: JSON.stringify({ content_json: docOf('#FEF9C3') }) }, tok);
      await partDocTable(w, docId).catch((e) => push(`[문서 표 ${w}] 실행`, false, e.message));
    }
    for (const w of [1440, 820, 390]) {
      await api(`/api/records/${recId}`, { method: 'PUT', body: JSON.stringify({ columns: cols }) }, tok);
      await partGrid(w, gridId, recId, tok).catch((e) => push(`[표 문서 ${w}] 실행`, false, e.message));
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

module.exports = { name: '표 칸·열·행 채우기 색 (문서 안 표 + 표 문서 열 색)', run };
