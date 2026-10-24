// services/taxCalc.js — 세금(세율·세금 포함/별도) 계산의 단일 원천 (2026-10-24, docs/TAX_SETTINGS_DESIGN.md §5 Fable 판정).
//   화면 dev-frontend/src/utils/taxCalc.ts 가 같은 식을 쓴다 — 검산 scripts/check-tax-calc.js 가 둘을 같은 사례로 돌린다.
//
//   ★ 저장 단위는 그대로다(Fable 결정 2): client_subscriptions.vat_rate 만 **퍼센트(10)**, 나머지(businesses·invoices·
//     post_billing_terms·projects.monthly_vat_rate)는 **분수(0.1)**. 단위를 넘나드는 곳은 percentToFraction/fractionToPercent 만 쓴다.
//   ★ 세금 별도(exclusive)는 옛 식과 **글자 그대로 같다**(`roundMoney(sub × rate)`) — 정수 비율 등으로 바꾸면 .5 경계에서 옛 청구와 1원이 달라진다.
//   ★ 세금 포함(inclusive)은 **합계에서 한 번** 역산한다(항목별로 하지 않는다). 합계 = 적은 금액, 반올림 차는 세액이 흡수.
const { roundMoney, decimalsOf } = require('./money');

const TAX_MODES = ['exclusive', 'inclusive'];

/** 분수 세율 검사 — 0~1, 소수 4자리(= % 소수 2자리)까지. 통과면 숫자, 아니면 null */
function parseRateFraction(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  if (Math.abs(Math.round(n * 10000) - n * 10000) > 1e-6) return null;
  return Math.round(n * 10000) / 10000;
}

/** 퍼센트 세율 검사 — 0~100, 소수 2자리까지 */
function parseRatePercent(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return null;
  return Math.round(n * 100) / 100;
}

function percentToFraction(p) { return Math.round(Number(p || 0) * 100) / 10000; }
function fractionToPercent(f) { return Math.round(Number(f || 0) * 10000) / 100; }

/** 'exclusive' | 'inclusive' 이면 그 값, 아니면 null(→ 400) */
function parseTaxMode(v) { return TAX_MODES.includes(v) ? v : null; }

/** 워크스페이스 기본 — 새로 만드는 구독·청구서·월정액·청구 조건의 세율(분수)·기준. 세금 끔이면 세율 0 */
function workspaceTaxDefaults(business) {
  const enabled = !business || business.tax_enabled === undefined || business.tax_enabled === null ? true : !!business.tax_enabled;
  const raw = business ? business.default_vat_rate : null;
  const rate = enabled ? Number(raw ?? 0.1) : 0;
  const mode = business && TAX_MODES.includes(business.default_tax_mode) ? business.default_tax_mode : 'exclusive';
  return { enabled, rate, mode };
}

/**
 * 금액 하나를 공급가·세액·합계로 나눈다.
 * @param {{amount:number, rate:number, mode?:'exclusive'|'inclusive', currency?:string}} a  rate 는 분수(0.1)
 */
function splitTax({ amount, rate, mode = 'exclusive', currency = 'KRW' }) {
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

/**
 * 합계(공급가·세액)를 항목·회차에 나눈다 — 큰 나머지 방식. 몫의 합이 정확히 total 과 같다.
 *   weights 는 항목 금액(같은 통화). 세금 포함 청구서의 «항목별 공급가·세액»(세금계산서 데이터)에 쓴다.
 */
function allocate(total, weights, currency = 'KRW') {
  const f = 10 ** decimalsOf(currency);
  const units = Math.round(Number(total || 0) * f);
  const ws = weights.map((w) => Math.max(0, Number(w) || 0));
  const sum = ws.reduce((s, w) => s + w, 0);
  if (!ws.length) return [];
  if (sum <= 0) return ws.map((_, i) => (i === ws.length - 1 ? units / f : 0));
  const raw = ws.map((w) => (units * w) / sum);
  const base = raw.map((x) => Math.floor(x));
  let left = units - base.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k][1]] += 1;
  return base.map((u) => u / f);
}

module.exports = {
  TAX_MODES, parseRateFraction, parseRatePercent, percentToFraction, fractionToPercent, parseTaxMode,
  workspaceTaxDefaults, splitTax, allocate,
};
