// 결제 이력 + 환불·조정 — platform_admin 만
// 라우트: /admin/payments

import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { apiFetch } from '../../contexts/AuthContext';

type PayStatus = 'all' | 'paid' | 'pending' | 'failed' | 'refunded' | 'canceled';

interface PaymentRow {
  id: number;
  business: { id: number; name: string; slug: string } | null;
  subscription: { id: number; plan_code: string; cycle: string; status: string } | null;
  method: 'bank_transfer' | 'card' | 'portone' | 'manual_adjust';
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled';
  amount: number;
  currency: string;
  cycle: 'monthly' | 'yearly';
  period_start: string | null;
  period_end: string | null;
  payer_name: string | null;
  payer_memo: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  created_at: string;
  // Day 8/10 — addon / 세금계산서
  kind: 'plan' | 'addon';
  addon_code: string | null;
  addon_quantity: number | null;
  tax_invoice_requested: boolean;
  tax_invoice_status: 'none' | 'requested' | 'issued' | 'failed';
  tax_invoice_data: { biz_no?: string; biz_name?: string; ceo_name?: string; address?: string; email?: string } | null;
  tax_invoice_issued_at: string | null;
}

interface Summary {
  pending: number; paid: number; failed: number; refunded: number; canceled: number; total: number;
  month_revenue: number;
}

const STATUS_TABS: PayStatus[] = ['all', 'paid', 'pending', 'failed', 'refunded'];

