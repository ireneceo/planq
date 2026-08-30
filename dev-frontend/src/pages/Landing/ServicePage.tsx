// 서비스 페이지 — 업무체계 설계 및 시스템 구축 (2026-08-24 Irene 요청).
//
// 원문: https://wor-pro.com/operating-system-design/ 의 구성을 그대로 옮기고 랜딩 디자인 토큰에 맞췄다.
//
// ★ 브랜드 원칙 유지 — 제품(PlanQ)과 서비스(워프로랩 스튜디오)는 섞지 않는다.
//   가격표(PricingPage)에는 손대지 않았고, 이 페이지는 "수행 주체 = 워프로랩 스튜디오" 를 명시한다.
//   PlanQ 는 이 서비스가 구축에 쓰는 플랫폼 중 하나로만 등장한다.
//
// 견적 문의는 새 폼을 만들지 않는다 — 기존 /contact 를 `?type=quote` 로 재사용한다
//   (문의 접수 경로가 둘로 갈라지면 admin 장부도 둘로 갈라진다).
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const LAYERS = ['structure', 'workflow', 'information', 'decision', 'automation', 'platform'] as const;
const SERVICES = ['audit', 'design', 'automation', 'build', 'improve'] as const;
const STEPS = ['s0', 's1', 's2', 's3', 's4'] as const;
const OUTPUTS = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9', 'o10', 'o11'] as const;
const FITS = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;
const FAQS = [0, 1, 2, 3] as const;

// 견적 문의 진입점 — 문의 페이지의 견적 모드. scope 를 넘기면 해당 범위가 미리 선택된다.
const QUOTE_URL = '/contact?type=quote';
const AUDIT_URL = '/contact?type=quote&scope=audit';

