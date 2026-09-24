// scripts/e2e/lib/browser.js — 하니스 공용: 브라우저 기동 · 로그인 · 모바일 키보드 판정
//   puppeteer 는 dev-backend/node_modules 에 설치됨. 결정론적 exit-code 검사(health-check 계열).
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const CREDS = {
  email: process.env.E2E_EMAIL || 'health-check@planq.kr',
  password: process.env.E2E_PASSWORD || 'HealthCheck2026!',
};
const MOBILE_VP = { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const KEYBOARD_H = 330; // iOS 실측 근사 (main.tsx: 793→417)

async function launch({ mobile = false } = {}) {
  // ★ `protocolTimeout` — 파일이 수천 건인 화면에서 evaluate 가 기본 180s 를 넘겨
  //   `Runtime.callFunctionOn timed out` 으로 죽었다(2026-09-24). 판정이 아니라 하니스가 죽는 것이라
  //   원인을 찾기 어렵다. 넉넉히 준다.
  const browser = await puppeteer.launch({
    headless: 'new', protocolTimeout: 300000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  if (mobile) { await page.setViewport(MOBILE_VP); await page.setUserAgent(MOBILE_UA); }
  page.setDefaultTimeout(30000);
  return { browser, page };
}

// 로그인 fetch → refresh 쿠키(HttpOnly) 심음 → 이후 페이지 이동 시 앱이 자동 인증(메모리 토큰 → refresh)
async function login(page, creds = CREDS) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  // ★ 토큰을 **응답에서 받아 둔다.** access token 은 프론트가 메모리(AuthContext)에만 두므로
  //   localStorage 에도 쿠키에도 없다 — 날 fetch 는 Authorization 헤더 없이는 401 이다.
  //   (처음엔 쿠키만 믿고 아래 약관 동의를 붙였다가 **아무 일도 안 하는 코드**가 됐다.
  //    try/catch 가 그 401 을 삼켜 조용했다 — memory feedback_unwired_guard_is_no_guard.)
  const res = await page.evaluate(async (c) => {
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: c.email, password: c.password }) });
      const j = await r.json();
      return { ok: j && j.success === true, token: (j && j.data && j.data.token) || null };
    } catch { return { ok: false, token: null }; }
  }, creds);
  if (!res || !res.ok) throw new Error('login failed for ' + creds.email);

  // ★ 약관 재동의를 **API 로 먼저 통과시킨다** (2026-09-14).
  //   약관을 개정해 platform_settings.terms_version 을 올리면 이 계정의 버전이 뒤처져
  //   앱 화면마다 재동의 모달이 전면에 뜬다 — 그 모달은 `aria-modal="true"` 라 "모달이 떴는가"
  //   판정을 위조하고, 모든 클릭을 가로챈다. `dismissBlockers` 도 치우지만 그건 **부르는
  //   카나리만** 면역이다. 여기서 치우면 전부 면역이다.
  //   (계정마다 손으로 버전을 맞추는 것은 답이 아니다 — 개정할 때마다 잊는다.)
  const consent = await page.evaluate(async (token) => {
    if (!token) return 'no-token';
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include', headers: H });
      if (!r.ok) return 'me-' + r.status;
      const u = (await r.json()).data;
      if (!u || !u.platform) return 'no-platform';
      const tv = u.platform.current_terms_version;
      const pv = u.platform.current_privacy_version;
      const patch = {};
      if (tv && tv !== u.terms_version) { patch.terms_version = tv; patch.terms_accepted_at = new Date().toISOString(); }
      if (pv && pv !== u.privacy_version) { patch.privacy_version = pv; patch.privacy_accepted_at = new Date().toISOString(); }
      if (!Object.keys(patch).length) return 'already';
      const w = await fetch(`/api/users/${u.id}`, { method: 'PUT', credentials: 'include', headers: H, body: JSON.stringify(patch) });
      return w.ok ? 'accepted' : 'put-' + w.status;
    } catch (e) { return 'err-' + (e && e.message); }
  }, res.token);
  // ★ **조용히 실패하지 않는다.** 이 단계가 죽으면 재동의 모달이 모든 카나리의 클릭을 가로채는데
  //   증상은 "버튼을 눌렀는데 아무 일이 없다" 로 나타나 원인을 한참 못 찾는다. 그래서 값을 남긴다.
  //   ('already' = 맞출 것이 없었다 · 'accepted' = 실제로 동의시켰다 — 둘 다 정상.)
  if (!['already', 'accepted'].includes(consent)) {
    console.warn(`  [harness] 약관 자동 동의 실패: ${consent} — 재동의 모달이 판정을 가릴 수 있다`);
  }
}

