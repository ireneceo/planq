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
//   같이 본다: 폰 가로는 높이가 390~430 이고 태블릿 가로는 550~800 이다.
//
//   ★ 높이 하한은 **내비게이션 바를 뺀 값**이어야 한다 (2026-09-06 실기기).
//     갤럭시 탭 A8(SM-X200) 은 1920×1200 이라 CSS 로 960×600 인데, 안드로이드 하단 내비바가
//     48dp 를 먹어 **실제 뷰포트 높이는 ≈552** 다. 처음에 600 으로 잡아서 그 기기에서는
//     탭이 영영 안 켜졌다 (Irene: "상단 탭기능은 그냥 태블릿에서는 없어야 해?").
//     상태바 보정을 지우던 것과 **같은 축의 실수** — 시스템 바가 뷰포트를 깎는 것을 안 뺐다.
//     500 이면 폰 가로(≤430)와 태블릿 가로(≥552) 사이가 122px 벌어져 안전하다.
//   ★ 세로도 켠다 (Irene 2026-09-06: "세로에도 넣어줘"). 한 조건으로 넷이 다 갈린다:
//     · 태블릿 세로 600×912 · iPad 세로 768×1024  → 켜짐 (폭 ≥550)
//     · 태블릿 가로 960×552 · iPad 가로 1024×768  → 켜짐
//     · 폰 세로 390×844 · 430×932                 → 꺼짐 (폭 미달 — 폰 최대 430)
//     · 폰 가로 932×430 · 844×390                 → 꺼짐 (높이 미달 — 폰 최대 430)
//     폰↔태블릿 사이가 폭 430↔550, 높이 430↔552 로 양쪽 다 120px 벌어져 경계에 안 걸린다.
//   ★ 패널 드릴다운(PANEL_BP.drilldown = 1024)은 **그대로 둔다.** 탭은 상단 한 줄이라 900 에서도
//     서지만, 3컬럼 패널은 900 에서 컬럼당 300px 이 되어 못 쓴다. 둘은 다른 문제다.
const TABS_MEDIA = '(min-width: 550px) and (min-height: 500px)';

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
