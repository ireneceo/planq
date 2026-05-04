// 랜딩 메인 — 검색·광고로 들어온 비로그인 첫 방문자가 보는 페이지.
// 8 섹션 — Hero / 문제 / 솔루션 / Q시리즈 / 사용 사례 / 요금제 / FAQ / 마지막 CTA.
// 디자인 톤: 모던 SaaS (Notion/Linear 류). 디자인 자료 받기 전 스켈레톤 + 카피.
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation, Trans } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';

const Q_SERIES = ['talk', 'task', 'note', 'file', 'bill'] as const;
const USECASES = ['solo', 'studio', 'consulting'] as const;
const PLANS = ['free', 'basic', 'pro'] as const;
const FAQ_KEYS = ['data', 'cancel', 'team', 'ios', 'security'] as const;

const HomePage: React.FC = () => {
  const { t } = useTranslation('landing');

  return (
    <LandingLayout>
      {/* 1. Hero */}
      <HeroSection>
        <HeroInner>
          <HeroLeft>
            <HeroBadge>
              <BadgeDot /> {t('hero.badge', '한국 사업자를 위한 업무 OS')}
            </HeroBadge>
            <HeroTitle>
              <Trans i18nKey="hero.title" ns="landing" components={{ 1: <Accent />, br: <br /> }} />
            </HeroTitle>
            <HeroSubtitle>{t('hero.subtitle', '고객 채팅·업무·청구를 하나로 — Q Talk·Q Task·Q Bill 이 흩어진 일을 정리하고, 잃어버릴 뻔한 매출을 되찾습니다.')}</HeroSubtitle>
            <HeroCtaRow>
              <HeroPrimary to="/register">{t('hero.ctaPrimary', '무료로 시작하기')}</HeroPrimary>
              <HeroSecondary to="/pricing">{t('hero.ctaSecondary', '요금제 보기')}</HeroSecondary>
            </HeroCtaRow>
            <HeroNote>{t('hero.note', '신용카드 없이 14일 무료 — 언제든 취소')}</HeroNote>
          </HeroLeft>
          <HeroRight>
            <MockupFrame aria-hidden="true">
              <MockupBar>
                <Dot $color="#EF4444" /><Dot $color="#F59E0B" /><Dot $color="#22C55E" />
                <MockupUrl>app.planq.kr/inbox</MockupUrl>
              </MockupBar>
              <MockupBody>
                <MockupHint>{t('hero.mockupHint', '인박스 · 업무 · 청구 한 화면')}</MockupHint>
              </MockupBody>
            </MockupFrame>
          </HeroRight>
        </HeroInner>
      </HeroSection>

      {/* 2. 문제 제시 */}
      <Section $bg="#F8FAFC">
        <SectionInner>
          <SectionEyebrow>{t('problem.eyebrow', '익숙한 풍경')}</SectionEyebrow>
          <SectionTitle>{t('problem.title', '고객 메시지·업무·청구가 흩어져 있나요?')}</SectionTitle>
          <ProblemGrid>
            {[0, 1, 2].map(i => (
              <ProblemCard key={i}>
                <ProblemIcon>{['💬', '📌', '💸'][i]}</ProblemIcon>
                <ProblemTitle>{t(`problem.items.${i}.title`)}</ProblemTitle>
                <ProblemDesc>{t(`problem.items.${i}.desc`)}</ProblemDesc>
              </ProblemCard>
            ))}
          </ProblemGrid>
        </SectionInner>
      </Section>

      {/* 3. 솔루션 한 줄 */}
      <Section>
        <SectionInner $center>
          <SectionEyebrow>{t('solution.eyebrow', '해결책')}</SectionEyebrow>
          <SectionTitle>{t('solution.title', 'PlanQ 가 통합합니다')}</SectionTitle>
          <SolutionDesc>{t('solution.desc', '대화·업무·문서·파일·청구가 한 워크스페이스에. 고객 한 명마다 흩어진 정보를 하나로 묶고, AI 가 다음 행동을 제안합니다.')}</SolutionDesc>
        </SectionInner>
      </Section>

      {/* 4. Q시리즈 5 카드 */}
      <Section $bg="#F8FAFC">
        <SectionInner>
          <SectionEyebrow>{t('features.eyebrow', '핵심 기능')}</SectionEyebrow>
          <SectionTitle>{t('features.title', 'Q 시리즈로 일을 정리합니다')}</SectionTitle>
          <FeatureGrid>
            {Q_SERIES.map(k => (
              <FeatureCard key={k}>
                <FeatureLabel>Q {k}</FeatureLabel>
                <FeatureName>{t(`features.q.${k}.name`)}</FeatureName>
                <FeatureDesc>{t(`features.q.${k}.desc`)}</FeatureDesc>
              </FeatureCard>
            ))}
          </FeatureGrid>
        </SectionInner>
      </Section>

      {/* 5. 사용 사례 / 페르소나 */}
      <Section>
        <SectionInner>
          <SectionEyebrow>{t('usecases.eyebrow', '누가 쓰나요')}</SectionEyebrow>
          <SectionTitle>{t('usecases.title', '고객을 직접 응대하는 모든 팀')}</SectionTitle>
          <UseGrid>
            {USECASES.map(k => (
              <UseCard key={k}>
                <UseTitle>{t(`usecases.items.${k}.title`)}</UseTitle>
                <UseDesc>{t(`usecases.items.${k}.desc`)}</UseDesc>
              </UseCard>
            ))}
          </UseGrid>
        </SectionInner>
      </Section>

      {/* 6. 요금제 프리뷰 */}
      <Section $bg="#F8FAFC">
        <SectionInner>
          <SectionEyebrow>{t('pricing.eyebrow', '요금제')}</SectionEyebrow>
          <SectionTitle>{t('pricing.title', '시작은 무료, 필요한 만큼 확장')}</SectionTitle>
          <PriceGrid>
            {PLANS.map(p => (
              <PriceCard key={p} $featured={p === 'basic'}>
                {p === 'basic' && <PriceBadge>{t('pricing.recommended', '추천')}</PriceBadge>}
                <PriceName>{t(`pricing.plans.${p}.name`)}</PriceName>
                <PriceAmount>{t(`pricing.plans.${p}.price`)}</PriceAmount>
                <PriceSub>{t(`pricing.plans.${p}.sub`)}</PriceSub>
                <PriceList>
                  {[0, 1, 2, 3].map(i => (
                    <PriceItem key={i}>· {t(`pricing.plans.${p}.features.${i}`)}</PriceItem>
                  ))}
                </PriceList>
                <PriceCta to="/register">{t(`pricing.plans.${p}.cta`)}</PriceCta>
              </PriceCard>
            ))}
          </PriceGrid>
          <PriceMore to="/pricing">{t('pricing.viewAll', '요금제 자세히 보기')} →</PriceMore>
        </SectionInner>
      </Section>

      {/* 7. FAQ */}
      <Section>
        <SectionInner>
          <SectionEyebrow>{t('faq.eyebrow', '자주 묻는 질문')}</SectionEyebrow>
          <SectionTitle>{t('faq.title', '시작 전에 확인하세요')}</SectionTitle>
          <FaqList>
            {FAQ_KEYS.map(k => (
              <FaqItem key={k}>
                <FaqQ>{t(`faq.items.${k}.q`)}</FaqQ>
                <FaqA>{t(`faq.items.${k}.a`)}</FaqA>
              </FaqItem>
            ))}
          </FaqList>
        </SectionInner>
      </Section>

      {/* 8. 마지막 CTA */}
      <FinalCta>
        <FinalInner>
          <FinalTitle>{t('finalCta.title', '오늘부터 정리된 워크스페이스')}</FinalTitle>
          <FinalSub>{t('finalCta.sub', '14일 무료 체험. 신용카드 필요 없습니다.')}</FinalSub>
          <FinalBtn to="/register">{t('finalCta.cta', '무료로 시작하기')}</FinalBtn>
        </FinalInner>
      </FinalCta>
    </LandingLayout>
  );
};

