// Q record — 동적 테이블 (Notion DB 패턴) 목록.
// 레이아웃: Q file (DocsTab) 동일 — Split (좌측 카테고리 트리 220px + 메인 그리드/리스트).
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import Button from '../../components/Common/Button';
import Chip from '../../components/Common/Chip';
import Spinner from '../../components/Common/Spinner';
import StandardModal from '../../components/Common/StandardModal';
import {
  fetchRecords, fetchRecordCategories, createRecord,
  type QRecordSummary,
} from '../../services/qrecord';

type ViewMode = 'grid' | 'list';
type CatSel = 'all' | string;       // 'all' or category name

const QRecordsPage: React.FC = () => {
  const { t } = useTranslation('qrecord');
  const { user } = useAuth();
  const navigate = useNavigate();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [records, setRecords] = useState<QRecordSummary[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [catSel, setCatSel] = useState<CatSel>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [createOpen, setCreateOpen] = useState(false);

  const reload = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [rs, cs] = await Promise.all([
        fetchRecords(businessId),
        fetchRecordCategories(businessId),
      ]);
      setRecords(rs);
      setCats(cs);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [businessId]);

  const filtered = useMemo(() => {
    let r = records;
    if (catSel !== 'all') r = r.filter(x => x.category === catSel);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(x => x.name.toLowerCase().includes(q));
    }
    return r;
  }, [records, catSel, query]);

  const counts: Record<string, number> = useMemo(() => {
    const c: Record<string, number> = { all: records.length };
    for (const r of records) {
      const k = r.category || '__uncat';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [records]);

  if (!businessId) return <PageShell title={t('page.title', 'Q record') as string}><div /></PageShell>;

  return (
    <PageShell
      title={t('page.title', 'Q record') as string}
      count={records.length}
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          + {t('actions.new', '새 테이블')}
        </Button>
      }
    >
      <Wrap>
        <Toolbar>
          <SearchInput
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('search.ph', '테이블 이름 검색') as string}
          />
          <Spacer />
          <ViewToggle role="tablist" aria-label={t('view.aria', '보기 모드') as string}>
            <VT type="button" role="tab" aria-selected={view === 'grid'} $active={view === 'grid'} onClick={() => setView('grid')} title={t('view.grid', '그리드') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </VT>
            <VT type="button" role="tab" aria-selected={view === 'list'} $active={view === 'list'} onClick={() => setView('list')} title={t('view.list', '리스트') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </VT>
          </ViewToggle>
        </Toolbar>

        <Split>
          <TreePanel>
            <TreeRoot>
              <TreeRow $selected={catSel === 'all'} onClick={() => setCatSel('all')}>
                <TreeIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" $selected={catSel === 'all'}>
                  <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                </TreeIcon>
                <TreeName>{t('cat.all', '전체')}</TreeName>
                <TreeCount>{counts.all || 0}</TreeCount>
              </TreeRow>
              {cats.length > 0 && (
                <>
                  <TreeDivider />
                  {cats.map(c => (
                    <TreeRow key={c} $selected={catSel === c} onClick={() => setCatSel(c)}>
                      <TreeIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" $selected={catSel === c}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </TreeIcon>
                      <TreeName>{c}</TreeName>
                      <TreeCount>{counts[c] || 0}</TreeCount>
                    </TreeRow>
                  ))}
                </>
              )}
            </TreeRoot>
          </TreePanel>

          <MainArea>
            {loading ? (
              <Center><Spinner size={20} /></Center>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                    <line x1="9" y1="4" x2="9" y2="20"/>
                  </svg>
                }
                title={t('empty.title', '아직 등록된 테이블이 없습니다')}
                description={t('empty.body', '계정 정보·자산·연락처 등 표 형태 데이터를 워크스페이스 단위로 보관하세요.')}
                ctaLabel={t('actions.new', '새 테이블') as string}
                onCta={() => setCreateOpen(true)}
              />
            ) : view === 'grid' ? (
              <CardGrid>
                {filtered.map(r => (
                  <Card key={r.id} onClick={() => navigate(`/records/${r.id}`)}>
                    <CardHeader>
                      <CardTitle>{r.name}</CardTitle>
                      {r.category && <Chip variant="teal">{r.category}</Chip>}
                    </CardHeader>
                    {r.description && <CardDesc>{r.description}</CardDesc>}
                    <CardStats>
                      <StatItem><b>{r.columns.length}</b> {t('stat.columns', '컬럼')}</StatItem>
                      <StatItem><b>{r.row_count}</b> {t('stat.rows', '행')}</StatItem>
                      {r.Project && <StatItem>{r.Project.name}</StatItem>}
                    </CardStats>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <ListWrap>
                <ListHead>
                  <ColName>{t('list.name', '이름')}</ColName>
                  <ColCat>{t('list.category', '카테고리')}</ColCat>
                  <ColScope>{t('list.scope', '스코프')}</ColScope>
                  <ColCount>{t('list.cols', '컬럼')}</ColCount>
                  <ColCount>{t('list.rows', '행')}</ColCount>
                  <ColUpdated>{t('list.updated', '수정일')}</ColUpdated>
                </ListHead>
                {filtered.map(r => (
                  <ListRow key={r.id} onClick={() => navigate(`/records/${r.id}`)}>
                    <ColName>{r.name}</ColName>
                    <ColCat>{r.category && <Chip variant="teal">{r.category}</Chip>}</ColCat>
                    <ColScope>{r.Project ? <Chip variant="info">{r.Project.name}</Chip> : <Muted>{t('list.workspace', '워크스페이스')}</Muted>}</ColScope>
                    <ColCount>{r.columns.length}</ColCount>
                    <ColCount>{r.row_count}</ColCount>
                    <ColUpdated>{new Date(r.updated_at).toLocaleDateString()}</ColUpdated>
                  </ListRow>
                ))}
              </ListWrap>
            )}
          </MainArea>
        </Split>
      </Wrap>

      {createOpen && (
        <CreateRecordModal
          businessId={businessId}
          onClose={() => setCreateOpen(false)}
          onCreated={(rec) => { setCreateOpen(false); navigate(`/records/${rec.id}`); }}
          existingCats={cats}
        />
      )}
    </PageShell>
  );
};

// ─── 새 테이블 모달 ───
const CreateRecordModal: React.FC<{
  businessId: number;
  onClose: () => void;
  onCreated: (rec: QRecordSummary) => void;
  existingCats: string[];
}> = ({ businessId, onClose, onCreated, existingCats }) => {
  const { t } = useTranslation('qrecord');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const rec = await createRecord({
        business_id: businessId,
        name: name.trim(),
        category: category.trim() || null,
      });
      onCreated(rec);
    } catch (e: unknown) {
      setError((e as Error).message || (t('create.failed', '생성 실패') as string));
      setBusy(false);
    }
  };

  return (
    <StandardModal
      open
      onClose={() => !busy && onClose()}
      title={t('create.title', '새 테이블') as string}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('actions.cancel', '취소')}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()} loading={busy}>{t('actions.create', '만들기')}</Button>
        </>
      }
    >
      <Field>
        <Label>{t('create.nameLabel', '테이블 이름')} *</Label>
        <TextInput type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={t('create.namePh', '예: 계정 정보 / 자산 목록 / 연락처') as string}
          maxLength={200} autoFocus disabled={busy} />
      </Field>
      <Field>
        <Label>{t('create.catLabel', '카테고리 (선택)')}</Label>
        <TextInput type="text" value={category} onChange={e => setCategory(e.target.value)}
          placeholder={t('create.catPh', '예: 보안 / 인사 / 운영') as string}
          maxLength={80} disabled={busy} list="qrecord-cat-list" />
        <datalist id="qrecord-cat-list">
          {existingCats.map(c => <option key={c} value={c} />)}
        </datalist>
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
    </StandardModal>
  );
};

