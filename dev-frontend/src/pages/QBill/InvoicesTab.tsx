import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';
import {
  listInvoices, formatMoney, invoiceStatusColor, countByStatus,
  type ApiInvoice, type InvoiceStatus,
} from '../../services/invoices';
import InvoiceDetailDrawer from './InvoiceDetailDrawer';
import NewInvoiceModal from './NewInvoiceModal';

type Filter = InvoiceStatus | 'all';

const FILTER_KEYS: Filter[] = ['all', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'canceled'];

export default function InvoicesTab() {
  const { t } = useTranslation('qbill');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showNew, setShowNew] = useState(false);
  const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // URL 싱크: ?invoice=:id
  const selectedId = useMemo(() => {
    const v = new URLSearchParams(location.search).get('invoice');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [location.search]);

  // 실 API
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listInvoices(businessId)
      .then(list => { if (!cancelled) { setInvoices(list); setError(null); } })
      .catch(err => { if (!cancelled) setError(err.message || 'load failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  const counts = useMemo(() => countByStatus(invoices), [invoices]);

  const filtered = useMemo(() => {
    let list = [...invoices];
    if (filter !== 'all') list = list.filter(i => i.status === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(i => {
        const c = i.Client || i.client;
        return (
          i.invoice_number.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          (c?.display_name || c?.company_name || c?.biz_name || '').toLowerCase().includes(q)
        );
      });
    }
    return list.sort((a, b) => (b.issued_at || b.created_at).localeCompare(a.issued_at || a.created_at));
  }, [query, filter, invoices]);

  const openDetail = useCallback((id: number) => {
    if (selectedId === id) {
      // 재클릭 토글 — 닫기
      const sp = new URLSearchParams(location.search);
      sp.delete('invoice');
      navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
      return;
    }
    const sp = new URLSearchParams(location.search);
    sp.set('invoice', String(id));
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  }, [selectedId, location, navigate]);

  const closeDetail = useCallback(() => {
    const sp = new URLSearchParams(location.search);
    sp.delete('invoice');
    navigate(`${location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { replace: true });
  }, [location, navigate]);

  const selectedInvoice = selectedId ? invoices.find(i => i.id === selectedId) || null : null;

  return (
    <Wrap>
      {/* 도구바: 검색 + 새 청구서 */}
      <Toolbar>
        <SearchInputWrap>
          <SearchIcon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </SearchIcon>
          <SearchInput
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('invoices.searchPh') as string}
          />
          {query && (
            <ClearBtn onClick={() => setQuery('')} aria-label="clear">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </ClearBtn>
          )}
        </SearchInputWrap>
        <NewBtn onClick={() => setShowNew(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('invoices.newInvoice')}
        </NewBtn>
      </Toolbar>

      {/* 상태 chip */}
      <ChipBar role="tablist">
        {FILTER_KEYS.map(k => {
          const cnt = counts[k] || 0;
          const active = filter === k;
          return (
            <Chip
              key={k}
              role="tab"
              aria-selected={active}
              $active={active}
              onClick={() => setFilter(k)}
            >
              <span>{t(`invoices.filter.${k}`)}</span>
              {cnt > 0 && <ChipCount $active={active}>{cnt}</ChipCount>}
            </Chip>
          );
        })}
      </ChipBar>

      {/* 로딩/에러 */}
      {loading && <Loading>{t('common.loading')}</Loading>}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* 리스트 */}
      {!loading && filtered.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('invoices.empty')}</EmptyTitle>
          <EmptyDesc>{t('invoices.emptyCta')}</EmptyDesc>
          <NewBtn onClick={() => setShowNew(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('invoices.newInvoice')}
          </NewBtn>
        </Empty>
      ) : (
        <List>
          <ListHead>
            <ColNum>{t('invoices.col.number')}</ColNum>
            <ColClient>{t('invoices.col.client')}</ColClient>
            <ColTitle>{t('invoices.col.title')}</ColTitle>
            <ColAmt>{t('invoices.col.amount')}</ColAmt>
            <ColMode>{t('invoices.col.mode')}</ColMode>
            <ColStatus>{t('invoices.col.status')}</ColStatus>
            <ColDue>{t('invoices.col.due')}</ColDue>
          </ListHead>
          {filtered.map(inv => {
            const client = inv.Client || inv.client;
            const installments = inv.installments || [];
            const sc = invoiceStatusColor(inv.status);
            return (
            <Row
              key={inv.id}
              $active={selectedId === inv.id}
              onClick={() => openDetail(inv.id)}
            >
              <ColNum>
                <Num>{inv.invoice_number}</Num>
                <Issued>{inv.issued_at ? inv.issued_at.split('T')[0] : '—'}</Issued>
              </ColNum>
              <ColClient>
                <ClientName>{client?.display_name || client?.biz_name || client?.company_name || '—'}</ClientName>
              </ColClient>
              <ColTitle>
                <TitleText>{inv.title}</TitleText>
              </ColTitle>
              <ColAmt>
                <Amt>{formatMoney(inv.grand_total, inv.currency)}</Amt>
                <VatHint>{inv.currency === 'KRW' ? t('invoices.list.vatLabel') : ''}</VatHint>
              </ColAmt>
              <ColMode>
                {inv.installment_mode === 'split' ? (
                  <SplitView>
                    <ModeLabel>{t('invoices.mode.split', { count: installments.length })}</ModeLabel>
                    <DotRow>
                      {installments.map(ins => (
                        <Dot
                          key={ins.id}
                          $color={ins.status === 'paid' ? '#22C55E' : ins.status === 'sent' ? '#0EA5E9' : ins.status === 'overdue' ? '#DC2626' : '#CBD5E1'}
                          aria-label={ins.label}
                        />
                      ))}
                    </DotRow>
                  </SplitView>
                ) : (
                  <ModeLabel>{t('invoices.mode.single')}</ModeLabel>
                )}
              </ColMode>
              <ColStatus>
                <StatusBadge $bg={sc.bg} $fg={sc.fg}>
                  <StatusDot $color={sc.dot} />
                  {t(`invoices.status.${inv.status}`)}
                </StatusBadge>
              </ColStatus>
              <ColDue>
                <DueDate>{inv.due_date || '—'}</DueDate>
                {inv.status === 'overdue' && inv.due_date && (
                  <DueOverdue>{t('invoices.list.overdueDays', { days: Math.abs(daysSince(inv.due_date)) })}</DueOverdue>
                )}
              </ColDue>
            </Row>
            );
          })}
        </List>
      )}

      {/* 우측 상세 Drawer */}
      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        onClose={closeDetail}
        onChanged={reload}
      />

      {/* 발행 모달 */}
      <NewInvoiceModal
        open={showNew}
        onClose={() => { setShowNew(false); reload(); }}
      />
    </Wrap>
  );
}

function daysSince(dateStr: string): number {
  const target = new Date(dateStr);
  return Math.floor((Date.now() - target.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── styled ───
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 14px;
`;
const Loading = styled.div`
  text-align: center; padding: 40px 20px; color: #94A3B8; font-size: 13px;
`;
const ErrorBanner = styled.div`
  padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA;
  color: #991B1B; border-radius: 8px; font-size: 12px;
`;
const Toolbar = styled.div`
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
`;
const SearchInputWrap = styled.div`
  position: relative; flex: 1; max-width: 420px;
`;
const SearchIcon = styled.div`
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #94A3B8;
`;
const SearchInput = styled.input`
  width: 100%; padding: 9px 32px 9px 32px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
  &::placeholder { color: #94A3B8; }
`;
const ClearBtn = styled.button`
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; border: none; background: transparent;
  display: inline-flex; align-items: center; justify-content: center;
  color: #94A3B8; cursor: pointer; border-radius: 4px;
  &:hover { color: #0F172A; background: #F1F5F9; }
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; background: #14B8A6; color: #fff;
  font-size: 13px; font-weight: 700; line-height: 1;
  border: none; border-radius: 8px; cursor: pointer; white-space: nowrap;
  transition: background 0.15s;
  & > svg { display: block; flex-shrink: 0; }
  &:hover { background: #0D9488; }
`;
const ChipBar = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#0F172A' : '#fff'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#0F172A' : '#E2E8F0'};
  border-radius: 999px; cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#0F172A' : '#CBD5E1'}; color: ${p => p.$active ? '#fff' : '#0F172A'}; }
`;
const ChipCount = styled.span<{ $active: boolean }>`
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px;
  background: ${p => p.$active ? 'rgba(255,255,255,0.2)' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
`;
const Empty = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; text-align: center; gap: 12px;
  background: #fff; border: 1px dashed #E2E8F0; border-radius: 12px;
`;
const EmptyTitle = styled.div`
  font-size: 14px; font-weight: 700; color: #475569;
`;
const EmptyDesc = styled.div`
  font-size: 12px; color: #94A3B8; margin-bottom: 4px;
`;
const List = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
`;
const ListHead = styled.div`
  display: grid;
  grid-template-columns: 130px 180px minmax(0, 1.5fr) 130px 100px 130px 110px;
  gap: 12px; padding: 10px 16px; background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
  @media (max-width: 1280px) {
    grid-template-columns: 130px 160px minmax(0, 1fr) 110px 90px 130px 100px;
  }
  @media (max-width: 900px) { display: none; }
`;
const Row = styled.div<{ $active: boolean }>`
  display: grid;
  grid-template-columns: 130px 180px minmax(0, 1.5fr) 130px 100px 130px 110px;
  gap: 12px; padding: 14px 16px; cursor: pointer;
  border-bottom: 1px solid #F1F5F9;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  transition: background 0.12s;
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  &:last-child { border-bottom: none; }
  @media (max-width: 1280px) {
    grid-template-columns: 130px 160px minmax(0, 1fr) 110px 90px 130px 100px;
  }
  @media (max-width: 900px) {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
`;
const ColNum = styled.div`
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
`;
const ColClient = styled.div`
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
`;
const ColTitle = styled.div`
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
`;
const ColAmt = styled.div`
  display: flex; flex-direction: column; gap: 2px; align-items: flex-end;
  text-align: right;
`;
const ColMode = styled.div`
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
`;
const ColStatus = styled.div`
  display: flex; align-items: center;
`;
const ColDue = styled.div`
  display: flex; flex-direction: column; gap: 2px; align-items: flex-end;
`;
const Num = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const Issued = styled.div`
  font-size: 11px; color: #94A3B8;
`;
const ClientName = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const TitleText = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Amt = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  font-variant-numeric: tabular-nums;
`;
const VatHint = styled.div`
  font-size: 10px; color: #94A3B8;
`;
const SplitView = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const ModeLabel = styled.span`
  font-size: 11px; font-weight: 600; color: #475569;
`;
const DotRow = styled.div`
  display: flex; gap: 3px;
`;
const Dot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px 3px 7px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg};
  border-radius: 999px;
`;
const StatusDot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
const DueDate = styled.div`
  font-size: 12px; color: #475569; font-variant-numeric: tabular-nums;
`;
const DueOverdue = styled.div`
  font-size: 10px; font-weight: 700; color: #991B1B;
`;
