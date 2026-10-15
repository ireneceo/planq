// 급여 회차 — 상태 전이 한 문 (docs/PAYROLL_DESIGN.md §5)
//
//   (없음) ─ createRun ─→ draft ─ buildDraft ─→ draft
//   draft ─ importStatement(payrollStatement) ─→ reconciling
//   draft|reconciling ─ confirm ─→ confirmed(잠금) ─ markPaid ─→ paid
//   confirmed|paid ─ createAdjustment ─→ 새 회차(seq+1, draft) — 원 회차는 영영 불변
//   draft ─ deleteRun ─→ (삭제)
//
//   ★ 금액 공식은 services/payrollCalc 한 벌. 이 파일은 «무엇을 넣어 그 공식을 부르나» 와 상태만 다룬다.
//   ★ 잠금: confirmed 이후 그 회차의 사람줄·금액칸은 고칠 수 없다(409 run_locked). 정정은 정정 회차로만.
//   ★ 확정의 부수효과(송금 할 일·명세서 알림·실시간)는 커밋 **뒤** — 실패해도 확정은 유지(돈 상태가 정본),
//     송금 할 일은 entry.transfer_task_id 로 멱등(다시 만들기 버튼이 같은 함수를 부른다).
//   ★ 실시간·알림은 개인 방·본인에게만. business 방 금지 — 급여가 있다는 사실 자체가 정보다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Business, BusinessMember, User, Department, PayrollPerson, EmploymentContract, ContractPayLine, PayItem,
  PayrollRun, PayrollEntry, PayrollEntryLine, PayrollStatusHistory,
} = require('../models');
const calc = require('./payrollCalc');
const { dateOnlyOf } = require('../utils/dateOnly');

const fail = (code, http = 400, extra) => ({ ok: false, code, http, ...(extra ? { extra } : {}) });
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCKED = ['confirmed', 'paid'];
const AMOUNT_MAX = 10_000_000_000;
const num = (v) => (v === null || v === undefined ? null : Number(v));

function periodRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

function payDateFor(ym, payDay) {
  const { end } = periodRange(ym);
  if (!payDay) return end;
  const last = Number(end.slice(8));
  return `${ym}-${String(Math.min(payDay, last)).padStart(2, '0')}`;
}

async function history(t, run, from, to, changedBy, note) {
  await PayrollStatusHistory.create({ business_id: run.business_id, run_id: run.id, from_status: from, to_status: to, changed_by: changedBy || null, note: note ? String(note).slice(0, 500) : null }, { transaction: t });
}

/** 그 달에 유효했던 계약(사람별 하나 — 기간 안에서 가장 늦게 시작한 것). 초안은 «유효·종료·변경됨» 을 다 본다(달 중간에 끝난 계약도 그 달 급여는 나간다). */
async function contractsInPeriod(businessId, { start, end }, personIds, t) {
  const rows = await EmploymentContract.findAll({
    where: {
      business_id: businessId, status: ['active', 'ended', 'superseded'], start_date: { [Op.lte]: end },
      [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: start } }],
      ...(personIds ? { person_id: personIds } : {}),
    },
    include: [{ model: ContractPayLine, as: 'lines' }],
    order: [['start_date', 'DESC'], ['id', 'DESC']],
    transaction: t,
  });
  const byPerson = new Map();
  const changed = new Set();
  for (const c of rows) {
    if (byPerson.has(c.person_id)) { changed.add(c.person_id); continue; }
    byPerson.set(c.person_id, c);
  }
  return { byPerson, changed };
}

async function unpaidLeaveDays(person, businessId, range) {
  if (!person.user_id) return 0;
  const { getDeductionsInRange } = require('./memberCapacity');
  const d = await getDeductionsInRange(person.user_id, businessId, range.start, range.end, { leaveType: 'unpaid' });
  return Number(d.leave_days || 0);
}

function itemAppliesTo(item, person) {
  return item.applies_to === 'all' || !item.applies_to || item.applies_to === person.income_kind;
}

/**
 * 한 사람의 줄을 다시 센다 — 계약·정의·무급일이 바뀌거나 사람이 칸을 고친 뒤. 트랜잭션 안에서.
 *   입력: fixed = 사람이 고쳤으면(final_source manual) 그 값, 아니면 계약 금액 · manual/external = 사람이 넣은 값 → 대장 값.
 *   초안(draft_amount) = 계산한 값(외부·직접은 NULL). 확정값(final)은 출처가 'draft' 이거나 비어 있을 때만 초안을 따른다
 *   (대장에서 채택했거나 사람이 넣은 값은 그대로 둔다).
 */
