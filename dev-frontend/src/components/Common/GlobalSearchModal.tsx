// 글로벌 통합 검색 모달 — ⌘K / Ctrl+\ 또는 사이드바 검색박스 클릭으로 진입.
// GET /api/search?business_id=X&q=... → 도메인별 결과 (tasks/posts/records/files/...).
// 좌측 카테고리 (필터) + 우측 결과. Notion / Linear / Slack 패턴.
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useChromeNav } from '../../hooks/useChromeNav';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { visibleNavMenus, SECTION_LABEL_KEY, type NavMenuEntry } from '../../config/navMenus';
import Spinner from './Spinner';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  // ⑥ 멀티탭 — 결과를 새 탭으로 열기 등 커스텀 네비. 미지정 시 현재 탭 이동(기본).
  onNavigate?: (to: string) => void;
}

type Category = 'tasks' | 'posts' | 'records' | 'files' | 'conversations' | 'knowledge' | 'clients' | 'projects';

interface Hit {
  id: number;
  title: string;       // 표시 라벨
  sub?: string;        // 서브 라벨 (카테고리 등)
  to: string;          // 라우트
  type: Category;
}

interface SearchResult {
  tasks?: Array<{ id: number; title: string; status?: string; project_id?: number | null }>;
  posts?: Array<{ id: number; title: string; category?: string | null; project_id?: number | null }>;
  records?: Array<{ id: number; name: string; category?: string | null; project_id?: number | null }>;
  files?: Array<{ id: number; file_name: string; file_size?: number; mime_type?: string | null }>;
  conversations?: Array<{ id: number; title?: string; display_name?: string; project_id?: number | null }>;
  knowledge?: Array<{ id: number; title: string; category?: string | null; scope?: string }>;
  clients?: Array<{ id: number; display_name?: string; company_name?: string; email?: string }>;
  projects?: Array<{ id: number; name: string; status?: string }>;
}

// 카테고리 라벨 i18n fallback (ko) — 표시는 t('search.cat.<key>') 로
const CAT_LABEL_KO: Record<Category, string> = {
  tasks: '업무', posts: '문서', records: '레코드', files: '파일',
  conversations: '대화', knowledge: '지식', clients: '고객', projects: '프로젝트',
};

const CAT_BADGE_COLOR: Record<Category, string> = {
  tasks: '#0EA5E9', posts: '#F43F5E', records: '#14B8A6',
  files: '#64748B', conversations: '#14B8A6', knowledge: '#0D9488', clients: '#F59E0B', projects: '#10B981',
};

// #210 — 메뉴 매칭 정규화: 대소문자·공백·중점 무시("q mail" → "qmail", "Q Bill" → "qbill")
const normalize = (s: string) => s.toLowerCase().replace(/[\s·.]/g, '');

