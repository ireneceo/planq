// 네이티브 브리지 — 딥링크(Universal Link/App Link) + 알림 탭 → SPA 네비게이션 (MOBILE_APP_DESIGN §5.4·§7.2).
// null 렌더. App 내부(Router 하위)에 1개 mount 하여 useNavigate 사용.
//
// 이벤트 규약(웹/네이티브 공용):
//   window 'planq:navigate' { detail: { path } }      → SPA 라우팅 (알림 탭·딥링크)
//   window 'planq:oauth-connected'                     → 연동 페이지가 상태 refetch (§6.8 시스템 브라우저 복귀)
//
// 웹에서는 native 리스너를 달지 않으므로 회귀 0 (planq:navigate 리스너만, 웹에선 아무도 발행 안 함).
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { foreignWorkspaceOf, enterWorkspaceLink, splitWorkspaceParam } from '../utils/workspaceLink';
import { useChromeNav } from '../hooks/useChromeNav';
import { isNativeApp } from '../services/native';
import { bindNativeShare } from '../services/nativeShare';
import { handleNativeReturnUrl } from '../services/nativeReturn';
import { markDeepLinkInflight, markDeepLinkArrived } from '../services/nativePush';
import { installNativeLinkRouting } from '../services/nativeLinks';

// 딥링크가 착지하기를 기다리는 시간 — 400ms × 6 = 2.4초.
//   실측(2026-09-14, 모바일 뷰포트)상 웹에서는 한 번에 착지하므로, 기다림이 도는 것은
//   라우터가 아직 없는 **앱 콜드 스타트**뿐이다(그때는 tabStore 가 보류분을 들고 있다).
const DEEP_LINK_RETRY_MS = 400;
const DEEP_LINK_SPA_TRIES = 6;