async function recomputeEntry(entry, { items, contract, t, adjustment = false }) {
  const lines = await PayrollEntryLine.findAll({ where: { entry_id: entry.id }, transaction: t });
  const byItem = new Map(lines.map((l) => [l.pay_item_id, l]));
  const itemById = new Map(items.map((it) => [it.id, it]));
  const contractAmount = new Map((contract?.lines || []).map((l) => [l.pay_item_id, Number(l.amount)]));
  const inputs = {};
  for (const it of items) {
    const l = byItem.get(it.id);
    if (l && l.final_source === 'manual') { inputs[it.id] = num(l.final_amount); continue; }
    if (adjustment) {
      // 정정 회차 = 차액. 사람이 넣지 않은 칸은 «변화 없음(0)» 이다 — 대장 값이 있으면 그것(세무사 수정 대장의 차액)
      inputs[it.id] = l && l.statement_amount !== null ? num(l.statement_amount) : 0;
      continue;
    }
    if (it.calc === 'fixed') inputs[it.id] = contractAmount.has(it.id) ? contractAmount.get(it.id) : (l ? num(l.final_amount) : null);
    else if (it.calc === 'manual' || it.calc === 'external') inputs[it.id] = l ? num(l.statement_amount) : null;
  }
  const { amounts, warnings } = calc.draftAmounts({
    items, inputs, unpaidLeaveDays: num(entry.unpaid_leave_days) || 0,
    weeklyWorkDays: contract?.weekly_work_days ?? null, currency: entry.currency,
  });
  const finals = {};
  for (const it of items) {
    const draft = (!adjustment && (it.calc === 'external' || it.calc === 'manual')) ? null : (amounts[it.id] ?? null);
    let l = byItem.get(it.id);
    if (!l) {
      l = await PayrollEntryLine.create({ business_id: entry.business_id, entry_id: entry.id, pay_item_id: it.id, draft_amount: draft }, { transaction: t });
    }
    const patch = {};
    if (String(num(l.draft_amount)) !== String(draft)) patch.draft_amount = draft;
    if (!l.final_source || l.final_source === 'draft') {
      const nf = draft;
      if (String(num(l.final_amount)) !== String(nf)) patch.final_amount = nf;
      const ns = nf === null ? null : 'draft';
      if (l.final_source !== ns) patch.final_source = ns;
    }
    if (Object.keys(patch).length) await l.update(patch, { transaction: t });
    finals[it.id] = num(l.final_amount);
  }
  // 정의에서 빠진 항목의 줄(사람이 고친 것·대장 값이 있는 것은 남긴다)
  for (const l of lines) {
    if (itemById.has(l.pay_item_id)) continue;
    if (l.final_source === 'manual' || l.statement_amount !== null) continue;
    await l.destroy({ transaction: t });
  }
  const tot = calc.totals(items, finals);
  await entry.update({
    gross_total: tot.gross_total, taxable_total: tot.taxable_total, nontaxable_total: tot.nontaxable_total,
    deduction_total: tot.deduction_total, net_total: tot.net_total,
  }, { transaction: t });
  return { totals: tot, warnings };
}

/** 이 사람에게 붙는 항목 — 활성 ∧ 대상(applies_to) 맞음. 고정 항목은 계약에 줄이 있을 때만. 계약 줄이 꺼진 항목을 가리켜도 계약이 말하므로 붙인다. */
function itemsForPerson(allItems, person, contract) {
  const contractIds = new Set((contract?.lines || []).map((l) => l.pay_item_id));
  return allItems.filter((it) => {
    if (it.calc === 'fixed') return contractIds.has(it.id);
    return it.is_active && itemAppliesTo(it, person);
  });
}

/** 정정 회차의 줄 — 그 사람에게 원 회차에 있던 항목 + 지금 활성 항목. 초안은 비워 둔다(차액을 사람이 넣는다). */
async function loadItems(businessId, t) {
  return (await PayItem.findAll({ where: { business_id: businessId }, order: [['sort_order', 'ASC'], ['id', 'ASC']], transaction: t })).map((r) => r.toJSON());
}

async function recalcRunTotals(run, t) {
  const entries = await PayrollEntry.findAll({ where: { run_id: run.id }, attributes: ['currency', 'gross_total', 'deduction_total', 'net_total'], transaction: t });
  const byCur = {};
  for (const e of entries) {
    const c = byCur[e.currency] || (byCur[e.currency] = { headcount: 0, gross_total: 0, deduction_total: 0, net_total: 0 });
    c.headcount += 1;
    for (const k of ['gross_total', 'deduction_total', 'net_total']) {
      const v = num(e[k]);
      c[k] = c[k] === null || v === null ? null : Math.round((c[k] + v) * 100) / 100;
    }
  }
  const curs = Object.keys(byCur);
  const one = curs.length === 1 ? byCur[curs[0]] : null;
  await run.update({
    headcount: entries.length,
    gross_total: one ? one.gross_total : null,
    deduction_total: one ? one.deduction_total : null,
    net_total: one ? one.net_total : null,
    totals_by_currency: curs.length ? byCur : null,
  }, { transaction: t });
}

