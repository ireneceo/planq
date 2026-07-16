// components/Tab/PopstateBridge.tsx — ⑥ 브라우저 back/forward → 탭 재타겟
//
// popstate 시 window path + e.state.pqTab 으로 활성화할 탭 결정(tabHistory.resolvePopstate 순수로직):
//   pqTab 살아있음=그 탭 활성 / 닫힘·무state=path 소유 탭 / 무매칭=새 탭. "back 이 탭 경계 넘으면 소유 탭 자동 전환".
import { useEffect } from 'react';
import { tabStore } from '../../stores/tabStore';
import { resolvePopstate } from '../../stores/tabHistory';

export default function PopstateBridge() {
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const path = window.location.pathname + window.location.search;
      const stateTabId = (e.state && (e.state as { pqTab?: string }).pqTab) || null;
      const r = resolvePopstate(tabStore.getSnapshot().tabs, path, stateTabId);
      if (r.kind === 'activate') {
        tabStore.setActive(r.tabId);
        tabStore.navigateActive(path); // 그 탭을 popstate path 로 (탭 내 다른 위치일 수 있음)
      } else {
        tabStore.newTab(path);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return null;
}
