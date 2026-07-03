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
