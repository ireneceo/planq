// scripts/e2e/canary-caret-visible.js — **타이핑하는 동안** 캐럿이 키보드 위에 남는가
//
// 왜 새 검사기가 필요한가 (2026-09-01, Irene: "모바일에서 메일 답변 쓸 때 커서 위치가 엉망")
//   기존 mobile-keyboard 스위트는 입력요소에 **focus 만** 시키고 뷰포트를 줄여 가림을 봤다.
//   그래서 "누른 순간" 은 검사했지만 **누른 뒤 글을 쓰는 동안** 은 한 번도 검사한 적이 없다.
//   실제 사용자는 focus 하고 나서 여러 줄을 친다. 그때 캐럿은 한 줄씩 내려가는데
//   focus 이벤트도, 뷰포트 변화도 없으므로 **아무도 캐럿을 보지 않았다** →
//   캐럿이 키보드 뒤로 들어가 자기가 뭘 치는지 안 보인다.
//   이것이 "화면마다 한 곳씩 고쳐도 끝없이 나오던" 계열의 정체다. 컨테이너를 --vvh 로
//   옳게 묶은 화면(ChatPanel·StandardModal)도 타이핑 중엔 똑같이 가려졌다 —
//   즉 **화면별 버그가 아니라 공통 기능의 부재**였다. 그래서 검사도 공통으로 둔다.
//
// 왜 실브라우저인가 — 캐럿 rect 는 selection API 로만 읽힌다. 정적 검사로는 존재 자체를 못 본다.
//
// ★ 커버리지를 출력한다 — 대상 0개인 통과와 진짜 통과가 같은 얼굴이면 안 된다
//   (memory feedback_detector_must_report_coverage · feedback_empty_fixture_false_verdict).
const { launch, login, goto, sleep, MOBILE_VP } = require('./lib/browser');

const KEYBOARD_H = 336;   // lib/browser 와 같은 시뮬 키보드 높이
const LINES = 14;         // 캐럿을 확실히 뷰포트 밖으로 밀어낼 만큼

// 검사 대상 — 실제로 사람이 길게 쓰는 입력면.
const CASES = [
  {
    label: 'Q Mail 새 메일 본문 (RichEditor)',
    path: '/mail',
    open: async (page) => {
      await clickTestId(page, 'mail-list-expand'); await sleep(450);
      return clickTestId(page, 'mail-compose-open');
    },
    sel: '[contenteditable="true"]',
  },
  {
    // ★ Irene 이 실제로 신고한 화면. compose 모달과 달리 **스레드 본문 흐름 안에** 얹혀 있어
    //   컨테이너가 --vvh 로 묶여 있지 않다 — 여기서 캐럿 추적의 유무가 갈린다.
    label: 'Q Mail 답장 본문 (스레드 인라인)',
    path: '/mail',
    open: async (page) => {
      // 모바일은 목록이 먼저 — 스레드를 하나 열고 [답장하기] 를 누른다.
      await clickTestId(page, 'mail-list-expand'); await sleep(400);
      const row = await page.$('[data-testid="mail-thread-row"]');
      if (!row) return false;
      await row.click(); await sleep(1400);
      return clickTestId(page, 'mail-reply-open');
    },
    sel: '[contenteditable="true"]',
  },
  {
    // 모바일 /talk 는 목록이 먼저 뜬다 — 알림 링크와 같은 `?conv=` 로 방을 지목해야 입력줄이 나온다.
    //   (이 케이스가 없어서 **앱에서 가장 많이 쓰는 입력면**이 두 카나리 모두에서 건너뛰어졌다)
    label: 'Q Talk 메시지 입력 (textarea)',
    path: '/talk?conv=275',
    open: async () => true,
    sel: 'textarea',
  },
];

async function clickTestId(page, id) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el && el.offsetParent !== null) { el.click(); return true; }
    return false;
  }, id);
}

// 캐럿(또는 요소) 하단이 가시영역 안인가 — assertKeyboardSafe 와 같은 렌즈.
async function caretProbe(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    let rect = el.getBoundingClientRect();
    let kind = 'element';
    if (el.isContentEditable) {
      const s = getSelection();
      if (s && s.rangeCount) {
        const range = s.getRangeAt(0);
        const rs = range.getClientRects();
        if (rs.length) { rect = rs[rs.length - 1]; kind = 'caret'; }
        else {
          // ★ 접힌(collapsed) 캐럿은 getClientRects() 가 빈 배열을 주는 경우가 있다.
          //   그때 요소 rect 로 떨어지면 **캐럿이 아니라 편집기 상자**를 재게 되어
          //   검사기가 엉뚱한 것을 보고 통과시킨다. 영폭 span 을 잠깐 심어 캐럿 자리를 실측한다.
          const probe = document.createElement('span');
          probe.textContent = '\u200b';
          const r2 = range.cloneRange();
          r2.collapse(false);
          r2.insertNode(probe);
          const pr = probe.getBoundingClientRect();
          if (pr.height > 0 || pr.width >= 0) { rect = pr; kind = 'caret'; }
          const parent = probe.parentNode;
          probe.remove();
          if (parent && parent.normalize) parent.normalize();
        }
      }
    }
    return {
      kind,
      bottom: Math.round(rect.bottom),
      vvh: Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight),
      innerW: window.innerWidth,
      tag: el.tagName,
      ce: !!el.isContentEditable,
      cls: (el.className || '').toString().slice(0, 40),
      // ★ textarea/input 은 innerText 가 **항상 빈 문자열**이다 — 그것으로 재면 값이 있어도
      //   0 으로 읽혀 "입력 안 됨" 으로 오판한다(실제로 Q Talk 을 그렇게 건너뛰었다).
      len: ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? (el.value || '') : (el.innerText || '')).length,
      editable: el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT',
    };
  });
}

