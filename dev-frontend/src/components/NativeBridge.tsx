// 네이티브 브리지 — 딥링크(Universal Link/App Link) + 알림 탭 → SPA 네비게이션 (MOBILE_APP_DESIGN §5.4·§7.2).
// null 렌더. App 내부(Router 하위)에 1개 mount 하여 useNavigate 사용.
//
// 이벤트 규약(웹/네이티브 공용):
//   window 'planq:navigate' { detail: { path } }      → SPA 라우팅 (알림 탭·딥링크)
//   window 'planq:oauth-connected'                     → 연동 페이지가 상태 refetch (§6.8 시스템 브라우저 복귀)
//
// 웹에서는 native 리스너를 달지 않으므로 회귀 0 (planq:navigate 리스너만, 웹에선 아무도 발행 안 함).
import { useCallback, useEffect } from 'react';
import { useChromeNav } from '../hooks/useChromeNav';
import { isNativeApp, nativePlatform } from '../services/native';

export default function NativeBridge() {
  const chromeNav = useChromeNav();

  /**
   * 알림·딥링크 전용 이동 — **조용히 실패하지 않는다.**
   *
   * chrome nav(tabStore)는 미러 모드에서 navigateDelegate 로만 이동하는데, 그것을 심는
   * TabMirror 가 아직 mount 전이거나 언마운트된 표면이면 **아무 일도 일어나지 않는다**
   * (App.tsx 주석: "navigateDelegate 가 null → chrome nav 는 silent no-op").
   * 알림 링크는 그 사이에 이미 소비돼 사라지므로, 실패하면 사용자는 앱 기본 착지
   * (start_url = /inbox = 확인필요)에 남는다 — "메일 알림을 눌렀는데 확인필요로 갔고
   * 상세가 안 열렸다"(Irene, 2026-08-30)의 모양이 정확히 이것이다.
   *
   * 그래서 이동이 실제로 일어났는지 **다음 프레임에 주소로 확인**하고, 그대로면
   * 전체 로드로 착지시킨다. 느리지만 링크를 잃는 것보다 낫다.
   */
  const deepLinkNav = useCallback((path: string) => {
    const here = () => window.location.pathname + window.location.search;
    if (path === here()) return;                       // 이미 그 자리
    try { chromeNav(path); } catch { /* 아래 폴백이 받는다 */ }
    // ★ 판정은 "주소가 **바뀌었나**" 가 아니라 "**목적지에 있나**" 여야 한다.
    //   아이폰 앱은 루트(/)로 뜨고 그 경로는 인증 사용자를 /inbox 로 **스스로 보낸다**
    //   (App.tsx NativeMarketingRedirect). "바뀌었나" 로 재면 그 리다이렉트를 이동 성공으로
    //   오인해 폴백이 영영 안 터진다 — 고치려던 바로 그 화면(확인필요)에 남는다.
    window.setTimeout(() => {
      if (here() !== path) window.location.assign(path);   // SPA 이동이 안 먹었다 → 확실히 착지
    }, 400);
  }, [chromeNav]);

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
      if (path.startsWith('/') && !path.startsWith('/api/')) deepLinkNav(path);
    };
    window.addEventListener('planq:navigate', onNavigate);

    // 콜드 스타트로 보관돼 있던 알림 링크 소비 — 라우터가 준비된 지금 이동한다.
    //   (탭 이벤트가 리스너보다 먼저 오는 경우가 있어 services/nativePush 가 sessionStorage 에 남긴다)
    //
    // ★ 읽는 즉시 지운다(consume-once). "도착할 때까지 들고 있기" 를 시도했다가 되돌렸다 —
    //   SPA 이동은 재마운트가 없어 보관값이 영영 안 지워졌고(다음 실행 때 지난 메일로 튐),
    //   못 가는 경로에서는 문서 로드가 11회까지 폭주했다(실측). 고치려던 것보다 나빴다.
    //   대신 아래 deepLinkNav 가 **목적지 도착을 확인**하고 안 됐으면 전체 로드로 착지시킨다.
    try {
      const pending = sessionStorage.getItem('planq_pending_push_link');
      if (pending) {
        sessionStorage.removeItem('planq_pending_push_link');
        if (pending.startsWith('/') && !pending.startsWith('/api/')) deepLinkNav(pending);
      }
    } catch { /* 무시 */ }

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

            // 복귀 경로 판정 — 두 형태를 모두 받는다.
            //   ① https://planq.kr/oauth/native-return   (Universal Link — 외부에서 들어올 때)
            //   ② planq://oauth/native-return            (커스텀 스킴 — 시스템 브라우저 OAuth 복귀)
            //   ②가 정본이다: iOS 는 같은 도메인 안의 302 로는 UL 을 발화하지 않아 ①이 복불복이었다
            //   (2026-08-25 운영 실측 — 3번 시도해야 앱이 열렸다). 서버는 이제 ②로만 보낸다.
            //   https 분기는 반드시 same-origin 으로 좁힌다 — 경로만 보고 받으면 남의 도메인 링크로도
            //   code 교환이 트리거된다(로그인 CSRF). OS 가 AASA 로 한 번 거르지만 겹쳐서 막는다.
            const isNativeReturn =
              (u.pathname === '/oauth/native-return' && u.origin === window.location.origin) ||
              (u.protocol === 'planq:' && `${u.hostname}${u.pathname}`.replace(/\/+$/, '') === 'oauth/native-return');

            // ── 네이티브 Google 로그인 code 교환 (H-2) ──
            //   딥링크로 받은 일회용 code 를 앱 WebView 컨텍스트에서 세션으로 교환 → refresh cookie 심김
            //   → /inbox 리로드 시 AuthContext bootstrap 이 자동 로그인.
            if (isNativeReturn) {
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
              // ★ 2026-09-04 — 기존 회원의 구글 "연결 확인". 서버가 앱으로 먼저 돌려보내고
              //   확인 화면은 **앱 WebView 안에서** 연다(세션 쿠키가 앱에 심겨야 하므로).
              //   시스템 브라우저에서 확인시키면 쿠키가 거기 심겨 앱은 계속 로그인 화면에 머문다.
              const confirmToken = u.searchParams.get('confirm');
              if (confirmToken) {
                window.location.href = `/oauth/connect-confirm?token=${encodeURIComponent(confirmToken)}`;
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
  }, [deepLinkNav]);

  return null;
}
