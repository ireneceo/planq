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
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  if (mobile) { await page.setViewport(MOBILE_VP); await page.setUserAgent(MOBILE_UA); }
  page.setDefaultTimeout(30000);
  return { browser, page };
}

// 로그인 fetch → refresh 쿠키(HttpOnly) 심음 → 이후 페이지 이동 시 앱이 자동 인증(메모리 토큰 → refresh)
async function login(page, creds = CREDS) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  const ok = await page.evaluate(async (c) => {
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: c.email, password: c.password }) });
      const j = await r.json(); return j && j.success === true;
    } catch { return false; }
  }, creds);
  if (!ok) throw new Error('login failed for ' + creds.email);
}

async function goto(page, pathname) {
  await page.goto(BASE + pathname, { waitUntil: 'networkidle2' });
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
    if (el.isContentEditable) {
      const s = getSelection();
      if (s && s.rangeCount) { const rs = s.getRangeAt(0).getClientRects(); if (rs.length) rect = rs[rs.length - 1]; }
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
  if (r.top < 0) fails.push(`위로 밀림: top ${r.top} < 0`);
  if (r.kbFlag !== '1') fails.push('data-keyboard-up 미설정 (키보드 감지 안 걸림)');
  if (r.hScroll > 1) fails.push(`가로 스크롤 ${r.hScroll}px`);
  if (Math.abs(after - before) > 4) fails.push(`자동 스크롤 드리프트 ${Math.abs(after - before)}px`);
  return { fails, info: r };
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

module.exports = { launch, login, goto, gotoSPA, sleep, assertKeyboardSafe, visibleInputs, waitForInputs, BASE, CREDS, MOBILE_VP };
