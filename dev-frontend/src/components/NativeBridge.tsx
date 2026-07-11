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
import { isNativeApp, nativePlatform } from '../services/native';

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
          const urlHandle = await App.addListener('appUrlOpen', async ({ url }) => {
            // OAuth 등으로 열려있던 시스템 브라우저 닫기 (열려있지 않으면 no-op).
            Browser.close().catch(() => {});
            let u: URL;
            try { u = new URL(url); } catch { return; }

            // ── 네이티브 Google 로그인 code 교환 (H-2) ──
            //   딥링크로 받은 일회용 code 를 앱 WebView 컨텍스트에서 세션으로 교환 → refresh cookie 심김
            //   → /inbox 리로드 시 AuthContext bootstrap 이 자동 로그인.
            if (u.pathname === '/oauth/native-return') {
              // #125a — 개인 연동(구글 캘린더·드라이브·Gmail) 복귀. 로그인과 달리 교환할 code 가 없다.
              //   여기서 걸러내지 않으면 아래 code 분기에서 조용히 무시돼 "연동 완료 창이 멈춘" 것처럼 보인다.
              if (u.searchParams.get('kind') === 'connect') {
                window.dispatchEvent(new CustomEvent('planq:oauth-connected', {
                  detail: {
                    provider: u.searchParams.get('provider') || null,
                    ok: u.searchParams.get('ok') === '1',
                    error: u.searchParams.get('error') || null,
                  },
                }));
                return;
              }
              const code = u.searchParams.get('code');
              if (code) {
                try {
                  const r = await fetch('/api/auth/google/native-exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ code, client_kind: nativePlatform() }),
                  });
                  if (r.ok) { window.location.href = '/inbox'; return; }
                } catch { /* fall through */ }
                window.location.href = '/login?oauth_error=native_exchange';
              }
              return;
            }

            // 연동 페이지가 상태를 다시 불러오도록 (idempotent — refetch 만).
            window.dispatchEvent(new CustomEvent('planq:oauth-connected'));
            // 딥링크 경로가 앱 라우트면 이동.
            const path = u.pathname + u.search + u.hash;
            if (path && !path.startsWith('/api/')) {
              window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path } }));
            }
          });
          // Android 하드웨어 뒤로가기 → WebView 히스토리 있으면 뒤로, 없으면 앱 종료 (iOS 는 미발화).
          //   canGoBack 은 Capacitor 가 추적하는 WebView 실제 히스토리 (history.length 휴리스틱보다 정확).
          const backHandle = await App.addListener('backButton', ({ canGoBack }) => {
            if (canGoBack) window.history.back();
            else App.exitApp();
          });
          // 시스템 브라우저(OAuth)가 닫히면 — 성공(딥링크 복귀)이든 사용자 취소든 — 연동 페이지의
          //   "연결 중" 스피너가 영구 잔존하지 않도록 dismiss 이벤트 발행 (L-4).
          const browserHandle = await Browser.addListener('browserFinished', () => {
            window.dispatchEvent(new CustomEvent('planq:oauth-dismissed'));
          });
          cleanupNative = () => { urlHandle.remove(); backHandle.remove(); browserHandle.remove(); };
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
