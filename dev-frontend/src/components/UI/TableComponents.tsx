import styled from 'styled-components';

export const Table = styled.div`
  background: white;
  border-radius: 12px;
  border: 1px solid #E6EBF1;
  overflow: hidden;
  @media (max-width: 1024px) { background: transparent; border: none; }
`;

export const TableHeader = styled.div<{ columns: string }>`
  display: grid;
  grid-template-columns: ${props => props.columns};
  gap: 16px;
  padding: 16px 24px;
  background: #F8FAFC;
  border-bottom: 1px solid #E6EBF1;
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: center;
  align-items: center;
  @media (max-width: 1024px) { display: none; }
`;

export const TableRow = styled.div<{ columns: string }>`
  display: grid;
  grid-template-columns: ${props => props.columns};
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid #F3F4F6;
  align-items: center;
  text-align: center;
  transition: all 0.2s;
  div.col-info { text-align: left; }
  div.col-action { text-align: left; }
  div.col-amount, div.col-total, div.col-price, div.col-fee,
  div.col-salary, div.col-revenue, div.col-cost, div.col-money { text-align: right; }
  &:hover { background: #F8FAFC; }
  &:last-child { border-bottom: none; }
  @media (max-width: 1024px) {
    display: block;
    padding: 14px;
    margin-bottom: 10px;
    background: white;
    border-radius: 10px;
    border: 1px solid #E6EBF1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    div.col-info, div.col-amount, div.col-total, div.col-price,
    div.col-fee, div.col-salary, div.col-revenue, div.col-cost, div.col-money { text-align: left; }
    &:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); transform: translateY(-1px); }
    &:last-child { margin-bottom: 0; }
  }
`;

export const MobileLabel = styled.div`
  display: none;
  font-size: 10px;
  font-weight: 600;
  color: #9CA3AF;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  @media (max-width: 1024px) { display: block; }
`;

export const MobileValue = styled.div`
  @media (max-width: 1024px) { flex: 1 1 calc(50% - 5px); min-width: 140px; }
`;

export const MobileGrid = styled.div`
  display: contents;
  @media (max-width: 1024px) { display: flex; flex-wrap: wrap; gap: 10px; }
`;

export const ActionButtons = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: flex-start;
  align-content: flex-start;
  @media (max-width: 1024px) { gap: 8px; }
`;

export const ActionButton = styled.button`
  padding: 6px 12px;
  background: transparent;
  border: 1px solid #E6EBF1;
  border-radius: 6px;
  color: #6B7280;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  &:hover { border-color: #6C5CE7; color: #6C5CE7; background: #F0ECFF; }
  @media (max-width: 768px) { padding: 6px 10px; font-size: 11px; flex: 0 0 auto; }
`;

export const IconButton = styled.button<{ variant?: 'default' | 'edit' | 'delete' | 'view' }>`
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  font-size: 13px;
  font-weight: 500;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  ${props => {
    switch (props.variant) {
      case 'edit':
        return `background: #EBF5FF; border: 1px solid #3B82F6; color: #3B82F6;
          &:hover { background: #DBEAFE; transform: translateY(-1px); }`;
      case 'delete':
        return `background: #FEF2F2; border: 1px solid #EF4444; color: #EF4444;
          &:hover { background: #FEE2E2; transform: translateY(-1px); }`;
      case 'view':
        return `background: #F0FDF4; border: 1px solid #22C55E; color: #22C55E;
          &:hover { background: #DCFCE7; transform: translateY(-1px); }`;
      default:
        return `background: #F6F9FC; border: 1px solid #E6EBF1; color: #6B7280;
          &:hover { background: #E6EBF1; transform: translateY(-1px); }`;
    }
  }}
  &:active { transform: translateY(0); }
  @media (max-width: 768px) { padding: 6px; min-width: 30px; min-height: 30px; }
`;

export const EmptyState = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: #6B7280;
  grid-column: 1 / -1;
  h3 { color: #374151; font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 14px; color: #6B7280; }
  @media (max-width: 1024px) { padding: 40px 20px; }
`;
