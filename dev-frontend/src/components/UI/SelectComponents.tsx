import styled from 'styled-components';

export const StandardSelect = styled.select`
  padding: 12px 16px;
  border: 1px solid #E6EBF1;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  width: 100%;
  min-width: 180px;
  &:focus { outline: none; border-color: #6C5CE7; box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1); }
  &:hover { border-color: #D1D5DB; }
  &:disabled { background-color: #F9FAFB; color: #9CA3AF; cursor: not-allowed; border-color: #E5E7EB; }
`;

export const SearchableSelect = styled(StandardSelect)``;

export const MobileSelect = styled(StandardSelect)`
  @media (max-width: 768px) { padding: 14px 16px; font-size: 16px; min-width: 120px; }
`;

export const ThemeSelect = styled(StandardSelect)<{ variant?: 'primary' | 'success' | 'warning' | 'danger' }>`
  ${props => {
    switch (props.variant) {
      case 'success':
        return `border-color: #10B981; &:focus { border-color: #059669; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1); }`;
      case 'warning':
        return `border-color: #F59E0B; &:focus { border-color: #D97706; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1); }`;
      case 'danger':
        return `border-color: #EF4444; &:focus { border-color: #DC2626; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1); }`;
      default: return '';
    }
  }}
`;

export const SmallSelect = styled(StandardSelect)`
  padding: 8px 12px;
  font-size: 13px;
  min-width: 120px;
`;

export const LargeSelect = styled(StandardSelect)`
  padding: 16px 20px;
  font-size: 16px;
  min-width: 200px;
`;

export default StandardSelect;
