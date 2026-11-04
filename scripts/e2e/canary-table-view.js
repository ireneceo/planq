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
//
// ★ 2026-11-04 개정 — 표시 기준 한 벌(components/Docs/pqTable.ts · Fable 판정 A). 보기 화면에도 `.tableWrapper` 가 있고
//   그것이 유일한 스크롤 상자다. 이 스위트가 놓친 것: 픽스처가 **열 폭 없는 표만** 있어서, 열 폭이 저장된 표가
//   라이브러리 인라인 width:합계px 로 화면 밖까지 **잘리는** 것을 한 번도 못 쟀다(Irene «위 표는 잘리고 아래는 안 잘림»).
//   → 열 폭 저장 표(400/400/500 · 붙여넣기 모양 [없음,300,300,300])를 넣고, «보이는 끝을 넘으면 그 넘친 부분을
//     스크롤로 볼 수 있는가» 를 820·390 에서 잰다. 열 수 × 96 ≤ 본문 폭이면 스크롤 없이 맞아야 한다.
const { launch, login, goto, sleep, dismissBlockers, BASE, CREDS } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const mkRow = (n, pre, ws) => ({ type: 'tableRow', content: Array.from({ length: n }, (_, i) => ({
  type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: ws && ws[i] ? [ws[i]] : null },
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
    { type: 'paragraph', content: [{ type: 'text', text: '열 폭이 저장된 표(손으로 넓힘)' }] },
    { type: 'table', content: [mkRow(3, '머리', [400, 400, 500]), mkRow(3, '값', [400, 400, 500])] },
    { type: 'paragraph', content: [{ type: 'text', text: '붙여넣기 모양' }] },
    { type: 'table', content: [mkRow(4, '머리', [0, 300, 300, 300]), mkRow(4, '값', [0, 300, 300, 300])] },
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
    const rr = r0 ? r0.getBoundingClientRect() : t.getBoundingClientRect();
    // 보이는 오른쪽 끝 + 넘친 부분을 스크롤로 볼 수 있는가(조상 중 overflow 가 visible 아닌 것)
    let clipR = window.innerWidth; let scroller = false;
    for (let a = t.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible') {
        clipR = Math.min(clipR, a.getBoundingClientRect().right);
        if (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) { scroller = a.classList.contains('tableWrapper'); break; }
      }
    }
    const minCols = r0 ? r0.children.length * 96 : 0;
    const wrap = t.closest('.tableWrapper');
    return {
      cols: r0 ? r0.children.length : 0,
      blockW: Math.round(t.getBoundingClientRect().width),
      rowW: r0 ? Math.round(rr.width) : 0,
      hidden: Math.max(0, Math.round(rr.right - clipR)), scroller,
      fitsByRule: wrap ? minCols <= wrap.clientWidth : false,
      wrapped: !!wrap,
      minCell: r0 ? Math.min(...[...r0.children].map((c) => Math.round(c.getBoundingClientRect().width))) : 0,
    };
  });
  return {
    n: rows.length, rows,
    short: rows.filter((x) => x.rowW > 0 && x.blockW - x.rowW > 4),
    clipped: rows.filter((x) => x.hidden > 1 && !x.scroller),
    // 열 수 × 96 ≤ 본문 폭인데 넘친다 = 맞출 수 있는 표를 맞추지 못한 것
    misfit: rows.filter((x) => x.fitsByRule && x.hidden > 1),
    narrow: rows.filter((x) => x.minCell < 95),
    unwrapped: rows.filter((x) => !x.wrapped),
    wide: rows.filter((x) => x.cols >= 9),
    docScroll: document.documentElement.scrollWidth, win: window.innerWidth,
  };
}, sel);

const judge = (v, label) => {
  push(`${label} 표가 하나도 잘리지 않는다(넘치면 래퍼 안 스크롤)`, v.n > 0 && v.clipped.length === 0,
    v.clipped.length ? `잘린 표 ${v.clipped.length}/${v.n} · 예 ${v.clipped[0].cols}열 숨김 ${v.clipped[0].hidden}px` : `표 ${v.n}개`);
  push(`${label} 열 수×96 이 들어가는 표는 스크롤 없이 본문 폭에 맞는다`, v.misfit.length === 0,
    v.misfit.length ? `맞출 수 있는데 넘친 표 ${v.misfit.length} · 예 ${v.misfit[0].cols}열 ${v.misfit[0].rowW}px` : 'ok');
  push(`${label} 칸이 96px 아래로 눌리지 않는다`, v.narrow.length === 0,
    v.narrow.length ? `좁은 칸 ${v.narrow[0].minCell}px (${v.narrow[0].cols}열)` : 'ok');
  push(`${label} 모든 표가 .tableWrapper 안에 있다`, v.unwrapped.length === 0, `래퍼 없는 표 ${v.unwrapped.length}`);
};

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
      v.n >= 4, `표 ${v.n}개 (3열·12열·열 폭 저장 3열·붙여넣기 4열이어야 한다)`);
    push('② **테두리가 중간에 끊기지 않는다** (행 폭 == 표 폭)',
      v.n > 0 && v.short.length === 0,
      v.short.length ? `끊긴 표 ${v.short.length}/${v.n}개 · 예: 표 ${v.short[0].blockW} vs 행 ${v.short[0].rowW}` : 'ok');
    push('③ 열이 많은 표(12열)는 눌러 넣지 않고 래퍼 안에서 스크롤한다',
      v.wide.length > 0 && v.wide.every((x) => x.scroller && x.minCell >= 95),
      v.wide.length ? JSON.stringify(v.wide.map((x) => `${x.cols}열 ${x.rowW}px 스크롤 ${x.scroller}`)) : '12열 표를 못 찾았다');
    judge(v, '1440');
    push('④ 보기 화면이 페이지를 가로로 밀지 않는다', v.docScroll <= v.win + 2, `문서 ${v.docScroll} vs 창 ${v.win}`);

    for (const w of [820, 390]) {
      await page.setViewport({ width: w, height: 844 });
      await sleep(1400);
      const p = await readTables(page, '.tiptap table');
      judge(p, String(w));
      push(`⑤ ${w} 테두리가 끊기지 않는다`, p.n > 0 && p.short.length === 0, p.short.length ? `끊긴 표 ${p.short.length}/${p.n}개` : `표 ${p.n}개 일치`);
      push(`⑤-b ${w} 페이지가 가로로 밀리지 않는다`, p.docScroll <= p.win + 2, `문서 ${p.docScroll} vs 창 ${p.win}`);
    }
  } finally { await browser.close(); await teardown(); }
  return results;
}

module.exports = { name: '저장된 문서 보기 — 표 잘림 0 · 맞출 수 있으면 본문 폭 · 넓은 표는 래퍼 스크롤 (3폭)', run };
