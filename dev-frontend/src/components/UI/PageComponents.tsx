import styled from 'styled-components';

export const Container = styled.div`
  min-height: 100vh;
  background: #FAFBFC;
`;

export const Header = styled.div`
  background: white;
  padding: 16px 32px;
  border-bottom: 1px solid #E6EBF1;
  margin-bottom: 0;
  height: 56px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  @media (max-width: 768px) {
    padding: 16px;
    height: auto;
    min-height: 56px;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
`;

export const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  color: #0A2540;
  margin: 0;
  line-height: 1;
  @media (max-width: 768px) { font-size: 20px; }
`;

export const ActionSection = styled.div`
  display: flex;
  gap: 12px;
`;

export const Content = styled.div`
  padding: 32px;
  @media (max-width: 768px) { padding: 20px 16px; }
`;

export const Button = styled.button<{ variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline' }>`
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: none;

  ${props => {
    switch (props.variant) {
      case 'primary':
        return `
          background: #14B8A6;
          color: white;
          &:hover { background: #0D9488; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20, 184, 166, 0.3); }
        `;
      case 'secondary':
        return `
          background: #F8F9FA;
          color: #6B7C93;
          border: 1px solid #E6EBF1;
          &:hover { background: #EBEEF2; border-color: #D1D9E0; }
        `;
      case 'danger':
        return `
          background: #EF4444;
          color: white;
          &:hover { background: #DC2626; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); }
        `;
      case 'danger-outline':
        return `
          background: #FEF2F2;
          color: #EF4444;
          border: 1px solid #EF4444;
          &:hover { background: #FEE2E2; }
        `;
      default:
        return `
          background: #14B8A6;
          color: white;
          &:hover { background: #0D9488; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20, 184, 166, 0.3); }
        `;
    }
  }}

  &:active { transform: translateY(0); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
