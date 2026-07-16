// components/Tab/TabPane.tsx — ⑥ 탭 pane (keep-alive)
//
// alive 탭 전부 동시 렌더, 비활성은 display:none + inert(언마운트 안 함 = 상태·스크롤·열어둔 패널 보존).
// 각 pane = 형제 MemoryRouter(§3) — 페이지 내부 useNavigate/useParams 무수정 각 탭 바인딩, URL 격리.
import { Suspense, useLayoutEffect, useRef } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import styled from 'styled-components';
import { TabActiveProvider } from '../../contexts/TabActiveContext';
import { APP_ROUTES } from '../../routes/appRoutes';
import UrlMirror from './UrlMirror';
import type { Tab } from '../../stores/tabStore';

export default function TabPane({ tab, active }: { tab: Tab; active: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  // 비활성→활성 시 스크롤 복원(display:none 이 scrollTop 리셋하는 브라우저 편차 무력화).
  //   useLayoutEffect 즉시(운영#12 — RAF 지연 금지). 활성 중엔 onScroll 이 계속 savedScroll 갱신.
  useLayoutEffect(() => {
    if (active && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
  }, [active]);

  return (
    <PaneWrap $active={active} aria-hidden={!active} {...(active ? {} : { inert: '' as unknown as boolean })}>
      <TabActiveProvider value={active}>
        <MemoryRouter initialEntries={[tab.path]}>
          <UrlMirror tabId={tab.id} active={active} />
          <PaneScroll ref={scrollRef} onScroll={(e) => { if (active) savedScroll.current = e.currentTarget.scrollTop; }}>
            <Suspense fallback={<Fallback />}>
              <Routes>
                {APP_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
                <Route path="*" element={<Fallback />} />
              </Routes>
            </Suspense>
          </PaneScroll>
        </MemoryRouter>
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
