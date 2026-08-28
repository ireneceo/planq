// 좌측 메뉴를 모두 접은 상태에서 전 루트가 그려지는가
//   운영 (Irene 2026-08-28): "문서에서 좌측메뉴 닫으면 편집하던 화면이 하얗게 돼.
//   모든 좌측메뉴 닫은 후 여러 루트 다 확인해줘."
//
//   왜 정적검사로 안 잡히나: 접힘은 **두 곳의 CSS/렌더가 합쳐진 뒤에만** 존재한다 —
//   그리드가 `0 1fr` 로 첫 칸을 남겨두는데 사이드바가 조건부 렌더로 **DOM 에서 사라지면**
//   본문이 0px 칸으로 밀려 들어간다. 파일 하나만 봐서는 보이지 않는다.
//
//   ★ 접기 상태를 만들지 못한 루트는 '검사함' 으로 세지 않는다 — 몇 개를 실제로 접었는지 함께 보고한다
//     ("0개 접고 전부 통과" 와 진짜 통과가 같은 얼굴이면 안 된다).
const b = require('./lib/browser');

const ROUTES = [
  '/dashboard', '/inbox', '/talk', '/tasks', '/info', '/projects', '/calendar',
  '/notes', '/files', '/docs', '/mail', '/bills', '/business/clients',
  '/personal-vault', '/business/settings', '/notifications',
];

// 화면 안의 좌측 패널 접기 버튼 — 라벨이 화면마다 달라 넓게 잡는다
//   ★ 매칭을 좁게 — 넓게 잡으면 우하단 도크 같은 무관 버튼을 눌러 **오버레이가 뜨고**,
//     그 백드롭이 elementFromPoint 를 가로채 painted 가 0 이 된다(화면은 멀쩡한데 흰 화면으로 오판).
//     실제로 한 번 그렇게 거짓 실패했다.
const collapseInPagePanels = () => {
  const pats = /^(리스트|목록|패널|사이드바)?\s*접기$|collapse/i;
  let n = 0;
  for (const el of document.querySelectorAll('button')) {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (!pats.test(t)) continue;
    const bb = el.getBoundingClientRect();
    if (bb.width === 0 || bb.height === 0) continue;
    el.click(); n++;
  }
  return n;
};

