// 요금제 페이지 — Free / Starter / Basic / Pro 4 plan + Addon + FAQ.
// 2026-11-25 무료 재도입(docs/FREE_PLAN_PROPOSAL_2026-11-25.md) — 0원 칸 + «팀이라면 30일 팀 체험» + «무료 한도는 조정될 수 있음».
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const PLANS = ['free', 'starter', 'basic', 'pro'] as const;
// 가입 화면 ?plan= — 무료는 혼자 체험(starter)으로 들어가 끝나면 무료로 내려온다(서버 trial.expireTrialToFree)
const SIGNUP_PLAN: Record<typeof PLANS[number], string> = { free: 'starter', starter: 'starter', basic: 'basic', pro: 'pro' };
const FAQ_KEYS = ['cancel', 'team', 'data', 'ownership', 'addon', 'enterprise'] as const;

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
          <Sub>{t('pricingPage.sub')}</Sub>
          {/* 사업자·조직 전용 판매 — App Store 3.1.1 대응(2026-11-16). 약관 «사업 목적 전용» 조항과 같은 말 */}
          <BizOnly data-testid="pricing-biz-only">{t('pricingPage.bizOnly')}</BizOnly>
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
                  <PlanCta data-testid={`pricing-cta-${p}`} to={`/register?plan=${SIGNUP_PLAN[p]}`} $featured={p === 'basic'}>{t(`pricingPage.plans.${p}.cta`)}</PlanCta>
                </PlanCard>
              </Reveal>
            ))}
          </PlansGrid>
          <PlansFoot>
            <TeamTrialLink to="/register?plan=basic" data-testid="pricing-team-trial">{t('pricingPage.teamTrialCta', '팀이라면 30일 동안 다 같이 먼저 써 보세요')} →</TeamTrialLink>
            <FreeNote data-testid="pricing-free-note">{t('pricingPage.freeNote', '무료 플랜의 한도는 서비스 운영에 따라 조정될 수 있습니다.')}</FreeNote>
          </PlansFoot>
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
          {/* 2026-10-12 Fable 판정 — 컨설팅(워프로랩 스튜디오)은 요금표에 넣지 않는다(끼워팔기 금지, 2026-06-23).
              요금제와는 이 한 줄로만 잇는다. 가격·열·상품을 여기에 더하지 말 것. */}
          <ConsultBand data-testid="pricing-consulting-band">
            <ConsultText>{t('pricingPage.consulting.text', '직접 세팅하기 어렵다면 — 업무체계 설계부터 구축까지 전문가가 함께합니다 (워프로랩 스튜디오)')}</ConsultText>
            <ConsultLink to="/service">{t('pricingPage.consulting.link', '컨설팅 보기 →')}</ConsultLink>
          </ConsultBand>
        </Container>
      </FaqSection>

      <CtaBand>
        <Container>
          <CtaTitle>{t('pricingPage.cta.title', '14일 무료 체험으로 시작하세요')}</CtaTitle>
          <CtaSub>{t('pricingPage.cta.sub', '신용카드 정보 없이 가입하고, 마음에 들면 그때 결제하세요.')}</CtaSub>
          <CtaBtn to="/register">{t('pricingPage.cta.btn', '무료로 시작하기')}</CtaBtn>
          <CtaCallLink to="/contact?type=onboarding" data-testid="pricing-call-link">{t('pricingPage.cta.call', '화상으로 업무 설계·사용 안내 받기 →')}</CtaCallLink>
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
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 2.75rem; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all;
  margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 2rem; }
`;
const Sub = styled.p`
  font-size: 1.0625rem; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 640px; margin: 0 auto;
`;

const BizOnly = styled.p`
  margin: 12px auto 0; max-width: 640px; font-size: 0.875rem; line-height: 1.6; color: #475569;
