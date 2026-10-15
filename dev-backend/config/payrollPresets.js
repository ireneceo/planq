// 급여 항목 기본 틀(프리셋) — docs/PAYROLL_DESIGN.md §7.1
//   ★ 요율 숫자를 담지 않는다. 법정 공제(4대보험·소득세·지방소득세·정산분)는 calc 'external' — 세무사 대장 값이 정답이고
//     요율·세액표는 매년 바뀐다(코드에 박으면 해마다 틀어지고 책임이 우리에게 온다).
//   ★ 예외는 «구조» 가 법으로 정해진 단순 정률 하나 — 프리랜서 사업소득 원천징수 3% + 지방소득세(그 10%). 10원 미만 절사.
//   이름은 화면에 그대로 보인다(사람이 바꿀 수 있다). aliases 는 세무사 대장 머리글 매칭용.
//   code 는 워크스페이스 안에서 안정 키 — 이미 있으면 프리셋을 다시 불러와도 건너뛴다(멱등).

const ext = (code, name, nameEn, aliases, extra = {}) => ({
  code, name, name_en: nameEn, side: 'deduction', applies_to: 'employment', taxable: false, calc: 'external',
  is_statutory: true, rounding: 'floor', rounding_unit: 10, aliases, ...extra,
});

const PRESETS = {
  'KR-employee': {
    label: { ko: '한국 · 직원(근로소득)', en: 'Korea · Employees' },
    country: 'KR',
    items: [
      { code: 'base', name: '기본급', name_en: 'Base pay', side: 'earning', applies_to: 'all', taxable: true, calc: 'fixed', aliases: ['기본급', '기본 급여', '기본급여'] },
      { code: 'meal', name: '식대', name_en: 'Meal allowance', side: 'earning', applies_to: 'employment', taxable: false, calc: 'fixed', aliases: ['식대', '식대보조', '중식대'] },
      { code: 'car', name: '자가운전보조금', name_en: 'Car allowance', side: 'earning', applies_to: 'employment', taxable: false, calc: 'fixed', aliases: ['자가운전보조금', '차량유지비', '자가운전'] },
      { code: 'overtime', name: '연장근로수당', name_en: 'Overtime pay', side: 'earning', applies_to: 'employment', taxable: true, calc: 'manual', aliases: ['연장근로수당', '연장수당', '시간외수당'] },
      { code: 'bonus', name: '상여금', name_en: 'Bonus', side: 'earning', applies_to: 'employment', taxable: true, calc: 'manual', aliases: ['상여금', '상여', '성과급'] },
      ext('np', '국민연금', 'National pension', ['국민연금', '국민연금료']),
      ext('hi', '건강보험', 'Health insurance', ['건강보험', '건강보험료']),
      ext('ltc', '장기요양보험', 'Long-term care', ['장기요양보험', '장기요양보험료', '장기요양']),
      ext('ei', '고용보험', 'Employment insurance', ['고용보험', '고용보험료']),
      ext('income_tax', '소득세', 'Income tax', ['소득세', '근로소득세', '갑근세']),
      ext('local_tax', '지방소득세', 'Local income tax', ['지방소득세', '주민세']),
      ext('hi_settle', '건강보험 정산분', 'Health insurance settlement', ['건강보험정산', '건강보험 정산', '건강보험정산분', '건강보험료정산'], { is_settlement: true }),
      ext('ltc_settle', '장기요양 정산분', 'Long-term care settlement', ['장기요양정산', '장기요양보험정산', '장기요양 정산분'], { is_settlement: true }),
      ext('ei_settle', '고용보험 정산분', 'Employment insurance settlement', ['고용보험정산', '고용보험 정산분'], { is_settlement: true }),
      ext('np_support', '두루누리 지원', 'Duru-nuri support', ['두루누리', '두루누리지원', '국민연금지원'], { sign: 'minus' }),
      { code: 'unpaid_leave', name: '무급휴가 공제', name_en: 'Unpaid leave', side: 'deduction', applies_to: 'employment', taxable: false, calc: 'unpaid_leave', rounding: 'round', rounding_unit: 1, aliases: ['무급휴가', '결근공제', '무급휴가공제'] },
    ],
  },
  'KR-freelance': {
    label: { ko: '한국 · 프리랜서(사업소득 3.3%)', en: 'Korea · Freelancers (3.3%)' },
    country: 'KR',
    items: [
      { code: 'fee', name: '보수', name_en: 'Fee', side: 'earning', applies_to: 'business', taxable: true, calc: 'fixed', aliases: ['보수', '지급액', '용역비', '사업소득'] },
      // 3% · 그 10% — 법이 정한 «구조». rate_base 'item' 은 저장 때 code → id 로 바뀐다(services/payrollItems.applyPreset)
      { code: 'biz_income_tax', name: '사업소득세(3%)', name_en: 'Business income tax (3%)', side: 'deduction', applies_to: 'business', taxable: false, calc: 'rate', rate: 0.03, rate_base: 'gross_total', rounding: 'floor', rounding_unit: 10, aliases: ['사업소득세', '소득세'] },
      { code: 'biz_local_tax', name: '지방소득세(0.3%)', name_en: 'Local income tax (0.3%)', side: 'deduction', applies_to: 'business', taxable: false, calc: 'rate', rate: 0.1, rate_base: 'item', base_code: 'biz_income_tax', rounding: 'floor', rounding_unit: 10, aliases: ['지방소득세', '주민세'] },
    ],
  },
  generic: {
    label: { ko: '기본(나라 무관)', en: 'Generic' },
    country: null,
    items: [
      { code: 'base', name: '기본급', name_en: 'Base pay', side: 'earning', applies_to: 'all', taxable: true, calc: 'fixed', aliases: ['기본급', 'Base pay', 'Basic salary'] },
      { code: 'allowance', name: '수당', name_en: 'Allowance', side: 'earning', applies_to: 'all', taxable: true, calc: 'manual', aliases: ['수당', 'Allowance'] },
      { code: 'tax', name: '소득세', name_en: 'Income tax', side: 'deduction', applies_to: 'all', taxable: false, calc: 'external', is_statutory: true, aliases: ['소득세', 'Income tax', 'Tax'] },
      { code: 'other_deduction', name: '기타공제', name_en: 'Other deduction', side: 'deduction', applies_to: 'all', taxable: false, calc: 'manual', aliases: ['기타공제', 'Other deduction'] },
    ],
  },
};

module.exports = { PRESETS, PRESET_KEYS: Object.keys(PRESETS) };
