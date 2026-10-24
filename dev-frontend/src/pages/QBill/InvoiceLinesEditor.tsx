// 청구서 항목·합계·분할 칸 — 청구서 발행 창(NewInvoiceModal)과 문서 «청구 조건» 창(Docs/BillingTermsModal)이 같이 쓴다 (2026-10-23).
//   발행 창 안에 인라인으로 있던 것을 **그대로 옮겼다**(값·간격·문구 같음) — 계약서에 적는 칸과 청구서 칸이 갈라지면
//   «적은 그대로 청구된다» 가 화면에서부터 거짓이 된다. 금액 계산은 services/invoices roundMoney(서버 services/money 와 같은 규칙).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SingleDateField from '../../components/Common/SingleDateField';
import { formatMoney, roundMoney, currencyDecimals, type Currency } from '../../services/invoices';
import { splitTax, formatRate, type TaxMode } from '../../utils/taxCalc';

export interface InvoiceLineItem { id: number; description: string; detail: string; quantity: number; unit_price: number; }
export interface InvoiceRound { id: number; label: string; milestone: string; rate: number; due_date: string; }

/** 합계 — 화면 계산(서버 services/invoiceCreate.computeAmounts 와 같은 규칙). 세금 포함이면 항목 합 = 합계, 공급가·세액은 합계에서 한 번 역산(utils/taxCalc) */
export function invoiceTotalsOf(items: InvoiceLineItem[], vatRate: number, currency: Currency, taxMode: TaxMode = 'exclusive') {
  const lines = roundMoney(items.reduce((s, it) => s + roundMoney(it.quantity * roundMoney(it.unit_price, currency), currency), 0), currency);
  const r = splitTax({ amount: lines, rate: vatRate, mode: taxMode, currency });
  return { subtotal: r.subtotal, vat: r.tax, total: r.total };
}

export function InvoiceItemsTable({ items, currency, onUpdate, onRemove, basis }: {
  items: InvoiceLineItem[]; currency: Currency;
  onUpdate: (id: number, patch: Partial<InvoiceLineItem>) => void; onRemove: (id: number) => void;
  /** 단가·금액 머리에 붙일 기준 — «VAT 포함»/«VAT 별도» (세율 0 이면 안 붙인다) */
  basis?: string | null;
}) {
  const { t } = useTranslation('qbill');
  const tail = basis ? ` (${basis})` : '';
  return (
    <ItemTable>
      <ItemHead>
        <ItemHeadCell style={{ width: 28 }}>#</ItemHeadCell>
        <ItemHeadCell>{t('newInvoice.items.description')}</ItemHeadCell>
        <ItemHeadCell style={{ width: 70 }}>{t('newInvoice.items.qty')}</ItemHeadCell>
        <ItemHeadCell style={{ width: 110 }}>{t('newInvoice.items.unitPrice')}{tail}</ItemHeadCell>
        <ItemHeadCell style={{ width: 110, textAlign: 'right' }}>{t('newInvoice.items.subtotal')}{tail}</ItemHeadCell>
        <ItemHeadCell style={{ width: 28 }}></ItemHeadCell>
      </ItemHead>
      {items.map((it, idx) => (
        <ItemRow key={it.id}>
          <ItemCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</ItemCell>
          <ItemCell style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Input value={it.description} onChange={e => onUpdate(it.id, { description: e.target.value })} placeholder={t('newInvoice.items.descriptionPh') as string} />
            {/* draft-exempt: 청구서 발행·청구 조건 창의 항목 칸 — 창 전체가 저장 버튼 폼이다(옮기기 전 발행 창과 같다) */}
            <DetailInput value={it.detail} onChange={e => onUpdate(it.id, { detail: e.target.value })}
              placeholder={t('newInvoice.items.detailPh', { defaultValue: '상세내용 (선택)' }) as string}
              rows={1} />
          </ItemCell>
          <ItemCell style={{ width: 70 }}>
            <Input type="number" min={1} value={it.quantity} onChange={e => onUpdate(it.id, { quantity: Number(e.target.value) || 0 })} />
          </ItemCell>
          <ItemCell style={{ width: 110 }}>
            <Input type="number" min={0} step={currencyDecimals(currency) === 0 ? 1 : 0.01} value={it.unit_price} onChange={e => onUpdate(it.id, { unit_price: Number(e.target.value) || 0 })} />
          </ItemCell>
          <ItemCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>
            {formatMoney(roundMoney(it.quantity * roundMoney(it.unit_price, currency), currency), currency)}
          </ItemCell>
          <ItemCell style={{ width: 28 }}>
            <RemoveBtn type="button" onClick={() => onRemove(it.id)} aria-label="remove" disabled={items.length === 1}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </RemoveBtn>
          </ItemCell>
        </ItemRow>
      ))}
    </ItemTable>

  );
}

