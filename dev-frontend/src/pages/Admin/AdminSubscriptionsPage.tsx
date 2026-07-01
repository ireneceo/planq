// 플랫폼 → 워크스페이스 PlanQ 구독 관리 — platform_admin 만.
// 라우트: /admin/subscriptions
// 기능: 상태별 탭 (전체/active/pending/past_due/grace/demoted) + 검색 + mark-paid + 강제 강등

import { useEffect, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { apiFetch } from '../../contexts/AuthContext';

type SubStatus = 'all' | 'active' | 'pending' | 'past_due' | 'grace' | 'demoted' | 'canceled';

interface PendingPayment {
  id: number;
  amount: number;
  method: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  // 고객 입금 통보 — 관리자 확인 우선순위 표시용
  notify_paid_at: string | null;
  notify_payer_name: string | null;
}

interface SubscriptionRow {
  id: number;
  business: { id: number; name: string; slug: string; plan: string; subscription_status: string | null } | null;
  plan_code: string;
  cycle: 'monthly' | 'yearly';
  status: 'pending' | 'active' | 'past_due' | 'grace' | 'demoted' | 'canceled' | 'replaced';
  price: number;
  currency: string;
  started_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_ends_at: string | null;
  demoted_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  pending_payment: PendingPayment | null;
}

interface Summary {
  active: number; pending: number; past_due: number; grace: number; demoted: number; canceled: number; total: number;
}

const STATUS_TABS: SubStatus[] = ['all', 'active', 'pending', 'past_due', 'grace', 'demoted'];

const AdminSubscriptionsPage = () => {
  const { t, i18n } = useTranslation('admin');
  const [items, setItems] = useState<SubscriptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<SubStatus>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'pay' | 'demote'; sub: SubscriptionRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (activeStatus !== 'all') sp.set('status', activeStatus);
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/admin/subscriptions?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
      const s = await apiFetch('/api/admin/subscriptions/summary');
      const sj = await s.json();
      if (sj.success) setSummary(sj.data);
    } catch (e) {
      setError(t('subs.loadFailed', '목록을 불러오지 못했습니다') as string);
    } finally { setLoading(false); }
  }, [activeStatus, search, t]);

  useEffect(() => { load(); }, [load]);

  const fmtKRW = (n: number) => new Intl.NumberFormat('ko-KR').format(Math.round(n));
  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(i18n.language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul' }) : '—';

  const statusLabel = (s: SubscriptionRow['status']) => {
    const fallback: Record<SubscriptionRow['status'], string> = {
      pending: '결제대기', active: '활성', past_due: '연체', grace: '유예중', demoted: '강등됨',
      canceled: '취소', replaced: '교체됨',
    };
    return t(`subs.status.${s}`, fallback[s]) as string;
  };

  const statusColor = (s: SubscriptionRow['status']): { bg: string; fg: string } => {
    switch (s) {
      case 'active': return { bg: '#CCFBF1', fg: '#0F766E' };
      case 'pending': return { bg: '#F1F5F9', fg: '#64748B' };
      case 'past_due': return { bg: '#FEE2E2', fg: '#B91C1C' };
      case 'grace': return { bg: '#FEF3C7', fg: '#92400E' };
      case 'demoted': return { bg: '#FECACA', fg: '#7F1D1D' };
      default: return { bg: '#F1F5F9', fg: '#64748B' };
    }
  };

  const handleMarkPaid = async (sub: SubscriptionRow) => {
    setBusyId(sub.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/subscriptions/${sub.id}/mark-paid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      setConfirm(null);
    } catch (e: unknown) {
      setError((e as Error).message || (t('subs.markPaidFailed', 'mark-paid 실패') as string));
    } finally { setBusyId(null); }
  };

  const handleDemote = async (sub: SubscriptionRow) => {
    setBusyId(sub.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/subscriptions/${sub.id}/demote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin manual demote' }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      setConfirm(null);
    } catch (e: unknown) {
      setError((e as Error).message || (t('subs.demoteFailed', '강등 실패') as string));
    } finally { setBusyId(null); }
  };

  const tabCount = useMemo(() => (s: SubStatus) => {
    if (!summary) return 0;
    if (s === 'all') return summary.total;
    return (summary as unknown as Record<string, number>)[s] || 0;
  }, [summary]);

  return (
    <PageShell
      title={t('subs.title', '구독 관리')}
      count={items.length}
      actions={<SearchBox value={search} onChange={setSearch} placeholder={t('subs.searchPh', '워크스페이스명 검색') as string} />}
    >
      <Wrap>
        <TabBar role="tablist">
          {STATUS_TABS.map((s) => {
            const tabLabels: Record<SubStatus, string> = {
              all: '전체', active: '활성', pending: '결제대기', past_due: '연체', grace: '유예', demoted: '강등', canceled: '취소',
            };
            return (
              <TabBtn key={s} role="tab" type="button" $active={activeStatus === s}
                aria-selected={activeStatus === s} onClick={() => setActiveStatus(s)}>
                <span>{t(`subs.tab.${s}`, tabLabels[s]) as string}</span>
                {tabCount(s) > 0 && <Count $active={activeStatus === s}>{tabCount(s)}</Count>}
              </TabBtn>
            );
          })}
        </TabBar>

        {error && <ErrorBox>{error}</ErrorBox>}

        {loading ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>}
            title={t('subs.empty', '해당 상태의 구독이 없습니다') as string}
            description={t('subs.emptyDesc', '필터를 바꿔서 확인하거나 검색해 보세요.') as string}
          />
        ) : (
          <List>
            {items.map((s) => {
              const c = statusColor(s.status);
              const notified = !!s.pending_payment?.notify_paid_at;
              return (
                <Row key={s.id} $notified={notified}>
                  <RowLeft>
                    <BizName>{s.business?.name || `(workspace ${s.business?.id})`}</BizName>
                    <RowMeta>
                      <PlanBadge>{s.plan_code} · {s.cycle === 'monthly' ? t('subs.monthly', '월간') : t('subs.yearly', '연간')}</PlanBadge>
                      <StatusBadge $bg={c.bg} $fg={c.fg}>{statusLabel(s.status)}</StatusBadge>
                      <Price>{s.currency} {fmtKRW(s.price)}</Price>
                      {notified && <NotifyBadge>{t('subs.notified', '입금 통보')}</NotifyBadge>}
                    </RowMeta>
                    <RowDates>
                      {notified && (
                        <NotifyLine>
                          {t('subs.notifiedAt', '입금 통보')}: {fmtDate(s.pending_payment!.notify_paid_at)}
                          {s.pending_payment!.notify_payer_name ? ` · ${t('subs.payer', '입금자')} ${s.pending_payment!.notify_payer_name}` : ''}
                        </NotifyLine>
                      )}
                      {s.current_period_end && <span>{t('subs.periodEnd', '기간 종료')}: {fmtDate(s.current_period_end)}</span>}
                      {s.grace_ends_at && <span>{t('subs.graceEnd', '유예 종료')}: {fmtDate(s.grace_ends_at)}</span>}
                      {s.demoted_at && <span>{t('subs.demotedAt', '강등')}: {fmtDate(s.demoted_at)}</span>}
                    </RowDates>
                  </RowLeft>
                  <RowRight>
                    {s.pending_payment && (
                      <PrimaryBtn type="button" disabled={busyId === s.id}
                        onClick={() => setConfirm({ kind: 'pay', sub: s })}>
                        {t('subs.markPaid', '입금 확인')}
                      </PrimaryBtn>
                    )}
                    {(s.status === 'active' || s.status === 'past_due' || s.status === 'grace') && (
                      <DangerBtn type="button" disabled={busyId === s.id}
                        onClick={() => setConfirm({ kind: 'demote', sub: s })}>
                        {t('subs.demote', '강등')}
                      </DangerBtn>
                    )}
                  </RowRight>
                </Row>
              );
            })}
          </List>
        )}

        {confirm && (
          <ConfirmDialog
            isOpen
            title={confirm.kind === 'pay' ? t('subs.confirmPayTitle', '입금 확인') as string : t('subs.confirmDemoteTitle', '강등 처리') as string}
            message={confirm.kind === 'pay'
              ? t('subs.confirmPayMsg', { biz: confirm.sub.business?.name, defaultValue: '{{biz}} 의 결제 대기 건을 입금 확인 처리합니다. 구독이 활성화됩니다.' }) as string
              : t('subs.confirmDemoteMsg', { biz: confirm.sub.business?.name, defaultValue: '{{biz}} 를 Free 플랜으로 강등합니다. 데이터는 보존됩니다.' }) as string}
            confirmText={confirm.kind === 'pay' ? t('subs.markPaid', '입금 확인') as string : t('subs.demote', '강등') as string}
            variant={confirm.kind === 'demote' ? 'danger' : 'info'}
            onConfirm={() => confirm.kind === 'pay' ? handleMarkPaid(confirm.sub) : handleDemote(confirm.sub)}
            onClose={() => setConfirm(null)}
          />
        )}
      </Wrap>
    </PageShell>
  );
};

