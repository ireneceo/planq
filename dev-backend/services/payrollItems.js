// 급여 항목 — 만들기·고치기·끄기·프리셋 불러오기·AI 틀 제안 (docs/PAYROLL_DESIGN.md §3.3 · §7.1)
//   라우트(routes/payroll_items.js)는 검사·응답만 하고 규칙은 여기 한 곳이다.
//   ★ 요율을 코드가 제공하지 않는다 — 프리셋에는 구조만, AI 제안의 요율은 버린다(법정은 external 로 강제).
//   ★ 쓰인 항목(계약 금액줄·회차 줄)은 지우지 못하고 끈다(is_active=false). 확정된 회차가 쓰는 항목은
//     «돈의 뜻» 을 바꾸는 칸(지급/공제·부호·합계 포함·과세)을 고칠 수 없다(409 item_locked) — 이름은 확정 때 동결돼 괜찮다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { PayItem, ContractPayLine, PayrollEntryLine, PayrollEntry, PayrollRun } = require('../models');
const { findRateCycle } = require('./payrollCalc');
const { PRESETS } = require('../config/payrollPresets');

const SIDES = ['earning', 'deduction'];
const APPLIES = ['all', 'employment', 'business', 'other'];
const CALCS = ['fixed', 'rate', 'manual', 'external', 'unpaid_leave'];
const RATE_BASES = ['taxable_total', 'gross_total', 'item'];
const ROUNDINGS = ['round', 'floor', 'ceil'];
const UNITS = [1, 10, 100, 1000];
const MONEY_MEANING = ['side', 'sign', 'in_total', 'taxable', 'applies_to'];

const fail = (code, http = 400) => ({ ok: false, code, http });
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

function serializeItem(it) {
  const j = typeof it.toJSON === 'function' ? it.toJSON() : { ...it };
  j.rate = j.rate === null || j.rate === undefined ? null : Number(j.rate);
  j.aliases = Array.isArray(j.aliases) ? j.aliases : [];
  return j;
}

