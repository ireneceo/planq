// components/Tab/UrlMirror.tsx — ⑥ 탭 pane 내부 location ↔ store/브라우저 히스토리 동기
//
// pane 의 MemoryRouter 안(형제 Router)에 놓이므로 react-router 훅 사용 OK(chrome zone 아님).
// - 내부 네비 → store.setTabPath 역보고 + 활성 탭이면 브라우저 pushState(back 엔트리). (tabHistory 순수로직)
// - pane navigator 등록 → 외부(setActive/popstate)에서 이 탭의 MemoryRouter navigate 호출 통로.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { tabStore } from '../../stores/tabStore';
import { decidePaneNav } from '../../stores/tabHistory';

// 이 창에서 UrlMirror 가 쌓은 칸의 주소 — 인덱스 = history.state.pqIdx
const trail: string[] = [];

export default function UrlMirror({ tabId, active }: { tabId: string; active: boolean }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
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
    // 칸 번호(pqIdx)로 «바로 전 칸의 주소» 를 안다 — 닫기(replace 로 전 주소 복귀)를 back 으로 바꾸는 데 쓴다.
    const st = (window.history.state || {}) as { pqIdx?: number };
    const idx = typeof st.pqIdx === 'number' ? st.pqIdx : -1;
    const d = decidePaneNav({
      path, tabId, isActive: active, prevPath: prev.current,
      navType, windowPath: window.location.pathname + (window.location.search || ''),
      prevEntryPath: idx > 0 ? (trail[idx - 1] ?? null) : null,
    });
    if (d.op === 'push') {
      const base = idx >= 0 ? idx : 0;
      if (idx < 0) trail[0] = window.location.pathname + (window.location.search || '');
      const ni = base + 1;
      trail.length = ni;
      trail[ni] = path;
      try { window.history.pushState({ pqTab: tabId, pqIdx: ni }, '', path); } catch { /* noop */ }
    } else if (d.op === 'back') {
      try { window.history.back(); } catch { /* noop */ }
    }
    prev.current = path;
  }, [loc.pathname, loc.search, tabId, active, navType]);

  return null;
}
