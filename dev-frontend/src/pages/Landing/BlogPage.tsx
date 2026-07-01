// 인사이트 (블로그) 페이지 — SEO/AEO + 가이드/홍보 영상.
// 카테고리 5종: 가이드 영상 / 홍보 영상 / 사용 가이드 / 자동화 인사이트 / 고객 사례.
// 컨텐츠는 사용자가 영상·글 줄 때 본격 채움. 지금은 카테고리 + "곧 시작합니다" 빈 상태.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const CATEGORIES = ['all', 'guide-video', 'brand-video', 'how-to', 'insights', 'cases'] as const;
type Category = typeof CATEGORIES[number];

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const BlogPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState<Category>('all');

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('blogPage.eyebrow', 'INSIGHTS')}</Eyebrow>
          <Title>{t('blogPage.title', 'PlanQ가 일하는 방식')}</Title>
          <Sub>{t('blogPage.sub', '가이드 영상 · 홍보 영상 · 사용 가이드 · 업무 자동화 인사이트 · 고객 사례를 한 곳에서.')}</Sub>
        </Container>
      </SubHero>

      <FilterBar>
        <Container>
          <FilterRow role="tablist">
            {CATEGORIES.map(c => (
              <FilterChip
                key={c}
                role="tab"
                aria-selected={active === c}
                $active={active === c}
                onClick={() => setActive(c)}
              >
                {t(`blogPage.categories.${c}`)}
              </FilterChip>
            ))}
          </FilterRow>
        </Container>
      </FilterBar>

      <ContentSection>
        <Container>
          <Reveal>
            <EmptyState>
              <EmptyIcon>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </EmptyIcon>
              <EmptyTitle>{t('blogPage.empty.title', '곧 시작합니다')}</EmptyTitle>
              <EmptyDesc>
                {t('blogPage.empty.desc1', 'PlanQ 사용 가이드 영상, 업무 자동화 인사이트, 고객 사례를 정기 발행할 예정입니다.')}<br />
                {t('blogPage.empty.desc2', '먼저 받아보고 싶다면 무료 체험으로 시작하세요.')}
              </EmptyDesc>
              <EmptyCta to="/register">{t('blogPage.empty.cta', '무료로 시작하기')}</EmptyCta>
            </EmptyState>
          </Reveal>

          {/* 향후 컨텐츠가 들어가면 PostGrid 가 표시됨. 현재는 placeholder cards 노출 안 함. */}
        </Container>
      </ContentSection>

      <PreviewSection>
        <Container>
          <Reveal as="div"><PreviewTag>{t('blogPage.preview.tag', '발행 예정')}</PreviewTag></Reveal>
          <Reveal as="h2"><PreviewTitle>{t('blogPage.preview.title', '곧 만나볼 콘텐츠')}</PreviewTitle></Reveal>
          <Reveal>
            <PreviewGrid>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <PreviewCard key={i}>
                  <PreviewBadge>{t(`blogPage.preview.items.${i}.category`)}</PreviewBadge>
                  <PreviewItemTitle>{t(`blogPage.preview.items.${i}.title`)}</PreviewItemTitle>
                  <PreviewItemDesc>{t(`blogPage.preview.items.${i}.desc`)}</PreviewItemDesc>
                </PreviewCard>
              ))}
            </PreviewGrid>
          </Reveal>
        </Container>
      </PreviewSection>

      <CtaBand>
        <Container>
          <CtaTitle>{t('blogPage.cta.title', '글로 보기 전에 직접 써 보세요')}</CtaTitle>
          <CtaSub>{t('blogPage.cta.sub', '14일 무료 체험. 신용카드 필요 없습니다.')}</CtaSub>
          <CtaBtn to="/register">{t('blogPage.cta.btn', '무료로 시작하기')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default BlogPage;

// ─── styled ───
const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
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
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 32px; }
`;
const Sub = styled.p`
  font-size: 17px; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 720px; margin: 0 auto;
  word-break: keep-all;
`;

const FilterBar = styled.div`
  position: sticky; top: 64px; z-index: 50;
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid #E2E8F0;
  padding: 12px 0;
`;
const FilterRow = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
`;
const FilterChip = styled.button<{ $active: boolean }>`
  height: 36px; padding: 0 16px;
  background: ${p => p.$active ? '#14B8A6' : '#FFFFFF'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0D9488' : '#E2E8F0'};
  border-radius: 999px;
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
`;

const ContentSection = styled.section`
  padding: 64px 0; background: #FFFFFF;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const EmptyState = styled.div`
  padding: 80px 24px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 14px;
`;
const EmptyIcon = styled.div`
  width: 88px; height: 88px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0D9488;
  border-radius: 24px;
  margin-bottom: 8px;
`;
const EmptyTitle = styled.h2`
  font-size: 24px; font-weight: 700; color: #0F172A; margin: 0;
  @media (max-width: 768px) { font-size: 20px; }
`;
const EmptyDesc = styled.p`
  font-size: 15px; font-weight: 300; color: #64748B; line-height: 1.8;
  max-width: 480px; margin: 0;
  word-break: keep-all;
`;
const EmptyCta = styled(Link)`
  margin-top: 12px;
  padding: 14px 28px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 14px; font-weight: 500;
  text-decoration: none;
  transition: all 0.15s;
  &:hover { background: #0D9488; transform: translateY(-1px); }
`;

const PreviewSection = styled.section`
  padding: 96px 0; background: #FAFBFC;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
`;
const PreviewTag = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 12px;
`;
const PreviewTitle = styled.h2`
  font-size: 28px; font-weight: 700; color: #0F172A;
  margin: 0 0 32px; letter-spacing: -0.4px;
  @media (max-width: 768px) { font-size: 22px; }
`;
const PreviewGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const PreviewCard = styled.article`
  padding: 24px 24px 28px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px;
  display: flex; flex-direction: column; gap: 10px;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
  &:hover { border-color: #99F6E4; transform: translateY(-2px); box-shadow: 0 12px 32px rgba(20,184,166,0.08); }
`;
const PreviewBadge = styled.div`
  align-self: flex-start;
  padding: 4px 10px;
  background: #F0FDFA; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
  font-family: 'Outfit', sans-serif;
`;
const PreviewItemTitle = styled.h3`
  font-size: 17px; font-weight: 700; color: #0F172A;
  line-height: 1.4; margin: 4px 0 0; word-break: keep-all;
`;
const PreviewItemDesc = styled.p`
  font-size: 13px; color: #64748B; line-height: 1.7;
  margin: 0; word-break: keep-all;
`;

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
