// 급여명세서 — 동결된 줄에서 그때그때 그린다 (docs/PAYROLL_DESIGN.md §5.2-4 · §9)
//   파일을 만들어 두지 않는다. 확정 때 동결한 사람 정보·항목 이름·금액(final)만 읽는다 — 이후 항목 이름이 바뀌어도 그 달 명세서는 그대로.
//   ★ 계좌번호는 없다 — «지급 계좌 ****1234» (끝 4자리 동결값)만.
//   ★ 보는 문은 둘: 본인(routes/payroll_me.js — person.user_id == 나) · 관리자(routes/payroll_runs.js — 계정 없는 사람에게 전할 PDF).
const { Business, PayItem, PayrollRun, PayrollEntry, PayrollEntryLine, PayrollPerson } = require('../models');
const { dateOnlyOf } = require('../utils/dateOnly');
const LOCKED = ['confirmed', 'paid'];
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** @returns { run, entry, business, earnings[], deductions[], notes } | null */
async function loadPayslip(businessId, entryId, { requireLocked = true } = {}) {
  const entry = await PayrollEntry.findOne({
    where: { id: entryId, business_id: businessId },
    include: [{ model: PayrollRun, as: 'run' }, { model: PayrollEntryLine, as: 'lines' }, { model: PayrollPerson, as: 'person', attributes: ['id', 'user_id'] }],
  });
  if (!entry || !entry.run) return null;
  if (requireLocked && !LOCKED.includes(entry.run.status)) return null;
  const items = await PayItem.findAll({ where: { id: entry.lines.map((l) => l.pay_item_id), business_id: businessId } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name'] });
  const lines = entry.lines
    .map((l) => ({ l, it: byId.get(l.pay_item_id) }))
    .filter((x) => x.it && x.l.final_amount !== null && (Number(x.l.final_amount) !== 0 || x.it.calc === 'fixed'))
    .sort((a, b) => (a.it.sort_order - b.it.sort_order) || (a.it.id - b.it.id))
    .map(({ l, it }) => ({
      name: l.item_name_snapshot || it.name, name_en: it.name_en, amount: num(l.final_amount),
      side: it.side, taxable: !!it.taxable, sign: it.sign, in_total: !!it.in_total, source: l.final_source, statutory: !!it.is_statutory,
    }));
  return {
    run: { id: entry.run.id, period_ym: entry.run.period_ym, seq: entry.run.seq, kind: entry.run.kind, status: entry.run.status, pay_date: entry.run.pay_date ? dateOnlyOf(entry.run.pay_date) : null, confirmed_at: entry.run.confirmed_at },
    entry: {
      id: entry.id, display_name: entry.display_name, employee_no: entry.employee_no, job_title: entry.job_title, department_name: entry.department_name,
      currency: entry.currency, gross_total: num(entry.gross_total), taxable_total: num(entry.taxable_total), nontaxable_total: num(entry.nontaxable_total),
      deduction_total: num(entry.deduction_total), net_total: num(entry.net_total), unpaid_leave_days: num(entry.unpaid_leave_days),
      bank_name: entry.bank_name_snapshot, bank_last4: entry.bank_last4, viewed_at: entry.payslip_viewed_at,
    },
    owner_user_id: entry.person?.user_id || null,
    business: { id: biz?.id, name: biz?.brand_name || biz?.name || '' },
    earnings: lines.filter((x) => x.side === 'earning'),
    deductions: lines.filter((x) => x.side === 'deduction'),
  };
}

const L = {
  ko: {
    title: '급여명세서', adj: '정정분', period: '귀속월', payDate: '지급일', name: '성명', empNo: '사번', dept: '부서', job: '직위',
    earnings: '지급 내역', deductions: '공제 내역', gross: '지급합계', deduction: '공제합계', net: '차인지급액', account: '지급 계좌',
    nontax: '비과세', unpaid: '무급휴가', days: '일',
    resp: '법정 공제(4대보험·소득세)는 세무사 급여대장 값이 기준입니다. PlanQ 가 미리 채운 금액은 대조용 예상치입니다.',
  },
  en: {
    title: 'Payslip', adj: 'Adjustment', period: 'Period', payDate: 'Pay date', name: 'Name', empNo: 'Employee no.', dept: 'Department', job: 'Title',
    earnings: 'Earnings', deductions: 'Deductions', gross: 'Gross pay', deduction: 'Total deductions', net: 'Net pay', account: 'Paid to',
    nontax: 'non-taxable', unpaid: 'Unpaid leave', days: 'days',
    resp: "Statutory deductions (social insurance, income tax) follow your tax accountant's payroll register. Amounts PlanQ pre-fills are estimates for comparison.",
  },
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n, cur, lang) {
  if (n === null || n === undefined) return '—';
  const zero = require('./payrollCalc').minorUnit(cur) === 1;
  return `${Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 })} ${esc(cur)}`;
}

function payslipHtml(d, lang = 'ko') {
  const t = L[lang] || L.ko;
  const e = d.entry;
  const nm = (x) => (lang === 'en' && x.name_en ? x.name_en : x.name);
  const rows = (arr) => arr.map((x) => `<tr><td>${esc(nm(x))}${x.side === 'earning' && !x.taxable ? ` <span class="m">(${t.nontax})</span>` : ''}${x.sign === 'minus' ? ' <span class="m">(−)</span>' : ''}</td><td class="r">${money(x.amount, e.currency, lang)}</td></tr>`).join('') || '<tr><td colspan="2" class="m">—</td></tr>';
  const meta = [
    [t.period, `${esc(d.run.period_ym)}${d.run.kind === 'adjustment' ? ` (${t.adj} ${d.run.seq - 1})` : ''}`], [t.payDate, esc(d.run.pay_date || '—')],
    [t.name, esc(e.display_name)], [t.empNo, esc(e.employee_no || '—')], [t.dept, esc(e.department_name || '—')], [t.job, esc(e.job_title || '—')],
  ];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
  body{font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#0F172A;font-size:12px;margin:32px}
  h1{font-size:20px;margin:0 0 4px} .biz{color:#475569;margin-bottom:16px}
  table{width:100%;border-collapse:collapse} td,th{padding:6px 8px;border-bottom:1px solid #E2E8F0;text-align:left}
  .meta td{border:none;padding:2px 8px 2px 0} .meta td:first-child{color:#64748B;width:90px}
  .grid{display:flex;gap:16px;margin-top:16px} .grid>div{flex:1} h2{font-size:13px;margin:0 0 6px;color:#334155}
  .r{text-align:right;font-variant-numeric:tabular-nums} .m{color:#94A3B8;font-size:11px}
  .sum td{font-weight:700;border-top:2px solid #CBD5E1} .net{margin-top:16px;padding:12px;background:#F1F5F9;border-radius:8px;display:flex;justify-content:space-between;font-size:15px;font-weight:700}
  .foot{margin-top:20px;color:#64748B;font-size:10.5px;line-height:1.5}
  </style></head><body>
  <h1>${t.title}</h1><div class="biz">${esc(d.business.name)}</div>
  <table class="meta">${meta.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
  <div class="grid">
    <div><h2>${t.earnings}</h2><table>${rows(d.earnings)}<tr class="sum"><td>${t.gross}</td><td class="r">${money(e.gross_total, e.currency, lang)}</td></tr></table></div>
    <div><h2>${t.deductions}</h2><table>${rows(d.deductions)}<tr class="sum"><td>${t.deduction}</td><td class="r">${money(e.deduction_total, e.currency, lang)}</td></tr></table></div>
  </div>
  <div class="net"><span>${t.net}</span><span>${money(e.net_total, e.currency, lang)}</span></div>
  ${e.bank_last4 ? `<div class="foot">${t.account}: ${esc(e.bank_name || '')} ****${esc(e.bank_last4)}</div>` : ''}
  ${e.unpaid_leave_days ? `<div class="foot">${t.unpaid}: ${e.unpaid_leave_days}${t.days}</div>` : ''}
  <div class="foot">${t.resp}</div>
  </body></html>`;
}

async function renderPayslipPdf(d, lang = 'ko') {
  const { renderPdfFromHtml } = require('./pdfService');
  return renderPdfFromHtml(payslipHtml(d, lang), { format: 'A4' });
}

module.exports = { loadPayslip, payslipHtml, renderPayslipPdf };
