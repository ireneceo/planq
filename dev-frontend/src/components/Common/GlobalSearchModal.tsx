// 글로벌 통합 검색 모달 — ⌘K / Ctrl+\ 또는 사이드바 검색박스 클릭으로 진입.
// GET /api/search?business_id=X&q=... → 도메인별 결과 (tasks/posts/records/files/...).
// 좌측 카테고리 (필터) + 우측 결과. Notion / Linear / Slack 패턴.
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { apiFetch } from '../../contexts/AuthContext';
import Spinner from './Spinner';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
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
  files: '#64748B', conversations: '#8B5CF6', knowledge: '#0D9488', clients: '#F59E0B', projects: '#10B981',
};

const GlobalSearchModal: React.FC<Props> = ({ open, onClose, businessId }) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
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
    (result.tasks || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.status, to: `/tasks?task=${x.id}`, type: 'tasks' }));
    (result.posts || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/docs?post=${x.id}`, type: 'posts' }));
    (result.records || []).forEach(x => h.push({ id: x.id, title: x.name, sub: x.category || undefined, to: `/records/${x.id}`, type: 'records' }));
    (result.files || []).forEach(x => h.push({ id: x.id, title: x.file_name, sub: x.mime_type || undefined, to: `/files?file=${x.id}`, type: 'files' }));
    (result.conversations || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.title || `#${x.id}`, to: `/talk?conv=${x.id}`, type: 'conversations' }));
    (result.knowledge || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/knowledge?doc=${x.id}`, type: 'knowledge' }));
    (result.clients || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.company_name || `#${x.id}`, sub: x.email || undefined, to: `/business/clients?client=${x.id}`, type: 'clients' }));
    (result.projects || []).forEach(x => h.push({ id: x.id, title: x.name, sub: x.status, to: `/projects/p/${x.id}`, type: 'projects' }));
    return h;
  }, [result]);

  const goto = (to: string) => { onClose(); navigate(to); };

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
            placeholder={t('search.placeholder', '업무·문서·레코드·파일·고객 모두 검색') as string}
          />
          {loading && <Spinner size={14} color="muted" />}
          <Kbd onClick={onClose}>Esc</Kbd>
        </SearchHeader>

        <Results>
          {!query.trim() ? (
            <Hint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</Hint>
          ) : allHits.length === 0 ? (
            <Hint>{loading ? t('search.searching', '검색 중...') : t('search.noResults', '결과 없음')}</Hint>
          ) : (
            allHits.map(h => (
              <Hit key={`${h.type}-${h.id}`} type="button" onClick={() => goto(h.to)}>
                <TypeBadge $color={CAT_BADGE_COLOR[h.type]}>{t(`search.cat.${h.type}`, { defaultValue: CAT_LABEL_KO[h.type] })}</TypeBadge>
                <HitMain>
                  <HitTitle>{h.title}</HitTitle>
                  {h.sub && <HitSub>{h.sub}</HitSub>}
                </HitMain>
              </Hit>
            ))
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
