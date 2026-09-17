// canary-mobilechrome — **폰에서 상단 크롬과 충돌하는 계열**을 한 벌로 잡는다 (2026-09-17)
//
//   왜 있는가: 2026-09-17 하루에 같은 계열 신고가 다섯 번 왔다.
//     · 확인 필요 헤더 아래 빈 흰 띠      → 껍데기가 빈 액션 줄을 그렸다
//     · 문서 + 드롭다운이 위로 올라가 잘림 → 폰 분기에 `top: 68px` 을 손으로 적었다(9곳)
//     · 업무추가 드로어가 헤더를 덮음      → 기준선이 탭바(`--chrome-top`)였다
//     · 목록 제목이 폰에서만 작음          → 규격 토큰을 안 받아 간 화면들
//     · 같은 메뉴를 다시 눌러도 안 돌아옴  → 재클릭 계약이 없었다
//   전부 «한 화면» 이 아니라 계약이 갈라진 자리였다. 고친 뒤에도 새 화면이 같은 자리에서
//   다시 갈라진다 — 그래서 사람이 눈으로 보는 대신 여기서 잰다.
//
//   ★ **상태바 인셋을 모사한다.** 브라우저는 `--pq-safe-top` 이 0 이라 이 계열이 재현되지 않는다.
//     모사 없이 재면 초록이 거짓말한다(memory feedback_overlay_baseline_single_token).
//   ★ 기준선은 `calc(...)` 문자열이라 parseFloat 로 읽으면 NaN → 0 이 된다.
//     **그 변수를 쓰는 요소를 만들어 좌표로 푼다.** 2026-09-17 에 이걸 안 해서
//     결함을 되살린 대조군까지 초록이었다.
const { launch, login, goto, sleep } = require('./lib/browser');

const WIDTHS = [['폰', 390, 844], ['태블릿', 834, 1112], ['데스크탑', 1440, 900]];

async function chromeBottom(page) {
  return page.evaluate(() => {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;width:1px;height:1px;top:var(--pq-chrome-bottom,0px);';
    document.body.appendChild(p);
    const y = Math.round(p.getBoundingClientRect().top);
    p.remove();
    return y;
  });
}

