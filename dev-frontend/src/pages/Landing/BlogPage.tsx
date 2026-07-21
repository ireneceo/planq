// 인사이트 (블로그) 페이지 — SEO/AEO + 가이드/홍보 영상.
// KNOWLEDGE_LOOP 축3 — 콘텐츠 소스는 Q위키(help_articles 의 블로그 발행분). 별도 CMS 없음.
// 카테고리 5종: 가이드 영상 / 홍보 영상 / 사용 가이드 / 자동화 인사이트 / 고객 사례.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

// #194 — 'updates'(제품 소식·체인지로그) 탭 추가. /changelog → /insights?category=updates 로 착지.
const CATEGORIES = ['all', 'updates', 'guide-video', 'brand-video', 'how-to', 'insights', 'cases'] as const;
type Category = typeof CATEGORIES[number];

export interface BlogPostCard {
  slug: string;
  title_ko: string; title_en: string;
  summary_ko?: string | null; summary_en?: string | null;
  blog_category?: string | null;
  published_at: string;
  est_minutes?: number | null;
}

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const BlogPage: React.FC = () => {
  const { t, i18n } = useTranslation('landing');
  const [searchParams] = useSearchParams();
  // #194 — URL ?category= 로 초기 탭 결정 (/changelog redirect 가 updates 로 착지).
  const initialCategory = (() => {
    const c = searchParams.get('category');
    return c && (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : 'all';
  })();
  const [active, setActive] = useState<Category>(initialCategory);
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<BlogPostCard[] | null>(null);

  useEffect(() => {
    fetch('/api/blog/posts')
      .then((r) => r.json())
      .then((j) => setPosts(j.success ? (j.data || []) : []))
      .catch(() => setPosts([]));
  }, []);

  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';
  const pick = (p: BlogPostCard, k: 'title' | 'summary') =>
    (lang === 'en' ? p[`${k}_en` as const] : p[`${k}_ko` as const]) || p[`${k}_ko` as const] || p[`${k}_en` as const] || '';
  // 검색 (#146) — 목록이 이미 전량 내려오므로(서버 limit 100) 여기서 거른다. 제목·요약을 본다.
  const q = query.trim().toLowerCase();
  const filtered = (posts || []).filter((p) => {
    if (active !== 'all' && p.blog_category !== active) return false;
    if (!q) return true;
    return `${pick(p, 'title')} ${pick(p, 'summary')}`.toLowerCase().includes(q);
  });
  const hasAnyPosts = (posts || []).length > 0;

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
            <SearchWrap>
              <SearchIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </SearchIcon>
              <SearchInput
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('blogPage.searchPlaceholder', '검색') as string}
                aria-label={t('blogPage.searchPlaceholder', '검색') as string}
              />
            </SearchWrap>
          </FilterRow>
        </Container>
      </FilterBar>

      <ContentSection>
        <Container>
          {posts === null ? null : filtered.length > 0 ? (
            <Reveal>
              <PreviewGrid>
                {filtered.map((p) => (
                  <PostCardLink key={p.slug} to={`/insights/${p.slug}`}>
                    <PreviewCard as="div">
                      <PreviewBadge>{t(`blogPage.categories.${p.blog_category || 'insights'}`, p.blog_category || '')}</PreviewBadge>
                      <PreviewItemTitle>{pick(p, 'title')}</PreviewItemTitle>
                      {pick(p, 'summary') && <PreviewItemDesc>{pick(p, 'summary')}</PreviewItemDesc>}
                      <PostMeta>
                        <span>{new Date(p.published_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                        {p.est_minutes ? <span>· {t('blogPage.readMinutes', '{{n}}분', { n: p.est_minutes })}</span> : null}
                      </PostMeta>
                    </PreviewCard>
                  </PostCardLink>
                ))}
              </PreviewGrid>
            </Reveal>
          ) : hasAnyPosts ? (
            /* 글은 있는데 검색·필터에 안 걸린 경우 — "곧 시작합니다" 를 띄우면 글이 없는 줄 안다 (#146) */
            <Reveal>
              <EmptyState>
                <EmptyIcon>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </EmptyIcon>
                <EmptyTitle>{t('blogPage.noResults.title', '검색 결과가 없습니다')}</EmptyTitle>
                <EmptyDesc>{t('blogPage.noResults.desc', '다른 검색어나 카테고리를 선택해 보세요.')}</EmptyDesc>
                <ResetBtn type="button" onClick={() => { setQuery(''); setActive('all'); }}>
                  {t('blogPage.noResults.reset', '검색 초기화')}
                </ResetBtn>
              </EmptyState>
            </Reveal>
          ) : (
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
          )}
        </Container>
      </ContentSection>

      {!hasAnyPosts && (
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
      )}

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
  display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center;
`;
/* 검색 (#146) — 카테고리 칩 옆. 좁은 화면에선 한 줄을 통째로 차지한다. */
const SearchWrap = styled.div`
  position: relative; display: flex; align-items: center;
  @media (max-width: 640px) { width: 100%; }
`;
const SearchIcon = styled.svg`
  position: absolute; left: 12px; width: 15px; height: 15px; color: #94A3B8; pointer-events: none;
`;
const SearchInput = styled.input`
  height: 36px; width: 200px; padding: 0 12px 0 34px;
  font-family: inherit; font-size: 13px; color: #0F172A;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 18px;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 640px) { width: 100%; }
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
const ResetBtn = styled.button`
  margin-top: 12px;
  padding: 12px 24px; border-radius: 999px; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600;
  color: #0F766E; background: #F0FDFA; border: 1px solid #99F6E4;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
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
const PostCardLink = styled(Link)`
  text-decoration: none; display: block;
`;
const PostMeta = styled.div`
  margin-top: auto; padding-top: 10px;
  display: flex; gap: 4px; font-size: 12px; color: #94A3B8;
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
