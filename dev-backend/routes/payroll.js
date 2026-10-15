// 급여·계약 관리 API — /api/payroll/:businessId/... (docs/PAYROLL_DESIGN.md)
//   P1: 급여 담당자 · 대상자 · 계약 이력.  P2~P4(항목·회차·대조·확정·명세서)는 이 접두어에 더한다.
//
//   체인 표준: authenticateToken → checkBusinessAccess → requireModule('payroll') → (관리) requirePayrollManager [→ 쓰기 requirePayrollWrite]
//   ★ 모듈이 꺼져 있으면 모든 라우트가 404(있는지도 말하지 않는다). platform_admin 도 관리자가 아니다(403).
//   ★ 응답에 계좌번호 0 — bank_account_enc 는 전역 toJSON 이 지우고 has_bank_account 만 싣는다. 계좌를 보여주는 문은 GET …/bank-account 하나(감사).
//   ★ 실시간은 신호만, 개인 방에만(owner + 담당자). business 방 금지 — 급여가 있다는 사실 자체가 정보다(설계 §5.2-5).
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { requireModule } = require('../services/modules');
const { requirePayrollManager, requirePayrollWrite, isOwnerOf, payrollManagerIds } = require('../services/payrollAccess');
const C = require('../services/payrollContracts');
const { Business, BusinessMember, User, PayrollPerson, EmploymentContract, ContractPayLine, PayItem } = require('../models');

const base = [authenticateToken, checkBusinessAccess, requireModule('payroll')];
const manager = [...base, requirePayrollManager];
const writer = [...manager, requirePayrollWrite];

const bizIdOf = (req) => Number(req.params.businessId);
const sendResult = (res, r) => (r.ok ? successResponse(res, r.data) : errorResponse(res, r.code, r.http || 400));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// DATE 칸은 드라이버가 Date 로 돌려줄 때가 있다 — 응답은 언제나 'YYYY-MM-DD'(String().slice 금지 — dateOnlyOf)
const { dateOnlyOf } = require('../utils/dateOnly');
const dayOf = (v) => (v ? dateOnlyOf(v) : null);

/** owner + 담당자 개인 방에 «급여 바뀜» 신호. 실패해도 응답에는 영향 없다. */
async function signal(req, businessId, payload) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'owner_id', 'permissions'] });
    const ids = new Set(await payrollManagerIds(biz));
    const owners = await BusinessMember.findAll({ where: { business_id: businessId, role: 'owner', removed_at: null }, attributes: ['user_id'] });
    owners.forEach((o) => ids.add(o.user_id));
    if (biz?.owner_id) ids.add(biz.owner_id);
    for (const uid of ids) io.to(`user:${uid}`).emit('payroll:updated', { business_id: businessId, ...payload });
  } catch (e) { console.warn('[payroll signal]', e.message); }
}

function serializePerson(p) {
  const j = p.toJSON();
  j.hired_on = dayOf(j.hired_on); j.left_on = dayOf(j.left_on);
  j.has_bank_account = !!j.bank_account_set;
  delete j.bank_account_set;
  return j;
}

function serializeContract(c) {
  const j = c.toJSON();
  j.start_date = dayOf(j.start_date); j.end_date = dayOf(j.end_date);
  j.lines = (j.lines || []).map((l) => ({ id: l.id, pay_item_id: l.pay_item_id, amount: Number(l.amount), item: l.item || null }));
  j.monthly_total = j.lines.filter((l) => l.item?.side === 'earning').reduce((s, l) => s + l.amount, 0);
  return j;
}

// ─── 급여 담당자 ───────────────────────────────────────────────
// 보기: 관리자 / 고치기: owner 만(«대표의 결정» — 설계 §2.1)
router.get('/:businessId/managers', ...manager, async (req, res, next) => {
  try {
    const biz = await Business.findByPk(bizIdOf(req), { attributes: ['id', 'permissions'] });
    return successResponse(res, { manager_user_ids: await payrollManagerIds(biz) });
  } catch (e) { next(e); }
});