async function departmentNames(businessId, ids, t) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await Department.findAll({ where: { id: uniq, business_id: businessId }, attributes: ['id', 'name'], transaction: t });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** 회차 만들기 — 정기(seq 1). 같은 달 정기 회차가 있으면 409(정정은 createAdjustment). 만들자마자 초안을 채운다. */
async function createRun(businessId, input, actorId) {
  const ym = String(input?.period_ym || '');
  if (!PERIOD_RE.test(ym)) return fail('invalid_period');
  let payDate = input?.pay_date ? String(input.pay_date).slice(0, 10) : null;
  if (payDate && !DATE_RE.test(payDate)) return fail('invalid_pay_date');
  const exists = await PayrollRun.findOne({ where: { business_id: businessId, period_ym: ym, seq: 1 }, attributes: ['id'] });
  if (exists) return fail('run_exists', 409, { run_id: exists.id });
  if (!payDate) {
    // 기본 지급일 — 그 달 유효 계약들 중 가장 많이 쓰는 지급일, 없으면 말일
    const { byPerson } = await contractsInPeriod(businessId, periodRange(ym));
    const days = [...byPerson.values()].map((c) => c.pay_day).filter(Boolean);
    const mode = days.sort((a, b) => days.filter((x) => x === b).length - days.filter((x) => x === a).length)[0];
    payDate = payDateFor(ym, mode || null);
  }
  const t = await sequelize.transaction();
  let run;
  try {
    run = await PayrollRun.create({
      business_id: businessId, period_ym: ym, seq: 1, kind: 'regular', pay_date: payDate, status: 'draft',
      transfer_task_mode: input?.transfer_task_mode === 'single' ? 'single' : 'per_person',
      note: input?.note ? String(input.note).slice(0, 500) : null, created_by: actorId,
    }, { transaction: t });
    await history(t, run, null, 'draft', actorId);
    await t.commit();
  } catch (e) {
    await t.rollback();
    if (e.name === 'SequelizeUniqueConstraintError') return fail('run_exists', 409);
    throw e;
  }
  const b = await buildDraft(businessId, run.id, actorId);
  if (!b.ok) return b;
  return { ok: true, data: { run: b.data.run, ...b.data } };
}

/**
 * 초안 채우기(다시 만들기) — 그 달 유효 계약이 있는 사람을 넣고 줄을 다시 센다.
 *   보존: 사람이 고친 칸(final_source manual) · 대장 값 · 사람이 넣은 무급일 · 사람이 «이달 제외» 한 사람(excluded 표시는 회차 note 가 아니라 줄 없음으로 남는다 — 다시 만들면 돌아온다).
 *   정기 회차만. draft·reconciling 에서만(잠금 뒤엔 정정 회차).
 */
async function buildDraft(businessId, runId, actorId) {
  const t = await sequelize.transaction();
  try {
    const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!run) { await t.rollback(); return fail('run_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    if (run.kind !== 'regular') { await t.rollback(); return fail('adjustment_has_no_draft', 409); }
    const range = periodRange(run.period_ym);
    const people = await PayrollPerson.findAll({
      where: {
        business_id: businessId,
        [Op.and]: [
          { [Op.or]: [{ status: 'active' }, { left_on: { [Op.gte]: range.start } }] },
          { [Op.or]: [{ hired_on: null }, { hired_on: { [Op.lte]: range.end } }] },
        ],
      },
      transaction: t,
    });
    const { byPerson, changed } = await contractsInPeriod(businessId, range, people.map((p) => p.id), t);
    const items = await loadItems(businessId, t);
    const depts = await departmentNames(businessId, people.map((p) => p.department_id), t);
    const existing = await PayrollEntry.findAll({ where: { run_id: run.id }, transaction: t });
    const byPersonEntry = new Map(existing.map((e) => [e.person_id, e]));
    const warnings = {};
    const included = new Set();
    for (const p of people) {
      const contract = byPerson.get(p.id);
      if (!contract) continue;   // 계약 없는 사람은 넣지 않는다(초안이 «얼마» 를 모른다)
      included.add(p.id);
      let e = byPersonEntry.get(p.id);
      const snap = {
        contract_id: contract.id, display_name: p.display_name, employee_no: p.employee_no, job_title: p.job_title,
        department_name: depts.get(p.department_id) || null, currency: contract.currency || 'KRW',
      };
      if (!e) e = await PayrollEntry.create({ business_id: businessId, run_id: run.id, person_id: p.id, ...snap }, { transaction: t });
      else await e.update(snap, { transaction: t });
      if (e.unpaid_leave_source !== 'manual') {
        await e.update({ unpaid_leave_days: await unpaidLeaveDays(p, businessId, range), unpaid_leave_source: 'leave' }, { transaction: t });
      }
      const r = await recomputeEntry(e, { items: itemsForPerson(items, p, contract), contract, t });
      const w = [...r.warnings];
      if (changed.has(p.id)) w.push('contract_changed_mid_month');
      if (w.length) warnings[e.id] = w;
    }
    // 이번에 대상이 아닌 사람 — 대장 값·사람이 고친 칸이 없으면 뺀다(계약이 끝났거나 지워졌다)
    for (const e of existing) {
      if (included.has(e.person_id)) continue;
      const kept = await PayrollEntryLine.count({ where: { entry_id: e.id, [Op.or]: [{ final_source: 'manual' }, { statement_amount: { [Op.ne]: null } }] }, transaction: t });
      if (!kept) await e.destroy({ transaction: t });
    }
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { run, warnings } };
  } catch (e) { await t.rollback(); throw e; }
}

async function lockRunFor(entryOrRunId, businessId, t, { byEntry = false } = {}) {
  let runId = entryOrRunId;
  if (byEntry) {
    const e = await PayrollEntry.findOne({ where: { id: entryOrRunId, business_id: businessId }, attributes: ['run_id'], transaction: t });
    if (!e) return null;
    runId = e.run_id;
  }
  return PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
}

