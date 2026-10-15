// 본인 급여명세서·계약 — /api/payroll/:businessId/me/… (docs/PAYROLL_DESIGN.md §4 canReadOwn* · §9 /me/payslips)
//   체인: authenticateToken → checkBusinessAccess → requireModule('payroll') — 관리자 술어는 걸지 않는다(직원 누구나 «자기 것» 만).
//   ★ 판정은 «대상자의 user_id == 나» 하나. 남의 명세서 = 403, 내 것이지만 아직 확정 전 = 404(초안은 명세서가 아니다).
//   ★ 읽기는 요금제를 보지 않는다(Pro 아래로 내려가도 명세서는 남아야 한다 — 설계 판정 9).
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { requireModule } = require('../services/modules');
const { canReadOwnContracts } = require('../services/payrollAccess');
const P = require('../services/payslip');
const { dateOnlyOf } = require('../utils/dateOnly');
const { PayrollPerson, PayrollEntry, PayrollRun, EmploymentContract, ContractPayLine, PayItem } = require('../models');

const base = [authenticateToken, checkBusinessAccess, requireModule('payroll')];
const bizIdOf = (req) => Number(req.params.businessId);
const num = (v) => (v === null || v === undefined ? null : Number(v));

async function myPerson(req) {
  return PayrollPerson.findOne({ where: { business_id: bizIdOf(req), user_id: req.user.id }, attributes: ['id', 'user_id', 'display_name'] });
}

/** 본인 판정 — 403(남의 것) / 404(없음·확정 전) / 데이터 */
async function ownPayslip(req) {
  const businessId = bizIdOf(req);
  const entry = await PayrollEntry.findOne({ where: { id: Number(req.params.entryId), business_id: businessId }, include: [{ model: PayrollPerson, as: 'person', attributes: ['user_id'] }], attributes: ['id', 'person_id'] });
  if (!entry) return { http: 404, code: 'payslip_not_found' };
  if (!entry.person || Number(entry.person.user_id) !== Number(req.user.id)) return { http: 403, code: 'payslip_forbidden' };
  const d = await P.loadPayslip(businessId, entry.id, { requireLocked: true });
  if (!d) return { http: 404, code: 'payslip_not_found' };
  return { d };
}

router.get('/:businessId/me/payslips', ...base, async (req, res, next) => {
  try {
    const person = await myPerson(req);
    if (!person) return successResponse(res, []);
    const rows = await PayrollEntry.findAll({
      where: { business_id: bizIdOf(req), person_id: person.id },
      include: [{ model: PayrollRun, as: 'run', required: true, where: { status: ['confirmed', 'paid'] }, attributes: ['id', 'period_ym', 'seq', 'kind', 'status', 'pay_date'] }],
      attributes: ['id', 'currency', 'gross_total', 'deduction_total', 'net_total', 'payslip_viewed_at'],
      order: [[{ model: PayrollRun, as: 'run' }, 'period_ym', 'DESC'], [{ model: PayrollRun, as: 'run' }, 'seq', 'ASC']],
      limit: 240,
    });
    res.set('Cache-Control', 'no-store');
    return successResponse(res, rows.map((e) => ({
      entry_id: e.id, period_ym: e.run.period_ym, seq: e.run.seq, kind: e.run.kind, status: e.run.status,
      pay_date: e.run.pay_date ? dateOnlyOf(e.run.pay_date) : null, currency: e.currency,
      gross_total: num(e.gross_total), deduction_total: num(e.deduction_total), net_total: num(e.net_total), viewed: !!e.payslip_viewed_at,
    })));
  } catch (e) { next(e); }
});

router.get('/:businessId/me/payslips/:entryId', ...base, async (req, res, next) => {
  try {
    const r = await ownPayslip(req);
    if (!r.d) return errorResponse(res, r.code, r.http);
    if (!r.d.entry.viewed_at) {
      await PayrollEntry.update({ payslip_viewed_at: new Date() }, { where: { id: r.d.entry.id, payslip_viewed_at: null } });
      logAudit(req, { action: 'payroll.payslip_view', targetType: 'payroll_entry', targetId: r.d.entry.id, businessId: bizIdOf(req) });
    }
    res.set('Cache-Control', 'no-store');
    const { owner_user_id: _o, ...out } = r.d;
    return successResponse(res, out);
  } catch (e) { next(e); }
});

router.get('/:businessId/me/payslips/:entryId/pdf', ...base, async (req, res, next) => {
  try {
    const r = await ownPayslip(req);
    if (!r.d) return errorResponse(res, r.code, r.http);
    const pdf = await P.renderPayslipPdf(r.d, req.query.lang === 'en' ? 'en' : 'ko');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${r.d.run.period_ym}${r.d.run.seq > 1 ? `-${r.d.run.seq}` : ''}.pdf"`, 'Cache-Control': 'no-store' });
    return res.send(pdf);
  } catch (e) { next(e); }
});

// 본인 계약 이력(금액 포함) — 계좌·메모는 싣지 않는다
router.get('/:businessId/me/contracts', ...base, async (req, res, next) => {
  try {
    const person = await myPerson(req);
    if (!person || !canReadOwnContracts(req.user.id, person)) return successResponse(res, []);
    const rows = await EmploymentContract.findAll({
      where: { business_id: bizIdOf(req), person_id: person.id, status: ['active', 'ended', 'superseded'] },
      include: [{ model: ContractPayLine, as: 'lines', include: [{ model: PayItem, as: 'item', attributes: ['id', 'name', 'name_en', 'side'] }] }],
      order: [['start_date', 'DESC']],
    });
    return successResponse(res, rows.map((c) => ({
      id: c.id, kind: c.kind, status: c.status, start_date: dateOnlyOf(c.start_date), end_date: c.end_date ? dateOnlyOf(c.end_date) : null,
      currency: c.currency, pay_day: c.pay_day, weekly_work_days: c.weekly_work_days, daily_work_hours: num(c.daily_work_hours), signed: !!c.signed_at, post_id: c.post_id,
      lines: (c.lines || []).map((l) => ({ name: l.item?.name, name_en: l.item?.name_en, side: l.item?.side, amount: num(l.amount) })),
    })));
  } catch (e) { next(e); }
});

module.exports = router;
