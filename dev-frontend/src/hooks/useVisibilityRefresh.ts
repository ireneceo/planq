import { useEffect } from 'react';

/**
 * 모바일 PWA background → foreground 복귀 시 데이터 회복.
 *
 * 사용처: socket listener 가 있는 페이지 — socket 재연결 사이 missed events 보정.
 * socket 없는 페이지도 stale-by-time 방지 목적으로 사용 가능.
 *
 * @param refetch  visible 전환 시 호출할 fetch 함수
 * @param minIntervalMs  마지막 호출 후 이 시간 이내 재호출 skip (기본 5초 — 불필요 spam 방지)
 */
export function useVisibilityRefresh(refetch: () => void, minIntervalMs = 5000) {
  useEffect(() => {
    let lastAt = 0;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAt < minIntervalMs) return;
      lastAt = now;
      refetch();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refetch, minIntervalMs]);
}
