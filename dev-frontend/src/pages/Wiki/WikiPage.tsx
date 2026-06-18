import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { fetchWikiCategories, fetchWikiArticles, type WikiCategory, type WikiArticleSummary } from '../../services/wiki';
import { mediaPhone } from '../../theme/breakpoints';

const OVERVIEW_SEEN_KEY = 'planq_wiki_overview_seen';

export default function WikiPage() {
  const { t } = useTranslation('wiki');
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const [categories, setCategories] = useState<WikiCategory[]>([]);
  const [articles, setArticles] = useState<WikiArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const activeCategory = sp.get('category') || '';
  const query = sp.get('q') || '';
  const [searchInput, setSearchInput] = useState(query);
  const debounceRef = useRef<number | undefined>(undefined);

  // 첫 접속이면 오버뷰 모드 (검색·필터 없을 때만)
  const [overviewMode, setOverviewMode] = useState<boolean>(() => {
    try { return !localStorage.getItem(OVERVIEW_SEEN_KEY); } catch { return false; }
  });
  const showOverview = overviewMode && !query && !activeCategory;

  useEffect(() => {
    let alive = true;
    fetchWikiCategories().then((c) => { if (alive) setCategories(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    fetchWikiArticles({ category: activeCategory || undefined, q: query || undefined, limit: 200 })
      .then((res) => { if (alive) setArticles(res.data); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeCategory, query]);

  // 검색 입력 디바운스 → URL 싱크
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const next = new URLSearchParams(sp);
      if (searchInput.trim()) next.set('q', searchInput.trim()); else next.delete('q');
      setSp(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const markSeen = () => {
    try { localStorage.setItem(OVERVIEW_SEEN_KEY, '1'); } catch { /* noop */ }
    setOverviewMode(false);
  };

  const selectCategory = (slug: string) => {
    markSeen();
    const next = new URLSearchParams(sp);
    if (slug && slug !== activeCategory) next.set('category', slug); else next.delete('category');
    next.delete('q'); setSearchInput('');
    setSp(next, { replace: true });
  };

  const openArticle = (slug: string) => navigate(`/wiki/a/${slug}`);

  const catById = useMemo(() => {
    const m = new Map<number, WikiCategory>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const SearchBox = (
    <Search>
      <SearchIcon viewBox="0 0 24 24" aria-hidden><path d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></SearchIcon>
      <input
        value={searchInput}
        onChange={(e) => { setSearchInput(e.target.value); if (!query) markSeen(); }}
        placeholder={t('page.searchPlaceholder')}
        aria-label={t('page.searchPlaceholder')}
      />
    </Search>
  );

  return (
    <PageShell title={t('page.title')} actions={SearchBox}>
      {showOverview ? (
        <Overview>
          <OverviewHead>
            <h2>{t('page.overviewTitle')}</h2>
            <p>{t('page.overviewDesc')}</p>
          </OverviewHead>
          <CatGrid>
            {categories.map((c) => (
              <CatCard key={c.id} onClick={() => selectCategory(c.slug)}>
                <CatTitle>{c.title}</CatTitle>
                {c.summary && <CatSummary>{c.summary}</CatSummary>}
                <CatCount>{t('page.articleCount', { count: c.article_count ?? 0 })}</CatCount>
              </CatCard>
            ))}
          </CatGrid>
        </Overview>
      ) : (
        <>
          <Chips>
            <Chip $active={!activeCategory} onClick={() => selectCategory('')}>{t('page.allCategories')}</Chip>
            {categories.map((c) => (
              <Chip key={c.id} $active={activeCategory === c.slug} onClick={() => selectCategory(c.slug)}>{c.title}</Chip>
            ))}
          </Chips>

          {loading ? (
            <Muted>{t('page.loading')}</Muted>
          ) : error ? (
            <Muted>{t('page.error')}</Muted>
          ) : articles.length === 0 ? (
            <Muted>{query ? t('page.searchEmpty', { q: query }) : t('page.empty')}</Muted>
          ) : (
            <ArtGrid>
              {articles.map((a) => (
                <ArtCard key={a.id} onClick={() => openArticle(a.slug)}>
                  <ArtCat>{a.category?.title || catById.get(a.category_id)?.title || ''}</ArtCat>
                  <ArtTitle>{a.title}</ArtTitle>
                  {a.summary && <ArtSummary>{a.summary}</ArtSummary>}
                  {a.est_minutes ? <ArtMeta>{t('page.minutes', { count: a.est_minutes })}</ArtMeta> : null}
                </ArtCard>
              ))}
            </ArtGrid>
          )}
        </>
      )}
    </PageShell>
  );
}

const Overview = styled.div``;
const OverviewHead = styled.div`
  margin-bottom: 20px;
  h2 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }
  p { font-size: 14px; color: #64748b; margin: 0; }
`;
const CatGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px;
  ${mediaPhone} { grid-template-columns: 1fr; }
`;
const CatCard = styled.button`
  text-align: left; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px;
  cursor: pointer; transition: border-color .15s, box-shadow .15s; display: flex; flex-direction: column; gap: 6px; min-height: 120px;
  &:hover { border-color: #F43F5E; box-shadow: 0 4px 14px rgba(15,23,42,.06); }
`;
const CatTitle = styled.div` font-size: 16px; font-weight: 700; color: #0f172a; `;
const CatSummary = styled.div` font-size: 13px; color: #64748b; line-height: 1.5; flex: 1; `;
const CatCount = styled.div` font-size: 12px; color: #94a3b8; margin-top: auto; `;

const Chips = styled.div` display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; `;
const Chip = styled.button<{ $active?: boolean }>`
  border: 1px solid ${(p) => (p.$active ? '#F43F5E' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#FFF1F2' : '#fff')};
  color: ${(p) => (p.$active ? '#F43F5E' : '#475569')};
  font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 999px; cursor: pointer;
  &:hover { border-color: #F43F5E; }
`;

const ArtGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px;
  ${mediaPhone} { grid-template-columns: 1fr; }
`;
const ArtCard = styled.button`
  text-align: left; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px;
  cursor: pointer; transition: border-color .15s, box-shadow .15s; display: flex; flex-direction: column; gap: 6px; min-height: 120px;
  &:hover { border-color: #F43F5E; box-shadow: 0 4px 14px rgba(15,23,42,.06); }
`;
const ArtCat = styled.div` font-size: 12px; font-weight: 600; color: #F43F5E; `;
const ArtTitle = styled.div` font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.4; `;
const ArtSummary = styled.div` font-size: 13px; color: #64748b; line-height: 1.5; flex: 1; `;
const ArtMeta = styled.div` font-size: 12px; color: #94a3b8; margin-top: auto; `;

const Muted = styled.div` color: #94a3b8; font-size: 14px; padding: 40px 0; text-align: center; `;

const Search = styled.div`
  display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 0 12px; height: 38px; width: min(360px, 60vw);
  &:focus-within { border-color: #F43F5E; }
  input { border: 0; outline: 0; font-size: 14px; flex: 1; background: transparent; color: #0f172a; }
  ${mediaPhone} { width: 100%; }
`;
const SearchIcon = styled.svg` width: 17px; height: 17px; color: #94a3b8; flex-shrink: 0; `;
