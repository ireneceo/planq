import styled from 'styled-components';

export const ThemedButton = styled.button<{
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'danger-outline' | 'cancel';
  size?: 'small' | 'medium' | 'large';
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: ${props => {
    switch (props.size) {
      case 'small': return '8px 16px';
      case 'large': return '16px 28px';
      default: return '12px 20px';
    }
  }};
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;

  ${props => {
    switch (props.variant) {
      case 'secondary':
      case 'outline':
      case 'cancel':
        return `
          background: white;
          color: #6B7280;
          border: 1px solid #E6EBF1;
          &:hover { background: #F8FAFC; color: #0A2540; border-color: #CBD5E1; }
        `;
      case 'danger':
        return `
          background: #EF4444;
          color: white;
          &:hover { background: #B91C1C; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
        `;
      case 'danger-outline':
        return `
          background: white;
          color: #DC2626;
          border: 1px solid #DC2626;
          &:hover { background: #FEF2F2; color: #B91C1C; border-color: #B91C1C; }
        `;
      default:
        return `
          background: #6C5CE7;
          color: white;
          &:hover { background: #5B4ED6; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(108, 92, 231, 0.3); }
        `;
    }
  }}

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
  }

  svg {
    width: ${props => {
      switch (props.size) {
        case 'small': return '14px';
        case 'large': return '20px';
        default: return '16px';
      }
    }};
    height: ${props => {
      switch (props.size) {
        case 'small': return '14px';
        case 'large': return '20px';
        default: return '16px';
      }
    }};
  }
`;

export const ThemedSelect = styled.select`
  padding: 8px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  color: #374151;
  min-width: 120px;
  cursor: pointer;
  transition: all 0.2s ease;
  &:focus { outline: none; border-color: #6C5CE7; box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.2); }
  &:hover { border-color: #7C6FE7; }
`;

export const ThemedInput = styled.input`
  padding: 8px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  color: #374151;
  transition: all 0.2s ease;
  &:focus { outline: none; border-color: #6C5CE7; box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.2); }
  &:hover { border-color: #7C6FE7; }
`;

export const ThemedCard = styled.div<{ accent?: boolean }>`
  background: white;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  padding: 16px;
  transition: all 0.2s ease;
  ${props => props.accent && `border-color: #6C5CE7; box-shadow: 0 4px 6px -1px rgba(108, 92, 231, 0.2);`}
  &:hover { border-color: #7C6FE7; box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.1); }
`;
