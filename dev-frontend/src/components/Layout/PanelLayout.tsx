import styled from 'styled-components';

/**
 * 멀티 컬럼(패널) 페이지 공통 레이아웃 — Q Talk / Q Mail / Q Note / Q Task 통일.
 *
 * 각 페이지가 Layout/Panel 스타일을 따로 복제하지 않도록 단일 컴포넌트로 박제.
 * - `PanelLayout`  : full-bleed flex row 컨테이너 (PageShell·카드 없이 MainContent 를 꽉 채움)
 * - `Panel`        : 패널 컬럼 (흰색 · border-right · flex column). 고정폭(좌측 리스트) 또는 flex(본문)
 * - 패널 헤더는 공통 `PanelHeader`(60px) 사용 → 좌우 border-bottom 수평 연결
 *
 * height 는 Q Talk 패턴 3중 fallback: var(--vvh)(ChatPanel JS sync) → 100dvh → 100vh.
 */
export const PanelLayout = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  background: #F8FAFC;
  overflow: hidden;
  min-height: 0;
  @media (max-width: 1024px) {
    height: calc(100vh - 56px);
    height: calc(100dvh - 56px);
    height: calc(var(--vvh, 100dvh) - 56px);
  }
`;

/**
 * Panel — 패널 컬럼.
 *  $width    : 고정폭(px). 미지정 + $grow 시 flex:1 (본문 패널)
 *  $grow     : true 면 남은 공간 채움 (본문 패널, flex:1)
 *  $last     : 마지막 패널 (border-right 제거)
 *  $hideTablet / $hideMobile : 반응형 숨김
 */
export const Panel = styled.div<{
  $width?: number;
  $grow?: boolean;
  $last?: boolean;
  $hideTablet?: boolean;
  $hideMobile?: boolean;
}>`
  ${(p) => (p.$grow ? 'flex: 1; min-width: 0;' : `width: ${p.$width || 300}px; flex-shrink: 0;`)}
  background: #FFFFFF;
  ${(p) => (p.$last ? '' : 'border-right: 1px solid #E2E8F0;')}
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  ${(p) => (p.$hideTablet ? '@media (max-width: 1024px) { display: none; }' : '')}
  ${(p) => (p.$hideMobile ? '@media (max-width: 640px) { display: none; }' : '')}
`;
