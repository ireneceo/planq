// 급여 계산 — 순수 함수 (docs/PAYROLL_DESIGN.md §6). DB 를 보지 않는다 — 검산 사례 A·B·무급휴가를 그대로 단위 검산할 수 있다.
//   초안 생성·대조 화면·확정·명세서가 **이 공식 한 벌**을 쓴다(같은 값의 공식이 두 벌이면 이미 갈라져 있다).
//
//   ★ PlanQ 는 법정 공제(4대보험·소득세·정산분)를 계산하지 않는다 — 그 항목은 calc 'external' 이고 초안 칸은 NULL(«—»).
//     NULL 은 0 이 아니다: 합계에 NULL 이 섞이면 그 편 합계도 NULL(가짜 숫자 금지 — 돈 화면에서 가장 위험).
//   ★ 반올림은 줄마다, 합계는 «반올림된 줄의 합»(대장의 합계행과 같은 방식). 합을 따로 반올림하지 않는다.
//   ★ 반올림 방향은 0 을 기준으로 한다 — floor = 절사(0 쪽으로), ceil = 올림(0 에서 멀어지는 쪽), round = 반올림(.5 는 0 에서 멀어지게).
//     정정 회차는 음수 차액을 쓰는데, «절사» 를 Math.floor 로 하면 -37.5 가 -38 이 된다(세무 관행과 반대).

/** 한 달 평균 주 수 — 무급휴가 일할 분모(주 근무일 × 52 ÷ 12)와 인건비(memberCost)가 같은 상수를 쓴다. */
const WEEKS_PER_MONTH = 52 / 12;

const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'IDR', 'CLP', 'TWD', 'HUF', 'ISK', 'UGX']);
/** 통화의 최소 단위 — 원·엔은 1, 그 외 0.01. rounding_unit 은 이 단위의 배수다(KRW 10 = 10원 · USD 1 = 1센트). */
function minorUnit(currency) { return ZERO_DECIMAL.has(String(currency || 'KRW').toUpperCase()) ? 1 : 0.01; }

const clean = (n) => Number(Number(n).toFixed(9));            // 부동소수 찌꺼기(0.1+0.2) 제거
const toMoney = (n) => Math.round(n * 100) / 100;              // DECIMAL(14,2) 에 맞춘다

/** 반올림 — mode round|floor|ceil, unit 은 최소 단위의 배수. 음수는 0 을 기준으로 대칭. */
function roundMoney(value, mode = 'round', unit = 1, currency = 'KRW') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const step = Math.max(1, Number(unit) || 1) * minorUnit(currency);
  const v = Number(value);
  const sgn = v < 0 ? -1 : 1;
  const q = clean(Math.abs(v) / step);
  let r;
  if (mode === 'floor') r = Math.floor(q);
  else if (mode === 'ceil') r = Math.ceil(q);
  else r = Math.floor(q + 0.5);
  return toMoney(sgn * r * step) || 0;   // -0 → 0
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const signOf = (it) => (it.sign === 'minus' ? -1 : 1);
const inTotal = (it) => it.in_total !== false && it.in_total !== 0;
const isTaxable = (it) => it.taxable !== false && it.taxable !== 0;

/**
 * 정률 항목의 «무엇의 몇 %» 순환 찾기 — 항목 저장 때 막는다(409 rate_cycle).
 * @returns 순환에 걸린 항목 id 배열(없으면 [])
 */
function findRateCycle(items) {
  const byId = new Map(items.map((it) => [Number(it.id), it]));
  for (const start of items) {
    if (start.calc !== 'rate' || start.rate_base !== 'item') continue;
    const seen = [Number(start.id)];
    let cur = start;
    while (cur && cur.calc === 'rate' && cur.rate_base === 'item' && cur.base_item_id) {
      const next = Number(cur.base_item_id);
      if (seen.includes(next)) return seen.slice(seen.indexOf(next));
      seen.push(next);
      cur = byId.get(next);
    }
  }
  return [];
}

/** 무급휴가 일할 — 기본급 × 무급일 ÷ (주 근무일 × 52 ÷ 12). 분모 0 이면 null(가짜 0 금지). */
function unpaidLeaveAmount(basePay, days, weeklyWorkDays) {
  const d = num(days) || 0;
  if (d === 0) return 0;
  const w = num(weeklyWorkDays);
  if (!w || w <= 0) return null;
  if (basePay === null || basePay === undefined) return null;
  // 분수 그대로 계산한다(21.6667 로 반올림한 분모를 쓰면 경계에서 1원이 갈린다)
  return (Number(basePay) * d) / (w * WEEKS_PER_MONTH);
}

/**
 * 한 사람의 초안(예상치) 금액 — 항목 정의 + 입력값 → 항목별 금액.
 *
 * @param {object} p
 * @param {Array}  p.items   항목 정의(활성·이 사람에게 해당하는 것). { id, code, side, taxable, calc, rate, rate_base, base_item_id, sign, in_total, rounding, rounding_unit }
 * @param {object} p.inputs  항목 id → 숫자|null. fixed 는 계약 금액(사람이 고쳤으면 그 값), manual·external 은 사람이 넣은 값(없으면 null).
 * @param {number} [p.unpaidLeaveDays]
 * @param {number} [p.weeklyWorkDays]
 * @param {string} [p.currency]
 * @returns {{ amounts: Object<id, number|null>, warnings: string[] }}
 */
