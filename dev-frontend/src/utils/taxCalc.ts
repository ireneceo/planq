// 세금(세율·세금 포함/별도) 화면 계산 — 서버 dev-backend/services/taxCalc.js 와 **같은 식** (2026-10-24, docs/TAX_SETTINGS_DESIGN.md §5).
//   검산 scripts/check-tax-calc.js 가 두 쪽을 같은 사례로 돌려 대조한다. 한쪽만 고치지 않는다.
//   저장 단위: 정기구독 vat_rate 만 퍼센트(10), 나머지는 분수(0.1). 화면은 언제나 % 로 보여 주고 받는다.
import { roundMoney, currencyDecimals } from '../services/invoices';

export type TaxMode = 'exclusive' | 'inclusive';
export const TAX_MODES: TaxMode[] = ['exclusive', 'inclusive'];

export function percentToFraction(p: number | string | null | undefined): number { return Math.round(Number(p || 0) * 100) / 10000; }
export function fractionToPercent(f: number | string | null | undefined): number { return Math.round(Number(f || 0) * 10000) / 100; }

/** % 입력 검사 — 0~100, 소수 2자리까지. 통과면 숫자, 아니면 null */
export function parseRatePercent(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return null;
  return Math.round(n * 100) / 100;
}

/** 분수 세율 → «8.25%» · «10%» (정수로 자르지 않는다) */
export function formatRate(fraction: number | string | null | undefined): string {
  return `${fractionToPercent(fraction)}%`;
}

export function splitTax({ amount, rate, mode = 'exclusive', currency = 'KRW' }: {
  amount: number | string; rate: number | string; mode?: TaxMode | string | null; currency?: string | null;
}): { subtotal: number; tax: number; total: number } {
  const r = Number(rate) || 0;
  if (mode === 'inclusive') {
    const total = roundMoney(amount, currency);
    const subtotal = roundMoney(total / (1 + r), currency);
    const tax = roundMoney(total - subtotal, currency);
    return { subtotal, tax, total };
  }
  const subtotal = roundMoney(amount, currency);
  const tax = roundMoney(subtotal * r, currency);
  return { subtotal, tax, total: roundMoney(subtotal + tax, currency) };
}

/** 합계를 항목에 큰 나머지 방식으로 나눈다 — 몫의 합 = total (서버 allocate 와 같다) */
export function allocate(total: number, weights: number[], currency: string = 'KRW'): number[] {
  const f = 10 ** currencyDecimals(currency);
  const units = Math.round(Number(total || 0) * f);
  const ws = weights.map((w) => Math.max(0, Number(w) || 0));
  const sum = ws.reduce((s, w) => s + w, 0);
  if (!ws.length) return [];
  if (sum <= 0) return ws.map((_, i) => (i === ws.length - 1 ? units / f : 0));
  const raw = ws.map((w) => (units * w) / sum);
  const base = raw.map((x) => Math.floor(x));
  let left = units - base.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as [number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k][1]] += 1;
  return base.map((u) => u / f);
}

/** 금액 옆 꼬리표 키 — 세액 0 이면 «없음», 아니면 기준. i18n 은 qbill `tax.tag.*` */
export function taxTagKey(tax: number | string | null | undefined, mode: TaxMode | string | null | undefined): 'none' | 'included' | 'excluded' {
  if (!(Number(tax) > 0)) return 'none';
  return mode === 'inclusive' ? 'included' : 'excluded';
}

/** 워크스페이스 «세금 받기» — 값이 없으면 켬(옛 응답). 0/false 만 끔 */
export function isTaxEnabled(v: boolean | number | null | undefined): boolean {
  return !(v === false || v === 0);
}
