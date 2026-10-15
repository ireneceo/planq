// 계약 — 만들기·고치기·활성·종료·서명 연결·월급 정본 (docs/PAYROLL_DESIGN.md §3.2·§5.5·§8)
//   전이는 이 파일 한 곳에서만 일어난다. 라우트(routes/payroll.js)는 검사·응답만 한다.
//   ★ «한 사람에게 같은 날 유효(active)한 계약은 하나» — activate 가 겹친 옛 계약을 superseded 로 닫는다.
//   ★ 서명은 계약 활성의 조건이 아니다(종이·구두 계약도 급여는 나간다). 서명이 끝나면 signed_at 만 찍는다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { PayrollPerson, EmploymentContract, PayItem, ContractPayLine, Business } = require('../models');
const { addDaysStr, todayInTz } = require('../utils/datetime');
const { dateOnlyOf } = require('../utils/dateOnly');   // DATEONLY 는 문자열·Date 둘 다로 온다 — String().slice 금지

const KINDS = ['regular', 'fixed_term', 'freelance'];
const AMOUNT_MAX = 10_000_000_000;   // 100억 — 오타(0 하나 더) 방지 상한
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (code, http = 400) => ({ ok: false, code, http });

/** 시스템 기본 항목 «기본급»(code 'base') — 없으면 만든다(멱등). P2 의 항목 목록도 이 행을 쓴다. */
async function ensureBaseItem(businessId, transaction) {
  const [item] = await PayItem.findOrCreate({
    where: { business_id: businessId, code: 'base' },
    defaults: {
      business_id: businessId, code: 'base', name: '기본급', name_en: 'Base pay',
      side: 'earning', taxable: true, calc: 'fixed', sort_order: 0, aliases: ['기본급', '기본 급여', 'Base pay'],
    },
    transaction,
  });
  return item;
}

function cleanDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).slice(0, 10);
  return DATE_RE.test(s) ? s : undefined;   // undefined = 형식 오류
}

/**
 * 입력 정규화 — 만들기·고치기가 같은 함수를 쓴다.
 * lines: [{ pay_item_id, amount }] — 같은 워크스페이스의 활성 «고정(fixed)» 항목만.
 * base_pay: 편의 입력(P1 화면) — 있으면 기본급 줄로 바뀐다.
 */
async function normalize(businessId, input, { partial = false } = {}) {
  const out = {};
  if (input.kind !== undefined || !partial) {
    if (!KINDS.includes(input.kind)) return fail('invalid_kind');
    out.kind = input.kind;
  }
  for (const k of ['start_date', 'end_date']) {
    if (input[k] === undefined) continue;
    const d = cleanDate(input[k]);
    if (d === undefined) return fail(`invalid_${k}`);
    out[k] = d;
  }
  if (!partial && !out.start_date) return fail('start_date_required');
  if (input.weekly_work_days !== undefined) {
    const n = input.weekly_work_days === null || input.weekly_work_days === '' ? null : Number(input.weekly_work_days);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 7)) return fail('invalid_weekly_work_days');
    out.weekly_work_days = n;
  }
  if (input.daily_work_hours !== undefined) {
    const n = input.daily_work_hours === null || input.daily_work_hours === '' ? null : Number(input.daily_work_hours);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 24)) return fail('invalid_daily_work_hours');
    out.daily_work_hours = n;
  }
  if (input.pay_day !== undefined) {
    const n = input.pay_day === null || input.pay_day === '' ? null : Number(input.pay_day);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 31)) return fail('invalid_pay_day');
    out.pay_day = n;
  }
  if (input.currency !== undefined) {
    const c = String(input.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return fail('invalid_currency');
    out.currency = c;
  }
  if (input.note !== undefined) out.note = input.note === null ? null : String(input.note).slice(0, 500);
  if (input.post_id !== undefined) {
    const n = input.post_id === null || input.post_id === '' ? null : Number(input.post_id);
    if (n !== null && (!Number.isInteger(n) || n <= 0)) return fail('invalid_post_id');
    if (n !== null) {
      // 같은 워크스페이스 문서만 걸 수 있다(남의 문서 id 를 섞어 보내는 경로가 곧 누수다)
      const { Post } = require('../models');
      const post = await Post.findOne({ where: { id: n, business_id: businessId }, attributes: ['id'] });
      if (!post) return fail('post_not_found', 404);
    }
    out.post_id = n;
  }
  const s = out.start_date, e = out.end_date;
  if (s && e && e < s) return fail('end_before_start');

  // 금액줄
  let lines;
  if (Array.isArray(input.lines)) lines = input.lines;
  else if (input.base_pay !== undefined) {
    const base = await ensureBaseItem(businessId);
    lines = [{ pay_item_id: base.id, amount: input.base_pay }];
  }
  if (lines) {
    const ids = lines.map((l) => Number(l?.pay_item_id));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0) || new Set(ids).size !== ids.length) return fail('invalid_lines');
    const items = ids.length ? await PayItem.findAll({ where: { id: ids, business_id: businessId, is_active: true, calc: 'fixed' }, attributes: ['id'] }) : [];
    if (items.length !== ids.length) return fail('unknown_pay_items');
    const clean = [];
    for (const l of lines) {
      const a = Number(String(l.amount ?? '').replace(/,/g, ''));
      if (!Number.isFinite(a) || a < 0 || a > AMOUNT_MAX) return fail('invalid_amount');
      clean.push({ pay_item_id: Number(l.pay_item_id), amount: Math.round(a * 100) / 100 });
    }
    out.lines = clean;
  }
  return { ok: true, data: out };
}

