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
  await sleep(400);
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
      kbFlag: document.body.getAttribute('data-keyboard-up'),
      hScroll: document.documentElement.scrollWidth - window.innerWidth,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : 0,
      tag: el.tagName,
    };
  });
  await sleep(600);
  const after = await scrollTopOf(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const fails = [];
  if (!r) return { fails: ['no active element'], info: null };
  if (r.height <= 0) fails.push('요소 렌더 안됨(rect height 0)');
  if (r.bottom > r.vvh - 8) fails.push(`가림: 요소 bottom ${r.bottom} > 뷰포트 ${r.vvh}-8`);
  if (r.top < 0) fails.push(`위로 밀림: top ${r.top} < 0`);
  if (r.kbFlag !== '1') fails.push('data-keyboard-up 미설정 (키보드 감지 안 걸림)');
  if (r.hScroll > 1) fails.push(`가로 스크롤 ${r.hScroll}px`);
  if (Math.abs(after - before) > 4) fails.push(`자동 스크롤 드리프트 ${Math.abs(after - before)}px`);
  return { fails, info: r };
}

async function scrollTopOf(page) {
  return page.evaluate(() => {
    const s = document.querySelector('main, [data-scroll-root]') || document.scrollingElement;
    return s ? Math.round(s.scrollTop) : 0;
  });
}

// 현재 화면의 "실제로 보이는" 입력 요소만 (숨은 헬퍼 입력·0-height 오탐 제거)
async function visibleInputs(page) {
  const handles = await page.$$('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), textarea, [contenteditable="true"]');
  const out = [];
  for (const h of handles) {
    const vis = await h.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.height > 10 && r.width > 10 && el.offsetParent !== null && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    if (vis) out.push(h); else await h.dispose();
  }
  return out;
}

module.exports = { launch, login, goto, sleep, assertKeyboardSafe, visibleInputs, BASE, CREDS, MOBILE_VP };
