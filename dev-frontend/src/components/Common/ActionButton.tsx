// ActionButton — PlanQ 공용 액션 버튼 (사이클 N+19)
//
// 30년차 UI/UX 디자이너 표준:
//   톤  : Primary (CTA 1순위) · Secondary (취소·보조) · Danger (삭제·되돌릴 수 없는 작업)
//   크기: sm 36px (drawer/inline) · md 40px (modal) · lg 44px (mobile-only or 강조)
//   폰트: 13px sm / 14px md / 15px lg, weight 600
//   상태: idle · hover · active · focus-visible · disabled · loading
//   접근성: focus ring (#0F766E opacity 0.5), keyboard tab, aria-busy (loading 시)
//   인터랙션: 0.15s color transition. Reduced motion 자동 비활성.
//
// 사용처:
//   <ActionButton tone="primary" size="sm" onClick={...}>저장</ActionButton>
//   <ActionButton tone="danger" loading={deleting} icon={<Trash />}>삭제</ActionButton>
//
// 절대 금지:
//   상태 색을 버튼 배경에 칠하지 말 것 (예: success green bg). 3톤 외 신규 톤 도입 금지.

import React from 'react';
import styled, { css, keyframes } from 'styled-components';

export type ActionButtonTone = 'primary' | 'secondary' | 'danger';
export type ActionButtonSize = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionButtonTone;
  size?: ActionButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const ActionButton = React.forwardRef<HTMLButtonElement, Props>(function ActionButton(
  { tone = 'primary', size = 'sm', loading, icon, iconPosition = 'left', fullWidth, disabled, children, type = 'button', ...rest },
  ref,
) {
  const isDisabled = !!disabled || !!loading;
  return (
    <BtnEl
      ref={ref}
      type={type}
      $tone={tone}
      $size={size}
      $fullWidth={!!fullWidth}
      disabled={isDisabled}
      aria-busy={!!loading}
      {...rest}
    >
      {loading ? <Spinner $size={size} aria-hidden /> : (icon && iconPosition === 'left' && <IconSlot>{icon}</IconSlot>)}
      {children && <Label>{children}</Label>}
      {!loading && icon && iconPosition === 'right' && <IconSlot>{icon}</IconSlot>}
    </BtnEl>
  );
});

export default ActionButton;

// ────────────────────────────────────────────────
// styled
// ────────────────────────────────────────────────
const sizeMap: Record<ActionButtonSize, { h: number; px: number; font: number; gap: number; radius: number }> = {
  sm: { h: 36, px: 14, font: 13, gap: 6, radius: 8 },
  md: { h: 40, px: 16, font: 14, gap: 7, radius: 8 },
  lg: { h: 44, px: 18, font: 15, gap: 8, radius: 10 },
};

function toneStyles(tone: ActionButtonTone) {
  switch (tone) {
    case 'primary':
      return css`
        background: #0F766E;
        color: #FFFFFF;
        border: 1px solid #0F766E;
        &:hover:not(:disabled) { background: #115E59; border-color: #115E59; }
        &:active:not(:disabled) { background: #134E4A; transform: translateY(0.5px); }
      `;
    case 'secondary':
      return css`
        background: #FFFFFF;
        color: #475569;
        border: 1px solid #E2E8F0;
        &:hover:not(:disabled) { background: #F8FAFC; color: #0F172A; border-color: #CBD5E1; }
        &:active:not(:disabled) { background: #F1F5F9; }
      `;
    case 'danger':
      return css`
        background: #FFFFFF;
        color: #B91C1C;
        border: 1px solid #FCA5A5;
        &:hover:not(:disabled) { background: #FEF2F2; border-color: #EF4444; color: #991B1B; }
        &:active:not(:disabled) { background: #FEE2E2; }
      `;
  }
}

const BtnEl = styled.button<{ $tone: ActionButtonTone; $size: ActionButtonSize; $fullWidth: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  height: ${(p) => sizeMap[p.$size].h}px;
  padding: 0 ${(p) => sizeMap[p.$size].px}px;
  gap: ${(p) => sizeMap[p.$size].gap}px;
  font-size: ${(p) => sizeMap[p.$size].font}px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1;
  border-radius: ${(p) => sizeMap[p.$size].radius}px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.05s ease;
  ${(p) => toneStyles(p.$tone)}
  ${(p) => p.$fullWidth && css`width: 100%;`}

  &:focus-visible {
    outline: 2px solid rgba(15, 118, 110, 0.5);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
  /* 모바일 — 36 → 44 자동 강화 (터치 타겟 표준) */
  @media (max-width: 640px) {
    min-height: ${(p) => Math.max(sizeMap[p.$size].h, 44)}px;
  }
`;
const IconSlot = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  svg { width: 16px; height: 16px; }
`;
const Label = styled.span`
  display: inline-block;
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;
const Spinner = styled.span<{ $size: ActionButtonSize }>`
  display: inline-block;
  width: ${(p) => p.$size === 'lg' ? 16 : p.$size === 'md' ? 14 : 12}px;
  height: ${(p) => p.$size === 'lg' ? 16 : p.$size === 'md' ? 14 : 12}px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
