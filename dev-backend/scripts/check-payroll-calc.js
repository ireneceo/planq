// 급여 계산 검산 — docs/PAYROLL_DESIGN.md §6 의 사례를 그대로 돌린다(DB 없음, 몇 ms).
//   사례 A(정규·법정 공제는 대장 값) · 사례 B(프리랜서 3.3%) · 무급휴가 일할 · 반올림 경계(300·0·음수) · 정률 순환.
//   사용: node scripts/check-payroll-calc.js   (실패하면 exit 1)
const C = require('../services/payrollCalc');

let fail = 0, pass = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ── 사례 A — 정규직(KRW). 법정 항목은 external(초안 NULL) → 대장 값으로 확정
const A = [
  { id: 1, code: 'base', side: 'earning', taxable: true, calc: 'fixed' },
  { id: 2, code: 'meal', side: 'earning', taxable: false, calc: 'fixed' },
  { id: 3, code: 'np', side: 'deduction', calc: 'external', is_statutory: true },
  { id: 4, code: 'hi', side: 'deduction', calc: 'external' },
  { id: 5, code: 'ltc', side: 'deduction', calc: 'external' },
  { id: 6, code: 'ei', side: 'deduction', calc: 'external' },
  { id: 7, code: 'it', side: 'deduction', calc: 'external' },
  { id: 8, code: 'lit', side: 'deduction', calc: 'external' },
  { id: 9, code: 'hi_settle', side: 'deduction', calc: 'external', is_settlement: true },
  { id: 10, code: 'duru', side: 'deduction', calc: 'external', sign: 'minus' },
  { id: 11, code: 'unpaid', side: 'deduction', calc: 'unpaid_leave' },
];
const dA = C.draftAmounts({ items: A, inputs: { 1: 3000000, 2: 200000 }, weeklyWorkDays: 5 });
eq('A 초안 기본급', dA.amounts[1], 3000000);
eq('A 초안 국민연금 = NULL(—)', dA.amounts[3], null);
eq('외부 값은 반올림하지 않는다(대장 13,775 그대로)', C.draftAmounts({ items: [{ id: 5, side: 'deduction', calc: 'external', rounding: 'floor', rounding_unit: 10 }], inputs: { 5: 13775 } }).amounts[5], 13775);
const tA0 = C.totals(A, dA.amounts);
eq('A 초안 지급합계', tA0.gross_total, 3200000);
eq('A 초안 공제합계 = NULL(빈칸이 있으면 모른다)', tA0.deduction_total, null);
eq('A 초안 차인 = NULL', tA0.net_total, null);
const finalA = { ...dA.amounts, 3: 135000, 4: 106350, 5: 13770, 6: 27000, 7: 56120, 8: 5610, 9: 12340, 10: 0 };
const tA = C.totals(A, finalA);
eq('A 공제합계 356,190', tA.deduction_total, 356190);
eq('A 차인 2,843,810', tA.net_total, 2843810);
eq('A 과세 3,000,000', tA.taxable_total, 3000000);
eq('A 비과세 200,000', tA.nontaxable_total, 200000);
eq('A 두루누리 minus 10,000 → 공제 346,190', C.totals(A, { ...finalA, 10: 10000 }).deduction_total, 346190);

