// 청구서 상세 우측 드로어 — 실 API
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  formatMoney, invoiceStatusColor, installmentStatusColor,
  getInvoice, markInstallmentPaid, unmarkInstallmentPaid,
  markInstallmentTaxInvoice, cancelInstallment, updateInvoiceStatus,
  type ApiInvoice, type ApiInstallment,
} from '../../services/invoices';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  tone?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
}

interface Props {
  invoice: ApiInvoice | null;
  onClose: () => void;
  onChanged?: () => void;
}

const KIND_LABEL: Record<string, string> = {
  contract: '계약서', quote: '견적서', sow: 'SOW', proposal: '제안서',
};

export default function InvoiceDetailDrawer({ invoice: initialInvoice, onClose, onChanged }: Props) {
  const { t } = useTranslation('qbill');
  const [copiedAcct, setCopiedAcct] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [invoice, setInvoice] = useState<ApiInvoice | null>(initialInvoice);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [taxModal, setTaxModal] = useState<{ installmentId: number } | null>(null);
  const [taxNoInput, setTaxNoInput] = useState('');

  // 외부에서 invoice prop 변경 시 동기화 + 최신 데이터 fetch
  useEffect(() => {
    setInvoice(initialInvoice);
    if (initialInvoice) {
      // 상세 fetch (include 풀세트)
      getInvoice(initialInvoice.business_id, initialInvoice.id)
        .then(fresh => setInvoice(fresh))
        .catch(() => {/* fallback to initial */});
    }
  }, [initialInvoice?.id]);

  if (!invoice) return null;
  const client = invoice.Client || invoice.client;
  const sc = invoiceStatusColor(invoice.status);
  const grandTotal = Number(invoice.grand_total || 0);
  const paidAmount = Number(invoice.paid_amount || 0);
  const outstanding = grandTotal - paidAmount;
  const isSplit = invoice.installment_mode === 'split';
  const sourcePost = invoice.sourcePost;
  const items = invoice.items || [];
  const installments = invoice.installments || [];
  const bank = invoice.bank_snapshot || {};
  const subtotal = Number(invoice.subtotal || invoice.total_amount || 0);
  const vatAmount = Number(invoice.tax_amount || 0);
  const vatRate = Number(invoice.vat_rate || 0);

  const refresh = async () => {
    try {
      const fresh = await getInvoice(invoice.business_id, invoice.id);
      setInvoice(fresh);
      onChanged?.();
    } catch {/* noop */}
  };

  const handleMarkPaid = async (installmentId: number) => {
    if (busy) return;
    setBusy(true);
    try { await markInstallmentPaid(invoice.business_id, invoice.id, installmentId, { paid_at: new Date().toISOString() }); await refresh(); }
    finally { setBusy(false); }
  };
  const handleUnmarkPaid = async (installmentId: number) => {
    if (busy) return;
    setBusy(true);
    try { await unmarkInstallmentPaid(invoice.business_id, invoice.id, installmentId); await refresh(); }
    finally { setBusy(false); }
  };
  const handleMarkTax = (installmentId: number) => {
    setTaxNoInput('');
    setTaxModal({ installmentId });
  };
  const submitTaxNo = async () => {
    if (!taxModal || !taxNoInput.trim() || busy) return;
    setBusy(true);
    try {
      await markInstallmentTaxInvoice(invoice.business_id, invoice.id, taxModal.installmentId, { tax_invoice_no: taxNoInput.trim() });
      setTaxModal(null);
      setTaxNoInput('');
      await refresh();
    } finally { setBusy(false); }
  };
  const doCancelInst = async (installmentId: number) => {
    if (busy) return;
    setBusy(true);
    try { await cancelInstallment(invoice.business_id, invoice.id, installmentId); await refresh(); }
    finally { setBusy(false); }
  };
  const handleCancelInst = (installmentId: number) => {
    setConfirm({
      open: true,
      title: '회차 취소',
      message: '이 회차를 취소하시겠습니까? 결제 완료된 회차는 취소할 수 없습니다.',
      tone: 'danger',
      onConfirm: () => { setConfirm(null); doCancelInst(installmentId); },
    });
  };
  const doCancelInvoice = async () => {
    if (busy) return;
    setBusy(true);
    try { await updateInvoiceStatus(invoice.business_id, invoice.id, 'canceled'); await refresh(); }
    finally { setBusy(false); }
  };
  const handleCancelInvoice = () => {
    setConfirm({
      open: true,
      title: '청구서 취소',
      message: '이 청구서를 취소 상태로 변경하시겠습니까?',
      tone: 'danger',
      onConfirm: () => { setConfirm(null); doCancelInvoice(); },
    });
  };

  const APP_URL = window.location.origin;
  const shareUrl = invoice.share_token ? `${APP_URL}/public/invoices/${invoice.share_token}` : null;

  const copyAccount = () => {
    if (!bank.account_number) return;
    navigator.clipboard.writeText(String(bank.account_number)).then(() => { setCopiedAcct(true); setTimeout(() => setCopiedAcct(false), 1500); }).catch(() => {/* noop */});
  };
  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => { setCopiedMemo(true); setTimeout(() => setCopiedMemo(false), 1500); }).catch(() => {/* noop */});
  };

  return (
    <DetailDrawer
      open={!!invoice}
      onClose={onClose}
      width={620}
      ariaLabel={`청구서 ${invoice.invoice_number}`}
    >
      {/* ─── 헤더 ─── */}
      <DrawerHeader>
        <HeaderTop>
          <NumWrap>
            <NumBadge>{invoice.invoice_number}</NumBadge>
            <StatusBadge $bg={sc.bg} $fg={sc.fg}>
              <StatusDot $color={sc.dot} />
              {t(`invoices.status.${invoice.status}`)}
            </StatusBadge>
          </NumWrap>
          <CloseBtn onClick={onClose} aria-label={t('common.close') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </HeaderTop>
        <HeaderTitle>{invoice.title}</HeaderTitle>
        {invoice.notes && <HeaderSub>{invoice.notes}</HeaderSub>}

        {/* 액션 바 */}
        <ActionRow>
          <ActionBtn onClick={copyShareLink} disabled={!shareUrl}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
            {copiedMemo ? t('detail.header.actions.linkCopied') : t('detail.header.actions.copyLink')}
          </ActionBtn>
          {invoice.status !== 'canceled' && (
            <ActionBtn onClick={handleCancelInvoice} disabled={busy}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              {t('detail.header.actions.cancel')}
            </ActionBtn>
          )}
        </ActionRow>
      </DrawerHeader>

      {/* ─── 본문 (스크롤) ─── */}
      <Body>
        {/* 출처 문서 (계약/견적/SOW/제안) */}
        {sourcePost && (
          <SourceCard>
            <SourceLeft>
              <SourceKindBadge $kind={sourcePost.category || ''}>
                {KIND_LABEL[sourcePost.category || ''] || sourcePost.category || '문서'}
              </SourceKindBadge>
              <SourceText>
                <SourceTitle>{sourcePost.title}</SourceTitle>
                <SourceMeta>
                  본 청구서는 위 문서에 따른 청구입니다
                  {sourcePost.shared_at && ` · 공유 ${sourcePost.shared_at.split('T')[0]}`}
                </SourceMeta>
              </SourceText>
            </SourceLeft>
            <SourceLink href={`/docs?post=${sourcePost.id}`}>
              문서 보기
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </SourceLink>
          </SourceCard>
        )}

        {/* 진행 stepper */}
        <ProgressStepper status={invoice.status} />

        {/* 발신 / 수신 */}
        <Parties>
          <PartyCard>
            <PartyLabel>{t('detail.parties.from')}</PartyLabel>
            <PartyName>{bank.account_holder || '—'}</PartyName>
            <PartyMeta>
              <MetaRow><MetaKey>은행</MetaKey><MetaVal>{bank.bank_name || '—'}</MetaVal></MetaRow>
            </PartyMeta>
          </PartyCard>
          <PartyArrow>→</PartyArrow>
          <PartyCard>
            <PartyLabel>{t('detail.parties.to')}</PartyLabel>
            <PartyName>{client?.biz_name || client?.display_name || client?.company_name || invoice.recipient_business_name || '—'}</PartyName>
            <PartyMeta>
              {client?.is_business ? (
                <>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.taxId')}</MetaKey>
                    <MetaVal>{client?.biz_tax_id || invoice.recipient_business_number || <Missing>{t('detail.parties.missingInfo')}</Missing>}</MetaVal>
                  </MetaRow>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.rep')}</MetaKey>
                    <MetaVal>{client?.biz_ceo || '—'}</MetaVal>
                  </MetaRow>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.address')}</MetaKey>
                    <MetaVal>{client?.biz_address || client?.biz_address_en || '—'}</MetaVal>
                  </MetaRow>
                </>
              ) : (
                <MetaRow><MetaKey>{t('detail.parties.country')}</MetaKey><MetaVal>{t('detail.parties.individual')}</MetaVal></MetaRow>
              )}
            </PartyMeta>
          </PartyCard>
        </Parties>

        {/* 항목 */}
        <Section>
          <SectionTitle>{t('detail.items.title')}</SectionTitle>
          <ItemTable>
            <ItemHead>
              <ItemHeadCell style={{ width: 28 }}>#</ItemHeadCell>
              <ItemHeadCell>{t('detail.items.description')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 50, textAlign: 'right' }}>{t('detail.items.qty')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 100, textAlign: 'right' }}>{t('detail.items.unitPrice')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 110, textAlign: 'right' }}>{t('detail.items.subtotal')}</ItemHeadCell>
            </ItemHead>
            {items.map((it, idx) => (
              <ItemRow key={it.id}>
                <ItemCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</ItemCell>
                <ItemCell>{it.description}</ItemCell>
                <ItemCell style={{ width: 50, textAlign: 'right' }}>{it.quantity}</ItemCell>
                <ItemCell style={{ width: 100, textAlign: 'right' }}>{formatMoney(it.unit_price, invoice.currency)}</ItemCell>
                <ItemCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>{formatMoney(it.amount, invoice.currency)}</ItemCell>
              </ItemRow>
            ))}
          </ItemTable>

          <Summary>
            <SummaryRow>
              <SumKey>{t('detail.summary.subtotal')}</SumKey>
              <SumVal>{formatMoney(subtotal, invoice.currency)}</SumVal>
            </SummaryRow>
            {vatRate > 0 && (
              <SummaryRow>
                <SumKey>{t('detail.summary.vat')} ({Math.round(vatRate * 100)}%)</SumKey>
                <SumVal>{formatMoney(vatAmount, invoice.currency)}</SumVal>
              </SummaryRow>
            )}
            <SummaryDiv />
            <SummaryRow>
              <SumKey style={{ fontWeight: 700, color: '#0F172A' }}>{t('detail.summary.total')}</SumKey>
              <SumVal style={{ fontSize: 16, fontWeight: 700 }}>{formatMoney(grandTotal, invoice.currency)}</SumVal>
            </SummaryRow>
            {paidAmount > 0 && (
              <>
                <SummaryRow>
                  <SumKey style={{ color: '#166534' }}>{t('detail.summary.paid')}</SumKey>
                  <SumVal style={{ color: '#166534' }}>{formatMoney(paidAmount, invoice.currency)}</SumVal>
                </SummaryRow>
                {outstanding > 0 && (
                  <SummaryRow>
                    <SumKey style={{ color: '#92400E' }}>{t('detail.summary.outstanding')}</SumKey>
                    <SumVal style={{ color: '#92400E', fontWeight: 700 }}>{formatMoney(outstanding, invoice.currency)}</SumVal>
                  </SummaryRow>
                )}
              </>
            )}
          </Summary>
        </Section>

        {/* 분할 일정 */}
        {isSplit && installments.length > 0 && (
          <Section>
            <SectionTitleRow>
              <SectionTitle>{t('detail.installments.title')}</SectionTitle>
              <SectionMeta>{t('detail.installments.subtitle', { count: installments.length })}</SectionMeta>
            </SectionTitleRow>
            <InstallmentList>
              {installments.map((ins) => (
                <InstallmentRow
                  key={ins.id}
                  ins={ins}
                  currency={invoice.currency}
                  busy={busy}
                  onMarkPaid={handleMarkPaid}
                  onUnmarkPaid={handleUnmarkPaid}
                  onMarkTax={handleMarkTax}
                  onCancel={handleCancelInst}
                />
              ))}
            </InstallmentList>
          </Section>
        )}

        {/* 입금 안내 */}
        <Section>
          <SectionTitle>{t('detail.bank.title')}</SectionTitle>
          <BankCard>
            <BankRow>
              <BankKey>{t('detail.bank.bank')}</BankKey>
              <BankVal>{bank.bank_name || '—'}</BankVal>
            </BankRow>
            <BankRow>
              <BankKey>{t('detail.bank.account')}</BankKey>
              <BankValRow>
                <BankVal style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{bank.account_number || '—'}</BankVal>
                {bank.account_number && (
                  <CopyChip onClick={copyAccount}>
                    {copiedAcct ? t('detail.bank.copied') : t('detail.bank.copy')}
                  </CopyChip>
                )}
              </BankValRow>
            </BankRow>
            <BankRow>
              <BankKey>{t('detail.bank.holder')}</BankKey>
              <BankVal>{bank.account_holder || '—'}</BankVal>
            </BankRow>
            <PayerHint>
              <PayerHintTitle>{t('detail.bank.payerMemoHelp')}</PayerHintTitle>
              <PayerCode>
                <code>{`${invoice.invoice_number} ${client?.display_name || client?.biz_name || ''}`}</code>
              </PayerCode>
            </PayerHint>
          </BankCard>
        </Section>

        {/* 세금계산서 */}
        {client?.is_business && (
          <Section>
            <SectionTitle>{t('detail.tax.title')}</SectionTitle>
            <TaxBox $status={invoice.tax_invoice_status}>
              <TaxIcon $status={invoice.tax_invoice_status}>
                {invoice.tax_invoice_status === 'issued' ? '✓' : invoice.tax_invoice_status === 'pending' ? '!' : '·'}
              </TaxIcon>
              <TaxBody>
                <TaxLabel>
                  {invoice.tax_invoice_status === 'issued' ? t('detail.tax.issued') :
                   invoice.tax_invoice_status === 'pending' ? t('detail.tax.required') :
                   t('detail.tax.notRequired')}
                </TaxLabel>
                {invoice.tax_invoice_status === 'pending' && (
                  <TaxDesc>{t('detail.tax.issuePromptDesc')}</TaxDesc>
                )}
              </TaxBody>
            </TaxBox>
          </Section>
        )}
      </Body>
      {confirm?.open && (
        <ConfirmDialog
          isOpen={confirm.open}
          title={confirm.title}
          message={confirm.message}
          variant={confirm.tone === 'danger' ? 'danger' : confirm.tone === 'warning' ? 'warning' : 'info'}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {taxModal && (
        <TaxModalBackdrop onClick={() => setTaxModal(null)}>
          <TaxModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('detail.tax.issuePromptTitle') as string}>
            <TaxModalHead>
              <TaxModalTitle>{t('detail.tax.issuePromptTitle')}</TaxModalTitle>
              <TaxModalClose type="button" onClick={() => setTaxModal(null)} aria-label={t('common.close') as string}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </TaxModalClose>
            </TaxModalHead>
            <TaxModalBody>
              <TaxModalDesc>{t('detail.tax.issuePromptDesc')}</TaxModalDesc>
              <TaxModalLabel htmlFor="tax-no-input">{t('detail.tax.issueNo')}</TaxModalLabel>
              <TaxModalInput
                id="tax-no-input"
                type="text"
                value={taxNoInput}
                onChange={e => setTaxNoInput(e.target.value)}
                placeholder={t('detail.tax.issueNoPh') as string}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitTaxNo(); }}
              />
            </TaxModalBody>
            <TaxModalFooter>
              <TaxModalSecondary type="button" onClick={() => setTaxModal(null)}>{t('common.cancel')}</TaxModalSecondary>
              <TaxModalPrimary type="button" onClick={submitTaxNo} disabled={!taxNoInput.trim() || busy}>
                {busy ? t('common.issuing') : t('detail.tax.issueAction')}
              </TaxModalPrimary>
            </TaxModalFooter>
          </TaxModalDialog>
        </TaxModalBackdrop>
      )}
    </DetailDrawer>
  );
}

