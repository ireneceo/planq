// 세금 입력·표기 조각 — 청구서 발행 창 · 문서 «청구 조건» 창 · 고객 정기 구독 · 프로젝트 월정액 · Q bill 설정이 같이 쓴다 (2026-10-24).
//   설계 docs/TAX_SETTINGS_DESIGN.md (Fable 판정). 계산은 utils/taxCalc(서버 services/taxCalc 와 같은 식) — 여기서 식을 다시 쓰지 않는다.
//   ★ 세율은 언제나 % 로 보여 주고 받는다. 저장 단위(구독 = 퍼센트, 나머지 = 분수)는 부르는 쪽이 percent/fraction 으로 고른다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { formatMoney, type Currency } from '../../services/invoices';
import { fractionToPercent, percentToFraction, parseRatePercent, formatRate, taxTagKey, type TaxMode } from '../../utils/taxCalc';

/** 세금 이름 — 워크스페이스 설정(tax_label), 없으면 화면 언어 기본(부가세/VAT) */
export function useTaxLabel(label?: string | null): string {
  const { t } = useTranslation('qbill');
  return (label && label.trim()) || (t('tax.defaultLabel') as string);
}

/**
 * 세율 % 입력 — 0~100, 소수 둘째 자리까지. 올바른 값일 때만 onChange(분수) 를 부른다(틀린 값은 칸 아래 이유).
 *   value 는 분수(0.1). 부르는 쪽이 퍼센트로 저장하면 percentToFraction 으로 넘기고 받은 값을 fractionToPercent 로 되돌린다.
 */
export function TaxRateInput({ value, onChange, disabled, id, testId }: {
  value: number; onChange: (fraction: number) => void; disabled?: boolean; id?: string; testId?: string;
}) {
  const { t } = useTranslation('qbill');
  const [text, setText] = useState(String(fractionToPercent(value)));
  const [bad, setBad] = useState(false);
  // 밖에서 값이 바뀌면(워크스페이스 기본 불러옴·다른 청구서 열기) 칸을 맞춘다 — 입력 중 같은 값이면 건드리지 않는다
  useEffect(() => {
    if (parseRatePercent(text) !== fractionToPercent(value)) { setText(String(fractionToPercent(value))); setBad(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <RateWrap>
      <RateBox $bad={bad}>
        <RateText
          id={id} data-testid={testId} inputMode="decimal" value={text} disabled={disabled}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '');
            setText(v);
            const p = parseRatePercent(v);
            setBad(p === null);
            if (p !== null) onChange(percentToFraction(p));
          }}
        />
        <RateSuffix>{t('tax.rateSuffix')}</RateSuffix>
      </RateBox>
      {bad && <RateErr role="alert">{t('tax.rateInvalid')}</RateErr>}
    </RateWrap>
  );
}

/** 금액 기준 — 세금 별도 / 세금 포함 */
export function TaxModeSelect({ value, onChange, disabled, testId }: {
  value: TaxMode; onChange: (m: TaxMode) => void; disabled?: boolean; testId?: string;
}) {
  const { t } = useTranslation('qbill');
  const options: PlanQSelectOption[] = [
    { value: 'exclusive', label: t('tax.mode_exclusive') as string },
    { value: 'inclusive', label: t('tax.mode_inclusive') as string },
  ];
  return (
    <div data-testid={testId}>
      <PlanQSelect
        size="sm" options={options} isDisabled={disabled}
        value={options.find((o) => o.value === value) || options[0]}
        onChange={(opt) => opt && onChange((opt as PlanQSelectOption).value as TaxMode)}
      />
    </div>
  );
}

/** 금액 옆 꼬리표 — «VAT 포함» · «VAT 별도» · «VAT 없음» */
export function taxTagText(t: (k: string, o?: Record<string, unknown>) => unknown, tax: number | string | null | undefined, mode: string | null | undefined, label: string): string {
  return t(`tax.tag.${taxTagKey(tax, mode)}`, { label }) as string;
}

/** 한 줄 공식 — «공급가 ₩500,000 + VAT 10% ₩50,000 = 청구 ₩550,000» (세액 0 이면 «청구 ₩500,000 (VAT 없음)») */
export function TaxFormula({ charge, rate, currency, label, testId }: {
  charge: { subtotal: number; tax: number; total: number }; rate: number; currency: Currency | string; label: string; testId?: string;
}) {
  const { t } = useTranslation('qbill');
  const cur = currency as Currency;
  const text = charge.tax > 0
    ? t('tax.formula', { subtotal: formatMoney(charge.subtotal, cur), label, rate: formatRate(rate), tax: formatMoney(charge.tax, cur), total: formatMoney(charge.total, cur) })
    : t('tax.formulaNoTax', { total: formatMoney(charge.total, cur), label });
  return <FormulaLine data-testid={testId}>{text as string}</FormulaLine>;
}

const RateWrap = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const RateBox = styled.div<{ $bad: boolean }>`
  display: flex; align-items: center; background: #fff; border-radius: 6px;
  border: 1px solid ${(p) => (p.$bad ? '#FCA5A5' : '#E2E8F0')};
  &:focus-within { border-color: ${(p) => (p.$bad ? '#F87171' : '#14B8A6')}; box-shadow: 0 0 0 3px ${(p) => (p.$bad ? 'rgba(248,113,113,0.15)' : 'rgba(20,184,166,0.15)')}; }
`;
const RateText = styled.input`
  flex: 1; min-width: 0; padding: 7px 4px 7px 10px; font-size: 0.8125rem; color: #0F172A;
  background: transparent; border: none; border-radius: 6px; font-variant-numeric: tabular-nums;
  &:focus { outline: none; }
  &:disabled { color: #94A3B8; cursor: not-allowed; }
`;
const RateSuffix = styled.span`padding: 0 10px 0 2px; font-size: 0.8125rem; color: #64748B;`;
const RateErr = styled.div`font-size: 0.6875rem; color: #DC2626;`;
const FormulaLine = styled.div`font-size: 0.75rem; color: #475569; line-height: 1.5; font-variant-numeric: tabular-nums; overflow-wrap: anywhere;`;
