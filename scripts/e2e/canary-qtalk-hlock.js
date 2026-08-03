// canary-qtalk-hlock — Q Talk 세로 스크롤 영역이 "가로로는 절대 안 움직이는가"를 실브라우저로 감시한다.
//
// 왜 런타임 카나리인가 (정적 grep 이 못 잡는다):
//   운영 피드백 #245 "모바일에서 Q talk 채팅창이 고정되지 않고 좌우로 흔들립니다".
//   근인은 CSS 규칙이다 — 한 축만 `overflow-y: auto` 로 두면 **반대축 계산값이
//   visible → auto 로 강제**된다. 소스에는 `overflow-x` 라는 글자가 아예 없으므로
//   grep 으로는 영원히 안 잡히고, computed style 을 실제로 읽어야만 드러난다.
//   그 상태에서는 콘텐츠가 1px 만 넘쳐도 채팅창 전체가 좌우로 스크롤된다
//   (macOS 트랙패드 두 손가락 대각선 스크롤 = 사용자가 말한 "흔들림").
//
// 판정 2축:
//   ① 정적 — Q Talk 안의 세로 스크롤러 중 계산 overflow-x 가 auto|scroll 인 것이 있으면 실패
//   ② 동적 — 폭이 넘치는 프로브를 주입하고 가로 휠을 굴려 scrollLeft 가 0 이 아니면 실패
//            (①을 통과해도 다른 조상이 스크롤되면 흔들림은 그대로이므로 실제로 굴려본다)
//
// 반증 확인 방법: ChatPanel.tsx MessageList 의 `overflow-x: hidden` 한 줄을 지우면
//   ①과 ② 가 함께 FAIL 해야 한다 (cp 백업으로 되돌릴 것 — `git checkout --` 금지).
const { launch, login, goto, sleep } = require('./lib/browser');

// 신고자 실환경 — client_env {"vw":440,"vh":720,"platform":"MacIntel","standalone":true}.
// 데스크탑 UA + 좁은 창(모바일 에뮬레이션 아님)이 핵심 — 터치 에뮬레이션을 켜면
// 트랙패드 가로휠 경로를 못 밟는다.
const VP = { width: 440, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 2 };

// 브라우저 안에서 실행 — Node 스코프 참조 금지.
const SCAN = () => {
  const out = [];
  for (const el of document.querySelectorAll('div,section,main,ul')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) continue;              // 자잘한 팝오버 제외
    if (!/auto|scroll/.test(cs.overflowY)) continue;            // 세로 스크롤러만
    if (!/auto|scroll/.test(cs.overflowX)) continue;            // 가로가 잠겨 있으면 통과
    out.push({
      cls: String(el.className || '').split(' ').slice(0, 2).join('.') || el.tagName.toLowerCase(),
      w: Math.round(r.width), h: Math.round(r.height),
      overflowX: cs.overflowX,
    });
  }
  return out.slice(0, 10);
};

// 가장 큰 세로 스크롤러(= 메시지 영역)에 넘치는 프로브를 심고 가로로 굴려본다.
const PROBE_SETUP = () => {
  let best = null;
  for (const el of document.querySelectorAll('div,section,main')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!/auto|scroll/.test(cs.overflowY)) continue;
    if (r.width < 200 || r.height < 200) continue;
    if (!best || r.width * r.height > best.area) best = { el, area: r.width * r.height };
  }
  if (!best) return null;
  const probe = document.createElement('div');
  probe.id = '__hlock_probe';
  probe.style.cssText = 'width:2000px;height:8px;flex:none;';
  best.el.appendChild(probe);
  best.el.setAttribute('data-hlock-target', '1');
  const r = best.el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};

const PROBE_READ = () => {
  const el = document.querySelector('[data-hlock-target="1"]');
  return el ? { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
};

// 주입물 전량 제거 — 하니스가 화면 상태를 남기지 않는다.
const PROBE_CLEANUP = () => {
  document.getElementById('__hlock_probe')?.remove();
  document.querySelector('[data-hlock-target="1"]')?.removeAttribute('data-hlock-target');
  return !!document.getElementById('__hlock_probe');
};

async function run() {
  const results = [];
  const { browser, page } = await launch();
  try {
    await page.setViewport(VP);
    await login(page);
    await goto(page, '/talk');
    await sleep(1500);

    // ── ① 정적: 가로가 열린 세로 스크롤러 ──
    const open = await page.evaluate(SCAN);
    results.push({
      route: 'qtalk/세로 스크롤러 가로축 잠김',
      leaked: open.length > 0,
      detail: open.length
        ? `— 가로 열린 스크롤러 ${open.length}개: ` + open.map((o) => `${o.cls}(${o.w}px, overflow-x:${o.overflowX})`).join(', ')
        : '— 전부 잠김',
    });

    // ── ② 동적: 실제로 가로로 굴러가는가 ──
    const at = await page.evaluate(PROBE_SETUP);
    if (!at) {
      results.push({ route: 'qtalk/가로 휠 스크롤', error: '세로 스크롤러를 못 찾음 (화면 미로드 의심)' });
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel({ deltaX: 120, deltaY: 0 });
      await sleep(250);
      const m = await page.evaluate(PROBE_READ);
      const moved = !!m && m.scrollLeft !== 0;
      results.push({
        route: 'qtalk/가로 휠 스크롤',
        leaked: moved,
        detail: moved
          ? `— 가로 휠에 scrollLeft=${m.scrollLeft} 이동 (사용자가 보는 "흔들림")`
          : '— scrollLeft 0 (움직이지 않음)',
      });
      const dirty = await page.evaluate(PROBE_CLEANUP);
      if (dirty) results.push({ route: 'qtalk/프로브 정리', error: '주입 프로브 제거 실패' });
    }
  } catch (e) {
    results.push({ route: 'canary-qtalk-hlock', error: e.message.slice(0, 90) });
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { run, name: 'canary-qtalk-hlock' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== Q Talk 가로 잠금 카나리 (#245) ===\n');
    for (const r of res) {
      const isBad = r.leaked || r.error;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'}  ${r.route} ${r.detail || r.error || ''}`);
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
