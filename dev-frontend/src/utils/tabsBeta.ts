// utils/tabsBeta.ts — ⑥ 멀티탭 롤아웃 스위치 (strangler)
// 트리 스왑 keep-alive 탭 UI 게이트. 데스크탑 전용(≥1025px). 모바일은 단일페이지 유지.
//   2026-07-16 전역 승격: keep-alive 입력 state 보존 실증(탭 왕복 값 유지) + tabs 스위트 6/6
//   (무크래시·keep-alive·뒤로가기·F5복원·마이크 track-alive) 통과 → dev·운영 모두 기본 on.
//   localStorage 로 개별 opt-out 가능('0'). 롤백: 이 기본값을 false 로 되돌리고 배포.
export function isTabsBeta(): boolean {
  try {
    if (!(window.matchMedia?.('(min-width: 1025px)').matches ?? false)) return false;
    const ls = localStorage.getItem('planq_tabs_beta');
    if (ls === '1') return true;    // 명시 on
    if (ls === '0') return false;   // 명시 off (opt-out)
    return true;                    // 기본 on (데스크탑 전역)
  } catch {
    return false;
  }
}

// 트리 스왑(keep-alive) 게이트 — spike on 이어야 TabAppShell(형제 MemoryRouter) 마운트.
//   2026-07-16 전역 승격: 기본 on(데스크탑). opt-out '0' 또는 기본값 flip 으로 즉시 롤백.
export function isTabsSpike(): boolean {
  try {
    if (!(window.matchMedia?.('(min-width: 1025px)').matches ?? false)) return false;
    const ls = localStorage.getItem('planq_tabs_spike');
    if (ls === '1') return true;
    if (ls === '0') return false;   // 명시 opt-out
    return true;                    // 기본 on (데스크탑 전역)
  } catch {
    return false;
  }
}