router.put('/:businessId/managers', ...base, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    if (!(await isOwnerOf(req.user.id, businessId, req.user.platform_role))) return errorResponse(res, 'owner_only', 403);
    const raw = Array.isArray(req.body?.manager_user_ids) ? req.body.manager_user_ids : null;
    if (!raw) return errorResponse(res, 'invalid_manager_user_ids', 400);
    const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
    // 지금 멤버(owner/admin/member)만 — 고객·AI·내보낸 사람은 거절
    const valid = ids.length ? await BusinessMember.findAll({ where: { business_id: businessId, user_id: ids, removed_at: null, role: ['owner', 'admin', 'member'] }, attributes: ['user_id'] }) : [];
    if (valid.length !== ids.length) return errorResponse(res, 'not_workspace_member', 400);
    const biz = await Business.findByPk(businessId);
    const before = biz.permissions?.payroll?.manager_user_ids || [];
    // JSON 칸은 새 객체로 통째로 넣는다(in-place 수정은 저장이 안 된다 — memory sequelize_json_inplace_mutation)
    const next_ = { ...(biz.permissions || {}), payroll: { ...((biz.permissions || {}).payroll || {}), manager_user_ids: ids } };
    await biz.update({ permissions: next_ });
    logAudit(req, { action: 'payroll.managers_update', targetType: 'business', targetId: businessId, businessId, oldValue: { manager_user_ids: before }, newValue: { manager_user_ids: ids } });
    signal(req, businessId, { kind: 'managers' });
    return successResponse(res, { manager_user_ids: ids });
  } catch (e) { next(e); }
});

// ─── 대상자 ───────────────────────────────────────────────────
// 대상자로 넣을 수 있는 멤버(아직 대상자가 아닌 사람)
router.get('/:businessId/candidates', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const taken = (await PayrollPerson.findAll({ where: { business_id: businessId, user_id: { [Op.ne]: null } }, attributes: ['user_id'] })).map((p) => p.user_id);
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null, role: ['owner', 'admin', 'member'], ...(taken.length ? { user_id: { [Op.notIn]: taken } } : {}) },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      attributes: ['user_id', 'name', 'job_title', 'role'],
    });
    return successResponse(res, members.map((m) => ({
      user_id: m.user_id, name: m.name || m.user?.name || '', email: m.user?.email || null, job_title: m.job_title || null,
    })));
  } catch (e) { next(e); }
});

router.get('/:businessId/people', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const where = { business_id: businessId };
    if (req.query.status === 'active' || req.query.status === 'left') where.status = req.query.status;
    const q = String(req.query.q || '').trim().slice(0, 50);
    if (q) where[Op.or] = [{ display_name: { [Op.like]: `%${q}%` } }, { employee_no: { [Op.like]: `%${q}%` } }];
    const rows = await PayrollPerson.findAll({ where, order: [['status', 'ASC'], ['display_name', 'ASC']], limit: 500 });
    // 지금 유효한 계약 요약 — 목록에 «정규 · 3,200,000» 를 보이기 위해(한 쿼리)
    const ids = rows.map((r) => r.id);
    const active = ids.length ? await EmploymentContract.findAll({
      where: { business_id: businessId, person_id: ids, status: 'active' },
      include: [{ model: ContractPayLine, as: 'lines', include: [{ model: PayItem, as: 'item', attributes: ['side'] }] }],
      order: [['start_date', 'DESC']],
    }) : [];
    const byPerson = new Map();
    for (const c of active) if (!byPerson.has(c.person_id)) byPerson.set(c.person_id, c);
    return successResponse(res, rows.map((r) => {
      const j = serializePerson(r);
      const c = byPerson.get(r.id);
      j.current_contract = c ? {
        id: c.id, kind: c.kind, start_date: dayOf(c.start_date), end_date: dayOf(c.end_date), currency: c.currency, signed: !!c.signed_at,
        monthly_total: (c.lines || []).filter((l) => l.item?.side === 'earning').reduce((s, l) => s + Number(l.amount || 0), 0),
      } : null;
      return j;
    }));
  } catch (e) { next(e); }
});

