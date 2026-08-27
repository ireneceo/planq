import type { CapacitorConfig } from '@capacitor/cli';

// Remote URL 방식 (MOBILE_APP_DESIGN §3.1): WebView 가 planq.kr / dev.planq.kr 를 직접 로드.
// 전 코드가 same-origin 상대경로 + HttpOnly refresh cookie 라 웹 코드 0 변경으로 동작.
//
// 서버 URL 전환은 `cap sync` 시점의 CAP_SERVER_URL env 로 (package.json cap:sync:dev/prod).
//   개발/실기기 검증(Xcode Run) = dev.planq.kr (APNs sandbox)
//   TestFlight/스토어 빌드      = planq.kr    (APNs production)
// 기본값은 dev — 실수로 테스트 빌드가 운영을 가리키지 않도록(dev-first).
const serverUrl = process.env.CAP_SERVER_URL || 'https://dev.planq.kr';

const config: CapacitorConfig = {
  appId: 'app.planq',
  appName: 'PlanQ',
  // remote URL 방식이라 실제로 로드하지 않음 — webDir 형식 요건 + 오프라인 fallback 1장.
  webDir: 'www-placeholder',
  server: {
    url: serverUrl,
    cleartext: false,
    // 첫 로드 실패(비행기모드 등) 시 노출할 오프라인 fallback (www-placeholder/index.html). §6.7
    errorPath: 'index.html',
  },
  ios: {
    // ★ 'never' — WebView 가 상태바·홈 인디케이터 뒤까지 채운다(edge-to-edge).
    //   'automatic' 이면 WebView 자체가 안쪽으로 밀려 그 자리를 흰 배경이 차지한다
    //   ("위아래가 흰색으로 끊겨서 앱 같지 않다", 2026-08-25 실기기).
    //   인셋 책임은 CSS 로 옮긴다 — index.css 의 --pq-safe-top/bottom + 각 화면의
    //   env(safe-area-inset-*) 가 단일 원천이다. 둘 다 인셋하면 여백이 두 배가 된다.
    contentInset: 'never',
    // 스크롤 끝에서 튕기는 고무줄 비활성 — CSS overscroll-behavior 와 이중 방어.
    scrollEnabled: true,
  },
  // WebView 바탕색 — 페이지가 아직 안 그려진 순간(첫 로드·전환)에 흰 섬광 대신 앱 색.
  backgroundColor: '#115E59',
  plugins: {
    // ★ 2026-08-27 (Irene: "네이티브앱 알림은 앱 안에 나오는 게 아니라 폰에서 와야지")
    //   여태 포그라운드 OS 배너를 **의도적으로 껐고**(presentationOptions: []) 인앱 토스터가 대신했다.
    //   그 결과 아이폰 앱에서 데스크탑처럼 화면 상단에 인앱 알림이 떴다 — 네이티브답지 않다.
    //   → 포그라운드도 OS 배너로 통일하고, 네이티브에서는 인앱 토스터를 마운트하지 않는다(App.tsx).
    //   alert = iOS 14+ banner+list 매핑. 백엔드는 온라인 사용자도 push 를 이미 보내고 있다.
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
  // 주의: Keyboard(resize) 플러그인은 Phase 0 에서 의도적으로 미주입.
  //   기존 main.tsx visualViewport 보정(feedback_mobile_chat_input_offsettop)을 먼저 실기기 검증 후
  //   이중 보정이 확인되면 §6.4 대로 @capacitor/keyboard + resize:'native' 를 별도 추가.
};

export default config;
