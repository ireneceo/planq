// 업무 «산출물» — 사전·이름 판정·싣기·복사 한 곳 (docs/TASK_DELIVERABLES_DESIGN.md §3.1)
//
//   routes/tasks.js·task_actions.js 는 god-file 이라 본체를 여기 두고 그쪽에는 호출 한 줄씩만 둔다.
//   ★ 업무에 산출물을 실을 때는 반드시 attachOutputKindsTo() 를 쓴다(사본 금지). 목록·공개 공유·게스트에는 싣지 않는다.
const { Op, UniqueConstraintError } = require('sequelize');
const { PRESETS } = require('./taskOutputKindPresets');

const MAX_PER_TASK = 10;
const MAX_CUSTOM_PER_BIZ = 100;
const MAX_NAME = 40;

const PRESET_BY_KEY = new Map(PRESETS.map((p, i) => [p.key, { ...p, order: i }]));

function normalizeName(raw) {
  return String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}
const fold = (s) => normalizeName(s).toLowerCase();
const PRESET_BY_LABEL = new Map();
for (const p of PRESETS) { PRESET_BY_LABEL.set(fold(p.ko), p.key); PRESET_BY_LABEL.set(fold(p.en), p.key); }

function presets() {
  return PRESETS.map((p) => ({ key: p.key, labels: { ko: p.ko, en: p.en } }));
}
function presetKeyOfName(name) { return PRESET_BY_LABEL.get(fold(name)) || null; }
function isPresetKey(key) { return PRESET_BY_KEY.has(String(key || '')); }

async function bizLang(businessId, transaction) {
  const { Business } = require('../models');
  const b = await Business.findByPk(businessId, { attributes: ['default_language'], transaction });
  return b?.default_language === 'en' ? 'en' : 'ko';
}

/** 행 → 응답 모양 { id, name, preset_key, labels? } — labels 는 기본 항목에만 */
function serialize(row) {
  const p = row.preset_key ? PRESET_BY_KEY.get(row.preset_key) : null;
  return {
    id: row.id, name: row.name, preset_key: row.preset_key || null,
    ...(p ? { labels: { ko: p.ko, en: p.en } } : {}),
  };
}
/** 순서 — 기본(코드 순) → 직접 입력(이름순) */
function compare(a, b) {
  const pa = a.preset_key && PRESET_BY_KEY.get(a.preset_key);
  const pb = b.preset_key && PRESET_BY_KEY.get(b.preset_key);
  if (pa && pb) return pa.order - pb.order;
  if (pa) return -1;
  if (pb) return 1;
  return String(a.name).localeCompare(String(b.name));
}

/**
 * §2.3 판정 — 쓰지 않는다.
 * @returns {{kind:'preset', key}|{kind:'row', row}|{kind:'new', name}|{kind:'invalid'}}
 */
async function resolveName(businessId, raw, transaction) {
  const name = normalizeName(raw);
  if (!name || name.length > MAX_NAME) return { kind: 'invalid' };
  const key = presetKeyOfName(name);
  if (key) return { kind: 'preset', key };
  const { TaskOutputKind } = require('../models');
  const row = await TaskOutputKind.findOne({ where: { business_id: businessId, name }, transaction });
  if (row) return { kind: 'row', row };
  return { kind: 'new', name };
}

