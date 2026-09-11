// 고객 통합 타임라인 (Customer 360) — 사이클 N+87 Phase A.
//   한 고객의 채팅·메일·업무·청구를 채널 무관 시간순 한 화면. 내부 전용(멤버).
//   백엔드: GET /api/clients/:biz/:clientId/timeline (services/clientTimeline.js)
//   ★ 행 렌더링은 components/Clients/ClientTimeline 한 벌이다 — Q sale 상세와 같은 것을 그린다.
//     베껴 두면 채널이 늘 때 한쪽에만 붙고, 늘어난 type 이 색 표에 없으면 그 행이 죽는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import ClientTimeline from '../../components/Clients/ClientTimeline';
import type { TimelineItem } from '../../services/sale';

type Channel = 'chat' | 'email' | 'task' | 'invoice';
const CHANNELS: Channel[] = ['chat', 'email', 'task', 'invoice'];
const PAGE = 30;

const ClientTimelinePage: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { user } = useAuth();
  const navigate = useNavigate();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [clientName, setClientName] = useState<string>('');
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Channel>('all');
  const beforeRef = useRef<string | null>(null);

  const channelParam = filter === 'all' ? '' : `&channels=${filter}`;

  const load = useCallback(async (reset: boolean) => {
    if (!businessId || !clientId) return;
    if (reset) { setLoading(true); beforeRef.current = null; } else { setLoadingMore(true); }
    try {
      const before = reset ? '' : (beforeRef.current ? `&before=${encodeURIComponent(beforeRef.current)}` : '');
      const r = await apiFetch(`/api/clients/${businessId}/${clientId}/timeline?limit=${PAGE}${channelParam}${before}`);
      const j = await r.json();
      if (!j.success) { setError(j.message || 'error'); return; }
      const data = j.data;
      setItems((prev) => reset ? data.items : [...prev, ...data.items]);
      setHasMore(!!data.has_more);
      beforeRef.current = data.next_before;
      setError(null);
    } catch {
      setError('load_failed');
    } finally { setLoading(false); setLoadingMore(false); }
  }, [businessId, clientId, channelParam]);

  // 고객 이름
  useEffect(() => {
    if (!businessId || !clientId) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/clients/${businessId}/${clientId}`);
        const j = await r.json();
        if (j.success) setClientName(j.data?.display_name || j.data?.user?.name || '');
      } catch { /* */ }
    })();
  }, [businessId, clientId]);

  useEffect(() => { load(true); }, [load]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasMore && !loadingMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
      load(false);
    }
  }, [hasMore, loadingMore, loading, load]);

  const openItem = (it: TimelineItem) => {
    // 라우트는 /mail · /tasks 다 (App.tsx). /qmail · /qtask 는 존재하지 않아 catch-all 로
    // 대시보드에 튕겼다 — 고객 타임라인에서 메일·업무 항목 클릭이 통째로 죽어 있었다(#246 동류).
    if (it.type === 'chat' && it.conversation_id) navigate(`/talk?conv=${it.conversation_id}`);
    else if (it.type === 'email' && it.thread_id) navigate(`/mail?thread=${it.thread_id}`);
    else if (it.type === 'task') navigate(`/tasks?task=${it.id}`);
    else if (it.type === 'invoice') navigate(`/bills?invoice=${it.id}`);
  };

  const filters: Array<{ key: 'all' | Channel; label: string }> = useMemo(() => [
    { key: 'all', label: t('timeline.filter.all', '전체') as string },
    ...CHANNELS.map((c) => ({ key: c, label: t(`timeline.channel.${c}`, c) as string })),
  ], [t]);

  return (
    <PageShell
      title={clientName ? t('timeline.titleNamed', { name: clientName, defaultValue: '{{name}} · 통합 타임라인' }) as string : t('timeline.title', '고객 통합 타임라인') as string}
      onBack={() => navigate('/business/clients')}
      backLabel={t('timeline.back', '고객 목록') as string}
      actions={<SaleLink type="button" onClick={() => navigate(`/sale/${clientId}`)}>{t('timelineLinks.openInSale') as string}</SaleLink>}
    >
      <FilterRow role="tablist">
        {filters.map((f) => (
          <FilterChip key={f.key} type="button" $active={filter === f.key}
            role="tab" aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}>{f.label}</FilterChip>
        ))}
      </FilterRow>

      {loading ? (
        <CenterMsg><Spinner aria-hidden />{t('timeline.loading', '불러오는 중…')}</CenterMsg>
      ) : error ? (
        <CenterMsg>{t('timeline.error', '타임라인을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')}</CenterMsg>
      ) : (
        <Scroll onScroll={onScroll}>
          <ClientTimeline
            items={items}
            onOpen={openItem}
            emptyText={t('timeline.empty', '아직 활동 기록이 없어요') as string}
          />
          {loadingMore && <MoreRow><Spinner aria-hidden /></MoreRow>}
        </Scroll>
      )}
    </PageShell>
  );
};

export default ClientTimelinePage;

const SaleLink = styled.button`
  height: 32px; padding: 0 12px; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  color: #0F766E; background: #F0FDFA; border: 1px solid #5EEAD4;
  &:hover { background: #CCFBF1; }
`;
const FilterRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;`;
const FilterChip = styled.button<{ $active?: boolean }>`
  height: 32px; padding: 0 14px; border-radius: 999px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#fff')};
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const Scroll = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  max-height: calc(var(--vvh, 100dvh) - 200px); overflow-y: auto;
`;
const CenterMsg = styled.div`display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px 24px; font-size: 0.8125rem; color: #94A3B8;`;
const MoreRow = styled.div`display: flex; justify-content: center; padding: 16px;`;
const Spinner = styled.span`
  width: 18px; height: 18px; border: 2px solid #E2E8F0; border-top-color: #14B8A6;
  border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