export default HomePage;

// ─── styled ───
const HeroSection = styled.section`
  padding: 80px 0 64px;
  background:
    radial-gradient(ellipse at top right, #F0FDFA 0%, transparent 50%),
    radial-gradient(ellipse at bottom left, #FFF1F2 0%, transparent 50%),
    #FFFFFF;
  @media (max-width: 768px) { padding: 56px 0 40px; }
`;
const HeroInner = styled.div`
  max-width: 1200px; margin: 0 auto; padding: 0 24px;
  display: grid; grid-template-columns: 1.1fr 1fr;
  gap: 56px; align-items: center;
  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 40px; }
  @media (max-width: 640px) { padding: 0 16px; }
`;
const HeroLeft = styled.div`display: flex; flex-direction: column; gap: 20px;`;
const HeroBadge = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  align-self: flex-start;
  padding: 6px 12px;
  background: #F0FDFA; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 12px; font-weight: 600;
`;
const BadgeDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%; background: #14B8A6;
`;
const HeroTitle = styled.h1`
  font-size: 56px; font-weight: 800; line-height: 1.08; letter-spacing: -1.2px;
  color: #0F172A; margin: 0;
  @media (max-width: 900px) { font-size: 44px; }
  @media (max-width: 640px) { font-size: 36px; }
`;
const Accent = styled.span`color: #F43F5E;`;
const HeroSubtitle = styled.p`
  font-size: 18px; line-height: 1.6; color: #475569;
  margin: 0; max-width: 540px;
  @media (max-width: 640px) { font-size: 16px; }
`;
const HeroCtaRow = styled.div`
  display: flex; gap: 12px; margin-top: 8px;
  @media (max-width: 480px) { flex-direction: column; }
`;
const HeroPrimary = styled(Link)`
  height: 48px; padding: 0 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 10px;
  font-size: 15px; font-weight: 700;
  text-decoration: none;
  transition: background 0.15s, transform 0.15s;
  &:hover { background: #0D9488; transform: translateY(-1px); }
`;
const HeroSecondary = styled(Link)`
  height: 48px; padding: 0 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FFFFFF; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 10px;
  font-size: 15px; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #F8FAFC; }
`;
const HeroNote = styled.div`font-size: 12px; color: #94A3B8; margin-top: 4px;`;
const HeroRight = styled.div`
  display: flex; justify-content: center;
  @media (max-width: 900px) { display: none; }
`;
const MockupFrame = styled.div`
  width: 100%; max-width: 540px; aspect-ratio: 16 / 11;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
  overflow: hidden;
  display: flex; flex-direction: column;
`;
const MockupBar = styled.div`
  height: 36px; flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 0 14px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
`;
const Dot = styled.span<{ $color: string }>`
  width: 10px; height: 10px; border-radius: 50%; background: ${p => p.$color};
`;
const MockupUrl = styled.div`
  margin-left: 14px; font-size: 11px; color: #94A3B8;
`;
const MockupBody = styled.div`
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  background:
    repeating-linear-gradient(45deg, #F1F5F9 0 8px, transparent 8px 16px),
    #FAFBFC;
`;
const MockupHint = styled.div`
  padding: 8px 14px;
  background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 999px;
  font-size: 12px; font-weight: 600;
`;

