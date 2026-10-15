// 급여 회차 API — /api/payroll/:businessId/runs… · lines · entries (docs/PAYROLL_DESIGN.md §5 · §7 · §9)
//   체인 표준: authenticateToken → checkBusinessAccess → requireModule('payroll') → 관리자(owner + 지정 담당자) [→ 쓰기 요금제]
//   상태 전이는 services/payrollTransition 한 문 · 대장 읽기·매칭은 services/payrollStatement · 금액 공식은 services/payrollCalc.
//   ★ 엔티티 id(줄·사람줄)로 오는 라우트도 :businessId 와 함께 찾는다(남의 id 를 섞어 보내는 경로가 곧 누수다).
//   ★ 응답에 계좌번호 0 — 사람줄은 은행 이름·끝 4자리 동결값만(확정 뒤).
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { Op } = require('sequelize');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { requireModule } = require('../services/modules');
const { requirePayrollManager, requirePayrollWrite } = require('../services/payrollAccess');
const { perUserDaily } = require('../middleware/costGuard');
const T = require('../services/payrollTransition');
const S = require('../services/payrollStatement');
const { signalPayroll } = require('../services/payrollSignal');
const { sequelize } = require('../config/database');
const { dateOnlyOf } = require('../utils/dateOnly');
const {
  PayItem, PayrollPerson, PayrollRun, PayrollEntry, PayrollEntryLine, PayrollStatusHistory, Task, User,
} = require('../models');

const base = [authenticateToken, checkBusinessAccess, requireModule('payroll')];
const manager = [...base, requirePayrollManager];
const writer = [...manager, requirePayrollWrite];
const bizIdOf = (req) => Number(req.params.businessId);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const fail = (res, r) => res.status(r.http || 400).json({ success: false, message: r.code, ...(r.extra ? { data: r.extra } : {}) });

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (S.kindOf(file.originalname, file.mimetype) ? cb(null, true) : cb(new Error('unsupported_file'))),
});

function serializeRun(r) {
  const j = r.toJSON();
  j.pay_date = j.pay_date ? dateOnlyOf(j.pay_date) : null;
  for (const k of ['gross_total', 'deduction_total', 'net_total']) j[k] = num(j[k]);
  delete j.statement_extract_json;   // 대장 원본은 상세의 statement 요약으로만
  return j;
}

// ─── 목록 ───────────────────────────────────────────────────────
router.get('/:businessId/runs', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (req.query.year && /^\d{4}$/.test(String(req.query.year))) where.period_ym = { [Op.like]: `${req.query.year}-%` };
    const { rows, count } = await PayrollRun.findAndCountAll({ where, order: [['period_ym', 'DESC'], ['seq', 'ASC']], limit, offset });
    return paginatedResponse(res, rows.map(serializeRun), count, { limit, page, offset });
  } catch (e) { next(e); }
});

router.post('/:businessId/runs', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.createRun(businessId, req.body || {}, req.user.id);
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.run_create', targetType: 'payroll_run', targetId: r.data.run.id, businessId, newValue: { period_ym: r.data.run.period_ym, pay_date: r.data.run.pay_date, headcount: r.data.run.headcount } });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run.id });
    return successResponse(res, { run: serializeRun(r.data.run), warnings: r.data.warnings || {} });
  } catch (e) { next(e); }
});

