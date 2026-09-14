// scripts/e2e/canary-table-view.js — **저장된 문서 보기 화면**의 표 계약 (2026-09-14)
//
// Irene 2026-09-13: *"에디터에서는 제대로 나오는데 저장하고 나면 이상해."* ·
//   *"문서에 표가 우측 잘리고 테두리 중간에 없어지는 거 해결 안되는데?"*
//
// ★ 왜 `tablefit` 과 **다른 스위트**인가 — 한 런에 넣으려다 두 번 깨졌다(2026-09-13 밤):
//     ① 편집 중인 초안이 있는 상태에서 페이지를 떠나면 네비게이션이 끝나지 않아 **17분 행**
//     ② 순서를 바꿔 보기를 먼저 했더니 이번엔 편집 판정("표 삽입")이 깨졌다
//   편집 세션과 보기 판정은 **같은 문서를 공유할 수 없다.** 그래서 가른다 —
//   `tablefit` 은 편집기(폭 맞춤), 이 스위트는 **저장된 글의 보기 화면**만 본다.
//
// 재는 것 (읽기 전용에는 `.tableWrapper` 가 없다 — TipTap 이 editable 에서만 만든다):
//   ① 표가 그려졌는가 (측정 전제 — 0건이면 판정 불가 = 실패)
//   ② **테두리가 중간에 끊기지 않는가** — 행 폭 == 표 폭.
//      `display:block` 이면 안쪽 익명 표가 shrink-to-fit 이라 바깥 테두리와 어긋난다(실측 872 vs 726).
//   ③ 열이 많은 표(12열)는 눌러 넣지 않고 표 안에서 가로 스크롤하는가 (옛 계약 유지)
//   ④ 페이지를 가로로 밀지 않는가
//   ⑤ 이 규칙이 **편집 화면에 새지 않는가** (편집은 `.tableWrapper` 가 스크롤을 맡는다)
const { launch, login, goto, sleep, dismissBlockers, BASE, CREDS } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const mkRow = (n, pre) => ({ type: 'tableRow', content: Array.from({ length: n }, (_, i) => ({
  type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: `${pre}${i + 1} 가나다라마바사아자차` }] }],
})) });

const fx = { id: null, tok: null, biz: null };

// 픽스처는 **API 로** 만든다 — 편집 UI 를 거치면 초안이 남아 위 ①의 행(hang)이 재발한다.
async function setup() {
  const lj = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  })).json();
  fx.tok = lj?.data?.token; fx.biz = lj?.data?.user?.active_business_id;
  if (!fx.tok || !fx.biz) return;
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '표 보기 카나리 픽스처 (자동 삭제)' }] },
    { type: 'table', content: [mkRow(3, '머리'), mkRow(3, '값'), mkRow(3, '값')] },
    { type: 'paragraph', content: [{ type: 'text', text: '열이 많은 표' }] },
    { type: 'table', content: [mkRow(12, '머리'), mkRow(12, '값')] },
  ] };
  const r = await fetch(`${BASE}/api/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.tok}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(fx.biz) },
    body: JSON.stringify({
      business_id: fx.biz, title: 'ZZ카나리-표보기 (자동 삭제)',
      // ★ **객체로** 보낸다. 문자열로 보내면 JSON 문자열이 그대로 저장돼 TipTap 이 그걸
      //   본문 텍스트로 그린다(실측: 표 0개, 본문에 JSON 원문이 찍혔다).
      content_json: doc, category: 'report', status: 'published',
    }),
  });
  const j = await r.json();
  fx.id = j?.data?.id || null;
  if (!fx.id) fx.err = `${r.status} ${JSON.stringify(j).slice(0, 200)}`;
}

async function teardown() {
  if (!fx.id || !fx.tok) return;
  try {
    await fetch(`${BASE}/api/posts/${fx.id}`, { method: 'DELETE',
      headers: { Authorization: `Bearer ${fx.tok}`, 'X-Workspace-Id': String(fx.biz) } });
  } catch { /* noop */ }
}

const readTables = (page, sel) => page.evaluate((s) => {
  const ts = [...document.querySelectorAll(s)];
  const rows = ts.map((t) => {
    const r0 = t.rows && t.rows[0];
    return {
      cols: r0 ? r0.children.length : 0,
      blockW: Math.round(t.getBoundingClientRect().width),
      rowW: r0 ? Math.round(r0.getBoundingClientRect().width) : 0,
      scrollW: t.scrollWidth, clientW: t.clientWidth,
      display: getComputedStyle(t).display,
    };
  });
  return {
    n: rows.length, rows,
    short: rows.filter((x) => x.rowW > 0 && x.scrollW <= x.clientW + 2 && x.blockW - x.rowW > 4),
    wide: rows.filter((x) => x.cols >= 9),
    docScroll: document.documentElement.scrollWidth, win: window.innerWidth,
    hasWrapper: !!document.querySelector('.tableWrapper'),
  };
}, sel);

async function run() {
  try { await setup(); } catch (e) { fx.err = e.message; }
  const { browser, page } = await launch();
  try {
    if (!fx.id) {
      push('픽스처 글 생성 (측정 전제)', false, `표가 든 글을 못 만들었다 — 판정 불가(실패) ${fx.err || ''}`);
      return results;
    }
    await page.setViewport({ width: 1440, height: 900 });
    await login(page);
    await goto(page, `/docs?post=${fx.id}`);
    await sleep(3400);
    await dismissBlockers(page).catch(() => {});

    const v = await readTables(page, '.tiptap table');
    push('① 보기 화면에 표가 그려졌다 (측정 전제)',
      v.n >= 2, `표 ${v.n}개 (3열 + 12열이어야 한다)`);
    push('② **테두리가 중간에 끊기지 않는다** (행 폭 == 표 폭)',
      v.n > 0 && v.short.length === 0,
      v.short.length
        ? `끊긴 표 ${v.short.length}/${v.n}개 · 예: 표 ${v.short[0].blockW} vs 행 ${v.short[0].rowW}`
        : `${JSON.stringify(v.rows.map((r) => `${r.cols}열 ${r.blockW}/${r.rowW} ${r.display}`))}`);
    push('③ 열이 많은 표는 눌러 넣지 않고 표 안에서 스크롤한다',
      v.wide.length > 0 && v.wide.every((x) => x.scrollW > x.clientW + 2),
      v.wide.length ? JSON.stringify(v.wide.map((x) => `${x.cols}열 scroll ${x.scrollW}/${x.clientW}`)) : '12열 표를 못 찾았다');
    push('④ 보기 화면이 페이지를 가로로 밀지 않는다',
      v.docScroll <= v.win + 2, `문서 ${v.docScroll} vs 창 ${v.win}`);

    // 폰 폭 — 3열 표도 여기서는 좁아 스크롤로 넘어갈 수 있다. 끊김만 본다.
    await page.setViewport({ width: 390, height: 844 });
    await sleep(1400);
    const p = await readTables(page, '.tiptap table');
    push('⑤ 폰 폭(390)에서도 테두리가 끊기지 않는다',
      p.n > 0 && p.short.length === 0,
      p.short.length ? `끊긴 표 ${p.short.length}/${p.n}개` : `표 ${p.n}개 일치`);
    push('⑤-b 폰 폭에서 페이지가 가로로 밀리지 않는다',
      p.docScroll <= p.win + 2, `문서 ${p.docScroll} vs 창 ${p.win}`);
  } finally { await browser.close(); await teardown(); }
  return results;
}

module.exports = { name: '저장된 문서 보기 — 표 테두리 끊김 0 · 넓은 표는 스크롤', run };
