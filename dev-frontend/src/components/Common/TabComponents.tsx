import React from 'react';
import styled from 'styled-components';

const TabsContainer = styled.div`
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid #E6EBF1;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  &::-webkit-scrollbar { height: 3px; }
  &::-webkit-scrollbar-track { background: #F8FAFC; }
  &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
`;

const TabButton = styled.button<{ active?: boolean }>`
  padding: 12px 0;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: ${props => props.active ? '#6C5CE7' : '#6B7C93'};
  cursor: pointer;
  position: relative;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover { color: #6C5CE7; }
  &::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: ${props => props.active ? '#6C5CE7' : 'transparent'};
    transition: all 0.15s;
  }
`;

const TabBadge = styled.span<{ variant?: 'default' | 'warning' | 'danger' }>`
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => {
    switch (props.variant) {
      case 'danger': return '#DC2626';
      case 'warning': return '#F59E0B';
      default: return '#E6EBF1';
    }
  }};
  color: ${props => {
    switch (props.variant) {
      case 'danger': return 'white';
      case 'warning': return 'white';
      default: return '#6B7C93';
    }
  }};
`;

interface TabsProps { children: React.ReactNode; className?: string; style?: React.CSSProperties; }
interface TabProps { active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; }
interface TabBadgeProps { count: number; variant?: 'default' | 'warning' | 'danger'; showZero?: boolean; }

export const Tabs: React.FC<TabsProps> = ({ children, className, style }) => (
  <TabsContainer className={className} style={style}>{children}</TabsContainer>
);

export const Tab: React.FC<TabProps> = ({ active, onClick, children, className }) => (
  <TabButton active={active} onClick={onClick} className={className}>{children}</TabButton>
);

export const Badge: React.FC<TabBadgeProps> = ({ count, variant = 'default', showZero = false }) => {
  if (count === 0 && !showZero) return null;
  return <TabBadge variant={variant}>{count}</TabBadge>;
};

export { TabsContainer, TabButton, TabBadge };