// ─── 상세 ───────────────────────────────────────────────────────
async function runDetail(businessId, runId) {
  const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId } });
  if (!run) return null;
  const entries = await PayrollEntry.findAll({
    where: { run_id: run.id },
    include: [{ model: PayrollEntryLine, as: 'lines' }, { model: PayrollPerson, as: 'person', attributes: ['id', 'user_id', 'income_kind', 'status'] }],
    order: [['display_name', 'ASC'], ['id', 'ASC']],
  });
  const itemIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.pay_item_id)))];
  const items = itemIds.length ? await PayItem.findAll({ where: { id: itemIds, business_id: businessId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }) : [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const locked = T.LOCKED.includes(run.status);
  const taskIds = [...new Set(entries.map((e) => e.transfer_task_id).filter(Boolean))];
  const tasks = taskIds.length ? await Task.findAll({ where: { id: taskIds, business_id: businessId }, attributes: ['id', 'status'] }) : [];
  const taskStatus = new Map(tasks.map((t) => [t.id, t.status]));
  const history = await PayrollStatusHistory.findAll({ where: { run_id: run.id }, order: [['created_at', 'ASC'], ['id', 'ASC']] });
  const actorIds = [...new Set(history.map((h) => h.changed_by).filter(Boolean))];
  const actors = actorIds.length ? await User.findAll({ where: { id: actorIds }, attributes: ['id', 'name'] }) : [];
  const actorName = new Map(actors.map((u) => [u.id, u.name]));
  const siblings = await PayrollRun.findAll({ where: { business_id: businessId, period_ym: run.period_ym }, attributes: ['id', 'seq', 'kind', 'status'], order: [['seq', 'ASC']] });
  return {
    run: serializeRun(run),
    locked,
    items: items.map((i) => ({
      id: i.id, code: i.code, name: i.name, name_en: i.name_en, side: i.side, calc: i.calc, taxable: !!i.taxable, sign: i.sign,
      in_total: !!i.in_total, is_statutory: !!i.is_statutory, is_settlement: !!i.is_settlement, sort_order: i.sort_order,
    })),
    entries: entries.map((e) => ({
      id: e.id, person_id: e.person_id, contract_id: e.contract_id, user_linked: !!e.person?.user_id, income_kind: e.person?.income_kind || null,
      display_name: e.display_name, employee_no: e.employee_no, job_title: e.job_title, department_name: e.department_name, currency: e.currency,
      unpaid_leave_days: num(e.unpaid_leave_days), unpaid_leave_source: e.unpaid_leave_source,
      gross_total: num(e.gross_total), taxable_total: num(e.taxable_total), nontaxable_total: num(e.nontaxable_total),
      deduction_total: num(e.deduction_total), net_total: num(e.net_total),
      bank_name: e.bank_name_snapshot, bank_last4: e.bank_last4,
      statement_matched: !!e.statement_matched, statement_warnings: e.statement_warnings || [],
      transfer_task_id: e.transfer_task_id, transfer_task_status: e.transfer_task_id ? (taskStatus.get(e.transfer_task_id) || null) : null,
      payslip_viewed_at: e.payslip_viewed_at, note: e.note,
      lines: e.lines
        .sort((a, b) => ((itemById.get(a.pay_item_id)?.sort_order ?? 0) - (itemById.get(b.pay_item_id)?.sort_order ?? 0)) || (a.pay_item_id - b.pay_item_id))
        .map((l) => ({
          id: l.id, pay_item_id: l.pay_item_id,
          name: (locked && l.item_name_snapshot) || itemById.get(l.pay_item_id)?.name || l.item_name_snapshot || '',
          draft_amount: num(l.draft_amount), statement_amount: num(l.statement_amount), final_amount: num(l.final_amount), final_source: l.final_source, note: l.note,
        })),
    })),
    statement: S.summarize(run.statement_extract_json),
    history: history.map((h) => ({ from: h.from_status, to: h.to_status, at: h.created_at, by: h.changed_by, by_name: actorName.get(h.changed_by) || null, note: h.note })),
    siblings: siblings.map((s) => ({ id: s.id, seq: s.seq, kind: s.kind, status: s.status })),
    open_transfer_tasks: [...taskStatus.values()].filter((s) => !['completed', 'canceled'].includes(s)).length,
  };
}

router.get('/:businessId/runs/:id', ...manager, async (req, res, next) => {
  try {
    const d = await runDetail(bizIdOf(req), Number(req.params.id));
    if (!d) return errorResponse(res, 'run_not_found', 404);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, d);
  } catch (e) { next(e); }
});

// 초안 다시 만들기 — 사람이 고친 칸·대장 값·사람이 넣은 무급일은 남는다
router.post('/:businessId/runs/:id/build', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.buildDraft(businessId, Number(req.params.id), req.user.id);
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.run_build', targetType: 'payroll_run', targetId: r.data.run.id, businessId, newValue: { headcount: r.data.run.headcount } });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run.id });
    return successResponse(res, { run: serializeRun(r.data.run), warnings: r.data.warnings });
  } catch (e) { next(e); }
});

