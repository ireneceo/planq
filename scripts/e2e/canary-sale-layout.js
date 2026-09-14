// scripts/e2e/canary-sale-layout.js — Q sale 2차 신고 15건의 **화면 계약** (2026-09-14)
//
// Irene 원문(요지):
//   ① 종료 가리기는 기존대로 **체크박스** · ② 단계·접근·담당자는 **셀렉트 안**에서 고른다
//   (축 이름 라벨 없음 · "전체" 없음) · ③ 필터줄이 위에 너무 들러붙었다
//   ④ [검색]은 **필터줄 맨 앞**(단계 셀렉트 앞) · 탭과 [고객응대 내역 추가]는 머리줄, 추가는 탭 뒤
//      (2026-09-14 3차로 바뀐 계약 — 오전엔 검색도 머리줄이었다. 검사를 끄지 않고 **옮겼다**)
//   ⑤ 추가 버튼은 `+` 가 붙은 **활성화(채워진 민트 #14B8A6)** — Q task·프로젝트 헤더와 같은 껍데기
//   ⑥ 높이 32(프로젝트 헤더와 같다) · ⑯ 상담·고객 탭 글자가 **세로로 쪼개지지 않는다**
//   ⑧ 단계 버튼이 행 **세로 중앙** · ⑨ ✕ 의 박스 제거 + 높이 통일
//   ⑩ [보기] 는 아이콘 + "보기" (이름 없음) · ⑪ 메모 **개수 표시 없음**
//   ⑫ 메모가 있으면 행 아래 **좌측 끝**에 [메모보기 ⌄] · ⑬ 열리면 **좌우 풀폭 회색 영역**,
//      리스트(카드)는 움직이지 않는다 · ⑭ 메모 입력은 **Enter 전송**
//
// 이 카나리가 **정적 검사로는 못 잡는 것**만 본다 — 전부 CSS 가 합쳐진 뒤에만 존재하는 값이다.
//
// ★ 폭을 하나만 재면 거짓 통과한다 (2026-09-14 프로젝트 탭에서 겪었다: 데스크탑만 0 이고
//   태블릿 20 · 폰 398 이었다). **폰·태블릿·데스크탑 3폭**을 잰다.
// ★ 크기만 재지 않고 **보이는가**를 잰다 — rect 가 있어도 부모가 height 0 + overflow:hidden 이면
//   한 픽셀도 안 그려진다.
// ★ 0건이면 **판정 불가 = 실패**다(memory feedback_empty_fixture_false_verdict).
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const VPS = [
  { key: '폰',      w: 390,  h: 844 },
  { key: '태블릿',  w: 834,  h: 1112 },
  { key: '데스크탑', w: 1440, h: 900 },
];

/** 정말 그려지는가 — rect + 조상 클리핑 + elementFromPoint 까지 */
const VISIBLE = `(el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { drawn: false, why: 'rect 0' };
  let n = el.parentElement;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    const nr = n.getBoundingClientRect();
    if (/hidden|clip/.test(s.overflow + s.overflowY) && (nr.height < 1 || r.bottom <= nr.top || r.top >= nr.bottom))
      return { drawn: false, why: '조상 클리핑' };
    n = n.parentElement;
  }
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  return {
    drawn: !!hit && (el.contains(hit) || hit.contains(el)),
    why: hit ? '' : '좌표에 아무것도 없음',
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    bottom: Math.round(r.bottom), right: Math.round(r.right),
  };
}`;

