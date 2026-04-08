import styled, { css } from 'styled-components';

// 공통 버튼 스타일
export const BaseButton = styled.button<{
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'success' | 'warning' | 'info';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: ${props => {
    switch (props.size) {
      case 'small': return '8px 14px';
      case 'large': return '16px 28px';
      default: return '12px 20px';
    }
  }};
  border: none;
  border-radius: 6px;
  font-size: ${props => {
    switch (props.size) {
      case 'small': return '12px';
      case 'large': return '16px';
      default: return '14px';
    }
  }};
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  line-height: 1.4;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  min-height: ${props => {
    switch (props.size) {
      case 'small': return '28px';
      case 'large': return '48px';
      default: return '36px';
    }
  }};
  width: ${props => props.fullWidth ? '100%' : 'auto'};

  ${props => {
    switch (props.variant) {
      case 'primary':
        return css`
          background: #6C5CE7;
          color: white;
          &:hover:not(:disabled) {
            background: #5B4ED6;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(108, 92, 231, 0.3);
          }
        `;
      case 'secondary':
        return css`
          background: #F8F9FA;
          color: #6B7C93;
          border: 1px solid #E6EBF1;
          &:hover:not(:disabled) {
            background: #EBEEF2;
            border-color: #D1D9E0;
          }
        `;
      case 'danger':
        return css`
          background: #FEF2F2;
          color: #EF4444;
          border: 1px solid #EF4444;
          &:hover:not(:disabled) {
            background: #FEE2E2;
          }
        `;
      case 'success':
        return css`
          background: #10B981;
          color: white;
          &:hover:not(:disabled) {
            background: #059669;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
          }
        `;
      case 'warning':
        return css`
          background: #FFC107;
          color: #212529;
          &:hover:not(:disabled) {
            background: #E0A800;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(255, 193, 7, 0.3);
          }
        `;
      case 'info':
        return css`
          background: #17A2B8;
          color: white;
          &:hover:not(:disabled) {
            background: #138496;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(23, 162, 184, 0.3);
          }
        `;
      default:
        return css`
          background: #6C5CE7;
          color: white;
          &:hover:not(:disabled) {
            background: #5B4ED6;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(108, 92, 231, 0.3);
          }
        `;
    }
  }}

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.2);
  }
`;

// 공통 상태 배지 스타일
export const StatusBadge = styled.span<{
  status?: 'draft' | 'sent' | 'pending_payment' | 'payment_submitted' | 'paid' | 'overdue' | 'cancelled' | 'active' | 'inactive' | 'success' | 'warning' | 'error' | 'info' | '';
  size?: 'small' | 'medium' | 'large';
}>`
  display: inline-block;
  padding: ${props => {
    switch (props.size) {
      case 'small': return '4px 12px';
      case 'large': return '8px 16px';
      default: return '4px 12px';
    }
  }};
  border-radius: 6px;
  font-size: ${props => {
    switch (props.size) {
      case 'small': return '11px';
      case 'large': return '15px';
      default: return '11px';
    }
  }};
  font-weight: 600;
  text-align: center;
  white-space: nowrap;

  ${props => {
    switch (props.status) {
      case 'draft':
        return css`background: #F3F4F6; color: #6B7280;`;
      case 'sent':
        return css`background: #E0E7FF; color: #4F46E5;`;
      case 'pending_payment':
        return css`background: #FEF3C7; color: #D97706;`;
      case 'payment_submitted':
        return css`background: #DBEAFE; color: #2563EB;`;
      case 'paid':
      case 'active':
      case 'success':
        return css`background: #ECFDF5; color: #059669;`;
      case 'overdue':
      case 'error':
        return css`background: #FEE2E2; color: #DC2626;`;
      case 'cancelled':
      case 'inactive':
        return css`background: #FEE2E2; color: #DC2626;`;
      case 'warning':
        return css`background: #FEF3C7; color: #D97706;`;
      case 'info':
        return css`background: #DBEAFE; color: #2563EB;`;
      default:
        return css`background: #F3F4F6; color: #6B7280;`;
    }
  }}
`;

export const ActionButtonGroup = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  padding: 8px 12px;
  min-height: 44px;
`;

export const CenteredCell = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 12px;
  text-align: center;
  line-height: 1.4;
`;

export const MultiLineText = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  text-align: center;
  gap: 2px;
`;

export const AlertMessage = styled.div<{
  variant?: 'success' | 'error' | 'warning' | 'info';
  show?: boolean;
}>`
  display: ${props => props.show === false ? 'none' : 'flex'};
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  min-height: 44px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 16px;
  transition: all 0.3s ease;

  ${props => {
    switch (props.variant) {
      case 'success':
        return css`background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0;`;
      case 'error':
        return css`background: #FEE2E2; color: #DC2626; border: 1px solid #FECACA;`;
      case 'warning':
        return css`background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A;`;
      case 'info':
        return css`background: #E0F2FE; color: #0369A1; border: 1px solid #BAE6FD;`;
      default:
        return css`background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0;`;
    }
  }}
`;

export const SaveButtonContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #E6EBF1;
`;

export const SaveButtonGroup = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  @media (max-width: 768px) {
    flex-direction: column;
    width: 100%;
  }
`;

export const SaveButton = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: ${props => props.variant === 'secondary' ? '1px solid #E5E7EB' : 'none'};
  background: ${props => props.variant === 'secondary' ? 'white' : '#6C5CE7'};
  color: ${props => props.variant === 'secondary' ? '#6B7280' : 'white'};
  &:hover:not(:disabled) {
    background: ${props => props.variant === 'secondary' ? '#F9FAFB' : '#5B4ED6'};
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

export const StatusMessage = styled.div<{ type: 'success' | 'error' }>`
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
  margin-top: 12px;
  width: 100%;
  box-sizing: border-box;
  ${props => props.type === 'success' ? `
    background: #ECFDF5;
    color: #059669;
    border: 1px solid #A7F3D0;
  ` : `
    background: #FEE2E2;
    color: #DC2626;
    border: 1px solid #FECACA;
  `}
`;
