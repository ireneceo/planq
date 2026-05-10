import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './index.css'
import App from './App.tsx'
import { bindPermissionSync } from './services/push.ts'

declare const __BUILD_ID__: string;

// Service Worker 등록 — Push 알림 + Share Target POST + PWA install 모두 SW 필요.
// updateViaCache:'none' — 브라우저가 sw.js 자체를 캐시하지 않게 강제 (옛 SW 잔류 방지).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      // 30분 주기 update 체크 — 새 SW 발견 시 install→activate 자동 진행
      setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch(() => { /* silent */ });
  });
}

// 알림 권한 동기화 — focus 복귀 시 OS 권한 OFF 면 backend 의 좀비 endpoint 자동 정리
bindPermissionSync();

// 빌드 자동 무효화 — 사용자가 수동으로 캐시 비우지 않아도 새 빌드 자동 감지.
//   1) Socket.IO `server:build` (즉시 — 1차 신호)
//   2) /version.json 5분 polling (안전망)
//   3) 새 build_id 감지 → pendingReload + 토스트 배너 ("업데이트 사용 가능")
//   4) 실제 reload 는 사용자 클릭 OR idle (입력 중 X / form-dirty X) 일 때만.
//      입력 도중 갑자기 reload → 데이터 손실 회귀 방지.
(() => {
  const POLL_INTERVAL_MS = 5 * 60 * 1000;  // 60s → 5min (Socket.IO 가 1차 신호)
  let baseBuildId: string | null = __BUILD_ID__ || null;
  let pendingReload = false;
  let bannerShown = false;

  const showBanner = () => {
    if (bannerShown) return;
    bannerShown = true;
    window.dispatchEvent(new CustomEvent('planq:update-available'));
  };

  const isReloadSafe = (): boolean => {
    if (document.visibilityState !== 'visible') return false;
    // input/textarea/contentEditable focus 중이면 미루기
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return false;
    // form-dirty 표시 — 명시적으로 "저장 안된 변경 있음" 알리는 컴포넌트가 body 에 attribute 박음
    if (document.body.dataset.formDirty === '1') return false;
    if (document.querySelector('[data-form-dirty="1"]')) return false;
    return true;
  };

  const reloadIfSafe = () => {
    if (!pendingReload) return;
    if (!isReloadSafe()) return;
    pendingReload = false;
    window.location.reload();
  };

  const onBuildIdSeen = (remote: string) => {
    if (!remote) return;
    if (!baseBuildId) { baseBuildId = remote; return; }
    if (remote === baseBuildId) return;
    pendingReload = true;
    showBanner();
    reloadIfSafe();
  };

  const checkVersion = async () => {
    try {
      const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      onBuildIdSeen(String(data.build_id || ''));
    } catch { /* network blip — 다음 주기에 재시도 */ }
  };

  // Socket.IO 이벤트 — 1차 신호 (즉시)
  window.addEventListener('planq:socket-build-id', ((ev: CustomEvent<{ build_id: string }>) => {
    onBuildIdSeen(String(ev.detail?.build_id || ''));
  }) as EventListener);

  // 사용자가 banner 의 "지금 업데이트" 클릭하면 즉시 reload (form-dirty 무시 — 명시적 의사)
  window.addEventListener('planq:apply-update', () => {
    pendingReload = false;
    window.location.reload();
  });

  // 5분 폴링 + idle 시점에 자동 reload 시도
  setTimeout(checkVersion, 5 * 1000);
  setInterval(checkVersion, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', reloadIfSafe);
  window.addEventListener('focus', reloadIfSafe);
  window.addEventListener('blur', reloadIfSafe);
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
