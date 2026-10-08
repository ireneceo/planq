// services/money.js — 금액 반올림의 단일 원천 (docs/FIX_0AB_MONEY_DESIGN.md B-①).
//   KRW·JPY 등 무소수점 통화는 0자리, 그 외 2자리. 쓰기 시점에 이 함수 한 곳에서만 반올림한다.
//   Stripe unit_amount(최소단위) 변환도 같은 표를 쓴다 — 표가 두 벌이면 갈라진다.
const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'CLP', 'KMF', 'XOF', 'XAF', 'BIF', 'DJF', 'GNF', 'PYG', 'RWF', 'UGX', 'VUV', 'XPF']);

function decimalsOf(currency) {
  return ZERO_DECIMAL.has(String(currency || 'KRW').toUpperCase()) ? 0 : 2;
}

function roundMoney(n, currency) {
  const f = 10 ** decimalsOf(currency);
  return Math.round((Number(n) || 0) * f) / f;
}

// Stripe unit_amount — USD 109.99 → 10999, KRW 9999 → 9999
function toMinorUnits(n, currency) {
  return Math.round(roundMoney(n, currency) * 10 ** decimalsOf(currency));
}

module.exports = { ZERO_DECIMAL, decimalsOf, roundMoney, toMinorUnits };
