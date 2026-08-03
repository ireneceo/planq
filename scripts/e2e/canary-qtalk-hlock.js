// canary-qtalk-hlock — Q Talk **메시지 영역**이 "가로로는 절대 안 움직이는가"를 실브라우저로 감시한다.
//
// 왜 런타임 카나리인가 (정적 grep 이 못 잡는다):
//   운영 피드백 #245 "모바일에서 Q talk 채팅창이 고정되지 않고 좌우로 흔들립니다".
//   근인은 CSS 규칙이다 — 한 축만 `overflow-y: auto` 로 두면 **반대축 계산값이
//   visible → auto 로 강제**된다. 소스에는 `overflow-x` 라는 글자가 아예 없으므로
//   grep 으로는 영원히 안 잡히고, computed style 을 실제로 읽어야만 드러난다.
//   그 상태에서는 콘텐츠가 1px 만 넘쳐도 채팅창 전체가 좌우로 스크롤된다
//   (macOS 트랙패드 두 손가락 대각선 스크롤 = 사용자가 말한 "흔들림").
//
// ★ 이 파일의 1차 버전은 **거짓 PASS 가드**였다 (Fable 검증 게이트가 반증으로 확정).
//   440px 에서 `/talk` 에 들어가면 모바일 레이아웃이라 **ChatPanel 이 마운트되지 않는다** —
//   대화를 클릭해야 열린다. 그런데 1차 버전은 대화를 열지 않고 "가장 큰 스크롤러"를 휴리스틱으로
//   골랐고, 그래서 감시 대상(메시지 영역)이 아니라 **좌측 대화 리스트**를 굴리고 있었다.
//   MessageList 의 `overflow-x: hidden` 을 지우고 재빌드해도 2/2 PASS 가 났다.
//   → 교훈 2개를 이 버전에 박제한다:
//     (a) 대상은 휴리스틱이 아니라 **data-testid 로 확정적으로** 집는다
//     (b) **fail-closed** — 대상을 못 찾으면 "통과"가 아니라 **실패**다.
//        (memory `feedback_guard_must_be_falsified` — 안 잡는 가드는 없는 것보다 나쁘다)
//
// 판정 2축 (둘 다 메시지 영역 한정):
//   ① 정적 — 메시지 영역의 계산 overflow-x 가 auto|scroll 이면 실패
//   ② 동적 — 폭이 넘치는 프로브를 심고 가로 휠을 굴려 scrollLeft 가 0 이 아니면 실패
//            (①을 통과해도 조상이 스크롤되면 흔들림은 그대로이므로 실제로 굴려본다)
//
// 반증 확인 방법: ChatPanel.tsx MessageList 의 `overflow-x: hidden` 한 줄을 지우고 **재빌드**하면
//   ①②가 FAIL 해야 한다. (cp 백업으로 원복할 것 — `git checkout --` 금지)
const { launch, login, goto, sleep } = require('./lib/browser');

// 신고자 실환경 — client_env {"vw":440,"vh":720,"platform":"MacIntel","standalone":true}.
// 데스크탑 UA + 좁은 창(모바일 에뮬레이션 아님)이 핵심 — 터치 에뮬레이션을 켜면
// 트랙패드 가로휠 경로를 못 밟는다.
const VP = { width: 440, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 2 };
const TARGET = '[data-testid="qtalk-messages"]';

// 브라우저 안에서 실행 — Node 스코프 참조 금지.
const READ_TARGET = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    overflowX: cs.overflowX,
    overscrollX: cs.overscrollBehaviorX,
    w: Math.round(r.width), h: Math.round(r.height),
  };
};

const PROBE_SETUP = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const probe = document.createElement('div');
  probe.id = '__hlock_probe';
  probe.style.cssText = 'width:2000px;height:8px;flex:none;';
  el.appendChild(probe);
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};

const PROBE_READ = (sel) => {
  const el = document.querySelector(sel);
  return el ? { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
};

// 주입물 전량 제거 — 하니스가 화면 상태를 남기지 않는다.
const PROBE_CLEANUP = () => {
  document.getElementById('__hlock_probe')?.remove();
  return !!document.getElementById('__hlock_probe');
};

// 좌측 목록의 첫 대화를 연다 (모바일 폭에서는 이걸 해야 ChatPanel 이 마운트된다).
const OPEN_FIRST_CHAT = () => {
  const rows = document.querySelectorAll('[data-qtalk-chat]');
  if (!rows.length) return { ok: false, reason: 'no_chat_rows' };
  rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { ok: true, id: rows[0].getAttribute('data-qtalk-chat'), count: rows.length };
};

async function run() {
  const results = [];
  const { browser, page } = await launch();
  try {
    await page.setViewport(VP);
    await login(page);
    await goto(page, '/talk');
    await sleep(1500);

    // ── 대화를 실제로 연다 ── (열지 못하면 아래 검사가 무의미하므로 fail-closed)
    const opened = await page.evaluate(OPEN_FIRST_CHAT);
    if (!opened.ok) {
      results.push({
        route: 'qtalk/대화 열기',
        error: `대화 행을 못 찾음(${opened.reason}) — 검사 대상 미도달. 계정에 대화가 있어야 한다`,
      });
      return results;
    }
    await sleep(2200);

    // ── 대상 확보 (fail-closed) ──
    let target = await page.evaluate(READ_TARGET, TARGET);
    if (!target) { await sleep(2500); target = await page.evaluate(READ_TARGET, TARGET); }
    if (!target) {
      results.push({
        route: 'qtalk/메시지 영역 확보',
        error: `${TARGET} 미발견 — ChatPanel 미마운트. 검사하지 못했으므로 실패로 판정(fail-closed)`,
      });
      return results;
    }
    results.push({
      route: 'qtalk/메시지 영역 확보',
      detail: `— ${target.w}×${target.h}px 마운트됨`,
    });

    // ── ① 정적: 가로축이 잠겨 있는가 ──
    const lockedX = !/auto|scroll/.test(target.overflowX);
    results.push({
      route: 'qtalk/메시지 영역 가로축 잠김',
      leaked: !lockedX,
      detail: lockedX
        ? `— overflow-x:${target.overflowX} · overscroll-behavior-x:${target.overscrollX}`
        : `— overflow-x:${target.overflowX} (한 축만 auto 로 두면 반대축이 auto 로 강제된다)`,
    });

    // ── ② 동적: 실제로 가로로 굴러가는가 ──
    const at = await page.evaluate(PROBE_SETUP, TARGET);
    if (!at) {
      results.push({ route: 'qtalk/가로 휠 스크롤', error: '프로브 주입 실패 — 검사 못 함(fail-closed)' });
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel({ deltaX: 120, deltaY: 0 });
      await sleep(250);
      const m = await page.evaluate(PROBE_READ, TARGET);
      const moved = !!m && m.scrollLeft !== 0;
      results.push({
        route: 'qtalk/가로 휠 스크롤',
        leaked: moved,
        detail: moved
          ? `— 가로 휠에 scrollLeft=${m.scrollLeft} 이동 (사용자가 보는 "흔들림")`
          : `— scrollLeft 0 (넘치는 프로브 ${m ? m.scrollWidth - m.clientWidth : '?'}px 를 심었는데도 안 움직임)`,
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
    console.log('\n=== Q Talk 메시지 영역 가로 잠금 카나리 (#245) ===\n');
    for (const r of res) {
      const isBad = r.leaked || r.error;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'}  ${r.route} ${r.detail || r.error || ''}`);
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
