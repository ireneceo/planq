// 캐시 자동 갱신 — 유저가 캐시/재설치 문제에 부딪히지 않게 새 배포를 자동 적용.
//   /api/build-version (no-store) 폴링 → 새 빌드 감지 시:
//     1) SW 강제 update() — 옛 ServiceWorker 잔존 차단 (sw.js no-cache + skipWaiting 이라 즉시 새 SW)
//     2) 입력 중이 아니면 즉시 hard reload, 입력 중이면 다음 navigation 까지 보류 (폼 데이터 보호)
//   폴링: 5분 인터벌 + focus/visibility 복귀 시 즉시 (오래 켜둔 탭도 빠르게 최신화).
//   운영: 알림 미수신이 "옛 SW 캐시"로 밝혀진 사고 (2026-06-15) → SW 강제 update 추가.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const POLL_MS = 5 * 60 * 1000;  // 5분

// 입력 중이면 reload 보류 (데이터 손실 방지). main.tsx isReloadSafe 와 동일 기준.
function isReloadSafe(): boolean {
  try {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
    if (document.body.dataset.formDirty === '1') return false;
    if (document.querySelector('[data-form-dirty="1"]')) return false;
  } catch { /* noop */ }
  return true;
}

async function forceSwUpdate(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch { /* noop */ }
}

const BuildVersionGuard: React.FC = () => {
  const location = useLocation();
  const initialRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const r = await fetch('/api/build-version', { cache: 'no-store' });
        const j = await r.json();
        if (!mounted || !j?.success) return;
        const v: string | null = j.data?.version || null;
        if (!v) return;
        if (initialRef.current == null) { initialRef.current = v; return; }
        if (initialRef.current !== v) {
          pendingReloadRef.current = true;
          // 새 빌드 → 옛 SW 잔존 차단 위해 강제 최신화 (sw.js no-cache + skipWaiting → 즉시 새 SW)
          await forceSwUpdate();
          // 화면을 안 보고 있을 때(hidden)만 즉시 reload — 보고 있으면 다음 navigation 때 조용히 적용.
          // (잦은 배포 시 사용자가 보는 중에 화면이 튀는 것 방지. 다음 페이지 이동 effect 가 안전 적용)
          if (document.visibilityState === 'hidden' && isReloadSafe()) window.location.reload();
        }
      } catch { /* network 일시 오류 무시 */ }
    };
    check();
    const id = setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 새 빌드 감지됐는데 입력 중이라 보류된 경우 → 다음 navigation 시점에 안전하게 reload
  useEffect(() => {
    if (pendingReloadRef.current && isReloadSafe()) window.location.reload();
  }, [location.pathname]);

  return null;
};

export default BuildVersionGuard;