// ★ networkidle2 만 믿으면 **멀쩡한 화면에서 거짓 실패**가 난다.
//   /files 는 socket.io + 썸네일이 계속 붙어 네트워크가 조용해지지 않아 30초를 넘긴다
//   (실측: 하니스는 timeout ❌ · 같은 페이지를 직접 재면 DOM 135ms · 3초에 103,854자 정상).
//   그래서 idle 은 **기다려 보되 못 기다려도 계속 간다**. 대신 DOM 준비 + 내용이 붙을 때까지는
//   반드시 기다린다 — 진짜 빈 화면은 여기서 안 걸러지고 각 카나리의 내용 검사에 그대로 잡힌다.
async function goto(page, pathname) {
  try {
    await page.goto(BASE + pathname, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch {
    await page.goto(BASE + pathname, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  // 내용이 붙을 때까지 최대 8초 — 붙지 않으면 그대로 넘겨 카나리가 '빈 화면' 으로 판정하게 둔다.
  for (let i = 0; i < 16; i++) {
    const n = await page.evaluate(() => (document.body && document.body.innerText || '').length).catch(() => 0);
    if (n > 200) break;
    await sleep(500);
  }
  await sleep(500);
}

// SPA 클라이언트 네비게이션 — 앱 리부트 없이 이동 (전 화면 크롤 시 goto 반복 리부트→refresh rotation 레이스/
//   rate-limit 회피). 최초 1회 full goto 로 앱 부팅·인증 후, 이후엔 이 함수로 이동. React Router(history) 가
//   popstate 를 듣고 라우트 갱신. sessionStorage 플래그로 라우터 종류 무관 최대 호환.
async function gotoSPA(page, pathname) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pathname);
  await sleep(1100);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 검사를 가리는 **전면 알림**을 치운다. 2026-09-12 실측 —
 * 출근 자동기록 알림(`StandardModal`)이 떠 있어 토글·버튼 클릭이 **백드롭에 먹혔고**,
 * 판정은 "저장이 안 갔다"(=제품 고장과 같은 말)라고 보고했다. 확인 여부는 localStorage 에
 * 박제되므로 **새 브라우저마다 다시 뜬다** — 하니스는 항상 새 브라우저다.
 *
 * ★ `goto()` 안에서 자동으로 부르지 않는다 — `canary-modal-top` 은 **이 알림 자체**가 검사 대상이다.
 *   무엇을 치울지는 부르는 쪽이 고른다.
 */
async function dismissBlockers(page) {
  const cleared = [];

  // ★ 약관 재동의 모달 (2026-09-14 추가) — **가장 먼저 치운다.**
  //   약관을 개정해 platform_settings.terms_version 을 올리는 순간 이 모달이 전면에 떠
  //   모든 카나리의 클릭을 가로챈다. 그리고 `aria-modal="true"` 라 "모달이 떴는가" 판정을
  //   **위조**한다 — 2026-09-10 admintabs 에서 하마터면 초록으로 넘어갈 뻔했다
  //   (memory feedback_consent_modal_fakes_modal_open · feedback_overlay_eats_click_false_reason).
  //   계정마다 버전을 손으로 맞추는 것은 답이 아니다(개정마다 잊는다) — 하니스가 사용자처럼 동의한다.
  if (await page.$('[data-testid="terms-reaccept"]')) {
    for (const id of ['terms-reaccept-terms', 'terms-reaccept-privacy']) {
      const box = await page.$(`[data-testid="${id}"]`);
      if (box) { await box.click().catch(() => null); await sleep(120); }
    }
    const submit = await page.$('[data-testid="terms-reaccept-submit"]');
    if (submit) {
      await submit.click().catch(() => null);
      cleared.push('약관 재동의');
      // 사라질 때까지 기다린다 — 안 사라지면 뒤 판정이 전부 이 모달을 보고 있다
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="terms-reaccept"]'),
        { timeout: 6000 },
      ).catch(() => null);
    }
  }

  for (let i = 0; i < 3; i++) {
    const btn = await page.$('[data-testid="attn-auto-ok"]');
    if (!btn) break;
    await btn.click().catch(() => null);
    cleared.push('출근 자동기록 알림');
    await sleep(700);
  }
  return cleared;
}

// ── 모바일 키보드 가림 판정 ──
//   focus 후 CDP 로 뷰포트 height 를 KEYBOARD_H 만큼 줄여 iOS 키보드 이벤트 체인 발화
//   (visualViewport resize → main.tsx update() → data-keyboard-up → ensureFocusedVisible).
//   판정: 캐럿/요소 bottom ≤ vvh−8 · 가로스크롤 0 · 자동점프 <4px · 렌더됨.
async function assertKeyboardSafe(page, elHandle) {
  await elHandle.focus();
  await sleep(150);
  const before = await scrollTopOf(page);
  const cdp = await page.target().createCDPSession();
  // ★ screenOrientation 넣지 말 것 — 앱 orientationchange 핸들러가 fullH 를 축소값으로 리셋해
  //   키보드 판정(isUp = vv.height < fullH*0.70)이 깨진다 (main.tsx:69). height 만 줄여 키보드 시뮬.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_VP.width, height: MOBILE_VP.height - KEYBOARD_H, mobile: true, deviceScaleFactor: 2,
  });
  await sleep(750); // main.tsx ensureFocusedVisible 320ms + 여유
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    let rect = el.getBoundingClientRect();
    let caretUsed = false;
    if (el.isContentEditable) {
      // ★ 본문 에디터는 **보이는 영역보다 크다**(실측 2026-09-14 메일 작성: h 374 > vvh 337).
      //   그러면 요소 rect 로 재는 순간 top<0 은 **필연**이라 언제나 빨간불이 된다 —
      //   사용자가 실제로 해를 입는지는 **캐럿이 보이는가**로만 갈린다(타이핑 14줄 동안 246/337 로 계속 보였다).
      //   이 코드는 원래도 캐럿으로 재려 했는데, 하니스가 focus() 만 하고 선택을 만들지 않아
      //   **언제나 요소 rect 로 떨어졌다.** 캐럿을 세워서 의도대로 잰다.
      const s = getSelection();
      let rs = (s && s.rangeCount) ? s.getRangeAt(0).getClientRects() : null;
      if (!rs || !rs.length) {
        try {
          const rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false);
          s.removeAllRanges(); s.addRange(rg);
          rs = rg.getClientRects();
          if (!rs.length) {
            // 빈 에디터 — 폭 0 인 범위는 rect 가 없다. 제로폭 글자를 잠깐 넣어 자리를 얻는다.
            const sp = document.createElement('span'); sp.textContent = '\u200b';
            rg.insertNode(sp); const br = sp.getBoundingClientRect(); sp.remove();
            if (br.height) { rect = br; caretUsed = true; }
          }
        } catch (e) { /* 못 세우면 아래 요소 rect 로 */ }
      }
      if (rs && rs.length) { rect = rs[rs.length - 1]; caretUsed = true; }
    }
    const scroller = document.querySelector('main, [data-scroll-root]') || document.scrollingElement;
    return {
      bottom: Math.round(rect.bottom), top: Math.round(rect.top), height: Math.round(rect.height),
      vvh: Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight),
      innerW: window.innerWidth,
      kbFlag: document.body.getAttribute('data-keyboard-up'),
      hScroll: document.documentElement.scrollWidth - window.innerWidth,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : 0,
      tag: el.tagName,
      caretUsed,
      elHeight: Math.round(el.getBoundingClientRect().height),
    };
  });
  await sleep(600);
  const after = await scrollTopOf(page);
  // ★ 판정 종료 후 복원: clearDeviceMetricsOverride 를 쓰면 안 된다.
  //   clear 는 puppeteer 의 setViewport(375×667) 오버라이드까지 제거 → 브라우저 원시 창(실측 780×493, mq=false
  //   데스크탑 환경)으로 되돌아간다. 그러면 "페이지당 첫 입력만 모바일 환경에서 판정"되고 두 번째 입력부터는
  //   focus 시점 innerWidth=780 → main.tsx 의 (max-width:768px) 가드가 걸려 ensureFocusedVisible 이 즉시 return
  //   → 가림 오탐(settings·calendar 3입력 FAIL 의 정체). 반드시 모바일 뷰포트로 재-override 후 세션 detach.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE_VP.width, height: MOBILE_VP.height, mobile: true, deviceScaleFactor: 2,
  });
  await cdp.detach().catch(() => {});
  const fails = [];
  if (!r) return { fails: ['no active element'], info: null };
  // ★ 자가 진단: 판정 시점 innerWidth 는 반드시 375(모바일). 아니면 위 오염이 재발한 것 —
  //   가림 FAIL(앱 탓)이 아니라 하니스 환경 오염(FATAL)으로 구분해 오탐을 실버그로 착각하지 않게 한다.
  if (r.innerW !== MOBILE_VP.width) return { fails: [], info: r, fatal: `하니스 환경 오염: 판정 innerWidth ${r.innerW} ≠ ${MOBILE_VP.width} (뷰포트 복원 실패)` };
  if (r.height <= 0) fails.push('요소 렌더 안됨(rect height 0)');
  if (r.bottom > r.vvh - 8) fails.push(`가림: 요소 bottom ${r.bottom} > 뷰포트 ${r.vvh}-8`);
  // top<0 — **요소가 보이는 영역보다 크면 필연**이므로 그 자체로는 판정하지 않는다.
  //   그때는 위에서 잡은 캐럿 자리로 판정한다(캐럿을 못 잡았으면 판정 불가 = 실패로 남긴다 —
  //   조용히 넘기면 "0건이라 통과" 가 된다).
  if (r.top < 0) {
    if (r.elHeight <= r.vvh) fails.push(`위로 밀림: top ${r.top} < 0`);
    else if (!r.caretUsed) fails.push(`판정 불가: 요소가 뷰포트보다 큰데(h ${r.elHeight} > ${r.vvh}) 캐럿을 못 잡았다`);
    else fails.push(`캐럿이 위로 밀림: top ${r.top} < 0`);
  }
  if (r.kbFlag !== '1') fails.push('data-keyboard-up 미설정 (키보드 감지 안 걸림)');
  if (r.hScroll > 1) fails.push(`가로 스크롤 ${r.hScroll}px`);
  if (Math.abs(after - before) > 4) fails.push(`자동 스크롤 드리프트 ${Math.abs(after - before)}px`);
  return { fails, info: r };
}