async function listItems(businessId, { includeInactive = true } = {}) {
  const where = { business_id: businessId };
  if (!includeInactive) where.is_active = true;
  const rows = await PayItem.findAll({ where, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  const ids = rows.map((r) => r.id);
  // 쓰임 — 계약 금액줄 수 · 회차 줄 수 (지우기 가능 여부를 화면이 미리 안다)
  const used = new Map(ids.map((id) => [id, 0]));
  if (ids.length) {
    const [a] = await sequelize.query('SELECT pay_item_id id, COUNT(*) n FROM contract_pay_lines WHERE business_id = ? AND pay_item_id IN (?) GROUP BY pay_item_id', { replacements: [businessId, ids] });
    const [b] = await sequelize.query('SELECT pay_item_id id, COUNT(*) n FROM payroll_entry_lines WHERE business_id = ? AND pay_item_id IN (?) GROUP BY pay_item_id', { replacements: [businessId, ids] });
    for (const r of [...a, ...b]) used.set(r.id, (used.get(r.id) || 0) + Number(r.n));
  }
  return rows.map((r) => ({ ...serializeItem(r), used_count: used.get(r.id) || 0 }));
}

async function lockedByConfirmedRun(businessId, itemId) {
  const n = await PayrollEntryLine.count({
    where: { business_id: businessId, pay_item_id: itemId },
    include: [{ model: PayrollEntry, as: 'entry', attributes: [], required: true,
      include: [{ model: PayrollRun, as: 'run', attributes: [], required: true, where: { status: ['confirmed', 'paid'] } }] }],
  });
  return n > 0;
}

/** 입력 정규화 — 만들기·고치기가 같은 함수. existing 이 있으면 부분 갱신. */
async function normalize(businessId, input, existing) {
  const out = {};
  const pick = (k) => input[k] !== undefined;
  const cur = (k) => (pick(k) ? input[k] : existing?.[k]);
  if (pick('name') || !existing) {
    const n = String(input.name || '').trim().slice(0, 100);
    if (!n) return fail('name_required');
    out.name = n;
  }
  if (pick('name_en')) out.name_en = input.name_en ? String(input.name_en).trim().slice(0, 100) : null;
  if (pick('side') || !existing) { if (!SIDES.includes(input.side)) return fail('invalid_side'); out.side = input.side; }
  if (pick('applies_to')) { if (!APPLIES.includes(input.applies_to)) return fail('invalid_applies_to'); out.applies_to = input.applies_to; }
  if (pick('calc') || !existing) { if (!CALCS.includes(input.calc || 'fixed')) return fail('invalid_calc'); out.calc = input.calc || 'fixed'; }
  for (const k of ['taxable', 'in_total', 'is_settlement', 'is_statutory', 'is_active']) if (pick(k)) out[k] = bool(input[k]);
  if (pick('sign')) { if (!['plus', 'minus'].includes(input.sign)) return fail('invalid_sign'); out.sign = input.sign; }
  if (pick('rounding')) { if (!ROUNDINGS.includes(input.rounding)) return fail('invalid_rounding'); out.rounding = input.rounding; }
  if (pick('rounding_unit')) { const u = Number(input.rounding_unit); if (!UNITS.includes(u)) return fail('invalid_rounding_unit'); out.rounding_unit = u; }
  if (pick('sort_order')) { const n = Number(input.sort_order); if (!Number.isInteger(n) || n < 0 || n > 9999) return fail('invalid_sort_order'); out.sort_order = n; }
  if (pick('aliases')) {
    const a = Array.isArray(input.aliases) ? input.aliases : String(input.aliases || '').split(',');
    out.aliases = [...new Set(a.map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
  }
  const calc = out.calc ?? existing?.calc ?? 'fixed';
  // 정률 — 요율·기준
  if (calc === 'rate') {
    const rate = Number(cur('rate'));
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return fail('invalid_rate');
    const base = cur('rate_base');
    if (!RATE_BASES.includes(base)) return fail('invalid_rate_base');
    out.rate = rate; out.rate_base = base;
    if (base === 'item') {
      const bid = Number(cur('base_item_id'));
      if (!Number.isInteger(bid) || bid <= 0 || bid === Number(existing?.id)) return fail('invalid_base_item');
      const b = await PayItem.findOne({ where: { id: bid, business_id: businessId }, attributes: ['id'] });
      if (!b) return fail('invalid_base_item');
      out.base_item_id = bid;
    } else out.base_item_id = null;
  } else if (pick('calc')) { out.rate = null; out.rate_base = null; out.base_item_id = null; }
  // 정산분은 언제나 외부(대장 값) — 설계 §6.5
  const settle = out.is_settlement ?? existing?.is_settlement;
  if (settle && calc !== 'external') return fail('settlement_must_be_external');
  // 무급휴가 일할은 공제편만
  const side = out.side ?? existing?.side;
  if (calc === 'unpaid_leave' && side !== 'deduction') return fail('unpaid_leave_must_be_deduction');
  return { ok: true, data: out };
}

async function assertNoCycle(businessId, candidate) {
  const rows = (await PayItem.findAll({ where: { business_id: businessId }, attributes: ['id', 'calc', 'rate_base', 'base_item_id'] })).map((r) => r.toJSON());
  const merged = rows.filter((r) => r.id !== candidate.id).concat([candidate]);
  return findRateCycle(merged).length === 0;
}

async function nextCustomCode(businessId, t) {
  const rows = await PayItem.findAll({ where: { business_id: businessId, code: { [Op.like]: 'custom_%' } }, attributes: ['code'], transaction: t });
  const max = rows.map((r) => Number(String(r.code).slice(7)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `custom_${max + 1}`;
}

async function createItem(businessId, input) {
  const n = await normalize(businessId, input, null);
  if (!n.ok) return n;
  const maxSort = (await PayItem.max('sort_order', { where: { business_id: businessId } })) || 0;
  const t = await sequelize.transaction();
  try {
    const code = await nextCustomCode(businessId, t);
    const row = { taxable: n.data.side === 'earning', ...n.data, business_id: businessId, code, sort_order: n.data.sort_order ?? maxSort + 10 };
    if (row.calc === 'rate' && !(await assertNoCycle(businessId, { id: -1, ...row }))) { await t.rollback(); return fail('rate_cycle', 409); }
    const it = await PayItem.create(row, { transaction: t });
    await t.commit();
    return { ok: true, data: serializeItem(it) };
  } catch (e) { await t.rollback(); throw e; }
}

async function updateItem(businessId, itemId, input) {
  const it = await PayItem.findOne({ where: { id: itemId, business_id: businessId } });
  if (!it) return fail('item_not_found', 404);
  const n = await normalize(businessId, input, it.toJSON());
  if (!n.ok) return n;
  const d = n.data;
  if (!Object.keys(d).length) return fail('nothing_to_update');
  // 기본급은 무급휴가 일할의 기준이라 고정·지급을 벗어나지 못한다
  if (it.code === 'base' && ((d.calc && d.calc !== 'fixed') || (d.side && d.side !== 'earning'))) return fail('base_item_locked', 409);
  const changesMeaning = MONEY_MEANING.some((k) => d[k] !== undefined && String(d[k]) !== String(it.get(k)));
  if (changesMeaning && await lockedByConfirmedRun(businessId, it.id)) return fail('item_locked', 409);
  if ((d.calc ?? it.calc) === 'rate' && !(await assertNoCycle(businessId, { ...it.toJSON(), ...d }))) return fail('rate_cycle', 409);
  // 고정이 아니게 바꾸려면 계약 금액줄에서 먼저 빠져야 한다(계약이 «고정 항목만» 이라는 규칙)
  if (d.calc && d.calc !== 'fixed' && it.calc === 'fixed') {
    const lines = await ContractPayLine.count({ where: { business_id: businessId, pay_item_id: it.id } });
    if (lines) return fail('item_in_contracts', 409);
  }
  const before = serializeItem(it);
  await it.update(d);
  return { ok: true, data: serializeItem(it), before };
}

/** 지우기 — 한 번도 쓰이지 않은 항목만. 쓰였으면 409(끄기를 쓴다). */
async function deleteItem(businessId, itemId) {
  const it = await PayItem.findOne({ where: { id: itemId, business_id: businessId } });
  if (!it) return fail('item_not_found', 404);
  if (it.code === 'base') return fail('base_item_locked', 409);
  const used = (await ContractPayLine.count({ where: { business_id: businessId, pay_item_id: it.id } }))
    + (await PayrollEntryLine.count({ where: { business_id: businessId, pay_item_id: it.id } }))
    + (await PayItem.count({ where: { business_id: businessId, base_item_id: it.id } }));
  if (used) return fail('item_in_use', 409);
  const before = serializeItem(it);
  await it.destroy();
  return { ok: true, data: { id: itemId }, before };
}

/**
 * 프리셋 불러오기 — 이미 같은 code 가 있으면 건너뛴다(멱등). 정률의 «다른 항목 기준» 은 code → id 로 바꾼다.
 * @returns { created:[...], skipped:[code] }
 */
async function applyPreset(businessId, presetKey, { codes } = {}) {
  const preset = PRESETS[presetKey];
  if (!preset) return fail('unknown_preset', 404);
  const wanted = Array.isArray(codes) && codes.length ? preset.items.filter((x) => codes.includes(x.code)) : preset.items;
  const t = await sequelize.transaction();
  try {
    const existing = await PayItem.findAll({ where: { business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    const byCode = new Map(existing.map((e) => [e.code, e]));
    let sort = existing.reduce((m, e) => Math.max(m, e.sort_order || 0), 0);
    const created = [], skipped = [];
    for (const p of wanted) {
      if (byCode.has(p.code)) { skipped.push(p.code); continue; }
      sort += 10;
      const { base_code: baseCode, ...rest } = p;
      let baseItemId = null;
      if (rest.calc === 'rate' && rest.rate_base === 'item') {
        const b = byCode.get(baseCode);
        if (!b) { skipped.push(p.code); continue; }
        baseItemId = b.id;
      }
      const row = await PayItem.create({
        business_id: businessId, sign: 'plus', in_total: true, is_settlement: false, is_statutory: false,
        rounding: 'round', rounding_unit: 1, ...rest, base_item_id: baseItemId, sort_order: sort, preset_source: presetKey.slice(0, 20),
      }, { transaction: t });
      byCode.set(p.code, row);
      created.push(serializeItem(row));
    }
    await t.commit();
    return { ok: true, data: { created, skipped } };
  } catch (e) { await t.rollback(); throw e; }
}

/** 프리셋 미리보기(저장 안 함) — 이미 있는 code 는 exists:true */
async function previewPreset(businessId, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return fail('unknown_preset', 404);
  const have = new Set((await PayItem.findAll({ where: { business_id: businessId }, attributes: ['code'] })).map((r) => r.code));
  return { ok: true, data: { key: presetKey, label: preset.label, items: preset.items.map((x) => ({ ...x, exists: have.has(x.code) })) } };
}

/**
 * AI 틀 제안 — 프리셋이 없는 나라·형태만. 저장하지 않는다(사람이 고쳐 «추가» 해야 들어간다).
 *   보내는 것: 나라 · 고용형태 · (있으면) 대장 머리글. 사람·금액은 보내지 않는다.
 *   ★ 요율이 와도 버린다 — 정률을 제안해도 external 로 바꿔 돌려준다(요율은 사람이 직접 넣는다).
 *   LLM 이 꺼져 있으면 generic 프리셋을 돌려준다(fallback:true).
 */
async function suggestItems({ country, employmentKind, headers }) {
  const generic = PRESETS.generic.items.map((x) => ({ ...x }));
  const { callLLM } = require('./llm');
  const hdr = (Array.isArray(headers) ? headers : []).map((h) => String(h).replace(/\d{6}-?\d{7}/g, '***').slice(0, 40)).slice(0, 60);
  const r = await callLLM({
    purpose: 'payroll_preset',
    json: true,
    fallback: '',
    messages: [
      { role: 'system', content: 'You design payroll line-item templates. Output JSON {"items":[{"name":"","name_en":"","side":"earning|deduction","taxable":true,"calc":"fixed|manual|external","sign":"plus|minus","applies_to":"all|employment|business|other","is_statutory":false,"aliases":[]}]} only. Never output rates or amounts. Statutory deductions (social insurance, income tax) must be calc "external". Max 20 items. Use the local language for "name".' },
      { role: 'user', content: JSON.stringify({ country: String(country || '').slice(0, 2), employment: String(employmentKind || 'employment').slice(0, 20), register_headers: hdr }) },
    ],
  });
  const llm = { model: r.model, input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0 };
  if (r.fallback || !r.content) return { items: generic, fallback: true };
  let parsed;
  try { parsed = JSON.parse(r.content); } catch { return { items: generic, fallback: true, llm }; }
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 20).map((x) => {
    const side = SIDES.includes(x.side) ? x.side : 'deduction';
    let calc = ['fixed', 'manual', 'external'].includes(x.calc) ? x.calc : 'manual';
    const statutory = !!x.is_statutory;
    if (statutory && side === 'deduction') calc = 'external';
    return {
      name: String(x.name || '').trim().slice(0, 100), name_en: x.name_en ? String(x.name_en).trim().slice(0, 100) : null,
      side, taxable: side === 'earning' ? x.taxable !== false : false, calc,
      sign: x.sign === 'minus' ? 'minus' : 'plus', applies_to: APPLIES.includes(x.applies_to) ? x.applies_to : 'all',
      is_statutory: statutory, aliases: (Array.isArray(x.aliases) ? x.aliases : []).map((a) => String(a).slice(0, 60)).slice(0, 10),
    };
  }).filter((x) => x.name);
  if (!items.length) return { items: generic, fallback: true, llm };
  return { items, fallback: false, llm };
}

module.exports = {
  SIDES, APPLIES, CALCS, serializeItem, listItems, createItem, updateItem, deleteItem,
  applyPreset, previewPreset, suggestItems, lockedByConfirmedRun,
};
