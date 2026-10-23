// 즐겨찾기(별) 토글 — 한 벌. 2026-10-23 Q talk LeftPanel 의 PinBtn 을 **값 그대로** 옮겼다.
//
// Irene: *"즐겨찾기 기능 넣어줘 … 채팅방에 이미 있는 디자인이랑 기능 형태 통일해서 해"*
//   대화방 별 · 프로젝트 카드 별 · 프로젝트 상세 머리줄 별이 같은 것을 쓴다(베끼면 갈라진다 —
//   CLAUDE.md «껍데기는 빼서 같이 쓴다»). 모양을 바꾸지 않는다.
//   - 상시 노출(사이클 N+15-E: hover-only 폐지 — 다른 행 호버 때 별이 깜빡이는 인상) · 28×28 · 상태는 색으로만
//   - 켜짐 amber 채움 / 꺼짐 연회색 윤곽
//   - 행·카드 안에 있으므로 클릭은 부모로 올리지 않는다(stopPropagation 내장)
// 셀렉트·트리처럼 «표시만» 하는 자리는 StarGlyph(작은 별 글리프)를 쓴다.
import React from 'react';
import styled from 'styled-components';

export const STAR_ON = '#F59E0B';

const Btn = styled.button<{ $pinned: boolean }>`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${(p) => (p.$pinned ? STAR_ON : '#CBD5E1')};
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${(p) => (p.$pinned ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$pinned ? '#D97706' : '#94A3B8')}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

const STAR_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

interface Props {
  pinned: boolean;
  onToggle: (next: boolean) => void;
  /** 켜기/끄기 라벨 — 화면마다 말이 다르다(대화방 «핀 고정» · 프로젝트 «즐겨찾기»). */
  labelOn: string;
  labelOff: string;
  className?: string;
  'data-testid'?: string;
}

const StarToggle: React.FC<Props> = ({ pinned, onToggle, labelOn, labelOff, className, ...rest }) => {
  const label = pinned ? labelOff : labelOn;
  return (
    <Btn
      type="button"
      className={className}
      $pinned={pinned}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      data-testid={rest['data-testid']}
      onClick={(e) => { e.stopPropagation(); onToggle(!pinned); }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points={STAR_POINTS} />
      </svg>
    </Btn>
  );
};

/** 표시만 하는 작은 별(셀렉트 옵션·트리 이름 옆). 끄고 켜지 않는다. */
export const StarGlyph: React.FC<{ size?: number; title?: string }> = ({ size = 12, title }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={STAR_ON} stroke={STAR_ON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flexShrink: 0 }}>
    <polygon points={STAR_POINTS} />
  </svg>
);

export default StarToggle;