// ─── 회차 행 ───
interface InstallmentRowProps {
  ins: ApiInstallment;
  currency: ApiInvoice['currency'];
  busy: boolean;
  onMarkPaid: (id: number) => void;
  onUnmarkPaid: (id: number) => void;
  onMarkTax: (id: number) => void;
  onCancel: (id: number) => void;
}
function InstallmentRow({ ins, currency, busy, onMarkPaid, onUnmarkPaid, onMarkTax, onCancel }: InstallmentRowProps) {
  const { t } = useTranslation('qbill');
  const sc = installmentStatusColor(ins.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <InstRowWrap>
      <InstNo>{ins.installment_no}</InstNo>
      <InstInfo>
        <InstLabel>{ins.label}</InstLabel>
        {ins.milestone_ref && <InstMilestone>{ins.milestone_ref}</InstMilestone>}
        {ins.status === 'paid' && ins.paid_at && (
          <InstSubMeta>
            ✓ {t('detail.installments.paidAt', { date: ins.paid_at.split('T')[0] })}
            {ins.tax_invoice_no && ` · ${t('detail.installments.taxNo', { no: ins.tax_invoice_no })}`}
          </InstSubMeta>
        )}
      </InstInfo>
      <InstDue>{ins.due_date || '—'}</InstDue>
      <InstAmt>{formatMoney(ins.amount, currency)}</InstAmt>
      <InstStatus $bg={sc.bg} $fg={sc.fg}>
        <StatusDot $color={sc.dot} />
        {t(`detail.installments.status.${ins.status}`)}
      </InstStatus>
      <InstMenuWrap>
        <InstMenuBtn type="button" onClick={() => setMenuOpen(o => !o)} aria-label="actions" disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>
        </InstMenuBtn>
        {menuOpen && (
          <>
            <MenuBackdrop onClick={() => setMenuOpen(false)} />
            <Menu role="menu">
              {ins.status !== 'paid' && ins.status !== 'canceled' && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onMarkPaid(ins.id); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {t('detail.installments.menu.markPaid')}
                </MenuItem>
              )}
              {ins.status === 'paid' && !ins.tax_invoice_no && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onMarkTax(ins.id); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {t('detail.installments.menu.markTax')}
                </MenuItem>
              )}
              {ins.status === 'paid' && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onUnmarkPaid(ins.id); }}>
                  {t('detail.installments.menu.unmarkPaid')}
                </MenuItem>
              )}
              <MenuDivider />
              <MenuItem type="button" $danger onClick={() => { setMenuOpen(false); onCancel(ins.id); }}>
                {t('detail.installments.menu.cancel')}
              </MenuItem>
            </Menu>
          </>
        )}
      </InstMenuWrap>
    </InstRowWrap>
  );
}

