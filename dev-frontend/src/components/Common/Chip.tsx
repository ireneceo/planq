// 표준 칩/태그/배지 — variant 만으로 모든 케이스 커버.
// 사용:
//   <Chip>기본</Chip>
//   <Chip variant="active" onClick={...}>선택됨</Chip>
//   <Chip variant="teal">정상</Chip>
//   <Chip variant="coral">경고</Chip>
//   <Chip variant="danger">긴급</Chip>
//   <Chip onRemove={() => ...}>업로드.pdf <span>10KB</span></Chip>
import React from 'react';
import styled, { css } from 'styled-components';

export type ChipVariant =
  | 'neutral'   // 기본 슬레이트 (#F1F5F9 / #475569)
  | 'active'    // 선택됨 — 토글 형태에서
  | 'teal'      // 긍정/정상
  | 'coral'     // AI/감지/하이라이트
  | 'warning'   // 노랑
  | 'danger'    // 빨강
  | 'info';     // 파랑

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  active?: boolean;       // active=true 면 'active' 변형으로 강제
  onRemove?: () => void;
  asButton?: boolean;     // toggle 처럼 클릭 가능. variant="active" + onClick 권장
}

const Chip: React.FC<Props> = ({
  variant = 'neutral', active, onRemove, asButton,
  children, ...rest
}) => {
  const v: ChipVariant = active ? 'active' : variant;
  const Comp = asButton ? ButtonChip : SpanChip;
  return (
    <Comp $variant={v} {...(rest as object)}>
      {children}
      {onRemove && (
        <RemoveBtn type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="remove">×</RemoveBtn>
      )}
    </Comp>
  );
};

export default Chip;

// ─── styled ───
const VARIANT_COLORS: Record<ChipVariant, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: '#F1F5F9', fg: '#475569', bd: '#E2E8F0' },
  active:  { bg: '#F0FDFA', fg: '#0F766E', bd: '#14B8A6' },
  teal:    { bg: '#F0FDFA', fg: '#0F766E', bd: '#CCFBF1' },
  coral:   { bg: '#FFF1F2', fg: '#9F1239', bd: '#FECDD3' },
  warning: { bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  danger:  { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' },
  info:    { bg: '#EFF6FF', fg: '#1E40AF', bd: '#BFDBFE' },
};

const baseStyle = css<{ $variant: ChipVariant }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  font-size: 12px; font-weight: 600;
  background: ${p => VARIANT_COLORS[p.$variant].bg};
  color: ${p => VARIANT_COLORS[p.$variant].fg};
  border: 1px solid ${p => VARIANT_COLORS[p.$variant].bd};
  border-radius: 6px;
  white-space: nowrap;
`;
const SpanChip = styled.span<{ $variant: ChipVariant }>`${baseStyle}`;
const ButtonChip = styled.button<{ $variant: ChipVariant }>`
  ${baseStyle}
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) {
    background: ${p => VARIANT_COLORS[p.$variant].bd};
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const RemoveBtn = styled.button`
  all: unset;
  width: 14px; height: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  color: currentColor; opacity: 0.6;
  border-radius: 4px; font-size: 14px; line-height: 1;
  cursor: pointer;
  &:hover { opacity: 1; background: rgba(0,0,0,0.06); }
`;