const Section = styled.section<{ $bg?: string }>`
  padding: 80px 0;
  background: ${p => p.$bg || '#FFFFFF'};
  @media (max-width: 768px) { padding: 56px 0; }
`;
const SectionInner = styled.div<{ $center?: boolean }>`
  max-width: 1200px; margin: 0 auto; padding: 0 24px;
  display: flex; flex-direction: column; gap: 32px;
  ${p => p.$center && `align-items: center; text-align: center;`}
  @media (max-width: 640px) { padding: 0 16px; gap: 24px; }
`;
const SectionEyebrow = styled.div`
  font-size: 12px; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 1px;
`;
const SectionTitle = styled.h2`
  font-size: 36px; font-weight: 800; letter-spacing: -0.6px;
  color: #0F172A; margin: 0; max-width: 720px;
  @media (max-width: 640px) { font-size: 28px; }
`;
const SolutionDesc = styled.p`
  font-size: 18px; line-height: 1.7; color: #475569;
  margin: 0; max-width: 680px;
  @media (max-width: 640px) { font-size: 16px; }
`;

const ProblemGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const ProblemCard = styled.div`
  padding: 24px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px;
`;
const ProblemIcon = styled.div`font-size: 28px; margin-bottom: 12px;`;
const ProblemTitle = styled.div`
  font-size: 16px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const ProblemDesc = styled.div`
  font-size: 14px; line-height: 1.6; color: #64748B;