// ─── Stepper ───
function ProgressStepper({ status }: { status: ApiInvoice['status'] }) {
  const { t } = useTranslation('qbill');
  const steps = [
    { key: 'issued', label: t('detail.progress.issued') },
    { key: 'sent', label: t('detail.progress.sent') },
    { key: 'paid', label: t('detail.progress.paid') },
  ];
  const currentIdx = status === 'draft' ? 0 :
    status === 'sent' ? 1 :
    status === 'partially_paid' ? 1 :
    status === 'paid' ? 2 :
    status === 'overdue' ? 1 :
    -1;

  return (
    <Stepper>
      {steps.map((s, i) => {
        const reached = i <= currentIdx;
        const active = i === currentIdx;
        return (
          <StepWrap key={s.key}>
            <StepNode $active={active} $reached={reached}>
              {reached ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                i + 1
              )}
            </StepNode>
            <StepLabel $active={active} $reached={reached}>{s.label}</StepLabel>
            {i < steps.length - 1 && <StepLine $reached={i < currentIdx} />}
          </StepWrap>
        );
      })}
      {status === 'overdue' && (
        <OverdueChip>⚠ {t('detail.progress.overdue')}</OverdueChip>
      )}
    </Stepper>
  );
}

// (eventColor / formatDateTime — 활동 타임라인 백엔드 API 추가 후 재도입)

