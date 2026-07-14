/**
 * PanelEdgeHandle — 패널 경계선 중앙의 접기/펼치기 화살표 핸들 (PlanQ 표준).
 *
 * Q Talk(LeftPanel/RightPanel) · Q Mail · Q Note · Q docs · Q Task 가 공유한다.
 *
 * - 하나의 핸들이 접기/펼치기 겸용 (chevron 방향이 상태에 따라 뒤집힘)
 * - PanelGridLayout(position: relative) 의 직계 자식으로 두고, 경계선 x 위치를 offset 으로 넘긴다
 *   → 패널 자체(overflow: hidden)에 넣으면 핸들이 잘리므로 컨테이너에 붙인다
 * - 컨테이너 가장자리(offset 0)에서는 핸들이 밖으로 삐져나가지 않도록 자동 보정
 *
 * 시각은 `panelHandleStyle.ts` 단일 정의 — 단색 · 그라데이션 없음 · 그림자 없음.
 * FloatingPanelToggle(좁은 폭에서 뷰포트 가장자리에 붙는 같은 물건)과 픽셀 단위로 같다.
 *
 * ── 숨김 경계 (side 마다 다르다. 임의로 통일하지 말 것) ──
 *   side='right' → ≤1200px 숨김.
 *     그 폭부터 우측 패널은 **오버레이 드로어**가 되고 FloatingPanelToggle 이 여는 역할을 넘겨받는다.
 *     여기서 안 숨기면, 붙을 그리드 경계가 사라진 핸들이 화면에 **혼자 떠 있고** 플로팅 바와 둘이 겹친다.
 *   side='left'  → ≤1024px 숨김.
 *     좌측 리스트에는 플로팅 대응물이 없다. 1025~1200px 에서도 리스트 접기는 살아 있어야 한다.
 */
import React from 'react';
import styled from 'styled-components';
import { panelHandleBar, panelHandleChevron, HANDLE_W } from './panelHandleStyle';

interface Props {
  /** 'left'  = 좌측 리스트 토글 (핸들이 컨테이너 왼쪽 기준으로 배치)
   *  'right' = 우측 패널 토글 (핸들이 컨테이너 오른쪽 기준으로 배치) */
  side: 'left' | 'right';
  collapsed: boolean;
  onToggle: () => void;
  /** 경계선 위치(px). 좌측이면 사이드바 폭, 우측이면 패널 폭. 접힘 시 0 을 넘기면 가장자리에 붙는다. */
  offset: number;
  labelCollapse: string;
  labelExpand: string;
}

const PanelEdgeHandle: React.FC<Props> = ({
  side, collapsed, onToggle, offset, labelCollapse, labelExpand,
}) => {
  const label = collapsed ? labelExpand : labelCollapse;
  // chevron 방향 — 눌렀을 때 패널이 움직일 방향을 가리킨다
  const points = side === 'left'
    ? (collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6')
    : (collapsed ? '15 18 9 12 15 6' : '9 18 15 12 9 6');

  return (
    <Handle
      type="button"
      onClick={onToggle}
      $side={side}
      $pos={Math.max(0, offset - HANDLE_W / 2)}
      aria-label={label}
      title={label}
    >
      <Chevron>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={points} />
        </svg>
      </Chevron>
    </Handle>
  );
};

export default PanelEdgeHandle;

const Handle = styled.button<{ $side: 'left' | 'right'; $pos: number }>`
  ${panelHandleBar}
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${(p) => (p.$side === 'left' ? `left: ${p.$pos}px;` : `right: ${p.$pos}px;`)}
  border-radius: 6px;
  z-index: 10;
  transition: width 0.15s ease, background 0.15s ease, left 200ms ease, right 200ms ease;

  /* 좁은 폭에서의 숨김 경계는 side 마다 다르다 — 파일 상단 주석 참조 */
  @media (max-width: ${(p) => (p.$side === 'right' ? 1024 : 1024)}px) {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Chevron = styled.span`
  ${panelHandleChevron}
  ${Handle}:hover & { color: #FFFFFF; }
`;