async function measure(page) {
  return page.evaluate((VIS_SRC) => {
    const vis = eval(VIS_SRC);
    const q = (s) => document.querySelector(s);
    const out = {};

    // ── 필터줄 ───────────────────────────────────────────────
    const bar = q('[data-testid="sale-filter-row"]');
    out.filterBar = vis(bar);
    out.filterMarginTop = bar ? parseFloat(getComputedStyle(bar).marginTop) : null;
    // 필터줄 바로 위 형제의 아래끝 ~ 필터줄 위끝 = 실제 벌어진 틈
    if (bar && bar.previousElementSibling) {
      const pr = bar.previousElementSibling.getBoundingClientRect();
      out.gapAbove = Math.round(bar.getBoundingClientRect().top - pr.bottom);
    }
    // ② 축 셀렉트 — 밖 라벨이 없고, 첫 옵션 라벨이 축 이름이며 "전체" 가 아니다
    out.axisLabelsOutside = ['sale-stage-filter', 'sale-access-filter', 'sale-assignee-filter']
      .map((id) => {
        const el = q(`[data-testid="${id}"]`);
        if (!el) return { id, missing: true };
        // 칸 안의 **셀렉트가 아닌 맨앞 텍스트** = 밖에 붙은 축 이름 라벨
        const sel = el.querySelector('[class*="control"], [class*="Control"]');
        const own = (el.innerText || '').trim();
        const inSel = sel ? (sel.innerText || '').trim() : '';
        return { id, shown: inSel || own, strayLabel: own.replace(inSel, '').trim(), v: vis(el) };
      });
    // ① 종료 가리기 = 체크박스
    const hc = q('[data-testid="sale-inbox-hide-closed"]');
    out.hideClosed = hc ? {
      tag: hc.tagName, isCheckbox: !!hc.querySelector('input[type="checkbox"]'),
      v: vis(hc),
    } : null;
    // 한 줄 안 컨트롤 높이 집합
    out.filterHeights = bar ? [...new Set([...bar.children].map((c) => Math.round(c.getBoundingClientRect().height)))] : [];

    // ── 헤더 · 검색 ──────────────────────────────────────────
    // ★ 2026-09-14 3차로 계약이 **바뀌었다** (Irene: *"검색창 왜 위에 있어? 필터들 맨 앞에 둬.
    //   단계 셀렉트 앞에."*). 오전 계약(검색이 헤더)을 검사하던 자리를 **끄지 않고 옮긴다**.
    const search = q('[data-testid="sale-search"]');
    const stageSlot = q('[data-testid="sale-stage-filter"]');
    const tabs = q('[data-testid="sale-tab-inbox"]');
    const add = q('[data-testid="sale-add-inquiry"]');
    out.search = vis(search); out.tabs = vis(tabs); out.add = add ? vis(add) : null;
    // ④ 검색이 **필터줄 안**이고, 그 줄의 **맨 앞**(단계 셀렉트보다 앞)인가
    out.searchInFilterBar = !!(bar && search && bar.contains(search));
    out.searchIsFirstChild = !!(bar && search && bar.firstElementChild === search);
    out.searchBeforeStage = !!(search && stageSlot
      && (search.compareDocumentPosition(stageSlot) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (search && stageSlot) {
      const sr = search.getBoundingClientRect(), gr = stageSlot.getBoundingClientRect();
      out.searchLeftOfStage = Math.round(sr.right) <= Math.round(gr.left) + 1;
      out.searchSameRow = Math.abs(Math.round(sr.top) - Math.round(gr.top)) <= 2;
      // ★ 좁은 폭에서는 필터줄이 **줄바꿈**된다(계약: "좁아지면 가로로 숨기지 않고 줄이 바뀐다").
      //   그때 "앞" 은 왼쪽이 아니라 **윗줄**이다. 데스크탑 기준만 재면 폰에서 거짓 실패가 난다.
      out.searchAboveStage = Math.round(sr.bottom) <= Math.round(gr.top) + 1;
    }
    // ④ 탭·추가는 머리줄에 남는다(필터줄 **위**)
    out.headerHasTabAndAdd = !!(tabs && add);
    if (out.headerHasTabAndAdd && bar) {
      out.headerAboveFilter = Math.max(add.getBoundingClientRect().bottom, tabs.getBoundingClientRect().bottom)
        <= bar.getBoundingClientRect().top + 1;
      // 추가 버튼이 탭 **뒤**(문서 순서)
      out.addAfterTabs = !!(tabs.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    if (add) {
      const cs = getComputedStyle(add);
      out.addStyle = {
        h: Math.round(add.getBoundingClientRect().height),
        bg: cs.backgroundColor, color: cs.color,
        hasPlusSvg: !!add.querySelector('svg'),
      };
    }
    // ⑯ 알약 탭의 글자가 **세로로 쪼개지지 않는다** (Irene: *"상담 고객이 글자가 왜 세로야?"*)
    //    판정은 낱말 폭이 아니라 **줄 수**다.
    //    ★ 2026-09-14 판정식을 고쳤다 — 전에는 **버튼 상자 높이 ÷ 줄높이**로 줄 수를 *추정*했다.
    //      알약 높이를 32px 로 못 박고 안쪽 버튼을 `height:100%` 로 바꾸자(padding 0) 상자 높이가
    //      글자 한 줄보다 커져 **26/15.6 = 2줄** 로 읽혔다 — `nowrap` 인데도 3폭 전부 거짓 실패.
    //      상자는 글자가 아니다(memory feedback_judge_measures_wrapper_not_defect).
    //      이제 **글자 자체의 줄상자**를 센다 — Range 의 client rect 를 top 으로 묶으면
    //      그것이 실제로 몇 줄에 그려졌는지다. 추정이 아니라 측정이다.
    const lineCountOf = (el) => {
      const rng = document.createRange();
      rng.selectNodeContents(el);
      const rects = [...rng.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) return 0;
      const tops = [];
      rects.forEach((r) => { if (!tops.some((t) => Math.abs(t - r.top) <= 2)) tops.push(r.top); });
      return tops.length;
    };
    out.tabText = ['sale-tab-inbox', 'sale-tab-clients'].map((id) => {
      const el = q(`[data-testid="${id}"]`);
      if (!el) return { id, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id, text: (el.innerText || '').trim(),
        w: Math.round(r.width), h: Math.round(r.height),
        lines: lineCountOf(el),
        whiteSpace: cs.whiteSpace,
        overflowing: el.scrollWidth > el.clientWidth + 1,
      };
    });

    // ── 행 ───────────────────────────────────────────────────
    const rows = [...document.querySelectorAll('[data-testid^="sale-inbox-row-"]')];
    out.rowCount = rows.length;
    out.rows = rows.slice(0, 8).map((row) => {
      const id = row.getAttribute('data-testid').replace('sale-inbox-row-', '');
      const rr = row.getBoundingClientRect();
      const dir = getComputedStyle(row).flexDirection;
      const slot = row.querySelector('[data-testid^="sale-inbox-stageslot-"]');
      const stage = slot ? slot.querySelector('[data-testid^="sale-inbox-stage-"]') : null;
      const open = row.querySelector('[data-testid^="sale-inbox-open-"]');
      const memo = row.querySelector('[data-testid^="sale-inbox-memo-"]');
      const x = row.querySelector('[data-testid^="sale-inbox-dismiss-"],[data-testid^="sale-inbox-clear-"],[data-testid^="sale-inbox-purge-"]');
      const acts = [...row.querySelectorAll('button')].filter((b) => /sale-inbox-(open|memo|event|task|restore)-/.test(b.getAttribute('data-testid') || ''));
      const sr = stage ? stage.getBoundingClientRect() : null;
      return {
        id, dir,
        // 칩이 **자기 칸 안**에서 가운데인가 — 폰(세로 스택)에서는 이것이 ⑧ 의 뜻이다
        chipOffInSlot: (slot && sr)
          ? Math.round((sr.top + sr.height / 2)
            - (slot.getBoundingClientRect().top + slot.getBoundingClientRect().height / 2)) : null,
        rowH: Math.round(rr.height), rowTop: Math.round(rr.top), rowLeft: Math.round(rr.left),
        rowRight: Math.round(rr.right),
        // ⑧ 단계 칩의 세로 중심 vs 행의 세로 중심
        stageOff: sr ? Math.round((sr.top + sr.height / 2) - (rr.top + rr.height / 2)) : null,
        // ★ 열 정렬은 **칸**으로 잰다 — 칩은 칸 안에서 가운데 정렬이라 라벨 길이("없음" vs "협상중")
        //   에 따라 x 가 달라진다. 칩으로 재면 정상 동작이 실패로 나온다
        //   ([[feedback_variable_label_breaks_column_align]] — 2026-09-14 이 카나리가 실제로 그랬다).
        slotLeft: slot ? Math.round(slot.getBoundingClientRect().left) : null,
        slotW: slot ? Math.round(slot.getBoundingClientRect().width) : null,
        stageLeft: sr ? Math.round(sr.left) : null,
        // ⑩ [보기] 라벨
        openLabel: open ? (open.innerText || '').trim() : null,
        openW: open ? Math.round(open.getBoundingClientRect().width) : null,
        openDest: open ? (open.getAttribute('title') || '').trim() : null,
        // ⑪ 메모 버튼에 숫자가 붙지 않았다
        memoLabel: memo ? (memo.innerText || '').trim() : null,
        // ⑨ ✕ 박스
        x: x ? (() => { const cs = getComputedStyle(x); const b = x.getBoundingClientRect();
          return { h: Math.round(b.height), w: Math.round(b.width),
            border: cs.borderTopWidth, bg: cs.backgroundColor }; })() : null,
        // ⑥ 액션 높이 집합
        actH: [...new Set(acts.map((b) => Math.round(b.getBoundingClientRect().height)))],
        // ⑫ 메모 버튼 — **숫자로** 개수를 말하고(0 포함) **좌측 정렬 · 폭은 행마다 같다**.
        //   2026-09-14 에 계약이 세 번 옮겨졌다: 손잡이 좌표 → 점 색 → 숫자·정렬.
        //   매번 **끄지 않고 옮겼다**. 지금 정본은 이 주석 바로 아래의 측정값이다.
        memoBtn: (() => {
          // ★ 접두어가 겹친다 — `sale-inbox-memo-` 는 `-count-`·`-pane-` 에도 걸린다.
          //   지금은 숫자 span 이 버튼의 **자손**이라 문서 순서상 버튼이 먼저 잡히지만,
          //   그 우연에 기대지 않는다. 행 id 로 **정확한** testid 를 만든다.
          const rid = (row.getAttribute('data-testid') || '').replace('sale-inbox-row-', '');
          const b = row.querySelector(`[data-testid="sale-inbox-memo-${rid}"]`);
          if (!b) return null;
          const br = b.getBoundingClientRect();
          // ★ 2026-09-14 5차로 계약이 또 바뀌었다 (Irene: *"메모 없는 건 이상하잖아.
          //   그냥 메모 0, 메모 5 이렇게 나오게 해. 메모 좌측정렬하면 숫자 2자리여도…"*)
          //   → 점이 아니라 **숫자**다. 0 도 쓴다. 판정 대상을 또 옮긴다(끄지 않는다).
          // ★ 확정 손잡이로만 집는다 — `querySelector('span')` 은 ActionButton 의 `<Label>`
          //   래퍼를 집어 거짓 통과를 냈던 자리다(memory feedback_judge_measures_wrapper_not_defect).
          const cnt = b.querySelector('[data-testid^="sale-inbox-memo-count-"]');
          const cs = cnt ? getComputedStyle(cnt) : null;
          const cr = cnt ? cnt.getBoundingClientRect() : null;
          const bs = getComputedStyle(b);
          return {
            has: b.getAttribute('data-has-notes') === '1',
            w: Math.round(br.width), h: Math.round(br.height),
            label: (b.innerText || '').replace(/\s+/g, ' ').trim(),
            aria: b.getAttribute('aria-label') || '',
            countPresent: !!cnt,
            countText: cnt ? (cnt.innerText || '').trim() : '',
            countW: cr ? Math.round(cr.width) : 0,
            countAlign: cs ? cs.textAlign : '',
            // 2026-09-14 6차 — 숫자가 **색으로도** 말한다(1 이상 녹색 / 0 회색) + 간격
            countColor: cs ? cs.color : '',
            countGap: cs ? Math.round(parseFloat(cs.marginLeft) || 0) : 0,
            // 좌측 정렬 — 버튼 안의 글자가 왼쪽에 붙어 시작 x 가 고정인가
            justify: bs.justifyContent,
            // 글자 시작 x 가 버튼 왼쪽 안쪽 여백과 붙어 있는가
            textStartOffset: (() => {
              const lab = b.querySelector('span');
              if (!lab) return null;
              return Math.round(lab.getBoundingClientRect().left - br.left);
            })(),
          };
        })(),
        // 손잡이는 **사라졌어야** 한다
        toggleGone: !(row.parentElement && row.parentElement.querySelector('[data-testid^="sale-inbox-memo-toggle-"]')),
      };
    });
    return out;
  }, VISIBLE);
}

async function run() {
  const { browser, page } = await launch();
  try {
    await login(page);

    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await goto(page, '/sale');
      await dismissBlockers(page);
      await sleep(900);
      const m = await measure(page);
      const P = (n, ok, d) => push(`[${vp.key}] ${n}`, ok, d);

      if (!m.rowCount) { P('상담 행이 있다 (0건 = 판정 불가)', false, 'sale-inbox-row-* 0건 — 이 폭 전부 미측정'); continue; }

      // ── ② 축 셀렉트: 밖 라벨 없음 + "전체" 아님 ────────────────
      const stray = m.axisLabelsOutside.filter((a) => a.missing || (a.strayLabel && a.strayLabel.length > 0));
      const allText = m.axisLabelsOutside.map((a) => a.shown || '');
      const anyAll = allText.filter((t) => /^전체$|^All$/.test(t));
      P('② 축 이름이 셀렉트 **밖**에 없다', stray.length === 0,
        `칸 3개 · 밖 라벨 ${stray.length}건` + (stray.length ? ` (${stray.map((s) => s.id + ':' + (s.strayLabel || 'missing')).join(', ')})` : ''));
      P('② 셀렉트에 "전체" 가 보이지 않는다 (축 이름이 보인다)', anyAll.length === 0 && allText.every(Boolean),
        `보이는 값: ${allText.join(' / ')}`);
      P('② 셀렉트 3칸이 실제로 그려진다', m.axisLabelsOutside.every((a) => a.v && a.v.drawn),
        m.axisLabelsOutside.map((a) => `${a.id}:${a.v ? (a.v.drawn ? 'drawn' : a.v.why) : 'x'}`).join(' · '));

      // ── ① 종료 가리기 = 체크박스 ────────────────────────────
      const showHide = !!m.hideClosed;
      P('① 종료 가리기가 **체크박스**다', showHide && m.hideClosed.isCheckbox && m.hideClosed.v.drawn,
        showHide ? `<${m.hideClosed.tag}> checkbox=${m.hideClosed.isCheckbox} drawn=${m.hideClosed.v.drawn}` : '상담 탭 아님/없음');

      // ── ③ 필터줄 위 여백 ────────────────────────────────────
      P('③ 필터줄 위가 붙어 있지 않다 (틈 ≥ 10px)', (m.gapAbove ?? 0) >= 10,
        `위 형제와의 틈 ${m.gapAbove}px · margin-top ${m.filterMarginTop}px`);

      // ── 한 줄 컨트롤 높이 ───────────────────────────────────
      P('필터줄 컨트롤 높이가 한 값이다', m.filterHeights.length === 1,
        `높이 집합 {${m.filterHeights.join(', ')}}`);

      // ── ④⑤ 헤더 · 검색 자리 ────────────────────────────────
      // ★ 3차 계약: 검색은 **필터줄 맨 앞**, 탭·추가는 머리줄.
      P('④ 검색이 **필터줄 안**에 있다 (머리줄이 아니다)', m.searchInFilterBar === true,
        `inFilterBar=${m.searchInFilterBar} drawn=${m.search && m.search.drawn}`);
      P('④ 검색이 필터줄의 **맨 앞**이다', m.searchIsFirstChild === true, `firstChild=${m.searchIsFirstChild}`);
      // 같은 줄이면 **왼쪽**, 줄이 바뀌었으면 **윗줄** — 둘 다 "앞" 이다.
      const aheadOfStage = m.searchSameRow ? m.searchLeftOfStage === true : m.searchAboveStage === true;
      P('④ 검색이 **단계 셀렉트 앞**이다 (문서 순서 + 좌표)',
        m.searchBeforeStage === true && aheadOfStage,
        `before=${m.searchBeforeStage} sameRow=${m.searchSameRow} leftOf=${m.searchLeftOfStage} above=${m.searchAboveStage}`);
      P('④ 탭·추가는 필터줄 **위**(머리줄)에 있다',
        m.headerHasTabAndAdd && m.tabs.drawn && m.add.drawn && m.headerAboveFilter === true,
        `tabs=${m.tabs && m.tabs.drawn} add=${m.add && m.add.drawn} above=${m.headerAboveFilter}`);
      P('④ 추가 버튼이 탭 **뒤**다 (문서 순서)', m.addAfterTabs === true, `addAfterTabs=${m.addAfterTabs}`);
      P('⑤ 추가 버튼에 `+` 아이콘이 있다', !!(m.addStyle && m.addStyle.hasPlusSvg), `svg=${m.addStyle && m.addStyle.hasPlusSvg}`);
      // ★ 3차 계약: **활성화(채워진) 버튼**. Q task [+ 업무 추가]·프로젝트 [+ 새 프로젝트] 와 같은 값
      //   (#14B8A6). 오전에는 "덜 진하게"(secondary 흰 배경)였다 — Irene 이 되돌렸다.
      const mint = /rgb\(20,\s*184,\s*166\)/.test((m.addStyle || {}).bg || '');
      P('⑤ 추가 버튼이 **채워진 민트**다 (#14B8A6 — Q task·프로젝트와 같다)', mint,
        `background=${(m.addStyle || {}).bg}`);
      P('⑤ 추가 버튼 글자가 흰색이다', /rgb\(255,\s*255,\s*255\)/.test((m.addStyle || {}).color || ''),
        `color=${(m.addStyle || {}).color}`);
      P('⑥ 추가 버튼 높이가 32 (프로젝트 헤더와 같다)', (m.addStyle || {}).h === 32, `h=${(m.addStyle || {}).h}px`);

      // ── ⑯ 알약 탭 글자가 세로가 아니다 ──────────────────────
      const badTab = (m.tabText || []).filter((tt) => tt.missing || tt.lines > 1 || tt.whiteSpace !== 'nowrap');
      P('⑯ 상담·고객 탭 글자가 **한 줄**이다 (세로로 쪼개지지 않는다)', badTab.length === 0,
        (m.tabText || []).map((tt) => tt.missing ? `${tt.id}:없음`
          : `${tt.text}: ${tt.w}×${tt.h} ${tt.lines}줄 ${tt.whiteSpace}`).join(' · '));

      // ── ⑥⑧⑨⑩⑪ 행 ──────────────────────────────────────────
      const R = m.rows;
      // ⑧ — **계약이 레이아웃마다 다르다.** 가로로 늘어선 행(데스크탑·태블릿)에서는 단계 칩이
      //   행 높이의 세로 중앙에 와야 열이 보인다. 폰에서는 행이 `flex-direction: column` 이라
      //   본문·단계·액션이 **세로로 쌓인 띠**다 — 거기서 "행의 세로 중앙" 은 뜻이 없다
      //   (실측: 본문 60 / 단계 36 / 액션 32 → 단계 띠의 중심은 당연히 행 중심보다 14px 아래다).
      //   그래서 폰에서는 **칩이 자기 칸 안에서 가운데인가**를 잰다. 검사를 끄는 것이 아니라
      //   그 폭에서 참이어야 하는 명제로 바꾼 것이다.
      const stacked = R.every((r) => r.dir === 'column');
      if (stacked) {
        const ins = R.map((r) => r.chipOffInSlot).filter((v) => v !== null);
        P('⑧ (세로 스택) 단계 칩이 **자기 칸** 안에서 가운데다', ins.length > 0 && ins.every((v) => Math.abs(v) <= 2),
          `행 ${ins.length}건 · 칸 안 어긋남 ${ins.join(', ')}px · flex-direction=column 이라 "행 세로중앙"은 미적용`);
      } else {
        const offs = R.map((r) => r.stageOff).filter((v) => v !== null);
        P('⑧ 단계 칩이 행의 세로 중앙이다 (|어긋남| ≤ 2px)', offs.length > 0 && offs.every((v) => Math.abs(v) <= 2),
          `행 ${offs.length}건 · 어긋남 ${offs.join(', ')}px`);
      }

      const labels = [...new Set(R.map((r) => r.openLabel))];
      const openWs = [...new Set(R.map((r) => r.openW))];
      P('⑩ [보기] 라벨이 한 낱말로 고정 + 폭도 같다', labels.length === 1 && openWs.length === 1,
        `라벨 {${labels.join('|')}} · 폭 {${openWs.join('|')}}px`);
      P('⑩ 목적지는 title 이 여전히 말한다', R.every((r) => r.openDest && r.openDest.length > 0),
        `예: ${R[0].openDest}`);

      // ★ 2026-09-14 5차 — 이 검사는 **뒤집혔다.** 2차에는 *"메모 개수 표시는 없애"* 라
      //   «숫자가 없다» 를 요구했는데, 5차에 Irene 이 되돌렸다
      //   (*"메모 없는 건 이상하잖아. 그냥 메모 0, 메모 5 이렇게 나오게 해."*).
      //   지운 것이 아니라 **방향을 바꿨다** — 그리고 정본 판정은 아래 `memoBtn` 블록이
      //   확정 손잡이(`sale-inbox-memo-count-*`)로 한다. 여기서는 라벨에 숫자가 실제로
      //   보이는지만 한 줄로 확인한다(라벨은 사용자가 읽는 글자 그대로다).
      const memoNum = R.filter((r) => /\d/.test(r.memoLabel || ''));
      P('⑪ 메모 버튼 라벨에 **개수 숫자가 보인다** (0 도 쓴다)', memoNum.length === R.length,
        `숫자 있는 행 ${memoNum.length}/${R.length} · 예 "${R[0].memoLabel}"`);

      const xs = R.map((r) => r.x).filter(Boolean);
      P('⑨ ✕ 에 테두리 박스가 없다', xs.length > 0 && xs.every((x) => parseFloat(x.border) === 0),
        `✕ ${xs.length}건 · border ${[...new Set(xs.map((x) => x.border))].join(',')}`);
      P('⑨ ✕ 높이가 액션과 같다 (32)', xs.length > 0 && xs.every((x) => x.h === 32),
        `높이 {${[...new Set(xs.map((x) => x.h))].join(',')}}`);
      const actHs = [...new Set(R.flatMap((r) => r.actH))];
      P('⑥ 행 액션 높이가 한 값(32)이다', actHs.length === 1 && actHs[0] === 32, `높이 집합 {${actHs.join(', ')}}`);

      // 단계 열이 위아래로 맞는가 (라벨 고정폭의 근거)
      const slotLefts = [...new Set(R.map((r) => r.slotLeft))];
      const slotWs = [...new Set(R.map((r) => r.slotW))];
      P('열 정렬 — 단계 **칸**의 x·폭이 행마다 같다', slotLefts.length === 1 && slotWs.length === 1,
        `slotLeft {${slotLefts.join(', ')}} · slotW {${slotWs.join(', ')}}`
        + ` ※ 칸 안의 칩은 가운데 정렬이라 x 가 라벨 길이만큼 다르다(정상): {${[...new Set(R.map((r) => r.stageLeft))].join(', ')}}`);

      // ── ⑫⑬ 메모 ─────────────────────────────────────────────
      // ★ 2026-09-14 4차로 계약이 바뀌었다 (Irene: *"메모보기 좌측 버튼은 그냥 없애자.
      //   메모 버튼이 메모가 있는 거랑 없는 거랑 알 수 있게… 버튼 좌우 길이가 다르지 않게"*).
      //   검사를 **끈 것이 아니라 옮겼다** — 판정 대상이 손잡이의 좌표에서
      //   [메모] 버튼의 **점·폭**으로 바뀐다.
      P('⑫ 행 아래 [메모보기 ⌄] 손잡이가 **없다**', R.every((r) => r.toggleGone === true),
        `남아 있는 행 ${R.filter((r) => r.toggleGone === false).length}건`);

      const mb = R.map((r) => r.memoBtn).filter(Boolean);
      if (mb.length === 0) {
        P('⑫ [메모] 버튼 — 커버리지', false, '행이 있는데 메모 버튼을 하나도 못 찾았다 (판정 불가)');
      } else {
        // ★ 2026-09-14 5차 계약 — 숫자를 **항상** 쓴다(0 도). 2차에 지웠던 것을 Irene 이 되돌렸다.
        P('⑪ [메모] 버튼에 **개수 숫자가 있다** (0 도 쓴다)',
          mb.every((b) => b.countPresent && /^\d+$/.test(b.countText)),
          `숫자 없는 행 ${mb.filter((b) => !b.countPresent || !/^\d+$/.test(b.countText)).length}건 · `
          + `값 {${[...new Set(mb.map((b) => b.countText))].join(', ')}}`);

        // 숫자와 data-has-notes 가 **서로 맞는가** (한쪽만 고쳐지면 거짓말이 된다)
        P('⑪ 숫자와 «있음» 표시가 일치한다',
          mb.every((b) => (Number(b.countText) > 0) === b.has),
          mb.map((b) => `${b.countText}/${b.has ? 'has' : 'none'}`).join(' '));

        // ★ Irene 의 두 요구 — 좌측 정렬 + 폭 불변
        P('⑫ 버튼 안이 **좌측 정렬**이다 (숫자가 늘어도 «메모» 글자가 밀리지 않는다)',
          mb.every((b) => b.justify === 'flex-start'),
          `justify-content 집합 {${[...new Set(mb.map((b) => b.justify))].join(', ')}}`);
        P('⑫ 글자 시작 x 가 **행마다 같다** (좌측 정렬의 실제 효과)',
          [...new Set(mb.map((b) => b.textStartOffset))].length === 1,
          `시작 offset 집합 {${[...new Set(mb.map((b) => b.textStartOffset))].join(', ')}}px`);
        const ws = [...new Set(mb.map((b) => b.w))];
        P('⑫ [메모] 버튼 폭이 **행마다 같다**', ws.length === 1,
          `폭 집합 {${ws.join(', ')}} · 있음 ${mb.filter((b) => b.has).length} / 없음 ${mb.filter((b) => !b.has).length}`);
        // ★ 2026-09-14 6차 — `min-width` 는 **고정 2ch 이 아니라 목록의 최대 자릿수**다
        //   (Irene: *"2자리가 되면 자동으로 모든 버튼이 늘어나면 되는거지"*).
        //   그래서 판정은 «10px 이상» 같은 절대값이 아니라 **행마다 같은 값인가** 다.
        //   전부 1자리면 좁고, 어느 행이 2자리면 전부 같이 넓어진다 — 어느 쪽이든 **집합이 1개**.
        P('⑫ 숫자 칸 폭이 **행마다 같다** (목록 최대 자릿수로 함께 늘어난다)',
          [...new Set(mb.map((b) => b.countW))].length === 1 && mb[0].countW > 0,
          `숫자칸 폭 집합 {${[...new Set(mb.map((b) => b.countW))].join(', ')}}px`
          + ` · 자릿수 집합 {${[...new Set(mb.map((b) => b.countText.length))].join(',')}}`);
        // ★ 2026-09-14 6차 (Irene: *"1 이상부터 메모가 있으면 우리 메인칼라 녹색계열로.
        //   0은 회색으로"*). 색은 COLOR_GUIDE 정본만 쓴다 — 1 이상 Primary600 #0D9488(13,148,136),
        //   0 은 Text Tertiary #94A3B8(148,163,184). 새 색을 만들면 여기서 실패한다.
        const onC = mb.filter((b) => b.has), offC = mb.filter((b) => !b.has);
        if (onC.length) {
          P('⑫ 숫자 1 이상은 **녹색**이다 (Primary600 #0D9488)',
            onC.every((b) => /rgb\(13,\s*148,\s*136\)/.test(b.countColor)),
            `색 집합 {${[...new Set(onC.map((b) => b.countColor))].join(' | ')}}`);
        }
        if (offC.length) {
          P('⑫ 숫자 0 은 **회색**이다 (Text Tertiary #94A3B8)',
            offC.every((b) => /rgb\(148,\s*163,\s*184\)/.test(b.countColor)),
            `색 집합 {${[...new Set(offC.map((b) => b.countColor))].join(' | ')}}`);
        }
        P('⑫ «메모» 와 숫자가 **떨어져 있다** (간격 ≥ 3px)',
          mb.every((b) => b.countGap >= 3),
          `간격 집합 {${[...new Set(mb.map((b) => b.countGap))].join(', ')}}px`);

        P('⑫ 폭 판정의 커버리지를 밝힌다 (있음/없음 몇 건을 쟀는가)', true,
          `이 폭에서 있음 ${mb.filter((b) => b.has).length} / 없음 ${mb.filter((b) => !b.has).length}`
          + ` · 자릿수 {${[...new Set(mb.map((b) => b.countText.length))].join(',')}}`);
      }

      // ⑬ 메모를 열면 — 카드는 안 움직이고, 회색 판이 좌우 풀폭
      const target = R[0];
      const before = await page.evaluate((id) => {
        const row = document.querySelector(`[data-testid="sale-inbox-row-${id}"]`);
        const r = row.getBoundingClientRect();
        return { top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
      }, target.id);
      await page.click(`[data-testid="sale-inbox-memo-${target.id}"]`);
      await sleep(500);
      const after = await page.evaluate((id) => {
        const row = document.querySelector(`[data-testid="sale-inbox-row-${id}"]`);
        const pane = document.querySelector(`[data-testid="sale-inbox-memo-pane-${id}"]`);
        const r = row.getBoundingClientRect();
        const p = pane ? pane.getBoundingClientRect() : null;
        const cs = pane ? getComputedStyle(pane) : null;
        return {
          row: { top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) },
          pane: p ? { top: Math.round(p.top), left: Math.round(p.left), right: Math.round(p.right), h: Math.round(p.height), bg: cs.backgroundColor } : null,
          insideRow: pane ? row.contains(pane) : null,
          hasInput: !!(pane && pane.querySelector('[data-testid="note-input"]')),
        };
      }, target.id);
      P('⑬ 메모판이 열린다', !!after.pane && after.pane.h > 20, after.pane ? `h=${after.pane.h}` : '안 열림');
      P('⑬ 메모판이 카드 **밖**(아래)이다', after.insideRow === false && after.pane && after.pane.top >= after.row.top + after.row.h - 1,
        `insideRow=${after.insideRow} · paneTop ${after.pane && after.pane.top} vs rowBottom ${after.row.top + after.row.h}`);
      P('⑬ 카드(리스트 행)가 움직이지 않는다', after.row.h === before.h && after.row.top === before.top,
        `높이 ${before.h}→${after.row.h} · top ${before.top}→${after.row.top}`);
      P('⑬ 메모판이 **좌우 풀폭**(행과 같은 x 범위)', after.pane
        && Math.abs(after.pane.left - after.row.left) <= 1 && Math.abs(after.pane.right - after.row.right) <= 1,
        after.pane ? `pane ${after.pane.left}~${after.pane.right} vs row ${after.row.left}~${after.row.right}` : '—');
      P('⑬ 메모판이 회색이다', !!(after.pane && /248,\s*250,\s*252/.test(after.pane.bg)), `bg=${after.pane && after.pane.bg}`);
      P('⑭ 메모 입력칸이 있다', after.hasInput === true, `note-input=${after.hasInput}`);

      // ⑫ **같은 버튼을 다시 눌러 닫힌다** — 문이 하나가 되었으므로(손잡이 삭제)
      //   여닫는 계약은 «재클릭 토글»(CLAUDE.md UI 규칙) 하나로 판정한다.
      await page.click(`[data-testid="sale-inbox-memo-${target.id}"]`);
      await sleep(400);
      const closedAgain = await page.evaluate(
        (id) => !document.querySelector(`[data-testid="sale-inbox-memo-pane-${id}"]`), target.id);
      P('⑫ [메모] 를 **다시 누르면 닫힌다** (재클릭 토글)', closedAgain, `닫힘=${closedAgain}`);
    }

    // ── ⑮ 고객 탭이 상담 탭과 **같은 자리·같은 모양**인가 (3폭) ───────────────
    //   Irene: *"세일에서 고객탭은 필터랑 버튼 디자인들 위치 맞추라고 한거야."*
    //   ★ 두 탭을 **같은 실행에서 번갈아 재야** 한다 — 따로 재면 폭·스크롤 위치가 달라 비교가 거짓이 된다.
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await goto(page, '/sale');
      await dismissBlockers(page);
      await sleep(900);
      const read = () => page.evaluate(() => {
        const bar = document.querySelector('[data-testid="sale-filter-row"]');
        const row = document.querySelector('[data-testid="sale-inbox-chip-row"],[data-testid="sale-clients-chip-row"]');
        if (!bar || !row) return null;
        const br = bar.getBoundingClientRect(), rr = row.getBoundingClientRect();
        const cs = getComputedStyle(row);
        const chip = row.querySelector('button');
        const on = [...row.querySelectorAll('button')].find((b) => {
          const c = getComputedStyle(b); return c.borderTopColor !== 'rgb(226, 232, 240)';
        }) || chip;
        const oc = on ? getComputedStyle(on) : null;
        const cr = chip ? chip.getBoundingClientRect() : null;
        return {
          // ★ 틈은 **첫 칩**의 위끝으로 잰다 — 감싸는 상자(ChipRow)의 top 을 재면
          //   `padding-top` 이 상자 **안쪽**이라 상자는 안 움직이고 칩만 올라간다. 즉 결함을
          //   되살려도 초록이 뜬다(2026-09-14 양성 대조군이 실제로 그랬다).
          //   원래 신고의 "10px 차이" 가 정확히 **칩의 y** 였다.
          //   [[feedback_judge_measures_wrapper_not_defect]]
          gapFromFilter: cr ? Math.round(cr.top - br.bottom) : null,
          boxGap: Math.round(rr.top - br.bottom),          // 참고값(상자 기준 — 판정에 쓰지 않는다)
          left: Math.round(rr.left),
          padTop: cs.paddingTop, gap: cs.columnGap,
          chipH: cr ? Math.round(cr.height) : null,
          chipLeft: cr ? Math.round(cr.left) : null,
          onBorder: oc ? oc.borderTopColor : null,
          onBg: oc ? oc.backgroundColor : null,
          onColor: oc ? oc.color : null,
        };
      });
      const inbox = await read();
      await page.click('[data-testid="sale-tab-clients"]');
      await sleep(900);
      const clients = await read();
      const P = (n, ok, d) => push(`[${vp.key}] ${n}`, ok, d);
      if (!inbox || !clients) { P('⑮ 두 탭의 칩 줄을 찾았다', false, `inbox=${!!inbox} clients=${!!clients}`); continue; }

      P('⑮ 칩 줄이 **같은 자리**에서 시작한다 (필터줄과의 틈 동일)',
        inbox.gapFromFilter === clients.gapFromFilter && inbox.left === clients.left,
        `첫 칩의 틈 상담 ${inbox.gapFromFilter} / 고객 ${clients.gapFromFilter}px`
        + ` · 줄 left 상담 ${inbox.left} / 고객 ${clients.left}`
        + ` · (참고: 상자 기준 틈 ${inbox.boxGap}/${clients.boxGap} — 이 값으로 재면 결함을 못 잡는다)`);
      P('⑮ 칩의 **첫 x·높이**가 같다',
        inbox.chipLeft === clients.chipLeft && inbox.chipH === clients.chipH,
        `x 상담 ${inbox.chipLeft} / 고객 ${clients.chipLeft} · h 상담 ${inbox.chipH} / 고객 ${clients.chipH}`);
      P('⑮ 줄 규격(패딩·간격)이 같다',
        inbox.padTop === clients.padTop && inbox.gap === clients.gap,
        `padTop ${inbox.padTop}/${clients.padTop} · gap ${inbox.gap}/${clients.gap}`);
      P('⑮ **켜진 칩의 색**이 같다 (테두리·배경·글자)',
        inbox.onBorder === clients.onBorder && inbox.onBg === clients.onBg && inbox.onColor === clients.onColor,
        `상담 ${inbox.onBorder} / ${inbox.onBg} · 고객 ${clients.onBorder} / ${clients.onBg}`);
    }

    // ── ⑮-B 칩이 **여전히 눌리고 필터가 걸리는가** (데스크탑 1회) ─────────────
    //   ★ 모양만 재면 "예쁘게 죽은 버튼" 을 못 잡는다. 공용 껍데기로 갈아끼우면서
    //     `<Spacer />` 를 지웠으므로, 그 자리에 있던 칩이 사라지거나 죽지 않았는지 **눌러서** 본다
    //     (memory feedback_ui_control_sends_nothing · feedback_completed_but_dead_features).
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await goto(page, '/sale');
    await dismissBlockers(page);
    await sleep(900);
    const rowCountNow = () => page.evaluate(() =>
      document.querySelectorAll('[data-testid^="sale-inbox-row-"]').length);

    // 상담 탭 — 휴지통 칩(우측 끝, ChipRight 안)이 살아 있고 목록을 바꾸는가
    const trash = await page.$('[data-testid="sale-inbox-source-dismissed"]');
    push('⑮-B 휴지통 칩이 **사라지지 않았다**', !!trash, trash ? '있음' : 'ChipRight 로 옮기며 사라졌다');
    if (trash) {
      const n0 = await rowCountNow();
      await trash.click(); await sleep(1100);
      const n1 = await rowCountNow();
      const on = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="sale-inbox-source-dismissed"]');
        return b ? getComputedStyle(b).borderTopColor : null;
      });
      push('⑮-B 휴지통 칩을 누르면 **목록이 바뀐다**', n1 !== n0,
        `행 ${n0} → ${n1} · 켜진 테두리 ${on}`);
      push('⑮-B 눌린 칩이 **켜진 색**으로 보인다', on === 'rgb(13, 148, 136)', `borderColor=${on}`);
      await trash.click(); await sleep(900);   // 되돌린다(다음 검사 오염 금지)
    }

    // 고객 탭 — 단계 칩이 살아 있고 목록을 바꾸는가
    await page.click('[data-testid="sale-tab-clients"]'); await sleep(1100);
    const clientRows = () => page.evaluate(() =>
      document.querySelectorAll('[data-testid^="sale-row-"]').length);
    const c0 = await clientRows();
    const stageChip = await page.$('[data-testid="sale-stage-chip-inquiry"]');
    push('⑮-B 고객 탭 단계 칩이 **사라지지 않았다**', !!stageChip, stageChip ? '있음' : '없다');
    if (stageChip) {
      await stageChip.click(); await sleep(1200);
      const c1 = await clientRows();
      push('⑮-B 단계 칩을 누르면 **목록이 걸러진다**', c1 !== c0, `행 ${c0} → ${c1}`);
      // [전체] 로 되돌아갈 길이 있는가 (필터 전체 옵션 계약)
      const all = await page.$('[data-testid="sale-stage-chip-all"]');
      push('⑮-B [전체] 로 돌아갈 길이 있다', !!all, all ? '있음' : '없다');
      if (all) { await all.click(); await sleep(1200);
        const c2 = await clientRows();
        push('⑮-B [전체] 를 누르면 되돌아온다', c2 === c0, `행 ${c1} → ${c2} (원래 ${c0})`); }
    }
    // 한도 표시는 ChipRight 안에서 살아 있는가
    const quota = await page.$('[data-testid="sale-quota"]');
    push('⑮-B 한도 표시가 **사라지지 않았다**', !!quota, quota ? '있음' : 'ChipRight 로 옮기며 사라졌다');
    await page.click('[data-testid="sale-tab-inbox"]'); await sleep(900);

    // ── ⑭ Enter 전송 — 데스크탑에서 한 번만 (실제 POST 가 나가는지) ─────────
    //   ★ 음성 대조군: **Shift+Enter 는 보내지 않는다**(줄바꿈). 둘 다 재야 "Enter 로 보낸다" 가 증명된다.
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await goto(page, '/sale');
    await dismissBlockers(page);
    await sleep(900);
    const rid = await page.evaluate(() => {
      const r = document.querySelector('[data-testid^="sale-inbox-row-"]');
      return r ? r.getAttribute('data-testid').replace('sale-inbox-row-', '') : null;
    });
    if (!rid) { push('⑭ Enter 전송 — 판정 불가', false, '행 0건'); return results; }

    const posts = [];
    page.on('request', (req) => { if (req.method() === 'POST' && /\/notes?\b|consult-notes|\/notes$/.test(req.url())) posts.push(req.url()); });
    await page.click(`[data-testid="sale-inbox-memo-${rid}"]`);
    await sleep(600);
    const hasInput = await page.evaluate(() => !!document.querySelector('[data-testid="note-input"]'));
    if (!hasInput) { push('⑭ Enter 전송 — 판정 불가', false, '메모 입력칸 없음'); return results; }

    // 음성 대조군 — Shift+Enter 는 줄바꿈이지 전송이 아니다
    await page.click('[data-testid="note-input"]');
    await page.type('[data-testid="note-input"]', '카나리 줄바꿈 시험');
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    await sleep(500);
    const afterShift = posts.length;
    const shiftText = await page.evaluate(() => document.querySelector('[data-testid="note-input"]').value);
    push('⑭ 음성 대조군 — Shift+Enter 는 보내지 않는다 (줄바꿈)',
      afterShift === 0 && /\n/.test(shiftText), `POST ${afterShift}건 · 줄바꿈 ${/\n/.test(shiftText)}`);

    // 본 판정 — Enter 는 보낸다
    await page.keyboard.press('Enter');
    await sleep(1200);
    push('⑭ Enter 로 메모가 전송된다', posts.length >= 1, `POST ${posts.length}건 ${posts[0] || ''}`);
    const cleared = await page.evaluate(() => (document.querySelector('[data-testid="note-input"]') || {}).value);
    push('⑭ 전송 성공하면 입력칸이 비워진다', cleared === '', `남은 값 "${cleared}"`);

    // ── ⑫ [메모보기 ⌄] — 방금 만든 메모로 **커버리지를 직접 만든다** ───────────
    //   ★ dev 상담 목록에는 메모가 달린 행이 하나도 없어 ⑫ 가 계속 "미측정" 이었다.
    //     0건을 초록으로 넘기지 않는다(memory feedback_empty_fixture_false_verdict) —
    //     방금 Enter 로 넣은 메모가 있으니 그 행으로 잰다.
    //   ★ 잰 뒤에는 **지운다**. 남기면 다음 실행마다 쌓이고, 뒤 스위트의 판정을 흔든다
    //     (memory feedback_canary_pollutes_next_suite).
    if (posts.length >= 1) {
      await goto(page, '/sale');
      await dismissBlockers(page);
      await sleep(900);
      // ★ 2026-09-14 4차 — 여기가 이 카나리에서 **유일하게 «있음» 을 만들어 낼 수 있는 자리**다.
      //   메모를 방금 달았으니 그 행의 점이 **칠해져야** 하고, 폭은 **다른 행과 같아야** 한다.
      //   (위 3폭 판정은 목록에 있음·없음이 둘 다 있어야 폭을 비교할 수 있다 — 여기서는 확정이다.)
      const tg = await page.evaluate((id) => {
        const row = document.querySelector(`[data-testid="sale-inbox-row-${id}"]`);
        if (!row) return { missing: 'row' };
        const readBtn = (r) => {
          // ★ 접두어가 겹친다 — `sale-inbox-memo-count-*` 가 `sale-inbox-memo-*` 에도 걸린다.
          //   **버튼만** 집으려면 정확한 id 로 본다(안 그러면 숫자 span 을 버튼으로 재게 된다).
          const rid = (r.getAttribute('data-testid') || '').replace('sale-inbox-row-', '');
          const b = r.querySelector(`[data-testid="sale-inbox-memo-${rid}"]`);
          if (!b) return null;
          const br = b.getBoundingClientRect();
          const cnt = b.querySelector(`[data-testid="sale-inbox-memo-count-${rid}"]`);
          return {
            has: b.getAttribute('data-has-notes') === '1',
            w: Math.round(br.width),
            label: (b.innerText || '').replace(/\s+/g, ' ').trim(),
            aria: b.getAttribute('aria-label') || '',
            countPresent: !!cnt,
            countText: cnt ? (cnt.innerText || '').trim() : '',
            countColor: cnt ? getComputedStyle(cnt).color : '',
          };
        };
        const mine = readBtn(row);
        // 같은 목록의 **다른 행**들 폭 — 있음/없음이 폭을 바꾸지 않는지 대조
        const others = [...document.querySelectorAll('[data-testid^="sale-inbox-row-"]')]
          .filter((r) => r !== row).map(readBtn).filter(Boolean);
        return {
          mine, otherW: [...new Set(others.map((o) => o.w))],
          otherHasOff: others.filter((o) => !o.has).length,
          toggleGone: !(row.parentElement && row.parentElement.querySelector('[data-testid^="sale-inbox-memo-toggle-"]')),
        };
      }, rid);
      push('⑫ 행 아래 [메모보기 ⌄] 손잡이가 없다', tg.toggleGone === true, `남아 있음=${!tg.toggleGone}`);
      push('⑪ 메모를 달면 그 행의 **숫자가 1 이상으로 바뀐다** (0 이 아니다)',
        !tg.missing && !!tg.mine && Number(tg.mine.countText) >= 1 && tg.mine.has === true,
        tg.missing ? `없음(${tg.missing})` : `숫자="${tg.mine && tg.mine.countText}" has=${tg.mine && tg.mine.has}`);
      if (!tg.missing && tg.mine) {
        push('⑪ 라벨이 "메모 N" 모양이다', /\d/.test(tg.mine.label || ''), `"${tg.mine.label}"`);
        push('⑫ 이름(aria)이 개수를 말한다', !!tg.mine.aria && /\d/.test(tg.mine.aria),
          `aria="${tg.mine.aria}"`);
        // ★ 0 → 1 이 되는 순간 **색도 바뀌어야** 한다. 여기가 색 전이를 실제로 잴 수 있는
        //   유일한 자리다(dev 목록은 그냥 읽으면 전부 0이다).
        push('⑫ 메모가 생기면 숫자 색이 **회색 → 녹색**으로 바뀐다',
          /rgb\(13,\s*148,\s*136\)/.test(tg.mine.countColor || ''),
          `색=${tg.mine.countColor}`);
        // ★ 신고의 본문 — 메모가 달린 행과 안 달린 행의 버튼 폭이 같아야 한다
        if (tg.otherHasOff > 0) {
          push('⑫ 메모 있는 행과 없는 행의 [메모] 버튼 **폭이 같다**',
            tg.otherW.length === 1 && tg.otherW[0] === tg.mine.w,
            `있음 ${tg.mine.w}px vs 나머지 {${tg.otherW.join(', ')}}px (없음 행 ${tg.otherHasOff}건)`);
        } else {
          push('⑫ 폭 대조군 — 메모 없는 행이 같은 목록에 있어야 한다', false,
            '없음 행 0건 — 폭 비교가 거짓 통과한다');
        }
        // 같은 버튼으로 열린다
        await page.click(`[data-testid="sale-inbox-memo-${rid}"]`);
        await sleep(500);
        const opened = await page.evaluate((id) => !!document.querySelector(`[data-testid="sale-inbox-memo-pane-${id}"]`), rid);
        push('⑫ [메모] 버튼으로 메모판이 열린다', opened, `열림=${opened}`);
      }
      // ── 뒷정리 — 방금 넣은 메모를 지운다(원장 원복) ──
      try {
        if (!await page.evaluate((id) => !!document.querySelector(`[data-testid="sale-inbox-memo-pane-${id}"]`), rid)) {
          await page.click(`[data-testid="sale-inbox-memo-${rid}"]`); await sleep(600);
        }
        const removed = await page.evaluate(() => {
          const pane = document.querySelector('[data-testid^="sale-inbox-memo-pane-"]');
          if (!pane) return 0;
          const dels = [...pane.querySelectorAll('button')].filter((b) => /^삭제$|^Delete$/.test((b.innerText || '').trim()));
          dels.forEach((b) => b.click());
          return dels.length;
        });
        await sleep(900);
        push('뒷정리 — 카나리가 넣은 메모를 지웠다', removed >= 1, `지운 건수 ${removed}`);
      } catch (e) { push('뒷정리 — 카나리가 넣은 메모를 지웠다', false, String(e && e.message || e)); }
    }

    return results;
  } catch (e) {
    push('카나리 실행', false, String(e && e.message || e));
    return results;
  } finally {
    await browser.close();
  }
}

module.exports = { name: 'Q sale 배치 (2차 신고 15건)', run };
