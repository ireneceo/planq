// 고객 통합 타임라인 (Customer 360) — 사이클 N+87 Phase A.
//   한 고객의 채팅·메일·업무·청구를 채널 무관 시간순 한 화면. 내부 전용(멤버).
//   백엔드: GET /api/clients/:biz/:clientId/timeline (services/clientTimeline.js)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import PageShell from '../../components/Layout/PageShell';

type Channel = 'chat' | 'email' | 'task' | 'invoice';
interface TItem {
  type: Channel;
  id: number;
  at: string;
  title: string | null;
  preview?: string;
  conversation_id?: number;
  thread_id?: number;
  meta?: Record<string, unknown>;
}

const CHANNELS: Channel[] = ['chat', 'email', 'task', 'invoice'];
const PAGE = 30;

const ClientTimelinePage: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { formatTimeAgo, formatDateTime } = useTimeFormat();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [clientName, setClientName] = useState<string>('');
  const [items, setItems] = useState<TItem[]>([]);
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

  const openItem = (it: TItem) => {
    if (it.type === 'chat' && it.conversation_id) navigate(`/talk?conv=${it.conversation_id}`);
    else if (it.type === 'email' && it.thread_id) navigate(`/qmail?thread=${it.thread_id}`);
    else if (it.type === 'task') navigate(`/qtask?task=${it.id}`);
    else if (it.type === 'invoice') navigate(`/bills?invoice=${it.id}`);
  };

  const filters: Array<{ key: 'all' | Channel; label: string }> = useMemo(() => [
    { key: 'all', label: t('timeline.filter.all', '전체') as string },
    ...CHANNELS.map((c) => ({ key: c, label: t(`timeline.channel.${c}`, c) as string })),
  ], [t]);

  return (
    <PageShell
      title={clientName ? t('timeline.titleNamed', { name: clientName, defaultValue: '{{name}} · 통합 타임라인' }) as string : t('timeline.title', '고객 통합 타임라인') as string}
      actions={<BackBtn type="button" onClick={() => navigate('/business/clients')}>{t('timeline.back', '고객 목록') as string}</BackBtn>}
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
      ) : items.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('timeline.empty', '아직 활동 기록이 없어요')}</EmptyTitle>
          <EmptyDesc>{t('timeline.emptyDesc', '이 고객과의 채팅·메일·업무·청구가 생기면 여기에 시간순으로 모입니다.')}</EmptyDesc>
        </Empty>
      ) : (
        <Scroll onScroll={onScroll}>
          {items.map((it) => (
            <Row key={`${it.type}-${it.id}`} type="button" onClick={() => openItem(it)}>
              <TypeBadge $type={it.type}>{t(`timeline.channel.${it.type}`, it.type) as string}</TypeBadge>
              <Body>
                <RowTitle>{it.title || t(`timeline.untitled.${it.type}`, '(제목 없음)') as string}</RowTitle>
                {it.preview && <Preview>{it.preview}</Preview>}
                <Metas>
                  {it.type === 'invoice' && it.meta?.grand_total != null && (
                    <Meta>{Number(it.meta.grand_total).toLocaleString()} {String(it.meta.currency || 'KRW')}</Meta>
                  )}
                  {it.type === 'task' && it.meta?.status != null && (
                    <Meta>{t(`timeline.taskStatus.${String(it.meta.status)}`, String(it.meta.status)) as string}</Meta>
                  )}
                  {it.type === 'email' && it.meta?.direction != null && (
                    <Meta>{it.meta.direction === 'inbound' ? t('timeline.received', '받음') : t('timeline.sent', '보냄') as string}</Meta>
                  )}
                </Metas>
              </Body>
              <TimeCell title={formatDateTime(it.at)}>{formatTimeAgo(it.at)}</TimeCell>
            </Row>
          ))}
          {loadingMore && <MoreRow><Spinner aria-hidden /></MoreRow>}
        </Scroll>
      )}
    </PageShell>
  );
};

export default ClientTimelinePage;

const BackBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  color: #334155; background: #fff; border: 1px solid #CBD5E1;
  &:hover { background: #F1F5F9; }
`;
const FilterRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;`;
const FilterChip = styled.button<{ $active?: boolean }>`
  height: 32px; padding: 0 14px; border-radius: 999px;
  font-size: 13px; font-weight: 600; cursor: pointer;
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
const Row = styled.button`
  display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: start;
  width: 100%; text-align: left; cursor: pointer;
  padding: 14px 16px; border-radius: 12px;
  background: #fff; border: 1px solid #E2E8F0;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover { border-color: #CBD5E1; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
`;
const typeColor: Record<Channel, { bg: string; fg: string }> = {
  chat: { bg: '#F0FDFA', fg: '#0F766E' },
  email: { bg: '#EFF6FF', fg: '#1D4ED8' },
  task: { bg: '#FEF3C7', fg: '#92400E' },
  invoice: { bg: '#F0FDFA', fg: '#0F766E' },
};
const TypeBadge = styled.span<{ $type: Channel }>`
  display: inline-flex; align-items: center; justify-content: center;
  height: 24px; padding: 0 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  background: ${(p) => typeColor[p.$type].bg}; color: ${(p) => typeColor[p.$type].fg};
`;
const Body = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const RowTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Preview = styled.div`font-size: 13px; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Metas = styled.div`display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;`;
const Meta = styled.span`font-size: 11px; font-weight: 600; color: #475569; background: #F1F5F9; border-radius: 999px; padding: 1px 8px;`;
const TimeCell = styled.div`font-size: 12px; color: #94A3B8; white-space: nowrap; flex-shrink: 0;`;
const CenterMsg = styled.div`display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px 24px; font-size: 13px; color: #94A3B8;`;
const Empty = styled.div`display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 64px 24px; text-align: center;`;
const EmptyTitle = styled.div`font-size: 15px; font-weight: 700; color: #334155;`;
const EmptyDesc = styled.div`font-size: 13px; color: #94A3B8; line-height: 1.5; max-width: 360px;`;
const MoreRow = styled.div`display: flex; justify-content: center; padding: 16px;`;
const Spinner = styled.span`
  width: 18px; height: 18px; border: 2px solid #E2E8F0; border-top-color: #14B8A6;
  border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
