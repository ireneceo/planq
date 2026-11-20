// PlanQ «회사 찾기» — `/directory` · `/directory/<업종>` · `/en/…` (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §6·§7 ③)
//
//   공개를 켜고 PlanQ 가 승인한 워크스페이스만(서버 isPubliclyListed 한 술어). 검색·업종·지역 필터 · 20개씩 더 보기.
// ★ [문의하기] 는 그 회사 페이지의 문의 폼으로 간다 — 여기서 여러 회사에 한꺼번에 보내는 문은 만들지 않는다(§7 ③ 스팸 방지).
// ★ 공개 회사가 6곳 미만이면 업종 칩의 숫자를 숨기고, 0곳 업종 칩은 보이지 않는다(빈 목록을 자랑하지 않는다).
// ★ 업종 주소(/directory/design)는 같은 화면에 제목만 바뀐다. 검색어는 주소 쿼리(?q=) — 검색 결과 주소는 색인하지 않는다(서버 생성물에 없다).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import LandingLayout from '../../components/Landing/LandingLayout';
import PlanQSelect from '../../components/Common/PlanQSelect';

const CATEGORIES = ['design', 'marketing', 'development', 'media', 'consulting', 'accounting', 'legal', 'translation',
  'education', 'interior', 'manufacturing', 'events', 'realestate', 'healthcare', 'lifestyle', 'other'];
const REGIONS = ['seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon',
  'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju', 'nationwide'];
type Card = { slug: string; name: string; logo_url: string | null; tagline: string | null; category: string | null; region: string | null; services: string[]; services_total: number };

