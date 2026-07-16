// hooks/useChromeNav.ts — ⑥ chrome 용 네비 (react-router useLocation/useNavigate 대체)
//
// chrome 은 활성 탭의 path 를 useLocation 대신 여기서 읽고, navigate 대신 openOrFocus 로 이동한다.
// 미러 모드에선 useActiveTabPath()가 실제 location 을 반영 → 단일탭 동작 동일(무회귀).
import { tabStore } from '../stores/tabStore';
import { useActiveTabPath } from './useTabStore';

// "/path?a=1" → { pathname:'/path', search:'?a=1' } (RR location 형태 호환)
export function parseTabPath(full: string): { pathname: string; search: string } {
  const qi = full.indexOf('?');
  if (qi < 0) return { pathname: full, search: '' };
  return { pathname: full.slice(0, qi), search: full.slice(qi) };
}

export function navigateTab(path: string) { tabStore.navigateActive(path); }

// RR useLocation 대체 — 활성 탭 path 의 {pathname, search}
export function useChromeLocation(): { pathname: string; search: string } {
  return parseTabPath(useActiveTabPath());
}

// RR useNavigate 대체 — 활성 탭 경로 변경(브라우저 탭 모델: 안으로 들어가도 새 탭 X).
export function useChromeNav(): (path: string) => void {
  return navigateTab;
}