export default AdminSubscriptionsPage;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; padding: 0 20px 20px;`;
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
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer; white-space: nowrap;
  &:hover { color: #0F172A; }
`;
const Count = styled.span<{ $active: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; padding: 1px 7px; font-size: 11px; font-weight: 700;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  border-radius: 999px;
`;
const ErrorBox = styled.div`
  padding: 10px 14px; border-radius: 8px;
  background: #FEF2F2; color: #B91C1C;
  font-size: 13px; border: 1px solid #FECACA;
`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.article<{ $notified?: boolean }>`
  display: flex; gap: 16px; align-items: center;
  padding: 14px 16px;
  background: ${p => p.$notified ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$notified ? '#5EEAD4' : '#E2E8F0'};
  border-radius: 10px;
  @media (max-width: 768px) { flex-direction: column; align-items: stretch; }
`;
const NotifyBadge = styled.span`
  padding: 2px 8px; font-size: 11px; font-weight: 700;
  background: #0D9488; color: #FFFFFF; border-radius: 4px;
`;
const NotifyLine = styled.span`
  color: #0F766E !important; font-weight: 600;
`;
const RowLeft = styled.div`flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const BizName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const RowMeta = styled.div`display: flex; gap: 6px; flex-wrap: wrap; align-items: center;`;
const PlanBadge = styled.span`
  padding: 2px 8px; font-size: 11px; font-weight: 600;
  background: #F0FDFA; color: #0F766E; border-radius: 4px;
`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  padding: 2px 8px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 4px;
`;
const Price = styled.span`font-size: 12px; color: #64748B; font-weight: 500;`;
const RowDates = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 11px; color: #94A3B8;
`;
const RowRight = styled.div`display: flex; gap: 8px; flex-shrink: 0;`;
const PrimaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DangerBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: #FFFFFF; color: #DC2626;
  border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Skeleton = styled.div`
  height: 200px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 10px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