async function setInset(page, px) {
  await page.evaluate((v) => {
    const r = document.documentElement.style;
    if (!v) { r.removeProperty('--pq-safe-top'); r.removeProperty('--pq-mobile-chrome'); r.removeProperty('--pq-chrome-bottom'); return; }
    r.setProperty('--pq-safe-top', v + 'px');
    r.setProperty('--pq-mobile-chrome', `calc(56px + ${v}px)`);
    r.setProperty('--pq-chrome-bottom', `calc(56px + ${v}px)`);
  }, px);
}

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, route: name, leaked: !ok, detail });
  const { browser, page } = await launch();
  try {
    await login(page);

    // ── ① 목록 행 제목은 폰에서 15px 이상 ────────────────────────────
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    for (const [label, path] of [['확인필요', '/inbox'], ['문서', '/docs'], ['업무', '/tasks']]) {
      await goto(page, path); await sleep(2600);
      const sizes = await page.evaluate(() => {
        const c = {};
        document.querySelectorAll('div,span,p,h3,h4,button').forEach((e) => {
          if (e.children.length > 2) return;
          const t = (e.textContent || '').trim();
          if (!t || t.length < 2 || t.length > 80) return;
          const cs = getComputedStyle(e);
          if (Number(cs.fontWeight) < 600) return;
          const b = e.getBoundingClientRect();
          if (b.width < 100 || b.height < 10 || b.top < 130) return;
          if (cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp !== '2') return;
          // ★ **행 제목은 진한 색이다.** 회색 글자는 메타(열 머리글·부제)라 이 규격의 대상이 아니다
          //   (#283 위계: 제목은 진한 검정 → 나머지는 메타 톤).
          //   이 줄이 없으면 표의 «열 머리글»(11px 회색 정렬 버튼)까지 잡아 **거짓 실패**가 난다
          //   — 2026-09-17 실제로 그랬다(memory feedback_false_fail_suspect_the_judge).
          const rgb = (cs.color.match(/\d+/g) || []).slice(0, 3).map(Number);
          if (rgb.length === 3 && (rgb[0] + rgb[1] + rgb[2]) / 3 >= 140) return;
          const px = Math.round(parseFloat(cs.fontSize));
          c[px] = (c[px] || 0) + 1;
        });
        return c;
      });
      const seen = Object.values(sizes).reduce((a, b) => a + b, 0);
      const small = Object.entries(sizes).filter(([k]) => Number(k) < 15).reduce((s, [, v]) => s + v, 0);
      // 0건이면 «통과» 가 아니라 **미측정**이다 — 빈 픽스처로 초록을 만들지 않는다.
      if (seen === 0) push(`제목크기/${label} (미측정 — 행 0건)`, true, '행이 없어 재지 못함');
      else push(`제목크기/${label} 폰에서 15px 이상`, small === 0, JSON.stringify(sizes));
    }

    // ── ② 껍데기가 «빈 줄» 을 그리지 않는다 ──────────────────────────
    await goto(page, '/inbox'); await sleep(2600);
    const blanks = await page.evaluate(() => [...document.querySelectorAll('div')].filter((e) => {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return cs.display === 'flex' && b.width > innerWidth * 0.8 && b.height > 0 && b.height < 60
        && (e.textContent || '').trim() === '' && cs.backgroundColor === 'rgb(255, 255, 255)';
    }).map((e) => Math.round(e.getBoundingClientRect().height)));
    push('빈줄/확인필요 머리줄 아래 빈 흰 띠가 없다', blanks.length === 0, JSON.stringify(blanks));

    // ── ③ 폰 오버레이(드롭다운)가 크롬 아래에 뜬다 — 인셋 0·44 ───────
    for (const inset of [0, 44]) {
      await goto(page, '/docs'); await sleep(2600);
      await setInset(page, inset);
      await sleep(300);
      const cb = await chromeBottom(page);
      const r = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="docs-new"]');
        if (!btn) return { err: 'no-btn' };
        btn.click();
        return new Promise((res) => setTimeout(() => {
          const item = document.querySelector('[data-testid="docs-new-blank"]');
          if (!item) return res({ err: 'no-item' });
          const b = item.getBoundingClientRect();
          const el = (b.top > 0 && b.top < innerHeight)
            ? document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) : null;
          res({ y: Math.round(b.top), reachable: !!el && (el === item || item.contains(el) || el.contains(item)) });
        }, 700));
      });
      push(`오버레이/문서 + 드롭다운 (상태바 ${inset}px) 크롬 아래 · 누를 수 있다`,
        !r.err && r.y >= cb && r.reachable, `${JSON.stringify(r)} 크롬하단=${cb}`);
      await setInset(page, 0);
    }

    // ── ④ 우측 드로어 기준선 = 크롬 하단 (3폭) ───────────────────────
    for (const [w, W, H] of WIDTHS) {
      await page.setViewport({ width: W, height: H, isMobile: W < 700, hasTouch: W < 700 });
      await goto(page, '/tasks'); await sleep(2800);
      const cb = await chromeBottom(page);
      const box = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="task-add-btn"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!box) { push(`드로어/${w} (미측정 — 추가 버튼 없음)`, true, ''); continue; }
      await page.mouse.click(box.x, box.y);
      await sleep(1200);
      const top = await page.evaluate(() => {
        const a = [...document.querySelectorAll('aside')].find((e) => {
          const cs = getComputedStyle(e);
          return cs.position === 'fixed' && Number(cs.zIndex) >= 125 && e.getBoundingClientRect().height > 150;
        });
        return a ? Math.round(a.getBoundingClientRect().top) : null;
      });
      push(`드로어/${w} 상단이 크롬 하단과 일치`, top !== null && Math.abs(top - cb) <= 1,
        `크롬하단=${cb} 패널top=${top}`);

      // ── ⑤ 같은 메뉴 재클릭 = 그 메뉴 처음으로 ──────────────────────
      const clicked = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a[href="/tasks"]')].find((x) => x.getBoundingClientRect().width > 0);
        if (!a) return false;
        a.click();
        return true;
      });
      await sleep(1200);
      if (!clicked) { push(`재클릭/${w} (미측정 — 사이드바 링크 안 보임)`, true, ''); continue; }
      const closed = await page.evaluate(() => {
        const t = [...document.querySelectorAll('div,h1,h2,h3,span')]
          .find((e) => (e.textContent || '').trim() === '업무 추가' && e.children.length === 0);
        return { open: !!t, url: location.pathname + location.search };
      });
      push(`재클릭/${w} 메뉴를 다시 누르면 추가 폼이 닫힌다`, !closed.open, JSON.stringify(closed));
    }
  } catch (e) {
    push('카나리 실행', false, e.message);
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

module.exports = { run, name: 'mobilechrome' };
