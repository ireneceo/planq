import styled, { css } from 'styled-components';

/**
 * 멀티 컬럼(패널) 페이지 공통 레이아웃 — Q Talk / Q Mail / Q Note / Q Task 통일 (단일 진실 원천).
 *
 * 각 페이지가 Layout/Panel/Sidebar 스타일을 따로 복제하지 않도록 박제.
 * 두 가지 컨테이너 전략을 제공하되, viewport 높이 수학(panelShellHeight)은 하나로 공유한다.
 *
 * - `PanelLayout`       : flex row 컨테이너 (Q Talk / Q Mail / Q Task)
 * - `PanelGridLayout`   : grid 컨테이너 + 1열(사이드바) 접힘 애니메이션 (Q Note)
 * - `Panel`             : 패널 컬럼 (고정폭 또는 flex). $relative 로 position:relative 옵션
 * - `CollapsibleSidebar`: 접히는 사이드바 (데스크탑 translateX 슬라이드 + 태블릿/모바일 absolute 오버레이 드로어)
 * - `SidebarBackdrop`   : 오버레이 드로어 뒤 dim 백드롭 (태블릿/모바일)
 *
 * 패널 헤더는 공통 `PanelHeader`(60px) 사용 → 좌우 border-bottom 수평 연결.
 */

/**
 * 공통 viewport 높이 — 멀티컬럼 페이지 전부 동일.
 *  - 데스크탑: var(--vvh)(ChatPanel JS sync) → 100dvh → 100vh 3중 fallback (모바일 키보드/iOS PWA 대응)
 *  - 태블릿/모바일(≤1024px): MainLayout 의 fixed MobileHeader(56px) 만큼 빼서 하단 잘림 방지
 *
 * 이 fragment 를 단일 원천으로 두어, 페이지마다 제각각이던 height 규칙(일부는 dvh/vvh 누락,
 * 일부는 56px 보정 누락)을 근절한다.
 */
// 운영 #34 — 멀티컬럼 페이지는 viewport(var(--vvh)) 대신 부모(MainLayout 의 PageScroll) 100% 를 채운다.
// 옛 코드는 viewport 높이를 직접 잡아, 위에 결제 안내 배너(WorkspaceBillingBanner)가 뜨면
// 배너 높이만큼 화면을 넘쳐 레이아웃이 위아래로 튀고 채팅 입력란이 뷰포트 밖으로 밀려났다.
// MainLayout 이 LayoutContainer(var(--vvh)) → MainContent(flex:1) → PageScroll(flex:1, 배너 제외) 로
// 정확한 가용 높이를 내려주므로 여기선 100% 만 채우면 됨. iOS 키보드 --vvh sync 도 상위에서 전파됨.
// 모바일 헤더(56px) 보정도 MainLayout(padding-top:56px)에서 처리하므로 -56px 불필요.
export const panelShellHeight = css`
  height: 100%;
  min-height: 0;
`;

export const PanelLayout = styled.div<{ $embedded?: boolean }>`
  display: flex;
  /* 경계선 핸들(PanelEdgeHandle)이 이 컨테이너 기준으로 absolute 배치된다.
     relative 가 없으면 핸들이 엉뚱한 조상 기준으로 잡혀 옆 패널 뒤로 숨거나 잘렸다
     (Q Mail 만 PanelGridLayout=relative 라 정상이었고 나머지 페이지가 전부 깨져 있었다). */
  position: relative;
  /* N+93 — embedded(팝아웃/분리 창): MainLayout 헤더가 없으므로 viewport 수학(-56px) 대신 부모 100% 채움.
     팝아웃 좁은 폭이 ≤1024 분기를 타 56px 여백이 생기던 회귀 차단. */
  ${(p) => (p.$embedded ? css`height: 100%; min-height: 0;` : panelShellHeight)}
  background: #F8FAFC;
  overflow: hidden;
  min-height: 0;
`;

/**
 * PanelGridLayout — grid 컨테이너. 1열(사이드바) 접힘을 grid-template-columns 트랜지션으로 부드럽게.
 *  $cols : grid-template-columns 값 (예: 접힘 '0px 1fr' / 펼침 '300px 1fr')
 *
 * 태블릿/모바일(≤1024px)은 display:block 으로 전환 → 사이드바는 CollapsibleSidebar 가
 * absolute 오버레이로 빠지고, 본문 패널([data-panel-main])이 전체 높이를 채운다
 * (block 모드에서 height:100% 누락 시 본문 붕괴 → 1024px 동일 breakpoint 로 보정).
 */
export const PanelGridLayout = styled.div<{ $cols?: string }>`
  display: grid;
  grid-template-columns: ${(p) => p.$cols || '300px 1fr'};
  ${panelShellHeight}
  background: #FFFFFF;
  overflow: hidden;
  min-height: 0;
  position: relative;
  transition: grid-template-columns 200ms ease;
  @media (max-width: 1024px) {
    display: block;
    & > [data-panel-main] {
      height: 100%;
    }
  }
`;

/**
 * Panel — 패널 컬럼.
 *  $width    : 고정폭(px). 미지정 + $grow 시 flex:1 (본문 패널)
 *  $grow     : true 면 남은 공간 채움 (본문 패널, flex:1)
 *  $last     : 마지막 패널 (border-right 제거)
 *  $relative : position:relative (엣지 토글 바 등 absolute 자식 anchor)
 *  $hideTablet / $hideMobile : 반응형 숨김
 */
export const Panel = styled.div<{
  $width?: number;
  $grow?: boolean;
  $last?: boolean;
  $relative?: boolean;
  $hideTablet?: boolean;
  $hideMobile?: boolean;
}>`
  ${(p) => (p.$grow ? 'flex: 1; min-width: 0;' : `width: ${p.$width || 300}px; flex-shrink: 0;`)}
  background: #FFFFFF;
  ${(p) => (p.$last ? '' : 'border-right: 1px solid #E2E8F0;')}
  ${(p) => (p.$relative ? 'position: relative;' : '')}
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  ${(p) => (p.$hideTablet ? '@media (max-width: 1024px) { display: none; }' : '')}
  ${(p) => (p.$hideMobile ? '@media (max-width: 640px) { display: none; }' : '')}
`;

/**
 * CollapsibleSidebar — 접히는 사이드바 (세션/대화 리스트 등).
 *  $collapsed : true 면 접힘 (데스크탑 translateX -100% + visibility hidden)
 *
 * - 데스크탑: PanelGridLayout 의 grid 1열 폭(0px↔300px) 트랜지션과 함께 슬라이드
 * - 태블릿/모바일(≤1024px): absolute 오버레이 드로어 (좌측 고정, 그림자, z-index 30)
 *    → 펼침 시 SidebarBackdrop 와 함께 노출
 */
export const CollapsibleSidebar = styled.aside<{ $collapsed?: boolean }>`
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(${(p) => (p.$collapsed ? '-100%' : '0')});
  transition: transform 200ms ease;
  visibility: ${(p) => (p.$collapsed ? 'hidden' : 'visible')};
  @media (max-width: 1024px) {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 300px;
    max-width: 85vw;
    z-index: 30;
    box-shadow: 4px 0 16px rgba(15, 23, 42, 0.12);
  }
`;

/**
 * SidebarBackdrop — CollapsibleSidebar 오버레이 드로어 뒤 dim 백드롭 (태블릿/모바일 전용).
 * 데스크탑에선 숨김. 클릭 시 사이드바 닫기 핸들러를 부모가 연결.
 */
export const SidebarBackdrop = styled.div`
  display: none;
  @media (max-width: 1024px) {
    display: block;
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.35);
    z-index: 25;
  }
`;
