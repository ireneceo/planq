// useActivityTracker — 사용자 활동 감지 hook (사이클 N+26 Phase 2)
//
// mouse / keyboard / touch / scroll 이벤트로 마지막 활동 시각을 추적.
// idle 임계 시간 초과 시 onIdle 콜백, 활동 복귀 시 onActive 콜백.
//
// 사용:
//   useActivityTracker({
//     idleMinutes: 15,
//     onIdle: () => setIdlePromptVisible(true),
//     onActive: (idleSeconds) => console.log(`${idleSeconds}s 돌아옴`),
//   });
//
// 이벤트는 throttle (5초 간격 timestamp 갱신) — render spam 차단.

import { useEffect, useRef } from 'react';

interface Options {
  idleMinutes: number;
  onIdle?: () => void;
  onActive?: (idleSeconds: number) => void;
  enabled?: boolean;
}

export function useActivityTracker({ idleMinutes, onIdle, onActive, enabled = true }: Options) {
  const lastActivityRef = useRef<number>(Date.now());
  const isIdleRef = useRef(false);
  const throttleRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const idleMs = idleMinutes * 60 * 1000;

    const recordActivity = () => {
      const now = Date.now();
      // throttle — 5초 간격
      if (now - throttleRef.current < 5000) return;
      throttleRef.current = now;
      const wasIdle = isIdleRef.current;
      const idleSec = Math.floor((now - lastActivityRef.current) / 1000);
      lastActivityRef.current = now;
      if (wasIdle) {
        isIdleRef.current = false;
        onActive?.(idleSec);
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, recordActivity, { passive: true }));

    const checkIdle = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= idleMs && !isIdleRef.current) {
        isIdleRef.current = true;
        onIdle?.();
      }
    }, 30000);  // 30초마다 체크

    return () => {
      events.forEach(ev => window.removeEventListener(ev, recordActivity));
      window.clearInterval(checkIdle);
    };
  }, [enabled, idleMinutes, onIdle, onActive]);

  return {
    getLastActivity: () => lastActivityRef.current,
    isIdle: () => isIdleRef.current,
  };
}