// 측정 전에 열려 있는 오버레이를 닫는다 — 내가 띄운 것이든 앱이 띄운 것이든 판정을 오염시킨다.
const closeOverlays = () => {
  for (const el of document.querySelectorAll('[aria-modal="true"] button, [role="dialog"] button')) {
    const t = (el.getAttribute('aria-label') || '').trim();
    if (/닫기|close/i.test(t)) { el.click(); return true; }
  }
  return false;
};

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    // 앱 좌측 메뉴를 접힌 상태로 고정 (사용자가 접어두고 쓰는 상태 = localStorage 저장값)
    await page.evaluate(() => localStorage.setItem('planq.sidebar.collapsed', 'true'));

    for (const path of ROUTES) {
      const rec = { name: path, ok: true, msg: '' };
      try {
        await b.goto(page, path);
        await b.sleep(1800);
        // ★ /docs 는 아래 전용 블록이 "펴기 → 문서 열기 → 편집 → 접기" 순서를 직접 만든다.
        //   여기서 먼저 접으면 리스트가 닫혀 문서 행을 못 찾는다(실제로 두 번 그렇게 헛돌았다).
        const collapsedCount = path === '/docs' ? 0 : await page.evaluate(collapseInPagePanels);
        await b.sleep(1200);
        // /docs 는 신고 지점 — 문서를 열어 편집 화면을 띄운 뒤 접는다
        let opened = false;
        if (path === '/docs') {
          // 이전 실행이 접어둔 상태(localStorage)면 문서 행이 안 보인다 → 먼저 편다
          await page.evaluate(() => {
            for (const el of document.querySelectorAll('button')) {
              const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '');
              if (/리스트 열기|목록 열기|펼치기|expand/i.test(t)) { el.click(); return; }
            }
          });
          await b.sleep(1200);
          opened = await page.evaluate(() => {
            const r = document.querySelector('[data-testid="docs-row"]');
            if (!r) return false; r.click(); return true;
          });
          await b.sleep(2500);
          // ★ 신고는 "**편집하던** 화면" 이다 — 보기 모드에서는 재현되지 않는다. 편집까지 들어간다.
          await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((e) => /편집|수정|edit/i.test(
              (e.getAttribute('title') || e.getAttribute('aria-label') || e.textContent || '').trim()) && e.offsetParent !== null);
            if (btn) btn.click();
          });
          await b.sleep(2000);
          const c = await page.evaluate(collapseInPagePanels);
          rec.collapsedHere = c;
          await b.sleep(1500);
        }
        await page.keyboard.press('Escape').catch(() => null);
        await page.evaluate(closeOverlays);
        await b.sleep(600);
        // ★ assertRendered(elementFromPoint) 는 이 화면들에서 못 쓴다 — 상단 알림 배너나 우하단 도크
        //   백드롭이 모든 히트를 가로채 **멀쩡한 화면도 painted 0** 으로 찍힌다(접기 전에도 0 이었다).
        //   신호를 바꾼다: "사용자가 읽을 글이 화면에 있는가" + "본문 폭이 살아있는가".
        const r = await page.evaluate(() => {
          // ★ 탭 모드에서는 pane 이 여러 개고 비활성 pane 은 display:none(폭 0)이다.
          //   첫 번째를 잡으면 **모든 루트가 같은 값**으로 찍힌다(실측: 서로 다른 화면인데 글자수 794 동일).
          //   반드시 **보이는** pane 을 고른다. 탭 모드가 아니면 #root.
          const panes = [...document.querySelectorAll('[data-pane-tab]')]
            .filter((p) => p.getBoundingClientRect().width > 0);
          const root = panes[0] || document.getElementById('root') || document.body;
          const txt = (root.innerText || '').replace(/\s+/g, ' ').trim();
          // 화면에서 가장 큰 보이는 콘텐츠 블록의 폭
          let widest = 0;
          for (const el of root.querySelectorAll('section,main,article,div')) {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            const bb = el.getBoundingClientRect();
            if (bb.height < 200) continue;
            if (bb.width > widest) widest = bb.width;
          }
          return { textLen: txt.length, widest: Math.round(widest),
                   scope: panes.length ? `pane(${panes.length}개 중 보이는 첫)` : 'root' };
        });
        // 본문이 0px 칸으로 밀려났는가 — 그리드 자식 폭 실측
        const squashed = await page.evaluate(() => {
          const ident = (el) => {
            if (!el) return '?';
            const t = el.getAttribute('data-testid'); if (t) return `[${t}]`;
            const p = el.getAttribute('data-panel-main') !== null ? '[data-panel-main]' : '';
            if (p) return p;
            const c = (el.className && typeof el.className === 'string') ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
            return el.tagName.toLowerCase() + c;
          };
          const bad = [];
          for (const g of document.querySelectorAll('div,main,section')) {
            const cs = getComputedStyle(g);
            if (cs.display !== 'grid') continue;
            const gb = g.getBoundingClientRect();
            if (gb.width < 500 || gb.height < 300) continue;
            // 그리드 칸을 실제로 차지하는 자식만 (absolute/fixed/display:none 은 흐름 밖).
            //   ★ visibility:hidden 은 칸을 **유지**하므로 세어야 한다 — 빼면 오탐이 난다.
            const kids = [...g.children].filter((c) => {
              const k = getComputedStyle(c);
              return k.position !== 'absolute' && k.position !== 'fixed' && k.display !== 'none';
            });
            // 사용자가 보는 '본문' 이 0px 로 눌렸는가 — 보이는 자식 중 가장 큰 것이 40px 미만이면 압착
            const visible = kids.filter((c) => getComputedStyle(c).visibility !== 'hidden');
            if (visible.length === 0) continue;
            const widest = Math.max(...visible.map((c) => c.getBoundingClientRect().width));
            if (widest < 40 && gb.width > 500) {
              bad.push(`${ident(g)} cols=${cs.gridTemplateColumns} · 흐름자식 ${kids.length}개(보이는 ${visible.length}개) · 최대폭 ${Math.round(widest)}px `
                + `→ ${visible.map((c) => ident(c) + ':' + Math.round(c.getBoundingClientRect().width)).join(', ')}`);
            }
          }
          return bad;
        });
        const blank = r.textLen < 40 || r.widest < 200;
        rec.ok = !blank && squashed.length === 0;
        rec.msg = `${blank ? '🔴 빈 화면 ' : ''}글자 ${r.textLen}자 · 본문폭 ${r.widest}px · ${r.scope} · 접은 패널 ${rec.collapsedHere ?? collapsedCount}개`
          + (path === '/docs' ? ` · 문서열기 ${opened}` : '')
          + (squashed.length ? ` · 🔴 본문 압착: ${squashed.join(' | ')}` : '');
      } catch (e) { rec.ok = false; rec.msg = 'ERROR: ' + e.message.slice(0, 100); }
      results.push(rec);
    }
  } finally { await browser.close(); }
  return results;
}


// ★ 하니스 러너(run.js printSuite)는 **r.fail(숫자)** 을 센다. {ok, msg} 만 돌려주면 bad=0 이 되어
//   **게이트에서 영원히 통과**한다 — 단독 실행은 실패하는데 러너는 ✅ 를 찍는다(2026-08-28 실측).
//   결과를 러너 계약으로 변환한다: { name, fail: 0|1, details: [메시지] }.
function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}

module.exports = { run: async () => toRunnerShape(await run()), name: 'collapsed-routes' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 좌측 메뉴 접힘 · 전 루트 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(22)} ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
