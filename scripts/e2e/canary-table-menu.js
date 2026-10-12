// scripts/e2e/canary-table-menu.js — 문서 안 표 편집 메뉴는 «손잡이 → 펼침» (2026-10-12)
//
// Irene: *"표 만들고 수정할 때 커서를 넣으면 행, 열 추가할지 뜨는데 내용을 수정할 때는 너무 불편한데"*
//   예전: 표 안 커서마다 행·열 메뉴 전체가 커서 바로 위에 떠 윗줄 칸을 가렸다.
//   지금: 표 오른쪽 위 모서리 바깥에 작은 손잡이 [표 ⋯] 만 → 누르면 펼침 → 글자를 치면 접힘 → 표 밖이면 사라짐.
//
//   폰 390 · 태블릿 820 · 데스크탑 1440
//     ① 2행 칸에 커서 → 손잡이만 보이고 펼친 메뉴는 없다
//     ② 손잡이가 어떤 칸도 덮지 않는다(1행 칸 가운데·오른쪽 끝 elementFromPoint = 그 칸) · 표 위에 있다
//     ③ 손잡이 누름 → 메뉴가 화면 안·누를 수 있음 → [행↓] 로 행이 3 → 4
//     ④ 글자를 치면 메뉴가 접히고 손잡이로 돌아온다(친 글자는 칸에 들어감)
//     ⑤ 표 밖 문단으로 커서 → 손잡이도 사라진다
//   픽스처는 Node 에서 API 로 만들고 끝나면 지운다.
const { launch, login, goto, sleep, dismissBlockers, CREDS } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = 'http://127.0.0.1:3003';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function api(path, opt = {}, tok) {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } });
  return r.json().catch(() => ({}));
}
const cell = (txt) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: txt }] }] });
const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'zqmenu 위 문단' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('zqA1'), cell('zqB1'), cell('zqC1')] },
      { type: 'tableRow', content: [cell('zqA2'), cell('zqB2'), cell('zqC2')] },
      { type: 'tableRow', content: [cell('zqA3'), cell('zqB3'), cell('zqC3')] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'zqmenu 아래 문단' }] },
  ],
};

async function clickVisible(page, sel) {
  const box = await page.evaluate((q) => {
    const el = [...document.querySelectorAll(q)].find((e) => { const r = e.getBoundingClientRect(); return (e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null) && r.width > 0 && r.height > 0; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) throw new Error(`보이는 요소 없음: ${sel}`);
  await page.mouse.click(box.x, box.y);
}
// 칸 글자 끝을 실제로 눌러 커서를 넣는다(합성 selection 이 아니라 사람이 하는 대로)
async function clickInto(page, txt) {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.ProseMirror td p, .ProseMirror > p')].find((x) => x.textContent.includes(t) && (x.checkVisibility ? x.checkVisibility() : true));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width - 2, 40), y: r.top + r.height / 2 };
  }, txt);
  if (!box) throw new Error(`칸 없음: ${txt}`);
  await sleep(300);
  await page.mouse.click(box.x, box.y);
}
const visible = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true) && r.width > 0 && r.height > 0;
}, sel);

