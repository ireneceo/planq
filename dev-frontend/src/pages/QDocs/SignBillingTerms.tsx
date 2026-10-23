// 서명 화면의 «청구 조건» (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md (a)) —
//   서명이 모두 끝나면 이 금액 그대로 청구서가 만들어진다. 서명자가 무엇에 동의하는지 본문 아래에서 함께 보게 한다.
//   서버 contractBilling.publicView 가 계산한 값을 그대로 그린다(화면이 다시 계산하지 않는다 — 금액은 한 곳).
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { formatMoney, type Currency } from '../../services/invoices';
import type { PublicBillingTerms } from '../../services/billingTerms';

export default function SignBillingTerms({ terms }: { terms: PublicBillingTerms | null | undefined }) {
  const { t } = useTranslation('qdocs');
  if (!terms || !terms.items?.length) return null;
  const cur = terms.currency as Currency;
  return (
    <Box data-testid="sign-billing-terms">
      <Title>{t('publicSign.billing.title', '청구 조건 — 서명이 모두 끝나면 이 금액으로 청구됩니다')}</Title>
      <Table>
        <tbody>
          {terms.items.map((it, i) => (
            <tr key={i}>
              <Desc>
                {it.description}
                {it.detail && <Detail>{it.detail}</Detail>}
              </Desc>
              <Qty>{Number(it.quantity)} × {formatMoney(it.unit_price, cur)}</Qty>
              <Amt>{formatMoney(it.amount, cur)}</Amt>
            </tr>
          ))}
        </tbody>
      </Table>
      <Sum>
        <SumRow><span>{t('publicSign.billing.subtotal', '공급가')}</span><span>{formatMoney(terms.subtotal, cur)}</span></SumRow>
        {terms.vat_rate > 0 && (
          <SumRow><span>{t('publicSign.billing.vat', '부가세 {{p}}%', { p: Math.round(terms.vat_rate * 100) })}</span><span>{formatMoney(terms.tax_amount, cur)}</span></SumRow>
        )}
        <SumRow $strong><span>{t('publicSign.billing.total', '합계')}</span><span>{formatMoney(terms.grand_total, cur)}</span></SumRow>
      </Sum>
      {terms.installment_mode === 'split' && terms.installments.length > 0 && (
        <Rounds>
          <RoundsTitle>{t('publicSign.billing.split', '나눠서 청구')}</RoundsTitle>
          {terms.installments.map((r, i) => (
            <SumRow key={i}>
              <span>{r.label} · {r.percent}%{r.milestone_ref ? ` · ${r.milestone_ref}` : ''}{r.due_date ? ` · ${r.due_date}` : ''}</span>
              <span>{formatMoney(r.amount, cur)}</span>
            </SumRow>
          ))}
        </Rounds>
      )}
    </Box>
  );
}

const Box = styled.div`
  margin-top: 16px; padding: 14px 16px; border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC;
  display: flex; flex-direction: column; gap: 10px;
`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; line-height: 1.5;`;
const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 0.8125rem;
  td { padding: 6px 0; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
`;
const Desc = styled.td`color: #0F172A; overflow-wrap: anywhere;`;
const Detail = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 2px;`;
const Qty = styled.td`color: #64748B; white-space: nowrap; padding-left: 8px !important; text-align: right; font-variant-numeric: tabular-nums;`;
const Amt = styled.td`color: #0F172A; font-weight: 600; white-space: nowrap; padding-left: 12px !important; text-align: right; font-variant-numeric: tabular-nums;`;
const Sum = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const SumRow = styled.div<{ $strong?: boolean }>`
  display: flex; justify-content: space-between; gap: 12px; font-size: ${p => p.$strong ? '0.9375rem' : '0.8125rem'};
  font-weight: ${p => p.$strong ? 700 : 400}; color: ${p => p.$strong ? '#0F172A' : '#475569'}; font-variant-numeric: tabular-nums;
  & > span:first-child { overflow-wrap: anywhere; }
  & > span:last-child { white-space: nowrap; }
`;
const Rounds = styled.div`display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px dashed #CBD5E1;`;
const RoundsTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
