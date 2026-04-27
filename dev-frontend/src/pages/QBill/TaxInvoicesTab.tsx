// 세금계산서 — 발행 대기 큐 + 발행번호 마킹 (실 API)
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import {
  listInvoices, formatMoney, markInstallmentTaxInvoice,
  type ApiInvoice, type ApiInstallment,
} from '../../services/invoices';

type Tab = 'pending' | 'issued' | 'all';

interface TaxRow {
  invoice: ApiInvoice;
  installment: ApiInstallment | null;
  amount: number;
  paid_at: string | null;
  issued_no: string | null;
  issued_at: string | null;
  status: 'pending' | 'issued';
}

export default function TaxInvoicesTab() {
  const { t } = useTranslation('qbill');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [tab, setTab] = useState<Tab>('pending');
  const [issuingFor, setIssuingFor] = useState<TaxRow | null>(null);
  const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listInvoices(businessId)
      .then(list => { if (!cancelled) setInvoices(list); })
      .catch(() => { if (!cancelled) setInvoices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, reloadKey]);

  const rows = useMemo(() => buildRows(invoices), [invoices]);
  const filtered = useMemo(() => {
    if (tab === 'all') return rows;
    return rows.filter(r => r.status === tab);
  }, [tab, rows]);

  const onIssued = () => { setIssuingFor(null); setReloadKey(k => k + 1); };

  return (
    <Wrap>
      {/* 안내 박스 */}
      <InfoBox>
        <InfoIcon>ⓘ</InfoIcon>
        <div>
          <InfoTitle>{t('taxInvoices.info.title')}</InfoTitle>
          <InfoDesc>{t('taxInvoices.info.desc')}</InfoDesc>
        </div>
      </InfoBox>

      <TabBar role="tablist">
        {(['pending', 'issued', 'all'] as Tab[]).map(k => {
          const cnt = k === 'all' ? rows.length : rows.filter(r => r.status === k).length;
          return (
            <TabBtn key={k} role="tab" aria-selected={tab === k} $active={tab === k} onClick={() => setTab(k)}>
              <span>{t(`taxInvoices.tabs.${k}`)}</span>
              {cnt > 0 && <TabCount $active={tab === k}>{cnt}</TabCount>}
            </TabBtn>
          );
        })}
      </TabBar>

      {loading ? (
        <Empty>{t('common.loading')}</Empty>
      ) : filtered.length === 0 ? (
        <Empty>{t(`taxInvoices.empty.${tab}`)}</Empty>
      ) : (
        <List>
          <ListHead>
            <Cell style={{ width: 130 }}>{t('taxInvoices.col.invoice')}</Cell>
            <Cell style={{ width: 90 }}>{t('taxInvoices.col.round')}</Cell>
            <Cell>{t('taxInvoices.col.client')}</Cell>
            <Cell style={{ width: 130 }}>{t('taxInvoices.col.taxId')}</Cell>
            <Cell style={{ width: 120, textAlign: 'right' }}>{t('taxInvoices.col.amount')}</Cell>
            <Cell style={{ width: 110 }}>{t('taxInvoices.col.paidAt')}</Cell>
            <Cell style={{ width: 130 }}>{t('taxInvoices.col.issueNo')}</Cell>
            <Cell style={{ width: 100, textAlign: 'right' }}>{t('taxInvoices.col.actions')}</Cell>
          </ListHead>
          {filtered.map((r, i) => {
            const client = r.invoice.Client || r.invoice.client;
            return (
              <Row key={`${r.invoice.id}-${r.installment?.id || 'single'}-${i}`}>
                <Cell style={{ width: 130 }}>
                  <Num>{r.invoice.invoice_number}</Num>
                </Cell>
                <Cell style={{ width: 90 }}>
                  {r.installment ? `${r.installment.installment_no}차` : '—'}
                </Cell>
                <Cell>
                  <ClientName>{client?.biz_name || client?.display_name || client?.company_name || '—'}</ClientName>
                </Cell>
                <Cell style={{ width: 130 }}>
                  <TaxId>{client?.biz_tax_id || '—'}</TaxId>
                </Cell>
                <Cell style={{ width: 120, textAlign: 'right' }}>
                  <Amt>{formatMoney(r.amount, r.invoice.currency)}</Amt>
                </Cell>
                <Cell style={{ width: 110 }}>{r.paid_at ? r.paid_at.split('T')[0] : '—'}</Cell>
                <Cell style={{ width: 130 }}>
                  {r.issued_no ? <IssueNo>{r.issued_no}</IssueNo> : <Pending>대기</Pending>}
                </Cell>
                <Cell style={{ width: 100, textAlign: 'right' }}>
                  {r.status === 'pending' && r.installment && (
                    <ActionBtn type="button" $primary onClick={() => setIssuingFor(r)}>{t('taxInvoices.actions.issue')}</ActionBtn>
                  )}
                </Cell>
              </Row>
            );
          })}
        </List>
      )}

      {issuingFor && <IssueModal row={issuingFor} onClose={() => setIssuingFor(null)} onIssued={onIssued} />}
    </Wrap>
  );
}

