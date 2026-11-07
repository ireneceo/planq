// 데스크탑 앱(Electron) 다리 — 앱 쪽(main 프로세스)에서 오는 두 신호를 화면에 잇는다 (docs/DESKTOP_APP_DESIGN.md).
//   ① planq://oauth/native-return?… 로 앱이 깨어남(구글·애플 로그인·연동 복귀) → services/nativeReturn 한 곳(폰 앱과 같은 함수)
//   ② OS 알림을 눌렀다 → 알림 링크로 이동(utils/notificationLink 한 곳)
//   ③ 브라우저에 갔다가 앱 창으로 돌아옴 → 연동 «연결 중» 표시를 정리하라는 신호(폰 앱의 browserFinished 자리)
// 웹·PWA·폰 앱에서는 아무것도 하지 않는다. App 루트와 탭 셸(ChromeOverlays) 두 곳에 놓이므로 리스너는 한 번만 붙인다.
import { useEffect } from 'react';
import { desktopBridge } from '../services/native';

let bound = 0;
let unbind: (() => void) | null = null;

export default function DesktopBridge(): null {
  useEffect(() => {
    const d = desktopBridge();
    if (!d) return;
    bound += 1;
    if (bound === 1) {
      const offLink = d.onDeepLink((raw) => {
        void (async () => {
          let u: URL;
          try { u = new URL(raw); } catch { return; }
          const { handleNativeReturnUrl } = await import('../services/nativeReturn');
          await handleNativeReturnUrl(u);
        })();
      });
      const offClick = d.onNotificationClick((link) => {
        if (!link) return;
        void (async () => {
          // 다른 워크스페이스 알림(?ws=) — 전환을 거쳐 연다. NativeBridge 의 planq:navigate 가 그 판정(foreignWorkspaceOf)을 갖고 있다.
          const { splitWorkspaceParam } = await import('../utils/workspaceLink');
          if (splitWorkspaceParam(link).ws) {
            window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path: link } }));
            return;
          }
          const { openNotificationTarget } = await import('../utils/notificationLink');
          openNotificationTarget(link);
        })();
      });
      // 시스템 브라우저에서 돌아온 순간 — 연동 화면의 «연결 중» 이 영영 남지 않게(완료는 planq:oauth-connected 가 따로 온다)
      let awayAt = 0;
      const onBlur = () => { awayAt = Date.now(); };
      const onFocus = () => {
        if (awayAt && Date.now() - awayAt > 1500) window.dispatchEvent(new CustomEvent('planq:oauth-dismissed'));
        awayAt = 0;
      };
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
      unbind = () => {
        offLink(); offClick();
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onFocus);
      };
    }
    return () => {
      bound -= 1;
      if (bound === 0 && unbind) { unbind(); unbind = null; }
    };
  }, []);
  return null;
}
