import type { ReactNode } from 'react';
import styled from 'styled-components';
import UserChip from './UserChip';

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
  embedded?: boolean;               // N+30 — PageShell-in-PageShell 회귀 차단. true 면 헤더/Page wrap 없이 children 만 렌더. PersonalVaultPage 같은 부모 PageShell 안에서 KnowledgePage 등 자체 PageShell 컴포넌트 마운트 시 사용.
};

export default function PageShell({
  title,
  count,
  helpDot,
  actions,
  children,
  bodyPadding,
  embedded,
}: Props) {
  // N+30 — embedded 모드: 부모 PageShell 안에서 마운트되는 경우 헤더 + Page wrapping skip.
  // PersonalVaultPage 안의 KnowledgePage 같은 케이스. 부모가 헤더/스크롤 영역 이미 제공.
  if (embedded) return <>{children}</>;
  return (
    <Page>
      <Header>
        <HeaderLeft>
          <TitleGroup>
            <Title>{title}</Title>
            {helpDot}
          </TitleGroup>
          {count !== undefined && count !== '' && <Count>{count}</Count>}
        </HeaderLeft>
        <HeaderRight>
          {actions}
          <UserChip />
        </HeaderRight>
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
  /* N+29 — 모바일 viewport 안정성. 부모(MainContent) 안에서 height:100% 차지 + 헤더 고정 + Body 만 스크롤.
     min-height:calc(100vh-64px) 옛 정책은 iOS toolbar hide/show 시 100vh 변동 → 페이지 흔들림 회귀. */
  height: 100%;
  min-height: 0;
`;

const Header = styled.div`
  height: 60px;            /* 좌측메뉴·2뎁스 헤더와 픽셀 동일 — 헤더 밑줄(회색 라인) 정렬 */
  padding: 14px 20px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  @media (max-width: 640px) {
    /* ★ 한 줄을 유지한다 (2026-08-25 Irene: "버튼 2개뿐인데 2줄로 나온다").
       옛 규칙은 wrap 이라 제목이 조금만 길어도 액션이 다음 줄로 내려가 헤더가 두 줄이 됐다.
       대신 제목이 줄어들며 말줄임(…)되게 한다 — 아래 HeaderLeft 의 flex-shrink 와 한 쌍이다. */
    flex-wrap: nowrap;
    gap: 8px;
    height: 56px;
    padding: 10px 14px;
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
  @media (max-width: 640px) {
    /* 좁은 화면에서는 제목 쪽이 양보한다 — 안 그러면 액션이 다음 줄로 밀려 헤더가 두 줄이 된다.
       Title 에 이미 ellipsis 가 있어 줄어들면 말줄임으로 처리된다. */
    flex-shrink: 1;
    min-width: 0;
  }
`;

// 제목과 helpDot 은 한 묶음 — 제목 끝나면 바로 helpDot 붙음 (사용자 요청)
const TitleGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  @media (max-width: 640px) {
    /* 액션은 줄바꿈하지 않고 한 줄에 남는다 — 줄이 필요한 쪽은 제목(HeaderLeft)이다. */
    flex-wrap: nowrap;
    gap: 6px;
    flex-shrink: 0;
  }
`;

// ★ 본문 폭 캡(maxContentWidth)을 두었다가 걷어냈다 (2026-08-19).
//   "좌측으로 쏠린다" 는 신고의 실제 원인은 설정 카드 **내부** 구조였고(긴 섹션이 좌우 2단 헤더의
//   왼쪽 칸에 갇혀 있었다) 그건 따로 고쳤다. 캡은 그 원인이 아니었고, 오히려 설정만 920px 로
//   좁아져 다른 화면(고객 목록 1440px·Q docs 1700px)과 어긋났다 —
//   Irene: "모든 설정페이지들이 레이아웃이 좌우가 왜 여백이 넓게 남아?"
//   폭 제한이 다시 필요해지면 원인을 먼저 확인할 것. 여백은 Body padding 20px 하나로 통일한다.

const Body = styled.div`
  padding: 20px;
  /* 폰 — 본문 여백을 줄여 가로 공간을 확보한다. 탭바처럼 음수 마진으로 이 여백을 상쇄하는
     자식들이 있으므로(QProjectDetailPage.styles TabBar) 값이 갈라지면 레이아웃이 밖으로 밀린다.
     여기와 그 음수 마진은 항상 같은 값이어야 한다. */
  @media (max-width: 640px) { padding: 14px; }
  flex: 1;
  min-width: 0;
  /* N+29 — 본문만 스크롤. flex 자식 안에서 overflow-y:auto 가 동작하려면 min-height:0 필수 (flex hack). */
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;
