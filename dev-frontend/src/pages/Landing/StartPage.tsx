// «처음 시작하는 팀을 위한 5단계» — 공개 페이지 /start/ (2026-10-09).
//
// Irene: "랜딩페이지에도 처음 시작하는 팀에게 나눠서 적응하는 효과적인 방안 정리할래?"
// ★ 다섯 단계는 워크스페이스 «팀 적응 단계» 카드(OnboardingChecklist)·도움말 글(team-adoption-stages)과 **같다** —
//   정본 docs/TEAM_ADOPTION_STAGES_DESIGN.md. 단계를 바꾸면 세 곳을 같이 고친다.
// ★ 문구는 locales landing.json `startPage` 한 곳(검색·AI 가 읽는 프리렌더도 같은 키 — seo-pages.json sections).
// ★ 껍데기는 기능·디테일 페이지와 공용(components/Landing/landingSections) — 새 디자인을 만들지 않는다.
// ★ 홈 첫 문장·정의 문장은 건드리지 않는다(포지셔닝은 Irene 정본).
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import {
  Container, SubHero, Eyebrow, Title, Sub, Group, GroupTitle, GroupDesc, SmallCard, SmallName, SmallLead,
  CtaBand, CtaTitle, CtaSub, CtaBtn,
} from '../../components/Landing/landingSections';
import { useAuth } from '../../contexts/AuthContext';

const PRINCIPLES = ['p0', 'p1', 'p2'] as const;
/** 단계마다 «해 볼 것» 개수 — 문구 키 t0… 와 맞춘다. */
const STAGES: Array<{ id: string; tries: number }> = [
  { id: 's1', tries: 5 }, { id: 's2', tries: 2 }, { id: 's3', tries: 2 }, { id: 's4', tries: 2 }, { id: 's5', tries: 3 },
];

const StartPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const { user } = useAuth();
  const S = (k: string, o?: Record<string, unknown>) => t(`startPage.${k}`, o) as string;
  const startTo = user ? '/dashboard' : '/register';

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{S('eyebrow')}</Eyebrow>
          <Title>{S('title')}</Title>
          <Sub>{S('sub')}</Sub>
          <HeroCtas>
            <PrimaryLink to={startTo} data-testid="start-cta">{user ? S('ctaApp') : S('ctaStart')}</PrimaryLink>
            <GhostLink to="/guide/a/team-adoption-stages">{S('ctaGuide')}</GhostLink>
          </HeroCtas>
        </Container>
      </SubHero>

      <Group $bg="bg">
        <Container>
          <GroupTitle>{S('principles.title')}</GroupTitle>
          <Grid3>
            {PRINCIPLES.map((k) => (
              <SmallCard key={k}>
                <SmallName>{S(`principles.${k}.name`)}</SmallName>
                <SmallLead>{S(`principles.${k}.body`)}</SmallLead>
              </SmallCard>
            ))}
          </Grid3>
        </Container>
      </Group>

      <Group>
        <Container>
          <GroupTitle>{S('stagesTitle')}</GroupTitle>
          <GroupDesc>{S('stagesSub')}</GroupDesc>
          <StageList>
            {STAGES.map((st, i) => (
              <StageRow key={st.id} data-testid={`start-stage-${i + 1}`}>
                <StageSide>
                  <StageNo>{S('stageNo', { n: i + 1 })}</StageNo>
                  <Period>{S(`stages.${st.id}.period`)}</Period>
                </StageSide>
                <StageBody>
                  <StageName>{S(`stages.${st.id}.name`)}</StageName>
                  <Habit>{S(`stages.${st.id}.habit`)}</Habit>
                  <Tries>
                    {Array.from({ length: st.tries }, (_, j) => (
                      <li key={j}>{S(`stages.${st.id}.t${j}`)}</li>
                    ))}
                  </Tries>
                  <Tip>{S(`stages.${st.id}.tip`)}</Tip>
                </StageBody>
              </StageRow>
            ))}
          </StageList>
        </Container>
      </Group>

      <Group $bg="bg">
        <Container>
          <SetupCard>
            <SmallName>{S('setupTitle')}</SmallName>
            <SmallLead>{S('setupBody')}</SmallLead>
          </SetupCard>
        </Container>
      </Group>

      <CtaBand>
        <Container>
          <CtaTitle>{S('closingTitle')}</CtaTitle>
          <CtaSub>{S('closingSub')}</CtaSub>
          <CtaBtn to={startTo}>{user ? S('ctaApp') : S('ctaStart')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default StartPage;

// ─── styled (이 페이지에만 있는 것 — 단계 행. 머리·카드·띠는 landingSections) ───
// 버튼은 디테일 페이지(DetailsPage)의 머리 버튼과 같은 값이다.
const HeroCtas = styled.div`
  margin-top: 32px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
`;
const PrimaryLink = styled(Link)`
  height: 44px; padding: 0 24px; display: inline-flex; align-items: center;
  border-radius: 999px; background: #14B8A6; color: #FFFFFF; font-weight: 600; font-size: 0.9375rem;
  text-decoration: none; &:hover { background: #0D9488; }
`;
const GhostLink = styled(Link)`
  height: 44px; padding: 0 24px; display: inline-flex; align-items: center;
  border-radius: 999px; background: #FFFFFF; color: #0D9488; border: 1px solid #99F6E4;
  font-weight: 600; font-size: 0.9375rem; text-decoration: none; &:hover { background: #F0FDFA; }
`;
const Grid3 = styled.div`
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;
  @media (max-width: 768px) { grid-template-columns: minmax(0, 1fr); }
`;
const StageList = styled.ol`list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px;`;
const StageRow = styled.li`
  display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 24px;
  padding: 24px 22px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 20px 16px; }
`;
const StageSide = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const StageNo = styled.div`
  font-family: 'Outfit', sans-serif; font-size: 0.8125rem; font-weight: 600; color: #0D9488; letter-spacing: 1px;
`;
const Period = styled.div`font-size: 0.8125rem; color: #64748B;`;
const StageBody = styled.div`display: flex; flex-direction: column; gap: 8px; min-width: 0;`;
const StageName = styled.h3`margin: 0; font-size: 1.125rem; font-weight: 700; color: #0F172A; word-break: keep-all;`;
const Habit = styled.p`margin: 0; font-size: 0.9375rem; color: #334155; line-height: 1.7; word-break: keep-all;`;
const Tries = styled.ul`
  margin: 4px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px;
  font-size: 0.875rem; color: #475569; line-height: 1.6; word-break: keep-all;
`;
const Tip = styled.div`
  align-self: flex-start; margin-top: 4px; padding: 4px 10px; border-radius: 8px;
  background: #F0FDFA; color: #0F766E; font-size: 0.8125rem; font-weight: 600; word-break: keep-all;
`;
const SetupCard = styled(SmallCard)`max-width: 720px;`;
