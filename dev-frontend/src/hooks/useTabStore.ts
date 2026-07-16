// hooks/useTabStore.ts — ⑥ TabStore React 구독 훅
import { useSyncExternalStore } from 'react';
import { tabStore, activeTab, type Tab } from '../stores/tabStore';

export function useTabState() {
  return useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot, tabStore.getSnapshot);
}

export function useTabs(): Tab[] {
  return useTabState().tabs;
}

export function useActiveTab(): Tab | null {
  return activeTab(useTabState());
}

// chrome 이 useLocation 대신 소비 — 활성 탭의 현재 path(+search). 미러 모드에선 실제 location 을 반영.
export function useActiveTabPath(): string {
  return useActiveTab()?.path || '/';
}