async function writeLines(businessId, contractId, lines, transaction) {
  await ContractPayLine.destroy({ where: { contract_id: contractId }, transaction });
  if (lines.length) {
    await ContractPayLine.bulkCreate(lines.map((l) => ({ ...l, business_id: businessId, contract_id: contractId })), { transaction });
  }
}

async function loadContract(businessId, contractId, transaction) {
  return EmploymentContract.findOne({
    where: { id: contractId, business_id: businessId },
    include: [{ model: ContractPayLine, as: 'lines', include: [{ model: PayItem, as: 'item', attributes: ['id', 'code', 'name', 'name_en', 'side', 'taxable'] }] }],
    transaction,
  });
}

/** 새 계약(초안). 근무조건 기본값은 그 사람의 멤버 설정 → 없으면 5일·8시간. */
async function createContract(businessId, personId, input, actorUserId) {
  const person = await PayrollPerson.findOne({ where: { id: personId, business_id: businessId } });
  if (!person) return fail('person_not_found', 404);
  const n = await normalize(businessId, { ...input, kind: input.kind || (person.income_kind === 'business' ? 'freelance' : 'regular') });
  if (!n.ok) return n;
  const d = n.data;
  if (d.kind === 'fixed_term' && !d.end_date) return fail('end_date_required');
  let defaults = { weekly_work_days: 5, daily_work_hours: 8 };
  if (person.user_id) {
    const { BusinessMember } = require('../models');
    const bm = await BusinessMember.findOne({ where: { business_id: businessId, user_id: person.user_id }, attributes: ['weekly_work_days', 'daily_work_hours'] });
    if (bm) defaults = { weekly_work_days: bm.weekly_work_days ?? 5, daily_work_hours: bm.daily_work_hours != null ? Number(bm.daily_work_hours) : 8 };
  }
  const biz = await Business.findByPk(businessId, { attributes: ['default_currency'] });
  const t = await sequelize.transaction();
  try {
    const c = await EmploymentContract.create({
      business_id: businessId, person_id: person.id, kind: d.kind,
      start_date: d.start_date, end_date: d.end_date ?? null,
      weekly_work_days: d.weekly_work_days !== undefined ? d.weekly_work_days : defaults.weekly_work_days,
      daily_work_hours: d.daily_work_hours !== undefined ? d.daily_work_hours : defaults.daily_work_hours,
      currency: d.currency || biz?.default_currency || 'KRW',
      pay_day: d.pay_day ?? null, post_id: d.post_id ?? null, note: d.note ?? null,
      status: 'draft', created_by: actorUserId,
    }, { transaction: t });
    if (d.lines) await writeLines(businessId, c.id, d.lines, t);
    await t.commit();
    return { ok: true, data: await loadContract(businessId, c.id) };
  } catch (e) { await t.rollback(); throw e; }
}