async function personInput(businessId, body, existing) {
  const out = {};
  if (body.display_name !== undefined || !existing) {
    const n = String(body.display_name || '').trim().slice(0, 100);
    if (!n) return { error: 'display_name_required' };
    out.display_name = n;
  }
  if (body.employee_no !== undefined) {
    const v = body.employee_no === null ? '' : String(body.employee_no).trim().slice(0, 30);
    out.employee_no = v || null;
    if (v) {
      const dup = await PayrollPerson.findOne({ where: { business_id: businessId, employee_no: v, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) }, attributes: ['id'] });
      if (dup) return { error: 'employee_no_taken', http: 409 };
    }
  }
  if (body.email !== undefined) {
    const v = body.email === null ? '' : String(body.email).trim().slice(0, 255);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: 'invalid_email' };
    out.email = v || null;
  }
  if (body.income_kind !== undefined) {
    if (!['employment', 'business', 'other'].includes(body.income_kind)) return { error: 'invalid_income_kind' };
    out.income_kind = body.income_kind;
  }
  for (const k of ['hired_on', 'left_on']) {
    if (body[k] === undefined) continue;
    const v = body[k] === null || body[k] === '' ? null : String(body[k]).slice(0, 10);
    if (v && !DATE_RE.test(v)) return { error: `invalid_${k}` };
    out[k] = v;
  }
  for (const [k, max] of [['job_title', 100], ['bank_name', 60], ['note', 500]]) {
    if (body[k] === undefined) continue;
    const v = body[k] === null ? '' : String(body[k]).trim().slice(0, max);
    out[k] = v || null;
  }
  if (body.status !== undefined) {
    if (!['active', 'left'].includes(body.status)) return { error: 'invalid_status' };
    out.status = body.status;
  }
  if (body.user_id !== undefined && !existing) {
    const uid = body.user_id === null ? null : Number(body.user_id);
    if (uid !== null) {
      if (!Number.isInteger(uid)) return { error: 'invalid_user_id' };
      const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: uid, removed_at: null, role: ['owner', 'admin', 'member'] }, attributes: ['id'] });
      if (!m) return { error: 'not_workspace_member' };
      const dup = await PayrollPerson.findOne({ where: { business_id: businessId, user_id: uid }, attributes: ['id'] });
      if (dup) return { error: 'person_exists', http: 409 };
    }
    out.user_id = uid;
  }
  // 계좌 — { number, holder } 를 암호문으로. null 이면 지운다. 응답·감사에는 원문이 남지 않는다.
  if (body.bank_account !== undefined) {
    if (body.bank_account === null) out.bank_account_enc = null;
    else {
      const number = String(body.bank_account?.number || '').replace(/[^\d-]/g, '').slice(0, 40);
      const holder = String(body.bank_account?.holder || '').trim().slice(0, 60);
      if (!number) return { error: 'invalid_bank_account' };
      out.bank_account_enc = require('../services/encryption').encrypt(JSON.stringify({ number, holder }));
    }
  }
  return { data: out };
}

router.post('/:businessId/people', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const body = { ...(req.body || {}) };
    // 멤버에서 고르면 이름·직위를 채워 준다(대장 이름과 다르면 사람이 고친다)
    if (body.user_id && !body.display_name) {
      const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: Number(body.user_id) }, include: [{ model: User, as: 'user', attributes: ['name'] }] });
      if (m) { body.display_name = m.name || m.user?.name; if (body.job_title === undefined) body.job_title = m.job_title || null; }
    }
    const r = await personInput(businessId, body, null);
    if (r.error) return errorResponse(res, r.error, r.http || 400);
    const p = await PayrollPerson.create({ user_id: null, ...r.data, business_id: businessId, created_by: req.user.id });
    logAudit(req, { action: 'payroll.person_create', targetType: 'payroll_person', targetId: p.id, businessId, newValue: { ...r.data, bank_account_enc: r.data.bank_account_enc ? '(set)' : undefined } });
    signal(req, businessId, { kind: 'person', id: p.id });
    return successResponse(res, serializePerson(p));
  } catch (e) { next(e); }
});

router.get('/:businessId/people/:id', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const p = await PayrollPerson.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!p) return errorResponse(res, 'person_not_found', 404);
    const contracts = await EmploymentContract.findAll({
      where: { business_id: businessId, person_id: p.id },
      include: [{ model: ContractPayLine, as: 'lines', include: [{ model: PayItem, as: 'item', attributes: ['id', 'code', 'name', 'name_en', 'side', 'taxable'] }] }],
      order: [['start_date', 'DESC'], ['id', 'DESC']],
    });
    return successResponse(res, { ...serializePerson(p), contracts: contracts.map(serializeContract) });
  } catch (e) { next(e); }
});

router.put('/:businessId/people/:id', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const p = await PayrollPerson.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!p) return errorResponse(res, 'person_not_found', 404);
    const r = await personInput(businessId, req.body || {}, p);
    if (r.error) return errorResponse(res, r.error, r.http || 400);
    if (!Object.keys(r.data).length) return errorResponse(res, 'nothing_to_update', 400);
    const before = {};
    for (const k of Object.keys(r.data)) before[k] = k === 'bank_account_enc' ? (p.bank_account_enc ? '(set)' : null) : p.get(k);
    await p.update(r.data);
    const after = { ...r.data };
    if ('bank_account_enc' in after) after.bank_account_enc = after.bank_account_enc ? '(set)' : null;
    logAudit(req, { action: 'payroll.person_update', targetType: 'payroll_person', targetId: p.id, businessId, oldValue: before, newValue: after });
    signal(req, businessId, { kind: 'person', id: p.id });
    return successResponse(res, serializePerson(p));
  } catch (e) { next(e); }
});

