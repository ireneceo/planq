// 네이티브 앱 배포 링크 — 단일 원천.
//
// 왜 상수 파일인가: 링크가 필요한 자리는 하나가 아니다(설치 안내 배너·설정·도움말·랜딩).
// 각자 문자열을 들고 있으면 스토어 심사로 URL 이 바뀔 때 한 군데만 고치고 끝난다.
//
// 상태 (2026-09-03)
//   iOS  — TestFlight 베타 승인 완료. 정식 App Store 는 심사 전이라 null.
//   안드로이드 — Play Console 등록 진행 중. 공개되면 PLAY_URL 을 채운다.

/** iOS 베타(TestFlight). 누구나 링크로 참여할 수 있는 공개 테스터 링크. */
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/18aF7Ze5';

/** iOS 정식 출시 후 App Store 링크. 심사 통과 전에는 null — null 이면 TestFlight 를 안내한다. */
export const APP_STORE_URL: string | null = null;

/** Android Play 스토어 링크. 심사 통과 전에는 null — null 이면 홈 화면 추가(PWA)를 안내한다. */
export const PLAY_URL: string | null = null;

/** 이 기기에 권할 네이티브 앱 링크. 없으면 null(= PWA 안내로 떨어진다). */
export function nativeAppLink(): { url: string; beta: boolean } | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) {
    if (APP_STORE_URL) return { url: APP_STORE_URL, beta: false };
    return { url: TESTFLIGHT_URL, beta: true };
  }
  if (/Android/.test(ua) && PLAY_URL) return { url: PLAY_URL, beta: false };
  return null;
}