async function entryContext(entry, businessId, t) {
  const person = await PayrollPerson.findOne({ where: { id: entry.person_id, business_id: businessId }, transaction: t });
  const contract = entry.contract_id ? await EmploymentContract.findOne({ where: { id: entry.contract_id, business_id: businessId }, include: [{ model: ContractPayLine, as: 'lines' }], transaction: t }) : null;
  const all = await loadItems(businessId, t);
  const run = await PayrollRun.findByPk(entry.run_id, { attributes: ['kind'], transaction: t });
  // 정정 회차는 계약이 아니라 «지금 줄이 있는 항목» 이 대상이다
  if (run?.kind === 'adjustment') {
    const have = new Set((await PayrollEntryLine.findAll({ where: { entry_id: entry.id }, attributes: ['pay_item_id'], transaction: t })).map((l) => l.pay_item_id));
    return { items: all.filter((it) => have.has(it.id)), contract: null, adjustment: true };
  }
  return { items: itemsForPerson(all, person, contract), contract };
}

/** 칸 고치기 — final_amount 를 사람이 넣는다(final_source manual). null 이면 «사람이 고친 것» 을 지우고 초안을 다시 따른다. */
async function updateLine(businessId, lineId, input, actorId) {
  const t = await sequelize.transaction();
  try {
    const line = await PayrollEntryLine.findOne({ where: { id: lineId, business_id: businessId }, transaction: t });
    if (!line) { await t.rollback(); return fail('line_not_found', 404); }
    const run = await lockRunFor(line.entry_id, businessId, t, { byEntry: true });
    if (!run) { await t.rollback(); return fail('run_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    const before = { final_amount: num(line.final_amount), final_source: line.final_source };
    const patch = {};
    if (input.final_amount !== undefined) {
      if (input.final_amount === null || input.final_amount === '') { patch.final_source = null; patch.final_amount = null; }
      else {
        const a = Number(String(input.final_amount).replace(/,/g, ''));
        const min = run.kind === 'adjustment' ? -AMOUNT_MAX : 0;
        if (!Number.isFinite(a) || a < min || a > AMOUNT_MAX) { await t.rollback(); return fail('invalid_amount'); }
        patch.final_amount = Math.round(a * 100) / 100; patch.final_source = 'manual';
      }
    }
    if (input.note !== undefined) patch.note = input.note ? String(input.note).slice(0, 500) : null;
    if (!Object.keys(patch).length) { await t.rollback(); return fail('nothing_to_update'); }
    await line.update(patch, { transaction: t });
    const entry = await PayrollEntry.findByPk(line.entry_id, { transaction: t });
    const ctx = await entryContext(entry, businessId, t);
    await recomputeEntry(entry, { ...ctx, t });
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { line_id: line.id, run_id: run.id, entry_id: entry.id }, before, after: { final_amount: num(line.final_amount), final_source: line.final_source } };
  } catch (e) { await t.rollback(); throw e; }
}

/** 사람줄 고치기 — 무급일(사람이 넣으면 휴가 기록 대신 그 값) · 메모. unpaid_leave_days null = 휴가 기록으로 돌아간다. */
async function updateEntry(businessId, entryId, input) {
  const t = await sequelize.transaction();
  try {
    const run = await lockRunFor(entryId, businessId, t, { byEntry: true });
    if (!run) { await t.rollback(); return fail('entry_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    const entry = await PayrollEntry.findOne({ where: { id: entryId, business_id: businessId }, transaction: t });
    const patch = {};
    if (input.unpaid_leave_days !== undefined) {
      if (input.unpaid_leave_days === null || input.unpaid_leave_days === '') {
        const person = await PayrollPerson.findByPk(entry.person_id, { transaction: t });
        patch.unpaid_leave_days = await unpaidLeaveDays(person, businessId, periodRange(run.period_ym));
        patch.unpaid_leave_source = 'leave';
      } else {
        const d = Number(input.unpaid_leave_days);
        if (!Number.isFinite(d) || d < 0 || d > 31 || Math.round(d * 2) !== d * 2) { await t.rollback(); return fail('invalid_unpaid_leave_days'); }
        patch.unpaid_leave_days = d; patch.unpaid_leave_source = 'manual';
      }
    }
    if (input.note !== undefined) patch.note = input.note ? String(input.note).slice(0, 500) : null;
    if (!Object.keys(patch).length) { await t.rollback(); return fail('nothing_to_update'); }
    await entry.update(patch, { transaction: t });
    const ctx = await entryContext(entry, businessId, t);
    await recomputeEntry(entry, { ...ctx, t });
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { entry_id: entry.id, run_id: run.id } };
  } catch (e) { await t.rollback(); throw e; }
}

/** 이달 제외 — 사람줄을 뺀다(초안 다시 만들기가 다시 넣는다). 잠금 전만. */
async function removeEntry(businessId, entryId) {
  const t = await sequelize.transaction();
  try {
    const run = await lockRunFor(entryId, businessId, t, { byEntry: true });
    if (!run) { await t.rollback(); return fail('entry_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    const e = await PayrollEntry.findOne({ where: { id: entryId, business_id: businessId }, transaction: t });
    const before = { person_id: e.person_id, display_name: e.display_name };
    await e.destroy({ transaction: t });
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { entry_id: entryId, run_id: run.id }, before };
  } catch (e) { await t.rollback(); throw e; }
}

/**
 * 채택 — 확정값(final)을 어디서 가져올지 사람이 정한다. 초안·대장 값은 남는다(이력이다).
 *   mode 'statement' = 대장 값이 있는 칸은 대장 값으로(기본 — 법정 항목은 이것이 정답)
 *   mode 'draft'     = 초안 값이 있는 칸은 초안 값으로(사람이 고친 칸은 건드리지 않는다)
 *   mode 'zero'      = 아직 빈 칸을 0 으로(사람이 «이 달은 없음» 이라고 명시하는 단추 — 빈칸을 몰래 0 으로 세지 않는다)
 *   범위: entry_id(한 사람) · line_id(한 칸) · 없으면 회차 전체.
 */
async function adopt(businessId, runId, { mode, entryId, lineId }) {
  if (!['statement', 'draft', 'zero'].includes(mode)) return fail('invalid_mode');
  const t = await sequelize.transaction();
  try {
    const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!run) { await t.rollback(); return fail('run_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    const entries = await PayrollEntry.findAll({ where: { run_id: run.id, ...(entryId ? { id: entryId } : {}) }, transaction: t });
    if (entryId && !entries.length) { await t.rollback(); return fail('entry_not_found', 404); }
    let changedN = 0;
    for (const e of entries) {
      const lines = await PayrollEntryLine.findAll({ where: { entry_id: e.id, ...(lineId ? { id: lineId } : {}) }, transaction: t });
      for (const l of lines) {
        let patch = null;
        if (mode === 'statement' && l.statement_amount !== null) {
          if (l.final_source !== 'statement' || num(l.final_amount) !== num(l.statement_amount)) patch = { final_amount: l.statement_amount, final_source: 'statement' };
        } else if (mode === 'draft' && l.draft_amount !== null) {
          if (l.final_source !== 'draft' || num(l.final_amount) !== num(l.draft_amount)) patch = { final_amount: l.draft_amount, final_source: 'draft' };
        } else if (mode === 'zero' && l.final_amount === null) {
          patch = { final_amount: 0, final_source: 'manual' };
        }
        if (patch) { await l.update(patch, { transaction: t }); changedN += 1; }
      }
      if (lineId && !lines.length) continue;
      const ctx = await entryContext(e, businessId, t);
      await recomputeEntry(e, { ...ctx, t });
    }
    if (lineId && !changedN) {
      const exists = await PayrollEntryLine.count({ where: { id: lineId, business_id: businessId }, transaction: t });
      if (!exists) { await t.rollback(); return fail('line_not_found', 404); }
    }
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { run_id: run.id, changed: changedN } };
  } catch (e) { await t.rollback(); throw e; }
}

async function deleteRun(businessId, runId, actorId) {
  const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId } });
  if (!run) return fail('run_not_found', 404);
  if (run.status !== 'draft') return fail('only_draft_deletable', 409);
  const before = { period_ym: run.period_ym, seq: run.seq, headcount: run.headcount };
  await run.destroy();   // 사람줄·칸·이력은 FK CASCADE
  return { ok: true, data: { id: runId }, before };
}

