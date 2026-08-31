import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styled from 'styled-components';
import { useLocation } from 'react-router-dom';
import UserChip from './UserChip';
import { useMediaQuery } from '../../hooks/useMediaQuery';

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
  // 운영 #391 — "내 문의 및 피드백 모바일에서 상단 잘림."
  //   헤더는 `flex-wrap: nowrap` 으로 한 줄을 지킨다(2026-08-25 결정: "버튼 2개뿐인데 2줄로 나온다").
  //   그런데 액션이 검색창(200px)+셀렉트 2개(130px×2) 처럼 넓으면 폰 375px 에서 **화면 밖으로
  //   밀려 통째로 사라진다** — 헤더가 두 줄이 되지 않는 대신 액션이 없어진 것이다.
  //   그래서 폰에서는 액션을 헤더 **아래 자기 줄**로 내린다. 헤더는 여전히 한 줄이고(제목+계정),
  //   액션은 다시 손이 닿는다. PageShell 을 쓰는 모든 화면에 한 번에 적용된다
  //   (Irene: "비슷한 문제디자인 없는지 다 찾아야 해").
  //   ★ DOM 을 양쪽에 두고 CSS 로 숨기지 않는다 — 숨은 쪽의 입력·testid 를 검사기와 사용자가
  //     집을 수 있어 "눌러도 아무 일 없는" 유령이 생긴다. 한 곳에만 렌더한다.
  const isPhone = useMediaQuery('(max-width: 640px)');

  // 운영 #397 — "모바일에서 비용재무에 들어가면 위에부터 열리는게 아니라 아래에 열려."
  //   스크롤은 body 가 아니라 아래 Body 가 가진다. 그런데 /stats/profit → /stats/finance 처럼
  //   **같은 페이지 컴포넌트가 마운트를 유지한 채 내용만 바뀌면** 이 스크롤이 그대로 남는다 —
  //   앞 화면에서 내려 본 만큼 다음 화면이 중간에서 열린다(실측 384px).
  //   경로가 바뀌면 위에서부터 연다. 쿼리만 바뀌는 경우(?item= 같은 상세 열기)는 대상이 아니다.
  //   ★ useLayoutEffect 로 즉시 — RAF 로 미루면 첫 페인트가 옛 위치로 그려졌다가 튄다.
  const bodyRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [pathname]);
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
          {!isPhone && actions}
          <UserChip />
        </HeaderRight>
      </Header>
      {isPhone && actions && <PhoneActionRow>{actions}</PhoneActionRow>}
      <Body ref={bodyRef} style={bodyPadding ? { padding: bodyPadding } : undefined}>
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
  font-size: 1.125rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/* 폰 전용 — 헤더에서 내려온 액션 줄. 가로로 넘치면 스크롤되게 두어(숨기지 않고) 전부 닿게 한다.
   헤더와 같은 흰 배경·같은 좌우 여백이라 시각적으로는 헤더의 둘째 줄로 읽힌다. */
const PhoneActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
  /* 안쪽 요소가 스스로 줄어들어 사라지지 않게 — 넘치면 줄 전체가 스크롤된다 */
  > * { flex-shrink: 0; }
`;

const Count = styled.span`
  font-size: 0.75rem;
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
  /* 폰 — 스크롤 콘텐츠 자체는 인디케이터 밑까지 흐르되, 마지막 항목이 그 밑에 깔려 안 읽히지 않도록
     스크롤 여유만 인셋만큼 더 준다(앱 셸이 자리를 비우는 방식과 다르다 — MainLayout 주석 참조). */
  @media (max-width: 640px) { padding: 14px; padding-bottom: calc(14px + var(--pq-safe-bottom, 0px)); }
  flex: 1;
  min-width: 0;
  /* N+29 — 본문만 스크롤. flex 자식 안에서 overflow-y:auto 가 동작하려면 min-height:0 필수 (flex hack). */
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;