export function InvoiceTotals({ subtotal, vat, total, vatRate, currency, taxLabel }: {
  subtotal: number; vat: number; total: number; vatRate: number; currency: Currency;
  /** 세금 이름(워크스페이스 설정) — 없으면 화면 언어 기본 */
  taxLabel?: string | null;
}) {
  const { t } = useTranslation('qbill');
  const label = (taxLabel && taxLabel.trim()) || (t('tax.defaultLabel') as string);
  return (
    <Summary data-testid="invoice-totals">
      <SumRow>
        <SumKey>{t('tax.subtotal', { label })}</SumKey>
        <SumVal>{formatMoney(subtotal, currency)}</SumVal>
      </SumRow>
      <SumRow>
        {/* 세율은 정수로 자르지 않는다(8.25%) · 세액 0 이면 «VAT 없음» 을 적는다(빠뜨리면 별도인지 없는지 모른다) */}
        <SumKey>{vat > 0 || vatRate > 0 ? t('tax.taxLine', { label, rate: formatRate(vatRate) }) : t('tax.noTax', { label })}</SumKey>
        <SumVal>{formatMoney(vat, currency)}</SumVal>
      </SumRow>
      <SumDiv />
      <SumRow>
        <SumKey style={{ fontWeight: 700, color: '#0F172A' }}>{vat > 0 ? t('tax.total', { label }) : t('tax.totalNoTax')}</SumKey>
        <SumVal style={{ fontSize: '1rem', fontWeight: 700 }}>{formatMoney(total, currency)}</SumVal>
      </SumRow>
    </Summary>
  );
}

export function InvoiceSplitArea({ rounds, total, currency, sumOk, sumPercent, onPreset, onUpdate, onRemove, onAdd }: {
  rounds: InvoiceRound[]; total: number; currency: Currency; sumOk: boolean; sumPercent: number;
  onPreset: (preset: number[]) => void; onUpdate: (id: number, patch: Partial<InvoiceRound>) => void;
  onRemove: (id: number) => void; onAdd: () => void;
}) {
  const { t } = useTranslation('qbill');
  return (
    <SplitArea>
      <PresetRow>
        <PresetLabel>{t('newInvoice.split.presets.title')}</PresetLabel>
        <PresetBtn onClick={() => onPreset([30, 40, 30])}>{t('newInvoice.split.presets.p3030')}</PresetBtn>
        <PresetBtn onClick={() => onPreset([50, 50])}>{t('newInvoice.split.presets.p5050')}</PresetBtn>
        <PresetBtn onClick={() => onPreset([30, 70])}>{t('newInvoice.split.presets.p3070')}</PresetBtn>
      </PresetRow>

      <RoundTable>
        <RoundHead>
          <RoundHeadCell style={{ width: 28 }}>#</RoundHeadCell>
          <RoundHeadCell>{t('newInvoice.split.label')}</RoundHeadCell>
          <RoundHeadCell>{t('newInvoice.split.milestone')}</RoundHeadCell>
          <RoundHeadCell style={{ width: 80 }}>{t('newInvoice.split.rate')}</RoundHeadCell>
          <RoundHeadCell style={{ width: 110, textAlign: 'right' }}>{t('newInvoice.split.amount')}</RoundHeadCell>
          <RoundHeadCell style={{ width: 130 }}>{t('newInvoice.split.due')}</RoundHeadCell>
          <RoundHeadCell style={{ width: 28 }}></RoundHeadCell>
        </RoundHead>
        {rounds.map((r, idx) => (
          <RoundRow key={r.id}>
            <RoundCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</RoundCell>
            <RoundCell>
              <Input value={r.label} onChange={e => onUpdate(r.id, { label: e.target.value })} placeholder={t('newInvoice.split.labelPh') as string} />
            </RoundCell>
            <RoundCell>
              <Input value={r.milestone} onChange={e => onUpdate(r.id, { milestone: e.target.value })} placeholder={t('newInvoice.split.milestonePh') as string} />
            </RoundCell>
            <RoundCell style={{ width: 80 }}>
              <PercentInputWrap>
                <Input type="number" min={0} max={100} value={r.rate} onChange={e => onUpdate(r.id, { rate: Number(e.target.value) || 0 })} style={{ paddingRight: 22 }} />
                <PercentSign>%</PercentSign>
              </PercentInputWrap>
            </RoundCell>
            <RoundCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>
              {formatMoney(roundMoney(total * r.rate / 100, currency), currency)}
            </RoundCell>
            <RoundCell style={{ width: 130 }}>
              <SingleDateField value={r.due_date} onChange={(d) => onUpdate(r.id, { due_date: d })} size="sm" width={140} />
            </RoundCell>
            <RoundCell style={{ width: 28 }}>
              <RemoveBtn type="button" onClick={() => onRemove(r.id)} aria-label="remove">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </RemoveBtn>
            </RoundCell>
          </RoundRow>
        ))}
      </RoundTable>

      <SplitFooter>
        <AddRow onClick={onAdd}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('newInvoice.split.addRound')}
        </AddRow>
        <SumStatus $ok={sumOk}>
          {sumOk ? t('newInvoice.split.sumOk') : t('newInvoice.split.sumWarn', { percent: sumPercent })}
        </SumStatus>
      </SplitFooter>
    </SplitArea>
  );
}

