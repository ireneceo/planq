// 네이티브(Capacitor) 런타임 분기 단일 진입점.
// 원칙(MOBILE_APP_DESIGN §3.2): 컴포넌트/서비스에서 `Capacitor.` 를 직접 호출하지 말고
// 반드시 이 헬퍼를 경유한다. 웹 회귀 0 — 모든 분기는 isNativeApp() 이 true 인 쪽이 새 길.
// @capacitor/core 는 웹 번들에 포함돼도 무해(native 아니면 no-op).
import { Capacitor } from '@capacitor/core';

/** iOS/Android 네이티브 앱(WebView) 안에서 실행 중인가. 웹/PWA/데스크탑이면 false. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** 현재 플랫폼. 네이티브면 'ios'|'android', 웹이면 'web'. */
export const nativePlatform = (): 'ios' | 'android' | 'web' =>
  Capacitor.getPlatform() as 'ios' | 'android' | 'web';

/**
 * 외부 URL(결제·외부 사이트)로 나가기 — 네이티브/웹 분기.
 *  - 웹: 현재 탭에서 리다이렉트(`window.location.href`). 돌아올 때 success_url 이 SPA 를 재마운트해 상태 갱신.
 *  - 네이티브: 인앱 브라우저(`@capacitor/browser`)로 연다. WebView 를 외부 사이트로 덮으면 앱 셸이 사라지고
 *    Stripe 3DS·Apple/Google Pay 도 동작하지 않으므로 반드시 인앱 브라우저 사용(OAuth 와 동일 패턴).
 *    브라우저가 닫히면(결제 완료/취소) 앱을 새로고침해 서버 상태(webhook 착지분)를 반영.
 * Stripe Hosted Checkout 리다이렉트 등 "나갔다 돌아오는" 흐름에 사용.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    const { Browser } = await import('@capacitor/browser');
    const sub = await Browser.addListener('browserFinished', () => {
      sub.remove();
      window.location.reload();
    });
    await Browser.open({ url });
  } else {
    window.location.href = url;
  }
}

/**
 * 클라이언트 종류 — 백엔드가 refresh_token TTL 을 정하는 데 쓴다
 * (pwa/ios/android = 365일 · web = 30일 sliding).
 *
 * ★ 단일 원천이다. 2026-09-04 이전에는 `contexts/AuthContext.tsx` 안에만 있었고,
 *   구글 "연결 확인"(`OauthConnectConfirmPage`)은 이 값을 **아예 안 보냈다.**
 *   그래서 앱에서 그 경로로 만든 세션만 `web`(30일)로 잡혀, 다른 로그인 경로(365일)와
 *   달랐다. 판정을 복사하면 반드시 갈라진다 — 세션을 만드는 곳은 전부 여기를 부른다.
 */
export const detectClientKind = (): 'pwa' | 'web' | 'ios' | 'android' => {
  if (typeof window === 'undefined') return 'web';
  try {
    // 네이티브 우선 — WebView 안에서도 display-mode 가 standalone 일 수 있다.
    if (isNativeApp()) {
      const p = nativePlatform();
      if (p === 'ios' || p === 'android') return p;
    }
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return standalone ? 'pwa' : 'web';
  } catch {
    return 'web';
  }
};

/**
 * OS 의 **이 앱 알림 설정**을 연다.
 *
 * ★ 2026-09-07 (Irene: "다른 직원이 아이폰에서 앱을 새로 깔았는데 알림소리가 안온대.
 *   알림설정으로 유도하는 거 봤어?") — 권한이 거부(denied)되면 앱은 다시 물어볼 수 없다.
 *   iOS 는 한 번 거부하면 `requestPermissions()` 가 **아무 창도 안 띄우고 그대로 denied 를 준다.**
 *   그때 화면이 "기기 설정에서 허용해주세요" 라고 글로만 말하면, 사용자는 설정 앱을 뒤져야 한다.
 *   문을 만든다.
 *
 * ★ 소리는 권한과 **다른 스위치**다 — 알림이 허용돼도 iOS 설정에서 '사운드' 가 꺼져 있으면
 *   배너만 뜨고 소리가 없다. JS 로는 그 상태를 읽을 수 없으므로, 같은 문으로 보내 눈으로 확인하게 한다.
 *   (memory feedback_ios_push_presentation_device_state)
 *
 * @returns 열었으면 true. 웹이거나 플러그인이 못 열면 false — **부르는 쪽이 폴백 문구를 띄운다.**
 */
export async function openAppNotificationSettings(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    // iOS: 'app-settings:' 가 이 앱의 설정 화면으로 간다.
    // Android: 앱 상세 설정으로 가는 스킴이 없어 push 플러그인이 제공하는 창을 쓴다.
    if (nativePlatform() === 'ios') {
      // ★ `@capacitor/app` 7.x 에는 openUrl 이 없다(빌드 에러로 확인). 새 플러그인을 넣지 않고,
      //   WKWebView 가 **모르는 스킴을 OS 로 넘기는** 성질을 쓴다 — `app-settings:` 는
      //   iOS 가 이 앱의 설정 화면으로 해석한다. 실패해도 화면은 그대로다(문구 폴백).
      window.location.href = 'app-settings:';
      return true;
    }
    // Android 는 앱 설정으로 가는 표준 URL 스킴이 없다. 전용 플러그인이 필요한데
    // 이 프로젝트에는 설치돼 있지 않으므로 **여는 척하지 않는다** — false 를 주고
    // 부르는 쪽이 경로를 글로 안내한다(눌러도 아무 일 없는 버튼을 만들지 않는다).
    return false;
  } catch {
    return false;
  }
}