export default QRecordsPage;

// ─── styled (Q file DocsTab 패턴 동일) ───
const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const Spacer = styled.div`flex: 1;`;
const SearchInput = styled.input`
  height: 32px; padding: 0 10px; min-width: 220px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ViewToggle = styled.div`
  display: inline-flex; background: #F1F5F9; border: 1px solid #E2E8F0;
  border-radius: 8px; padding: 2px; gap: 2px;
`;
const VT = styled.button<{ $active: boolean }>`
  width: 30px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: ${p => p.$active ? '#fff' : 'transparent'};
  color: ${p => p.$active ? '#0F172A' : '#94A3B8'};
  border: none; border-radius: 6px; cursor: pointer;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(15,23,42,.06)' : 'none'};
  &:hover { color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

const Split = styled.div`
  display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: start;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const TreePanel = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 6px;
  position: sticky; top: 8px;
  max-height: calc(100vh - 180px); overflow-y: auto;
  @media (max-width: 900px) { position: static; max-height: none; }
`;
const TreeRoot = styled.div`display: flex; flex-direction: column; gap: 1px;`;
const TreeDivider = styled.div`height: 1px; background: #F1F5F9; margin: 6px 0;`;
const TreeRow = styled.button<{ $selected?: boolean }>`
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 6px 8px;
  background: ${p => p.$selected ? '#F0FDFA' : 'transparent'};
  color: ${p => p.$selected ? '#0F766E' : '#0F172A'};
  border: none; border-radius: 6px; cursor: pointer;
  min-height: 30px; text-align: left; width: 100%;
  &:hover { background: ${p => p.$selected ? '#F0FDFA' : '#F8FAFC'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const TreeIcon = styled.svg<{ $selected?: boolean }>`
  width: 16px; height: 16px;
  color: ${p => p.$selected ? '#0D9488' : '#64748B'};
  flex-shrink: 0;
`;
const TreeName = styled.div`
  min-width: 0; font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const TreeCount = styled.span`
  font-size: 10px; color: #94A3B8; font-weight: 600;
  min-width: 22px; padding: 1px 6px;
  background: #F1F5F9; border-radius: 999px;
  text-align: center; justify-self: end;
`;

const MainArea = styled.div`display: flex; flex-direction: column; gap: 10px; min-width: 0;`;
const Center = styled.div`display: flex; justify-content: center; padding: 60px 20px;`;

// 카드 그리드
const CardGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
`;
const Card = styled.button`
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  cursor: pointer; transition: all 0.15s;
  text-align: left;
  &:hover { border-color: #14B8A6; box-shadow: 0 4px 12px rgba(20,184,166,0.08); transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const CardHeader = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
`;
const CardTitle = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const CardDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardStats = styled.div`
  display: flex; gap: 12px; font-size: 11px; color: #94A3B8;
  margin-top: auto; padding-top: 8px; border-top: 1px solid #F1F5F9;
  b { color: #475569; font-weight: 700; margin-right: 2px; }
`;
const StatItem = styled.span``;

// 리스트
const ListWrap = styled.div`background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;`;
const ListHead = styled.div`
  display: grid; grid-template-columns: 2fr 1fr 1fr 80px 80px 100px;
  gap: 12px; padding: 10px 16px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const ListRow = styled.button`
  display: grid; grid-template-columns: 2fr 1fr 1fr 80px 80px 100px;
  gap: 12px; align-items: center; width: 100%;
  padding: 12px 16px;
  background: #FFFFFF; border: none;
  border-bottom: 1px solid #F1F5F9;
  cursor: pointer; transition: background 0.12s;
  text-align: left;
  font-size: 13px; color: #0F172A;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: -2px; }
  &:last-child { border-bottom: none; }
`;
const ColName = styled.div`font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ColCat = styled.div``;
const ColScope = styled.div``;
const ColCount = styled.div`color: #64748B; font-size: 12px;`;
const ColUpdated = styled.div`color: #94A3B8; font-size: 12px;`;
const Muted = styled.span`color: #94A3B8; font-size: 12px;`;

// 모달 form
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #0F172A;`;
const TextInput = styled.input`
  height: 36px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ErrorBox = styled.div`
  padding: 8px 12px; font-size: 12px; color: #B91C1C;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
`;