/** 고치기 — 초안은 전부, 활성·종료된 계약은 메모·계약서 문서·지급일만(금액·기간이 바뀌면 새 계약이다). */
async function updateContract(businessId, contractId, input) {
  const c = await EmploymentContract.findOne({ where: { id: contractId, business_id: businessId } });
  if (!c) return fail('contract_not_found', 404);
  const n = await normalize(businessId, input, { partial: true });
  if (!n.ok) return n;
  const d = n.data;
  if (c.status !== 'draft') {
    const allowed = ['note', 'post_id', 'pay_day'];
    const bad = Object.keys(d).filter((k) => !allowed.includes(k));
    if (bad.length) return fail('contract_locked', 409);
  }
  const start = d.start_date ?? dateOnlyOf(c.start_date);
  const end = d.end_date !== undefined ? d.end_date : (c.end_date ? dateOnlyOf(c.end_date) : null);
  if (end && start && end < start) return fail('end_before_start');
  if ((d.kind ?? c.kind) === 'fixed_term' && !end) return fail('end_date_required');
  const t = await sequelize.transaction();
  try {
    const { lines, ...cols } = d;
    if (Object.keys(cols).length) await c.update(cols, { transaction: t });
    if (lines) await writeLines(businessId, c.id, lines, t);
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  return { ok: true, data: await loadContract(businessId, c.id) };
}

/** 활성 — 겹치는 옛 활성 계약은 새 시작 전날로 닫고 superseded. 같은 날(또는 뒤) 시작한 활성 계약이 있으면 409. */
async function activate(businessId, contractId) {
  const t = await sequelize.transaction();
  try {
    const c = await EmploymentContract.findOne({ where: { id: contractId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!c) { await t.rollback(); return fail('contract_not_found', 404); }
    if (c.status !== 'draft') { await t.rollback(); return fail('not_draft', 409); }
    const others = await EmploymentContract.findAll({
      where: { business_id: businessId, person_id: c.person_id, status: 'active', id: { [Op.ne]: c.id } },
      transaction: t, lock: t.LOCK.UPDATE,
    });
    const superseded = [];
    for (const o of others) {
      const oStart = dateOnlyOf(o.start_date), cStart = dateOnlyOf(c.start_date);
      const oEnd = o.end_date ? dateOnlyOf(o.end_date) : null;
      if (oEnd && oEnd < cStart) continue;              // 이미 끝난 기간 — 겹치지 않는다
      if (oStart >= cStart) { await t.rollback(); return fail('overlapping_contract', 409); }
      await o.update({ end_date: addDaysStr(cStart, -1), status: 'superseded' }, { transaction: t });
      superseded.push(o.id);
    }
    await c.update({ status: 'active' }, { transaction: t });
    await t.commit();
    return { ok: true, data: { contract: await loadContract(businessId, c.id), superseded } };
  } catch (e) { await t.rollback(); throw e; }
}

/** 종료 — 활성 계약에 종료일을 확정한다. */
async function endContract(businessId, contractId, endDate) {
  const c = await EmploymentContract.findOne({ where: { id: contractId, business_id: businessId } });
  if (!c) return fail('contract_not_found', 404);
  if (c.status !== 'active') return fail('not_active', 409);
  const d = cleanDate(endDate);
  if (!d) return fail('invalid_end_date');
  if (d < dateOnlyOf(c.start_date)) return fail('end_before_start');
  await c.update({ end_date: d, status: 'ended' });
  return { ok: true, data: await loadContract(businessId, c.id) };
}

/** 초안만 지울 수 있다(활성·종료된 계약은 이력이다). */
async function deleteDraft(businessId, contractId) {
  const c = await EmploymentContract.findOne({ where: { id: contractId, business_id: businessId } });
  if (!c) return fail('contract_not_found', 404);
  if (c.status !== 'draft') return fail('not_draft', 409);
  await c.destroy();
  return { ok: true, data: { id: contractId } };
}

/**
 * 서명 훅 — signatures.js·signature_internal.js 가 projectStageEngine.onSignatureChanged 옆에서 부른다.
 * 그 문서를 가리키는 계약이 있고, 그 문서의 살아 있는 서명 요청이 **모두 signed** 이면 signed_at 을 찍는다.
 */
async function onSignatureChanged(signatureRequestId) {
  const { SignatureRequest } = require('../models');
  const sr = await SignatureRequest.findByPk(signatureRequestId, { attributes: ['id', 'entity_type', 'entity_id'] });
  if (!sr || sr.entity_type !== 'post') return;
  const contracts = await EmploymentContract.findAll({ where: { post_id: sr.entity_id, signed_at: null } });
  if (!contracts.length) return;
  const reqs = await SignatureRequest.findAll({ where: { entity_type: 'post', entity_id: sr.entity_id }, attributes: ['status'] });
  const live = reqs.filter((r) => !['canceled', 'expired', 'rejected'].includes(r.status));
  if (!live.length || !live.every((r) => r.status === 'signed')) return;
  const now = new Date();
  for (const c of contracts) await c.update({ signed_at: now });
}

/**
 * 월급 정본 (설계 §8 (a)안) — 유효 계약의 «고정 지급 줄» 합. user_id 가 있는 사람만.
 * 모듈이 꺼져 있으면 빈 Map(호출자 memberCost 가 옛 컬럼으로 돌아간다).
 * @returns Map<user_id, { monthly, currency, contract_id }>
 */
async function activeMonthlyPayByUser(businessId, asOf) {
  const out = new Map();
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'modules', 'timezone'] });
  if (!biz || !require('./modules').moduleOn(biz, 'payroll')) return out;
  const day = asOf || todayInTz(biz.timezone || 'Asia/Seoul');
  const contracts = await EmploymentContract.findAll({
    where: {
      business_id: businessId, status: 'active', start_date: { [Op.lte]: day },
      [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: day } }],
    },
    include: [
      { model: PayrollPerson, as: 'person', attributes: ['id', 'user_id'], where: { user_id: { [Op.ne]: null } } },
      { model: ContractPayLine, as: 'lines', include: [{ model: PayItem, as: 'item', attributes: ['side', 'in_total'] }] },
    ],
  });
  for (const c of contracts) {
    const monthly = (c.lines || [])
      .filter((l) => l.item && l.item.side === 'earning' && l.item.in_total !== false)
      .reduce((s, l) => s + Number(l.amount || 0), 0);
    out.set(c.person.user_id, { monthly, currency: c.currency, contract_id: c.id });
  }
  return out;
}

module.exports = {
  KINDS, ensureBaseItem, normalize, loadContract, createContract, updateContract,
  activate, endContract, deleteDraft, onSignatureChanged, activeMonthlyPayByUser,
};
