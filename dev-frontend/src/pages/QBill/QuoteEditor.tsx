import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect from '../../components/Common/PlanQSelect';
import type { PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { mockClients, formatMoney, type MockQuote, type MockQuoteItem, quoteStatusColor } from './mock';

interface Props {
  quote: MockQuote | null;        // null = 신규 작성
  onClose: () => void;
}

const CURRENCY_OPTIONS: PlanQSelectOption[] = [
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'USD', label: 'USD ($)' },
];

const clientOptions: PlanQSelectOption[] = mockClients.map((c) => ({
  value: c.id,
  label: `${c.company} (${c.name})${c.country !== 'KR' ? ` · ${c.country}` : ''}`,
}));

interface DraftItem {
  key: number;       // local key
  description: string;
  quantity: number;
  unit_price: number;
}

export default function QuoteEditor({ quote, onClose }: Props) {
  const { t } = useTranslation('qbill');
  const isNew = !quote;

  const [clientId, setClientId] = useState<number | ''>(quote?.client_id ?? '');
  const [title, setTitle] = useState(quote?.title ?? '');
  const [issuedAt, setIssuedAt] = useState(quote?.issued_at ?? new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [currency, setCurrency] = useState<'KRW' | 'USD'>(quote?.currency ?? 'KRW');
  const [vatRate, setVatRate] = useState(quote?.vat_rate ?? 0.10);
  const [paymentTerms, setPaymentTerms] = useState(quote?.payment_terms ?? '');
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [items, setItems] = useState<DraftItem[]>(() =>
    quote
      ? quote.items.map((it: MockQuoteItem, i) => ({ key: i + 1, description: it.description, quantity: it.quantity, unit_price: it.unit_price }))
      : [{ key: 1, description: '', quantity: 1, unit_price: 0 }]
  );

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
    const vat = Math.round(subtotal * vatRate);
    return { subtotal, vat, total: subtotal + vat };
  }, [items, vatRate]);

  const addRow = () => setItems((prev) => [...prev, { key: Date.now(), description: '', quantity: 1, unit_price: 0 }]);
  const removeRow = (key: number) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  const patchRow = (key: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const statusColor = quote ? quoteStatusColor(quote.status) : { bg: '#F1F5F9', fg: '#64748B' };

  return (
    <>
      <Topbar>
        <BackBtn type="button" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('quotes.title')}
        </BackBtn>
        <Title>
          {isNew ? t('editor.newTitle') : t('editor.editTitle')}
          {quote && <QuoteNumber>{quote.quote_number}</QuoteNumber>}
        </Title>
        {quote && (
          <StatusPill style={{ background: statusColor.bg, color: statusColor.fg }}>
            {t(`quotes.status.${quote.status}`)}
          </StatusPill>
        )}
        <Spacer />
        <Secondary type="button" onClick={onClose}>{t('editor.actions.save')}</Secondary>
        <Primary type="button" disabled>{t('editor.actions.send')}</Primary>
      </Topbar>

      <Body>
        <Card>
          <Row2>
            <Field>
              <Label>{t('editor.client')}</Label>
              <PlanQSelect
                size="sm"
                placeholder={t('editor.selectClient') as string}
                isClearable
                options={clientOptions}
                value={clientOptions.find((o) => o.value === clientId) ?? null}
                onChange={(opt) => setClientId((opt as PlanQSelectOption | null)?.value as number | '' ?? '')}
              />
            </Field>
            <Field>
              <Label>{t('editor.title')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('editor.titlePlaceholder') as string} />
            </Field>
          </Row2>
          <Row3>
            <Field>
              <Label>{t('editor.issuedAt')}</Label>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field>
              <Label>{t('editor.validUntil')}</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
            <Field>
              <Label>{t('editor.currency')}</Label>
              <PlanQSelect
                size="sm"
                options={CURRENCY_OPTIONS}
                value={CURRENCY_OPTIONS.find((o) => o.value === currency) ?? null}
                onChange={(opt) => setCurrency((opt as PlanQSelectOption).value as 'KRW' | 'USD')}
                isClearable={false}
              />
            </Field>
          </Row3>
        </Card>

        <Card>
          <SectionRow>
            <SectionTitle>{t('editor.items.title')}</SectionTitle>
            <AddRowBtn type="button" onClick={addRow}>{t('editor.items.addRow')}</AddRowBtn>
          </SectionRow>
          <ItemsHead>
            <ColDesc>{t('editor.items.description')}</ColDesc>
            <ColQty>{t('editor.items.quantity')}</ColQty>
            <ColPrice>{t('editor.items.unitPrice')}</ColPrice>
            <ColSub>{t('editor.items.subtotal')}</ColSub>
            <ColAct />
          </ItemsHead>
          {items.map((it) => (
            <ItemRow key={it.key}>
              <ColDesc>
                <Input value={it.description} onChange={(e) => patchRow(it.key, { description: e.target.value })}
                  placeholder={t('editor.items.descriptionPlaceholder') as string} />
              </ColDesc>
              <ColQty>
                <NumInput type="number" min={0} step="0.5" value={it.quantity}
                  onChange={(e) => patchRow(it.key, { quantity: Number(e.target.value) })} />
              </ColQty>
              <ColPrice>
                <NumInput type="number" min={0} step="1000" value={it.unit_price}
                  onChange={(e) => patchRow(it.key, { unit_price: Number(e.target.value) })} />
              </ColPrice>
              <ColSub>
                <SubText>{formatMoney(it.quantity * it.unit_price, currency)}</SubText>
              </ColSub>
              <ColAct>
                <RemoveBtn type="button" onClick={() => removeRow(it.key)} disabled={items.length === 1} aria-label={t('editor.items.remove') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </RemoveBtn>
              </ColAct>
            </ItemRow>
          ))}
        </Card>

        <BottomRow>
          <Card>
            <Field>
              <Label>{t('editor.paymentTerms')}</Label>
              <TextArea rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder={t('editor.paymentTermsPlaceholder') as string} />
            </Field>
            <Field>
              <Label>{t('editor.notes')}</Label>
              <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={t('editor.notesPlaceholder') as string} />
            </Field>
          </Card>

          <TotalsCard>
            <TotalRow>
              <TotalLabel>{t('editor.totals.subtotal')}</TotalLabel>
              <TotalValue>{formatMoney(totals.subtotal, currency)}</TotalValue>
            </TotalRow>
            <TotalRow>
              <TotalLabel>
                {t('editor.totals.vat')}
                <VatRateInput
                  type="number" step="0.01" min={0} max={1}
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  aria-label={t('editor.totals.vatRate') as string}
                />
              </TotalLabel>
              <TotalValue>{formatMoney(totals.vat, currency)}</TotalValue>
            </TotalRow>
            <TotalRowFinal>
              <TotalLabelFinal>{t('editor.totals.total')}</TotalLabelFinal>
              <TotalValueFinal>{formatMoney(totals.total, currency)}</TotalValueFinal>
            </TotalRowFinal>
          </TotalsCard>
        </BottomRow>
      </Body>
    </>
  );
}