const ServicePage: React.FC = () => {
  const { t } = useTranslation('landing');
  const S = (k: string, d?: string) => t(`servicePage.${k}`, d ?? '') as string;

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{S('eyebrow', 'SERVICE')}</Eyebrow>
          <TitleTop>{S('titleTop')}</TitleTop>
          <Title>{S('title')}</Title>
          <Sub>{S('sub')}</Sub>
          <HeroActions>
            <PrimaryCta to={AUDIT_URL}>{S('cta')}</PrimaryCta>
            <SecondaryCta to={QUOTE_URL}>{S('ctaSecondary')}</SecondaryCta>
          </HeroActions>
          <ByLine>{S('by')}</ByLine>
        </Container>
      </SubHero>

      {/* 왜 설계가 먼저인가 */}
      <Section $bg="#FFFFFF">
        <Container>
          <Narrow>
            <Reveal><SectionTitle>{S('why.title')}</SectionTitle></Reveal>
            <Reveal><Lead>{S('why.p0')}</Lead></Reveal>
            <Reveal><Body>{S('why.p1')}</Body></Reveal>
            <Reveal><Accent>{S('why.p2')}</Accent></Reveal>
            <Reveal><Body>{S('why.p3')}</Body></Reveal>
          </Narrow>
        </Container>
      </Section>

      {/* 여섯 개 층 */}
      <Section $bg="#FAFBFC">
        <Container>
          <Reveal><SectionTitle>{S('layers.title')}</SectionTitle></Reveal>
          <Reveal><SectionSub>{S('layers.sub')}</SectionSub></Reveal>
          <Grid $cols={3}>
            {LAYERS.map((k, i) => (
              <Reveal key={k}>
                <LayerCard>
                  <LayerNo>{String(i + 1).padStart(2, '0')}</LayerNo>
                  <LayerName>{S(`layers.${k}.name`)}</LayerName>
                  <LayerEn>{S(`layers.${k}.en`)}</LayerEn>
                  <LayerDesc>{S(`layers.${k}.desc`)}</LayerDesc>
                  <LayerTags>{S(`layers.${k}.tags`)}</LayerTags>
                </LayerCard>
              </Reveal>
            ))}
          </Grid>
        </Container>
      </Section>

      {/* 서비스 5 */}
      <Section $bg="#FFFFFF">
        <Container>
          <Reveal><SectionTitle>{S('services.title')}</SectionTitle></Reveal>
          <Reveal><SectionSub>{S('services.sub')}</SectionSub></Reveal>
          <ServiceList>
            {SERVICES.map((k) => (
              <Reveal key={k}>
                <ServiceRow>
                  <ServiceHead>
                    <ServiceName>{S(`services.${k}.name`)}</ServiceName>
                    <ServiceEn>{S(`services.${k}.en`)}</ServiceEn>
                  </ServiceHead>
                  <ServiceBody>
                    <ServiceLead>{S(`services.${k}.lead`)}</ServiceLead>
                    <ServiceDesc>{S(`services.${k}.desc`)}</ServiceDesc>
                    <ServiceOut>
                      <OutLabel>{t('servicePage.services.outputLabel', '산출물') as string}</OutLabel>
                      <OutValue>{S(`services.${k}.output`)}</OutValue>
                    </ServiceOut>
                  </ServiceBody>
                </ServiceRow>
              </Reveal>
            ))}
          </ServiceList>
        </Container>
      </Section>

      {/* 5 단계 프로세스 */}
      <Section $bg="#0F172A" $dark>
        <Container>
          <Reveal><SectionTitle $light>{S('process.title')}</SectionTitle></Reveal>
          <Reveal><SectionSub $light>{S('process.sub')}</SectionSub></Reveal>
          <StepList>
            {STEPS.map((k, i) => (
              <Reveal key={k}>
                <StepRow>
                  <StepNo>STEP {i + 1}</StepNo>
                  <StepEn>{S(`process.${k}.en`)}</StepEn>
                  <StepTitle>{S(`process.${k}.title`)}</StepTitle>
                  <StepDesc>{S(`process.${k}.desc`)}</StepDesc>
                </StepRow>
              </Reveal>
            ))}
          </StepList>
        </Container>
      </Section>

      {/* 산출물 12 */}
      <Section $bg="#FFFFFF">
        <Container>
          <Reveal><SectionTitle>{S('outputs.title')}</SectionTitle></Reveal>
          <Reveal><SectionSub>{S('outputs.sub')}</SectionSub></Reveal>
          <Grid $cols={4}>
            {OUTPUTS.map((k) => (
              <Reveal key={k}>
                <OutputCard>
                  <OutputName>{S(`outputs.${k}.name`)}</OutputName>
                  <OutputDesc>{S(`outputs.${k}.desc`)}</OutputDesc>
                </OutputCard>
              </Reveal>
            ))}
          </Grid>
        </Container>
      </Section>

      {/* 적합 기업 */}
      <Section $bg="#FAFBFC">
        <Container>
          <Reveal><SectionTitle>{S('fit.title')}</SectionTitle></Reveal>
          <FitList>
            {FITS.map((k) => (
              <Reveal key={k}>
                <FitItem>
                  <FitMark aria-hidden="true" />
                  {S(`fit.${k}`)}
                </FitItem>
              </Reveal>
            ))}
          </FitList>
        </Container>
      </Section>

      {/* FAQ */}
      <Section $bg="#FFFFFF">
        <Container>
          <Narrow>
            <Reveal><SectionTitle>{S('faq.title')}</SectionTitle></Reveal>
            {FAQS.map((i) => (
              <Reveal key={i}>
                <FaqItem>
                  <FaqQ>{S(`faq.q${i}`)}</FaqQ>
                  <FaqA>{S(`faq.a${i}`)}</FaqA>
                </FaqItem>
              </Reveal>
            ))}
          </Narrow>
        </Container>
      </Section>

      {/* Why WOR-PRO */}
      <Section $bg="#F0FDFA">
        <Container>
          <Narrow>
            <Reveal><Eyebrow>{S('why2.title')}</Eyebrow></Reveal>
            <Reveal><Lead>{S('why2.lead')}</Lead></Reveal>
            <Reveal>
              <WhyBlock>
                <WhyTitle>{S('why2.p0title')}</WhyTitle>
                <Body>{S('why2.p0')}</Body>
              </WhyBlock>
            </Reveal>
            <Reveal>
              <WhyBlock>
                <WhyTitle>{S('why2.p1title')}</WhyTitle>
                <Body>{S('why2.p1')}</Body>
              </WhyBlock>
            </Reveal>
          </Narrow>
        </Container>
      </Section>

      {/* 마무리 CTA */}
      <FinalSection>
        <Container>
          <Reveal><FinalTitle>{S('final.title')}</FinalTitle></Reveal>
          <Reveal><FinalSub>{S('final.sub')}</FinalSub></Reveal>
          <Reveal>
            <HeroActions>
              <PrimaryCta to={AUDIT_URL}>{S('final.cta')}</PrimaryCta>
              <SecondaryCta to={QUOTE_URL}>{S('ctaSecondary')}</SecondaryCta>
            </HeroActions>
          </Reveal>
        </Container>
      </FinalSection>
    </LandingLayout>
  );
};

