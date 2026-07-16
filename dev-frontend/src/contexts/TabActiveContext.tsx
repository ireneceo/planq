// contexts/TabActiveContext.tsx — ⑥ 멀티탭 선행 인프라 (P0-B: 앱탭 활성 컨텍스트)
//
// 문제: 코드 전반이 document.visibilityState==='visible' = "사용자가 보고 있음"으로 가정.
//   멀티탭에선 백그라운드 앱탭도 브라우저상 visible → 폴링·단축키·refetch 오작동.
// 설계: 각 TabPane 이 자기 active 여부를 Provider 로 주입. 페이지는 useTabActive()/useReallyVisible() 소비.
//   단일탭(Provider 없음)에선 fallback=true → 기존 동작 100% 동일(무회귀). 멀티탭 P1(TabPane)에서 활성화.
// 참고 설계: docs/MULTITAB_DESIGN.md §2.2
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

const TabActiveContext = createContext<boolean>(true); // 단일탭 fallback = true
export const TabActiveProvider = TabActiveContext.Provider;

// "이 앱탭이 활성(전면) 탭인가" — 단일탭에선 항상 true.
export const useTabActive = () => useContext(TabActiveContext);

// document visibility 외부 store 구독 (useSyncExternalStore — tearing 없는 정합 구독)
function subVisibility(cb: () => void) {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}
const getDocVisible = () => (typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);
const getDocVisibleServer = () => true; // SSR 없음 — 안전 기본

// 진짜 "사용자가 이 앱탭을 보고 있음" = 브라우저 탭 visible AND 이 앱탭 활성.
// ⚠ Rules of Hooks: 두 hook 을 조건 없이 먼저 호출한 뒤 값만 결합(단축평가 조건부 호출 금지).
export const useReallyVisible = () => {
  const tabActive = useTabActive();
  const docVisible = useSyncExternalStore(subVisibility, getDocVisible, getDocVisibleServer);
  return tabActive && docVisible;
};

// useVisibilityRefresh 의 멀티탭 대응판 — (a) 브라우저 visible 복귀 또는 (b) 이 앱탭 비활성→활성 전환 시 refetch.
//   단일탭에선 tabActive 항상 true → 브라우저 visible 복귀 시 발화(= 기존 useVisibilityRefresh 동등, 무회귀).
//   마운트 시엔 발화 안 함(이미 로드됨). minIntervalMs 이내 중복 발화 skip.
export function useTabForeground(refetch: () => void, minIntervalMs = 5000) {
  const really = useReallyVisible();
  const lastAt = useRef(0);
  const prev = useRef(really);
  useEffect(() => {
    if (really && !prev.current) {
      const now = Date.now();
      if (now - lastAt.current >= minIntervalMs) { lastAt.current = now; refetch(); }
    }
    prev.current = really;
  }, [really, refetch, minIntervalMs]);
}

export default TabActiveContext;