// 계약이 하나도 없는 대상자만 지운다(계약은 이력이다 — 그 외엔 «퇴사» 로 둔다)
router.delete('/:businessId/people/:id', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const p = await PayrollPerson.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!p) return errorResponse(res, 'person_not_found', 404);
    const n = await EmploymentContract.count({ where: { business_id: businessId, person_id: p.id } });
    if (n > 0) return errorResponse(res, 'person_has_contracts', 409);
    await p.destroy();
    logAudit(req, { action: 'payroll.person_delete', targetType: 'payroll_person', targetId: p.id, businessId, oldValue: { display_name: p.display_name } });
    signal(req, businessId, { kind: 'person', id: p.id });
    return successResponse(res, { id: p.id });
  } catch (e) { next(e); }
});

// 계좌 열람 — 이 문 하나뿐. 열 때마다 감사.
router.get('/:businessId/people/:id/bank-account', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const p = await PayrollPerson.findOne({ where: { id: req.params.id, business_id: businessId }, attributes: ['id', 'bank_name', 'bank_account_enc'] });
    if (!p) return errorResponse(res, 'person_not_found', 404);
    if (!p.bank_account_enc) return successResponse(res, { bank_name: p.bank_name, number: null, holder: null });
    let acc = {};
    try { acc = JSON.parse(require('../services/encryption').decrypt(p.bank_account_enc)) || {}; } catch { return errorResponse(res, 'decrypt_failed', 500); }
    logAudit(req, { action: 'payroll.bank_account_view', targetType: 'payroll_person', targetId: p.id, businessId });
    res.set('Cache-Control', 'no-store');
    return successResponse(res, { bank_name: p.bank_name, number: acc.number || null, holder: acc.holder || null });
  } catch (e) { next(e); }
});

// ─── 계약 ─────────────────────────────────────────────────────
router.post('/:businessId/people/:id/contracts', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await C.createContract(businessId, Number(req.params.id), req.body || {}, req.user.id);
    if (r.ok) {
      logAudit(req, { action: 'payroll.contract_create', targetType: 'employment_contract', targetId: r.data.id, businessId, newValue: serializeContract(r.data) });
      signal(req, businessId, { kind: 'contract', id: r.data.id, person_id: r.data.person_id });
      return successResponse(res, serializeContract(r.data));
    }
    return sendResult(res, r);
  } catch (e) { next(e); }
});

router.put('/:businessId/contracts/:cid', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const before = await C.loadContract(businessId, Number(req.params.cid));
    const r = await C.updateContract(businessId, Number(req.params.cid), req.body || {});
    if (!r.ok) return sendResult(res, r);
    logAudit(req, { action: 'payroll.contract_update', targetType: 'employment_contract', targetId: r.data.id, businessId, oldValue: before ? serializeContract(before) : null, newValue: serializeContract(r.data) });
    signal(req, businessId, { kind: 'contract', id: r.data.id, person_id: r.data.person_id });
    return successResponse(res, serializeContract(r.data));
  } catch (e) { next(e); }
});

router.post('/:businessId/contracts/:cid/activate', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await C.activate(businessId, Number(req.params.cid));
    if (!r.ok) return sendResult(res, r);
    logAudit(req, { action: 'payroll.contract_activate', targetType: 'employment_contract', targetId: r.data.contract.id, businessId, newValue: { superseded: r.data.superseded } });
    signal(req, businessId, { kind: 'contract', id: r.data.contract.id, person_id: r.data.contract.person_id });
    return successResponse(res, { contract: serializeContract(r.data.contract), superseded: r.data.superseded });
  } catch (e) { next(e); }
});

router.post('/:businessId/contracts/:cid/end', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await C.endContract(businessId, Number(req.params.cid), req.body?.end_date);
    if (!r.ok) return sendResult(res, r);
    logAudit(req, { action: 'payroll.contract_end', targetType: 'employment_contract', targetId: r.data.id, businessId, newValue: { end_date: r.data.end_date } });
    signal(req, businessId, { kind: 'contract', id: r.data.id, person_id: r.data.person_id });
    return successResponse(res, serializeContract(r.data));
  } catch (e) { next(e); }
});

router.delete('/:businessId/contracts/:cid', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const before = await C.loadContract(businessId, Number(req.params.cid));
    const r = await C.deleteDraft(businessId, Number(req.params.cid));
    if (!r.ok) return sendResult(res, r);
    logAudit(req, { action: 'payroll.contract_delete', targetType: 'employment_contract', targetId: r.data.id, businessId, oldValue: before ? serializeContract(before) : null });
    signal(req, businessId, { kind: 'contract', id: r.data.id, person_id: before?.person_id });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// 본인 계약·명세서 열람(GET …/me/*)은 화면과 함께 P4 에서 넣는다(설계 §9 /me/payslips). 술어는 payrollAccess.canReadOwnContracts.

module.exports = router;