// ─── styled (세금계산서 마킹 모달) ───
const TaxModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px;
`;
const TaxModalDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 460px; width: 100%;
  display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
`;
const TaxModalHead = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const TaxModalTitle = styled.h3`
  font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;
`;
const TaxModalClose = styled.button`
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: #64748B; border-radius: 4px;
  &:hover { background: #F1F5F9; }
`;
const TaxModalBody = styled.div`
  padding: 18px 20px; display: flex; flex-direction: column; gap: 10px;
`;
const TaxModalDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const TaxModalLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569;`;
const TaxModalInput = styled.input`
  width: 100%; padding: 9px 12px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const TaxModalFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px;
  border-top: 1px solid #F1F5F9;
`;
const TaxModalPrimary = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const TaxModalSecondary = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;

// ─── styled ───
const DrawerHeader = styled.div`
  flex-shrink: 0; padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9; background: #fff;
`;
const HeaderTop = styled.div`
  display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px;
`;
const NumWrap = styled.div`
  display: inline-flex; align-items: center; gap: 8px; min-width: 0;
`;
const NumBadge = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; font-weight: 700; color: #0F172A;
  background: #F1F5F9; padding: 3px 8px; border-radius: 6px;
`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px 3px 7px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 999px;
`;
const StatusDot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const HeaderTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0; letter-spacing: -0.3px;
`;
const HeaderSub = styled.div`
  font-size: 13px; color: #64748B; margin-top: 4px;
`;
const ActionRow = styled.div`
  display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap;
`;
const ActionBtn = styled.button<{ $primary?: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$primary ? '#14B8A6' : '#fff'};
  color: ${p => p.$primary ? '#fff' : '#334155'};
  border: 1px solid ${p => p.$primary ? '#14B8A6' : '#E2E8F0'};
  border-radius: 8px; cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: ${p => p.$primary ? '#0D9488' : '#F8FAFC'};
    border-color: ${p => p.$primary ? '#0D9488' : '#CBD5E1'};
  }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 18px 22px 32px;
  display: flex; flex-direction: column; gap: 22px;
  background: #FAFBFC;
