import styled from 'styled-components';

export const DataTableContainer = styled.div`
  background: white;
  border-radius: 12px;
  border: 1px solid #E6EBF1;
  width: 100%;
  @media (max-width: 1024px) { background: transparent; border: none; border-radius: 0; }
`;

export const DataTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  @media (max-width: 1024px) { display: block; }
  tbody { @media (max-width: 1024px) { display: block; } }
`;

export const DataTableHead = styled.thead`
  background: #F8FAFC;
  border-bottom: 1px solid #E6EBF1;
  @media (max-width: 1024px) { display: none; }
`;

export const DataTableRow = styled.tr`
  border-bottom: 1px solid #F3F4F6;
  transition: background 0.15s;
  &:hover { background: #F8FAFC; }
  &:last-child { border-bottom: none; }
  @media (max-width: 1024px) {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px;
    margin-bottom: 10px;
    background: white;
    border-radius: 10px;
    border: 1px solid #E6EBF1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    &:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); transform: translateY(-1px); }
    &:last-child { margin-bottom: 0; }
  }
`;

export const DataTableCell = styled.td<{
  align?: 'left' | 'center' | 'right';
  mobileFullWidth?: boolean;
}>`
  padding: 16px;
  font-size: 14px;
  color: #0A2540;
  vertical-align: middle;
  text-align: ${props => props.align || 'left'};
  word-wrap: break-word;
  > * { text-align: inherit; }
  @media (max-width: 1024px) {
    flex: ${props => props.mobileFullWidth ? '1 1 100%' : '1 1 calc(50% - 5px)'};
    min-width: ${props => props.mobileFullWidth ? '100%' : '140px'};
    padding: 0;
    text-align: left !important;
    &:before {
      content: attr(data-label);
      display: block;
      font-size: 10px;
      font-weight: 600;
      color: #9CA3AF;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    ${props => props.mobileFullWidth ? `
      padding-top: 10px;
      margin-top: 10px;
      border-top: 1px solid #F3F4F6;
      &:before { display: none; }
    ` : ''}
  }
`;

export const DataTableHeaderCell = styled.th<{
  align?: 'left' | 'center' | 'right';
  width?: string;
  isActions?: boolean;
}>`
  padding: 14px 16px;
  text-align: ${props => props.align || 'center'};
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  ${props => props.width ? `width: ${props.width};` : ''}
`;

export const DataTableActions = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: flex-start;
  @media (max-width: 1024px) { gap: 8px; }
`;

export const DataTableEmpty = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: #6B7280;
  @media (max-width: 1024px) {
    padding: 40px 20px;
    background: white;
    border-radius: 10px;
    border: 1px solid #E6EBF1;
  }
`;

export const DataTableAmount = styled.span<{ highlight?: boolean }>`
  font-weight: ${props => props.highlight ? '600' : '500'};
  color: ${props => props.highlight ? '#0A2540' : '#6B7280'};
`;

export const DataTableStatus = styled.span<{
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default';
}>`
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: normal;
  line-height: 1.3;
  text-align: center;
  ${props => {
    switch (props.variant) {
      case 'success': return `background: #E6F9F0; color: #059669;`;
      case 'warning': return `background: #FEF3C7; color: #D97706;`;
      case 'error': return `background: #FEE2E2; color: #DC2626;`;
      case 'info': return `background: #E0F2FE; color: #0284C7;`;
      default: return `background: #F3F4F6; color: #6B7280;`;
    }
  }}
`;
