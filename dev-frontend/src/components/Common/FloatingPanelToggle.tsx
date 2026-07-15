/**
 * FloatingPanelToggle — 좌/우 패널 접기·펼치기 핸들 (PlanQ **단일 표준**).
 *
 * 뷰포트 변(왼쪽 또는 오른쪽)에 fixed 로 붙는 플로팅 화살표. 데스크탑·태블릿·모바일
 * **모든 폭에서 같은 디자인**을 쓴다(경계선 세로바 PanelEdgeHandle 은 폐기 — 화면마다 제각각이던 것 통일).
 *   - side='right' : 뷰포트 오른쪽 변 · 닫힘 화살표 ◁ / 열림 ▷
 *   - side='left'  : 뷰포트 왼쪽 변  · 닫힘 화살표 ▷ / 열림 ◁ (좌우 대칭)
 * 같은 핸들 하나가 열기/닫기 겸용.
 *
 * 열렸을 때 변으로부터의 거리 = `offsetOpen`.
 *   - 데스크탑 리사이즈 컬럼: 실제 패널 폭(`${width}px`) 을 넘긴다 → 핸들이 패널 안쪽 변에 붙는다.
 *   - 오버레이 드로어(좁은 폭): 생략 시 기본 PANEL_WIDTH_CSS.
 *
 * 시각은 `Layout/panelHandleStyle.ts` 단일 정의 — 단색 · 그라데이션/그림자 없음.
 * 디스커버리 보강: 첫 방문 1회 attention 펄스 + peek (localStorage 기억).
 */
import React, { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { panelHandleBar, panelHandleChevron, HANDLE_W, HANDLE_W_HOVER } from '../Layout/panelHandleStyle';

// localStorage 키 — 최초 1회만 펄스 재생
const PULSE_SEEN_KEY = 'planq.edgeHandle.pulseSeen';

// 공통 상수 — 오버레이 패널과 핸들이 같이 참조 (왼쪽 56px 여백 유지)
export const PANEL_WIDTH_CSS = 'min(420px, calc(100vw - 56px))';

interface Props {
  open: boolean;
  onToggle: () => void;
  /** 붙는 변. 기본 'right' */
  side?: 'left' | 'right';
  /** 열렸을 때 변으로부터의 거리(CSS). 데스크탑 컬럼은 실제 패널 폭, 오버레이는 생략(기본 PANEL_WIDTH_CSS) */
  offsetOpen?: string;
  /** 이 폭 이하에서 핸들 숨김(px). 좁은 폭이 풀스크린 전환이라 핸들이 무의미한 화면(예: Q Talk)용.
   *  같은 축에 좁은 폭 전용 오버레이 핸들이 따로 있을 때 중복 방지에도 사용. 생략 시 전 폭 노출. */
  hideBelow?: number;
  ariaLabel?: string;
}

const FloatingPanelToggle: React.FC<Props> = ({
  open, onToggle, side = 'right', offsetOpen, hideBelow, ariaLabel = 'toggle side panel',
}) => {
  // 최초 1회만 attention pulse — localStorage 로 기억
  const [shouldPulse, setShouldPulse] = useState(false);
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(PULSE_SEEN_KEY) === '1';
      if (!seen) {
        setShouldPulse(true);
        window.localStorage.setItem(PULSE_SEEN_KEY, '1');
      }
    } catch {
      // localStorage 불가 환경 — 펄스 없이 진행
    }
  }, []);

  const openDist = offsetOpen || PANEL_WIDTH_CSS;

  return (
    <Handle
      $open={open}
      $pulse={shouldPulse}
      $side={side}
      $openDist={openDist}
      $hideBelow={hideBelow}
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-pressed={open}
    >
      <Chevron $open={open} $side={side}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Chevron>
    </Handle>
  );
};

export default FloatingPanelToggle;

// 마운트 시 1회 재생되는 주목 펄스 — 색만 바뀐다(그림자 링 없음). 2회 반복 후 조용해짐
const attention = keyframes`
  0%   { background: #94A3B8; }
  50%  { background: #14B8A6; }
  100% { background: #94A3B8; }
`;
// peek — 핸들이 살짝 넓어졌다 원위치. 첫 방문 한 번만 (좌우 공통이라 폭만 변화)
const peek = keyframes`
  0%   { width: ${HANDLE_W}px; }
  35%  { width: 24px; }
  70%  { width: 24px; }
  100% { width: ${HANDLE_W}px; }
`;

const Handle = styled.button<{ $open: boolean; $pulse: boolean; $side: 'left' | 'right'; $openDist: string; $hideBelow?: number }>`
  ${panelHandleBar}
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  /* 우측: 뷰포트 오른쪽 변(=콘텐츠 오른쪽). 좌측: 콘텐츠 왼쪽 변(앱 네비 폭 --pq-content-left 만큼 안쪽).
     좌측을 뷰포트 left:0 으로 두면 앱 좌측 메뉴 뒤로 들어간다. */
  ${({ $side, $open, $openDist }) => ($side === 'right'
    ? css`right: ${$open ? $openDist : '0px'}; border-radius: 6px 0 0 6px;`
    : css`left: ${$open
        ? `calc(var(--pq-content-left, 0px) + ${$openDist})`
        : 'var(--pq-content-left, 0px)'}; border-radius: 0 6px 6px 0;`)}
  z-index: 900;
  transition: right 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              left 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              background 0.15s ease,
              width 0.15s ease;

  /* 히트 영역이 화면 밖으로 새지 않게 바깥쪽 변만 좁힌다 */
  &::before { ${({ $side }) => ($side === 'right' ? 'right: -2px;' : 'left: -2px;')} }

  display: flex;
  /* 최초 방문 1회 주목 펄스 + peek (닫힌 상태 + shouldPulse 일 때만) */
  ${({ $open, $pulse }) => !$open && $pulse && css`
    animation: ${attention} 1.4s ease-out 2, ${peek} 1.6s ease-out 1;
  `}

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transition: none;
  }

  /* 좁은 폭이 풀스크린 전환이거나 별도 오버레이 핸들이 담당하는 화면 — 이 폭 이하 숨김 */
  ${({ $hideBelow }) => ($hideBelow ? css`@media (max-width: ${$hideBelow}px) { display: none; }` : '')}

  &:hover { width: ${HANDLE_W_HOVER}px; }
`;

const Chevron = styled.span<{ $open: boolean; $side: 'left' | 'right' }>`
  ${panelHandleChevron}
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), color 0.15s ease;
  /* 기본 polyline 은 ◁(왼쪽). 변·상태에 맞춰 회전 — 닫힘: 안쪽(패널 나올 방향) / 열림: 바깥(닫는 방향) */
  transform: rotate(${({ $open, $side }) => {
    if ($side === 'right') return $open ? '180deg' : '0deg';
    return $open ? '0deg' : '180deg';
  }});

  ${Handle}:hover & { color: #FFFFFF; }
`;
