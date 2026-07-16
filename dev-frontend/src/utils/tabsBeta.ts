// utils/tabsBeta.ts — ⑥ 멀티탭 롤아웃 스위치 (strangler)
// 트리 스왑 전까지 탭 UI 는 이 플래그 뒤에서만 노출. 단일탭 사용자는 플래그 off = 기존과 100% 동일.
// 마지막 커밋(12/12)에서 기본 on 으로 flip 예정(Irene 승인 후). 데스크탑 전용.
export function isTabsBeta(): boolean {
  try {
    if (localStorage.getItem('planq_tabs_beta') !== '1') return false;
    return window.matchMedia?.('(min-width: 1025px)').matches ?? false;
  } catch {
    return false;
  }
}
