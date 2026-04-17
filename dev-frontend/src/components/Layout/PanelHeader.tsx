import type { ReactNode } from 'react';
import styled from 'styled-components';

/**
 * PanelHeader — 멀티 컬럼 레이아웃(Q Talk / Q Note / Q Task 등)에서
 * 각 패널(좌/중/우) 상단에 들어가는 고정 높이 헤더.
 *
 * 표준값 (모든 패널 동일):
 *  - min-height 60px   → 가로 구분선이 y=60 에서 수평 연결
 *  - padding 14px 20px
 *  - border-bottom #e2e8f0
 *
 * 타이틀 크기는 패널 성격에 따라 다름 (앱 타이틀 18px, 메타/섹션 13~16px).
 * → `PanelTitle`(18px) / `PanelSubTitle`(16px) / `PanelMetaTitle`(13px) 중 선택.
 */
type Props = {
  children: ReactNode;
  className?: string;
};

export default function PanelHeader({ children, className }: Props) {
  return <Bar className={className}>{children}</Bar>;
}

const Bar = styled.div`
  min-height: 60px;
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  background: #ffffff;
`;

export const PanelTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const PanelSubTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const PanelMetaTitle = styled.h2`
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.1px;
`;
