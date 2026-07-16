// components/Tab/UrlMirror.tsx — ⑥ 탭 pane 내부 location ↔ store/브라우저 히스토리 동기
//
// pane 의 MemoryRouter 안(형제 Router)에 놓이므로 react-router 훅 사용 OK(chrome zone 아님).
// - 내부 네비 → store.setTabPath 역보고 + 활성 탭이면 브라우저 pushState(back 엔트리). (tabHistory 순수로직)
// - pane navigator 등록 → 외부(setActive/popstate)에서 이 탭의 MemoryRouter navigate 호출 통로.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tabStore } from '../../stores/tabStore';
import { decidePaneNav } from '../../stores/tabHistory';

export default function UrlMirror({ tabId, active }: { tabId: string; active: boolean }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const prev = useRef<string | null>(null);

  // pane navigator 등록/해제
  useEffect(() => {
    tabStore.registerPaneNavigator(tabId, (p: string) => navigate(p));
    return () => tabStore.unregisterPaneNavigator(tabId);
  }, [tabId, navigate]);

  // 내부 네비 → store + 히스토리
  useEffect(() => {
    const path = loc.pathname + (loc.search || '');
    tabStore.setTabPath(tabId, path);
    const d = decidePaneNav({ path, tabId, isActive: active, prevPath: prev.current });
    if (d.op === 'push') {
      try { window.history.pushState({ pqTab: tabId }, '', path); } catch { /* noop */ }
    }
    prev.current = path;
  }, [loc.pathname, loc.search, tabId, active]);

  return null;
}
