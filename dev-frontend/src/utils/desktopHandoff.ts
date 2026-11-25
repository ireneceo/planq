// 브라우저 → 데스크탑 앱 «PlanQ 링크를 앱에서 열기» 판정 한 곳 (2026-11-25 · Fable 설계 판정 DESIGN-CHANGE 반영).
//   OS 가 https 링크를 데스크탑 앱(Electron)에 넘기지 못한다(맥 서명·Store 전) → 브라우저 웹이 planq://open?url=… 로 넘긴다.
//   ★ 자동으로 쏘지 않는다(미정이면 띠 클릭) — 서버의 desktop_open_links 는 «그 사람에게 받을 수 있는 앱이 어딘가 있다» 일 뿐
//     «이 컴퓨터에 있다» 가 아니다. 브라우저마다 선택(localStorage 3상태): 미정 · app(첫 로드에 자동) · browser(아무것도 안 함).
//   앱 경로(접두어) 목록은 모바일 유니버설 링크·껍데기와 같은 정본(scripts/native-link-paths.js) — 여기 복사본은 guard 가 대조한다.
import { isNativeApp, isDesktopApp } from '../services/native';
import { splitWorkspaceParam, WS_PARAM } from './workspaceLink';

// scripts/native-link-paths.js prefixes 와 같아야 한다(guard-invariants desktophandoff)
export const APP_LINK_PREFIXES = ['/inbox', '/notifications', '/dashboard', '/home', '/talk', '/task', '/projects', '/docs', '/notes', '/calendar', '/mail', '/files', '/info', '/bills', '/sale', '/signatures', '/attendance', '/stats', '/whats-new', '/personal-vault', '/business/', '/settings', '/profile', '/me/', '/admin'];

export type HandoffPref = 'app' | 'browser' | null;
const PREF_KEY = 'pq_desktop_links';
const FIRED_KEY = 'pq_desktop_links_fired';

export function getHandoffPref(): HandoffPref {
  // 브라우저별 선택(Fable 판정 — 사람이 아니라 이 브라우저·이 컴퓨터에 앱이 있는가의 문제)
  try { const v = localStorage.getItem(PREF_KEY); return v === 'app' || v === 'browser' ? v : null; } catch { return null; } // storage-ok: 브라우저별 선택
}
export function setHandoffPref(v: HandoffPref): void {
  try { if (v) localStorage.setItem(PREF_KEY, v); else localStorage.removeItem(PREF_KEY); } catch { /* 저장 못 함 — 이번만 */ } // storage-ok: 브라우저별 선택
}

export function isAppLinkPath(pathname: string): boolean {
  // 팝아웃 창 주소(/task-popout 등)는 접두어에 걸리지만 메인 창 화면이 아니다 — 껍데기 openLink.js 와 같은 규칙
  if (/^\/[^/]*-popout(\/|$)/.test(pathname)) return false;
  return APP_LINK_PREFIXES.some((x) => pathname === x || pathname.startsWith(x));
}

/** 이 탭이 처음 연 주소(새로고침·뒤로가기 아님일 때만). 아니면 null */
function firstNavigateUrl(): URL | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav || nav.type !== 'navigate' || !nav.name) return null;
    const u = new URL(nav.name);
    return u.origin === window.location.origin ? u : null;
  } catch { return null; }
}

function isMobileLike(): boolean {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // 아이패드 데스크탑 모드(맥으로 보임)
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * 띠를 보여도 되는 자리인가 — 받을 앱(서버 표시)은 부르는 쪽이 본다. 여기는 «이 창» 조건만.
 * 브라우저 · 데스크탑 기기 · 새 탭으로 처음 연 앱 화면 · 아직 그 화면 그대로 · 팝업·iframe·설치형 PWA·OAuth 복귀 아님.
 */
export function handoffTarget(): string | null {
  if (isNativeApp() || isDesktopApp() || isMobileLike()) return null;
  try {
    if (window.top !== window.self) return null;
    if (window.opener) return null;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return null;
  } catch { return null; }
  const first = firstNavigateUrl();
  if (!first || !isAppLinkPath(first.pathname)) return null;
  if (first.searchParams.has('code') || first.searchParams.has('state')) return null;
  // 지금도 그 화면인가 — 로그인을 거쳐 돌아왔거나 다른 화면으로 옮겼으면 띠를 내린다(ws 떼기는 같은 화면으로 본다)
  const here = splitWorkspaceParam(window.location.pathname + window.location.search).clean;
  const was = splitWorkspaceParam(first.pathname + first.search).clean;
  if (here !== was) return null;
  return first.href;
}

/** planq://open 주소 — 전체 주소 + 지금 워크스페이스(ws 없을 때) + 사용자 번호(앱이 다른 계정이면 이동하지 않는다) */
export function buildOpenUrl(href: string, userId: string | number, businessId?: number | null): string {
  const u = new URL(href);
  if (!u.searchParams.has(WS_PARAM) && businessId) u.searchParams.set(WS_PARAM, String(businessId));
  return `planq://open?url=${encodeURIComponent(u.href)}&u=${encodeURIComponent(String(userId))}`;
}

/** 넘기기 — 성공 여부는 알 수 없다(브라우저가 알려 주지 않는다). 같은 탭·같은 주소 자동 넘기기는 한 번만 */
export function fireOpen(openUrl: string): void {
  try { window.location.href = openUrl; } catch { /* 막힘 — 띠가 남아 있다 */ }
}
export function autoFiredOnce(href: string): boolean {
  try {
    if (sessionStorage.getItem(FIRED_KEY) === href) return true;
    sessionStorage.setItem(FIRED_KEY, href);
  } catch { /* 저장 못 함 — 한 번만 쏘는 것은 컴포넌트 ref 가 지킨다 */ }
  return false;
}
