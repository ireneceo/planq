// components/Tab/TabMirror.tsx — ⑥ 멀티탭 미러 어댑터 (M0, strangler)
//
// 트리 스왑 전, 현재 단일 BrowserRouter 의 location 을 TabStore 활성 탭 path 로 미러한다.
// 이걸로 chrome(사이드바·알림 등)을 하나씩 TabStore 소비로 전환해도 각 단계가 단일탭에서
// 무회귀로 동작(store.activeTab.path === 실제 location). 화면에 아무것도 렌더하지 않는다(null).
//
// - navigate 위임: store.openOrFocus/setActive 가 mirror 모드에서 실제 SPA 네비를 하도록 주입.
//   루프 가드: 목적 path 가 현재 location 과 같으면 skip(openOrFocus→navigate→location→seed 순환 차단).
// - location→store: 앱 경로 진입 시 seedFromPath 로 활성 탭 path 갱신.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tabStore, setTabNavigator } from '../../stores/tabStore';

// 탭 대상이 아닌 인증/온보딩 경로 — 미러 seed 제외 (마케팅·팝아웃은 상위 !hideAppChrome 마운트로 이미 제외)
const NON_TAB_PREFIX = ['/login', '/register', '/invite', '/forgot-password', '/reset-password', '/verify-email', '/legal', '/download', '/onboarding'];
function isSeedable(pathname: string): boolean {
  return !NON_TAB_PREFIX.some((pre) => pathname === pre || pathname.startsWith(pre + '/') || pathname.startsWith(pre + '?') || pathname.startsWith(pre));
}

export default function TabMirror() {
  const loc = useLocation();
  const navigate = useNavigate();

  // navigate 위임 주입 (루프 가드 포함)
  useEffect(() => {
    setTabNavigator((path: string) => {
      const cur = window.location.pathname + window.location.search;
      if (path === cur) return; // 이미 그 위치 — 순환 차단
      navigate(path);
    });
    return () => setTabNavigator(null);
  }, [navigate]);

  // location → store (앱 경로만)
  useEffect(() => {
    const full = loc.pathname + (loc.search || '');
    if (isSeedable(loc.pathname)) tabStore.seedFromPath(full);
  }, [loc.pathname, loc.search]);

  return null;
}