const AdminPaymentsPage = () => {
  const { t, i18n } = useTranslation('admin');
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<PayStatus>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<PaymentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (activeStatus !== 'all') sp.set('status', activeStatus);
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/admin/payments?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
      const s = await apiFetch('/api/admin/payments/summary');
      const sj = await s.json();
      if (sj.success) setSummary(sj.data);
    } catch (e) {
      setError(t('payments.loadFailed', '목록을 불러오지 못했습니다') as string);
    } finally { setLoading(false); }
  }, [activeStatus, search, t]);

  useEffect(() => { load(); }, [load]);

  const fmtKRW = (n: number) => new Intl.NumberFormat('ko-KR').format(Math.round(n));
  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(i18n.language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul' }) : '—';

  const statusColor = (s: PaymentRow['status']) => {
    switch (s) {
      case 'paid': return { bg: '#CCFBF1', fg: '#0F766E' };
      case 'pending': return { bg: '#FEF3C7', fg: '#92400E' };
      case 'failed': return { bg: '#FEE2E2', fg: '#B91C1C' };
      case 'refunded': return { bg: '#F1F5F9', fg: '#64748B' };
      default: return { bg: '#F1F5F9', fg: '#64748B' };
    }
  };

  const statusLabel = (s: PaymentRow['status']) => {
    const fb: Record<PaymentRow['status'], string> = {
      pending: '대기', paid: '완료', failed: '실패', refunded: '환불', canceled: '취소',
    };
    return t(`payments.status.${s}`, fb[s]) as string;
  };

  const methodLabel = (m: PaymentRow['method']) => {
    const fb: Record<PaymentRow['method'], string> = {
      bank_transfer: '계좌이체', card: '카드', portone: 'PortOne', manual_adjust: '수기 조정',
    };
    return t(`payments.method.${m}`, fb[m]) as string;
  };

  const handleRefund = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: t('payments.refundReason', '관리자 환불') }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      setConfirm(null);
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.refundFailed', '환불 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  const handleMarkPaid = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/mark-paid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.markPaidFailed', '입금 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  const handleIssueTaxInvoice = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/issue-tax-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issued_by: 'manual' }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.taxIssueFailed', '세금계산서 발행 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  return (
    <PageShell
      title={t('payments.title', '결제 이력')}
      count={items.length}
      actions={<SearchBox value={search} onChange={setSearch} placeholder={t('payments.searchPh', '워크스페이스명') as string} />}
    >
      <Wrap>
        {/* 이번 달 수익 카드 */}
        {summary && (
          <KpiRow>
            <Kpi>
              <KpiLabel>{t('payments.monthRevenue', '이번 달 수익 (확정)')}</KpiLabel>
              <KpiValue>KRW {fmtKRW(summary.month_revenue)}</KpiValue>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('payments.totalPaid', '누적 완료')}</KpiLabel>
              <KpiValue>{summary.paid}</KpiValue>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('payments.totalPending', '대기')}</KpiLabel>
              <KpiValue>{summary.pending}</KpiValue>
            </Kpi>
          </KpiRow>
        )}

        <TabBar role="tablist">
          {STATUS_TABS.map((s) => {
            const tabFb: Record<PayStatus, string> = {
              all: '전체', paid: '완료', pending: '대기', failed: '실패', refunded: '환불', canceled: '취소',
            };
            const cnt = s === 'all' ? (summary?.total || 0) : (summary as unknown as Record<string, number>)?.[s] || 0;
            return (
              <TabBtn key={s} role="tab" type="button" $active={activeStatus === s}
                aria-selected={activeStatus === s} onClick={() => setActiveStatus(s)}>
                <span>{t(`payments.tab.${s}`, tabFb[s]) as string}</span>
                {cnt > 0 && <Count $active={activeStatus === s}>{cnt}</Count>}
              </TabBtn>
            );
          })}
        </TabBar>

        {error && <ErrorBox>{error}</ErrorBox>}

        {loading ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>}
            title={t('payments.empty', '결제 이력이 없습니다') as string}
            description={t('payments.emptyDesc', '필터를 바꿔서 확인해 보세요.') as string}
          />
        ) : (
          <List>
            {items.map((p) => {
              const c = statusColor(p.status);
              return (
                <Row key={p.id}>
                  <RowLeft>
                    <RowTop>
                      <BizName>{p.business?.name || `(workspace ${p.business?.id})`}</BizName>
                      <StatusBadge $bg={c.bg} $fg={c.fg}>{statusLabel(p.status)}</StatusBadge>
                    </RowTop>
                    <RowMeta>
                      <Tag>{p.subscription?.plan_code} · {p.cycle === 'monthly' ? t('subs.monthly', '월간') : t('subs.yearly', '연간')}</Tag>
                      <Tag>{methodLabel(p.method)}</Tag>
                      <Amount>{p.currency} {fmtKRW(p.amount)}</Amount>
                    </RowMeta>
                    <RowDates>
                      <span>{t('payments.created', '발행')}: {fmtDate(p.created_at)}</span>
                      {p.paid_at && <span>{t('payments.paid', '결제 완료')}: {fmtDate(p.paid_at)}</span>}
                      {p.refunded_at && <span>{t('payments.refunded', '환불')}: {fmtDate(p.refunded_at)}</span>}
                      {p.payer_name && <span>{t('payments.payer', '입금자')}: {p.payer_name}</span>}
                    </RowDates>
                    {p.refund_reason && <Reason>{p.refund_reason}</Reason>}
                  </RowLeft>
                  <RowRight>
                    {p.status === 'pending' && (
                      <PrimaryBtn type="button" disabled={busyId === p.id}
                        onClick={() => handleMarkPaid(p)}>
                        {busyId === p.id ? '...' : t('payments.markPaid', '입금 완료 처리')}
                      </PrimaryBtn>
                    )}
                    {p.status === 'paid' && p.tax_invoice_status === 'requested' && (
                      <PrimaryBtn type="button" disabled={busyId === p.id}
                        onClick={() => handleIssueTaxInvoice(p)}
                        title={p.tax_invoice_data?.biz_name || ''}>
                        {busyId === p.id ? '...' : t('payments.issueTaxInvoice', '세금계산서 발행')}
                      </PrimaryBtn>
                    )}
                    {p.status === 'paid' && p.tax_invoice_status === 'issued' && (
                      <Tag>{t('payments.taxIssued', '세금계산서 발행됨')}</Tag>
                    )}
                    {p.kind === 'addon' && <Tag>Add-on</Tag>}
                    {p.status === 'paid' && (
                      <DangerBtn type="button" disabled={busyId === p.id}
                        onClick={() => setConfirm(p)}>
                        {t('payments.refund', '환불')}
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
            title={t('payments.confirmRefundTitle', '환불 처리') as string}
            message={t('payments.confirmRefundMsg', { amount: `${confirm.currency} ${fmtKRW(confirm.amount)}`, biz: confirm.business?.name, defaultValue: '{{biz}} 의 {{amount}} 결제를 환불 처리합니다.' }) as string}
            confirmText={t('payments.refund', '환불') as string}
            variant="danger"
            onConfirm={() => handleRefund(confirm)}
            onClose={() => setConfirm(null)}
          />
        )}
      </Wrap>
    </PageShell>
  );
};

export default AdminPaymentsPage;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; padding: 0 20px 20px;`;
const KpiRow = styled.div`
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
`;
const Kpi = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
`;
const KpiLabel = styled.div`font-size: 12px; color: #64748B; font-weight: 600;`;
const KpiValue = styled.div`font-size: 20px; font-weight: 700; color: #0F172A;`;
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
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
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
const Row = styled.article`
  display: flex; gap: 16px; align-items: center;
  padding: 14px 16px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 10px;
  @media (max-width: 768px) { flex-direction: column; align-items: stretch; }
`;
const RowLeft = styled.div`flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const RowTop = styled.div`display: flex; gap: 8px; align-items: center;`;
const BizName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  padding: 2px 8px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 4px;
`;
const RowMeta = styled.div`display: flex; gap: 6px; flex-wrap: wrap; align-items: center;`;
const Tag = styled.span`
  padding: 2px 8px; font-size: 11px; font-weight: 600;
  background: #F0FDFA; color: #0F766E; border-radius: 4px;
`;
const Amount = styled.span`font-size: 13px; color: #0F172A; font-weight: 700;`;
const RowDates = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 11px; color: #94A3B8;
`;
const Reason = styled.div`font-size: 12px; color: #64748B; font-style: italic; margin-top: 2px;`;
const RowRight = styled.div`display: flex; gap: 8px; flex-shrink: 0;`;
const DangerBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: #FFFFFF; color: #DC2626;
  border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #FFFFFF;
  border: 0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
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
