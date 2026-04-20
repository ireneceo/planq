/**
 * FloatingPanelToggle — 얇은 엣지 핸들 (스크롤바 느낌)
 *
 * - 뷰포트 우측 엣지에 항상 붙은 가는 세로 바
 * - 닫힌 상태: 우측 변 right:0 · 화살표 ◁
 * - 열린 상태: 패널 왼쪽 변에 부착 (right: panelWidth) · 화살표 ▷
 * - 같은 핸들이 열기/닫기 모두 담당 (중복 UI 없음)
 * - 폰·태블릿·데스크탑 narrow 전부 같은 UI
 *
 * 시각 폭 8px · 히트 영역 28px (`::before` 투명 확장)
 *
 * 패널 폭은 CSS 상수 PANEL_WIDTH 공유:
 *   min(420px, calc(100vw - 56px))
 * → 항상 왼쪽 56px 여백이 남아 햄버거 메뉴처럼 바깥 탭 가능.
 */
import React, { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';

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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Chevron>
    </Handle>
  );
};

export default FloatingPanelToggle;

// 마운트 시 1회 재생되는 주목 펄스 — 2회 반복 후 조용해짐
const attention = keyframes`
  0%   { background: #94A3B8; box-shadow: -2px 0 6px rgba(15, 23, 42, 0.06), 0 0 0 0 rgba(20, 184, 166, 0.55); }
  50%  { background: #14B8A6; box-shadow: -2px 0 6px rgba(15, 23, 42, 0.06), 0 0 0 10px rgba(20, 184, 166, 0); }
  100% { background: #94A3B8; box-shadow: -2px 0 6px rgba(15, 23, 42, 0.06), 0 0 0 0 rgba(20, 184, 166, 0); }
`;

const Handle = styled.button<{ $open: boolean; $pulse: boolean }>`
  position: fixed;
  top: 50%;
  ${({ $open }) => $open ? css`right: ${PANEL_WIDTH_CSS};` : css`right: 0;`}
  transform: translateY(-50%);

  width: 8px;
  height: 92px;
  border: none;
  padding: 0;
  background: #94A3B8;
  border-radius: 6px 0 0 6px;
  cursor: pointer;
  z-index: 900;
  box-shadow: -2px 0 6px rgba(15, 23, 42, 0.06);
  transition: right 0.28s cubic-bezier(0.22, 1, 0.36, 1),
              background 0.15s ease,
              width 0.15s ease,
              box-shadow 0.15s ease;

  display: none;
  @media (max-width: 1200px) {
    display: block;
    /* 최초 방문 1회 주목 펄스 (닫힌 상태 + shouldPulse 일 때만, localStorage 기억) */
    ${({ $open, $pulse }) => !$open && $pulse && css`
      animation: ${attention} 1.4s ease-out 2;
    `}
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
  }

  /* 히트 영역 확장 — 투명 패딩으로 터치 타겟 확보 */
  &::before {
    content: '';
    position: absolute;
    top: -12px; bottom: -12px;
    left: -20px; right: -2px;
  }

  &:hover {
    width: 12px;
    background: #14B8A6;
  }
  &:active { background: #0F766E; }
`;

const Chevron = styled.span<{ $open: boolean }>`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748B;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), color 0.15s ease;
  transform: rotate(${({ $open }) => ($open ? '180deg' : '0deg')});

  ${Handle}:hover & { color: #FFFFFF; }
`;
