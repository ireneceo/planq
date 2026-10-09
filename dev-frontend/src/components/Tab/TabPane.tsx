// components/Tab/TabPane.tsx — ⑥ 탭 pane (keep-alive)
//
// alive 탭 전부 동시 렌더, 비활성은 display:none + inert(언마운트 안 함 = 상태·스크롤·열어둔 패널 보존).
// 각 pane = 형제 MemoryRouter(§3) — 페이지 내부 useNavigate/useParams 무수정 각 탭 바인딩, URL 격리.
import { Suspense, lazy, useLayoutEffect, useRef } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import styled from 'styled-components';
import { TabActiveProvider, TabIdProvider } from '../../contexts/TabActiveContext';
import { APP_ROUTES } from '../../routes/appRoutes';
// ★ 라우트 표의 `roles` 선언을 집행한다 — 여태 이 pane 은 역할을 **읽지 않았다**(2026-09-13 실측).
import RouteRoleGate from '../Common/RouteRoleGate';
import UrlMirror from './UrlMirror';
import type { Tab } from '../../stores/tabStore';

// ★ 탭 안에서도 열리는 공개 화면 — 서명 화면 하나뿐이다 (2026-10-09, Irene: «확인필요에 이 업무가 있는데 눌러도 서명문서 안나와»).
//   확인필요·받은 서명은 우리 쪽 서명자를 `/sign/:token` 으로 보낸다. 웹은 새 브라우저 탭으로 가서 멀쩡했지만,
//   **앱(아이패드 = 탭 모드)** 은 nativeLinks 가 그 새 창을 앱 안 새 탭으로 돌리고, 이 pane 표에는 `/sign` 이 없어
//   **주소만 바뀌고 빈 탭**이 됐다(대시보드 «확인 필요 미리보기» 의 navigate 도 같은 빈 탭).
//   appRoutes 에 넣지 않는 이유: 그 표는 App.tsx 의 MainLayout(로그인 필요) 라우트와 1:1 이어야 한다(guard-app-routes) —
//   서명 화면은 로그인 없는 외부 고객도 쓰는 공개 화면이라 App.tsx 에서는 MainLayout 밖에 그대로 둔다.
const PublicSignPage = lazy(() => import('../../pages/QDocs/PublicSignPage'));

export default function TabPane({ tab, active }: { tab: Tab; active: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  // 비활성→활성 시 스크롤 복원(display:none 이 scrollTop 리셋하는 브라우저 편차 무력화).
  //   useLayoutEffect 즉시(운영#12 — RAF 지연 금지). 활성 중엔 onScroll 이 계속 savedScroll 갱신.
  useLayoutEffect(() => {
    if (active && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
  }, [active]);
  // 운영 #397 — **같은 탭 안에서 화면이 바뀌면** 위에서부터 열려야 한다.
  //   위 복원은 "탭 전환" 용이다. 경로가 바뀌는 것은 다른 화면으로 가는 것이므로 복원 대상이 아니다.
  //   (탭 전환 복원과 섞으면 새 화면이 앞 화면 스크롤 위치에서 열린다 — 사용자에겐 "잘못 열린다".)
  useLayoutEffect(() => {
    savedScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab.path]);

  return (
    <PaneWrap $active={active} data-pane-tab={tab.id} aria-hidden={!active} {...(active ? {} : { inert: '' as unknown as boolean })}>
      <TabActiveProvider value={active}>
       <TabIdProvider value={tab.id}>
        <MemoryRouter initialEntries={[tab.path]}>
          <UrlMirror tabId={tab.id} active={active} />
          <PaneScroll ref={scrollRef} data-pq-content="1" onScroll={(e) => { if (active) savedScroll.current = e.currentTarget.scrollTop; }}>
            <Suspense fallback={<Fallback />}>
              <Routes>
                {APP_ROUTES.map((r) => (
                  <Route key={r.path} path={r.path}
                    element={<RouteRoleGate roles={r.roles}>{r.element}</RouteRoleGate>} />
                ))}
                <Route path="/sign/:token" element={<PublicSignPage />} />
                <Route path="*" element={<Fallback />} />
              </Routes>
            </Suspense>
          </PaneScroll>
        </MemoryRouter>
       </TabIdProvider>
      </TabActiveProvider>
    </PaneWrap>
  );
}

const PaneWrap = styled.div<{ $active: boolean }>`
  display: ${(p) => (p.$active ? 'flex' : 'none')};
  flex-direction: column; flex: 1; min-height: 0; height: 100%; min-width: 0;
`;
const PaneScroll = styled.div`
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;
`;
const Fallback = styled.div`flex: 1;`;
