// 회사 소개 — Our Story (15년 원격 협업 경험) + 미션 + 가치.
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const VALUES = ['simplicity', 'execution', 'evidence'] as const;
const MILESTONES = [0, 1, 2, 3] as const;

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const AboutPage: React.FC = () => {
  const { t } = useTranslation('landing');

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('aboutPage.eyebrow', 'OUR STORY')}</Eyebrow>
          <Title>{t('aboutPage.title1', '15년의 원격 협업 경험에서')}<br />{t('aboutPage.title2', '만들어졌습니다.')}</Title>
          <Sub>{t('aboutPage.sub', 'PlanQ는 이론이 아닌 실전에서 태어났습니다.')}</Sub>
        </Container>
      </SubHero>

      <StorySection>
        <Container>
          <Reveal>
            <StoryQuote>
              <QuoteText>{t('aboutPage.quote', '15년 넘게 글로벌 클라이언트와 원격으로 일하면서 슬랙, 노션, 구글 워크스페이스, 아사나를 모두 써봤습니다. 도구가 많아질수록 효율이 떨어진다는 것을, 가장 필요한 건 \'인지적으로 명확한 구조\'라는 것을 수년간의 경험에서 배웠습니다.')}</QuoteText>
              <QuoteCite>— {t('aboutPage.cite', 'PlanQ를 만든 이유')}</QuoteCite>
            </StoryQuote>
          </Reveal>
        </Container>
      </StorySection>

      <MissionSection>
        <Container>
          <Reveal as="div"><Eyebrow $light>{t('aboutPage.mission.eyebrow', 'MISSION')}</Eyebrow></Reveal>
          <Reveal as="h2"><MissionTitle>{t('aboutPage.mission.title', '일을 일답게 하다.')}</MissionTitle></Reveal>
          <Reveal as="p"><MissionDesc>{t('aboutPage.mission.desc', '사람은 일에 집중해야 합니다. 도구를 관리하는 데 시간을 쓰면 안 됩니다. PlanQ는 흩어진 업무를 하나로 모아, 도구가 사라지고 일만 남는 경험을 만듭니다.')}</MissionDesc></Reveal>
        </Container>
      </MissionSection>

      <ValuesSection>
        <Container>
          <Reveal as="div"><Eyebrow>{t('aboutPage.values.eyebrow', 'VALUES')}</Eyebrow></Reveal>
          <Reveal as="h2"><ValuesTitle>{t('aboutPage.values.title', '우리가 믿는 세 가지')}</ValuesTitle></Reveal>
          <ValuesGrid>
            {VALUES.map((k, i) => (
              <Reveal key={k}>
                <ValueCard style={{ transitionDelay: `${i * 80}ms` }}>
                  <ValueNum>{String(i + 1).padStart(2, '0')}</ValueNum>
                  <ValueName>{t(`aboutPage.values.items.${k}.name`)}</ValueName>
                  <ValueDesc>{t(`aboutPage.values.items.${k}.desc`)}</ValueDesc>
                </ValueCard>
              </Reveal>
            ))}
          </ValuesGrid>
        </Container>
      </ValuesSection>

      <TimelineSection>
        <Container>
          <Reveal as="div"><Eyebrow>{t('aboutPage.timeline.eyebrow', 'TIMELINE')}</Eyebrow></Reveal>
          <Reveal as="h2"><TimelineTitle>{t('aboutPage.timeline.title', '여기까지 왔습니다')}</TimelineTitle></Reveal>
          <TimelineList>
            {MILESTONES.map(i => (
              <Reveal key={i}>
                <TimelineItem>
                  <TimelineYear>{t(`aboutPage.timeline.items.${i}.year`)}</TimelineYear>
                  <TimelineDivider />
                  <TimelineContent>
                    <TimelineLabel>{t(`aboutPage.timeline.items.${i}.label`)}</TimelineLabel>
                    <TimelineDesc>{t(`aboutPage.timeline.items.${i}.desc`)}</TimelineDesc>
                  </TimelineContent>
                </TimelineItem>
              </Reveal>
            ))}
          </TimelineList>
        </Container>
      </TimelineSection>

      <CtaBand>
        <Container>
          <CtaTitle>{t('aboutPage.cta.title', '같이 일을 일답게 만들어요.')}</CtaTitle>
          <CtaSub>{t('aboutPage.cta.sub', '14일 무료 체험으로 PlanQ를 직접 경험해보세요.')}</CtaSub>
          <CtaButtons>
            <CtaPrimary to="/register">{t('aboutPage.cta.primary', '무료로 시작하기')}</CtaPrimary>
            <CtaSecondary to="/contact">{t('aboutPage.cta.secondary', '문의하기')}</CtaSecondary>
          </CtaButtons>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default AboutPage;

