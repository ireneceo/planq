// 데스크탑 앱(Electron) 다리 — 앱 쪽(main 프로세스)에서 오는 두 신호를 화면에 잇는다 (docs/DESKTOP_APP_DESIGN.md).
//   ① planq://oauth/native-return?… 로 앱이 깨어남(구글·애플 로그인·연동 복귀) → services/nativeReturn 한 곳(폰 앱과 같은 함수)
//   ② OS 알림을 눌렀다 → 알림 링크로 이동(utils/notificationLink 한 곳)
//   ④ 점프 목록·맥 메뉴 «Q task·Q talk·Q note 열기»(2단계 E) → 도구 열기 단일 진입점 launchDockTool(같은 pq-* 창 재사용)
//   ⑤ 브라우저 «데스크탑 앱에서 열기»(planq://open) → 같은 계정이면 planq:navigate(워크스페이스 전환 포함) · 다르면 이동 안 하고 까닭 띠
//      + 이 껍데기가 그 링크를 받을 수 있으면(capabilities.openLinks) 로그인한 세션에 표시(서버 open_links)
//   ③ 브라우저에 갔다가 앱 창으로 돌아옴 → 연동 «연결 중» 표시를 정리하라는 신호(폰 앱의 browserFinished 자리)
// 웹·PWA·폰 앱에서는 아무것도 하지 않는다. App 루트와 탭 셸(ChromeOverlays) 두 곳에 놓이므로 리스너는 한 번만 붙인다.
import { useEffect } from 'react';
import { useAuth, apiFetch } from '../contexts/AuthContext';
import { desktopBridge } from '../services/native';
import { launchDockTool } from './Common/RightDock';

let bound = 0;
let unbind: (() => void) | null = null;

let markedFor: string | null = null;
// 지금 로그인한 사람 — 두 자리(App 루트·탭 셸)에 놓여도 리스너는 하나라 모듈 값으로 든다
let currentUid: string | null = null;

export default function DesktopBridge(): null {
  const { user } = useAuth();
  const uid = user ? String(user.id) : null;
  currentUid = uid;

  // 껍데기가 planq://open 을 받을 수 있으면 지금 세션에 표시 — 브라우저가 띠를 보일지 이것으로 안다(사람·껍데기마다 한 번)
  useEffect(() => {
    const d = desktopBridge();
    if (!d || !d.capabilities?.openLinks || !uid || markedFor === uid) return;
    markedFor = uid;
    // 토큰 회전과 겹치면(rotated) 옛 행이라 서버가 안 찍는다 — 회전이 끝난 뒤 한 번 더(Fable 완료 검증 비차단 2)
    const mark = async (retry: boolean): Promise<void> => {
      const r = await apiFetch('/api/auth/desktop-open-links', { method: 'POST' });
      const j = await r.json().catch(() => null) as { data?: { marked?: boolean; reason?: string } } | null;
      if (retry && j?.data?.marked === false && j.data.reason === 'rotated') {
        window.setTimeout(() => { if (markedFor === uid) void mark(false).catch(() => { /* 다음 실행 때 */ }); }, 20000);
      }
    };
    void mark(true).catch(() => { markedFor = null; });
  }, [uid]);

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
      const offAction = d.onAction ? d.onAction((tool) => { launchDockTool(tool); }) : () => {};
      const offOpen = d.onOpenLink ? d.onOpenLink(({ path, u }) => {
        if (u != null && currentUid && currentUid !== String(u)) {
          window.dispatchEvent(new CustomEvent('planq:desktop-open-other-account'));
          return;
        }
        window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path } }));
      }) : () => {};
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
        offLink(); offClick(); offAction(); offOpen();
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