export default function NativeBridge() {
  const chromeNav = useChromeNav();
  const { user, switchWorkspace } = useAuth();
  // 리스너는 한 번 붙는다 — 판정은 늘 지금 값으로(ref)
  const userRef = useRef(user);
  userRef.current = user;
  const switchRef = useRef(switchWorkspace);
  switchRef.current = switchWorkspace;

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
  const deepLinkNav = useCallback((rawPath: string) => {
    // 워크스페이스가 실린 알림 링크(?ws=) — 다른 워크스페이스면 전환하고 그 주소로 한 번 다시 연다(utils/workspaceLink).
    //   같은 워크스페이스·멤버 아님이면 ws 만 떼고 아래 SPA 이동을 그대로 한다(목적지 비교도 뗀 경로로).
    const u = userRef.current;
    if (foreignWorkspaceOf(rawPath, u)) {
      markDeepLinkArrived(rawPath);                       // 보관값 소비 — 다시 로드된 창이 또 이동하지 않게
      void enterWorkspaceLink(rawPath, u, switchRef.current).then((reloading) => {
        if (!reloading) deepLinkNav(splitWorkspaceParam(rawPath).clean);
      });
      return;
    }
    const path = splitWorkspaceParam(rawPath).clean;
    const here = () => window.location.pathname + window.location.search;
    // 이미 그 자리 — 그래도 보관값은 지운다. 안 그러면 루트(/)가 나중에 지난 알림 자리로 끌려간다(Fable 2026-09-27 재현).
    if (path === here()) { markDeepLinkArrived(path); return; }
    markDeepLinkInflight(path);                        // 루트 리다이렉트가 /inbox 대신 여기로 가게(#431)

    // ★ 판정은 "주소가 **바뀌었나**" 가 아니라 "**목적지에 있나**" 여야 한다.
    //   아이폰 앱은 루트(/)로 뜨고 그 경로는 인증 사용자를 /inbox 로 **스스로 보낸다**
    //   (App.tsx NativeMarketingRedirect). "바뀌었나" 로 재면 그 리다이렉트를 이동 성공으로
    //   오인해 폴백이 영영 안 터진다 — 고치려던 바로 그 화면(확인필요)에 남는다.
    //
    // ★ 2026-09-14 — **문서 전체 로드를 서둘러 걸지 않는다.**
    //   Irene: *"모바일에서 알림이오면 눌러서 갈 수가 없어 커넥션 문제라고 나와 모든 알림 다."*
    //   콜드 스타트(알림 탭의 대부분)에서는 `tabStore.navigateActive` 가 미러 모드인데
    //   `navigateDelegate` 가 아직 없어 **조용히 아무 일도 안 한다**(tabStore.ts 의 mirror 분기).
    //   그래서 옛 코드는 400ms 뒤 `location.assign` 을 **매번** 걸었다 — 앱이 아직 뜨는 중에
    //   메인 프레임을 다시 로드하는 셈이고, 그 로드가 한 번 실패하면 Capacitor 가
    //   `errorPath`(번들 안 오프라인 화면)로 떨어뜨린다. 그 화면은 로컬 파일이라 거기서 못 나온다.
    //   → 라우터가 준비될 때까지 **SPA 이동만 되풀이**하고(문서 로드 0회), 그래도 못 가면
    //     **딱 한 번** 절대 URL 로 착지시킨다.
    //   SPA 이동은 **한 번만** 부른다 — tabStore 가 통로(navigateDelegate)가 붙을 때까지
    //   들고 있다가 스스로 보낸다. 되풀이해 부르면 통로 없는 창에서 `newTab` 폴백이
    //   매번 새 탭을 만든다(newTab 은 같은 경로를 합치지 않는다).
    try { chromeNav(path); } catch { /* 아래 폴백이 받는다 */ }
    let waited = 0;
    const tick = () => {
      if (here() === path) { markDeepLinkArrived(path); return; }   // 도착 — 끝
      if (waited < DEEP_LINK_RETRY_MS * DEEP_LINK_SPA_TRIES) {
        waited += DEEP_LINK_RETRY_MS;
        window.setTimeout(tick, DEEP_LINK_RETRY_MS);
        return;
      }
      // 마지막 수단 — **절대 URL** 로. 상대경로로 걸면 앱이 이미 오프라인 폴백(로컬 스킴)에
      //   있을 때 자기 자신으로 돌아 영영 못 빠져나온다.
      try {
        window.location.assign(new URL(path, window.location.origin).href);
      } catch {
        window.location.assign(path);
      }
    };
    tick();
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
    // 앱 안의 «새 창» 링크(window.open · target=_blank)를 앱 안으로 — 사파리로 튀지 않게(services/nativeLinks)
    const uninstallLinks = isNativeApp() ? installNativeLinkRouting() : null;

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

            // OAuth 복귀(planq://oauth/native-return · 같은 출처 https)는 services/nativeReturn 한 곳이 처리한다 —
            //   iOS 로그인 창(ASWebAuthenticationSession)이 돌려준 주소도 같은 함수를 탄다.
            if (await handleNativeReturnUrl(u)) return;

            // ★ 2026-10-09 — 다른 서버의 링크는 앱 안에서 열지 않는다. 아래는 **경로만** 꺼내 이 앱의 서버로
            //   이동하므로, 운영 앱이 dev.planq.kr 링크를 받으면 운영 데이터의 같은 경로(/tasks?task=123 …)를
            //   보여 준다 — 다른 서버의 다른 업무다. 앱이 받는 도메인은 빌드마다 server.url 하나로 좁혔지만
            //   (scripts/cap-link-domains.js) 이미 깔린 옛 빌드는 두 도메인을 다 받으므로 여기서도 막는다.
            if (u.protocol === 'https:' && u.origin !== window.location.origin) {
              Browser.open({ url: u.href }).catch(() => {});
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
          // #434 — 다른 앱의 «공유» 로 들어온 파일 → 웹 공유와 같은 /share-receive 화면(services/nativeShare)
          const unbindShare = await bindNativeShare((path) => deepLinkNav(path));
          cleanupNative = () => { urlHandle.remove(); backHandle.remove(); browserHandle.remove(); unbindShare(); };
        } catch { /* 플러그인 미가용 — 무시 */ }
      })();
    }

    return () => {
      window.removeEventListener('planq:navigate', onNavigate);
      if (uninstallLinks) uninstallLinks();
      if (cleanupNative) cleanupNative();
    };
  }, [deepLinkNav]);

  return null;
}
