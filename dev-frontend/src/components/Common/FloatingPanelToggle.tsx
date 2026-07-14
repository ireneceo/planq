/**
 * FloatingPanelToggle — 뷰포트 가장자리에 붙는 패널 핸들 (좁은 폭 전용).
 *
 * PanelEdgeHandle 과 **같은 물건이고 시각도 같다** — 배치만 다르다.
 *   PanelEdgeHandle  : 그리드 경계선에 absolute (≥1201px, 패널이 컬럼일 때)
 *   FloatingPanelToggle: 뷰포트 우측 변에 fixed  (≤1200px, 패널이 오버레이 드로어일 때)
 * 두 컴포넌트의 숨김 경계는 정확히 맞물려 **어느 폭에서도 핸들은 한 개만** 보인다.
 *
 * - 닫힌 상태: 우측 변 right:0 · 화살표 ◁ / 열린 상태: 패널 왼쪽 변에 부착 · 화살표 ▷
 * - 같은 핸들이 열기/닫기 모두 담당 (중복 UI 없음)
 *
 * 시각은 `Layout/panelHandleStyle.ts` 단일 정의 — 단색 · 그라데이션 없음 · 그림자 없음.
 *
 * 패널 폭은 CSS 상수 PANEL_WIDTH 공유:
 *   min(420px, calc(100vw - 56px))
 * → 항상 왼쪽 56px 여백이 남아 햄버거 메뉴처럼 바깥 탭 가능.
 *
 * 디스커버리 보강: 첫 방문 1회 attention 펄스 + peek 슬라이드 (localStorage 기억).
 */
import React, { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { panelHandleBar, panelHandleChevron, HANDLE_W, HANDLE_W_HOVER } from '../Layout/panelHandleStyle';

// localStorage 키 — 최초 1회만 펄스 재생
const PULSE_SEEN_KEY = 'planq.edgeHandle.pulseSeen';

// 공통 상수 — 패널과 핸들이 같이 참조
export const PANEL_WIDTH_CSS = 'min(420px, calc(100vw - 56px))';

interface Props {
  open: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}

const FloatingPanelToggle: React.FC<Props> = ({
  open, onToggle, ariaLabel = 'toggle side panel',
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

  return (
    <Handle
      $open={open}
      $pulse={shouldPulse}
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-pressed={open}
    >
      <Chevron $open={open}>
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
// peek — 핸들이 살짝 왼쪽으로 튀어나왔다가 원위치로 복귀. 첫 방문 한 번만.
const peek = keyframes`
  0%   { width: ${HANDLE_W}px; transform: translate(0, -50%); }
  35%  { width: 24px; transform: translate(-6px, -50%); }
  70%  { width: 24px; transform: translate(-6px, -50%); }
  100% { width: ${HANDLE_W}px; transform: translate(0, -50%); }
`;

const Handle = styled.button<{ $open: boolean; $pulse: boolean }>`
  ${panelHandleBar}
  position: fixed;
  top: 50%;
  ${({ $open }) => ($open ? css`right: ${PANEL_WIDTH_CSS};` : css`right: 0;`)}
  transform: translateY(-50%);
  /* 뷰포트 변에 붙으므로 안쪽(좌측) 모서리만 둥글다 */
  border-radius: 6px 0 0 6px;
  z-index: 900;
  transition: right 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              background 0.15s ease,
              width 0.15s ease;

  /* 히트 영역은 화면 밖으로 새지 않게 우측만 좁힌다 */
  &::before { right: -2px; }

  display: none;
  @media (max-width: 1200px) {
    display: flex;
    /* 최초 방문 1회 주목 펄스 + peek 슬라이드 (닫힌 상태 + shouldPulse 일 때만) */
    ${({ $open, $pulse }) => !$open && $pulse && css`
      animation: ${attention} 1.4s ease-out 2, ${peek} 1.6s ease-out 1;
    `}
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transition: none;
  }

  &:hover { width: ${HANDLE_W_HOVER}px; }
`;

const Chevron = styled.span<{ $open: boolean }>`
  ${panelHandleChevron}
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), color 0.15s ease;
  transform: rotate(${({ $open }) => ($open ? '180deg' : '0deg')});

  ${Handle}:hover & { color: #FFFFFF; }
`;
