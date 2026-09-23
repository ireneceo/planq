// scripts/e2e/lib/measure.js — 카나리 **측정 공용 도구**. 2026-09-23 신설.
//
// 왜: 하루에 검사기가 **여섯 번** 거짓말했고 전부 같은 세 가지였다. 카나리마다 각자 재면
//   같은 실수가 계속 난다 — 한 곳에 모은다(memory feedback_green_without_measuring).
//
//   ① **탭 keep-alive 로 같은 요소가 두 벌** 있다. 앞서 본 화면이 숨겨진 채 트리에 남아
//      `querySelector` 가 **숨은 사본(0×0)** 을 집는다. 실측: 같은 `data-row-id` 가 2개,
//      보이는 것은 y=438·h=62 인데 숨은 것을 재서 h=0 → "기능 고장" 으로 보고할 뻔했다.
//   ② **빈 픽스처를 «정상 0건» 으로** 읽는다. 파일 0개인 프로젝트에서 "카드 없음",
//      프로젝트 폴더 0건에서 "미포함" 으로 판정했다. 없는 것을 재면 아무것도 증명하지 못한다.
//   ③ **겹쳐 그린 글자를 줄로 센다.** 썸네일 위 오버레이(출처 태그·확장자 배지)를 줄로 세어
//      "아직 4줄" 이라고 읽었다. 실제로는 제목+메타 2줄이었다.
//
// 쓰는 법: `const M = require('./lib/measure');` → `await M.visible(page, sel)` 등.

/** 보이는 것만 — 숨은 keep-alive 사본을 배제한다. 없으면 found:false + DOM 총수를 같이 준다. */
async function visible(page, selector) {
  return page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)];
    const vis = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
    if (!vis.length) return { found: false, dom: all.length, visible: 0 };
    const el = vis[0];
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    return {
      found: true, dom: all.length, visible: vis.length,
      // 크기가 있어도 **덮여 있으면** 사용자는 못 누른다 — 거기까지 본다.
      painted: !!(hit && (el.contains(hit) || hit.contains(el))),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.top < innerHeight && r.bottom > 0,
      border: cs.borderTopColor, font: cs.fontSize, color: cs.color,
      clipped: el.scrollWidth > el.clientWidth + 1,
    };
  }, selector);
}

/** 붙고 **높이가 생길 때까지** 기다린다. 고정 sleep 으로 재면 렌더 전 값을 읽어 거짓 실패가 난다. */
async function waitVisible(page, selector, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
      .some((e) => e.getBoundingClientRect().height > 1), selector).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * 한 상자 안에서 **기준선 아래** 잎 글자들이 몇 줄인가.
 *   `fromSelector` 아래만 센다 — 썸네일 위에 겹쳐 그린 글자를 줄로 세지 않기 위해서다.
 *   반환: { lines, rows[], clipped[] }
 */
async function linesBelow(page, boxSelector, fromSelector) {
  return page.evaluate(([boxSel, fromSel]) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const box = [...document.querySelectorAll(boxSel)].find(vis);
    if (!box) return { lines: null, reason: 'box-not-visible' };
    const from = fromSel ? [...box.querySelectorAll(fromSel)].find(vis) : null;
    const baseline = from ? from.getBoundingClientRect().top - 2 : -Infinity;
    const leaves = [...box.querySelectorAll('*')].filter((e) =>
      !e.children.length && (e.textContent || '').trim() && vis(e) && e.getBoundingClientRect().top >= baseline);
    const groups = {};
    leaves.forEach((e) => {
      const y = Math.round(e.getBoundingClientRect().top);
      const k = Object.keys(groups).find((kk) => Math.abs(kk - y) < 6) || y;
      (groups[k] = groups[k] || []).push((e.textContent || '').trim());
    });
    const ys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    return {
      lines: ys.length,
      rows: ys.map((y) => groups[y].join(' ')),
      clipped: leaves.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim().slice(0, 24)),
      boxH: Math.round(box.getBoundingClientRect().height),
    };
  }, [boxSelector, fromSelector || null]);
}

/**
 * 픽스처가 **실제로 있는지** 먼저 확인한다. 없으면 «미측정» 으로 실패시킨다 —
 *   0건을 «정상» 으로 읽으면 검사가 아무것도 증명하지 못한다.
 * @returns {name,fail,details} 러너 형식 행 (null 이면 픽스처 OK)
 */
function requireFixture(name, count, hint) {
  if (count > 0) return null;
  return { name: `${name}:픽스처`, fail: 1, hasCanary: true,
    details: [`⬜ 미측정 — 잴 대상이 0건이다${hint ? ` (${hint})` : ''}. 0건을 «정상» 으로 읽지 않는다`] };
}

module.exports = { visible, waitVisible, linesBelow, requireFixture };
