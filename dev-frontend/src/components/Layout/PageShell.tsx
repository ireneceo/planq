import type { ReactNode } from 'react';
import styled from 'styled-components';

/**
 * PageShell — 단일 컬럼 페이지의 표준 레이아웃.
 *
 * 사용처: /profile, /business/settings, /business/members, /business/clients 등.
 * 좌측 리스트 + 우측 패널 같은 멀티 컬럼 페이지는 `PanelHeader` 사용.
 *
 * 표준값 (절대 바꾸지 말 것):
 *  - 헤더 min-height 60px (모든 페이지 헤더 동일)
 *  - 헤더 padding 14px 20px
 *  - 제목 font 18px / 700 / -0.2px
 *  - Body padding 20px
 *  - 배경 #f8fafc, 헤더 #ffffff
 */
type Props = {
  title: string;
  count?: number | string;          // 제목 우측에 보여줄 카운트 배지 (선택)
  helpDot?: ReactNode;              // 제목 옆 도움말 ⓘ (HelpDot 컴포넌트 권장)
  actions?: ReactNode;              // 헤더 우측 영역 (검색·버튼 등)
  children: ReactNode;
  bodyPadding?: string;             // 본문 padding 커스터마이즈가 필요할 때만
};

export default function PageShell({
  title,
  count,
  helpDot,
  actions,
  children,
  bodyPadding,
}: Props) {
  return (
    <Page>
      <Header>
        <HeaderLeft>
          <Title>{title}</Title>
          {helpDot}
          {count !== undefined && count !== '' && <Count>{count}</Count>}
        </HeaderLeft>
        {actions && <HeaderRight>{actions}</HeaderRight>}
      </Header>
      <Body style={bodyPadding ? { padding: bodyPadding } : undefined}>
        {children}
      </Body>
    </Page>
  );
}

// ─────────────────────────────────────────────
const Page = styled.div`
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  min-height: calc(100vh - 64px);
`;

const Header = styled.div`
  min-height: 60px;
  padding: 14px 20px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const Title = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Count = styled.span`
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  flex-shrink: 0;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`;

const Body = styled.div`
  padding: 20px;
  flex: 1;
  min-width: 0;
`;