export const Input = styled.input`
  width: 100%; padding: 7px 10px; font-size: 0.8125rem; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px;
  font-variant-numeric: tabular-nums;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const DetailInput = styled.textarea`
  width: 100%; padding: 5px 10px; font-size: 0.75rem; color: #64748B;
  background: #F8FAFC; border: 1px dashed #E2E8F0; border-radius: 6px;
  resize: vertical; font-family: inherit; min-height: 30px; line-height: 1.4;
  &::placeholder { color: #B6C0CD; }
  &:focus { outline: none; border-color: #14B8A6; border-style: solid; background: #fff; color: #334155; }
`;
const ItemTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const ItemHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
`;
const ItemHeadCell = styled.div`flex: 1; min-width: 0;`;
const ItemRow = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; align-items: center;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const ItemCell = styled.div`flex: 1; min-width: 0; display: flex; align-items: center;`;
const RemoveBtn = styled.button`
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 4px; cursor: pointer; color: #94A3B8;
  &:hover:not(:disabled) { background: #FEF2F2; color: #DC2626; }
  &:disabled { opacity: 0.3; cursor: not-allowed; }
`;
const Summary = styled.div`
  display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; background: #F8FAFC; border-radius: 8px;
`;
const SumRow = styled.div`display: flex; justify-content: space-between; font-size: 0.8125rem;`;
const SumKey = styled.span`color: #64748B;`;
const SumVal = styled.span`color: #0F172A; font-variant-numeric: tabular-nums;`;
const SumDiv = styled.div`height: 1px; background: #E2E8F0; margin: 4px 0;`;
export const AddRow = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; font-size: 0.6875rem; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 6px; cursor: pointer;
  line-height: 1;
  & > svg { display: block; flex-shrink: 0; }
  &:hover { background: #14B8A6; color: #fff; }
`;
const SplitArea = styled.div`display: flex; flex-direction: column; gap: 10px; margin-top: 8px;`;
const PresetRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const PresetLabel = styled.span`font-size: 0.6875rem; font-weight: 600; color: #64748B;`;
const PresetBtn = styled.button`
  padding: 4px 10px; font-size: 0.6875rem; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 999px; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
`;
const RoundTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const RoundHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
`;
const RoundHeadCell = styled.div`flex: 1; min-width: 0;`;
const RoundRow = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; align-items: center;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const RoundCell = styled.div`flex: 1; min-width: 0; display: flex; align-items: center;`;
const PercentInputWrap = styled.div`position: relative; width: 100%;`;
const PercentSign = styled.span`
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 0.75rem; color: #94A3B8;
`;
const SplitFooter = styled.div`
  display: flex; justify-content: space-between; align-items: center;
`;
const SumStatus = styled.span<{ $ok: boolean }>`
  font-size: 0.75rem; font-weight: 700;
  color: ${p => p.$ok ? '#166534' : '#92400E'};
  background: ${p => p.$ok ? '#DCFCE7' : '#FEF3C7'};
  padding: 4px 10px; border-radius: 999px;
`;

// 발행 창의 칸 묶음·라벨·스위치 — 문서 «청구 조건» 창이 같은 모양을 쓴다
export const Section = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
`;
export const SectionLabel = styled.div`
  font-size: 0.75rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;
`;
export const SectionLabelRow = styled.div`
  display: flex; justify-content: space-between; align-items: center;
`;
export const FieldGrid = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  @media (max-width: 720px) { grid-template-columns: repeat(2, 1fr); }
`;
export const Field = styled.div<{ $span?: number }>`
  grid-column: span ${p => p.$span || 1};
  display: flex; flex-direction: column; gap: 4px;
  @media (max-width: 720px) { grid-column: span 2; }
`;
export const FieldLabel = styled.label`font-size: 0.6875rem; font-weight: 600; color: #475569;`;
export const Textarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 0.8125rem; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
export const ToggleRow = styled.div`display: flex; justify-content: space-between; align-items: flex-start;`;
export const ToggleLeft = styled.div`display: flex; gap: 12px; align-items: flex-start;`;
export const Switch = styled.button<{ $on: boolean }>`
  width: 36px; height: 20px; border-radius: 999px;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; cursor: pointer; padding: 0; flex-shrink: 0;
  position: relative; transition: background 0.2s; margin-top: 2px;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
export const Knob = styled.span<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '18px' : '2px'};
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: left 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
`;
export const ToggleText = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
export const ToggleTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
export const ToggleDesc = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5;`;