`;

const FeatureGrid = styled.div`
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;
  @media (max-width: 1024px) { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 640px) { grid-template-columns: 1fr 1fr; }
`;
const FeatureCard = styled.div`
  padding: 20px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, transform 0.15s;
  &:hover { border-color: #99F6E4; transform: translateY(-2px); }
`;
const FeatureLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #0D9488;
  text-transform: lowercase; letter-spacing: 0.4px;
`;
const FeatureName = styled.div`
  font-size: 15px; font-weight: 700; color: #0F172A;
`;
const FeatureDesc = styled.div`
  font-size: 12px; line-height: 1.5; color: #64748B;
`;

const UseGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const UseCard = styled.div`
  padding: 24px;
  background: linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%);
  border: 1px solid #E2E8F0; border-radius: 14px;
`;
const UseTitle = styled.div`
  font-size: 16px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const UseDesc = styled.div`
  font-size: 14px; line-height: 1.6; color: #64748B;
`;

const PriceGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const PriceCard = styled.div<{ $featured?: boolean }>`
  position: relative;
  padding: 28px 24px;
  background: #FFFFFF;
  border: ${p => p.$featured ? '2px solid #14B8A6' : '1px solid #E2E8F0'};
  border-radius: 14px;
  display: flex; flex-direction: column; gap: 12px;
`;
const PriceBadge = styled.span`
  position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
  padding: 4px 12px;
  background: #14B8A6; color: #FFFFFF;
  border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
`;
const PriceName = styled.div`
  font-size: 14px; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 0.6px;
`;
const PriceAmount = styled.div`
  font-size: 32px; font-weight: 800; color: #0F172A; letter-spacing: -0.6px;
`;
const PriceSub = styled.div`font-size: 12px; color: #94A3B8;`;
const PriceList = styled.ul`
  list-style: none; padding: 0; margin: 8px 0;
  display: flex; flex-direction: column; gap: 8px;
`;
const PriceItem = styled.li`font-size: 13px; color: #475569; line-height: 1.5;`;
const PriceCta = styled(Link)`
  margin-top: auto;
  height: 40px; padding: 0 16px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #FFFFFF;
  border-radius: 8px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const PriceMore = styled(Link)`
  align-self: center;
  font-size: 13px; color: #0D9488; font-weight: 600;
  text-decoration: none;
  &:hover { text-decoration: underline; }
`;

const FaqList = styled.div`
  display: flex; flex-direction: column; gap: 12px;
  max-width: 800px;
`;
const FaqItem = styled.div`
  padding: 20px 24px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
`;
const FaqQ = styled.div`
  font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const FaqA = styled.div`
  font-size: 14px; line-height: 1.6; color: #475569;
`;

const FinalCta = styled.section`
  padding: 80px 0;
  background: linear-gradient(135deg, #0F766E 0%, #14B8A6 100%);
  color: #FFFFFF;
  @media (max-width: 768px) { padding: 56px 0; }
`;
const FinalInner = styled.div`
  max-width: 800px; margin: 0 auto; padding: 0 24px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 16px;
`;
const FinalTitle = styled.h2`
  font-size: 36px; font-weight: 800; margin: 0; letter-spacing: -0.6px;
  @media (max-width: 640px) { font-size: 28px; }
`;
const FinalSub = styled.p`
  font-size: 16px; opacity: 0.9; margin: 0;
`;
const FinalBtn = styled(Link)`
  margin-top: 12px;
  height: 52px; padding: 0 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FFFFFF; color: #0F766E;
  border-radius: 10px;
  font-size: 16px; font-weight: 700;
  text-decoration: none;
  transition: transform 0.15s;
  &:hover { transform: translateY(-2px); }
`;