// ── 흰 화면(blank 렌더) 판정 ──
//   #173/174/159/178(모바일 Q Mail 전체 흰 화면) 계열 회귀 차단. 키보드 스위트는 "입력 가림"만 봐서
//   페이지가 통째로 안 그려져도(입력 0개) ⚪(정상)로 통과했다 — blank 화면이 새어나간 구멍.
//   뷰포트 중앙/좌·우 세로선을 elementFromPoint 로 샘플링해 "실제 콘텐츠 픽셀(텍스트/미디어)"이 그려졌는지 센다.
//   컨테이너(html/body/#root)만 잡히면 = 배경만 그려진 흰 화면. 정상 페이지는 수십 painted, blank 는 0~1.
async function assertRendered(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const CONTAINER = ['HTML', 'BODY'];
    const MEDIA = ['SVG', 'IMG', 'PATH', 'INPUT', 'BUTTON', 'CANVAS', 'TEXTAREA', 'SELECT'];
    let painted = 0, samples = 0;
    for (let y = 70; y < vh - 16; y += 22) {
      for (const fx of [0.5, 0.28, 0.72]) {
        samples++;
        const el = document.elementFromPoint(Math.round(vw * fx), y);
        if (!el) continue;
        const isContainer = CONTAINER.includes(el.tagName) || el.id === 'root';
        if (isContainer) continue;
        const hasText = (el.textContent || '').trim().length > 0;
        if (hasText || MEDIA.includes(el.tagName)) painted++;
      }
    }
    return { painted, samples, vw, vh };
  });
}