export default function DirectoryPage() {
  const { t, i18n } = useTranslation('wspage');
  const { category: catParam } = useParams<{ category?: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const isEn = pathname.startsWith('/en/');
  const pre = isEn ? '/en' : '';
  const lang = isEn || (i18n.language || '').startsWith('en') ? 'en' : 'ko';
  const category = catParam && CATEGORIES.includes(catParam) ? catParam : null;
  const region = sp.get('region') || '';
  const q = sp.get('q') || '';
  const [qInput, setQInput] = useState(q);
  const [items, setItems] = useState<Card[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [allTotal, setAllTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  const load = useCallback(async (p: number) => {
    const qs = new URLSearchParams({ lang, page: String(p) });
    if (category) qs.set('category', category);
    if (region) qs.set('region', region);
    if (q) qs.set('q', q);
    try {
      const r = await fetch(`/api/public/directory?${qs.toString()}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setState('error'); return; }
      setItems((prev) => (p === 1 ? j.data.items : [...prev, ...j.data.items]));
      setCounts(j.data.counts || {}); setAllTotal(j.data.all_total || 0); setTotal(j.data.total || 0);
      setHasMore(!!j.data.has_more); setPage(p); setState('ok');
    } catch { setState('error'); }
  }, [lang, category, region, q]);
  useEffect(() => { void load(1); }, [load]);
  useEffect(() => { setQInput(q); }, [q]);
  useEffect(() => {
    document.title = category ? `${t(`category.${category}`)} ${t('dir.companies', '회사')} | PlanQ` : `${t('directory', '회사 찾기')} | PlanQ`;
  }, [category, t]);

  const showCounts = allTotal >= 6;
  const chips = useMemo(() => CATEGORIES.filter((c) => (counts[c] || 0) > 0 || c === category), [counts, category]);
  const setQuery = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
  };
  const goCat = (c: string | null) => navigate(`${pre}/directory${c ? `/${c}` : ''}${sp.toString() ? `?${sp.toString()}` : ''}`);

  return (
    <LandingLayout transparentTop={false}>
      <Wrap data-testid="directory-page">
        <Hero>
          <H1>{category ? `${t(`category.${category}`)} ${t('dir.companies', '회사')}` : t('dir.title', '일 잘하는 회사를 찾아보세요')}</H1>
          <Sub>{category ? t(`categoryDesc.${category}`, t('dir.sub', 'PlanQ 로 일하는 회사에 바로 문의하고 상담을 예약할 수 있어요')) : t('dir.sub', 'PlanQ 로 일하는 회사에 바로 문의하고 상담을 예약할 수 있어요')}</Sub>
          <SearchRow onSubmit={(e) => { e.preventDefault(); setQuery({ q: qInput.trim().length >= 2 ? qInput.trim() : '' }); }}>
            <SearchIn data-testid="directory-search" value={qInput} maxLength={40} onChange={(e) => setQInput(e.target.value)}
              placeholder={t('dir.searchPh', '회사 이름·서비스로 검색 (예: 로고 디자인, 세무 기장)') as string}
              aria-label={t('dir.searchAria', '회사 검색') as string} />
            <SearchBtn type="submit">{t('dir.search', '검색')}</SearchBtn>
          </SearchRow>
        </Hero>

        <Filters>
          <ChipRow role="list">
            <Chip type="button" $on={!category} onClick={() => goCat(null)} data-testid="directory-cat-all">
              {t('dir.all', '전체')}{showCounts ? <b>{Object.values(counts).reduce((a, b) => a + b, 0)}</b> : null}
            </Chip>
            {chips.map((c) => (
              <Chip key={c} type="button" $on={category === c} onClick={() => goCat(c)} data-testid={`directory-cat-${c}`}>
                {t(`category.${c}`)}{showCounts ? <b>{counts[c] || 0}</b> : null}
              </Chip>
            ))}
          </ChipRow>
          <RegionBox data-testid="directory-region">
            <PlanQSelect size="sm" name="region" isSearchable={false} aria-label={t('dir.region', '지역') as string}
              options={[{ value: '', label: t('dir.regionAll', '지역 전체') as string }, ...REGIONS.map((r) => ({ value: r, label: t(`region.${r}`) as string }))]}
              value={{ value: region, label: region ? t(`region.${region}`) as string : t('dir.regionAll', '지역 전체') as string }}
              onChange={(opt: unknown) => setQuery({ region: String((opt as { value?: string } | null)?.value ?? '') })} />
          </RegionBox>
        </Filters>

        {state === 'loading' ? <Muted>{t('loading', '불러오는 중…')}</Muted>
          : state === 'error' ? <Muted>{t('error', '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')}</Muted>
          : items.length === 0 ? (
            <Empty data-testid="directory-empty">
              {q ? t('dir.noResult', { q, defaultValue: '«{{q}}» 에 맞는 회사가 아직 없어요.' }) : t('dir.empty', '아직 공개된 회사가 없어요.')}
              {category && <Link to={`${pre}/directory`}>{t('dir.otherCats', '다른 업종 보기 →')}</Link>}
            </Empty>
          ) : (
            <>
              {q && <Muted>{t('dir.resultCount', { n: total, defaultValue: '{{n}}곳' })}</Muted>}
              <Grid>
                {items.map((c) => (
                  <CardBox key={c.slug} data-testid={`directory-card-${c.slug}`}>
                    <CardHead>
                      {c.logo_url ? <Logo src={`${c.logo_url}?w=96`} alt="" /> : <Initial aria-hidden>{c.name.charAt(0)}</Initial>}
                      <div>
                        <CardName to={`${pre}/w/${c.slug}`}>{c.name}</CardName>
                        <CardMeta>{[c.category ? t(`category.${c.category}`) : null, c.region ? t(`region.${c.region}`) : null].filter(Boolean).join(' · ')}</CardMeta>
                      </div>
                    </CardHead>
                    {c.tagline && <Tag>{c.tagline}</Tag>}
                    {c.services.length > 0 && (
                      <Svcs>
                        {c.services.map((s) => <li key={s}>{s}</li>)}
                        {c.services_total > c.services.length && <More>{t('dir.moreServices', { n: c.services_total - c.services.length, defaultValue: '외 {{n}}' })}</More>}
                      </Svcs>
                    )}
                    <CardBtns>
                      <GhostLink to={`${pre}/w/${c.slug}`}>{t('dir.view', '페이지 보기')}</GhostLink>
                      <PrimaryLink to={`${pre}/w/${c.slug}#inquiry`}>{t('ask', '문의하기')}</PrimaryLink>
                    </CardBtns>
                  </CardBox>
                ))}
              </Grid>
              {hasMore && <MoreBtn type="button" onClick={() => load(page + 1)} data-testid="directory-more">{t('dir.loadMore', '더 보기')}</MoreBtn>}
            </>
          )}

        <Cta>
          <span>{t('dir.ctaText', '우리 회사도 올리기 → PlanQ 를 쓰면 공개 페이지가 자동으로 만들어져요')}</span>
          <PrimaryLink to="/register">{t('dir.ctaBtn', '무료로 시작')}</PrimaryLink>
        </Cta>
      </Wrap>
    </LandingLayout>
  );
}

const Wrap = styled.div`max-width:1120px;margin:0 auto;padding:40px 20px 64px;display:flex;flex-direction:column;gap:20px;
  @media (max-width:640px){ padding:24px 14px 48px; }`;
const Hero = styled.section`display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;`;
const H1 = styled.h1`margin:0;font-size:2rem;font-weight:800;color:#0F172A;letter-spacing:-0.5px;@media (max-width:640px){font-size:1.5rem;}`;
const Sub = styled.p`margin:0;font-size:1rem;color:#475569;`;
const SearchRow = styled.form`display:flex;gap:8px;width:100%;max-width:640px;margin-top:8px;`;
const SearchIn = styled.input`flex:1;min-width:0;height:44px;padding:0 16px;border:1px solid #CBD5E1;border-radius:12px;font-size:0.9375rem;
  &:focus{outline:none;border-color:#14B8A6;}`;
const SearchBtn = styled.button`height:44px;padding:0 20px;border-radius:12px;border:none;background:#14B8A6;color:#fff;font-weight:700;cursor:pointer;
  &:hover{background:#0D9488;}`;
const Filters = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;`;
const ChipRow = styled.div`display:flex;gap:6px;flex:1;min-width:0;flex-wrap:wrap;
  @media (max-width:640px){ flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px; }`;
const Chip = styled.button<{ $on: boolean }>`flex-shrink:0;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;font-size:0.8125rem;font-weight:600;
  border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};color:${(p) => (p.$on ? '#0F766E' : '#475569')};
  b{margin-left:6px;}`;
const RegionBox = styled.div`width:160px;flex-shrink:0;@media (max-width:640px){ width:100%; }`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:14px;`;
const CardBox = styled.article`display:flex;flex-direction:column;gap:10px;padding:16px;background:#fff;border:1px solid #E2E8F0;border-radius:14px;min-width:0;`;
const CardHead = styled.div`display:flex;align-items:center;gap:10px;min-width:0;`;
const Logo = styled.img`width:44px;height:44px;border-radius:10px;object-fit:contain;border:1px solid #E2E8F0;background:#fff;flex-shrink:0;`;
const Initial = styled.span`width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:#14B8A6;color:#fff;font-weight:700;flex-shrink:0;`;
const CardName = styled(Link)`display:block;font-size:1rem;font-weight:700;color:#0F172A;text-decoration:none;overflow-wrap:anywhere;&:hover{color:#0D9488;}`;
const CardMeta = styled.div`font-size:0.75rem;color:#64748B;`;
const Tag = styled.div`font-size:0.875rem;color:#334155;line-height:1.5;`;
const Svcs = styled.ul`margin:0;padding-left:18px;font-size:0.8125rem;color:#475569;display:flex;flex-direction:column;gap:2px;`;
const More = styled.li`list-style:none;margin-left:-18px;color:#94A3B8;`;
const CardBtns = styled.div`display:flex;gap:8px;margin-top:auto;`;
const PrimaryLink = styled(Link)`display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;background:#14B8A6;color:#fff;font-weight:700;font-size:0.875rem;text-decoration:none;&:hover{background:#0D9488;}`;
const GhostLink = styled(Link)`display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;border:1px solid #CBD5E1;color:#334155;font-weight:700;font-size:0.875rem;text-decoration:none;&:hover{border-color:#14B8A6;}`;
const MoreBtn = styled.button`align-self:center;height:40px;padding:0 24px;border-radius:10px;border:1px solid #CBD5E1;background:#fff;font-weight:600;cursor:pointer;`;
const Muted = styled.div`font-size:0.875rem;color:#64748B;`;
const Empty = styled.div`display:flex;flex-direction:column;gap:8px;align-items:center;padding:40px 0;color:#64748B;font-size:0.9375rem;a{color:#0D9488;font-weight:600;text-decoration:none;}`;
const Cta = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;padding:20px;border-radius:14px;background:#F0FDFA;border:1px solid #99F6E4;color:#0F766E;font-weight:600;`;
