// 랜딩 메인 — 다크 + teal 그라디언트 (Hero/Q Series/Engine/CTA),
// 라이트 (Problem/Value/Compare/Trust/Target). 8 섹션 + 하단 CTA.
// 애니메이션: useReveal hook 으로 스크롤 시 fade+up.
import { Link } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const Q_SERIES = ['talk', 'task', 'note', 'file', 'bill'] as const;
const PROBLEM_ITEMS = [
  { icon: 'chat', label: 'problem.items.0.label', tool: 'problem.items.0.tool' },
  { icon: 'check', label: 'problem.items.1.label', tool: 'problem.items.1.tool' },
  { icon: 'folder', label: 'problem.items.2.label', tool: 'problem.items.2.tool' },
  { icon: 'doc', label: 'problem.items.3.label', tool: 'problem.items.3.tool' },
] as const;
const COMPARE_ROWS = ['request', 'task', 'file', 'agreement', 'meeting', 'invoice', 'profitability'] as const;
const TARGET_ITEMS = ['agency', 'dev', 'studio', 'construction', 'consulting', 'legal'] as const;
const ENGINE_LEFT = ['task', 'project', 'member', 'hours', 'client', 'invoice'] as const;
const ENGINE_RIGHT = ['revenue', 'cost', 'overhead'] as const;

