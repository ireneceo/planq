// hooks/useVisibilityRefresh.ts
//
// 모바일 PWA background → foreground 복귀 시 데이터 회복.
// ⑥ 멀티탭 — 몸통을 useTabForeground 로 위임(Fable M5). 17개 소비처 무수정으로 tab-aware 화:
//   단일탭(TabActiveProvider 부재)에선 tabActive 항상 true → 기존 동작 100% 동일(visible 복귀 시 발화).
//   트리 스왑에선 (a) 브라우저 visible 복귀 또는 (b) 이 앱탭 비활성→활성 시에만 발화 → 숨은 탭은
//   background 폴링·refetch 안 함(도킹된 폴링 정지의 근본).
export { useTabForeground as useVisibilityRefresh } from '../contexts/TabActiveContext';
