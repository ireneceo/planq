// 표준 3톤 버튼 — Primary / Secondary / Danger.
// 색깔/높이/패딩 통일. variant + size + loading 만으로 모든 케이스 커버.
//
// 사용:
//   <Button variant="primary" onClick={...}>저장</Button>
//   <Button variant="secondary" disabled>...</Button>
//   <Button variant="danger" loading={busy}>삭제</Button>
//   <Button variant="primary" size="sm">+ 추가</Button>
import React from 'react';
import styled, { css } from 'styled-components';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, Props>(({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  type = 'button',
  children,
  ...rest
}, ref) => (
  <Btn
    ref={ref}
    type={type}
    $variant={variant}
    $size={size}
    $fullWidth={fullWidth}
    disabled={disabled || loading}
    {...rest}
  >
    {loading && <Spinner $variant={variant} aria-hidden />}
    <Inner $loading={loading}>{children}</Inner>
  </Btn>
));

Button.displayName = 'Button';
export default Button;

// ─── styled ───
const sizeStyles = {
  sm: css`height: 28px; padding: 0 10px; font-size: 12px;`,
  md: css`height: 36px; padding: 0 16px; font-size: 13px;`,
  lg: css`height: 40px; padding: 0 20px; font-size: 14px;`,
};

const variantStyles = {
  primary: css`
    background: #14B8A6; color: #FFFFFF; border: 1px solid #14B8A6;
    &:hover:not(:disabled) { background: #0D9488; border-color: #0D9488; }
    &:active:not(:disabled) { background: #0F766E; border-color: #0F766E; }
    &:disabled { background: #CBD5E1; border-color: #CBD5E1; }
  `,
  secondary: css`
    background: #FFFFFF; color: #475569; border: 1px solid #E2E8F0;
    &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
    &:active:not(:disabled) { background: #F1F5F9; }
    &:disabled { color: #CBD5E1; }
  `,
  danger: css`
    background: #FFFFFF; color: #DC2626; border: 1px solid #FECACA;
    &:hover:not(:disabled) { background: #FEF2F2; border-color: #DC2626; }
    &:active:not(:disabled) { background: #FEE2E2; }
    &:disabled { color: #CBD5E1; border-color: #E2E8F0; }
  `,
};

const Btn = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  $fullWidth: boolean;
}>`
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
  ${p => sizeStyles[p.$size]}
  ${p => variantStyles[p.$variant]}
  ${p => p.$fullWidth && css`width: 100%;`}
  &:disabled { cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;

const Inner = styled.span<{ $loading: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  ${p => p.$loading && css`visibility: hidden;`}
`;

const Spinner = styled.span<{ $variant: ButtonVariant }>`
  position: absolute;
  width: 14px; height: 14px;
  border: 2px solid ${p => p.$variant === 'primary' ? 'rgba(255,255,255,0.4)' : 'rgba(20,184,166,0.3)'};
  border-top-color: ${p => p.$variant === 'primary' ? '#FFFFFF' : '#14B8A6'};
  border-radius: 50%;
  animation: planq-btn-spin 0.7s linear infinite;
  @keyframes planq-btn-spin { to { transform: rotate(360deg); } }
`;