// ── 사례 B — 프리랜서 3.3%(소득세 3% 10원 절사 · 지방소득세 = 소득세의 10% 10원 절사)
const B = [
  { id: 21, code: 'fee', side: 'earning', taxable: true, calc: 'fixed' },
  { id: 22, code: 'biz_income_tax', side: 'deduction', calc: 'rate', rate: '0.03000', rate_base: 'gross_total', rounding: 'floor', rounding_unit: 10 },
  { id: 23, code: 'biz_local_tax', side: 'deduction', calc: 'rate', rate: '0.10000', rate_base: 'item', base_item_id: 22, rounding: 'floor', rounding_unit: 10 },
];
const runB = (fee) => { const d = C.draftAmounts({ items: B, inputs: { 21: fee } }); return { a: d.amounts, t: C.totals(B, d.amounts) }; };
let b = runB(1234567);
eq('B 소득세 37,030', b.a[22], 37030); eq('B 지방 3,700', b.a[23], 3700);
eq('B 공제 40,730', b.t.deduction_total, 40730); eq('B 차인 1,193,837', b.t.net_total, 1193837);
b = runB(2000000);
eq('B 2,000,000 → 60,000 · 6,000 · 1,934,000', [b.a[22], b.a[23], b.t.net_total], [60000, 6000, 1934000]);
b = runB(300);
eq('B 경계 300 → 0 · 0 · 300', [b.a[22], b.a[23], b.t.net_total], [0, 0, 300]);
b = runB(0);
eq('B 경계 0 → 전부 0', [b.a[22], b.a[23], b.t.net_total], [0, 0, 0]);
b = runB(-1234567);   // 정정 회차 음수 차액 — 절사는 0 쪽으로
eq('B 음수 -1,234,567 → -37,030 · -3,700 · -1,193,837', [b.a[22], b.a[23], b.t.net_total], [-37030, -3700, -1193837]);
// 정의 순서가 거꾸로여도 같은 값(지방소득세가 소득세보다 앞에 정의)
const Brev = [B[0], B[2], B[1]];
eq('B 순서 무관', C.draftAmounts({ items: Brev, inputs: { 21: 1234567 } }).amounts[23], 3700);

// ── 무급휴가 일할 §6.4 — 3,000,000 × 일수 ÷ (5 × 52 ÷ 12)
const L = (days, weekly = 5) => C.draftAmounts({ items: A, inputs: { 1: 3000000, 2: 200000 }, unpaidLeaveDays: days, weeklyWorkDays: weekly });
eq('무급 2일 → 276,923', L(2).amounts[11], 276923);
eq('반차 0.5일 → 69,231', L(0.5).amounts[11], 69231);
eq('무급 0일 → 0', L(0).amounts[11], 0);
eq('근무일 0 → NULL + 경고', [L(2, 0).amounts[11], L(2, 0).warnings], [null, ['unpaid_leave_no_workdays']]);
eq('무급 2일 지급합계는 그대로', C.totals(A, { ...L(2).amounts, ...{ 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 } }).gross_total, 3200000);
eq('무급 2일 공제합계 +276,923', C.totals(A, { ...L(2).amounts, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 }).deduction_total, 276923);

// ── 반올림 단위·통화
eq('round 10 (37,035 → 37,040)', C.roundMoney(37035, 'round', 10), 37040);
eq('ceil 100', C.roundMoney(37001, 'ceil', 100), 37100);
eq('USD 소수 2자리', C.roundMoney(12.345, 'round', 1, 'USD'), 12.35);
eq('USD floor', C.roundMoney(12.349, 'floor', 1, 'USD'), 12.34);
eq('부동소수 0.1+0.2', C.roundMoney(0.1 + 0.2, 'floor', 1, 'USD'), 0.3);

// ── 정률 순환
const cyc = [
  { id: 31, side: 'deduction', calc: 'rate', rate: 0.1, rate_base: 'item', base_item_id: 32 },
  { id: 32, side: 'deduction', calc: 'rate', rate: 0.1, rate_base: 'item', base_item_id: 31 },
];
eq('순환 찾기', C.findRateCycle(cyc).sort(), [31, 32]);
eq('순환 없음', C.findRateCycle(B), []);
eq('합계 제외(in_total false)는 합계에 안 들어감', C.totals([{ id: 1, side: 'earning', calc: 'fixed' }, { id: 2, side: 'earning', calc: 'manual', in_total: false }], { 1: 100, 2: null }).gross_total, 100);

eq('직접 입력 칸이 비어도 지급합계는 나온다(상여 없음)', C.totals([{ id: 1, side: 'earning', calc: 'fixed' }, { id: 2, side: 'earning', calc: 'manual' }], { 1: 100, 2: null }).gross_total, 100);
eq('외부 칸이 비면 그 편 합계는 모름', C.totals([{ id: 1, side: 'deduction', calc: 'external' }, { id: 2, side: 'deduction', calc: 'fixed' }], { 1: null, 2: 5 }).deduction_total, null);

eq('빈 직접 입력 지급이 있어도 정률은 계산된다', C.draftAmounts({ items: [...B, { id: 24, side: 'earning', calc: 'manual' }], inputs: { 21: 1234567 } }).amounts[22], 37030);

console.log(`payrollCalc 검산 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