const HomePage: React.FC = () => {
  const { t } = useTranslation('landing');

  return (
    <LandingLayout>
      <Hero>
        <HeroBlobA />
        <HeroBlobB />
        <HeroInner>
          <HeroLogoImg src="/planQ_white_new.svg" alt="PlanQ" />
          <HeroSlogan>{t('hero.slogan', '일이 일이 되지 않게')}</HeroSlogan>
          <HeroPreHeadline>{t('hero.preHeadline', '업무, 프로젝트, 사람, 시간, 고객, 청구를')}</HeroPreHeadline>
          <HeroHeadline>하나로 연결해<br /><HeroHighlight>시간을 돈으로 바꾸는</HeroHighlight><br />수익성 엔진</HeroHeadline>
          <HeroCta to="/register">{t('hero.cta', '무료로 시작하기')}</HeroCta>
        </HeroInner>
      </Hero>

      {/* Problem */}
      <Section $bg="white">
        <Container>
          <Reveal as="div"><SectionTag>{t('problem.tag', 'Problem')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle>{t('problem.title1', '지금, 당신의 업무는')}<br />{t('problem.title2', '몇 개의 도구에 흩어져 있나요?')}</SectionTitle></Reveal>
          <Reveal as="p"><SectionDesc>{t('problem.desc1', '도구가 많아질수록 정작 일은 느려집니다.')}<br />{t('problem.desc2', '어디서 뭘 확인해야 하는지 찾는 것 자체가 업무가 됩니다.')}</SectionDesc></Reveal>
          <Reveal>
            <ProblemGrid>
              {PROBLEM_ITEMS.map((it, i) => (
                <ProblemItem key={i} style={{ transitionDelay: `${i * 60}ms` }}>
                  <ProblemIcon>{renderIcon(it.icon)}</ProblemIcon>
                  <ProblemLabel>{t(it.label)}</ProblemLabel>
                  <ProblemTool>{t(it.tool)}</ProblemTool>
                </ProblemItem>
              ))}
            </ProblemGrid>
          </Reveal>
          <Reveal as="div"><ProblemArrow>
            {t('problem.arrow1', '4개의 도구, 4번의 컨텍스트 전환, 4배의 시간 낭비.')}<br />
            <strong>{t('problem.arrow2', '일이 일이 되는 순간입니다.')}</strong>
          </ProblemArrow></Reveal>
        </Container>
      </Section>

      {/* Value / Solution */}
      <Section $bg="bg">
        <Container>
          <Reveal as="div"><SectionTag>{t('value.tag', 'Solution')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle>{t('value.title1', 'PlanQ는 하나의 공간에서')}<br />{t('value.title2', '업무 전체를 실행합니다.')}</SectionTitle></Reveal>
          <Reveal>
            <ValueCards>
              {[1, 2, 3].map((n, i) => (
                <ValueCard key={n} style={{ transitionDelay: `${i * 80}ms` }}>
                  <ValueNum>{String(n).padStart(2, '0')}</ValueNum>
                  <ValueH3>{t(`value.cards.${n}.title`)}</ValueH3>
                  <ValueP>{t(`value.cards.${n}.desc`)}</ValueP>
                </ValueCard>
              ))}
            </ValueCards>
          </Reveal>
        </Container>
      </Section>

      {/* Q Series */}
      <Section $bg="dark">
        <Container>
          <Reveal as="div"><SectionTag $light>{t('features.tag', 'Features')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle $light>{t('features.title', '필요한 건 전부 여기 있습니다.')}</SectionTitle></Reveal>
          <Reveal as="p"><SectionDesc $light>{t('features.desc', '각각의 Q는 독립된 기능이면서, 하나의 흐름으로 연결됩니다.')}</SectionDesc></Reveal>
          <Reveal>
            <QList>
              {Q_SERIES.map((k, i) => (
                <QItem key={k} style={{ transitionDelay: `${i * 60}ms` }}>
                  <QName>Q {k}</QName>
                  <QDesc>{t(`features.q.${k}.desc`)}</QDesc>
                </QItem>
              ))}
            </QList>
          </Reveal>
        </Container>
      </Section>

      {/* Engine */}
      <Section $bg="engine">
        <EngineRing />
        <Container>
          <Reveal as="div"><SectionTag $teal>{t('engine.tag', 'Profitability Engine')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle $light>{t('engine.title1', '단순 협업 도구가 아닙니다.')}<br />{t('engine.title2', '조직의 수익성 엔진입니다.')}</SectionTitle></Reveal>
          <Reveal as="p"><SectionDesc $teal>
            {t('engine.desc1', '고객 채팅·업무·청구를 하나로 — Q Talk·Q Task·Q Bill 이 흩어진 일을 정리하고,')}<br />
            {t('engine.desc2', '잃어버릴 뻔한 매출을 되찾습니다.')}
          </SectionDesc></Reveal>
          <Reveal>
            <EngineVisual>
              <EngineCol>
                {ENGINE_LEFT.map((k, i) => (
                  <EnginePill key={k} style={{ transitionDelay: `${i * 50}ms` }}>{t(`engine.left.${k}`)}</EnginePill>
                ))}
              </EngineCol>
              <EngineCenter>
                <EnginePlus>+</EnginePlus>
              </EngineCenter>
              <EngineCol>
                {ENGINE_RIGHT.map((k, i) => (
                  <EnginePill key={k} $active style={{ transitionDelay: `${(i + 6) * 50}ms` }}>{t(`engine.right.${k}`)}</EnginePill>
                ))}
              </EngineCol>
            </EngineVisual>
          </Reveal>
          <Reveal>
            <EngineResult>
              <EngineResultTitle>
                <EngineEm>{t('engine.resultEm', '시간을 돈으로 바꾸는')}</EngineEm><br />
                {t('engine.resultRest', '조직의 수익성 엔진')}
              </EngineResultTitle>
              <EngineResultSub>
                {t('engine.resultSub1', '누가, 어떤 프로젝트에, 몇 시간을 쓰고, 얼마를 벌었는지.')}<br />
                {t('engine.resultSub2', 'PlanQ 하나로 업무와 수익이 연결됩니다.')}
              </EngineResultSub>
            </EngineResult>
          </Reveal>
        </Container>
      </Section>

      {/* Compare */}
      <Section $bg="white">
        <Container>
          <Reveal as="div"><SectionTag>{t('compare.tag', 'Why PlanQ')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle>{t('compare.title1', '왜 슬랙이나 노션이 아니라')}<br />{t('compare.title2', 'PlanQ인가요?')}</SectionTitle></Reveal>
          <Reveal as="p"><SectionDesc>{t('compare.desc', '각각 훌륭한 도구들. 하지만 함께 쓰면 업무가 흩어집니다.')}</SectionDesc></Reveal>
          <Reveal>
            <CompareTable>
              <CompareRow $head>
                <CompareCell />
                <CompareCell>{t('compare.headOld', '기존 방식')}</CompareCell>
                <CompareCell>{t('compare.headPlanq', 'PlanQ')}</CompareCell>
              </CompareRow>
              {COMPARE_ROWS.map((k) => (
                <CompareRow key={k}>
                  <CompareCell>{t(`compare.rows.${k}.label`)}</CompareCell>
                  <CompareCell>{t(`compare.rows.${k}.old`)}</CompareCell>
                  <CompareCell $accent>{t(`compare.rows.${k}.planq`)}</CompareCell>
                </CompareRow>
              ))}
            </CompareTable>
          </Reveal>
        </Container>
      </Section>

      {/* Trust */}
      <Section $bg="bg">
        <Container>
          <Reveal as="div"><SectionTag>{t('trust.tag', 'Our Story')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle>{t('trust.title1', '15년의 원격 협업 경험에서')}<br />{t('trust.title2', '만들어졌습니다.')}</SectionTitle></Reveal>
          <Reveal as="p"><SectionDesc>{t('trust.desc', 'PlanQ는 이론이 아닌 실전에서 태어났습니다.')}</SectionDesc></Reveal>
          <Reveal>
            <TrustQuote>
              <TrustText>{t('trust.quote', '15년 넘게 글로벌 클라이언트와 원격으로 일하면서 슬랙, 노션, 구글 워크스페이스, 아사나를 모두 써봤습니다. 도구가 많아질수록 효율이 떨어진다는 것을, 가장 필요한 건 \'인지적으로 명확한 구조\'라는 것을 수년간의 경험에서 배웠습니다.')}</TrustText>
              <TrustCite>— {t('trust.cite', 'PlanQ를 만든 이유')}</TrustCite>
            </TrustQuote>
          </Reveal>
        </Container>
      </Section>

      {/* Target */}
      <Section $bg="white">
        <Container>
          <Reveal as="div"><SectionTag>{t('target.tag', 'For Teams')}</SectionTag></Reveal>
          <Reveal as="h2"><SectionTitle>{t('target.title1', '이런 팀에게')}<br />{t('target.title2', 'PlanQ가 필요합니다.')}</SectionTitle></Reveal>
          <Reveal>
            <TargetGrid>
              {TARGET_ITEMS.map((k, i) => (
                <TargetItem key={k} style={{ transitionDelay: `${i * 50}ms` }}>{t(`target.${k}`)}</TargetItem>
              ))}
            </TargetGrid>
          </Reveal>
        </Container>
      </Section>

      {/* Final CTA */}
      <CtaSection>
        <CtaRing />
        <CtaInner>
          <CtaLogoImg src="/planQ_white_new.svg" alt="PlanQ" />
          <CtaHead>{t('finalCta.head', '일이 일이되지 않게, PlanQ')}</CtaHead>
          <CtaSub>{t('finalCta.sub', '설치 없이 웹에서 바로 시작하세요.')}</CtaSub>
          <CtaButtons>
            <CtaPrimary to="/register">{t('finalCta.primary', '무료로 시작하기')}</CtaPrimary>
            <CtaSecondary to="/features">{t('finalCta.secondary', '기능 둘러보기')}</CtaSecondary>
          </CtaButtons>
        </CtaInner>
      </CtaSection>
    </LandingLayout>
  );
};

// reveal helper — useReveal hook + base class
const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

// 4 problem icons
function renderIcon(kind: string) {
  const common = { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'chat':
      return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'check':
      return <svg {...common}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
    case 'folder':
      return <svg {...common}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
    case 'doc':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  }
  return null;
}

export default HomePage;

// ─── styled ───
const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: none; }
`;
const blob = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, -20px) scale(1.08); }
`;

const revealBase = css`
  /* base reveal — useReveal 의 .in 클래스 적용 시 보이게 */
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;

// ===== HERO =====
const Hero = styled.section`
  ${revealBase}
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #134E4A 0%, #0F172A 50%, #1E293B 100%);
  position: relative; overflow: hidden;
  text-align: center; padding: 120px 24px 80px;
  margin-top: -64px; /* GNB 64px 위로 끌어올려 hero 가 GNB 영역까지 채움 */
  padding-top: 184px; /* hero content 가 GNB 아래로 */
`;
const HeroBlobA = styled.div`
  position: absolute; top: -200px; right: -200px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(20,184,166,0.18) 0%, transparent 70%);
  animation: ${blob} 14s ease-in-out infinite;
  pointer-events: none;
`;
const HeroBlobB = styled.div`
  position: absolute; bottom: -100px; left: -100px;
  width: 400px; height: 400px; border-radius: 50%;
  background: radial-gradient(circle, rgba(20,184,166,0.10) 0%, transparent 70%);
  animation: ${blob} 18s ease-in-out infinite reverse;
  pointer-events: none;
`;
const HeroInner = styled.div`
  position: relative; z-index: 1; max-width: 800px;
  margin-top: -80px;
  animation: ${fadeInUp} 0.9s ease-out both;
  @media (max-width: 768px) { margin-top: -40px; }
`;
const HeroLogoImg = styled.img`
  height: 72px; width: auto; display: block;
  margin: 0 auto 12px;
  filter: drop-shadow(0 6px 24px rgba(45,212,191,0.25));
  animation: ${fadeInUp} 0.8s ease-out both;
  @media (max-width: 768px) { height: 48px; }
`;
const HeroSlogan = styled.div`
  font-size: 20px; font-weight: 300; color: #94A3B8;
  letter-spacing: 6px; margin-bottom: 50px;
  @media (max-width: 768px) { font-size: 14px; letter-spacing: 4px; margin-bottom: 32px; }
`;
const HeroPreHeadline = styled.div`
  font-size: 20px; font-weight: 400; color: #FFFFFF;
  margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 16px; }
`;
const HeroHeadline = styled.h1`
  font-size: 48px; font-weight: 700; color: #FFFFFF;
  line-height: 1.31; margin: 0 0 48px 0;
  word-break: keep-all;
  @media (max-width: 768px) { font-size: 30px; }
`;
const HeroHighlight = styled.span`
  color: #14B8A6;
`;
const HeroCta = styled(Link)`
  display: inline-block; padding: 16px 48px;
  border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 16px; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); box-shadow: 0 0 60px rgba(20,184,166,0.4); }
`;

// ===== Sections common =====
const Section = styled.section<{ $bg: 'white' | 'bg' | 'dark' | 'engine' }>`
  ${revealBase}
  padding: 120px 24px;
  position: relative;
  ${p => p.$bg === 'white' && css`background: #FFFFFF;`}
  ${p => p.$bg === 'bg' && css`background: #FAFBFC;`}
  ${p => p.$bg === 'dark' && css`background: #0F172A; color: #FFFFFF;`}
  ${p => p.$bg === 'engine' && css`
    background: linear-gradient(160deg, #134E4A 0%, #115E59 100%);
    color: #FFFFFF;
    overflow: hidden;
  `}
  @media (max-width: 768px) { padding: 80px 20px; }
`;
const Container = styled.div`max-width: 1080px; margin: 0 auto;`;
const SectionTag = styled.div<{ $light?: boolean; $teal?: boolean }>`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500;
  color: ${p => p.$teal ? '#5EEAD4' : p.$light ? '#5EEAD4' : '#0D9488'};
  letter-spacing: 3px; text-transform: uppercase;
  margin-bottom: 16px;
`;
const SectionTitle = styled.h2<{ $light?: boolean }>`
  font-size: 36px; font-weight: 700; line-height: 1.35;
  margin-bottom: 20px;
  word-break: keep-all;
  color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  @media (max-width: 768px) { font-size: 28px; }
`;
const SectionDesc = styled.p<{ $light?: boolean; $teal?: boolean }>`
  font-size: 17px; font-weight: 300;
  color: ${p => p.$teal ? '#99F6E4' : p.$light ? '#94A3B8' : '#64748B'};
  line-height: 1.8; max-width: 640px; word-break: keep-all;
`;

// ===== Problem =====
const ProblemGrid = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px;
  margin-top: 56px;
  background: #CBD5E1;
  border-radius: 16px; overflow: hidden;
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); }
`;
const ProblemItem = styled.div`
  background: #FFFFFF; padding: 40px 28px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out;
`;
const ProblemIcon = styled.div`color: #14B8A6; margin-bottom: 8px;`;
const ProblemLabel = styled.div`font-size: 14px; color: #64748B; font-weight: 400;`;
const ProblemTool = styled.div`font-size: 15px; font-weight: 500; color: #0F172A;`;
const ProblemArrow = styled.div`
  text-align: center; margin-top: 40px;
  font-size: 18px; color: #64748B; font-weight: 300; line-height: 1.8;
  strong { color: #0F172A; font-weight: 600; }
`;

// ===== Value =====
const ValueCards = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  margin-top: 56px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const ValueCard = styled.div`
  background: #FFFFFF; border-radius: 16px;
  padding: 40px 32px;
  border: 1px solid rgba(0,0,0,0.04);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, box-shadow 0.3s;
  &:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.08); }
`;
const ValueNum = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 48px; font-weight: 200; color: #5EEAD4;
  margin-bottom: 20px;
`;
const ValueH3 = styled.h3`font-size: 20px; font-weight: 600; line-height: 1.4; margin-bottom: 16px; word-break: keep-all;`;
const ValueP = styled.p`font-size: 15px; color: #64748B; line-height: 1.7; font-weight: 300; word-break: keep-all;`;

// ===== Q Series =====
const QList = styled.div`
  margin-top: 64px;
  display: flex; flex-direction: column; gap: 2px;
`;
const QItem = styled.div`
  display: grid; grid-template-columns: 160px 1fr; gap: 0;
  background: #1E293B;
  overflow: hidden;
  transition: background 0.3s, opacity 0.7s ease-out, transform 0.7s ease-out;
  &:first-child { border-radius: 16px 16px 0 0; }
  &:last-child { border-radius: 0 0 16px 16px; }
  &:hover { background: #334155; }
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;
const QName = styled.div`
  display: flex; align-items: center; justify-content: center;
  padding: 32px 24px;
  font-family: 'Outfit', sans-serif;
  font-size: 22px; font-weight: 500; color: #2DD4BF;
  border-right: 1px solid rgba(255,255,255,0.05);
  text-transform: capitalize;
  @media (max-width: 768px) {
    border-right: none;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    padding: 20px;
  }
`;
const QDesc = styled.div`
  padding: 32px 36px;
  font-size: 15px; color: #94A3B8; line-height: 1.7; font-weight: 300;
  display: flex; align-items: center; word-break: keep-all;
`;

// ===== Engine =====
const EngineRing = styled.div`
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(20,184,166,0.06) 0%, transparent 60%);
  pointer-events: none;
