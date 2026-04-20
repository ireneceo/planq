// 빈 상태 공용 컴포넌트.
// 디자인 기준 (Q Note 현재 값) — 모든 페이지 동일:
//   아이콘 원: 72×72, bg #F0FDFA, fg #0D9488
//   제목: 22px / 700 / #0F172A
//   설명: 14px / #64748B / line-height 1.6
//   CTA: height 44, padding 0 28, bg #14B8A6→#0D9488 hover, 14px/600
import React from 'react';
import styled from 'styled-components';

export interface EmptyStateProps {
  icon: React.ReactNode;               // 36×36 SVG 권장
  title: React.ReactNode;
  description?: React.ReactNode;       // 한 줄 또는 <>line1<br/>line2</>
  ctaLabel?: string;
  ctaIcon?: React.ReactNode;
  onCta?: () => void;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, ctaLabel, ctaIcon, onCta, className }) => {
  return (
    <Wrap className={className}>
      <IconCircle>{icon}</IconCircle>
      <Title>{title}</Title>
      {description && <Desc>{description}</Desc>}
      {ctaLabel && onCta && (
        <Cta type="button" onClick={onCta}>
          {ctaIcon}
          <span>{ctaLabel}</span>
        </Cta>
      )}
    </Wrap>
  );
};

export default EmptyState;

const Wrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
`;
const IconCircle = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #F0FDFA;
  color: #0D9488;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;
const Title = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 8px;
`;
const Desc = styled.p`
  font-size: 14px;
  color: #64748B;
  margin: 0 0 24px;
  line-height: 1.6;
`;
const Cta = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 28px;
  background: #14B8A6;
  color: #FFFFFF;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