// ★ CDP `Input.insertText` 를 쓰면 안 된다 — contentEditable 에는 들어가지만
//   **React 제어 컴포넌트(textarea)에는 반영되지 않는다.** 그러면 캐럿이 처음 자리 그대로라
//   아무 일도 안 일어난 채 ✓ 가 찍힌다(실제로 Q Talk 이 그렇게 거짓 통과했다).
//   실제 키 이벤트로 친다 — 사용자 경로와 같고 React 도 정상 반응한다.
async function typeLines(page, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.type(`${i + 1}번째 줄 - 본문을 길게 씁니다.`, { delay: 1 });
    await page.keyboard.press('Enter');   // 조합이 열려 있지 않으므로 IME 와 무관
    await sleep(50);
  }
  await sleep(450);   // 캐럿 추적 rAF + 스크롤 반영
}

async function runCase(page, c) {
  await goto(page, c.path);   // ★ gotoSPA 는 앱이 이미 부팅된 뒤에만 쓴다 — 첫 이동에 쓰면 /login 에 머문다
  await sleep(900);
  const opened = await c.open(page);
  if (opened === false) return { label: c.label, skipped: '오프너 실패' };
  await sleep(900);

  const handle = await page.$(c.sel);
  if (!handle) return { label: c.label, skipped: `입력 없음 (${c.sel})` };
  await handle.focus();
  await sleep(200);

  const cdp = await page.target().createCDPSession();
  // ★ screenOrientation 금지 · 판정 후 clearDeviceMetricsOverride 금지 (lib/browser 주석 참조)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_VP.width, height: MOBILE_VP.height - KEYBOARD_H, mobile: true, deviceScaleFactor: 2,
  });
  await sleep(800);   // 키보드 애니메이션 + ensureFocusedVisible(320ms)

  const atFocus = await caretProbe(page);
  // ★ 뷰포트 축소(키보드 시뮬)가 리레이아웃을 일으켜 포커스가 풀리는 경우가 있다.
  //   그대로 치면 키가 아무 데도 안 들어가 "아무 일 없이 통과" 한다 — 치기 직전에 다시 잡는다.
  await handle.focus().catch(() => {});
  await sleep(150);
  await typeLines(page, LINES);
  const afterTyping = await caretProbe(page);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_VP.width, height: MOBILE_VP.height, mobile: true, deviceScaleFactor: 2,
  });
  await cdp.detach().catch(() => {});

  if (!afterTyping) return { label: c.label, skipped: '활성 요소 없음' };
  if (afterTyping.innerW !== MOBILE_VP.width) {
    return { label: c.label, fatal: `하니스 환경 오염: innerWidth ${afterTyping.innerW}` };
  }
  if (!afterTyping.editable) return { label: c.label, skipped: '타이핑 후 포커스 이탈' };
  // ★ 입력이 실제로 들어갔는지 먼저 확인한다. 안 들어갔으면 캐럿은 처음 자리 그대로라
  //   **아무 일도 안 일어난 채 ✓ 가 찍힌다**(거짓 PASS). 통과로 세지 않고 커버리지에서 뺀다.
  //   (Q Talk 이 정확히 이 경우였다: bottom 318 → 318, 글자 0 인데 ✓ 였다.)
  if ((afterTyping.len || 0) < 20) {
    return { label: c.label, skipped: `입력이 반영되지 않음 (글자 ${afterTyping.len || 0}) — 검사 못 함` };
  }

  const margin = 8;
  const hidden = afterTyping.bottom > afterTyping.vvh - margin;
  return {
    label: c.label, ok: !hidden, hidden,
    atFocus, after: afterTyping,
    detail: `focus bottom ${atFocus ? atFocus.bottom : '?'} → ${LINES}줄 후 bottom ${afterTyping.bottom} / 가시 ${afterTyping.vvh} · ${afterTyping.kind} · <${afterTyping.tag}${afterTyping.ce ? ' ce' : ''}> 글자 ${afterTyping.len}`,
  };
}

