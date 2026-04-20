import { useEffect, useState } from 'react';

/**
 * CSS 미디어 쿼리 React 바인딩.
 * SSR 안전 + change 리스너 정리.
 *
 * 예) const isNarrow = useMediaQuery('(max-width: 1200px)');
 */
export const useMediaQuery = (query: string): boolean => {
  const getMatch = (): boolean => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // Safari 구버전 호환
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
};

export const useIsNarrow = (breakpoint = 1200): boolean =>
  useMediaQuery(`(max-width: ${breakpoint}px)`);
