import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useLocation } from 'react-router-dom';

export const TabContainer = styled.div`
  display: flex;
  gap: 24px;
  margin-bottom: 32px;
  border-bottom: 1px solid #E6EBF1;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  &::-webkit-scrollbar { height: 3px; }
  &::-webkit-scrollbar-track { background: #F8FAFC; }
  &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
  &::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
  @media (max-width: 768px) { gap: 16px; margin-bottom: 24px; }
  @media (max-width: 480px) { gap: 12px; margin-bottom: 20px; }
`;

export const Tab = styled.button<{ active?: boolean }>`
  padding: 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: ${props => props.active ? '#14B8A6' : '#6B7C93'};
  background: none;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover { color: #14B8A6; }
  &::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: ${props => props.active ? '#14B8A6' : 'transparent'};
    transition: all 0.15s;
  }
`;

interface TabsProps {
  tabs: Array<{
    key: string;
    label: string;
    active?: boolean;
    onClick?: () => void;
  }>;
  className?: string;
  useUrlParams?: boolean;
  defaultTab?: string;
  onTabChange?: (tabKey: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs, className, useUrlParams = false, defaultTab, onTabChange
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTabKey, setActiveTabKey] = useState<string>(defaultTab || tabs[0]?.key || '');

  useEffect(() => {
    if (useUrlParams) {
      const params = new URLSearchParams(location.search);
      const tabParam = params.get('tab');
      if (tabParam && tabs.some(t => t.key === tabParam)) {
        setActiveTabKey(tabParam);
      } else if (defaultTab) {
        setActiveTabKey(defaultTab);
      }
    }
  }, [location.search, useUrlParams, tabs, defaultTab]);

  const handleTabClick = (tab: typeof tabs[0]) => {
    if (tab.onClick) { tab.onClick(); return; }
    if (useUrlParams) {
      setActiveTabKey(tab.key);
      const params = new URLSearchParams(location.search);
      params.set('tab', tab.key);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
      if (onTabChange) onTabChange(tab.key);
    }
  };

  return (
    <TabContainer className={className}>
      {tabs.map(tab => (
        <Tab
          key={tab.key}
          active={useUrlParams ? tab.key === activeTabKey : tab.active}
          onClick={() => handleTabClick(tab)}
        >
          {tab.label}
        </Tab>
      ))}
    </TabContainer>
  );
};

export default Tabs;