/** 기본 항목 행 find-or-create (+ 같은 이름의 직접 입력 행이 있으면 입양 — §2.3-5) */
async function ensurePresetRow(businessId, key, userId, transaction) {
  const p = PRESET_BY_KEY.get(key);
  if (!p) return null;
  const { TaskOutputKind } = require('../models');
  const found = await TaskOutputKind.findOne({ where: { business_id: businessId, preset_key: key }, transaction });
  if (found) return { row: found, created: false };
  const adopt = await TaskOutputKind.findOne({
    where: { business_id: businessId, preset_key: null, name: { [Op.in]: [p.ko, p.en] } }, transaction,
  });
  if (adopt) { await adopt.update({ preset_key: key }, { transaction }); return { row: adopt, created: false }; }
  const lang = await bizLang(businessId, transaction);
  try {
    const row = await TaskOutputKind.create({ business_id: businessId, name: p[lang], preset_key: key, created_by: userId }, { transaction });
    return { row, created: true };
  } catch (e) {
    if (!(e instanceof UniqueConstraintError)) throw e;
    // 동시에 누가 만들었다 — 다시 읽는다.
    const again = await TaskOutputKind.findOne({ where: { business_id: businessId, preset_key: key }, transaction });
    if (again) return { row: again, created: false };
    throw e;
  }
}

/**
 * 직접 입력 행 생성 — 이미 있으면 그 행(멱등). 기본 라벨이면 기본 항목 행.
 * @returns {{ok:true,row,created}|{ok:false,code}}
 */
async function createCustom(businessId, raw, userId) {
  const r = await resolveName(businessId, raw);
  if (r.kind === 'invalid') return { ok: false, code: normalizeName(raw) ? 'name_too_long' : 'name_required' };
  if (r.kind === 'preset') { const e = await ensurePresetRow(businessId, r.key, userId); return { ok: true, row: e.row, created: e.created }; }
  if (r.kind === 'row') return { ok: true, row: r.row, created: false };
  const { TaskOutputKind } = require('../models');
  const custom = await TaskOutputKind.count({ where: { business_id: businessId, preset_key: null } });
  if (custom >= MAX_CUSTOM_PER_BIZ) return { ok: false, code: 'output_kind_limit' };
  try {
    const row = await TaskOutputKind.create({ business_id: businessId, name: r.name, preset_key: null, created_by: userId });
    return { ok: true, row, created: true };
  } catch (e) {
    if (!(e instanceof UniqueConstraintError)) throw e;
    const again = await TaskOutputKind.findOne({ where: { business_id: businessId, name: r.name } });
    if (again) return { ok: true, row: again, created: false };
    throw e;
  }
}

/**
 * 이름 배열 → id 배열. 못 푼 이름은 unknown 으로(던지지 않는다 — 부르는 쪽이 정한다).
 * @returns {{ ids:number[], unknown:string[], skipped:string[] }}  skipped = 상한 등으로 못 만든 이름
 */
async function resolveNamesToIds(businessId, names, { userId, allowCreate = false } = {}) {
  const ids = []; const unknown = []; const skipped = [];
  const seen = new Set();
  for (const raw of (Array.isArray(names) ? names : [])) {
    const name = normalizeName(raw);
    if (!name || seen.has(fold(name))) continue;
    seen.add(fold(name));
    const r = await resolveName(businessId, name);
    if (r.kind === 'invalid') { unknown.push(name); continue; }
    if (r.kind === 'preset') { const e = await ensurePresetRow(businessId, r.key, userId); ids.push(e.row.id); continue; }
    if (r.kind === 'row') { ids.push(r.row.id); continue; }
    if (!allowCreate) { unknown.push(name); continue; }
    const c = await createCustom(businessId, name, userId);
    if (c.ok) ids.push(c.row.id); else skipped.push(name);
  }
  return { ids: [...new Set(ids)], unknown, skipped };
}

/** 이름이 전부 풀리는지 — 쓰지 않는다(AI 미리보기용: 확인 카드가 거짓말이 되지 않게). */
async function unknownNames(businessId, names) {
  const out = [];
  for (const raw of (Array.isArray(names) ? names : [])) {
    const r = await resolveName(businessId, raw);
    if (r.kind === 'invalid' || r.kind === 'new') out.push(normalizeName(raw));
  }
  return out;
}