async function run() {
  const { browser, page } = await launch({ mobile: true });
  const results = [];
  try {
    await login(page);
    for (const c of CASES) {
      try { results.push(await runCase(page, c)); }
      catch (e) { results.push({ label: c.label, skipped: '오류: ' + e.message }); }
    }
    try { results.push(await runSafeBottomContract(page)); }
    catch (e) { results.push({ label: '하단 안전영역 토큰 계약', skipped: '오류: ' + e.message }); }
  } finally { await browser.close().catch(() => {}); }

  const tested = results.filter(r => !r.skipped && !r.fatal);
  const bad = tested.filter(r => r.hidden);
  const fatal = results.filter(r => r.fatal);

  console.log(`\n타이핑 중 캐럿 가시성 — 검사 ${tested.length}개 / 건너뜀 ${results.length - tested.length - fatal.length}개 / 환경오염 ${fatal.length}개`);
  for (const r of results) {
    if (r.fatal) { console.log(`  🔥 ${r.label} — ${r.fatal}`); continue; }
    if (r.skipped) { console.log(`  ⃘ ${r.label} — 건너뜀 (${r.skipped})`); continue; }
    console.log(`  ${r.ok ? '✓' : '✗ 캐럿이 키보드 뒤'} ${r.label} — ${r.detail}`);
  }
  // ★ run.js 의 printSuite 는 결과를 **배열로 순회**한다 — 객체를 돌려주면
  //   "results is not iterable" 로 스위트가 통째로 죽어 게이트에 안 붙은 가드가 된다.
  //   route 를 채우면 metric 자리에 detail 이 그대로 찍힌다.
  void bad;
  const rows = results.map((r) => ({
    route: r.label,
    detail: r.skipped ? `건너뜀 — ${r.skipped}` : r.detail,
    fail: r.hidden ? 1 : 0,
    fatal: r.fatal ? 1 : 0,
  }));
  if (!tested.length) {
    console.log('  ⚠ 검사한 입력면이 0개 — 통과가 아니라 검사 실패다.');
    rows.push({ route: '커버리지', detail: '검사한 입력면 0개 — 검사 실패', fail: 1 });
  }
  return rows;
}

// ── 하단 안전영역 계약 ──────────────────────────────────────────────
// 하단 고정 UI 의 여백은 **반드시 `--pq-safe-bottom` 토큰을 따라야** 한다.
// 원시 `env(safe-area-inset-bottom)` 을 쓰면 index.css 의
// `body[data-keyboard-up='1'] { --pq-safe-bottom: 0px }` override 를 통과해 버려,
// 키보드가 홈 인디케이터를 덮은 뒤에도 그만큼 빈 띠가 남는다
// (Irene 2026-08-28 "키보드 올라간 상태에서 넓게 잡혀서 이상한 여백" · 2026-09-01 메일 재발).
// ★ 헤드리스에서 env() 는 **항상 0** 이라 눈으로는 정상으로 보인다 — 그래서 토큰을 주입해
//   "따라 움직이는가" 로 판정한다. 원시 env() 는 토큰을 바꿔도 꿈쩍하지 않는다 = 검출된다.
async function runSafeBottomContract(page) {
  await goto(page, '/mail?folder=all&thread=5755');
  await sleep(1600);
  const opened = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="mail-reply-open"]');
    if (!b) return false; b.click(); return true;
  });
  if (!opened) return { label: '하단 안전영역 토큰 계약 (메일 답장 액션바)', skipped: '답장 버튼 없음' };
  await sleep(1500);
  const read = () => page.evaluate(() => {
    const bars = [...document.querySelectorAll('div')].filter((e) => {
      const cs = getComputedStyle(e);
      return cs.position === 'sticky' && cs.borderTopWidth === '1px' && parseFloat(cs.paddingBottom) > 0;
    });
    const el = bars[bars.length - 1];
    return el ? { pb: parseFloat(getComputedStyle(el).paddingBottom) } : null;
  });
  const base = await read();
  if (!base) return { label: '하단 안전영역 토큰 계약 (메일 답장 액션바)', skipped: '액션바 없음' };
  await page.evaluate(() => document.documentElement.style.setProperty('--pq-safe-bottom', '34px'));
  await sleep(250);
  const injected = await read();
  await page.evaluate(() => document.documentElement.style.removeProperty('--pq-safe-bottom'));
  const follows = injected && base && Math.round(injected.pb - base.pb) === 34;
  return {
    label: '하단 안전영역 토큰 계약 (메일 답장 액션바)',
    ok: follows, hidden: !follows,
    detail: `기본 ${base.pb}px → 토큰 34px 주입 시 ${injected ? injected.pb : '?'}px (기대 ${base.pb + 34}px · 안 따르면 원시 env() 우회)`,
  };
}

module.exports = { name: '타이핑 중 캐럿 가시성', run };

if (require.main === module) {
  run().then((rows) => {
    const bad = rows.reduce((a, r) => a + (r.fail || 0) + (r.fatal || 0), 0);
    console.log('\n' + (bad === 0 ? '✓ PASS' : `✗ FAIL — ${bad}건`));
    process.exit(bad === 0 ? 0 : 1);
  }).catch(e => { console.error('검사기 자체 오류:', e.message); process.exit(2); });
}