function last4Of(person) {
  if (!person?.bank_account_enc) return null;
  try {
    const acc = JSON.parse(require('./encryption').decrypt(person.bank_account_enc)) || {};
    const digits = String(acc.number || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
  } catch { return null; }
}

/**
 * 확정 — 잠금. 검사(빈칸·음수·인원) → 표시 정보·항목 이름 동결 → 합계 재계산 → confirmed.
 *   커밋 뒤 부수효과는 afterConfirm(호출부가 부른다 — 실패해도 확정은 유지).
 * @param opts { transfer_task_mode?, transfer_assignee_id? }
 */
async function confirm(businessId, runId, actorId, opts = {}) {
  const t = await sequelize.transaction();
  try {
    const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!run) { await t.rollback(); return fail('run_not_found', 404); }
    if (LOCKED.includes(run.status)) { await t.rollback(); return fail('run_locked', 409); }
    const entries = await PayrollEntry.findAll({ where: { run_id: run.id }, transaction: t });
    if (!entries.length) { await t.rollback(); return fail('no_entries', 409); }
    // 송금 담당 — 지금 급여 관리자(대표·지정 담당자)만
    let assignee = Number(opts.transfer_assignee_id || actorId);
    if (assignee !== Number(actorId)) {
      const { canManagePayroll } = require('./payrollAccess');
      if (!(await canManagePayroll(assignee, businessId, null))) { await t.rollback(); return fail('invalid_transfer_assignee'); }
    }
    const items = await loadItems(businessId, t);
    const itemById = new Map(items.map((it) => [it.id, it]));
    const unresolved = [];
    const negative = [];
    for (const e of entries) {
      const lines = await PayrollEntryLine.findAll({ where: { entry_id: e.id }, transaction: t });
      const finals = {};
      const lineItems = [];
      for (const l of lines) {
        const it = itemById.get(l.pay_item_id);
        if (!it) continue;
        lineItems.push(it);
        finals[it.id] = num(l.final_amount);
        if (it.in_total && l.final_amount === null) unresolved.push({ entry_id: e.id, line_id: l.id, name: e.display_name, item: it.name });
      }
      const tot = calc.totals(lineItems, finals);
      if (run.kind === 'regular' && tot.net_total !== null && tot.net_total < 0) negative.push({ entry_id: e.id, name: e.display_name, net_total: tot.net_total });
      e._tot = tot; e._lines = lines; e._itemById = itemById;
    }
    if (unresolved.length) { await t.rollback(); return fail('line_unresolved', 409, { lines: unresolved.slice(0, 50), count: unresolved.length }); }
    if (negative.length) { await t.rollback(); return fail('negative_net', 409, { entries: negative }); }
    // 동결 — 사람 표시 정보 · 은행 끝 4자리 · 항목 이름
    const people = await PayrollPerson.findAll({ where: { id: entries.map((e) => e.person_id), business_id: businessId }, transaction: t });
    const pById = new Map(people.map((p) => [p.id, p]));
    const depts = await departmentNames(businessId, people.map((p) => p.department_id), t);
    for (const e of entries) {
      const p = pById.get(e.person_id);
      const tot = e._tot;
      await e.update({
        display_name: p?.display_name || e.display_name, employee_no: p?.employee_no ?? e.employee_no,
        job_title: p?.job_title ?? e.job_title, department_name: (p && depts.get(p.department_id)) || e.department_name,
        bank_name_snapshot: p?.bank_name || null, bank_last4: last4Of(p),
        gross_total: tot.gross_total, taxable_total: tot.taxable_total, nontaxable_total: tot.nontaxable_total,
        deduction_total: tot.deduction_total, net_total: tot.net_total,
      }, { transaction: t });
      for (const l of e._lines) {
        const it = e._itemById.get(l.pay_item_id);
        if (it) await l.update({ item_name_snapshot: it.name }, { transaction: t });
      }
    }
    await recalcRunTotals(run, t);
    const from = run.status;
    await run.update({
      status: 'confirmed', confirmed_by: actorId, confirmed_at: new Date(),
      transfer_task_mode: opts.transfer_task_mode === 'single' ? 'single' : (opts.transfer_task_mode === 'per_person' ? 'per_person' : run.transfer_task_mode),
      transfer_assignee_id: assignee,
    }, { transaction: t });
    await history(t, run, from, 'confirmed', actorId);
    await t.commit();
    return { ok: true, data: { run } };
  } catch (e) { await t.rollback(); throw e; }
}