// 입력요소가 실제 렌더될 때까지 대기 (SPA 지연 렌더 플레이크 방지). 없어도 조용히 통과(입력 없는 화면 정상).
async function waitForInputs(page, timeout = 3000) {
  try {
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), textarea, [contenteditable="true"]');
      for (const el of els) { const r = el.getBoundingClientRect(); if (r.height > 10 && r.width > 10 && el.offsetParent !== null) return true; }
      return false;
    }, { timeout });
  } catch { /* 입력 없는 화면(목록 등) — 정상 */ }
}

async function scrollTopOf(page) {
  return page.evaluate(() => {
    const s = document.querySelector('main, [data-scroll-root]') || document.scrollingElement;
    return s ? Math.round(s.scrollTop) : 0;
  });
}

// 현재 화면의 "실제로 보이는" 입력만. ★ 진짜 모달/드로어(aria-modal="true")가 열려 있으면 그 안 입력만
//   반환 (배경 페이지 입력 제외) — 모달 테스트 시 배경 노이즈 차단.
//   ★ role="dialog" 는 스코핑 기준에서 제외: InstallPromptBanner 같은 비모달 배너가 role="dialog" 를 달면
//     "모달 열림"으로 오판해 배경 페이지 입력 0개 반환(settings 0-input 플레이크의 정체). aria-modal 만 신뢰.
async function visibleInputs(page) {
  const handles = await page.$$('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), textarea, [contenteditable="true"]');
  const hasDialog = !!(await page.$('[aria-modal="true"]'));
  const out = [];
  for (const h of handles) {
    const ok = await h.evaluate((el, hasDialog) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const visible = r.height > 10 && r.width > 10 && el.offsetParent !== null && s.visibility !== 'hidden' && s.opacity !== '0';
      if (!visible) return false;
      if (hasDialog) return !!el.closest('[aria-modal="true"]'); // 모달 열렸으면 모달 안만
      return true;
    }, hasDialog);
    if (ok) out.push(h); else await h.dispose();
  }
  return out;
}

module.exports = { dismissBlockers, launch, login, goto, gotoSPA, sleep, assertKeyboardSafe, assertRendered, visibleInputs, waitForInputs, BASE, CREDS, MOBILE_VP };
