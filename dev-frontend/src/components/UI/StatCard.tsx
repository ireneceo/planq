import React from 'react';
import styled from 'styled-components';

export const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 32px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 24px; }
`;

export const StatCard = styled.div<{ color?: string }>`
  background: white;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #E6EBF1;
  border-left: 4px solid ${props => props.color || '#6C5CE7'};
  transition: all 0.2s;
  &:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); transform: translateY(-2px); }
  @media (max-width: 768px) { padding: 12px 14px; }
`;

export const StatValue = styled.div`
  font-size: 24px;
  font-weight: 700;
  color: #0A2540;
  margin-bottom: 4px;
  @media (max-width: 768px) { font-size: 18px; margin-bottom: 2px; }
`;

export const StatLabel = styled.div`
  font-size: 13px;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
  @media (max-width: 768px) { font-size: 10px; }
`;

export const StatDescription = styled.div`
  font-size: 12px;
  color: #9CA3AF;
  margin-top: 4px;
  @media (max-width: 768px) { font-size: 10px; margin-top: 2px; }
`;

export const StatTrend = styled.div<{ trend?: 'up' | 'down' | 'neutral' }>`
  font-size: 12px;
  font-weight: 500;
  margin-top: 4px;
  color: ${props => {
    switch (props.trend) {
      case 'up': return '#059669';
      case 'down': return '#DC2626';
      default: return '#6B7280';
    }
  }};
`;

export const DashboardStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-bottom: 32px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); gap: 16px; }
`;

export const DashboardStatCard = styled.div<{ color?: string }>`
  background: white;
  border-radius: 12px;
  padding: 24px;
  border: 1px solid #E6EBF1;
  border-left: 4px solid ${props => props.color || '#6C5CE7'};
  transition: all 0.2s;
  &:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); transform: translateY(-2px); }
`;

export const DashboardStatLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #6B7C93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`;

export const DashboardStatValue = styled.div`
  font-size: 32px;
  font-weight: 700;
  color: #0A2540;
  margin-bottom: 8px;
`;

export const DashboardStatDescription = styled.div`
  font-size: 13px;
  color: #6B7280;
`;

interface StatCardComponentProps {
  color?: string;
  value: string | number;
  label: string;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendText?: string;
  onClick?: () => void;
  className?: string;
}

export const StatCardComponent: React.FC<StatCardComponentProps> = ({
  color, value, label, description, trend, trendText, onClick, className
}) => (
  <StatCard color={color} onClick={onClick} className={className} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <StatValue>{value}</StatValue>
    <StatLabel>{label}</StatLabel>
    {description && <StatDescription>{description}</StatDescription>}
    {trendText && <StatTrend trend={trend}>{trendText}</StatTrend>}
  </StatCard>
);

interface StatsGridComponentProps {
  stats: Array<{
    color?: string;
    value: string | number;
    label: string;
    description?: string;
    trend?: 'up' | 'down' | 'neutral';
    trendText?: string;
    onClick?: () => void;
  }>;
  className?: string;
}

export const StatsGridComponent: React.FC<StatsGridComponentProps> = ({ stats, className }) => (
  <StatsGrid className={className}>
    {stats.map((stat, index) => (
      <StatCardComponent key={index} {...stat} />
    ))}
  </StatsGrid>
);

export default StatCardComponent;