function fmtAmount(n, currency) {
  const zero = calc.minorUnit(currency) === 1;
  return `${Number(n || 0).toLocaleString('ko-KR', { minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 })} ${currency}`;
}

/**
 * 송금 할 일 — 행동 계층 한 문(task_actions.createTask). 멱등: entry.transfer_task_id 가 있으면 건너뛴다.
 *   제목·설명에 **계좌번호 없음**(차인지급액·지급일·은행명만 + 급여 화면 링크). 나만 보기(L1) · 대외비.
 */
async function ensureTransferTasks(businessId, runId, actorId, req) {
  const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId } });
  if (!run || !LOCKED.includes(run.status)) return { ok: false, code: 'not_confirmed' };
  const entries = await PayrollEntry.findAll({ where: { run_id: run.id }, order: [['display_name', 'ASC']] });
  const assignee = run.transfer_assignee_id || run.confirmed_by || actorId;
  const lang = (await User.findByPk(assignee, { attributes: ['language'] }))?.language === 'en' ? 'en' : 'ko';
  const { createTask } = require('./actions/task_actions');
  const actor = { kind: 'user', userId: actorId, req };
  const link = `/payroll/runs/${run.id}`;
  const payDate = run.pay_date ? dateOnlyOf(run.pay_date) : null;
  const adj = run.kind === 'adjustment';
  const label = lang === 'en'
    ? { prefix: '[Payroll]', transfer: 'transfer', adj: ' (adjustment)', net: 'Net pay', date: 'Pay date', bank: 'Bank', open: 'Open payroll', none: '—' }
    : { prefix: '[급여]', transfer: '송금', adj: ' (정정)', net: '차인지급액', date: '지급일', bank: '은행', open: '급여 화면 열기', none: '—' };
  const created = [];
  const toCreate = entries.filter((e) => !e.transfer_task_id && Number(e.net_total) !== 0);
  if (!toCreate.length) return { ok: true, data: { created } };
  const base = { businessId, assigneeId: assignee, dueDate: payDate, vlevel: 'L1', securityLevel: 'confidential' };
  if (run.transfer_task_mode === 'single') {
    const lines = toCreate.map((e) => `- ${e.display_name}: ${fmtAmount(e.net_total, e.currency)}${e.bank_name_snapshot ? ` · ${e.bank_name_snapshot}` : ''}`);
    const r = await createTask(actor, {
      ...base,
      title: `${label.prefix} ${run.period_ym}${adj ? label.adj : ''} ${label.transfer} (${toCreate.length})`,
      description: `<p>${label.date}: ${payDate || label.none}</p><ul>${lines.map((l) => `<li>${escapeHtml(l.slice(2))}</li>`).join('')}</ul><p><a href="${link}">${label.open}</a></p>`,
    });
    if (!r.ok) return { ok: false, code: r.code || 'task_failed' };
    const taskId = r.data?.task?.id || r.task?.id || r.data?.id;
    await PayrollEntry.update({ transfer_task_id: taskId }, { where: { id: toCreate.map((e) => e.id), transfer_task_id: null } });
    created.push(taskId);
  } else {
    for (const e of toCreate) {
      // 다른 요청이 이미 만들었으면 건너뛴다(같은 순간 «다시 만들기» 두 번)
      const fresh = await PayrollEntry.findByPk(e.id, { attributes: ['transfer_task_id'] });
      if (fresh.transfer_task_id) continue;
      const r = await createTask(actor, {
        ...base,
        title: `${label.prefix} ${run.period_ym}${adj ? label.adj : ''} ${e.display_name} ${label.transfer}`,
        description: `<p>${label.net}: ${escapeHtml(fmtAmount(e.net_total, e.currency))}</p><p>${label.date}: ${payDate || label.none}</p><p>${label.bank}: ${escapeHtml(e.bank_name_snapshot || label.none)}</p><p><a href="${link}">${label.open}</a></p>`,
      });
      if (!r.ok) return { ok: false, code: r.code || 'task_failed', data: { created } };
      const taskId = r.data?.task?.id || r.task?.id || r.data?.id;
      const [n] = await PayrollEntry.update({ transfer_task_id: taskId }, { where: { id: e.id, transfer_task_id: null } });
      if (n) created.push(taskId);
    }
  }
  return { ok: true, data: { created } };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 확정 뒤 — 송금 할 일 · 명세서 알림(본인, 메일 없음) · 관리자 알림 · 실시간(개인 방). 하나가 실패해도 나머지는 간다.
 */
