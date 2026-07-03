// 네이티브 브리지 — 딥링크(Universal Link/App Link) + 알림 탭 → SPA 네비게이션 (MOBILE_APP_DESIGN §5.4·§7.2).
// null 렌더. App 내부(Router 하위)에 1개 mount 하여 useNavigate 사용.
//
// 이벤트 규약(웹/네이티브 공용):
//   window 'planq:navigate' { detail: { path } }      → SPA 라우팅 (알림 탭·딥링크)
//   window 'planq:oauth-connected'                     → 연동 페이지가 상태 refetch (§6.8 시스템 브라우저 복귀)
//
// 웹에서는 native 리스너를 달지 않으므로 회귀 0 (planq:navigate 리스너만, 웹에선 아무도 발행 안 함).
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp } from '../services/native';

export default function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    // 공용 — 알림 탭/딥링크가 발행하는 앱 내부 네비게이션 이벤트.
    const onNavigate = (e: Event) => {
      let path = (e as CustomEvent).detail?.path;
      if (typeof path !== 'string') return;
      // 옛 데이터가 절대 URL 일 수 있음(feedback_legacy_data_sample_verify) — same-origin 이면 path 추출.
      if (/^https?:\/\//i.test(path)) {
        try {
          const u = new URL(path);
          if (u.origin !== window.location.origin) return;
          path = u.pathname + u.search + u.hash;
        } catch { return; }
      }
      if (path.startsWith('/') && !path.startsWith('/api/')) navigate(path);
    };
    window.addEventListener('planq:navigate', onNavigate);

    // 네이티브 전용 — Universal Link/App Link 로 앱이 열릴 때(딥링크·OAuth 콜백 복귀).
    let cleanupNative: (() => void) | null = null;
    if (isNativeApp()) {
      (async () => {
        try {
          const [{ App }, { Browser }] = await Promise.all([
            import('@capacitor/app'),
            import('@capacitor/browser'),
          ]);
          const urlHandle = await App.addListener('appUrlOpen', ({ url }) => {
            // OAuth 등으로 열려있던 시스템 브라우저 닫기 (열려있지 않으면 no-op).
            Browser.close().catch(() => {});
            // 연동 페이지가 상태를 다시 불러오도록 (idempotent — refetch 만).
            window.dispatchEvent(new CustomEvent('planq:oauth-connected'));
            // 딥링크 경로가 앱 라우트면 이동.
            try {
              const u = new URL(url);
              const path = u.pathname + u.search + u.hash;
              if (path && !path.startsWith('/api/')) {
                window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path } }));
              }
            } catch { /* 커스텀 스킴 등 파싱 불가 — 무시 */ }
          });
          // Android 하드웨어 뒤로가기 → SPA 뒤로가기. 히스토리 루트면 앱 종료 (iOS 는 미발화).
          const backHandle = await App.addListener('backButton', () => {
            if (window.history.length > 1) window.history.back();
            else App.exitApp();
          });
          cleanupNative = () => { urlHandle.remove(); backHandle.remove(); };
        } catch { /* 플러그인 미가용 — 무시 */ }
      })();
    }

    return () => {
      window.removeEventListener('planq:navigate', onNavigate);
      if (cleanupNative) cleanupNative();
    };
  }, [navigate]);

  return null;
}