`;
const EngineVisual = styled.div`
  margin-top: 56px;
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 32px;
  align-items: center;
  position: relative; z-index: 1;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const EngineCol = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const EnginePill = styled.div<{ $active?: boolean }>`
  padding: 14px 24px; border-radius: 12px;
  font-size: 15px; font-weight: ${p => p.$active ? 500 : 400};
  background: ${p => p.$active ? 'rgba(20,184,166,0.18)' : 'rgba(255,255,255,0.08)'};
  backdrop-filter: blur(10px);
  border: 1px solid ${p => p.$active ? '#14B8A6' : 'rgba(255,255,255,0.1)'};
  color: ${p => p.$active ? '#5EEAD4' : '#FFFFFF'};
  display: flex; align-items: center; gap: 12px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out;
`;
const EngineCenter = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  @media (max-width: 768px) { flex-direction: row; justify-content: center; }
`;
const EnginePlus = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 36px; font-weight: 200; color: #2DD4BF;
  opacity: 0.7;
`;
const EngineResult = styled.div`
  margin-top: 48px; text-align: center; padding: 40px;
  background: rgba(255,255,255,0.05);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
`;
const EngineResultTitle = styled.div`
  font-size: 28px; font-weight: 700; line-height: 1.4;
  margin-bottom: 12px; word-break: keep-all;
`;
const EngineEm = styled.em`font-style: normal; color: #5EEAD4;`;
const EngineResultSub = styled.div`
  font-size: 16px; color: #99F6E4; font-weight: 300; word-break: keep-all;
`;

