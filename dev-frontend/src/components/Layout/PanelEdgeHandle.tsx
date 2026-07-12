/**
 * PanelEdgeHandle — 패널 경계선 중앙의 접기/펼치기 화살표 핸들 (PlanQ 표준).
 *
 * Q Talk(LeftPanel/RightPanel) · Q docs(PostsPage) · Q Task 가 각자 같은 스타일을 복제해 왔다.
 * 신규 화면은 이 공통 컴포넌트를 쓴다 (UI 통일 + 드리프트 차단). 기존 3곳은 점진 이관.
 *
 * - 하나의 핸들이 접기/펼치기 겸용 (chevron 방향이 상태에 따라 뒤집힘)
 * - PanelGridLayout(position: relative) 의 직계 자식으로 두고, 경계선 x 위치를 offset 으로 넘긴다
 *   → 패널 자체(overflow: hidden)에 넣으면 핸들이 잘리므로 컨테이너에 붙인다
 * - 컨테이너 가장자리(offset 0)에서는 핸들이 밖으로 삐져나가지 않도록 자동 보정
 * - 태블릿 이하(≤1024px)는 숨김 — 그 폭에서는 사이드바가 오버레이 드로어로 동작한다
 */
import React from 'react';
import styled from 'styled-components';

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

const HANDLE_W = 12;

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
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${(p) => (p.$side === 'left' ? `left: ${p.$pos}px;` : `right: ${p.$pos}px;`)}
  width: ${HANDLE_W}px;
  height: 72px;
  padding: 0;
  border: none;
  background: linear-gradient(180deg, #94A3B8 0%, #64748B 100%);
  border-radius: 6px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.4) inset;
  transition: width 0.2s ease, height 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, left 200ms ease, right 200ms ease;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 히트 영역 확장 (얇은 바를 손가락·마우스로 쉽게 잡도록) */
  &::before {
    content: '';
    position: absolute;
    top: -10px; bottom: -10px; left: -12px; right: -12px;
  }
  &:hover {
    width: 18px;
    height: 84px;
    background: linear-gradient(180deg, #14B8A6 0%, #0F766E 100%);
    box-shadow: 0 4px 12px rgba(20, 184, 166, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.6) inset;
  }
  &:hover svg { animation: chevronNudgeEdge 0.7s ease infinite; }
  &:active { transform: translateY(-50%) scale(0.95); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 3px; }
  @keyframes chevronNudgeEdge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &:hover { width: ${HANDLE_W}px; height: 72px; }
    &:hover svg { animation: none; }
    &:active { transform: translateY(-50%); }
  }
  @media (max-width: 1024px) { display: none; }
`;

const Chevron = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  svg { width: 14px; height: 14px; }
`;
