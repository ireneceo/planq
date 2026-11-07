// 네이티브(Capacitor) 런타임 분기 단일 진입점.
// 원칙(MOBILE_APP_DESIGN §3.2): 컴포넌트/서비스에서 `Capacitor.` 를 직접 호출하지 말고
// 반드시 이 헬퍼를 경유한다. 웹 회귀 0 — 모든 분기는 isNativeApp() 이 true 인 쪽이 새 길.
// @capacitor/core 는 웹 번들에 포함돼도 무해(native 아니면 no-op).
import { Capacitor } from '@capacitor/core';

/** iOS/Android 네이티브 앱(WebView) 안에서 실행 중인가. 웹/PWA/데스크탑이면 false. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * 데스크탑 앱(Electron, `desktop/preload.js`)이 창에 붙여 주는 다리 — 이 목록이 **전부**다
 * (docs/DESKTOP_APP_DESIGN.md §5 «preload 표면»). 여기 없는 것을 부르지 않는다.
 */
export interface PlanqDesktopBridge {
  version: string;
  platform: 'win32' | 'darwin' | 'linux';
  /** 이 창(부른 창 자신)을 «항상 위» 로 / 풀기 */
  setAlwaysOnTop: (on: boolean) => Promise<boolean>;
  /** OS 알림 — 메인 창만 부른다(팝아웃도 같은 소켓 이벤트를 받는다). 같은 id 는 main 이 60초 동안 한 번만 */
  notify: (n: { id: string; title: string; body?: string; link?: string | null; urgent?: boolean; tag?: string }) => Promise<boolean>;
  /** 작업 표시줄·독 숫자(0 이면 지움) */
  setBadge: (n: number) => Promise<boolean>;
  /** 시스템 브라우저로 열기(http/https 만) */
  openExternal: (url: string) => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (on: boolean) => Promise<boolean>;
  /** OS 알림을 눌렀을 때 — link 를 받는다. 해제 함수를 돌려준다 */
  onNotificationClick: (cb: (link: string | null) => void) => () => void;
  /** planq://oauth/native-return?… 로 앱이 깨어났을 때 — 전체 URL 을 받는다 */
  onDeepLink: (cb: (url: string) => void) => () => void;
}

/** 데스크탑 앱 다리. 웹·PWA·폰 앱이면 null. */
export const desktopBridge = (): PlanqDesktopBridge | null => {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { planqDesktop?: PlanqDesktopBridge }).planqDesktop;
  return b && typeof b.setAlwaysOnTop === 'function' ? b : null;
};

/**
 * 데스크탑 앱(윈도우·맥) 안에서 실행 중인가 — 판정은 UA 가 아니라 **다리가 있는가** 하나다.
 * ★ `isNativeApp()` 과 다르다 — 그쪽은 Capacitor 플러그인을 부르는 길(29파일)이라 데스크탑을 섞으면 죽는다.
 *   데스크탑이 달라야 하는 자리는 이 함수로 **따로** 가른다(설계 §3-2).
 */
export const isDesktopApp = (): boolean => desktopBridge() !== null;

/**
 * 외부 로그인·연동(구글·애플)을 **시스템 브라우저 + 앱 복귀**(client=native · 짝 맞추기 · planq://)로 하는 앱인가.
 *   폰 앱과 데스크탑 앱 둘 다 — 구글은 앱 안 창에서 로그인을 막는다. 이 판정만 두 앱을 같이 다룬다(설계 §3-7).
 */
export const usesSystemBrowserAuth = (): boolean => isNativeApp() || isDesktopApp();

/**
 * 시스템 브라우저로 열기 — 폰 앱은 Capacitor 인앱 브라우저, 데스크탑 앱은 OS 기본 브라우저.
 * 로그인(구글·애플)처럼 앱 창 안에서 열면 안 되는 주소에만 쓴다. 웹이면 false(부르는 쪽이 종전대로).
 */
export async function openSystemBrowser(url: string): Promise<boolean> {
  const d = desktopBridge();
  if (d) { await d.openExternal(url); return true; }
  if (isNativeApp()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return true;
  }
  return false;
}

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
  } else if (isDesktopApp()) {
    // 데스크탑 앱: 창 안은 planq.kr 만 열린다(탐색 잠금). 결제는 OS 브라우저에서 하고,
    //   돌아와 창을 누르면 useVisibilityRefresh 가 서버 상태를 다시 읽는다.
    await desktopBridge()!.openExternal(url);
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
export const detectClientKind = (): 'pwa' | 'web' | 'ios' | 'android' | 'desktop' => {
  if (typeof window === 'undefined') return 'web';
  try {
    // 데스크탑 앱 — 365일(서버 authTokens LONG_KINDS). PWA 와 갈라 센다(설계 §3-2).
    if (isDesktopApp()) return 'desktop';
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
  // 데스크탑 앱 — OS 알림 설정 화면(맥 시스템 설정 › 알림 · 윈도우 설정 › 알림)
  const d = desktopBridge();
  if (d) {
    if (d.platform === 'darwin') return d.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
    if (d.platform === 'win32') return d.openExternal('ms-settings:notifications');
    return false;
  }
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
