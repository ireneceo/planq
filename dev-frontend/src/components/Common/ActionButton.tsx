// ActionButton — PlanQ 공용 액션 버튼 (사이클 N+19)
//
// 30년차 UI/UX 디자이너 표준:
//   톤  : Primary (CTA 1순위) · Secondary (취소·보조) · Danger (삭제·되돌릴 수 없는 작업)
//   크기: xs 32px (헤더·목록 행) · sm 36px (drawer/inline) · md 40px (modal) · lg 44px (mobile-only or 강조)
//   폰트: 12px xs / 13px sm / 14px md / 15px lg, weight 600
//
//   상태: idle · hover · active · focus-visible · disabled · loading
//   접근성: focus ring (#0F766E opacity 0.5), keyboard tab, aria-busy (loading 시)
//   인터랙션: 0.15s color transition. Reduced motion 자동 비활성.
//
// ★ xs 는 2026-09-14 에 추가했다 (Irene: *"액션 버튼에 더 작은 크기가 필요해. 프로젝트 우측 상단
//   [프로젝트 링크] 정도의 크기."*). 그 버튼(`QProjectDetailPage.styles.HeaderBtn`)의 규격을
//   그대로 옮긴 것이다 — 32px / 0 12px / 0.75rem / radius 8. 화면에서 따로 그리지 않는다.
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
export type ActionButtonSize = 'xs' | 'sm' | 'md' | 'lg';

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
      {loading ? <Spinner $size={size} aria-hidden /> : (icon && iconPosition === 'left' && <IconSlot $size={size}>{icon}</IconSlot>)}
      {children && <Label>{children}</Label>}
      {!loading && icon && iconPosition === 'right' && <IconSlot $size={size}>{icon}</IconSlot>}
    </BtnEl>
  );
});

export default ActionButton;

// ────────────────────────────────────────────────
// styled
// ────────────────────────────────────────────────
const sizeMap: Record<ActionButtonSize, { h: number; px: number; font: number; gap: number; radius: number }> = {
  xs: { h: 32, px: 12, font: 12, gap: 5, radius: 8 },
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
  font-size: ${(p) => sizeMap[p.$size].font / 16}rem;
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
  /* 모바일 — 36 → 44 자동 강화 (터치 타겟 표준).
     ★ xs 는 제외한다 — 목록 행·헤더에 여러 개가 줄지어 서는 크기라 44 로 키우면 그 줄이
       통째로 커진다(상세 헤더 2밴드 계약·행 높이가 폰에서만 무너진다). 대신 xs 는
       **단독 주 액션에 쓰지 않는다**(주 액션은 sm 이상). */
  @media (max-width: 640px) {
    ${(p) => p.$size !== 'xs' && css`min-height: ${Math.max(sizeMap[p.$size].h, 44)}px;`}
  }
`;
const IconSlot = styled.span<{ $size: ActionButtonSize }>`
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  svg { width: ${(p) => (p.$size === 'xs' ? 14 : 16)}px; height: ${(p) => (p.$size === 'xs' ? 14 : 16)}px; }
`;
const Label = styled.span`
  display: inline-block;
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;
const Spinner = styled.span<{ $size: ActionButtonSize }>`
  display: inline-block;
  width: ${(p) => p.$size === 'lg' ? 16 : p.$size === 'md' ? 14 : p.$size === 'sm' ? 12 : 11}px;
  height: ${(p) => p.$size === 'lg' ? 16 : p.$size === 'md' ? 14 : p.$size === 'sm' ? 12 : 11}px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