router.delete('/:businessId/runs/:id', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.deleteRun(businessId, Number(req.params.id), req.user.id);
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.run_delete', targetType: 'payroll_run', targetId: Number(req.params.id), businessId, oldValue: r.before });
    signalPayroll(req, businessId, { kind: 'run', id: Number(req.params.id) });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// ─── 칸 · 사람줄 ─────────────────────────────────────────────────
router.patch('/:businessId/lines/:lineId', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.updateLine(businessId, Number(req.params.lineId), req.body || {}, req.user.id);
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.line_update', targetType: 'payroll_entry_line', targetId: r.data.line_id, businessId, oldValue: r.before, newValue: r.after });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run_id });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

router.patch('/:businessId/entries/:entryId', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.updateEntry(businessId, Number(req.params.entryId), req.body || {});
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.entry_update', targetType: 'payroll_entry', targetId: r.data.entry_id, businessId, newValue: req.body || {} });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run_id });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

router.delete('/:businessId/entries/:entryId', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.removeEntry(businessId, Number(req.params.entryId));
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.entry_remove', targetType: 'payroll_entry', targetId: r.data.entry_id, businessId, oldValue: r.before });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run_id });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// 채택 — 대장 값 / 초안 값 / 빈칸 0 (회차 전체 · 한 사람 · 한 칸)
router.post('/:businessId/runs/:id/adopt', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const b = req.body || {};
    const r = await T.adopt(businessId, Number(req.params.id), { mode: b.mode, entryId: b.entry_id ? Number(b.entry_id) : null, lineId: b.line_id ? Number(b.line_id) : null });
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.adopt', targetType: 'payroll_run', targetId: r.data.run_id, businessId, newValue: { mode: b.mode, entry_id: b.entry_id || null, line_id: b.line_id || null, changed: r.data.changed } });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run_id });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// ─── 세무사 대장 가져오기 ─────────────────────────────────────────
// 엑셀·CSV 는 기계가, PDF 만 AI 가(Cue 1회 계량). 파일은 Q file 에 나만 보기(L1)·대외비로 남고 검색·AI 색인에 들어가지 않는다.
router.post('/:businessId/runs/:id/statement', ...writer, ...perUserDaily('payroll-statement', { perMin: 5, perDay: 60 }), (req, res, next) => {
  statementUpload.single('file')(req, res, (err) => {
    if (err) return errorResponse(res, err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : (err.message || 'upload_failed'), 400);
    return next();
  });
}, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    if (!req.file) return errorResponse(res, 'file_required', 400);
    const run = await PayrollRun.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!run) return errorResponse(res, 'run_not_found', 404);
    if (T.LOCKED.includes(run.status)) return errorResponse(res, 'run_locked', 409);
    const kind = S.kindOf(req.file.originalname, req.file.mimetype);
    if (kind === 'pdf') {
      const can = await require('../services/plan').can(businessId, 'use_cue');
      if (!can.ok) return errorResponse(res, can.reason || 'cue_quota_exceeded', 409);
    }
    const parsed = await S.parseStatement(req.file.buffer, kind);
    if (parsed.llm) require('../services/cue_orchestrator').recordUsage(businessId, 'payroll_extract', parsed.llm.model, parsed.llm.input_tokens, parsed.llm.output_tokens).catch((e) => console.warn('[payroll extract usage]', e.message));
    if (!parsed.ok) return errorResponse(res, parsed.code, 422);
    if (!parsed.rows.length) return errorResponse(res, 'no_rows', 422);
    // 원본 파일 — 나만 보기 · 대외비 · 실시간 신호·색인 없음
    const { uploadPathFor, ingestDownloadedFile } = require('../services/driveImport');
    const temp = uploadPathFor(businessId);
    fs.writeFileSync(temp, req.file.buffer);
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const ing = await ingestDownloadedFile({ businessId, uploaderId: req.user.id }, temp, {
      visibility: 'L1', securityLevel: 'confidential', private: true, fileName, mimeType: req.file.mimetype || 'application/octet-stream',
      auditValue: { source: 'payroll_statement', run_id: run.id },
    });
    if (!ing.ok) return errorResponse(res, ing.reason || 'file_store_failed', ing.reason === 'storage_quota_exceeded' ? 409 : 500);
    const extract = {
      source: kind, file_name: fileName, sheet: parsed.sheet || null, imported_at: new Date().toISOString(),
      columns: parsed.columns, rows: parsed.rows, warnings: parsed.warnings, dropped_secret_columns: parsed.dropped_secret_columns || 0,
      column_map: {}, row_map: {},
    };
    const t = await sequelize.transaction();
    let before = null;
    try {
      const locked = await PayrollRun.findOne({ where: { id: run.id, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
      if (T.LOCKED.includes(locked.status)) { await t.rollback(); return errorResponse(res, 'run_locked', 409); }
      before = locked.statement_extract_json ? { file_name: locked.statement_extract_json.file_name, imported_at: locked.statement_extract_json.imported_at, rows: (locked.statement_extract_json.rows || []).length } : null;
      await S.rematch(locked, extract, t);
      const from = locked.status;
      await locked.update({ statement_file_id: ing.file.id, statement_imported_at: new Date(), statement_extract_json: extract, status: 'reconciling' }, { transaction: t });
      if (from !== 'reconciling') {
        await PayrollStatusHistory.create({ business_id: businessId, run_id: locked.id, from_status: from, to_status: 'reconciling', changed_by: req.user.id, note: fileName.slice(0, 200) }, { transaction: t });
      }
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
    logAudit(req, { action: 'payroll.statement_import', targetType: 'payroll_run', targetId: run.id, businessId, oldValue: before, newValue: { file_id: ing.file.id, file_name: fileName, source: kind, rows: extract.rows.length, matched: extract.rows.filter((r) => r.person_id).length } });
    signalPayroll(req, businessId, { kind: 'run', id: run.id });
    return successResponse(res, S.summarize(extract));
  } catch (e) { next(e); }
});

/** 사람이 고른 열·사람 결정을 저장하고 다시 싣는다. */
async function updateStatementDecision(req, res, next, apply) {
  try {
    const businessId = bizIdOf(req);
    const t = await sequelize.transaction();
    let summary;
    try {
      const run = await PayrollRun.findOne({ where: { id: Number(req.params.id), business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!run) { await t.rollback(); return errorResponse(res, 'run_not_found', 404); }
      if (T.LOCKED.includes(run.status)) { await t.rollback(); return errorResponse(res, 'run_locked', 409); }
      const extract = run.statement_extract_json ? JSON.parse(JSON.stringify(run.statement_extract_json)) : null;
      if (!extract) { await t.rollback(); return errorResponse(res, 'no_statement', 409); }
      const r = await apply(run, extract, t);
      if (r && r.error) { await t.rollback(); return errorResponse(res, r.error, r.http || 400); }
      await S.rematch(run, extract, t);
      await run.update({ statement_extract_json: extract }, { transaction: t });   // 새 객체 통째로(in-place 수정은 저장 안 된다)
      await t.commit();
      summary = S.summarize(extract);
      logAudit(req, { action: 'payroll.statement_decide', targetType: 'payroll_run', targetId: run.id, businessId, newValue: req.body || {} });
      signalPayroll(req, businessId, { kind: 'run', id: run.id });
    } catch (e) { await t.rollback(); throw e; }
    return successResponse(res, summary);
  } catch (e) { next(e); }
}

// 열 결정 — { key, action:'map', item_id } (그 머리글을 항목 별칭으로 저장 = 다음 달 자동) | { key, action:'ignore' } | { key, action:'create', side }
router.put('/:businessId/runs/:id/statement/columns', ...writer, (req, res, next) => updateStatementDecision(req, res, next, async (run, extract, t) => {
  const b = req.body || {};
  const col = extract.columns.find((c) => c.key === b.key && c.role === 'item');
  if (!col) return { error: 'column_not_found', http: 404 };
  extract.column_map = extract.column_map || {};
  if (b.action === 'ignore') { extract.column_map[col.key] = null; return null; }
  let itemId;
  if (b.action === 'map') {
    itemId = Number(b.item_id);
    const it = await PayItem.findOne({ where: { id: itemId, business_id: run.business_id }, transaction: t });
    if (!it) return { error: 'item_not_found', http: 404 };
    const aliases = Array.isArray(it.aliases) ? it.aliases : [];
    if (!aliases.includes(col.header)) await it.update({ aliases: [...aliases, col.header].slice(-20) }, { transaction: t });
  } else if (b.action === 'create') {
    const side = b.side === 'earning' ? 'earning' : 'deduction';
    const I = require('../services/payrollItems');
    const r = await I.createItem(run.business_id, { name: col.header, side, calc: side === 'earning' ? 'manual' : 'external', taxable: side === 'earning', aliases: [col.header] });
    if (!r.ok) return { error: r.code, http: r.http };
    itemId = r.data.id;
  } else return { error: 'invalid_action' };
  extract.column_map[col.key] = itemId;
  return null;
}));

// 사람 결정 — { idx, action:'map', person_id } | { idx, action:'skip' } | { idx, action:'create' }(대장의 이름·사번·직위로 대상자 만들기)
router.put('/:businessId/runs/:id/statement/rows', ...writer, (req, res, next) => updateStatementDecision(req, res, next, async (run, extract, t) => {
  const b = req.body || {};
  const row = extract.rows.find((r) => r.idx === Number(b.idx));
  if (!row) return { error: 'row_not_found', http: 404 };
  extract.row_map = extract.row_map || {};
  if (b.action === 'skip') { extract.row_map[row.idx] = 'skip'; return null; }
  let person;
  if (b.action === 'map') {
    person = await PayrollPerson.findOne({ where: { id: Number(b.person_id), business_id: run.business_id }, transaction: t });
    if (!person) return { error: 'person_not_found', http: 404 };
    // 사번 학습 — 대장에 사번이 있고 대상자에 없으면 채운다(다음 달엔 사번으로 바로 맞는다)
    if (row.employee_no && !person.employee_no) {
      const taken = await PayrollPerson.findOne({ where: { business_id: run.business_id, employee_no: row.employee_no }, attributes: ['id'], transaction: t });
      if (!taken) await person.update({ employee_no: row.employee_no }, { transaction: t });
    }
  } else if (b.action === 'create') {
    if (row.employee_no) {
      const taken = await PayrollPerson.findOne({ where: { business_id: run.business_id, employee_no: row.employee_no }, attributes: ['id'], transaction: t });
      if (taken) return { error: 'employee_no_taken', http: 409 };
    }
    const hired = /^\d{4}-\d{2}-\d{2}$/.test(String(row.meta?.hired_on || '')) ? row.meta.hired_on : null;
    person = await PayrollPerson.create({
      business_id: run.business_id, display_name: String(row.name || '').slice(0, 100) || '—', employee_no: row.employee_no || null,
      job_title: row.meta?.job_title || null, hired_on: hired, income_kind: 'employment', status: 'active', created_by: req.user.id,
    }, { transaction: t });
  } else return { error: 'invalid_action' };
  extract.row_map[row.idx] = person.id;
  return null;
}));

// ─── 확정 · 송금 할 일 · 지급완료 · 정정 ─────────────────────────────
router.post('/:businessId/runs/:id/confirm', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.confirm(businessId, Number(req.params.id), req.user.id, req.body || {});
    if (!r.ok) return fail(res, r);
    const run = r.data.run;
    logAudit(req, { action: 'payroll.run_confirm', targetType: 'payroll_run', targetId: run.id, businessId, oldValue: { status: 'draft|reconciling' }, newValue: { status: 'confirmed', headcount: run.headcount, gross_total: num(run.gross_total), deduction_total: num(run.deduction_total), net_total: num(run.net_total), totals_by_currency: run.totals_by_currency } });
    const side = await T.afterConfirm(businessId, run.id, req.user.id, req);
    signalPayroll(req, businessId, { kind: 'run', id: run.id });
    return successResponse(res, { run: serializeRun(run), tasks_created: side.tasks?.data?.created?.length || 0, tasks_ok: !!side.tasks?.ok, notified: side.notified });
  } catch (e) { next(e); }
});

// 송금 할 일 다시 만들기 — 멱등(이미 있는 사람은 건너뛴다). 확정 직후 실패했을 때의 복구 문.
router.post('/:businessId/runs/:id/transfer-tasks', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.ensureTransferTasks(businessId, Number(req.params.id), req.user.id, req);
    if (!r.ok) return errorResponse(res, r.code, r.code === 'not_confirmed' ? 409 : 500);
    if (r.data.created.length) logAudit(req, { action: 'payroll.transfer_tasks', targetType: 'payroll_run', targetId: Number(req.params.id), businessId, newValue: { created: r.data.created } });
    signalPayroll(req, businessId, { kind: 'run', id: Number(req.params.id) });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

router.post('/:businessId/runs/:id/paid', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.markPaid(businessId, Number(req.params.id), req.user.id);
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.run_paid', targetType: 'payroll_run', targetId: r.data.run.id, businessId, oldValue: { status: 'confirmed' }, newValue: { status: 'paid' } });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run.id });
    return successResponse(res, { run: serializeRun(r.data.run) });
  } catch (e) { next(e); }
});

router.post('/:businessId/runs/:id/adjustments', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await T.createAdjustment(businessId, Number(req.params.id), req.user.id, req.body || {});
    if (!r.ok) return fail(res, r);
    logAudit(req, { action: 'payroll.adjustment_create', targetType: 'payroll_run', targetId: r.data.run.id, businessId, newValue: { adjusts_run_id: Number(req.params.id), seq: r.data.run.seq, headcount: r.data.run.headcount } });
    signalPayroll(req, businessId, { kind: 'run', id: r.data.run.id });
    return successResponse(res, { run: serializeRun(r.data.run) });
  } catch (e) { next(e); }
});

// ─── 관리자용 명세서(계정 없는 사람에게 전할 PDF) · CSV 내보내기 ───────────
router.get('/:businessId/entries/:entryId/payslip', ...manager, async (req, res, next) => {
  try {
    const P = require('../services/payslip');
    const d = await P.loadPayslip(bizIdOf(req), Number(req.params.entryId), { requireLocked: true });
    if (!d) return errorResponse(res, 'payslip_not_found', 404);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, d);
  } catch (e) { next(e); }
});

router.get('/:businessId/entries/:entryId/payslip.pdf', ...manager, async (req, res, next) => {
  try {
    const P = require('../services/payslip');
    const businessId = bizIdOf(req);
    const d = await P.loadPayslip(businessId, Number(req.params.entryId), { requireLocked: true });
    if (!d) return errorResponse(res, 'payslip_not_found', 404);
    const pdf = await P.renderPayslipPdf(d, req.query.lang === 'en' ? 'en' : 'ko');
    logAudit(req, { action: 'payroll.payslip_pdf', targetType: 'payroll_entry', targetId: d.entry.id, businessId });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${d.run.period_ym}-${d.entry.id}.pdf"`, 'Cache-Control': 'no-store' });
    return res.send(pdf);
  } catch (e) { next(e); }
});

router.get('/:businessId/runs/:id/export.csv', ...manager, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const d = await runDetail(businessId, Number(req.params.id));
    if (!d) return errorResponse(res, 'run_not_found', 404);
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const en = req.query.lang === 'en';
    const head = [en ? 'Name' : '성명', en ? 'Employee no.' : '사번', ...d.items.map((i) => (en && i.name_en) || i.name), en ? 'Gross' : '지급합계', en ? 'Deductions' : '공제합계', en ? 'Net pay' : '차인지급액'];
    const rows = d.entries.map((e) => {
      const byItem = new Map(e.lines.map((l) => [l.pay_item_id, l.final_amount]));
      return [e.display_name, e.employee_no || '', ...d.items.map((i) => byItem.get(i.id) ?? ''), e.gross_total ?? '', e.deduction_total ?? '', e.net_total ?? ''];
    });
    logAudit(req, { action: 'payroll.run_export', targetType: 'payroll_run', targetId: d.run.id, businessId });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="payroll-${d.run.period_ym}-${d.run.seq}.csv"`, 'Cache-Control': 'no-store' });
    return res.send(`﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\n')}`);
  } catch (e) { next(e); }
});

module.exports = router;
