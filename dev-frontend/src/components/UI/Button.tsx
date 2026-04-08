import { theme as t } from '../../styles/theme';
import styled, { css } from 'styled-components';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'success' | 'cancel' | 'outline' | 'warning' | 'info';
export type ButtonSize = 'small' | 'medium' | 'large';

export const Button = styled.button<{
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: ${props => {
    switch (props.size) {
      case 'small': return t.components.button.paddingSm;
      case 'large': return t.components.button.paddingLg;
      default: return t.components.button.paddingMd;
    }
  }};
  border: none;
  border-radius: ${t.borderRadius.md};
  font-size: ${t.typography.fontSize.sm};
  font-weight: ${t.typography.fontWeight.semibold};
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  text-decoration: none;
  white-space: nowrap;
  width: ${props => props.fullWidth ? '100%' : 'auto'};

  ${props => {
    switch (props.variant) {
      case 'secondary':
      case 'cancel':
      case 'outline':
        return css`
          background: ${t.colors.surface};
          color: ${t.colors.text.muted};
          border: 1px solid ${t.colors.border};
          &:hover:not(:disabled) {
            background: ${t.colors.surfaceHover};
            color: ${t.colors.secondary};
            border-color: ${t.colors.borderHover};
          }
        `;
      case 'danger':
        return css`
          background: ${t.colors.danger};
          color: ${t.colors.surface};
          &:hover:not(:disabled) {
            background: ${t.colors.dangerHover};
            transform: translateY(-1px);
            box-shadow: ${t.shadows.dangerHover};
          }
        `;
      case 'danger-outline':
        return css`
          background: ${t.colors.dangerLight};
          color: #EF4444;
          border: 1px solid #EF4444;
          &:hover:not(:disabled) { background: #FEE2E2; }
        `;
      case 'success':
        return css`
          background: ${t.colors.status.successAlt};
          color: ${t.colors.surface};
          &:hover:not(:disabled) {
            background: ${t.colors.status.successDark};
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
          }
        `;
      case 'warning':
        return css`
          background: ${t.colors.status.warningAlt};
          color: ${t.colors.surface};
          &:hover:not(:disabled) {
            background: #B45309;
            transform: translateY(-1px);
          }
        `;
      case 'info':
        return css`
          background: ${t.colors.status.info};
          color: ${t.colors.surface};
          &:hover:not(:disabled) {
            background: #0891B2;
            transform: translateY(-1px);
          }
        `;
      default: // primary
        return css`
          background: ${t.colors.primary};
          color: ${t.colors.surface};
          &:hover:not(:disabled) {
            background: ${t.colors.primaryHover};
            transform: translateY(-1px);
            box-shadow: ${t.shadows.primaryHover};
          }
        `;
    }
  }}

  &:active:not(:disabled) { transform: translateY(0); }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none;
    pointer-events: none;
  }

  svg {
    width: ${props => {
      switch (props.size) {
        case 'small': return t.components.button.iconSizeSm;
        case 'large': return t.components.button.iconSizeLg;
        default: return t.components.button.iconSizeMd;
      }
    }};
    height: ${props => {
      switch (props.size) {
        case 'small': return t.components.button.iconSizeSm;
        case 'large': return t.components.button.iconSizeLg;
        default: return t.components.button.iconSizeMd;
      }
    }};
  }
`;

export const ModalButton = styled(Button)`
  &:disabled {
    opacity: 1;
    background: ${props => {
      switch (props.variant) {
        case 'primary': return t.colors.disabled.primaryBg;
        case 'danger': return t.colors.disabled.dangerBg;
        default: return t.colors.disabled.background;
      }
    }};
    color: ${props => {
      switch (props.variant) {
        case 'primary':
        case 'danger':
          return 'rgba(255, 255, 255, 0.7)';
        default: return t.colors.disabled.text;
      }
    }};
  }
`;

export const ThemedButton = Button;
export const BaseButton = Button;
