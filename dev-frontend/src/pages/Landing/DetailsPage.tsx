// «써 보면 놀라는 디테일» — 공개 페이지 /details/ (2026-10-04, Irene: "우리 솔루션 [놀랄만한 디테일 기능] 같은 컨셉으로 정리").
//
// ★ 코드로 확인된 것만 싣는다 — 근거·조건은 docs/marketing/DETAIL_FEATURES.md, 와이어는 DETAIL_PAGE_WIRE.md.
//   문구는 locales landing.json `detailsPage.items.<id>` 한 곳(검색·AI 가 읽는 프리렌더도 같은 키를 읽는다 — seo-pages.json).
// ★ 자랑과 안내를 한 장에 — 카드마다 [사용법](도움말) · 로그인했으면 [바로 써 보기](그 화면).
//   [사용법] 은 **지금 보는 사람이 열 수 있는 글일 때만** 단다(`GET /api/wiki/articles` 가 보는 사람 기준으로 준다).
//   로그인해야 열리는 글을 처음 온 사람에게 걸면 로그인 화면에 막힌다 — 없는 문을 안내하지 않는다.
// ★ 껍데기는 기능 페이지와 공용(components/Landing/landingSections) — 새 디자인을 만들지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { Container, SubHero, Eyebrow, Title, Sub, Group, SmallCard, SmallName, SmallLead, CtaBand, CtaTitle, CtaSub, CtaBtn } from '../../components/Landing/landingSections';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { DETAILS, type DetailArea as Area } from '../../components/Landing/details';

const TABS: Array<'all' | Area> = ['all', 'ai', 'client', 'work', 'docs', 'files', 'bill'];

const DetailsPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | Area>('all');
  const [openable, setOpenable] = useState<Set<string>>(new Set());

  // 보는 사람이 열 수 있는 도움말 slug — 로그인 여부에 따라 서버가 거른다
  useEffect(() => {
    let alive = true;
    apiFetch('/api/wiki/articles?limit=500')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j || !Array.isArray(j.data)) return;
        setOpenable(new Set(j.data.map((a: { slug: string }) => a.slug)));
      })
      .catch(() => null);
    return () => { alive = false; };
  }, [user?.id]);

  const shown = useMemo(() => DETAILS.filter((d) => tab === 'all' || d.area === tab), [tab]);

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('detailsPage.eyebrow')}</Eyebrow>
          <Title>{t('detailsPage.title')}</Title>
          <Sub>{t('detailsPage.sub')}</Sub>
          <HeroCtas>
            <PrimaryLink to={user ? '/dashboard' : '/register'}>{t('detailsPage.ctaStart')}</PrimaryLink>
            <GhostLink to="/features">{t('detailsPage.ctaFeatures')}</GhostLink>
          </HeroCtas>
        </Container>
      </SubHero>

      <Group>
        <Container>
          <Tabs role="tablist" aria-label={t('detailsPage.eyebrow') as string}>
            {TABS.map((k) => (
              <TabChip key={k} type="button" role="tab" aria-selected={tab === k} $active={tab === k}
                data-testid={`details-tab-${k}`} onClick={() => setTab(k)}>
                {t(`detailsPage.tabs.${k}`)}
              </TabChip>
            ))}
          </Tabs>
          <Grid>
            {shown.map((d) => {
              const cond = t(`detailsPage.items.${d.id}.cond`, { defaultValue: '' }) as string;
              const canHelp = !!d.help && openable.has(d.help);
              const canTry = !!user && !!d.app;
              return (
                <Card key={d.id} data-testid={`details-card-${d.id}`}>
                  <AreaChip>{t(`detailsPage.tabs.${d.area}`)}</AreaChip>
                  <SmallName>{t(`detailsPage.items.${d.id}.title`)}</SmallName>
                  <SmallLead>{t(`detailsPage.items.${d.id}.body`)}</SmallLead>
                  {cond && <Cond>{cond}</Cond>}
                  {(canHelp || canTry) && (
                    <CardLinks>
                      {canHelp && <CardLink to={`/guide/a/${d.help}`}>{t('detailsPage.howTo')} →</CardLink>}
                      {canTry && <CardLink to={d.app as string}>{t('detailsPage.tryIt')} →</CardLink>}
                    </CardLinks>
                  )}
                </Card>
              );
            })}
          </Grid>
        </Container>
      </Group>

      <CtaBand>
        <Container>
          <CtaTitle>{t('detailsPage.closingTitle')}</CtaTitle>
          <CtaSub>{t('detailsPage.closingSub')}</CtaSub>
          <CtaBtn to={user ? '/dashboard' : '/register'}>{t('detailsPage.ctaStart')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default DetailsPage;

// ─── styled (이 페이지에만 있는 것 — 탭 칩·카드 링크. 나머지는 landingSections) ───
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
const Tabs = styled.div`
  display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 28px;
  scrollbar-width: none; &::-webkit-scrollbar { display: none; }
`;
const TabChip = styled.button<{ $active: boolean }>`
  flex-shrink: 0; height: 36px; padding: 0 16px; border-radius: 999px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  color: ${(p) => (p.$active ? '#0F766E' : '#475569')};
  &:hover { border-color: #99F6E4; }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
`;
const Card = styled(SmallCard)`
  height: 100%;
`;
const AreaChip = styled.span`
  align-self: flex-start; font-size: 0.6875rem; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border-radius: 999px; padding: 2px 8px;
`;
const Cond = styled.span`
  align-self: flex-start; font-size: 0.6875rem; color: #64748B;
  border: 1px solid #E2E8F0; border-radius: 6px; padding: 2px 7px; margin-top: 2px;
`;
const CardLinks = styled.div`
  margin-top: auto; padding-top: 8px; display: flex; gap: 14px; flex-wrap: wrap;
`;
const CardLink = styled(Link)`
  font-size: 0.8125rem; font-weight: 600; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
