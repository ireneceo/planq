// 플랫폼 관리자 «확인 필요» — 관리자가 처리할 일을 한 목록으로.
// 라우트: /admin/inbox · 원천: GET /api/admin/todo (services/adminTodo.js — 사이드바 배지와 같은 응답)
//
// 2026-10-08 신설 (Irene: "플랫폼관리자에서 입금확인해야 하는거 알림이 안떠. 여기도 할일필요 메뉴랑 알림표시들 다 제대로").
// 이 화면은 **처리하지 않는다** — 각 행은 처리하는 화면(구독 관리·결제 이력·문의·피드백)으로 데려간다.
// 입금 확인·세금계산서 발행은 돈이 걸린 동작이라 확인창이 있는 원래 화면 한 곳에서만 한다(두 벌이면 갈라진다).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { formatDayTime } from '../../utils/dateFormat';
import { listRowTitleCss } from '../../theme/tokens';

type ItemType = 'deposit_plan' | 'deposit_addon' | 'tax_invoice' | 'inquiry' | 'feedback';
type Filter = 'all' | 'deposit' | 'tax_invoice' | 'inquiry' | 'feedback';

interface TodoItem {
  type: ItemType;
  id: number;
  link: string;
  at: string | null;
  business_name?: string | null;
  amount?: number;
  currency?: string;
  plan_code?: string | null;
  cycle?: string | null;
  addon_code?: string | null;
  payer_name?: string | null;
  tax_status?: 'requested' | 'failed';
  biz_name?: string | null;
  title?: string;
  from_name?: string;
  status?: string;
  kind?: string;
  priority?: string;
}

interface TodoResponse {
  total: number;
  counts: Record<ItemType, number>;
  items: TodoItem[];
}

const FILTERS: Filter[] = ['all', 'deposit', 'tax_invoice', 'inquiry', 'feedback'];

const matches = (f: Filter, type: ItemType) =>
  f === 'all' || (f === 'deposit' ? (type === 'deposit_plan' || type === 'deposit_addon') : type === f);

const AdminInboxPage = () => {
  const { t, i18n } = useTranslation('admin');
  const [data, setData] = useState<TodoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch('/api/admin/todo');
      const j = await r.json();
      if (j.success) { setData(j.data); setError(false); } else if (!silent) setError(true);
    } catch {
      if (!silent) setError(true);
    } finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 실시간 — 관리자 알림 도착(입금 통보·문의·피드백) · 같은 탭에서 처리 · 탭 복귀
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void load(true); }, 250); };
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    window.addEventListener('admin-todo:refresh', soon);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', soon);
    const off = onSocket<{ business_id?: number | null }>('notification:new', (p) => { if (p?.business_id == null) soon(); });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('admin-todo:refresh', soon);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', soon);
      off();
    };
  }, [load]);

  const countOf = (f: Filter) => {
    if (!data) return 0;
    if (f === 'all') return data.total;
    if (f === 'deposit') return (data.counts.deposit_plan || 0) + (data.counts.deposit_addon || 0);
    return data.counts[f] || 0;
  };

  const rows = useMemo(() => (data?.items || []).filter((it) => matches(filter, it.type)), [data, filter]);

  const fmtMoney = (n?: number, cur?: string) => {
    if (n == null) return '';
    const num = new Intl.NumberFormat(i18n.language === 'ko' ? 'ko-KR' : 'en-US').format(Math.round(n));
    return cur === 'KRW' ? t('inbox.krw', { n: num, defaultValue: '{{n}}원' }) as string : `${cur} ${num}`;
  };
  const fmtDate = (s: string | null) =>
    s ? formatDayTime(s, { locale: i18n.language === 'ko' ? 'ko-KR' : 'en-US', tz: 'Asia/Seoul', year: 'auto' }) : '';

  const typeLabel = (type: ItemType) => t(`inbox.type.${type}`, {
    defaultValue: ({ deposit_plan: '입금 확인', deposit_addon: '입금 확인 (추가 구매)', tax_invoice: '세금계산서', inquiry: '문의', feedback: '피드백' } as Record<ItemType, string>)[type],
  }) as string;

  const actionLabel = (type: ItemType) => t(`inbox.action.${type}`, {
    defaultValue: ({ deposit_plan: '입금 확인하기', deposit_addon: '입금 확인하기', tax_invoice: '발행하기', inquiry: '답변하기', feedback: '답변하기' } as Record<ItemType, string>)[type],
  }) as string;

  const rowTitle = (it: TodoItem) => {
    if (it.type === 'deposit_plan' || it.type === 'deposit_addon' || it.type === 'tax_invoice') {
      return it.business_name || t('inbox.unknownWorkspace', { id: it.id, defaultValue: '워크스페이스' });
    }
    return it.title || '';
  };

  const rowMeta = (it: TodoItem): string[] => {
    const out: string[] = [];
    if (it.type === 'deposit_plan' || it.type === 'deposit_addon') {
      out.push(fmtMoney(it.amount, it.currency));
      if (it.type === 'deposit_plan' && it.plan_code) out.push(`${it.plan_code} · ${it.cycle === 'yearly' ? t('subs.yearly', '연간') : t('subs.monthly', '월간')}`);
      if (it.type === 'deposit_addon' && it.addon_code) out.push(it.addon_code);
      if (it.payer_name) out.push(t('inbox.payer', { name: it.payer_name, defaultValue: '입금자 {{name}}' }) as string);
      out.push(t('inbox.notifiedAt', { date: fmtDate(it.at), defaultValue: '{{date}} 입금 통보' }) as string);
    } else if (it.type === 'tax_invoice') {
      out.push(fmtMoney(it.amount, it.currency));
      if (it.biz_name) out.push(it.biz_name);
      out.push(it.tax_status === 'failed'
        ? t('inbox.taxFailed', '발행 실패 — 다시 발행 필요') as string
        : t('inbox.taxRequested', { date: fmtDate(it.at), defaultValue: '{{date}} 결제 · 발행 요청' }) as string);
    } else if (it.type === 'inquiry') {
      if (it.from_name) out.push(it.from_name);
      out.push(t(`inbox.status.${it.status}`, it.status || '') as string);
      out.push(fmtDate(it.at));
    } else {
      out.push(t(`inbox.status.${it.status}`, it.status || '') as string);
      if (it.kind === 'inquiry') out.push(t('inbox.feedbackInquiry', '사용자 문의') as string);
      out.push(fmtDate(it.at));
    }
    return out.filter(Boolean);
  };

  return (
    <PageShell title={t('inbox.title', '확인 필요')} count={data?.total}>
      <Wrap>
        <Hint>{t('inbox.hint', '관리자가 처리할 일입니다. 누르면 처리하는 화면으로 갑니다 — 처리하면 여기서 빠집니다.')}</Hint>
        <TabBar role="tablist">
          {FILTERS.map((f) => {
            const cnt = countOf(f);
            return (
              <TabBtn key={f} role="tab" type="button" $active={filter === f} aria-selected={filter === f}
                data-testid={`admin-inbox-tab-${f}`} onClick={() => setFilter(f)}>
                <span>{t(`inbox.tab.${f}`, ({ all: '전체', deposit: '입금 확인', tax_invoice: '세금계산서', inquiry: '문의', feedback: '피드백' } as Record<Filter, string>)[f]) as string}</span>
                {cnt > 0 && <Count $active={filter === f}>{cnt}</Count>}
              </TabBtn>
            );
          })}
        </TabBar>

        {error && (
          <ErrorBox>
            <span>{t('inbox.loadFailed', '목록을 불러오지 못했습니다')}</span>
            <RetryBtn type="button" onClick={() => { void load(); }}>{t('inbox.retry', '다시 시도')}</RetryBtn>
          </ErrorBox>
        )}

        {loading ? (
          <Skeleton />
        ) : rows.length === 0 && !error ? (
          <EmptyState
            icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
            title={t('inbox.empty', '처리할 일이 없습니다') as string}
            description={t('inbox.emptyDesc', '입금 통보·세금계산서 요청·문의·피드백이 들어오면 여기에 모입니다.') as string}
          />
        ) : (
          <List data-testid="admin-inbox-list">
            {rows.map((it) => (
              <Row key={`${it.type}-${it.id}`} to={it.link} data-testid={`admin-inbox-row-${it.type}-${it.id}`}>
                <TypeChip $type={it.type}>{typeLabel(it.type)}</TypeChip>
                <RowBody>
                  <RowTitle>{rowTitle(it)}</RowTitle>
                  <RowMeta>{rowMeta(it).map((m, i) => <span key={i}>{m}</span>)}</RowMeta>
                </RowBody>
                <Action>{actionLabel(it.type)}</Action>
              </Row>
            ))}
          </List>
        )}
      </Wrap>
    </PageShell>
  );
};