function draftAmounts({ items, inputs = {}, unpaidLeaveDays = 0, weeklyWorkDays = null, currency = 'KRW' }) {
  const amounts = {};
  const warnings = [];
  const R = (it, v) => roundMoney(v, it.rounding || 'round', it.rounding_unit || 1, currency);
  const val = (id) => (Object.prototype.hasOwnProperty.call(inputs, id) ? num(inputs[id]) : null);

  // 1. 고정 · 직접 · 외부 — 들어온 값 그대로. ★ 반올림하지 않는다: 계약 금액·사람이 넣은 값·대장 값을 PlanQ 가 바꾸면
  //    대조가 거짓이 된다(대장 13,775 를 10원 절사로 13,770 이라 보이면 «차이» 가 우리가 만든 것이 된다). 반올림은 계산한 줄만.
  for (const it of items) {
    if (it.calc === 'fixed' || it.calc === 'manual' || it.calc === 'external') {
      const v = val(it.id);
      amounts[it.id] = v === null || !Number.isFinite(v) ? null : toMoney(v);
    }
  }
  // 2. 무급휴가 일할 — 기본급(code 'base')의 금액을 기준으로
  const base = items.find((it) => it.code === 'base');
  const basePay = base ? amounts[base.id] : null;
  for (const it of items.filter((x) => x.calc === 'unpaid_leave')) {
    const raw = unpaidLeaveAmount(basePay, unpaidLeaveDays, weeklyWorkDays);
    if (raw === null && (num(unpaidLeaveDays) || 0) > 0) warnings.push(base ? 'unpaid_leave_no_workdays' : 'unpaid_leave_no_base');
    amounts[it.id] = raw === null ? null : R(it, raw);
  }
  // 3. 정률 — 지급편 합(1·2 이후, 반올림된 줄의 합) 또는 다른 항목의 최종 금액
  const earningSum = (onlyTaxable) => {
    let s = 0;
    for (const it of items) {
      if (it.side !== 'earning' || !inTotal(it) || it.calc === 'rate') continue;
      if (onlyTaxable && !isTaxable(it)) continue;
      const a = amounts[it.id];
      if ((a === null || a === undefined) && it.calc === 'manual') continue;   // 비어 있는 «직접 입력» 은 그 달에 없는 것(totals 와 같은 규칙)
      if (a === null || a === undefined) return null;   // 지급 칸에 빈칸이 있으면 정률도 모른다
      s += a * signOf(it);
    }
    return s;
  };
  const rateItems = items.filter((it) => it.calc === 'rate');
  const done = new Set();
  const cycle = findRateCycle(items);
  for (let pass = 0; pass <= rateItems.length; pass++) {
    for (const it of rateItems) {
      if (done.has(it.id)) continue;
      if (cycle.includes(Number(it.id))) { amounts[it.id] = null; done.add(it.id); warnings.push('rate_cycle'); continue; }
      let b;
      if (it.rate_base === 'item') {
        const dep = items.find((x) => Number(x.id) === Number(it.base_item_id));
        if (!dep) { b = null; } else if (dep.calc === 'rate' && !done.has(dep.id)) continue; else b = amounts[dep.id];
      } else if (it.rate_base === 'taxable_total') b = earningSum(true);
      else b = earningSum(false);
      const rate = num(it.rate);
      amounts[it.id] = b === null || b === undefined || rate === null ? null : R(it, b * rate);
      done.add(it.id);
    }
  }
  return { amounts, warnings: [...new Set(warnings)] };
}

/**
 * 합계 — 반올림된 줄의 합. 그 편의 합계 줄에 NULL 이 하나라도 있으면 그 편 합계는 NULL(그리고 차인지급액도 NULL).
 * @param {Array} items 항목 정의
 * @param {Object<id, number|null>} amounts
 */
function totals(items, amounts) {
  let taxable = 0, nontaxable = 0, deduction = 0;
  let earnMissing = false, dedMissing = false;
  const unresolved = [];
  for (const it of items) {
    if (!inTotal(it)) continue;
    const a = num(amounts[it.id]);
    if (a === null || !Number.isFinite(a)) {
      unresolved.push(it.id);
      // «직접 입력» 항목(연장수당·상여 등)은 그 달에 없을 수도 있는 칸이다 — 비어 있으면 합계에서 뺄 뿐 합계를 «모름» 으로 만들지 않는다.
      //   (그래도 확정은 빈칸을 막는다 — 확정 검사는 unresolved 를 따로 본다. 법정·외부 칸이 비면 그 편 합계는 모름.)
      if (it.calc === 'manual') continue;
      if (it.side === 'earning') earnMissing = true; else dedMissing = true;
      continue;
    }
    const v = a * signOf(it);
    if (it.side === 'earning') { if (isTaxable(it)) taxable += v; else nontaxable += v; } else deduction += v;
  }
  const t = {
    taxable_total: earnMissing ? null : toMoney(taxable),
    nontaxable_total: earnMissing ? null : toMoney(nontaxable),
    gross_total: earnMissing ? null : toMoney(taxable + nontaxable),
    deduction_total: dedMissing ? null : toMoney(deduction),
  };
  t.net_total = t.gross_total === null || t.deduction_total === null ? null : toMoney(t.gross_total - t.deduction_total);
  return { ...t, unresolved };
}

module.exports = { WEEKS_PER_MONTH, minorUnit, roundMoney, findRateCycle, unpaidLeaveAmount, draftAmounts, totals };
