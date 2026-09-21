// 랜딩 방문 기록 — 쿠키 없음 · 숫자만 (2026-09-21). 서버: dev-backend/routes/landing_visits.js
//   랜딩 틀(LandingLayout)에서만 부른다 — 워크스페이스(그룹웨어) 화면은 세지 않는다(서버도 랜딩 주소만 받는다).
//   로그인한 사용자는 세지 않는다 — 우리 고객이 랜딩을 보는 것은 마케팅 방문이 아니다.
//   처음 들어온 페이지만 어디서 왔는지(document.referrer)를 싣고, 사이트 안 이동은 'internal'.
import { useEffect } from 'react';

let firstInSession = true;

export function useLandingBeacon(pathname: string, loggedIn: boolean) {
  useEffect(() => {
    if (loggedIn) return;
    const r = firstInSession ? (document.referrer || '') : 'internal';
    firstInSession = false;
    try {
      const body = new Blob([JSON.stringify({ p: pathname, r })], { type: 'application/json' });
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/landing-visits', body)) {
        void fetch('/api/landing-visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: pathname, r }), keepalive: true }).catch(() => {});
      }
    } catch { /* 집계 실패는 화면과 무관 */ }
  }, [pathname, loggedIn]);
}
