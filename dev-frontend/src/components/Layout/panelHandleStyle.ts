/**
 * panelHandleStyle — 패널 접기/펼치기 핸들의 **단일 시각 정의** (PlanQ 표준).
 *
 * 왜 이 파일이 있나:
 *   핸들 구현이 둘로 갈라져 있었다 — 경계선에 붙는 PanelEdgeHandle(데스크탑)과
 *   뷰포트 가장자리에 붙는 FloatingPanelToggle(좁은 폭). 둘은 배치가 다를 뿐 같은 물건인데
 *   시각이 따로 놀아 하나는 그라데이션+그림자 2겹, 하나는 단색이었다.
 *   → 색·크기·hover 는 여기 한 곳에만 있다. 배치(absolute/fixed)만 각 컴포넌트가 정한다.
 *
 * 시각 계약 (Irene 확정): **단색 · 그라데이션 없음 · 그림자 없음.**
 *   얇은 세로 바 8×92, hover 시 teal 로 바뀌며 12px 로만 넓어진다(높이 변화·chevron 흔들림 없음).
 */
import { css } from 'styled-components';

export const HANDLE_W = 8;
export const HANDLE_H = 92;
export const HANDLE_W_HOVER = 12;

/** 바 본체 — 배치(position/top/left/right)는 사용하는 쪽이 얹는다. */
export const panelHandleBar = css`
  width: ${HANDLE_W}px;
  height: ${HANDLE_H}px;
  padding: 0;
  border: none;
  background: #94A3B8;
  cursor: pointer;
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;

  /* 히트 영역 확장 — 얇은 바를 마우스·손가락으로 쉽게 잡도록 투명 패딩 */
  &::before {
    content: '';
    position: absolute;
    top: -12px;
    bottom: -12px;
    left: -14px;
    right: -14px;
  }

  &:hover {
    width: ${HANDLE_W_HOVER}px;
    background: #14B8A6;
  }
  &:active {
    background: #0F766E;
  }
  &:focus-visible {
    outline: 2px solid #14B8A6;
    outline-offset: 3px;
  }
`;

/** chevron — 평소 회색, hover 시 흰색. 부모 셀렉터는 사용하는 쪽에서 보간한다. */
export const panelHandleChevron = css`
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748B;
  transition: color 0.15s ease;
  svg {
    width: 12px;
    height: 12px;
  }
`;
