// 결제 추적 — 회차별 임박/완료 큐 (실 API)
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  listInvoices, formatMoney, installmentStatusColor,
  type ApiInstallment, type ApiInvoice,
} from '../../services/invoices';

type PaymentTab = 'upcoming' | 'completed' | 'all';

interface FlatRow {
  invoice: ApiInvoice;
  installment: ApiInstallment | null;  // 단일 청구서면 null
  amount: number;
  due_date: string | null;
  status: string;
  paid_at: string | null;
}

export default function PaymentsTab() {
  const { t } = useTranslation('qbill');
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [tab, setTab] = useState<PaymentTab>('upcoming');
  const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listInvoices(businessId)
      .then(list => { if (!cancelled) setInvoices(list); })
      .catch(() => { if (!cancelled) setInvoices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  const allRows = useMemo(() => buildRows(invoices), [invoices]);

  const filtered = useMemo(() => {
    if (tab === 'all') return allRows;
    if (tab === 'completed') return allRows.filter(r => r.status === 'paid');
    // upcoming = pending + sent + overdue
    return allRows.filter(r => r.status === 'pending' || r.status === 'sent' || r.status === 'overdue');
  }, [tab, allRows]);

  return (
    <Wrap>
      <TabBar role="tablist">
        {(['upcoming', 'completed', 'all'] as PaymentTab[]).map(k => {
          const cnt = k === 'all' ? allRows.length :
            k === 'completed' ? allRows.filter(r => r.status === 'paid').length :
            allRows.filter(r => r.status !== 'paid' && r.status !== 'canceled').length;
          return (
            <TabBtn key={k} role="tab" aria-selected={tab === k} $active={tab === k} onClick={() => setTab(k)}>
              <span>{t(`payments.tabs.${k}`)}</span>
              {cnt > 0 && <TabCount $active={tab === k}>{cnt}</TabCount>}
            </TabBtn>
          );
        })}
      </TabBar>

      {loading ? (
        <Empty>{t('common.loading')}</Empty>
      ) : filtered.length === 0 ? (
        <Empty>{t(`payments.empty.${tab}`)}</Empty>
      ) : (
        <List>
          <ListHead>
            <Cell style={{ width: 130 }}>{t('payments.col.invoice')}</Cell>
            <Cell style={{ width: 100 }}>{t('payments.col.round')}</Cell>
            <Cell>{t('payments.col.client')}</Cell>
            <Cell style={{ width: 130 }}>{t('payments.col.due')}</Cell>
            <Cell style={{ width: 130, textAlign: 'right' }}>{t('payments.col.amount')}</Cell>
            <Cell style={{ width: 110 }}>{t('payments.col.status')}</Cell>
          </ListHead>
          {filtered.map((r, i) => {
            const sc = installmentStatusColor((r.status as any) || 'pending');
            const client = r.invoice.Client || r.invoice.client;
            return (
              <Row key={`${r.invoice.id}-${r.installment?.id || 'single'}-${i}`} onClick={() => navigate(`/bills?tab=invoices&invoice=${r.invoice.id}`)}>
                <Cell style={{ width: 130 }}>
                  <RowNum>{r.invoice.invoice_number}</RowNum>
                </Cell>
                <Cell style={{ width: 100 }}>
                  {r.installment ? (
                    <RoundChip>{r.installment.installment_no}차 · {r.installment.label}</RoundChip>
                  ) : (
                    <SingleChip>단일</SingleChip>
                  )}
                </Cell>
                <Cell>
                  <ClientName>{client?.display_name || client?.biz_name || client?.company_name || '—'}</ClientName>
                  <ClientTitle>{r.invoice.title}</ClientTitle>
                </Cell>
                <Cell style={{ width: 130 }}>
                  <DueDate>{r.due_date || '—'}</DueDate>
                  {r.status === 'overdue' && <Overdue>연체</Overdue>}
                </Cell>
                <Cell style={{ width: 130, textAlign: 'right' }}>
                  <Amt>{formatMoney(r.amount, r.invoice.currency)}</Amt>
                </Cell>
                <Cell style={{ width: 110 }}>
                  <StatusBadge $bg={sc.bg} $fg={sc.fg}>
                    <Dot $color={sc.dot} />
                    {t(`detail.installments.status.${r.status}` as any, { defaultValue: r.status })}
                  </StatusBadge>
                </Cell>
              </Row>
            );
          })}
        </List>
      )}
    </Wrap>
  );
}

function buildRows(invoices: ApiInvoice[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const inv of invoices) {
    if (inv.status === 'draft' || inv.status === 'canceled') continue;
    const installments = inv.installments || [];
    if (installments.length > 0) {
      for (const ins of installments) {
        rows.push({
          invoice: inv, installment: ins,
          amount: Number(ins.amount || 0), due_date: ins.due_date,
          status: ins.status, paid_at: ins.paid_at,
        });
      }
    } else {
      rows.push({
        invoice: inv, installment: null,
        amount: Number(inv.grand_total || 0), due_date: inv.due_date,
        status: inv.status === 'overdue' ? 'overdue' : inv.status === 'paid' ? 'paid' : 'sent',
        paid_at: inv.paid_at,
      });
    }
  }
  return rows.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const TabBar = styled.div`display: flex; gap: 4px; border-bottom: 1px solid #E2E8F0; padding: 0 4px;`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; margin-bottom: -1px;
  font-size: 13px; font-weight: 600;
  background: transparent; border: none; cursor: pointer;
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#0D9488' : 'transparent'};
  &:hover { color: #0F172A; }
`;
const TabCount = styled.span<{ $active: boolean }>`
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
  background: ${p => p.$active ? '#CCFBF1' : '#F1F5F9'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
`;
const Empty = styled.div`
  text-align: center; padding: 60px 20px; color: #94A3B8; font-size: 13px;
  background: #fff; border: 1px dashed #E2E8F0; border-radius: 12px;
`;
const List = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  overflow-x: auto;
  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
`;
const ListHead = styled.div`
  display: flex; gap: 12px; padding: 10px 16px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
  min-width: 720px;
`;
const Row = styled.div`
  display: flex; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #F1F5F9; align-items: center;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
  min-width: 720px;
`;
const Cell = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowNum = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const RoundChip = styled.span`
  display: inline-block; align-self: flex-start;
  font-size: 11px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4;
  padding: 2px 8px; border-radius: 999px;
`;
const SingleChip = styled.span`
  display: inline-block; align-self: flex-start;
  font-size: 11px; font-weight: 600; color: #475569;
  background: #F1F5F9; padding: 2px 8px; border-radius: 999px;
`;
const ClientName = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const ClientTitle = styled.div`font-size: 11px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const DueDate = styled.div`font-size: 12px; color: #475569; font-variant-numeric: tabular-nums;`;
const Overdue = styled.span`font-size: 10px; font-weight: 700; color: #991B1B; align-self: flex-start;`;
const Amt = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
  padding: 3px 8px 3px 7px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 999px;
`;
const Dot = styled.span<{ $color: string }>`width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};`;