`;
const Stepper = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  position: relative;
`;
const StepWrap = styled.div`
  display: flex; align-items: center; flex: 1; min-width: 0; position: relative;
  &:last-child { flex: 0; }
`;
const StepNode = styled.div<{ $active: boolean; $reached: boolean }>`
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => p.$reached ? '#14B8A6' : '#fff'};
  color: ${p => p.$reached ? '#fff' : '#94A3B8'};
  border: 2px solid ${p => p.$reached ? '#14B8A6' : '#E2E8F0'};
  font-size: 11px; font-weight: 700;
  ${p => p.$active && `box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.15);`}
`;
const StepLabel = styled.span<{ $active: boolean; $reached: boolean }>`
  font-size: 12px; font-weight: ${p => p.$active ? 700 : 500};
  color: ${p => p.$reached ? '#0F172A' : '#94A3B8'};
  margin-left: 8px;
`;
const StepLine = styled.div<{ $reached: boolean }>`
  flex: 1; height: 2px; min-width: 24px;
  background: ${p => p.$reached ? '#14B8A6' : '#E2E8F0'}; margin: 0 10px;
`;
const OverdueChip = styled.span`
  position: absolute; right: 14px; top: 14px;
  font-size: 11px; font-weight: 700; color: #991B1B; background: #FEE2E2;
  padding: 3px 8px; border-radius: 999px;
`;
const Parties = styled.div`
  display: grid; grid-template-columns: 1fr 24px 1fr; gap: 8px; align-items: center;
  @media (max-width: 720px) { grid-template-columns: 1fr; gap: 12px; }
`;
const PartyArrow = styled.div`
  text-align: center; color: #CBD5E1; font-size: 18px; font-weight: 300;
  @media (max-width: 720px) { display: none; }
`;
const PartyCard = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px;
`;
const PartyLabel = styled.div`
  font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 6px;