async function part(width, docId) {
  const tag = `[${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await goto(page, `/docs?post=${docId}`);
    await sleep(2600);
    await dismissBlockers(page).catch(() => {});
    await clickVisible(page, '[data-testid="post-edit"]');
    await sleep(1800);
    await clickInto(page, 'zqB2');
    await sleep(700);
    const h = await visible(page, '[data-testid="editor-table-menu-open"]');
    const m = await visible(page, '[data-testid="editor-table-menu"]');
    push(`${tag} ① 칸에 커서 → 손잡이만, 펼친 메뉴 없음`, h && !m, `손잡이 ${h} · 메뉴 ${m}`);
    const cover = await page.evaluate(() => {
      const hd = document.querySelector('[data-testid="editor-table-menu-open"]');
      const tb = [...document.querySelectorAll('.ProseMirror table')].find((x) => x.textContent.includes('zqA1'));
      if (!hd || !tb) return { ok: false, why: 'none' };
      const hr = hd.getBoundingClientRect(); const tr = tb.getBoundingClientRect();
      const hits = [];
      tb.querySelectorAll('td, th').forEach((td) => {
        const r = td.getBoundingClientRect();
        for (const [x, y] of [[r.left + r.width / 2, r.top + r.height / 2], [r.right - 6, r.top + 6]]) {
          if (y < 0 || y > innerHeight) continue;
          const e = document.elementFromPoint(x, y);
          if (!e || !td.contains(e)) hits.push(td.textContent.trim());
        }
      });
      const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
      return { ok: hits.length === 0 && hr.bottom <= tr.top + 1 && !!hit && hd.contains(hit) && hr.left >= 0 && hr.right <= innerWidth + 1,
        hits, handle: [hr.left, hr.top, hr.right, hr.bottom].map(Math.round), tableTop: Math.round(tr.top), tableRight: Math.round(tr.right) };
    });
    push(`${tag} ② 손잡이는 표 위 · 어떤 칸도 덮지 않음 · 누를 수 있음`, cover.ok, JSON.stringify(cover));
    await clickVisible(page, '[data-testid="editor-table-menu-open"]');
    await sleep(500);
    const menu = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="editor-table-menu"]');
      if (!p) return { ok: false };
      const r = p.getBoundingClientRect();
      const b = [...p.querySelectorAll('button')][3].getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { ok: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && !!hit && p.contains(hit), r: [r.left, r.top, r.right, r.bottom].map(Math.round) };
    });
    const rows0 = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length);
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-table-menu"] button')][3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    await sleep(400);
    const rows1 = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length);
    push(`${tag} ③ 손잡이 → 메뉴가 화면 안 · [행↓] 로 행 ${rows0} → ${rows1}`, menu.ok && rows1 === rows0 + 1, JSON.stringify(menu));
    await clickInto(page, 'zqB2');
    await sleep(300);
    // 펼친 상태에서 글자 치기
    await clickVisible(page, '[data-testid="editor-table-menu-open"]').catch(() => {});
    await sleep(300);
    const before = await visible(page, '[data-testid="editor-table-menu"]');
    await page.keyboard.type('x');
    await sleep(500);
    const after = await visible(page, '[data-testid="editor-table-menu"]');
    const h2 = await visible(page, '[data-testid="editor-table-menu-open"]');
    const typed = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror td')].some((td) => /zqB\dx|xzqB\d|zqBx?\d/.test(td.textContent) && td.textContent.includes('x')));
    push(`${tag} ④ 글자를 치면 메뉴가 접히고 손잡이로 · 글자는 칸에`, before && !after && h2 && typed, `치기 전 메뉴 ${before} · 친 뒤 ${after} · 손잡이 ${h2} · 입력 ${typed}`);
    await clickInto(page, 'zqmenu 아래');
    await sleep(600);
    const gone = !(await visible(page, '[data-testid="editor-table-menu-open"]')) && !(await visible(page, '[data-testid="editor-table-menu"]'));
    push(`${tag} ⑤ 표 밖으로 나가면 손잡이도 사라진다`, gone);
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
    const d = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqmenu-doc', content_json: doc, kind: 'doc' }) }, tok);
    const docId = d.data && d.data.id;
    if (docId) made.push(docId);
    if (!docId) { push('픽스처 만들기', false, JSON.stringify(d)); return results; }
    for (const w of [1440, 820, 390]) {
      await api(`/api/posts/${docId}`, { method: 'PUT', body: JSON.stringify({ content_json: doc }) }, tok);
      await part(w, docId).catch((e) => push(`[${w}] 실행`, false, e.message));
    }
  } finally {
    for (const id of made) {
      await sequelize.query('DELETE FROM post_revisions WHERE post_id = ?', { replacements: [id] }).catch(() => {});
      await sequelize.query('DELETE FROM posts WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
    push('정리 — 검사 문서 삭제', true, `${made.length}건`);
  }
  return results;
}

module.exports = { name: '문서 안 표 편집 메뉴 — 손잡이 → 펼침', run };
