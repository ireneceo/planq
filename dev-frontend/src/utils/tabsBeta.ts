// utils/tabsBeta.ts — ⑥ 멀티탭 롤아웃 스위치 (strangler)
// 트리 스왑 keep-alive 탭 UI 게이트. 데스크탑 + **태블릿 가로**(아래 TABS_MEDIA). 폰은 단일페이지.
//   2026-07-16 전역 승격: keep-alive 입력 state 보존 실증(탭 왕복 값 유지) + tabs 스위트 6/6
//   (무크래시·keep-alive·뒤로가기·F5복원·마이크 track-alive) 통과 → dev·운영 모두 기본 on.
//   localStorage 로 개별 opt-out 가능('0'). 롤백: 이 기본값을 false 로 되돌리고 배포.
// ★ 탭이 켜지는 화면 조건 — **단일 원천** (2026-09-06).
//   Irene(안드로이드 태블릿): "태블릿 사이즈는 상단탭 기능도 그대로 있어야 하는 거 아니야?
//   왜 다 모바일처럼 나와?"
//
//   옛 조건은 `min-width: 1025px` 하나였다. 태블릿은 **가로에서도** 그 밑이라(대개 1024 이하)
//   모바일 취급을 받았다 — 탭이 통째로 없었다.
//
//   폭만 낮추면 **폰 가로**가 딸려 들어온다(iPhone 15 Pro Max 가로 = 932px). 그래서 높이를
//   같이 본다: 폰 가로는 높이가 390~430 이고 태블릿 가로는 768~800 이다.
//     · 태블릿 가로 1280×800 · iPad 가로 1024×768 → 켜짐
//     · 폰 가로 932×430 → 꺼짐 (높이 미달)
//     · 태블릿 세로 800×1280 → 꺼짐 (폭 미달 — 세로는 한 화면에 탭+패널이 안 선다)
//   ★ 패널 드릴다운(PANEL_BP.drilldown = 1024)은 **그대로 둔다.** 탭은 상단 한 줄이라 900 에서도
//     서지만, 3컬럼 패널은 900 에서 컬럼당 300px 이 되어 못 쓴다. 둘은 다른 문제다.
const TABS_MEDIA = '(min-width: 900px) and (min-height: 600px)';

function screenAllowsTabs(): boolean {
  return window.matchMedia?.(TABS_MEDIA).matches ?? false;
}

export function isTabsBeta(): boolean {
  try {
    if (!screenAllowsTabs()) return false;
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
    if (!screenAllowsTabs()) return false;
    const ls = localStorage.getItem('planq_tabs_spike');
    if (ls === '1') return true;
    if (ls === '0') return false;   // 명시 opt-out
    return true;                    // 기본 on (데스크탑 전역)
  } catch {
    return false;
  }
}
