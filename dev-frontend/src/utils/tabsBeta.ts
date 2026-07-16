// utils/tabsBeta.ts — ⑥ 멀티탭 롤아웃 스위치 (strangler)
// 트리 스왑 전까지 탭 UI 노출 게이트. 데스크탑 전용.
//   - 운영(planq.kr): 기본 off — 완성(커밋12)에서 전역 on flip.
//   - dev(검토용): 기본 on — Irene 검토 편의. localStorage 로 개별 on/off override 가능.
export function isTabsBeta(): boolean {
  try {
    if (!(window.matchMedia?.('(min-width: 1025px)').matches ?? false)) return false;
    const ls = localStorage.getItem('planq_tabs_beta');
    if (ls === '1') return true;    // 명시 on
    if (ls === '0') return false;   // 명시 off (opt-out)
    // 기본값: dev 도메인 on, 그 외(운영) off
    const host = window.location.hostname;
    return host === 'dev.planq.kr' || host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

// 트리 스왑(keep-alive) 게이트 — 별도 off-by-default(dev 도 off). puppeteer tabs 스위트 + Irene 검증 후
//   승격 예정. spike on 이어야 TabAppShell(형제 MemoryRouter) 마운트. off 면 기존 shell(BrowserRouter) 무변화.
export function isTabsSpike(): boolean {
  try {
    if (!(window.matchMedia?.('(min-width: 1025px)').matches ?? false)) return false;
    return localStorage.getItem('planq_tabs_spike') === '1';
  } catch {
    return false;
  }
}
