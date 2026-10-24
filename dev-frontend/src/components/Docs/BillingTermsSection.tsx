// 문서 «청구 조건» 칸 — 서명 진행 아래 (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md · Fable 설계 A+D)
//
//   Irene: «서명을 완료한 계약서 기반으로 청구서를 자동생성 해줘 … 매번 ai가 살펴보지 않고»
//   - 조건 있음: 금액 요약 + (서명 요청 전) [고치기][지우기] · (서명 진행 중) 잠김 · (서명 완료) 만든 청구서로 가는 길
//   - 조건 없음: 고칠 수 있는 사람에게만 «+ 청구 조건 적기». 서명이 다 끝났는데 조건이 없으면 «청구서 만들기» 카드(D) —
//     출처 문서를 채운 발행 창(/bills?tab=invoices&new=1&from_post=:id)으로 간다(금액은 사람이 적는다).
//   - 자동 생성이 실패했으면 까닭 + [지금 만들기]. Q bill 권한이 없는 멤버·고객에게는 칸 자체가 없다(서버 403 → null).
//   - 실시간: 서버가 post:billing_terms(신호만)·invoice:new 를 business 방에 쏜다 → 다시 읽는다. 탭 복귀에도 다시 읽는다.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import BillingTermsModal from './BillingTermsModal';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { formatMoney, type Currency } from '../../services/invoices';
import { formatRate } from '../../utils/taxCalc';
import {
  getBillingTerms, deleteBillingTerms, createInvoiceFromTerms, type BillingTermsState,
} from '../../services/billingTerms';

interface Props {
  postId: number;
  businessId: number;
  postTitle: string;
  projectId?: number | null;
  /** 서명 진행이 바뀌면 부모가 올린다(잠금·서명 완료가 바뀐다) */
  reloadTrigger?: number;
}

