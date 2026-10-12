/**
 * WikiFrame — 도움말(/guide) 화면의 겉틀. 어디서 열렸느냐에 따라 두 모양이다.
 *
 * ① 랜딩 셸 안(WikiShell → LandingLayout, 기본) — 랜딩 GNB·푸터가 붙는 **공개 페이지**다.
 *    그런데 본문이 앱용 PageShell(전체 폭 머리줄 + 회색 바탕)이라 랜딩 머리·푸터는 1200px 폭인데
 *    도움말만 화면 끝까지 펼쳐졌다(Irene 2026-10-12: "콘텐츠는 레이아웃이 지정된 사이즈인데 도움말은 풀레이아웃").
 *    → 인사이트(/insights)와 같은 서브 히어로 + 가운데 컨테이너로 그린다.
 * ② 팝아웃 창(help-popout 등) — GNB 없는 작은 도구 창이라 종전대로 PageShell.
 *
 * 판정은 WikiShell 과 같은 isPopoutWindow() 하나다 — 둘이 다르면 «GNB 없는데 히어로» 가 된다.
 */
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { isPopoutWindow } from '../../utils/popout';

interface Props {
  title: string;
  /** 랜딩 모드 히어로의 작은 머리글·설명. 없으면 히어로 없이 본문만(문서 상세). */
  eyebrow?: string;
  subtitle?: string;
  /** 머리 쪽 컨트롤(검색). 팝아웃 = PageShell 우측 / 랜딩 = 히어로 아래 가운데 */
  actions?: React.ReactNode;
  /** 문서 상세처럼 읽는 글은 좁은 폭(760) */
  narrow?: boolean;
  children: React.ReactNode;
}

export default function WikiFrame({ title, eyebrow, subtitle, actions, narrow, children }: Props) {
  if (isPopoutWindow()) {
    return <PageShell title={title} actions={actions}>{children}</PageShell>;
  }
  return (
    <>
      {eyebrow !== undefined && (
        <SubHero>
          <Container>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <Title>{title}</Title>
            {subtitle && <Sub>{subtitle}</Sub>}
            {actions && <HeroActions>{actions}</HeroActions>}
          </Container>
        </SubHero>
      )}
      <Content $hasHero={eyebrow !== undefined} data-testid="wiki-frame-content">
        <Container $narrow={narrow}>{children}</Container>
      </Content>
    </>
  );
}

// 값은 랜딩 인사이트(BlogPage)와 같다 — 같은 GNB 아래 나란히 있는 공개 페이지라 폭·여백이 갈리면 안 된다.
const Container = styled.div<{ $narrow?: boolean }>`
  max-width: ${(p) => (p.$narrow ? '808px' : '1080px')}; margin: 0 auto; padding: 0 24px;
  @media (max-width: 640px) { padding: 0 16px; }
`;
const SubHero = styled.section`
  padding: 80px 0 40px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
  @media (max-width: 640px) { padding: 56px 0 28px; }
`;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 2.75rem; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin: 0 0 16px;
  @media (max-width: 768px) { font-size: 2rem; }
`;
const Sub = styled.p`
  font-size: 1.0625rem; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 720px; margin: 0 auto;
  word-break: keep-all;
`;
const HeroActions = styled.div`
  display: flex; justify-content: center; margin-top: 28px;
  && > * { width: min(520px, 100%); }
`;
const Content = styled.section<{ $hasHero: boolean }>`
  background: #FFFFFF;
  padding: ${(p) => (p.$hasHero ? '24px 0 72px' : '48px 0 72px')};
  @media (max-width: 640px) { padding: ${(p) => (p.$hasHero ? '16px 0 48px' : '28px 0 48px')}; }
`;
