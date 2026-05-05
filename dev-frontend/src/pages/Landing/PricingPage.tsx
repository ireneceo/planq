// 요금제 페이지 — Free / Basic / Pro 3 plan + Addon + FAQ.
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const PLANS = ['starter', 'basic', 'pro'] as const;
const FAQ_KEYS = ['cancel', 'team', 'data', 'addon', 'enterprise'] as const;

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const PricingPage: React.FC = () => {
  const { t } = useTranslation('landing');

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('pricingPage.eyebrow', 'PRICING')}</Eyebrow>
          <Title>{t('pricingPage.title', '시작은 무료, 필요한 만큼 확장')}</Title>
          <Sub>{t('pricingPage.sub', '신용카드 없이 14일 무료 체험. 언제든 해지 가능합니다.')}</Sub>
        </Container>
      </SubHero>

      <PlansSection>
        <Container>
          <PlansGrid>
            {PLANS.map((p, i) => (
              <Reveal key={p}>
                <PlanCard $featured={p === 'basic'} style={{ transitionDelay: `${i * 80}ms` }}>
                  {p === 'basic' && <PlanBadge>{t('pricingPage.recommended', '추천')}</PlanBadge>}
                  <PlanName>{t(`pricingPage.plans.${p}.name`)}</PlanName>
                  <PlanPrice>{t(`pricingPage.plans.${p}.price`)}</PlanPrice>
                  <PlanSub>{t(`pricingPage.plans.${p}.sub`)}</PlanSub>
                  <PlanDivider />
                  <PlanList>
                    {[0, 1, 2, 3, 4, 5].map(idx => (
                      <PlanItem key={idx}>
                        <Check viewBox="0 0 24 24" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></Check>
                        <span>{t(`pricingPage.plans.${p}.features.${idx}`)}</span>
                      </PlanItem>
                    ))}
                  </PlanList>
                  <PlanCta to="/register" $featured={p === 'basic'}>{t(`pricingPage.plans.${p}.cta`)}</PlanCta>
                </PlanCard>
              </Reveal>
            ))}
          </PlansGrid>
        </Container>
      </PlansSection>

      <AddonSection>
        <Container>
          <Reveal as="div"><AddonEyebrow>{t('pricingPage.addon.eyebrow', 'ADDONS')}</AddonEyebrow></Reveal>
          <Reveal as="h2"><AddonTitle>{t('pricingPage.addon.title', '필요한 만큼 추가하세요')}</AddonTitle></Reveal>
          <Reveal>
            <AddonGrid>
              {[0, 1, 2].map(i => (
                <AddonCard key={i}>
                  <AddonName>{t(`pricingPage.addon.items.${i}.name`)}</AddonName>
                  <AddonPrice>{t(`pricingPage.addon.items.${i}.price`)}</AddonPrice>
                  <AddonDesc>{t(`pricingPage.addon.items.${i}.desc`)}</AddonDesc>
                </AddonCard>
              ))}
            </AddonGrid>
          </Reveal>
        </Container>
      </AddonSection>

      <FaqSection>
        <Container>
          <Reveal as="div"><FaqEyebrow>{t('pricingPage.faq.eyebrow', 'FAQ')}</FaqEyebrow></Reveal>
          <Reveal as="h2"><FaqTitle>{t('pricingPage.faq.title', '결제 전에 확인하세요')}</FaqTitle></Reveal>
          <Reveal>
            <FaqList>
              {FAQ_KEYS.map(k => (
                <FaqItem key={k}>
                  <FaqQ>{t(`pricingPage.faq.items.${k}.q`)}</FaqQ>
                  <FaqA>{t(`pricingPage.faq.items.${k}.a`)}</FaqA>
                </FaqItem>
              ))}
            </FaqList>
          </Reveal>
        </Container>
      </FaqSection>

      <CtaBand>
        <Container>
          <CtaTitle>{t('pricingPage.cta.title', '14일 무료 체험으로 시작하세요')}</CtaTitle>
          <CtaSub>{t('pricingPage.cta.sub', '신용카드 정보 없이 가입하고, 마음에 들면 그때 결제하세요.')}</CtaSub>
          <CtaBtn to="/register">{t('pricingPage.cta.btn', '무료로 시작하기')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default PricingPage;

// ─── styled ───
const Container = styled.div`
  max-width: 1080px; margin: 0 auto; padding: 0 24px;
  @media (max-width: 640px) { padding: 0 16px; }
`;
const SubHero = styled.section`
  padding: 96px 0 56px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 44px; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all;
  margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 32px; }
`;
const Sub = styled.p`
  font-size: 17px; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 640px; margin: 0 auto;
`;

const PlansSection = styled.section`padding: 64px 0 96px; background: #FFFFFF;`;
const PlansGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  align-items: stretch;
  & > .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  & > .reveal.in { opacity: 1; transform: none; }
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const PlanCard = styled.div<{ $featured?: boolean }>`
  position: relative;
  height: 100%;
  padding: 40px 32px;
  background: #FFFFFF;
  border: ${p => p.$featured ? '2px solid #14B8A6' : '1px solid #E2E8F0'};
  border-radius: 16px;
  display: flex; flex-direction: column; gap: 12px;
  ${p => p.$featured && `box-shadow: 0 24px 60px rgba(20,184,166,0.16);`}
`;
const PlanBadge = styled.span`
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  padding: 6px 16px; background: #14B8A6; color: #FFFFFF;
  border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
`;
const PlanName = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 14px; font-weight: 500; color: #0D9488;
  text-transform: uppercase; letter-spacing: 1px;
`;
const PlanPrice = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 40px; font-weight: 600; color: #0F172A;
  letter-spacing: -1px; line-height: 1.1;
`;
const PlanSub = styled.div`font-size: 13px; color: #94A3B8; font-weight: 300;`;
const PlanDivider = styled.div`height: 1px; background: #E2E8F0; margin: 12px 0;`;
const PlanList = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 10px;
  flex: 1;
`;
const PlanItem = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 14px; color: #334155; line-height: 1.6; word-break: keep-all;
`;
const Check = styled.svg`
  width: 18px; height: 18px;
  flex-shrink: 0;
  margin-top: 2px;
  color: #14B8A6; stroke-width: 2.5; fill: none; stroke-linecap: round; stroke-linejoin: round;
`;
const PlanCta = styled(Link)<{ $featured?: boolean }>`
  margin-top: auto;
  padding: 14px 24px; border-radius: 999px;
  background: ${p => p.$featured ? '#14B8A6' : '#FFFFFF'};
  color: ${p => p.$featured ? '#FFFFFF' : '#0F172A'};
  border: 1px solid ${p => p.$featured ? '#14B8A6' : '#E2E8F0'};
  text-align: center;
  font-size: 14px; font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
  &:hover { background: ${p => p.$featured ? '#0D9488' : '#F8FAFC'}; }
`;

const AddonSection = styled.section`
  padding: 96px 0; background: #FAFBFC;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const AddonEyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 12px;
`;
const AddonTitle = styled.h2`
  font-size: 32px; font-weight: 700; color: #0F172A; margin: 0 0 32px; letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 24px; }
`;
const AddonGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const AddonCard = styled.div`
  padding: 28px 24px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
`;
const AddonName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const AddonPrice = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 22px; font-weight: 600; color: #0D9488;
  margin-bottom: 8px;
`;
const AddonDesc = styled.div`font-size: 13px; color: #64748B; line-height: 1.6; word-break: keep-all;`;

const FaqSection = styled.section`
  padding: 96px 0; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const FaqEyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 12px;
`;
const FaqTitle = styled.h2`
  font-size: 32px; font-weight: 700; color: #0F172A; margin: 0 0 40px; letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 24px; }
`;
const FaqList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const FaqItem = styled.div`
  padding: 24px 28px; background: #FAFBFC;
  border: 1px solid #E2E8F0; border-radius: 12px;
`;
const FaqQ = styled.div`font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const FaqA = styled.div`font-size: 14px; line-height: 1.7; color: #475569; word-break: keep-all;`;

const CtaBand = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF; text-align: center;
  ${Container} { display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;
const CtaTitle = styled.h2`font-size: 32px; font-weight: 700; line-height: 1.4; margin: 0; word-break: keep-all; @media (max-width: 768px) { font-size: 24px; }`;
const CtaSub = styled.p`font-size: 15px; color: #94A3B8; font-weight: 300; margin: 0;`;
const CtaBtn = styled(Link)`
  margin-top: 12px;
  padding: 16px 48px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 16px; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