export default function BillingTermsSection({ postId, businessId, postTitle, projectId, reloadTrigger }: Props) {
  const { t } = useTranslation('qdocs');
  const { t: tBill } = useTranslation('qbill');
  const taxName = tBill('tax.defaultLabel') as string;
  const [state, setState] = useState<BillingTermsState | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setState(await getBillingTerms(postId)); } catch { /* 칸을 지우지 않는다 — 보던 것을 둔다 */ }
  }, [postId]);

  useEffect(() => { setState(null); void load(); }, [load]);
  useEffect(() => { if (reloadTrigger) void load(); }, [reloadTrigger, load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void load(); }, 250); };
    const off1 = onSocket<{ post_id: number }>('post:billing_terms', (p) => { if (p && Number(p.post_id) === postId) later(); });
    const off2 = onSocket('invoice:new', later);
    // 서명이 바뀌면(우리 쪽 서명·받는 쪽 서명) 확인 필요 갱신 신호가 같이 온다 — 잠금·서명 완료를 다시 읽는다
    const off3 = onSocket<{ entity_id?: number }>('inbox:refresh', (p) => { if (!p || !p.entity_id || Number(p.entity_id) === postId) later(); });
    return () => { off1(); off2(); off3(); if (timer) clearTimeout(timer); };
  }, [postId, load]);

  if (!state || state.payroll_contract) return null;
  const { terms, invoice } = state;
  // 조건이 없고 적을 수도 없고 서명도 안 끝났으면 — 보여 줄 것이 없다
  if (!terms && !state.can_edit && !(state.fully_signed && state.can_create_invoice)) return null;

  const cur = (terms?.currency || 'KRW') as Currency;
  const runCreate = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    // savemerge-exempt: 응답이 GET 과 같은 «칸 전체 상태»(BillingTermsState)다 — 일부 필드 저장 응답이 아니다
    try { setState(await createInvoiceFromTerms(postId)); }
    catch { setErr(t('billingTerms.createFailed', '청구서 초안을 만들지 못했습니다. 잠시 뒤 다시 시도하거나 청구서를 직접 만드세요.') as string); }
    finally { setBusy(false); }
  };
  const runDelete = async () => {
    setDelOpen(false);
    // savemerge-exempt: 응답이 GET 과 같은 «칸 전체 상태»(BillingTermsState)다 — 일부 필드 저장 응답이 아니다
    try { setState(await deleteBillingTerms(postId)); }
    catch { setErr(t('billingTerms.deleteFailed', '지우지 못했습니다') as string); }
  };
  const newInvoiceHref = `/bills?tab=invoices&new=1&from_post=${postId}${projectId ? `&project=${projectId}` : ''}`;

  return (
    <Wrap data-testid="billing-terms-section">
      <Head>
        <HeadTitle>{t('billingTerms.title', '청구 조건')}</HeadTitle>
        {terms && !invoice && !state.invoice_deleted && (
          <StateChip $tone={state.locked ? 'lock' : 'open'}>
            {state.fully_signed
              ? t('billingTerms.chip.signed', '서명 완료')
              : state.locked ? t('billingTerms.chip.locked', '서명 진행 중 · 잠김') : t('billingTerms.chip.open', '서명 요청 전 · 고칠 수 있음')}
          </StateChip>
        )}
        {(invoice || state.invoice_deleted) && <StateChip $tone="done">{t('billingTerms.chip.invoiced', '청구서 초안 만듦')}</StateChip>}
      </Head>

      {!terms && state.can_edit && (
        <Empty>
          <EmptyText>{t('billingTerms.emptyHint', '결제 받을 계약이면 금액·항목·분할을 적어 두세요. 서명이 모두 끝나는 순간 이 조건 그대로 청구서 초안을 만듭니다(고객에게 자동 발송하지 않음).')}</EmptyText>
          <ActionButton tone="secondary" size="sm" onClick={() => setEditOpen(true)} data-testid="billing-terms-open">
            {t('billingTerms.add', '+ 청구 조건 적기')}
          </ActionButton>
        </Empty>
      )}

      {!terms && !state.can_edit && state.fully_signed && state.can_create_invoice && (
        <Empty>
          <EmptyText>{t('billingTerms.signedNoTerms', '서명이 모두 끝났습니다. 청구 조건을 적지 않아 청구서는 자동으로 만들지 않았어요.')}</EmptyText>
          <ActionLink href={newInvoiceHref} data-testid="billing-terms-new-invoice">{t('billingTerms.newInvoice', '청구서 만들기')}</ActionLink>
        </Empty>
      )}

      {terms && (
        <>
          <Summary>
            <SumLine>
              {/* 세액 0 이면 «부가세 포함» 이라 쓰지 않는다 — 세금 기준·세율은 아래 공식 줄(2026-10-24) */}
              <SumKey>{Number(terms.tax_amount) > 0 ? tBill('tax.total', { label: taxName }) : tBill('tax.totalNoTax')}</SumKey>
              <SumVal data-testid="billing-terms-total">{formatMoney(terms.grand_total, cur)}</SumVal>
            </SumLine>
            <SumSub>
              {terms.items.map(it => it.description).join(' · ')}
              {' — '}
              {Number(terms.tax_amount) > 0
                ? tBill('tax.formula', { subtotal: formatMoney(terms.subtotal, cur), label: taxName, rate: formatRate(terms.vat_rate), tax: formatMoney(terms.tax_amount, cur), total: formatMoney(terms.grand_total, cur) })
                : tBill('tax.formulaNoTax', { total: formatMoney(terms.grand_total, cur), label: taxName })}
              {terms.tax_mode === 'inclusive' && Number(terms.tax_amount) > 0 ? ` · ${tBill('tax.mode_inclusive')}` : ''}
            </SumSub>
            {terms.installment_mode === 'split' && terms.installments.length > 0 && (
              <SumSub>
                {terms.installments.map(r => `${r.label} ${r.percent}% ${formatMoney(r.amount, cur)}`).join(' / ')}
              </SumSub>
            )}
          </Summary>

          {invoice ? (
            <Row>
              <RowText>{t('billingTerms.invoicedText', '서명이 끝나 청구서 초안 {{no}} 를 만들었습니다. 확인 후 발송하세요.', { no: invoice.invoice_number })}</RowText>
              <ActionLink href={`/bills?tab=invoices&invoice=${invoice.id}`} data-testid="billing-terms-invoice-link">{t('billingTerms.openInvoice', '청구서 열기')}</ActionLink>
            </Row>
          ) : state.invoice_deleted ? (
            <Row $warn>
              <RowText>{t('billingTerms.invoiceDeleted', '자동으로 만든 청구서 초안이 지워졌습니다. 다시 자동으로 만들지는 않아요 — 필요하면 청구서를 직접 만드세요.')}</RowText>
              {state.can_create_invoice && <ActionLink href={newInvoiceHref} data-testid="billing-terms-new-invoice">{t('billingTerms.newInvoice', '청구서 만들기')}</ActionLink>}
            </Row>
          ) : terms.auto_error ? (
            <Row $warn>
              <RowText>{terms.auto_error === 'no_client'
                ? t('billingTerms.errNoClient', '받는 고객이 없어 청구서 초안을 만들지 못했습니다.')
                : t('billingTerms.errCreate', '청구서 초안을 만들지 못했습니다. 오늘 밤 다시 시도합니다.')}</RowText>
              {terms.auto_error !== 'no_client' && state.can_create_invoice && (
                <ActionButton tone="primary" size="sm" loading={busy} onClick={runCreate} data-testid="billing-terms-retry">{t('billingTerms.retry', '지금 만들기')}</ActionButton>
              )}
              <ActionLink href={newInvoiceHref}>{t('billingTerms.newInvoice', '청구서 만들기')}</ActionLink>
            </Row>
          ) : state.fully_signed ? (
            state.can_create_invoice ? (
              <Row>
                <RowText>{t('billingTerms.pendingCreate', '서명이 모두 끝났습니다 — 청구서 초안을 만드는 중입니다.')}</RowText>
                <ActionButton tone="primary" size="sm" loading={busy} onClick={runCreate}>{t('billingTerms.retry', '지금 만들기')}</ActionButton>
              </Row>
            ) : null
          ) : (
            <Row>
              <RowText>{state.locked
                ? t('billingTerms.lockedText', '서명이 모두 끝나면 이 조건 그대로 청구서 초안을 만듭니다. 서명이 진행되는 동안에는 고칠 수 없어요.')
                : t('billingTerms.openText', '서명 요청을 보내면 받는 분이 이 금액을 서명 화면에서 함께 봅니다. 서명이 모두 끝나면 이대로 청구서 초안을 만듭니다.')}</RowText>
              {state.can_edit && (
                <>
                  <ActionButton tone="secondary" size="sm" onClick={() => setEditOpen(true)} data-testid="billing-terms-edit">{t('billingTerms.edit', '고치기')}</ActionButton>
                  <ActionButton tone="danger" size="sm" onClick={() => setDelOpen(true)} data-testid="billing-terms-delete">{t('billingTerms.delete', '지우기')}</ActionButton>
                </>
              )}
            </Row>
          )}
        </>
      )}
      {err && <ErrText role="alert">{err}</ErrText>}

      <BillingTermsModal
        open={editOpen} onClose={() => setEditOpen(false)}
        postId={postId} businessId={businessId} postTitle={postTitle} projectId={projectId}
        // savemerge-exempt: 저장 응답이 GET 과 같은 «칸 전체 상태»(BillingTermsState)다
        initial={terms} onSaved={(next) => setState(next)}
      />
      <ConfirmDialog
        isOpen={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={runDelete}
        title={t('billingTerms.deleteTitle', '청구 조건을 지울까요?') as string}
        message={t('billingTerms.deleteMessage', '지우면 서명이 끝나도 청구서 초안을 자동으로 만들지 않습니다.') as string}
        confirmText={t('billingTerms.delete', '지우기') as string}
        cancelText={t('common.close', '닫기') as string}
        variant="danger"
      />
    </Wrap>
  );
}

