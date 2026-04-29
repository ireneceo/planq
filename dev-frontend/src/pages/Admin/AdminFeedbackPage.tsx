// 사이클 P6 — platform_admin 의 사용자 피드백 관리 페이지
// 라우트: /admin/feedback
// 기능: 상태별 탭 (pending/reviewing/done/wontfix), 카테고리 필터, 답변 작성 + 상태 변경
import { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab, Badge } from '../../components/Common/TabComponents';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';

type Status = 'pending' | 'reviewing' | 'done' | 'wontfix';
type Category = 'bug' | 'improve' | 'feature' | 'other';

interface FeedbackItem {
  id: number;
  user_id: number;
  business_id: number | null;
  category: Category;
  priority: 'normal' | 'high';
  title: string;
  body: string;
  page_url: string | null;
  user_agent: string | null;
  status: Status;
  admin_response: string | null;
  responded_by: number | null;
  responded_at: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string };
  responder?: { id: number; name: string };
}

const STATUSES: Status[] = ['pending', 'reviewing', 'done', 'wontfix'];
const CATEGORIES: Category[] = ['bug', 'improve', 'feature', 'other'];

const AdminFeedbackPage = () => {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<Status>('pending');
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FeedbackItem | null>(null);
  const [response, setResponse] = useState('');
  const [responseStatus, setResponseStatus] = useState<Status>('reviewing');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('status', activeStatus);
      if (activeCategory !== 'all') sp.set('category', activeCategory);
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/feedback/admin?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
    } finally { setLoading(false); }
  }, [activeStatus, activeCategory, search]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await apiFetch('/api/feedback/admin/counts');
      const j = await r.json();
      if (j.success) setCounts(j.data || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);

  // detail 선택 시 폼 prefill
  useEffect(() => {
    const it = items.find(x => x.id === detailId);
    setDetail(it || null);
    setResponse(it?.admin_response || '');
    setResponseStatus((it?.status === 'pending' ? 'reviewing' : it?.status) || 'reviewing');
  }, [detailId, items]);

  const submit = async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/feedback/${detail.id}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: responseStatus,
          admin_response: response.trim(),
        }),
      });
      setDetailId(null);
      await Promise.all([load(), loadCounts()]);
    } finally { setSubmitting(false); }
  };

  const filtered = useMemo(() => items, [items]);

  return (
    <PageShell
      title={t('adminFeedback.title', '사용자 피드백') as string}
      count={counts.total || 0}
      actions={
        <>
          <SearchInput
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('adminFeedback.searchPh', '제목·내용 검색') as string}
          />
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{ value: activeCategory, label: activeCategory === 'all' ? (t('adminFeedback.allCategories', '전체 분류') as string) : (t(`qhelper.fbCat.${activeCategory}`) as string) }}
            onChange={(opt) => {
              const v = (opt as PlanQSelectOption | null)?.value as Category | 'all' | undefined;
              setActiveCategory(v || 'all');
            }}
            options={[
              { value: 'all', label: t('adminFeedback.allCategories', '전체 분류') as string },
              ...CATEGORIES.map(c => ({ value: c, label: t(`qhelper.fbCat.${c}`) as string })),
            ]}
          />
        </>
      }
    >
      <Tabs>
        {STATUSES.map(s => (
          <Tab key={s} active={activeStatus === s} onClick={() => setActiveStatus(s)}>
            {t(`adminFeedback.status.${s}`)} <Badge count={counts[s] || 0} showZero />
          </Tab>
        ))}
      </Tabs>

      {loading ? <Loading>{t('loading', '로딩 중…')}</Loading> :
       filtered.length === 0 ? (
        <EmptyState
          icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
          title={t('adminFeedback.empty', '해당 상태의 피드백이 없습니다') as string}
        />
       ) : (
        <List>
          {filtered.map(it => (
            <Row key={it.id} $active={detailId === it.id} onClick={() => setDetailId(prev => prev === it.id ? null : it.id)}>
              <CatChip $cat={it.category}>{t(`qhelper.fbCat.${it.category}`)}</CatChip>
              {it.priority === 'high' && <UrgentChip>{t('adminFeedback.urgent', '긴급')}</UrgentChip>}
              <RowTitle>{it.title}</RowTitle>
              <RowMeta>
                {it.user?.name || `#${it.user_id}`} · {new Date(it.created_at).toLocaleDateString()}
              </RowMeta>
            </Row>
          ))}
        </List>
       )}

      <DetailDrawer
        open={!!detail}
        onClose={() => setDetailId(null)}
        width={520}
        ariaLabel={t('adminFeedback.detailTitle', '피드백 상세') as string}
      >
        <DetailDrawer.Header onClose={() => setDetailId(null)}>
          <DrawerTitle>#{detail?.id} {detail?.title}</DrawerTitle>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {detail && (
            <DrawerSections>
              <Section>
                <ChipRow>
                  <CatChip $cat={detail.category}>{t(`qhelper.fbCat.${detail.category}`)}</CatChip>
                  {detail.priority === 'high' && <UrgentChip>{t('adminFeedback.urgent', '긴급')}</UrgentChip>}
                  <StatusChip $s={detail.status}>{t(`adminFeedback.status.${detail.status}`)}</StatusChip>
                </ChipRow>
                <Meta>
                  <MetaRow><MetaLabel>{t('adminFeedback.user', '사용자')}</MetaLabel><MetaValue>{detail.user?.name} ({detail.user?.email})</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.workspace', '워크스페이스')}</MetaLabel><MetaValue>#{detail.business_id ?? '—'}</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.page', '발생 페이지')}</MetaLabel><MetaValue>{detail.page_url || '—'}</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.ua', '브라우저')}</MetaLabel><MetaValue>{(detail.user_agent || '—').slice(0, 80)}</MetaValue></MetaRow>
                  <MetaRow><MetaLabel>{t('adminFeedback.createdAt', '제출')}</MetaLabel><MetaValue>{new Date(detail.created_at).toLocaleString()}</MetaValue></MetaRow>
                </Meta>
              </Section>
              <Section>
                <SectionLabel>{t('adminFeedback.body', '본문')}</SectionLabel>
                <BodyBox>{detail.body}</BodyBox>
              </Section>
              <Section>
                <SectionLabel>{t('adminFeedback.response', '운영팀 답변')}</SectionLabel>
                <FieldRow>
                  <FieldHalf>
                    <FieldLabel>{t('adminFeedback.statusLabel', '상태')}</FieldLabel>
                    <PlanQSelect size="sm" isSearchable={false}
                      value={{ value: responseStatus, label: t(`adminFeedback.status.${responseStatus}`) as string }}
                      onChange={(opt) => setResponseStatus(((opt as PlanQSelectOption | null)?.value as Status) || 'reviewing')}
                      options={STATUSES.map(s => ({ value: s, label: t(`adminFeedback.status.${s}`) as string }))}
                    />
                  </FieldHalf>
                </FieldRow>
                <ResponseArea
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  placeholder={t('adminFeedback.responsePh', '사용자에게 보낼 답변을 작성하세요') as string}
                  rows={6}
                />
              </Section>
            </DrawerSections>
          )}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <Spacer />
          <PrimaryBtn type="button" onClick={submit} disabled={submitting}>
            {submitting ? t('saving') : t('adminFeedback.submit', '저장')}
          </PrimaryBtn>
        </DetailDrawer.Footer>
      </DetailDrawer>
    </PageShell>
  );
};