async function afterConfirm(businessId, runId, actorId, req) {
  const out = { tasks: null, notified: 0 };
  try {
    out.tasks = await ensureTransferTasks(businessId, runId, actorId, req);
    if (!out.tasks.ok) console.warn('[payroll] confirm side-effect failed: tasks', out.tasks.code);
  } catch (e) { console.warn('[payroll] confirm side-effect failed: tasks', e.message); out.tasks = { ok: false, code: 'task_failed' }; }
  try {
    const run = await PayrollRun.findByPk(runId);
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'owner_id', 'permissions'] });
    const { notify, notifyMany } = require('../routes/notifications');
    const { buildTitle, recipientLang } = require('./notifyTitle');
    const entries = await PayrollEntry.findAll({ where: { run_id: runId }, include: [{ model: PayrollPerson, as: 'person', attributes: ['user_id'] }] });
    const io = req?.app?.get('io');
    for (const e of entries) {
      const uid = e.person?.user_id;
      if (!uid) continue;
      // 지금 이 워크스페이스 멤버인 사람만(내보낸 사람에게 앱 알림을 보내지 않는다)
      const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: uid, removed_at: null }, attributes: ['id'] });
      if (!m) continue;
      const lang = await recipientLang(uid);
      await notify({
        userId: uid, businessId, eventKind: 'payroll',
        title: buildTitle({ feature: 'payroll', action: run.kind === 'adjustment' ? 'payroll_payslip_adjusted' : 'payroll_payslip_ready', subject: run.period_ym, lang }),
        link: `/me/payslips?entry=${e.id}`, workspaceName: biz?.name, actorUserId: actorId,
        entityType: 'payroll_entry', entityId: e.id,
        skipChannels: ['email'],            // 금액이 메일로 나가지 않게 — 앱·푸시만
        previewPolicy: 'internal_only',
      });
      out.notified += 1;
      if (io) io.to(`user:${uid}`).emit('payslip:new', { business_id: businessId, entry_id: e.id });
    }
    // 관리자(대표 + 담당자) — 확정한 사람은 빼고
    const { payrollManagerIds } = require('./payrollAccess');
    const ids = new Set(await payrollManagerIds(biz));
    const owners = await BusinessMember.findAll({ where: { business_id: businessId, role: 'owner', removed_at: null }, attributes: ['user_id'] });
    owners.forEach((o) => ids.add(o.user_id));
    ids.delete(Number(actorId));
    if (ids.size) {
      await notifyMany({
        userIds: [...ids], businessId, eventKind: 'payroll',
        titleSpec: { feature: 'payroll', action: 'payroll_confirmed', subject: run.period_ym },
        link: `/payroll/runs/${runId}`, workspaceName: biz?.name, actorUserId: actorId,
        entityType: 'payroll_run', entityId: runId, skipChannels: ['email'], previewPolicy: 'internal_only',
      });
    }
  } catch (e) { console.warn('[payroll] confirm side-effect failed: notify', e.message); }
  return out;
}

/** 지급완료 — 사람이 누른다(할 일 완료가 자동으로 바꾸지 않는다). 미완료 송금 할 일 수를 돌려준다(확인창은 화면이). */
async function markPaid(businessId, runId, actorId) {
  const t = await sequelize.transaction();
  try {
    const run = await PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!run) { await t.rollback(); return fail('run_not_found', 404); }
    if (run.status !== 'confirmed') { await t.rollback(); return fail(run.status === 'paid' ? 'already_paid' : 'not_confirmed', 409); }
    await run.update({ status: 'paid', paid_by: actorId, paid_at: new Date() }, { transaction: t });
    await history(t, run, 'confirmed', 'paid', actorId);
    await t.commit();
    return { ok: true, data: { run } };
  } catch (e) { await t.rollback(); throw e; }
}