const Wrap = styled.section`
  margin: 0 0 16px; padding: 14px 16px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;
  display: flex; flex-direction: column; gap: 10px;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const HeadTitle = styled.h3`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const StateChip = styled.span<{ $tone: 'open' | 'lock' | 'done' }>`
  font-size: 0.6875rem; font-weight: 600; padding: 3px 8px; border-radius: 999px;
  color: ${p => p.$tone === 'done' ? '#166534' : p.$tone === 'lock' ? '#475569' : '#0F766E'};
  background: ${p => p.$tone === 'done' ? '#DCFCE7' : p.$tone === 'lock' ? '#F1F5F9' : '#F0FDFA'};
`;
const Empty = styled.div`display: flex; align-items: center; gap: 12px; flex-wrap: wrap;`;
const EmptyText = styled.p`margin: 0; flex: 1 1 260px; font-size: 0.8125rem; line-height: 1.55; color: #64748B;`;
const Summary = styled.div`display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px;`;
const SumLine = styled.div`display: flex; justify-content: space-between; align-items: baseline; gap: 12px;`;
const SumKey = styled.span`font-size: 0.75rem; color: #64748B;`;
const SumVal = styled.span`font-size: 1rem; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const SumSub = styled.div`font-size: 0.75rem; color: #475569; line-height: 1.5; overflow-wrap: anywhere;`;
const Row = styled.div<{ $warn?: boolean }>`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  ${p => p.$warn ? 'padding: 8px 10px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px;' : ''}
`;
const RowText = styled.p`margin: 0; flex: 1 1 240px; font-size: 0.8125rem; line-height: 1.55; color: #334155;`;
const ActionLink = styled.a`
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 6px;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E; background: #F0FDFA; border: 1px solid #14B8A6;
  text-decoration: none; &:hover { background: #CCFBF1; }
`;
const ErrText = styled.div`font-size: 0.75rem; color: #B91C1C; font-weight: 600;`;
