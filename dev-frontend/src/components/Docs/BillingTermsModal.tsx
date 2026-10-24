// 문서 «청구 조건» 적기 — 서명이 끝나면 이대로 청구서 초안이 만들어진다 (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md)
//   칸은 청구서 발행 창과 **같은 것**(pages/QBill/InvoiceLinesEditor — 항목·합계·분할·스위치). 계약서에 적는 칸과 청구서 칸이
//   갈라지면 «적은 그대로 청구된다» 가 화면에서부터 거짓이 된다. 발송·받는 사람 칸은 없다(초안만 만든다).
//   저장은 버튼(복잡한 폼 예외 — 청구서 발행 창과 같다).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { accessLabel } from '../../utils/clientLabel';
import { listClientOptionsForInvoice, getBusinessInfo, type ApiClientLite, type Currency } from '../../services/invoices';
import { TaxRateInput, TaxModeSelect, useTaxLabel } from '../../pages/QBill/TaxFields';
import { isTaxEnabled, type TaxMode } from '../../utils/taxCalc';
import { saveBillingTerms, type BillingTerms, type BillingTermsState } from '../../services/billingTerms';
import {
  InvoiceItemsTable, InvoiceTotals, InvoiceSplitArea, invoiceTotalsOf, Input, AddRow,
  Section, SectionLabel, SectionLabelRow, FieldGrid, Field, FieldLabel, Textarea,
  ToggleRow, ToggleLeft, Switch, Knob, ToggleText, ToggleTitle, ToggleDesc,
  type InvoiceLineItem, type InvoiceRound,
} from '../../pages/QBill/InvoiceLinesEditor';

const CURRENCY_OPTIONS: PlanQSelectOption[] = [
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'CNY', label: 'CNY (¥)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  postId: number;
  businessId: number;
  postTitle: string;
  /** 문서가 프로젝트 문서면 — 그 프로젝트에 연결된 고객을 먼저 고른다 */
  projectId?: number | null;
  initial: BillingTerms | null;
  onSaved: (s: BillingTermsState) => void;
}

let seq = 1;
const nid = () => Date.now() + (seq++);