/** AI 가 거절될 때 돌려줄 «쓸 수 있는 이름» — 이 워크스페이스 사전 + 기본 라벨(ko·en), 최대 150 */
async function availableNames(businessId) {
  const { TaskOutputKind } = require('../models');
  const rows = await TaskOutputKind.findAll({ where: { business_id: businessId }, attributes: ['name'], limit: 200 });
  const out = new Set(rows.map((r) => r.name));
  for (const p of PRESETS) { out.add(p.ko); out.add(p.en); }
  return [...out].slice(0, 150);
}

/** 업무 행들에 output_kinds 를 싣는다 — task_id IN (...) 배치 1회. 사전 쪽에도 business_id 조건(이중 방어). */
async function attachOutputKindsTo(rows, businessId) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map((r) => Number(r.id)).filter(Boolean);
  if (!ids.length) return rows;
  const { TaskOutputKind, TaskOutputKindLink } = require('../models');
  const links = await TaskOutputKindLink.findAll({
    where: { task_id: { [Op.in]: ids } },
    include: [{
      model: TaskOutputKind, as: 'kind', attributes: ['id', 'name', 'preset_key'], required: true,
      ...(businessId ? { where: { business_id: Number(businessId) } } : {}),
    }],
  });
  const byTask = new Map();
  for (const l of links) {
    if (!l.kind) continue;
    if (!byTask.has(l.task_id)) byTask.set(l.task_id, []);
    byTask.get(l.task_id).push(serialize(l.kind));
  }
  for (const list of byTask.values()) list.sort(compare);
  for (const r of rows) r.output_kinds = byTask.get(Number(r.id)) || [];
  return rows;
}

/** 연결 그대로 복사 — 반복 회차·업무 복사가 같이 쓴다 */
async function copyLinks(fromTaskId, toTaskId, transaction) {
  const { TaskOutputKindLink } = require('../models');
  const src = await TaskOutputKindLink.findAll({ where: { task_id: fromTaskId }, attributes: ['output_kind_id'], transaction });
  if (!src.length) return 0;
  await TaskOutputKindLink.bulkCreate(
    src.map((l) => ({ task_id: toTaskId, output_kind_id: l.output_kind_id })),
    { ignoreDuplicates: true, transaction },
  );
  return src.length;
}

/** 이 워크스페이스 사전 id 인지 검증 — 정리된 id 배열 또는 code */
async function validateIds(businessId, rawIds, transaction) {
  const wanted = [...new Set((Array.isArray(rawIds) ? rawIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (wanted.length > MAX_PER_TASK) return { ok: false, code: 'too_many_output_kinds' };
  if (!wanted.length) return { ok: true, ids: [] };
  const { TaskOutputKind } = require('../models');
  const valid = await TaskOutputKind.findAll({ where: { id: { [Op.in]: wanted }, business_id: businessId }, attributes: ['id'], transaction });
  if (valid.length !== wanted.length) return { ok: false, code: 'unknown_output_kinds' };
  return { ok: true, ids: wanted };
}

/** 생성 트랜잭션 안에서 연결 — 어긋나면 actionCode 달아 throw (태그 생성 블록과 같은 방식) */
async function linkOnCreate(task, rawIds, businessId, transaction) {
  const v = await validateIds(businessId, rawIds, transaction);
  if (!v.ok) throw Object.assign(new Error(v.code), { actionCode: v.code });
  if (!v.ids.length) return;
  const { TaskOutputKindLink } = require('../models');
  await TaskOutputKindLink.bulkCreate(v.ids.map((output_kind_id) => ({ task_id: task.id, output_kind_id })), { transaction });
}

module.exports = {
  MAX_PER_TASK, MAX_CUSTOM_PER_BIZ, MAX_NAME,
  presets, normalizeName, presetKeyOfName, isPresetKey, serialize, compare,
  resolveName, ensurePresetRow, createCustom, resolveNamesToIds, unknownNames, availableNames,
  attachOutputKindsTo, copyLinks, validateIds, linkOnCreate,
};
