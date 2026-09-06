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
// ─── 앱 세션 페어링 ────────────────────────────────────────────────────────
// 딥링크(planq:// · App Link)가 앱을 열지 못하는 기기에서의 정본 경로.
//   Irene 2026-09-06: "앱에서 로그인해도 돌아가지 않아."
// 흐름: ①앱이 pair_id 를 받고 ②그것을 붙여 브라우저를 연다 ③로그인이 끝나면 **브라우저 화면에**
//       6자리 코드가 뜨고 ④사용자가 앱에 입력하면 앱이 세션을 받아간다.
//   ★ 비밀(코드)은 개시 링크로 들어가지 않는다 — 첫 설계가 그렇게 했다가 계정 탈취가 됐다
//     (dev-backend/services/oauthPairing.js 머리말).
const PAIR_KEY = 'planq.oauth.pair';

/** 앱이 코드 입력을 띄워야 하는지 — 진행 중인 페어링이 있으면 그 id. */
export function pendingPairId(): string | null {
  try { return localStorage.getItem(PAIR_KEY); } catch { return null; }
}
export function clearPair(): void {
  try { localStorage.removeItem(PAIR_KEY); } catch { /* private mode */ }
}

/** 사용자가 입력한 6자리로 세션을 받아온다. */
export async function claimWithCode(code: string): Promise<{ ok: boolean; reason?: string }> {
  const pairId = pendingPairId();
  if (!pairId) return { ok: false, reason: 'no_pair' };
  const { apiFetch } = await import('../contexts/AuthContext');
  const { detectClientKind } = await import('./native');
  const r = await apiFetch('/api/auth/google/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair_id: pairId, code: String(code).replace(/\D/g, ''), client_kind: detectClientKind() }),
  });
  if (r.ok) { clearPair(); return { ok: true }; }
  let reason = 'failed';
  try { reason = (await r.json())?.message || reason; } catch { /* 본문 없음 */ }
  // 되돌릴 수 없는 실패는 흐름을 정리한다 — 계속 물어보면 사용자가 갇힌다.
  if (reason === 'too_many_attempts' || reason === 'expired_or_unknown') clearPair();
  return { ok: false, reason };
}

export async function startAuthRedirect(url: string): Promise<void> {
  if (isNativeApp()) {
    // 딥링크가 실패해도 코드로 이어갈 수 있게 흐름을 먼저 연다. 실패하면 딥링크만으로 진행.
    let withPair = url;
    try {
      const { apiFetch } = await import('../contexts/AuthContext');
      const r = await apiFetch('/api/auth/google/pair/start', { method: 'POST' });
      const j = await r.json();
      const pairId = j?.data?.pair_id;
      if (pairId) {
        localStorage.setItem(PAIR_KEY, pairId);
        withPair += (url.includes('?') ? '&' : '?') + 'pair=' + encodeURIComponent(pairId);
      }
    } catch { /* 페어링 없이 딥링크만으로 진행 */ }
    await openNativeBrowser(withPair);
    return;
  }
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
