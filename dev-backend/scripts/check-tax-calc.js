// 세금 계산 검산 — docs/TAX_SETTINGS_DESIGN.md §4·§5(Fable 추가 사례)를 그대로 돌린다(DB 없음).
//   서버 services/taxCalc.js 와 화면 dev-frontend/src/utils/taxCalc.ts 를 **같은 사례**로 돌려 서로 대조하고,
//   세금 별도(exclusive)는 옛 식(roundMoney(sub × rate))과 무작위·.5 경계 사례로 대조한다(회귀 0).
//   사용: node scripts/check-tax-calc.js   (실패하면 exit 1)
const fs = require('fs');
const path = require('path');
const ts = require('../../dev-frontend/node_modules/typescript');
const S = require('../services/taxCalc');
const { roundMoney } = require('../services/money');

// 화면 쪽 — utils/taxCalc.ts 를 그대로 옮겨 읽고, 그 파일이 가져오는 roundMoney·currencyDecimals 는 services/invoices.ts 의 실제 정의를 쓴다
function loadFront() {
  const FE = path.join(__dirname, '../../dev-frontend/src');
  const inv = fs.readFileSync(path.join(FE, 'services/invoices.ts'), 'utf8');
  const pick = (re) => { const m = inv.match(re); if (!m) throw new Error('invoices.ts 에서 못 찾음: ' + re); return m[0]; };
  const money = [
    pick(/const ZERO_DECIMAL_CURRENCIES = [^\n]+/),
    pick(/export function currencyDecimals[\s\S]*?\n}\n/),
    pick(/export function roundMoney[\s\S]*?\n}\n/),
  ].join('\n');
  const toJs = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const moneyMod = { exports: {} };
  new Function('module', 'exports', toJs(money))(moneyMod, moneyMod.exports);
  const src = fs.readFileSync(path.join(FE, 'utils/taxCalc.ts'), 'utf8');
  const mod = { exports: {} };
  const req = (p) => { if (p === '../services/invoices') return moneyMod.exports; throw new Error('예상 밖 import ' + p); };
  new Function('module', 'exports', 'require', toJs(src))(mod, mod.exports, req);
  return mod.exports;
}
const F = loadFront();

let fail = 0; let pass = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const both = (name, args, want) => {
  eq(`${name} [서버]`, S.splitTax(args), want);
  eq(`${name} [화면]`, F.splitTax(args), want);
};
const oldExclusive = (amount, rate, cur) => { const sub = roundMoney(amount, cur); const tax = roundMoney(sub * rate, cur); return { subtotal: sub, tax, total: roundMoney(sub + tax, cur) }; };

// ── 정해 둔 사례
both('KRW 별도 10,000@10%', { amount: 10000, rate: 0.1, mode: 'exclusive', currency: 'KRW' }, { subtotal: 10000, tax: 1000, total: 11000 });
both('KRW 포함 11,000@10%', { amount: 11000, rate: 0.1, mode: 'inclusive', currency: 'KRW' }, { subtotal: 10000, tax: 1000, total: 11000 });
both('KRW 포함 33,333@10%', { amount: 33333, rate: 0.1, mode: 'inclusive', currency: 'KRW' }, { subtotal: 30303, tax: 3030, total: 33333 });
both('KRW 포함 1@10%', { amount: 1, rate: 0.1, mode: 'inclusive', currency: 'KRW' }, { subtotal: 1, tax: 0, total: 1 });
both('USD 포함 99.99@8.25%', { amount: 99.99, rate: 0.0825, mode: 'inclusive', currency: 'USD' }, { subtotal: 92.37, tax: 7.62, total: 99.99 });
both('JPY 포함 1,100@10%', { amount: 1100, rate: 0.1, mode: 'inclusive', currency: 'JPY' }, { subtotal: 1000, tax: 100, total: 1100 });
both('0% 별도', { amount: 5000, rate: 0, mode: 'exclusive', currency: 'KRW' }, { subtotal: 5000, tax: 0, total: 5000 });
both('0% 포함', { amount: 5000, rate: 0, mode: 'inclusive', currency: 'KRW' }, { subtotal: 5000, tax: 0, total: 5000 });
both('100% 포함', { amount: 2000, rate: 1, mode: 'inclusive', currency: 'KRW' }, { subtotal: 1000, tax: 1000, total: 2000 });
both('포함 + 항목 3,333×3 (합계 한 번 역산)', { amount: 9999, rate: 0.1, mode: 'inclusive', currency: 'KRW' }, { subtotal: 9090, tax: 909, total: 9999 });

