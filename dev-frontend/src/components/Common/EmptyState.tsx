// 빈 상태 공용 컴포넌트.
// 디자인 기준 (Q Note 현재 값) — 모든 페이지 동일:
//   아이콘 원: 72×72, bg #F0FDFA, fg #0D9488
//   제목: 22px / 700 / #0F172A
//   설명: 14px / #64748B / line-height 1.6
//   CTA: height 44, padding 0 28, bg #14B8A6→#0D9488 hover, 14px/600
import React from 'react';
import styled from 'styled-components';

export interface EmptyStateProps {
  // 36×36 SVG 권장 (lg/md). sm 에선 비활성/optional
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;       // 한 줄 또는 <>line1<br/>line2</>
  ctaLabel?: string;
  ctaIcon?: React.ReactNode;
  onCta?: () => void;
  // 보조 CTA (예: "Cue 에게 묻기") — 30년차 디자인: 1차 액션 + 2차 도움말 분리
  secondaryCtaLabel?: string;
  onSecondaryCta?: () => void;
  size?: 'sm' | 'md';                  // sm: 리스트 row 작은 빈 상태, md: 페이지 전체 빈 상태
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, ctaLabel, ctaIcon, onCta, secondaryCtaLabel, onSecondaryCta, size = 'md', className }) => {
  return (
    <Wrap className={className} $size={size}>
      {icon && size === 'md' && <IconCircle>{icon}</IconCircle>}
      <Title $size={size}>{title}</Title>
      {description && <Desc $size={size}>{description}</Desc>}
      {(ctaLabel || secondaryCtaLabel) && (
        <CtaRow>
          {ctaLabel && onCta && (
            <Cta type="button" onClick={onCta}>
              {ctaIcon}
              <span>{ctaLabel}</span>
            </Cta>
          )}
          {secondaryCtaLabel && onSecondaryCta && (
            <SecondaryCta type="button" onClick={onSecondaryCta}>
              <span>{secondaryCtaLabel}</span>
            </SecondaryCta>
          )}
        </CtaRow>
      )}
    </Wrap>
  );
};

export default EmptyState;

const Wrap = styled.div<{ $size: 'sm' | 'md' }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  /* 사이클 N+22 — 부모가 grid item 이어도 자체 너비 100% + 가운데 보장.
     min-height 로 빈 컨테이너에서도 시각적으로 안정된 높이 확보. */
  ${p => p.$size === 'md'
    ? `flex: 1; padding: 40px; min-height: 280px; grid-column: 1 / -1;`
    : `padding: 20px 16px;`}
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
const Title = styled.h2<{ $size: 'sm' | 'md' }>`
  font-size: ${p => p.$size === 'md' ? '22px' : '13px'};
  font-weight: ${p => p.$size === 'md' ? '700' : '600'};
  color: ${p => p.$size === 'md' ? '#0F172A' : '#64748B'};
  margin: 0 0 ${p => p.$size === 'md' ? '8px' : '4px'};
`;
const Desc = styled.p<{ $size: 'sm' | 'md' }>`
  font-size: ${p => p.$size === 'md' ? '14px' : '12px'};
  color: #94A3B8;
  margin: 0 0 ${p => p.$size === 'md' ? '24px' : '8px'};
  line-height: 1.6;
`;
const CtaRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 12px;
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
const SecondaryCta = styled.button`
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 20px;
  background: transparent;
  color: #0D9488;
  border: 1px solid #99F6E4;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
`;