`;
const PartyName = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const PartyMeta = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const MetaRow = styled.div`
  display: flex; gap: 6px; font-size: 12px;
`;
const MetaKey = styled.span`
  color: #94A3B8; min-width: 60px; flex-shrink: 0;
`;
const MetaVal = styled.span`
  color: #334155; flex: 1; min-width: 0;
`;
const Missing = styled.span`
  color: #DC2626; font-weight: 500; font-size: 11px;
`;
const Section = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;
`;
const SectionTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 10px;
`;
const SectionTitleRow = styled.div`
  display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;
  ${SectionTitle} { margin-bottom: 0; }
`;
const SectionMeta = styled.span`
  font-size: 11px; color: #94A3B8;
`;
const ItemTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const ItemHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 600; color: #64748B;
`;
const ItemHeadCell = styled.div`
  flex: 1; min-width: 0;
`;
const ItemRow = styled.div`
  display: flex; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid #F1F5F9;
  font-size: 13px; color: #0F172A;
  &:last-child { border-bottom: none; }
`;
const ItemCell = styled.div`
  flex: 1; min-width: 0;
  font-variant-numeric: tabular-nums;
`;
const Summary = styled.div`
  display: flex; flex-direction: column; gap: 6px; padding-top: 12px; margin-top: 8px;
  border-top: 1px solid #F1F5F9;
`;
const SummaryRow = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px;
`;
const SumKey = styled.span`color: #64748B;`;
const SumVal = styled.span`color: #0F172A; font-variant-numeric: tabular-nums;`;
const SummaryDiv = styled.div`height: 1px; background: #F1F5F9; margin: 4px 0;`;
const InstallmentList = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const InstRowWrap = styled.div`
  display: grid; grid-template-columns: 28px minmax(0, 1fr) 80px 110px 100px 32px;
  gap: 10px; align-items: center;
  padding: 12px 12px;
  background: #F8FAFC; border: 1px solid #F1F5F9; border-radius: 8px;
  @media (max-width: 720px) {
    grid-template-columns: 28px minmax(0, 1fr) 32px;
    grid-auto-rows: auto;
  }
`;
const InstNo = styled.div`
  width: 24px; height: 24px; border-radius: 50%;
  background: #fff; color: #475569; border: 1px solid #E2E8F0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
`;
const InstInfo = styled.div`
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
`;
const InstLabel = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const InstMilestone = styled.div`
  font-size: 11px; color: #64748B;
`;
const InstSubMeta = styled.div`
  font-size: 11px; color: #166534; margin-top: 2px;
`;
const InstDue = styled.div`
  font-size: 12px; color: #475569; font-variant-numeric: tabular-nums;
`;
const InstAmt = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A; text-align: right;
  font-variant-numeric: tabular-nums;