function buildRows(invoices: ApiInvoice[]): TaxRow[] {
  const rows: TaxRow[] = [];
  for (const inv of invoices) {
    // 사업자 고객만 세금계산서 대상
    const client = inv.Client || inv.client;
    if (!client?.is_business) continue;
    const installments = inv.installments || [];
    if (installments.length > 0) {
      for (const ins of installments) {
        if (ins.status === 'paid') {
          rows.push({
            invoice: inv, installment: ins,
            amount: Number(ins.amount || 0), paid_at: ins.paid_at,
            issued_no: ins.tax_invoice_no,
            issued_at: ins.tax_invoice_at,
            status: ins.tax_invoice_no ? 'issued' : 'pending',
          });
        }
      }
    } else if (inv.status === 'paid') {
      rows.push({
        invoice: inv, installment: null,
        amount: Number(inv.grand_total || 0), paid_at: inv.paid_at,
        issued_no: inv.tax_invoice_external_id, issued_at: inv.tax_invoice_issued_at,
        status: inv.tax_invoice_status === 'issued' ? 'issued' : 'pending',
      });
    }
  }
  return rows.sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
}

function IssueModal({ row, onClose, onIssued }: { row: TaxRow; onClose: () => void; onIssued: () => void }) {
  const { t } = useTranslation('qbill');
  const [no, setNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!no.trim() || busy) return;
    if (!row.installment) {
      setErr('단일 청구서의 세금계산서 마킹은 청구서 상세에서 진행해주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await markInstallmentTaxInvoice(
        row.invoice.business_id, row.invoice.id, row.installment.id,
        { tax_invoice_no: no.trim(), issued_at: date }
      );
      onIssued();
    } catch (e) {
      setErr((e as Error).message || '발행 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop onClick={onClose}>
      <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <ModalHead>
          <ModalTitle>{t('taxInvoices.issueModal.title')}</ModalTitle>
          <ModalClose type="button" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </ModalClose>
        </ModalHead>
        <ModalBody>
          <ModalDesc>{t('taxInvoices.issueModal.desc')}</ModalDesc>
          <ModalField>
            <ModalLabel>{t('taxInvoices.issueModal.no')}</ModalLabel>
            <ModalInput value={no} autoFocus onChange={e => setNo(e.target.value)} placeholder={t('taxInvoices.issueModal.noPh') as string} />
          </ModalField>
          <ModalField>
            <ModalLabel>{t('taxInvoices.issueModal.date')}</ModalLabel>
            <ModalInput type="date" value={date} onChange={e => setDate(e.target.value)} />
          </ModalField>
          <Hint>
            {row.invoice.invoice_number}{row.installment ? ` · ${row.installment.installment_no}차 · ${row.installment.label}` : ''} · {formatMoney(row.amount, row.invoice.currency)}
          </Hint>
          {err && <ErrLine>! {err}</ErrLine>}
        </ModalBody>
        <ModalFooter>
          <SecondaryBtn type="button" onClick={onClose}>{t('taxInvoices.issueModal.cancel')}</SecondaryBtn>
          <PrimaryBtn type="button" disabled={!no.trim() || busy} onClick={submit}>
            {busy ? t('common.issuing') : t('taxInvoices.issueModal.submit')}
          </PrimaryBtn>
        </ModalFooter>
      </ModalDialog>
    </ModalBackdrop>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const ErrLine = styled.div`font-size: 12px; color: #991B1B; background: #FEF2F2; padding: 6px 10px; border-radius: 6px;`;
const InfoBox = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
  background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 12px 14px;
`;
const InfoIcon = styled.div`
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #2563EB; color: #fff; font-size: 12px; font-weight: 700;
`;
const InfoTitle = styled.div`font-size: 12px; font-weight: 700; color: #1E40AF;`;
const InfoDesc = styled.div`font-size: 11px; color: #1E40AF; line-height: 1.5; margin-top: 2px;`;
const TabBar = styled.div`display: flex; gap: 4px; border-bottom: 1px solid #E2E8F0; padding: 0 4px;`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; margin-bottom: -1px;
  font-size: 13px; font-weight: 600; background: transparent; border: none; cursor: pointer;
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#0D9488' : 'transparent'};
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
const List = styled.div`background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const ListHead = styled.div`
  display: flex; gap: 12px; padding: 10px 16px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
`;
const Row = styled.div`
  display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F1F5F9; align-items: center;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
`;
const Cell = styled.div`flex: 1; min-width: 0;`;
const Num = styled.div`font-size: 12px; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const ClientName = styled.div`font-size: 13px; color: #0F172A; font-weight: 500;`;
const TaxId = styled.div`font-size: 12px; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const Amt = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const IssueNo = styled.span`
  font-size: 11px; font-weight: 600; color: #166534; background: #DCFCE7;
  padding: 3px 8px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const Pending = styled.span`
  font-size: 11px; font-weight: 700; color: #92400E; background: #FEF3C7;
  padding: 3px 8px; border-radius: 4px;
`;
const ActionBtn = styled.button<{ $primary?: boolean }>`
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$primary ? '#14B8A6' : '#fff'};
  color: ${p => p.$primary ? '#fff' : '#334155'};
  border: 1px solid ${p => p.$primary ? '#14B8A6' : '#E2E8F0'};
  border-radius: 6px; cursor: pointer;
  &:hover { background: ${p => p.$primary ? '#0D9488' : '#F8FAFC'}; }
`;
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px;
`;
const ModalDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 460px; width: 100%;
  display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0,0,0,0.2);
`;
const ModalHead = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const ModalTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const ModalClose = styled.button`
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: #64748B; border-radius: 4px;
  &:hover { background: #F1F5F9; }
`;
const ModalBody = styled.div`padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;`;
const ModalDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const ModalField = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ModalLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569;`;
const ModalInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;`;
const ModalFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px;
  border-top: 1px solid #F1F5F9;
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
