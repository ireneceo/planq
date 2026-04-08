import React from 'react';
import styled from 'styled-components';

const Header = styled.div`
  background: white;
  padding: 16px 32px;
  border-bottom: 1px solid #E6EBF1;
  margin-bottom: 0;
  height: 56px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  @media (max-width: 768px) {
    padding: 12px 16px;
    height: auto;
    min-height: 48px;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
`;

const HeaderTitle = styled.h1`
  font-size: 24px;
  font-weight: 600;
  color: #0A2540;
  margin: 0;
  @media (max-width: 768px) { font-size: 18px; white-space: nowrap; flex-shrink: 0; }
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-shrink: 0;
  @media (max-width: 768px) { gap: 8px; }
`;

interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, children }) => (
  <Header>
    <HeaderTitle>{title}</HeaderTitle>
    {children && <HeaderActions>{children}</HeaderActions>}
  </Header>
);

export default PageHeader;
export { Header, HeaderTitle, HeaderActions };
