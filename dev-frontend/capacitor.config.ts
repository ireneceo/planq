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
  },
  ios: {
    // 세이프에어리어/상태바 자동 인셋. 기존 env(safe-area-inset-*) CSS 와 병행.
    contentInset: 'automatic',
  },
  // 주의: Keyboard(resize) 플러그인은 Phase 0 에서 의도적으로 미주입.
  //   기존 main.tsx visualViewport 보정(feedback_mobile_chat_input_offsettop)을 먼저 실기기 검증 후
  //   이중 보정이 확인되면 §6.4 대로 @capacitor/keyboard + resize:'native' 를 별도 추가.
};

export default config;
