// 앱 OAuth 복귀 주소 처리 — **한 곳**.
//
// 들어오는 문이 둘이다:
//   ① App appUrlOpen — 옛 로그인 창(SFSafariViewController)에서 사용자가 «열기» 를 눌러 planq:// 로 돌아올 때
//   ② iOS 로그인 창(ASWebAuthenticationSession, services/oauth.ts) — OS 가 planq:// 주소를 직접 돌려줄 때
// 둘이 다른 코드를 타면 한쪽만 고쳐진다(로그인 실패 착지·연결 확인·연동 완료가 그랬다). 그래서 여기 하나다.
// (2026-10-16 NativeBridge.tsx 에서 옮겼다. 바뀐 것은 둘 — 연결 확인·code 분기에서 6자리 페어링을 먼저 지운다
//  (앱 안에서 끝나는 흐름이라 코드 입력창이 뜰 까닭이 없다). 나머지는 그대로.)
import { nativePlatform } from './native';
import { clearPair } from './oauth';

/** 이 주소가 OAuth 복귀인지. https 는 같은 출처만 — 경로만 보고 받으면 남의 도메인 링크로도 교환이 트리거된다(로그인 CSRF). */
export function isNativeReturnUrl(u: URL): boolean {
  return (u.pathname === '/oauth/native-return' && u.origin === window.location.origin) ||
    (u.protocol === 'planq:' && `${u.hostname}${u.pathname}`.replace(/\/+$/, '') === 'oauth/native-return');
}

/**
 * OAuth 복귀 주소를 처리한다. 복귀 주소가 아니면 false(부르는 쪽이 딥링크로 계속 처리).
 *   kind=connect → 개인 연동 완료 신호 · error → 로그인 화면이 사유를 말한다 ·
 *   confirm → 앱 안에서 연결 확인 · code → 일회용 code 를 앱 WebView 세션으로 교환(H-2)
 */
export async function handleNativeReturnUrl(u: URL): Promise<boolean> {
  if (!isNativeReturnUrl(u)) return false;
  // #125a — 개인 연동(구글 캘린더·드라이브·Gmail) 복귀. 로그인과 달리 교환할 code 가 없다.
  if (u.searchParams.get('kind') === 'connect') {
    window.dispatchEvent(new CustomEvent('planq:oauth-connected', {
      detail: {
        provider: u.searchParams.get('provider') || null,
        ok: u.searchParams.get('ok') === '1',
        error: u.searchParams.get('error') || null,
      },
    }));
    return true;
  }
  // 로그인 **실패**도 앱으로 돌아온다(서버 failLogin). 페어링을 지우고 로그인 화면이 사유를 말하게 한다.
  const loginError = u.searchParams.get('error');
  if (loginError) {
    clearPair();
    window.location.href = `/login?oauth_error=${encodeURIComponent(loginError)}`;
    return true;
  }
  // 기존 회원의 구글 "연결 확인" — 확인 화면은 앱 WebView 안에서 연다(세션 쿠키가 앱에 심겨야 하므로).
  const confirmToken = u.searchParams.get('confirm');
  if (confirmToken) {
    clearPair();
    window.location.href = `/oauth/connect-confirm?token=${encodeURIComponent(confirmToken)}`;
    return true;
  }
  const code = u.searchParams.get('code');
  if (code) {
    // 코드로 돌아왔으면 6자리 페어링은 쓸 일이 없다 — 교환 **전에** 지운다. 창이 닫히는 순간
    //   PairCodePrompt 가 남은 페어링을 보고 코드 입력을 띄우던 것(교환과 경합)을 막는다.
    clearPair();
    try {
      const r = await fetch('/api/auth/google/native-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, client_kind: nativePlatform() }),
      });
      if (r.ok) { window.location.href = '/inbox'; return true; }
    } catch { /* 아래 실패 착지 */ }
    window.location.href = '/login?oauth_error=native_exchange';
  }
  return true;
}