export default AdminFeedbackPage;

// ─── styled ───
const SearchInput = styled.input`
  width: 200px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const List = styled.div`display: flex; flex-direction: column; gap: 0;`;
const Row = styled.div<{ $active: boolean }>`
  cursor: pointer;
  display: grid;
  grid-template-columns: auto auto minmax(200px, 1fr) auto;
  gap: 12px; align-items: center;
  padding: 12px 16px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border-bottom: 1px solid #E2E8F0;
  transition: background 0.12s;
  &:first-child { border-top: 1px solid #E2E8F0; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
`;
const RowTitle = styled.div`
  font-size: 14px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const RowMeta = styled.div`
  font-size: 12px; color: #64748B;
  white-space: nowrap; flex-shrink: 0;
`;
const CatChip = styled.span<{ $cat: Category }>`
  flex-shrink: 0;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  ${p => p.$cat === 'bug' ? 'background:#FEE2E2;color:#B91C1C;' :
        p.$cat === 'improve' ? 'background:#DCFCE7;color:#166534;' :
        p.$cat === 'feature' ? 'background:#DBEAFE;color:#1E40AF;' :
        'background:#F1F5F9;color:#475569;'}
`;
const UrgentChip = styled.span`
  flex-shrink: 0;
  padding: 3px 10px; border-radius: 999px;
  background: #F43F5E; color: #FFFFFF;
  font-size: 11px; font-weight: 700;
`;
const StatusChip = styled.span<{ $s: Status }>`
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  ${p => p.$s === 'pending' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'reviewing' ? 'background:#DBEAFE;color:#1E40AF;' :
        p.$s === 'done' ? 'background:#DCFCE7;color:#166534;' :
        'background:#F1F5F9;color:#64748B;'}
`;
const ChipRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
// Drawer
const DrawerTitle = styled.div`font-size: 15px; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const DrawerSections = styled.div`display: flex; flex-direction: column; gap: 20px; padding: 20px;`;
const Section = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const SectionLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.5px;
`;
const Meta = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const MetaRow = styled.div`display: grid; grid-template-columns: 100px 1fr; gap: 12px; font-size: 12.5px;`;
const MetaLabel = styled.div`color: #64748B;`;
const MetaValue = styled.div`color: #0F172A; word-break: break-all;`;
const BodyBox = styled.pre`
  margin: 0; padding: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit;
  white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto;
`;
const FieldRow = styled.div`display: flex; gap: 12px;`;
const FieldHalf = styled.div`flex: 1; display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
const ResponseArea = styled.textarea`
  width: 100%; padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Spacer = styled.div`flex: 1;`;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 18px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #0D9488; }
`;
