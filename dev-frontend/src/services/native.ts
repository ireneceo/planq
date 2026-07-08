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