// ─── styled ───
const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
const SubHero = styled.section`
  padding: 96px 0 64px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
const Eyebrow = styled.div<{ $light?: boolean }>`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500;
  color: ${p => p.$light ? '#5EEAD4' : '#0D9488'};
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 44px; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 32px; }
`;
const Sub = styled.p`
  font-size: 17px; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 640px; margin: 0 auto;
`;

const StorySection = styled.section`
  padding: 64px 0 96px; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const StoryQuote = styled.div`
  padding: 56px 64px;
  border-left: 4px solid #14B8A6;
  background: #FAFBFC;
  border-radius: 0 16px 16px 0;
  max-width: 800px; margin: 0 auto;
  @media (max-width: 768px) { padding: 32px 28px; }
`;
const QuoteText = styled.p`
  font-size: 19px; font-weight: 300; color: #334155;
  line-height: 1.85; font-style: italic; word-break: keep-all;
`;
const QuoteCite = styled.cite`
  display: block; margin-top: 24px;
  font-size: 14px; color: #64748B;
  font-style: normal; font-weight: 500;
`;

const MissionSection = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #134E4A 0%, #0F172A 100%);
  color: #FFFFFF;
  text-align: center;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const MissionTitle = styled.h2`
  font-size: 56px; font-weight: 800; letter-spacing: -1.2px;
  line-height: 1.2; margin: 0 0 24px;
  @media (max-width: 768px) { font-size: 36px; }
`;
const MissionDesc = styled.p`
  font-size: 17px; color: #99F6E4; font-weight: 300;
  line-height: 1.8; max-width: 720px; margin: 0 auto;
  word-break: keep-all;
`;

const ValuesSection = styled.section`
  padding: 96px 0; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const ValuesTitle = styled.h2`
  font-size: 32px; font-weight: 700; color: #0F172A; margin: 0 0 48px;
  letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 24px; }
`;
const ValuesGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const ValueCard = styled.div`
  padding: 40px 32px; background: #FAFBFC;
  border: 1px solid #E2E8F0; border-radius: 16px;
`;
const ValueNum = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 48px; font-weight: 200; color: #5EEAD4;
  margin-bottom: 16px;
`;
const ValueName = styled.div`font-size: 20px; font-weight: 700; color: #0F172A; margin-bottom: 12px;`;
const ValueDesc = styled.p`font-size: 14px; color: #64748B; line-height: 1.7; font-weight: 400; word-break: keep-all;`;

const TimelineSection = styled.section`
  padding: 96px 0; background: #FAFBFC;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const TimelineTitle = styled.h2`
  font-size: 32px; font-weight: 700; color: #0F172A; margin: 0 0 48px;
  letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 24px; }
`;
const TimelineList = styled.div`display: flex; flex-direction: column; gap: 16px;`;
const TimelineItem = styled.div`
  display: grid; grid-template-columns: 100px 24px 1fr; gap: 24px;
  align-items: stretch;
  padding: 24px 28px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  @media (max-width: 640px) { grid-template-columns: 80px 16px 1fr; gap: 14px; padding: 20px; }
`;
const TimelineYear = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 22px; font-weight: 600; color: #0D9488;
  display: flex; align-items: center;
`;
const TimelineDivider = styled.div`
  width: 2px; background: #99F6E4; height: 100%;
  justify-self: center; align-self: stretch;
`;
const TimelineContent = styled.div`display: flex; flex-direction: column; gap: 6px; padding: 4px 0;`;
const TimelineLabel = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const TimelineDesc = styled.div`font-size: 14px; color: #64748B; line-height: 1.6; word-break: keep-all;`;

const CtaBand = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF; text-align: center;
  ${Container} { display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;
const CtaTitle = styled.h2`font-size: 32px; font-weight: 700; line-height: 1.4; margin: 0; word-break: keep-all; @media (max-width: 768px) { font-size: 24px; }`;
const CtaSub = styled.p`font-size: 15px; color: #94A3B8; font-weight: 300; margin: 0;`;
const CtaButtons = styled.div`display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; justify-content: center;`;
const CtaPrimary = styled(Link)`
  padding: 16px 36px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 15px; font-weight: 500; text-decoration: none;
  transition: all 0.3s; box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
const CtaSecondary = styled(Link)`
  padding: 16px 36px; border-radius: 999px;
  background: transparent; color: #94A3B8;
  border: 1px solid rgba(255,255,255,0.18);
  font-size: 15px; font-weight: 400; text-decoration: none;
  transition: all 0.3s;
  &:hover { color: #FFFFFF; border-color: rgba(255,255,255,0.32); }
`;
