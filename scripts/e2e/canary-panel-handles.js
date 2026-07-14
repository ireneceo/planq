// canary-panel-handles — 패널 접기/펼치기 화살표가 "축마다 하나뿐인가"를 실브라우저로 감시한다.
//
// 왜 런타임 카나리인가 (정적 grep 이 못 잡는다):
//   표준 핸들(PanelEdgeHandle / FloatingPanelToggle)은 멀쩡한데, 화면 헤더에 맨 chevron 버튼을
//   하나 더 두면 **패널이 접힌 상태에서만** 화살표가 둘로 보인다. 두 컨트롤은 파일도 클래스도
//   달라서 코드를 읽어선 겹치는지 알 수 없다 — 접고, 폭을 줄여, 띄워봐야 드러난다.
//   실제로 ChatPanel 헤더의 '우측 열기'·'좌측 열기' chevron 3개가 그렇게 숨어 있었다.
//
// 판정: 대화 상세를 연 뒤 좌·우 패널을 접고, 뷰포트별로 같은 축의 토글 화살표가 2개 이상이면 실패.
const { launch, login, goto, sleep } = require('./lib/browser');

const WIDTHS = [1440, 1201, 1200, 1000];

// 주의: COLLECT 는 브라우저 안에서 실행된다 — Node 스코프의 상수를 참조할 수 없다(정규식을 안에 둔다).
const COLLECT = () => {
  const TOGGLE_LABELS = /접기|열기|펼치기|작업대|목록|리스트|패널|맥락/;
  const BACK_LABELS = /돌아가기|back/i;
  // 앱 전역 내비 사이드바는 화면 안 패널이 아니다 — 같은 축에 있어도 여는 대상이 다르다
  const APP_NAV = /사이드바/;
  const vw = window.innerWidth;
  const out = [];
  document.querySelectorAll('button').forEach((b) => {
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0) return;
    const svg = b.querySelector('svg');
    if (!svg) return;
    const inner = svg.innerHTML || '';
    // chevron 단독 아이콘만 (복합 아이콘은 패널 토글이 아니다)
    const isChevron = /<polyline[^>]*points="[^"]*"/.test(inner) && (inner.match(/</g) || []).length <= 2;
    if (!isChevron) return;
    const label = b.getAttribute('aria-label') || b.title || '';
    out.push({
      label: label || '(무라벨)',
      isToggle: TOGGLE_LABELS.test(label) && !APP_NAV.test(label),
      isBack: BACK_LABELS.test(label) || APP_NAV.test(label),
      side: r.x > vw / 2 ? 'right' : 'left',
      x: Math.round(r.x),
    });
  });
  return out;
};

async function openConv(page) {
  await page.evaluate(() => {
    const cands = [...document.querySelectorAll('div')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.x >= 0 && r.x < 400 && r.width > 150 && r.height > 45 && r.height < 100 && r.y > 180;
    });
    const byClass = new Map();
    cands.forEach((el) => {
      const k = typeof el.className === 'string' ? el.className : '';
      if (k) { if (!byClass.has(k)) byClass.set(k, []); byClass.get(k).push(el); }
    });
    let best = null;
    byClass.forEach((els) => { if (els.length >= 3 && (!best || els.length > best.length)) best = els; });
    if (best) best[0].click();
  });
  await sleep(2000);
}

// 접힘 상태에서만 드러나는 결함이라 좌·우를 모두 접는다
async function collapseBoth(page) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .filter((b) => /접기/.test(b.getAttribute('aria-label') || ''))
      .forEach((b) => b.click());
  });
  await sleep(900);
}

async function run() {
  const results = [];
  const { browser, page } = await launch();
  try {
    await login(page);
    await page.setViewport({ width: 1440, height: 900 });
    await goto(page, '/talk');
    await sleep(1400);
    await openConv(page);

    const opened = await page.evaluate(() => /[?&]conv=\d+/.test(location.search));
    if (!opened) {
      // 대화를 못 열면 접힘 상태를 못 만든다 — 통과로 위장하면 안 된다 (헛통과 차단)
      results.push({ route: 'Q Talk 대화 열기', fatal: 1, detail: '대화 선택 실패 — 접힘 상태 미검증' });
      return results;
    }
    await collapseBoth(page);

    // 자가 반증 모드 (E2E_INJECT_DUP=1) — 없앤 그 중복 화살표를 헤더에 다시 심는다.
    // 이 카나리가 "죽은 가드"가 아님을 증명하는 용도. 정상 실행에선 절대 켜지 않는다.
    if (process.env.E2E_INJECT_DUP === '1') {
      await page.evaluate(() => {
        const header = document.querySelector('header, [class*="HeaderBar"]') || document.body;
        const b = document.createElement('button');
        b.setAttribute('aria-label', '우측 열기');
        b.style.cssText = 'position:fixed;top:160px;right:40px;width:30px;height:30px;z-index:999;';
        b.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>';
        header.appendChild(b);
      });
      await sleep(300);
    }

    for (const w of WIDTHS) {
      await page.setViewport({ width: w, height: 900 });
      await sleep(1100);
      const arrows = await page.evaluate(COLLECT);
      const toggles = arrows.filter((a) => a.isToggle);
      const orphans = arrows.filter((a) => !a.isToggle && !a.isBack);

      for (const side of ['left', 'right']) {
        const mine = toggles.filter((a) => a.side === side);
        results.push({
          route: `${w}px ${side}`,
          leaked: mine.length > 1,
          detail: mine.length > 1
            ? `— 토글 화살표 ${mine.length}개 (하나여야 한다): ${mine.map((a) => `"${a.label}"@${a.x}`).join(' + ')}`
            : `— 토글 화살표 ${mine.length}개`,
        });
      }
      if (orphans.length) {
        results.push({
          route: `${w}px 정체불명 chevron`,
          leaked: true,
          detail: `— 표준 핸들 밖 화살표 ${orphans.length}개: ${orphans.map((o) => `"${o.label}"@${o.x}`).join(', ')}`,
        });
      }
    }
  } catch (e) {
    results.push({ route: 'canary-panel-handles', error: e.message.slice(0, 90) });
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { run, name: 'canary-panel-handles' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 패널 핸들 카나리 (접힘 상태에서 축마다 화살표 1개) ===\n');
    for (const r of res) {
      const isBad = r.leaked || r.error || r.fatal;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'}  ${r.route} ${r.detail || r.error || ''}`);
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