/** 미완료 송금 할 일 수 — 지급완료 확인창 문구용 */
async function openTransferTaskCount(businessId, runId) {
  const ids = (await PayrollEntry.findAll({ where: { run_id: runId, business_id: businessId, transfer_task_id: { [Op.ne]: null } }, attributes: ['transfer_task_id'] })).map((e) => e.transfer_task_id);
  if (!ids.length) return 0;
  const { Task } = require('../models');
  return Task.count({ where: { id: [...new Set(ids)], business_id: businessId, status: { [Op.notIn]: ['completed', 'canceled'] } } });
}

/**
 * 정정 회차 — 같은 달 seq+1. 원 회차(확정·지급완료)는 불변. 고른 사람(없으면 원 회차 전원)의 줄을 빈 칸으로 만든다 —
 *   사람이 «차액» 을 넣는다(음수 허용). 확정 부수효과는 정기와 같다(할 일·명세서 «정정분»).
 */
async function createAdjustment(businessId, runId, actorId, input = {}) {
  const t = await sequelize.transaction();
  try {
    const orig = await PayrollRun.findOne({ where: { id: runId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!orig) { await t.rollback(); return fail('run_not_found', 404); }
    if (!LOCKED.includes(orig.status)) { await t.rollback(); return fail('not_confirmed', 409); }
    const maxSeq = await PayrollRun.max('seq', { where: { business_id: businessId, period_ym: orig.period_ym }, transaction: t });
    // 같은 달에 아직 확정 안 된 정정 회차가 있으면 그것을 쓴다(두 개를 동시에 만들지 않는다)
    const open = await PayrollRun.findOne({ where: { business_id: businessId, period_ym: orig.period_ym, kind: 'adjustment', status: ['draft', 'reconciling'] }, transaction: t });
    if (open) { await t.rollback(); return fail('adjustment_open', 409, { run_id: open.id }); }
    let payDate = input.pay_date ? String(input.pay_date).slice(0, 10) : (orig.pay_date ? dateOnlyOf(orig.pay_date) : null);
    if (payDate && !DATE_RE.test(payDate)) { await t.rollback(); return fail('invalid_pay_date'); }
    const src = await PayrollEntry.findAll({ where: { run_id: orig.id, ...(Array.isArray(input.person_ids) && input.person_ids.length ? { person_id: input.person_ids.map(Number) } : {}) }, transaction: t });
    if (!src.length) { await t.rollback(); return fail('no_entries', 409); }
    const run = await PayrollRun.create({
      business_id: businessId, period_ym: orig.period_ym, seq: (maxSeq || 1) + 1, kind: 'adjustment', pay_date: payDate,
      status: 'draft', adjusts_run_id: orig.id, transfer_task_mode: orig.transfer_task_mode, created_by: actorId,
      note: input.note ? String(input.note).slice(0, 500) : null,
    }, { transaction: t });
    await history(t, run, null, 'draft', actorId, `adjusts run ${orig.id}`);
    for (const s of src) {
      const e = await PayrollEntry.create({
        business_id: businessId, run_id: run.id, person_id: s.person_id, contract_id: s.contract_id,
        display_name: s.display_name, employee_no: s.employee_no, job_title: s.job_title, department_name: s.department_name, currency: s.currency,
      }, { transaction: t });
      // 원 회차에 금액이 있던 항목 + 정률 항목(차액을 따라 다시 센다)의 줄만 — 0 이던 칸까지 늘어놓지 않는다
      const lines = await PayrollEntryLine.findAll({ where: { entry_id: s.id }, attributes: ['pay_item_id', 'final_amount'], transaction: t });
      const rateIds = new Set((await PayItem.findAll({ where: { business_id: businessId, calc: 'rate' }, attributes: ['id'], transaction: t })).map((x) => x.id));
      const keep = lines.filter((l) => (num(l.final_amount) || 0) !== 0 || rateIds.has(l.pay_item_id));
      if (keep.length) await PayrollEntryLine.bulkCreate(keep.map((l) => ({ business_id: businessId, entry_id: e.id, pay_item_id: l.pay_item_id })), { transaction: t });
      const ctx = await entryContext(e, businessId, t);
      await recomputeEntry(e, { ...ctx, t });
    }
    await recalcRunTotals(run, t);
    await t.commit();
    return { ok: true, data: { run } };
  } catch (e) {
    await t.rollback();
    if (e.name === 'SequelizeUniqueConstraintError') return fail('run_exists', 409);
    throw e;
  }
}

module.exports = {
  periodRange, createRun, buildDraft, updateLine, updateEntry, removeEntry, adopt, deleteRun,
  confirm, afterConfirm, ensureTransferTasks, markPaid, openTransferTaskCount, createAdjustment,
  recomputeEntry, recalcRunTotals, entryContext, loadItems, itemsForPerson, LOCKED,
};