`;
const InstStatus = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 4px; justify-content: center;
  padding: 3px 8px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 999px;
`;
const InstMenuWrap = styled.div`
  position: relative;
`;
const InstMenuBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #fff; border-color: #E2E8F0; color: #0F172A; }
`;
const MenuBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 50;
`;
const Menu = styled.div`
  position: absolute; right: 0; top: 32px; z-index: 51;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
  min-width: 180px; padding: 4px; display: flex; flex-direction: column; gap: 1px;
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; font-size: 12px; font-weight: 500;
  color: ${p => p.$danger ? '#DC2626' : '#334155'};
  background: transparent; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  &:hover { background: ${p => p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
`;
const MenuDivider = styled.div`
  height: 1px; background: #F1F5F9; margin: 4px 0;
`;
const BankCard = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const BankRow = styled.div`
  display: flex; gap: 10px; padding: 4px 0;
  font-size: 12px;
`;
const BankKey = styled.span`
  color: #94A3B8; min-width: 60px; flex-shrink: 0;
`;
const BankVal = styled.span`
  color: #0F172A; font-weight: 500;
`;
const BankValRow = styled.span`
  display: inline-flex; gap: 8px; align-items: center;
`;
const CopyChip = styled.button`
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6;
  padding: 2px 8px; border-radius: 999px; cursor: pointer; white-space: nowrap;
  &:hover { background: #14B8A6; color: #fff; }
`;
const PayerHint = styled.div`
  margin-top: 8px; padding: 10px 12px;
  background: #FEF3C7; border-radius: 8px;
  border: 1px dashed #F59E0B;
`;
const PayerHintTitle = styled.div`
  font-size: 11px; font-weight: 700; color: #92400E; margin-bottom: 6px;
`;
const PayerCode = styled.div`
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #0F172A; font-weight: 600;
    background: #fff; padding: 4px 8px; border-radius: 4px;
    border: 1px solid #FDE68A;
  }
`;
const TaxBox = styled.div<{ $status: string }>`
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: ${p => p.$status === 'issued' ? '#F0FDF4' : p.$status === 'required' ? '#FEF3C7' : '#F8FAFC'};
  border: 1px solid ${p => p.$status === 'issued' ? '#86EFAC' : p.$status === 'required' ? '#FDE68A' : '#E2E8F0'};
  border-radius: 10px;
`;
const TaxIcon = styled.div<{ $status: string }>`
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  background: ${p => p.$status === 'issued' ? '#22C55E' : p.$status === 'required' ? '#F59E0B' : '#CBD5E1'};
  color: #fff;
`;
const TaxBody = styled.div`
  flex: 1; min-width: 0;
`;
const TaxLabel = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const TaxDesc = styled.div`
  font-size: 11px; color: #64748B; margin-top: 2px;
`;

// 출처 카드
const SourceCard = styled.div`
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px;
`;
const SourceLeft = styled.div`display: flex; gap: 10px; align-items: center; min-width: 0; flex: 1;`;
const SourceKindBadge = styled.span<{ $kind: string }>`
  font-size: 10px; font-weight: 700; flex-shrink: 0;
  padding: 3px 8px; border-radius: 4px;
  background: ${p =>
    p.$kind === 'contract' ? '#FEF3C7' :
    p.$kind === 'quote' ? '#E0F2FE' :
    p.$kind === 'sow' ? '#F3E8FF' :
    '#FEE2E2'};
  color: ${p =>
    p.$kind === 'contract' ? '#92400E' :
    p.$kind === 'quote' ? '#0369A1' :
    p.$kind === 'sow' ? '#6B21A8' :
    '#991B1B'};
`;
const SourceText = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const SourceTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SourceMeta = styled.div`font-size: 11px; color: #64748B;`;
const SourceLink = styled.a`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #0F766E;
  background: #fff; border: 1px solid #14B8A6; padding: 6px 12px; border-radius: 6px;
  text-decoration: none; flex-shrink: 0;
  &:hover { background: #14B8A6; color: #fff; }
`;