export default function BillingTermsModal({ open, onClose, postId, businessId, postTitle, projectId, initial, onSaved }: Props) {
  const { t } = useTranslation('qdocs');
  const { t: tBill } = useTranslation('qbill');
  const { t: tSale } = useTranslation('qsale');
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [vatRate, setVatRate] = useState(0.1);
  const [taxMode, setTaxMode] = useState<TaxMode>('exclusive');
  const [taxLabelRaw, setTaxLabelRaw] = useState<string | null>(null);
  const taxLabel = useTaxLabel(taxLabelRaw);
  const [taxOn, setTaxOn] = useState(false);
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [splitOn, setSplitOn] = useState(false);
  const [rounds, setRounds] = useState<InvoiceRound[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // 열 때마다 저장된 값(없으면 빈 칸)으로 채운다
  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setClientId(initial?.client_id ?? null);
    setTitle(initial?.title ?? '');
    setCurrency((initial?.currency as Currency) || 'KRW');
    setVatRate(initial ? Number(initial.vat_rate) : 0.1);
    setTaxMode(initial?.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive');
    setTaxOn(initial?.receipt_type === 'tax_invoice');
    setItems(initial?.raw_items?.length
      ? initial.raw_items.map(it => ({ id: nid(), description: it.description, detail: it.detail || '', quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0 }))
      : [{ id: nid(), description: '', detail: '', quantity: 1, unit_price: 0 }]);
    const split = initial?.installment_mode === 'split' && (initial.raw_installments || []).length > 0;
    setSplitOn(split);
    setRounds(split
      ? initial!.raw_installments.map(r => ({ id: nid(), label: r.label, milestone: r.milestone_ref || '', rate: Number(r.percent), due_date: r.due_date || '' }))
      : [
        { id: nid(), label: tBill('newInvoice.preset.deposit', { defaultValue: '선금' }) as string, milestone: tBill('newInvoice.preset.depositMs', { defaultValue: '계약 체결' }) as string, rate: 30, due_date: '' },
        { id: nid(), label: tBill('newInvoice.preset.interim', { defaultValue: '중도금' }) as string, milestone: tBill('newInvoice.preset.interimMs', { defaultValue: '중간 검수' }) as string, rate: 40, due_date: '' },
        { id: nid(), label: tBill('newInvoice.preset.balance', { defaultValue: '잔금' }) as string, milestone: tBill('newInvoice.preset.balanceMs', { defaultValue: '최종 검수' }) as string, rate: 30, due_date: '' },
      ]);
    setNotes(initial?.notes ?? '');
  }, [open, initial, tBill]);

  // 워크스페이스 세금 설정 — 처음 적을 때 기본 세율·기준, 언제나 세금 이름(청구서 발행 창과 같은 규칙)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getBusinessInfo(businessId).then((info) => {
      if (!alive || !info) return;
      setTaxLabelRaw(info.tax_label ?? null);
      if (!initial) {
        setVatRate(!isTaxEnabled(info.tax_enabled) ? 0 : Number(info.default_vat_rate ?? 0.1));
        setTaxMode(info.default_tax_mode === 'inclusive' ? 'inclusive' : 'exclusive');
      }
    }).catch(() => { /* 기본값 그대로 */ });
    return () => { alive = false; };
  }, [open, businessId, initial]);

  // 고객 목록 — 청구서 발행 창과 같은 문(GET /api/invoices/:biz/client-options)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listClientOptionsForInvoice(businessId).then((list) => {
      if (!alive) return;
      setClients(list);
      // 처음 적을 때 — 이 프로젝트에 연결된 고객이 하나뿐이면 미리 고른다
      if (!initial && projectId) {
        const linked = list.filter(c => (c.projects || []).some(p => p.id === projectId));
        if (linked.length === 1) setClientId(cur => cur ?? linked[0].id);
      }
    }).catch(() => { if (alive) setClients([]); });
    return () => { alive = false; };
  }, [open, businessId, projectId, initial]);

  const clientOptions: PlanQSelectOption[] = useMemo(() => clients
    .filter(c => c.status !== 'archived')
    .map(c => {
      const rel = accessLabel(c.access_kind, tSale);
      const base = c.display_name || c.company_name || c.biz_name || '—';
      return { value: c.id, label: `${base}${c.biz_name && c.biz_name !== base ? ` (${c.biz_name})` : ''}${rel ? ` · ${rel}` : ''}` };
    }), [clients, tSale]);

  const { subtotal, vat, total } = invoiceTotalsOf(items, vatRate, currency, taxMode);
  const sumPercent = rounds.reduce((s, r) => s + r.rate, 0);
  const sumOk = sumPercent === 100;
  const canTax = currency === 'KRW';

  const updateItem = (id: number, patch: Partial<InvoiceLineItem>) => setItems(arr => arr.map(it => it.id === id ? { ...it, ...patch } : it));
  const removeItem = (id: number) => setItems(arr => arr.length === 1 ? arr : arr.filter(it => it.id !== id));
  const addItem = () => setItems(arr => [...arr, { id: nid(), description: '', detail: '', quantity: 1, unit_price: 0 }]);
  const updateRound = (id: number, patch: Partial<InvoiceRound>) => setRounds(arr => arr.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRound = (id: number) => setRounds(arr => arr.length === 1 ? arr : arr.filter(r => r.id !== id));
  const addRound = () => setRounds(arr => [...arr, { id: nid(), label: tBill('newInvoice.misc.roundSuffix', { n: arr.length + 1, defaultValue: '{{n}}차' }) as string, milestone: '', rate: 0, due_date: '' }]);
  const applyPreset = (preset: number[]) => setRounds(arr => {
    const base = arr.slice(0, preset.length);
    const padded = preset.length > base.length
      ? [...base, ...Array(preset.length - base.length).fill(null).map((_, i) => ({ id: nid(), label: tBill('newInvoice.misc.roundSuffix', { n: base.length + i + 1, defaultValue: '{{n}}차' }) as string, milestone: '', rate: 0, due_date: '' }))]
      : base;
    return padded.map((r, i) => ({ ...r, rate: preset[i] || 0 }));
  });

  const ERR: Record<string, string> = {
    client_required: t('billingTerms.err.client', '받는 고객을 고르세요') as string,
    items_required: t('billingTerms.err.items', '항목을 한 줄 이상 적으세요') as string,
    invalid_amount: t('billingTerms.err.amount', '수량·단가를 확인하세요(0 이상)') as string,
    invalid_installments: t('billingTerms.err.split', '분할 비율 합이 100% 가 되어야 합니다') as string,
    installments_required: t('billingTerms.err.splitCount', '분할은 두 회차 이상이어야 합니다') as string,
    billing_terms_locked: t('billingTerms.err.locked', '서명 요청이 진행 중이라 고칠 수 없습니다') as string,
    billing_terms_invoiced: t('billingTerms.err.invoiced', '이미 청구서를 만들어 고칠 수 없습니다') as string,
    client_not_in_workspace: t('billingTerms.err.clientWs', '이 워크스페이스의 고객이 아닙니다') as string,
  };

  const submit = async () => {
    if (saving) return;
    const errs: string[] = [];
    if (!clientId) errs.push(ERR.client_required);
    if (items.every(it => !it.description.trim())) errs.push(ERR.items_required);
    if (splitOn && !sumOk) errs.push(ERR.invalid_installments);
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setSaving(true);
    try {
      const s = await saveBillingTerms(postId, {
        client_id: clientId,
        title: title.trim() || null,
        currency, vat_rate: vatRate, tax_mode: taxMode,
        receipt_type: taxOn && canTax ? 'tax_invoice' : 'none',
        items: items.filter(it => it.description.trim()).map(it => ({ description: it.description, detail: it.detail.trim() || null, quantity: it.quantity, unit_price: it.unit_price })),
        installment_mode: splitOn ? 'split' : 'single',
        installments: splitOn ? rounds.map(r => ({ label: r.label, percent: r.rate, due_date: r.due_date || null, milestone_ref: r.milestone || null })) : [],
        notes: notes.trim() || null,
      });
      onSaved(s);
      onClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setErrors([ERR[code] || (t('billingTerms.err.save', '저장하지 못했습니다') as string)]);
    } finally { setSaving(false); }
  };

  return (
    <StandardModal open={open} onClose={onClose} size="xl" ariaLabel={t('billingTerms.modalTitle', '청구 조건') as string}
      title={t('billingTerms.modalTitle', '청구 조건') as string}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('common.cancel', '취소') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="billing-terms-save">
            {t('billingTerms.save', '저장') as string}
          </ActionButton>
        </>
      )}>
      <Body>
        <Lead>{t('billingTerms.lead', '서명이 모두 끝나면 이 조건 그대로 청구서 초안을 만듭니다. 고객에게는 아무것도 보내지 않아요 — 초안을 확인하고 발송하세요. 서명 요청을 보내면 받는 분이 이 금액을 서명 화면에서 함께 봅니다.')}</Lead>

        <Section>
          <FieldGrid>
            <Field $span={2}>
              <FieldLabel>{t('billingTerms.client', '받는 고객')}</FieldLabel>
              <PlanQSelect
                size="sm" isSearchable
                placeholder={t('billingTerms.clientPh', '고객 고르기') as string}
                options={clientOptions}
                value={clientOptions.find(o => o.value === clientId) || null}
                onChange={(opt) => setClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
              />
            </Field>
            <Field $span={2}>
              <FieldLabel>{t('billingTerms.titleLabel', '청구서 제목')}</FieldLabel>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={postTitle} data-testid="billing-terms-title" />
            </Field>
            <Field>
              <FieldLabel>{tBill('newInvoice.compose.currency')}</FieldLabel>
              <PlanQSelect size="sm" options={CURRENCY_OPTIONS}
                value={CURRENCY_OPTIONS.find(o => o.value === currency) || null}
                onChange={(opt) => opt && setCurrency((opt as PlanQSelectOption).value as Currency)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="billing-terms-tax-rate">{tBill('newInvoice.compose.vatRate')}</FieldLabel>
              <TaxRateInput id="billing-terms-tax-rate" testId="billing-terms-tax-rate" value={vatRate} onChange={setVatRate} />
            </Field>
            <Field>
              <FieldLabel>{tBill('tax.mode')}</FieldLabel>
              <TaxModeSelect testId="billing-terms-tax-mode" value={taxMode} onChange={setTaxMode} />
            </Field>
          </FieldGrid>
        </Section>

        <Section>
          <SectionLabelRow>
            <SectionLabel>{tBill('newInvoice.items.title')}</SectionLabel>
            <AddRow onClick={addItem} type="button" data-testid="billing-terms-add-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {tBill('newInvoice.items.addRow')}
            </AddRow>
          </SectionLabelRow>
          <InvoiceItemsTable items={items} currency={currency} onUpdate={updateItem} onRemove={removeItem}
            basis={vatRate > 0 ? tBill(taxMode === 'inclusive' ? 'tax.tag.included' : 'tax.tag.excluded', { label: taxLabel }) as string : null} />
          <InvoiceTotals subtotal={subtotal} vat={vat} total={total} vatRate={vatRate} currency={currency} taxLabel={taxLabel} />
        </Section>

        <Section>
          <ToggleRow>
            <ToggleLeft>
              <Switch $on={splitOn} onClick={() => setSplitOn(o => !o)} role="switch" aria-checked={splitOn} type="button" data-testid="billing-terms-split">
                <Knob $on={splitOn} />
              </Switch>
              <ToggleText>
                <ToggleTitle>{tBill('newInvoice.split.toggle')}</ToggleTitle>
                <ToggleDesc>{t('billingTerms.splitDesc', '선금·중도금·잔금처럼 나눠 받습니다. 기한을 비워 두면 청구서에서 정합니다.')}</ToggleDesc>
              </ToggleText>
            </ToggleLeft>
          </ToggleRow>
          {splitOn && (
            <InvoiceSplitArea rounds={rounds} total={total} currency={currency} sumOk={sumOk} sumPercent={sumPercent}
              onPreset={applyPreset} onUpdate={updateRound} onRemove={removeRound} onAdd={addRound} />
          )}
        </Section>

        <Section>
          <ToggleRow>
            <ToggleLeft>
              <Switch $on={taxOn && canTax} onClick={() => canTax && setTaxOn(o => !o)} role="switch" aria-checked={taxOn && canTax} type="button" disabled={!canTax}>
                <Knob $on={taxOn && canTax} />
              </Switch>
              <ToggleText>
                <ToggleTitle>{tBill('newInvoice.tax.toggle')}</ToggleTitle>
                <ToggleDesc>{canTax
                  ? t('billingTerms.taxDesc', '결제가 끝나면 세금계산서 발행 대상으로 잡힙니다.')
                  : t('billingTerms.taxForeign', '외화 청구는 한국 세금계산서를 발행할 수 없습니다.')}</ToggleDesc>
              </ToggleText>
            </ToggleLeft>
          </ToggleRow>
        </Section>

        <Section>
          <SectionLabel>{t('billingTerms.notes', '청구서 메모 (선택)')}</SectionLabel>
          {/* draft-exempt: 저장 버튼 폼(청구서 발행 창과 같은 예외) — 메모는 조건과 함께 한 번에 저장된다 */}
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={t('billingTerms.notesPh', '청구서에 함께 적을 말 — 서명 화면에는 나오지 않습니다') as string} />
        </Section>

        {errors.length > 0 && (
          <ErrorPanel role="alert">{errors.map((m, i) => <div key={i}>{m}</div>)}</ErrorPanel>
        )}
      </Body>
    </StandardModal>
  );
}

const Body = styled.div`display: flex; flex-direction: column; gap: 16px;`;
const Lead = styled.p`
  margin: 0; padding: 10px 12px; font-size: 0.8125rem; line-height: 1.55; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
`;
const ErrorPanel = styled.div`
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: #991B1B; font-weight: 600;
`;