const GlobalSearchModal: React.FC<Props> = ({ open, onClose, businessId, onNavigate }) => {
  const { t } = useTranslation('common');
  const { t: tNav } = useTranslation('layout');   // #210 — 메뉴 라벨은 사이드바와 같은 layout ns 키
  const { user } = useAuth();
  const navigate = useChromeNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult>({});
  const [loading, setLoading] = useState(false);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { if (!open) { setQuery(''); setResult({}); } }, [open]);

  // debounce 검색
  useEffect(() => {
    if (!query.trim()) { setResult({}); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/search?business_id=${businessId}&q=${encodeURIComponent(query)}&limit=8`);
        const j = await r.json();
        if (j.success) setResult(j.data || {});
      } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, businessId]);

  const allHits: Hit[] = useMemo(() => {
    const h: Hit[] = [];
    // #206 — status 를 raw 로 내보내면 `on_hold` 같은 snake_case 가 사용자에게 그대로 노출된다
    //   (신규 2값만의 문제가 아니라 기존 전 상태가 그랬다 — 일괄 라벨화).
    (result.tasks || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.status ? t(`qtask:status.${x.status}.observer`, { defaultValue: x.status }) as string : undefined, to: `/tasks?task=${x.id}`, type: 'tasks' }));
    (result.posts || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/docs?post=${x.id}`, type: 'posts' }));
    (result.records || []).forEach(x => h.push({ id: x.id, title: x.name, sub: x.category || undefined, to: `/records/${x.id}`, type: 'records' }));
    (result.files || []).forEach(x => h.push({ id: x.id, title: x.file_name, sub: x.mime_type || undefined, to: `/files?file=${x.id}`, type: 'files' }));
    (result.conversations || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.title || `#${x.id}`, to: `/talk?conv=${x.id}`, type: 'conversations' }));
    (result.knowledge || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/knowledge?doc=${x.id}`, type: 'knowledge' }));
    (result.clients || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.company_name || `#${x.id}`, sub: x.email || undefined, to: `/business/clients?client=${x.id}`, type: 'clients' }));
    (result.projects || []).forEach(x => h.push({ id: x.id, title: x.name, sub: x.status, to: `/projects/p/${x.id}`, type: 'projects' }));
    return h;
  }, [result, t]);   // #206 — 상태 라벨 i18n 사용 → 언어 전환 시 재계산

  // #210 — 메뉴(페이지) 이동 결과. 검색어가 없으면 전체 메뉴 목록(= '+' 로 새 탭 열 때 메뉴 고르기),
  //         있으면 메뉴 이름·별칭·경로 매칭. 사이드바와 같은 역할 조건(config/navMenus)을 쓴다.
  const menus = useMemo(
    () => visibleNavMenus({ businessRole: user?.business_role, isPlatformAdmin: user?.platform_role === 'platform_admin' }),
    [user?.business_role, user?.platform_role],
  );
  const menuLabel = React.useCallback((m: NavMenuEntry) => tNav(m.labelKey) as string, [tNav]);
  // 검색 동의어는 언어별 콘텐츠 — locales layout `nav.searchAliases.<key>` (쉼표 구분, 없으면 빈 값)
  const menuAliases = React.useCallback(
    (m: NavMenuEntry) => String(tNav(`nav.searchAliases.${m.key}`, { defaultValue: '' })).split(',').filter(Boolean),
    [tNav],
  );
  const menuHits = useMemo(() => {
    const nq = normalize(query.trim());
    if (!nq) return menus;
    return menus.filter((m) => {
      const hay = [menuLabel(m), m.key, m.to, ...menuAliases(m)].map(normalize);
      return hay.some((h) => h.includes(nq));
    }).slice(0, 8);
  }, [menus, query, menuLabel, menuAliases]);

  const goto = (to: string) => { onClose(); (onNavigate || navigate)(to); };

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('search.title', '통합 검색') as string}>
        <SearchHeader>
          <SearchIconSvg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </SearchIconSvg>
          <SearchInput
            ref={inputRef} type="text" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search.placeholder', '메뉴·업무·문서·레코드·파일·고객 모두 검색') as string}
          />
          {loading && <Spinner size={14} color="muted" />}
          <Kbd onClick={onClose}>Esc</Kbd>
        </SearchHeader>

        <Results>
          {/* #210 — 메뉴 이동. 검색어 없을 때는 전체 메뉴가 그대로 목록이 된다(고르면 그 페이지로) */}
          {menuHits.length > 0 && (
            <>
              <GroupTitle>{t('search.menus', { defaultValue: '메뉴' }) as string}</GroupTitle>
              {menuHits.map(m => (
                <Hit key={`menu-${m.key}`} type="button" data-testid={`gsearch-menu-${m.key}`} onClick={() => goto(m.to)}>
                  <TypeBadge $color="#0F766E">{tNav(SECTION_LABEL_KEY[m.section]) as string}</TypeBadge>
                  <HitMain>
                    <HitTitle>{menuLabel(m)}</HitTitle>
                    <HitSub>{m.to}</HitSub>
                  </HitMain>
                </Hit>
              ))}
            </>
          )}

          {!query.trim() ? (
            menuHits.length > 0
              ? <FootHint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</FootHint>
              : <Hint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</Hint>
          ) : allHits.length === 0 ? (
            (loading || menuHits.length === 0) && (
              <Hint>{loading ? t('search.searching', '검색 중...') : t('search.noResults', '결과 없음')}</Hint>
            )
          ) : (
            <>
              <GroupTitle>{t('search.results', { defaultValue: '검색 결과' }) as string}</GroupTitle>
              {allHits.map(h => (
                <Hit key={`${h.type}-${h.id}`} type="button" onClick={() => goto(h.to)}>
                  <TypeBadge $color={CAT_BADGE_COLOR[h.type]}>{t(`search.cat.${h.type}`, { defaultValue: CAT_LABEL_KO[h.type] })}</TypeBadge>
                  <HitMain>
                    <HitTitle>{h.title}</HitTitle>
                    {h.sub && <HitSub>{h.sub}</HitSub>}
                  </HitMain>
                </Hit>
              ))}
            </>
          )}
        </Results>
      </Dialog>
    </Backdrop>
  );
};

export default GlobalSearchModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 80px; z-index: 1100;
  @media (max-width: 640px) { padding-top: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  width: 100%; max-width: 720px;
  max-height: calc(100vh - 120px);
  display: flex; flex-direction: column;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15,23,42,0.25);
  overflow: hidden;
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const SearchHeader = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const SearchIconSvg = styled.svg`width: 16px; height: 16px; color: #94A3B8; flex-shrink: 0;`;
const SearchInput = styled.input`
  flex: 1; height: 28px;
  border: none; outline: none;
  font-size: 15px; color: #0F172A; background: transparent;
  &::placeholder { color: #94A3B8; }
`;
const Kbd = styled.button`
  font-size: 11px; font-weight: 600; font-family: inherit;
  padding: 2px 8px;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #E2E8F0; }
`;
const Results = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px;
  overflow-y: auto;
`;
const Hint = styled.div`
  padding: 40px 20px; text-align: center;
  font-size: 13px; color: #94A3B8;
`;
// #210 — 메뉴 목록이 이미 보일 때의 하단 안내 (큰 여백 없이 한 줄)
const FootHint = styled.div`
  padding: 10px 12px 4px; text-align: center;
  font-size: 12px; color: #CBD5E1;
`;
// #210 — 결과 그룹 헤더 (메뉴 / 검색 결과)
const GroupTitle = styled.div`
  padding: 8px 12px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
  color: #94A3B8; text-transform: uppercase;
`;
const Hit = styled.button`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: transparent; border: none; border-radius: 8px;
  text-align: left; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const TypeBadge = styled.span<{ $color: string }>`
  flex-shrink: 0;
  padding: 2px 8px;
  background: ${p => p.$color}1A;
  color: ${p => p.$color};
  border-radius: 4px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.3px;
`;
const HitMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const HitTitle = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const HitSub = styled.div`
  font-size: 11px; color: #94A3B8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