export default AdminInboxPage;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; padding: 0 20px 20px;
  @media (max-width: 640px) { padding: 0 0 16px; }`;
const Hint = styled.p`margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const TabBar = styled.div`
  display: flex; gap: 4px; padding: 0 4px;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; background: transparent; border: none;
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  font-size: 0.8125rem; font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer; white-space: nowrap;
  &:hover { color: #0F172A; }
`;
const Count = styled.span<{ $active: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; padding: 1px 7px; font-size: 0.6875rem; font-weight: 700;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  border-radius: 999px;
`;
const ErrorBox = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; border-radius: 8px;
  background: #FEF2F2; color: #B91C1C;
  font-size: 0.8125rem; border: 1px solid #FECACA;
`;
const RetryBtn = styled.button`
  padding: 6px 12px; font-size: 0.75rem; font-weight: 600;
  background: #FFFFFF; color: #B91C1C; border: 1px solid #FECACA; border-radius: 6px; cursor: pointer;
`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled(Link)`
  display: flex; gap: 14px; align-items: center;
  padding: 14px 16px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 10px;
  text-decoration: none; color: inherit;
  &:hover { border-color: #99F6E4; background: #F8FFFE; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) { flex-wrap: wrap; gap: 8px 10px; }
`;
const TYPE_TONE: Record<ItemType, { bg: string; fg: string }> = {
  deposit_plan: { bg: '#FEF3C7', fg: '#92400E' },
  deposit_addon: { bg: '#FEF3C7', fg: '#92400E' },
  tax_invoice: { bg: '#E0F2FE', fg: '#0369A1' },
  inquiry: { bg: '#F0FDFA', fg: '#0F766E' },
  feedback: { bg: '#F1F5F9', fg: '#475569' },
};
const TypeChip = styled.span<{ $type: ItemType }>`
  flex-shrink: 0; min-width: 72px; text-align: center;
  padding: 3px 8px; font-size: 0.6875rem; font-weight: 700; border-radius: 4px;
  background: ${p => TYPE_TONE[p.$type].bg}; color: ${p => TYPE_TONE[p.$type].fg};
`;
const RowBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  @media (max-width: 640px) { flex-basis: 100%; order: 3; }`;
const RowTitle = styled.div`
  ${listRowTitleCss}
  color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const RowMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px 12px;
  font-size: 0.75rem; color: #64748B;
`;
const Action = styled.span`
  flex-shrink: 0; font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  @media (max-width: 640px) { margin-left: auto; }
`;
const Skeleton = styled.div`
  height: 200px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 10px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