// ===== Compare =====
const CompareTable = styled.div`
  margin-top: 56px;
  border-radius: 16px; overflow: hidden;
  border: 1px solid rgba(0,0,0,0.06);
`;
const CompareRow = styled.div<{ $head?: boolean }>`
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  ${p => p.$head && css`background: #FAFBFC;`}
  &:last-child { border-bottom: none; }
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    ${p => p.$head && css`display: none;`}
  }
`;
const CompareCell = styled.div<{ $accent?: boolean }>`
  padding: 18px 24px; font-size: 14px; font-weight: 300;
  color: ${p => p.$accent ? '#0F172A' : '#64748B'};
  ${p => p.$accent && css`font-weight: 500; color: #0F172A;`}
  &:first-child { font-weight: 500; color: #0F172A; background: #FAFBFC; }
  @media (max-width: 768px) {
    &:first-child { font-size: 13px; color: #0D9488; background: #F0FDFA; }
  }
`;

// ===== Trust =====
const TrustQuote = styled.div`
  margin-top: 48px;
  padding: 40px 48px;
  border-left: 3px solid #14B8A6;
  background: #FFFFFF;
  border-radius: 0 16px 16px 0;
  @media (max-width: 768px) { padding: 28px 24px; }
`;
const TrustText = styled.p`
  font-size: 18px; font-weight: 300; color: #334155;
  line-height: 1.8; font-style: italic;
  word-break: keep-all;
`;
const TrustCite = styled.cite`
  display: block; margin-top: 20px;
  font-size: 14px; color: #64748B;
  font-style: normal; font-weight: 400;
`;

// ===== Target =====
const TargetGrid = styled.div`
  margin-top: 48px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 768px) { grid-template-columns: 1fr 1fr; }
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`;
const TargetItem = styled.div`
  padding: 28px 24px; border-radius: 12px;
  background: #FAFBFC;
  font-size: 15px; color: #0F172A; font-weight: 400;
  text-align: center;
  border: 1px solid transparent;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, background 0.3s, border-color 0.3s;
  &:hover { border-color: #99F6E4; background: #F0FDFA; transform: translateY(-2px); }
`;

// ===== Final CTA =====
const CtaSection = styled.section`
  padding: 120px 24px;
  text-align: center;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF;
  position: relative; overflow: hidden;
  @media (max-width: 768px) { padding: 80px 20px; }
`;
const CtaRing = styled.div`
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(20,184,166,0.10) 0%, transparent 60%);
  pointer-events: none;
  animation: ${blob} 16s ease-in-out infinite;
`;
const CtaInner = styled.div`position: relative; z-index: 1;`;
const CtaLogoImg = styled.img`
  height: 56px; width: auto; display: block;
  margin: 0 auto 16px;
  filter: drop-shadow(0 4px 14px rgba(45,212,191,0.22));
  @media (max-width: 768px) { height: 40px; }
`;
const CtaHead = styled.div`
  font-size: 32px; font-weight: 300; margin-bottom: 12px;
  color: #94A3B8;
  @media (max-width: 768px) { font-size: 24px; }
`;
const CtaSub = styled.div`
  font-size: 16px; color: #64748B; font-weight: 300;
  margin-bottom: 48px;
`;
const CtaButtons = styled.div`
  display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;
`;
const CtaPrimary = styled(Link)`
  padding: 16px 48px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 16px; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
const CtaSecondary = styled(Link)`
  padding: 16px 48px; border-radius: 999px;
  background: transparent; color: #94A3B8;
  font-size: 16px; font-weight: 400;
  text-decoration: none;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.3s;
  &:hover { border-color: rgba(255,255,255,0.3); color: #FFFFFF; }
`;
