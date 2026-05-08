// 우측 detail drawer 의 반응형 시작 width.
// viewport × 0.35, [380, 560] clamp. 사용자가 수동 리사이즈 후 localStorage 저장한 값 우선.
//
// 13인치 노트북 (1280px) → 448px (이전 fixed 560 → 112px 절약)
// 24인치 모니터 (1920px) → 560px (가이드 max)
// 더 좁아지면 380 (가이드 min)
//
// 메모리 박제 (반응형 드로어 정책): ≥1025px 지정 width / 641~1024 90vw / ≤640 100vw.
// 본 helper 는 ≥641px 의 default 시작값. DetailDrawer 컴포넌트가 모바일 풀스크린 처리.
export function responsiveDrawerWidth(savedKey?: string): number {
  if (savedKey) {
    try {
      const v = localStorage.getItem(savedKey);
      if (v) return Math.max(360, Math.min(1000, Number(v)));
    } catch { /* ignore */ }
  }
  if (typeof window === 'undefined') return 480;
  return Math.max(380, Math.min(560, Math.round(window.innerWidth * 0.35)));
}
