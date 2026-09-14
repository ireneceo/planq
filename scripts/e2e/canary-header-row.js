// scripts/e2e/canary-header-row.js — **머리줄 계약** (2026-09-14 신설)
//
// Irene: *"1번 — 머리줄 버튼 통일."* (Q sale 3차의 후속. 그때 `headerCta.tsx` 로 빼 놓고도
//         높이를 32/36 두 값으로 갈라 둔 채 닫았다.)
//
// 계약 — **한 줄 안의 컨트롤은 같은 높이다.**
//   · 머리줄(PanelHeader actions · 주 액션이 선 줄) = **32px**
//   · 필터줄(`filterBar.tsx`)                      = **36px**
//   두 값은 서로 다른 줄의 것이다. 섞이면 줄이 들쭉날쭉해진다.
//
// ★ 왜 정적 검사로 못 잡는가 — 높이는 **CSS 가 합쳐진 뒤**에만 존재한다. 알약 탭은 높이를
//   안 적고 padding 만 줬어서 글자 줄높이가 37px 을 만들고 있었다. 소스에는 37 이 없다.
// ★ 폭을 하나만 재면 거짓 통과한다 — 프로젝트 알약은 데스크탑 37 / **폰 30** 이었다
//   (폰에서 글자를 숨겨 padding 만 남는다). 폰·태블릿·데스크탑 3폭을 잰다.
// ★ 크기만 재지 않고 **보이는가**를 잰다. 그리고 keep-alive 로 **숨은 탭에 같은
//   data-testid 가 남아 있다** — 이걸 안 걸러내면 h=0 을 재고 "못 찾음" 으로 오판한다
//   (이 카나리를 만드는 중에 실제로 겪었다).
// ★ 0건이면 **판정 불가 = 실패**다 (memory feedback_empty_fixture_false_verdict).
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const VPS = [
  { key: '폰',      w: 390,  h: 844 },
  { key: '태블릿',  w: 834,  h: 1112 },
  { key: '데스크탑', w: 1440, h: 900 },
];

// 머리줄 주 액션이 있는 화면들. sels = 그 버튼을 집는 손잡이(문자열 순서대로 시도).
const SCREENS = [
  { path: '/tasks',    label: 'Q task',   sels: ['[data-testid="task-add-btn"]'] },
  { path: '/projects', label: '프로젝트',  sels: ['[aria-label="새 프로젝트"]', '[aria-label="New project"]'] },
  { path: '/sale',     label: 'Q sale',   sels: ['[data-testid="sale-add-inquiry"]'] },
];

const HEADER_H = 32;

const MEASURE = `(sels) => {
  const box = (el) => { const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width),
             cy: Math.round(r.top + r.height / 2), left: Math.round(r.left) }; };
  // 정말 그려지는가 — rect + 조상 display/visibility + offsetParent (숨은 keep-alive 탭 제거)
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      n = n.parentElement;
    }
    return true;
  };
  const label = (el) => {
    const t = (el.getAttribute('data-testid') || '').trim();
    if (t) return t;
    const txt = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 14);
    return el.tagName.toLowerCase() + (txt ? '(' + txt + ')' : '');
  };
  // 누를 수 있는 것을 품은 것만 = 컨트롤. 요약 칩·문구는 높이 계약 대상이 아니다.
  const isCtrl = (el) => /^(BUTTON|SELECT|INPUT|A)$/.test(el.tagName)
    || !!el.querySelector('button, select, input, [role="tab"]');

  let cta = null;
  for (const s of sels) { cta = [...document.querySelectorAll(s)].find(shown); if (cta) break; }
  if (!cta) return { cta: null };

  const p = cta.parentElement;
  const cb = box(cta);
  // 같은 **시각적 줄** = 세로 중심이 10px 안. (부모가 flex-wrap 이면 문서 순서 ≠ 줄)
  const row = [...p.children]
    .filter((c) => shown(c) && Math.abs(box(c).cy - cb.cy) <= 10 && isCtrl(c))
    .map((c) => ({ id: label(c), ...box(c) }))
    .sort((a, b) => a.left - b.left);

  // 확인: 이 좌표에 정말 이 버튼이 그려져 있는가
  const hit = document.elementFromPoint(
    Math.round(cb.left + cb.w / 2), Math.round(cb.cy));
  return {
    cta: { id: label(cta), ...cb, drawn: !!hit && (cta.contains(hit) || hit.contains(cta)) },
    row,
    heights: [...new Set(row.map((c) => c.h))].sort((a, b) => a - b),
  };
}`;

async function run() {
  const { browser, page } = await launch();
  try {
    await login(page);

    for (const sc of SCREENS) {
      for (const vp of VPS) {
        const tag = `[${sc.label} ${vp.key}]`;
        await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
        await goto(page, sc.path);
        await dismissBlockers(page);
        await sleep(1200);
        const m = await page.evaluate(eval(MEASURE), sc.sels);

        if (!m.cta) { push(`${tag} 머리줄 주 액션을 찾았다`, false, '0건 — 이 폭 전부 미측정(판정 불가)'); continue; }
        push(`${tag} 머리줄 주 액션이 실제로 그려진다`, m.cta.drawn, `${m.cta.id} ${m.cta.w}×${m.cta.h}`);

        // ① 한 값인가 — 이것이 신고의 본문이다
        push(`${tag} 그 버튼이 선 줄의 컨트롤 높이가 **한 값**이다`,
          m.heights.length === 1,
          `집합 {${m.heights.join(', ')}} · ${m.row.map((c) => `${c.id}:${c.h}`).join('  ')}`);

        // ② 그 한 값이 머리줄 정본(32)인가 — 한 값이어도 36 이면 다른 화면과 어긋난다
        push(`${tag} 그 값이 머리줄 정본 ${HEADER_H}px 이다`,
          m.heights.length === 1 && m.heights[0] === HEADER_H,
          `h=${m.heights.join(',')} (기대 ${HEADER_H})`);

        // ③ CTA 자체의 높이 — 세 화면이 같은 버튼인가
        push(`${tag} 주 액션 높이가 ${HEADER_H}px 이다 (세 화면 같은 버튼)`,
          m.cta.h === HEADER_H, `h=${m.cta.h}px`);
      }
    }

    return results;
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { name: '머리줄 계약 (주 액션 · 알약 높이 한 값)', run };