export default ServicePage;

// ─── styled ───
const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
const Narrow = styled.div`max-width: 760px; margin: 0 auto;`;

const SubHero = styled.section`
  padding: 96px 0 72px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const TitleTop = styled.div`
  font-size: 0.9375rem; font-weight: 600; color: #0D9488;
  margin-bottom: 12px; word-break: keep-all;
`;
const Title = styled.h1`
  font-size: 2.75rem; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  white-space: pre-line;
  @media (max-width: 768px) { font-size: 1.875rem; }
`;
const Sub = styled.p`
  font-size: 1.0625rem; font-weight: 300; color: #64748B;
  line-height: 1.8; max-width: 680px; margin: 0 auto; word-break: keep-all;
`;
const HeroActions = styled.div`
  display: flex; justify-content: center; flex-wrap: wrap; gap: 12px;
  margin-top: 32px;
`;
const PrimaryCta = styled(Link)`
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 48px; padding: 0 28px;
  border-radius: 999px; background: #0F766E; color: #FFFFFF;
  font-size: 0.9375rem; font-weight: 600; text-decoration: none;
  transition: background 0.2s, transform 0.2s;
  &:hover { background: #115E59; transform: translateY(-1px); }
`;
const SecondaryCta = styled(Link)`
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 48px; padding: 0 28px;
  border-radius: 999px; background: #FFFFFF; color: #0F766E;
  border: 1px solid #99F6E4;
  font-size: 0.9375rem; font-weight: 600; text-decoration: none;
  transition: background 0.2s, border-color 0.2s;
  &:hover { background: #F0FDFA; border-color: #5EEAD4; }
`;
const ByLine = styled.div`
  margin-top: 20px; font-size: 0.8125rem; color: #94A3B8; word-break: keep-all;
`;

const Section = styled.section<{ $bg: string; $dark?: boolean }>`
  padding: 88px 0;
  background: ${p => p.$bg};
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
  @media (max-width: 640px) { padding: 60px 0; }
`;
const SectionTitle = styled.h2<{ $light?: boolean }>`
  font-size: 2rem; font-weight: 700; margin: 0 0 14px;
  color: ${p => (p.$light ? '#FFFFFF' : '#0F172A')};
  letter-spacing: -0.4px; word-break: keep-all;
  @media (max-width: 768px) { font-size: 1.5rem; }
`;
const SectionSub = styled.p<{ $light?: boolean }>`
  font-size: 1rem; font-weight: 300; line-height: 1.8; margin: 0 0 40px;
  color: ${p => (p.$light ? 'rgba(255,255,255,0.72)' : '#64748B')};
  max-width: 720px; word-break: keep-all;
`;
const Lead = styled.p`
  font-size: 1.1875rem; font-weight: 500; color: #0F172A;
  line-height: 1.8; margin: 0 0 20px; word-break: keep-all;
  @media (max-width: 768px) { font-size: 1.0625rem; }
`;
const Body = styled.p`
  font-size: 1rem; font-weight: 300; color: #475569;
  line-height: 1.9; margin: 0 0 18px; word-break: keep-all;
`;
const Accent = styled.p`
  font-size: 1.0625rem; font-weight: 600; color: #0F766E;
  line-height: 1.8; margin: 0 0 18px; word-break: keep-all;
`;

const Grid = styled.div<{ $cols: 3 | 4 }>`
  display: grid; gap: 16px;
  grid-template-columns: repeat(${p => p.$cols}, 1fr);
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;

const LayerCard = styled.div`
  height: 100%;
  padding: 28px 24px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px;
  display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.2s, box-shadow 0.2s;
  &:hover { border-color: #99F6E4; box-shadow: 0 12px 32px rgba(20,184,166,0.08); }
`;
const LayerNo = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.75rem; font-weight: 600; color: #5EEAD4; letter-spacing: 1px;
`;
const LayerName = styled.h3`font-size: 1.1875rem; font-weight: 700; color: #0F172A; margin: 0;`;
const LayerEn = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.75rem; font-weight: 500; color: #0D9488; letter-spacing: 0.6px;
`;
const LayerDesc = styled.p`
  font-size: 0.875rem; color: #475569; line-height: 1.75; margin: 6px 0 0; word-break: keep-all;
`;
const LayerTags = styled.div`
  margin-top: auto; padding-top: 14px;
  font-size: 0.75rem; color: #94A3B8; line-height: 1.6; word-break: keep-all;
`;

const ServiceList = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const ServiceRow = styled.div`
  display: grid; grid-template-columns: 260px 1fr; gap: 28px;
  padding: 30px 28px;
  background: #FAFBFC; border: 1px solid #E2E8F0; border-radius: 14px;
  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 12px; }
`;
const ServiceHead = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ServiceName = styled.h3`font-size: 1.25rem; font-weight: 700; color: #0F172A; margin: 0; word-break: keep-all;`;
const ServiceEn = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.75rem; font-weight: 500; color: #0D9488; letter-spacing: 0.6px;
`;
const ServiceBody = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const ServiceLead = styled.p`font-size: 1rem; font-weight: 600; color: #0F172A; margin: 0; word-break: keep-all;`;
const ServiceDesc = styled.p`font-size: 0.875rem; color: #475569; line-height: 1.8; margin: 0; word-break: keep-all;`;
const ServiceOut = styled.div`
  margin-top: 6px; padding-top: 14px; border-top: 1px dashed #CBD5E1;
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
`;
const OutLabel = styled.span`
  flex-shrink: 0;
  padding: 2px 10px; border-radius: 999px;
  background: #CCFBF1; color: #0F766E;
  font-size: 0.6875rem; font-weight: 700;
`;
const OutValue = styled.span`font-size: 0.8125rem; color: #475569; line-height: 1.7; word-break: keep-all;`;

const StepList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const StepRow = styled.div`
  padding: 26px 28px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
  display: flex; flex-direction: column; gap: 6px;
`;
const StepNo = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.6875rem; font-weight: 600; color: #5EEAD4; letter-spacing: 2px;
`;
const StepEn = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 1.25rem; font-weight: 600; color: #FFFFFF; letter-spacing: -0.2px;
`;
const StepTitle = styled.div`font-size: 1rem; font-weight: 600; color: #CCFBF1; word-break: keep-all;`;
const StepDesc = styled.p`
  font-size: 0.875rem; font-weight: 300; color: rgba(255,255,255,0.7);
  line-height: 1.8; margin: 4px 0 0; word-break: keep-all;
`;

const OutputCard = styled.div`
  height: 100%;
  padding: 22px 20px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column; gap: 6px;
  transition: border-color 0.2s;
  &:hover { border-color: #99F6E4; }
`;
const OutputName = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; word-break: keep-all;`;
const OutputDesc = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.65; word-break: keep-all;`;

const FitList = styled.div`
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const FitItem = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
  padding: 18px 20px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  font-size: 0.9375rem; color: #334155; line-height: 1.6; word-break: keep-all;
`;
const FitMark = styled.span`
  flex-shrink: 0; width: 8px; height: 8px; margin-top: 8px;
  border-radius: 50%; background: #14B8A6;
`;

const FaqItem = styled.div`
  padding: 26px 0; border-bottom: 1px solid #E2E8F0;
  &:last-child { border-bottom: none; }
`;
const FaqQ = styled.h3`
  font-size: 1.0625rem; font-weight: 700; color: #0F172A;
  margin: 0 0 10px; word-break: keep-all;
`;
const FaqA = styled.p`
  font-size: 0.9375rem; font-weight: 300; color: #475569;
  line-height: 1.9; margin: 0; word-break: keep-all;
`;

const WhyBlock = styled.div`margin-bottom: 24px;`;
const WhyTitle = styled.h3`
  font-size: 1.0625rem; font-weight: 700; color: #0F172A;
  margin: 0 0 8px; word-break: keep-all;
`;

const FinalSection = styled.section`
  padding: 96px 0 110px;
  background: linear-gradient(180deg, #FFFFFF 0%, #F0FDFA 100%);
  text-align: center;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const FinalTitle = styled.h2`
  font-size: 2.125rem; font-weight: 700; color: #0F172A;
  line-height: 1.4; margin: 0 0 16px; white-space: pre-line; word-break: keep-all;
  @media (max-width: 768px) { font-size: 1.5rem; }
`;
const FinalSub = styled.p`
  font-size: 1rem; font-weight: 300; color: #64748B;
  line-height: 1.8; max-width: 620px; margin: 0 auto; word-break: keep-all;
`;