const Topbar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0 16px;
  flex-wrap: wrap;
`;
const BackBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid #E2E8F0;
  color: #475569;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  &:hover { border-color: #0D9488; color: #0F766E; }
`;
const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
`;
const QuoteNumber = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: #64748B;
`;
const StatusPill = styled.span`
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
`;
const Spacer = styled.div` flex: 1; `;
const Primary = styled.button`
  padding: 8px 14px;
  background: #0D9488;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  height: 32px;
  &:disabled { background: #94A3B8; cursor: not-allowed; }
  &:not(:disabled):hover { background: #0F766E; }
`;
const Secondary = styled.button`
  padding: 8px 14px;
  background: #fff;
  color: #475569;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  height: 32px;
  &:hover { border-color: #0D9488; color: #0F766E; }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
const Card = styled.div`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
`;
const Row2 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`;
const Row3 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`;
const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
`;
const Label = styled.span`
  color: #475569;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;
const Input = styled.input`
  padding: 8px 10px;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
  color: #0F172A;
  &:focus { outline: none; border-color: #0D9488; box-shadow: 0 0 0 2px #CCFBF1; }
`;
const NumInput = styled(Input)` text-align: right; `;
const TextArea = styled.textarea`
  padding: 8px 10px;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
  color: #0F172A;
  font-family: inherit;
  resize: vertical;
  min-height: 36px;
  &:focus { outline: none; border-color: #0D9488; box-shadow: 0 0 0 2px #CCFBF1; }
`;

const SectionRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
`;
const SectionTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const AddRowBtn = styled.button`
  padding: 6px 12px;
  background: #fff;
  color: #0F766E;
  border: 1px dashed #0D9488;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #F0FDFA; }
`;
const ItemsHead = styled.div`
  display: flex; gap: 10px; align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 8px;
`;
const ItemRow = styled.div`
  display: flex; gap: 10px; align-items: center;
  padding: 6px 0;
`;
const ColDesc = styled.div` flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 2px; `;
const ColQty = styled.div` width: 80px; `;
const ColPrice = styled.div` width: 130px; `;
const ColSub = styled.div` width: 130px; text-align: right; `;
const ColAct = styled.div` width: 28px; display: flex; justify-content: center; `;
const SubText = styled.span`
  font-size: 13px; color: #0F172A; font-weight: 600;
`;
const RemoveBtn = styled.button`
  width: 28px; height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #94A3B8;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover:not(:disabled) { background: #FEE2E2; color: #B91C1C; }
  &:disabled { opacity: 0.3; cursor: not-allowed; }
`;

const BottomRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 12px;
  align-items: start;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const TotalsCard = styled.div`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
`;
const TotalRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
`;
const TotalLabel = styled.div`
  color: #475569;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;
const TotalValue = styled.div`
  color: #0F172A;
  font-weight: 600;
`;
const TotalRowFinal = styled(TotalRow)`
  border-top: 1px solid #E2E8F0;
  padding-top: 10px;
  margin-top: 6px;
`;
const TotalLabelFinal = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #0F172A;
`;
const TotalValueFinal = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: #0F766E;
  letter-spacing: -0.3px;
`;
const VatRateInput = styled.input`
  width: 60px;
  padding: 2px 6px;
  border: 1px solid #CBD5E1;
  border-radius: 4px;
  font-size: 11px;
  text-align: right;
  &:focus { outline: none; border-color: #0D9488; }
`;
