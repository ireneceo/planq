// 외부 OAuth 시작 — 웹/네이티브 분기 (MOBILE_APP_DESIGN §6.8 ★최우선 함정).
//
// Google OAuth 는 WebView 안(Capacitor WebView) 에서 열면 `disallowed_useragent` 로 차단된다.
// 따라서 네이티브 앱에서는 시스템 브라우저(iOS SFSafariViewController / Android Custom Tab)로 연다.
// 콜백은 Universal Link/App Link 로 앱에 복귀 → App.tsx 의 appUrlOpen 브리지가 Browser 를 닫고
// `planq:oauth-connected`(연동) / `planq:navigate`(딥링크) 이벤트를 발행한다.
//
// 웹(브라우저/PWA)에서는 기존 동작 그대로 — redirect 는 location.href, popup 은 window.open.
// 웹 회귀 0: 모든 분기는 isNativeApp() 이 true 인 쪽이 새 길.
import { isNativeApp } from './native';

function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

async function openNativeBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: toAbsolute(url), presentationStyle: 'popover' });
}

/** 전체 페이지 redirect 형 OAuth 시작 (로그인·Gmail 등). 네이티브는 시스템 브라우저. */
export async function startAuthRedirect(url: string): Promise<void> {
  if (isNativeApp()) { await openNativeBrowser(url); return; }
  window.location.href = url;
}

/**
 * popup 형 OAuth 시작 (워크스페이스 Drive·개인 연동 등).
 * 웹: window.open 팝업 반환(호출측이 closed 폴링 / postMessage 수신).
 * 네이티브: 시스템 브라우저로 열고 null 반환 — 호출측은 isNativeApp() 이면 `planq:oauth-connected`
 *          이벤트로 완료를 감지해야 한다(팝업 참조/postMessage 없음).
 */
export async function startAuthPopup(
  url: string,
  name = 'planq-oauth',
  features = 'width=520,height=660',
): Promise<Window | null> {
  if (isNativeApp()) { await openNativeBrowser(url); return null; }
  return window.open(url, name, features);
}