`;
const PlansSection = styled.section`padding: 64px 0 96px; background: #FFFFFF;`;
const PlansGrid = styled.div`
  /* minmax(0,1fr) — 1fr 만 쓰면 큰 가격 글자의 최소 폭 때문에 칸 폭이 제각각이 된다(무료 칸이 찌그러졌다 2026-11-25 실측) */
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;
  align-items: stretch;
  @media (max-width: 1180px) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  & > .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  & > .reveal.in { opacity: 1; transform: none; }
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const PlansFoot = styled.div`
  margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
`;
const TeamTrialLink = styled(Link)`
  font-size: 0.9375rem; font-weight: 600; color: #0D9488; text-decoration: none;
  min-height: 44px; display: inline-flex; align-items: center;
  &:hover { text-decoration: underline; }
`;
const FreeNote = styled.p`
  margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.6;
`;
const PlanCard = styled.div<{ $featured?: boolean }>`
  position: relative;
  height: 100%;
  padding: 36px 24px;
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
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.4px;
`;
const PlanName = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.875rem; font-weight: 500; color: #0D9488;
  text-transform: uppercase; letter-spacing: 1px;
`;
const PlanPrice = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 2.125rem; font-weight: 600; color: #0F172A;
  letter-spacing: -1px; line-height: 1.1;
`;
const PlanSub = styled.div`font-size: 0.8125rem; color: #94A3B8; font-weight: 300;`;
const PlanDivider = styled.div`height: 1px; background: #E2E8F0; margin: 12px 0;`;
const PlanList = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 10px;
  flex: 1;
`;
const PlanItem = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 0.875rem; color: #334155; line-height: 1.6; word-break: keep-all;
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
  font-size: 0.875rem; font-weight: 600;
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
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 12px;
`;
const AddonTitle = styled.h2`
  font-size: 2rem; font-weight: 700; color: #0F172A; margin: 0 0 32px; letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 1.5rem; }
`;
const AddonGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const AddonCard = styled.div`
  padding: 28px 24px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
`;
const AddonName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const AddonPrice = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 1.375rem; font-weight: 600; color: #0D9488;
  margin-bottom: 8px;
`;
const AddonDesc = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.6; word-break: keep-all;`;

const FaqSection = styled.section`
  padding: 96px 0; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const FaqEyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 12px;
`;
const FaqTitle = styled.h2`
  font-size: 2rem; font-weight: 700; color: #0F172A; margin: 0 0 40px; letter-spacing: -0.5px;
  @media (max-width: 768px) { font-size: 1.5rem; }
`;
const FaqList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const FaqItem = styled.div`
  padding: 24px 28px; background: #FAFBFC;
  border: 1px solid #E2E8F0; border-radius: 12px;
`;
const FaqQ = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const FaqA = styled.div`font-size: 0.875rem; line-height: 1.7; color: #475569; word-break: keep-all;`;

const ConsultBand = styled.div`
  margin-top: 40px; padding: 20px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap;
  border: 1px dashed #CBD5E1; border-radius: 12px;
`;
const ConsultText = styled.div`font-size: 0.875rem; color: #475569; line-height: 1.6; word-break: keep-all;`;
const ConsultLink = styled(Link)`
  font-size: 0.875rem; font-weight: 600; color: #0F766E; text-decoration: none; white-space: nowrap;
  &:hover { color: #115E59; text-decoration: underline; }
`;

const CtaBand = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF; text-align: center;
  ${Container} { display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;
const CtaTitle = styled.h2`font-size: 2rem; font-weight: 700; line-height: 1.4; margin: 0; word-break: keep-all; @media (max-width: 768px) { font-size: 1.5rem; }`;
const CtaSub = styled.p`font-size: 0.9375rem; color: #94A3B8; font-weight: 300; margin: 0;`;
const CtaCallLink = styled(Link)`
  font-size: 0.9375rem; color: #5EEAD4; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const CtaBtn = styled(Link)`
  margin-top: 12px;
  padding: 16px 48px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 1rem; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