// ── 별도 = 옛 식 (.5 경계 일부러)
const edge = [
  [15, 0.1, 'KRW'], [25, 0.1, 'KRW'], [105, 0.1, 'KRW'], [12345, 0.1, 'KRW'], [995, 0.07, 'KRW'],
  [10.05, 0.1, 'USD'], [0.15, 0.1, 'USD'], [10.05, 0.0825, 'USD'], [0.15, 0.0825, 'USD'], [1234.5, 0.0001, 'USD'],
  [3.3, 0.07, 'EUR'], [99.95, 0.0825, 'USD'], [1, 0.0001, 'KRW'],
];
for (const [a, r, c] of edge) both(`별도=옛 식 ${c} ${a}@${r}`, { amount: a, rate: r, mode: 'exclusive', currency: c }, oldExclusive(a, r, c));
let seed = 20261024;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rates = [0, 0.05, 0.07, 0.08, 0.0825, 0.1, 0.19, 0.2, 0.0001];
let randFail = 0;
for (let i = 0; i < 1000; i++) {
  const cur = ['KRW', 'USD', 'JPY', 'EUR'][i % 4];
  const amt = cur === 'KRW' || cur === 'JPY' ? Math.floor(rnd() * 10000000) : Math.round(rnd() * 1000000) / 100;
  const r = rates[Math.floor(rnd() * rates.length)];
  const args = { amount: amt, rate: r, mode: 'exclusive', currency: cur };
  const want = JSON.stringify(oldExclusive(amt, r, cur));
  if (JSON.stringify(S.splitTax(args)) !== want || JSON.stringify(F.splitTax(args)) !== want) randFail++;
  // 포함 쪽 성질: 합계 = 입력 · 공급가 + 세액 = 합계 · 서버 = 화면
  const inc = { amount: amt, rate: r, mode: 'inclusive', currency: cur };
  const si = S.splitTax(inc); const fi = F.splitTax(inc);
  if (si.total !== roundMoney(amt, cur) || roundMoney(si.subtotal + si.tax, cur) !== si.total || JSON.stringify(si) !== JSON.stringify(fi)) randFail++;
}
eq('무작위 1,000건 — 별도=옛 식 · 포함 합계 보존 · 서버=화면', randFail, 0);

// ── 큰 나머지 배분
eq('배분 9,090 → 3,333×3', S.allocate(9090, [3333, 3333, 3333], 'KRW'), [3030, 3030, 3030]);
eq('배분 909 → 3,333×3 (합 909)', S.allocate(909, [3333, 3333, 3333], 'KRW'), [303, 303, 303]);
eq('배분 1,000 → 3칸 같은 무게', S.allocate(1000, [1, 1, 1], 'KRW'), [334, 333, 333]);
eq('배분 USD 7.62 → 2:1', S.allocate(7.62, [2, 1], 'USD'), [5.08, 2.54]);
eq('배분 화면=서버', F.allocate(1000, [1, 1, 1], 'KRW'), S.allocate(1000, [1, 1, 1], 'KRW'));
eq('배분 무게 0 → 마지막', S.allocate(10, [0, 0], 'KRW'), [0, 10]);

// ── 분할 33/33/34 (포함 합계 = 회차 합, 회차별 공급가·세액 — 마지막 회차가 차이 흡수)
{
  const inv = S.splitTax({ amount: 100000, rate: 0.1, mode: 'inclusive', currency: 'KRW' });
  const amts = [33000, 33000, 34000];
  eq('분할 회차 합 = 합계', amts.reduce((s, x) => s + x, 0), inv.total);
  const parts = amts.map((a) => S.splitTax({ amount: a, rate: 0.1, mode: 'inclusive', currency: 'KRW' }));
  const sumSub = parts.reduce((s, p) => s + p.subtotal, 0);
  eq('회차 공급가 합 ±1', Math.abs(sumSub - inv.subtotal) <= 1, true);
}

// ── 세율 검사
eq('분수 0.1 통과', S.parseRateFraction(0.1), 0.1);
eq('분수 1 통과(100%)', S.parseRateFraction(1), 1);
eq('분수 1.01 거절', S.parseRateFraction(1.01), null);
eq('분수 0.08255 거절(8.255%)', S.parseRateFraction(0.08255), null);
eq('분수 -0.1 거절', S.parseRateFraction(-0.1), null);
eq('분수 "abc" 거절', S.parseRateFraction('abc'), null);
eq('분수 true 거절(옛: 100%)', S.parseRateFraction(true), null);
eq('퍼센트 [10] 거절', S.parseRatePercent([10]), null);
eq('퍼센트 8.25 통과', S.parseRatePercent(8.25), 8.25);
eq('퍼센트 101 거절', S.parseRatePercent(101), null);
eq('퍼센트 8.255 거절', S.parseRatePercent(8.255), null);
eq('화면 퍼센트 8.255 거절', F.parseRatePercent(8.255), null);
eq('tax_mode 이상한 값 거절', S.parseTaxMode('gross'), null);
eq('% ↔ 분수', [S.percentToFraction(8.25), S.fractionToPercent(0.0825), F.percentToFraction(10), F.fractionToPercent('0.1000')], [0.0825, 8.25, 0.1, 10]);
eq('화면 % 표시 8.25%(정수로 안 자름)', F.formatRate(0.0825), '8.25%');
eq('화면 % 표시 10%', F.formatRate('0.1000'), '10%');

// ── 워크스페이스 기본값 (0% 를 10% 로 바꾸지 않는다 — Fable 고칠 점 1·3)
eq('기본: DB 문자열 0.000 → 0', S.workspaceTaxDefaults({ default_vat_rate: '0.000', tax_enabled: true }).rate, 0);
eq('기본: 숫자 0 → 0 (옛 `|| 0.1` 이면 0.1)', S.workspaceTaxDefaults({ default_vat_rate: 0, tax_enabled: true }).rate, 0);
eq('기본: 값 없음 → 0.1', S.workspaceTaxDefaults({ default_vat_rate: null }).rate, 0.1);
eq('기본: 세금 끔 → 0', S.workspaceTaxDefaults({ default_vat_rate: '0.1000', tax_enabled: false }).rate, 0);
eq('기본: 기준 포함', S.workspaceTaxDefaults({ default_vat_rate: '0.1', default_tax_mode: 'inclusive' }).mode, 'inclusive');
eq('양성 대조군 — 옛 식 `Number(0 || 0.1)` 은 0.1', Number(0 || 0.1), 0.1);

console.log(`check-tax-calc: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
