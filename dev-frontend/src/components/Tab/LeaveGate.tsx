// components/Tab/LeaveGate.tsx — 화면 안 이동(useNavigate·<Link>·<Navigate>)도 녹음 보호를 지나게 한다 (2026-11-19 · Fable 설계)
//
//   메뉴 이동은 tabStore 를 지나지만 화면 안 이동은 라우터를 직접 민다(Q note 요약 «보기» → /docs, 프로젝트 상세의 대화·업무 링크 등).
//   이 앱은 data router 가 아니라 useBlocker 를 못 쓴다 → 라우터의 navigator 를 감싸 그 아래에 다시 공급한다.
//   - 이 라우터(탭 pane 하나 / 미러 모드 창 하나)에서 녹음이 돌고, 목적지가 **다른 화면**(identity)이면:
//       탭 모드 = 녹음 탭은 그대로 두고 새 탭으로 연다(묻지 않음) / 미러 모드 = 묻는다(services/recordingGuard)
//   - go(n)(뒤로·앞으로)은 목적지를 모른다 → 묻는다.
//   - 같은 화면 안 이동은 통과 — 그 화면(QNotePage guardRecording)이 스스로 지킨다.
//   자리: TabPane 의 MemoryRouter 바로 아래 · 미러 모드 BrowserRouter 바로 아래(TabMirror 의 navigateDelegate 도 여기를 지난다).
import React, { useContext, useMemo, useRef } from 'react';
import { UNSAFE_NavigationContext, useLocation } from 'react-router-dom';
import type { Navigator, To } from 'react-router-dom';
import { useTabId } from '../../contexts/TabActiveContext';
import { tabStore, identityOfPath } from '../../stores/tabStore';
import { tabIsRecording, requestLeave, noteDiverted } from '../../services/recordingGuard';

function toPath(to: To, here: { pathname: string; search: string }): string {
  if (typeof to === 'string') return to;
  return (to.pathname ?? here.pathname) + (to.search ?? '') + (to.hash ?? '');
}

export default function LeaveGate({ children }: { children: React.ReactNode }) {
  const ctx = useContext(UNSAFE_NavigationContext);
  const tabId = useTabId();
  const loc = useLocation();
  const locRef = useRef(loc);
  locRef.current = loc;

  const value = useMemo(() => {
    const nav = ctx.navigator;
    const guard = (to: To, proceed: () => void) => {
      if (!tabIsRecording(tabId)) { proceed(); return; }
      const here = locRef.current;
      const target = toPath(to, here);
      if (identityOfPath(target) === identityOfPath(here.pathname + here.search)) { proceed(); return; }
      if (tabId) {
        // 탭 모드 — 녹음 탭을 살린다. 이동은 새 탭(같은 화면 탭이 이미 있으면 그 탭)으로
        noteDiverted(tabId);
        tabStore.openInNewTab(target);
        return;
      }
      requestLeave('navigate', proceed, null);
    };
    const wrapped: Navigator = {
      ...nav,
      createHref: (to) => nav.createHref(to),
      encodeLocation: nav.encodeLocation ? (to) => nav.encodeLocation!(to) : undefined,
      push: (to, state, opts) => guard(to, () => nav.push(to, state, opts)),
      replace: (to, state, opts) => guard(to, () => nav.replace(to, state, opts)),
      go: (n) => {
        if (!tabIsRecording(tabId)) { nav.go(n); return; }
        requestLeave('navigate', () => nav.go(n), tabId);
      },
    };
    return { ...ctx, navigator: wrapped };
  }, [ctx, tabId]);

  return <UNSAFE_NavigationContext.Provider value={value}>{children}</UNSAFE_NavigationContext.Provider>;
}
