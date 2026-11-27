// 일정 분류를 읽고 쓰는 **문 하나** (2026-11-27) — 설계 docs/CALENDAR_CATEGORIES_DESIGN.md
//
// ★ 일정의 분류 정본은 calendar_events.category_id. category(ENUM)는 거울 — 시스템이면 그 code, 커스텀이면 'other'.
//   category_id 가 NULL 인 옛 행은 같은 business 의 code = category 행으로 읽는다(readRef).
// ★ 분류 id 를 받는 모든 문은 business_id 를 WHERE 에 건다 — 남의 워크스페이스 id 는 «없는 분류».
// ★ 권한: 읽기 = 멤버 · 추가 = 멤버 누구나 · 이름·색·켜고 끄기·순서·삭제 = owner/admin(canManage 한 곳).
// ★ 감사·방송은 여기 안에서. 방송은 신호만(`calendar_category:updated {business_id}`).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { CalendarCategory, CalendarEvent } = require('../models');
const { writeAudit } = require('./auditService');

/** 화면 순서 = 옛 CATEGORY_OPTIONS 순서 그대로 */
const SYSTEM = [
  { code: 'meeting', sort_order: 0 },
  { code: 'work', sort_order: 1 },
  { code: 'deadline', sort_order: 2 },
  { code: 'personal', sort_order: 3 },
  { code: 'other', sort_order: 4 },
];
const SYSTEM_CODES = new Set(SYSTEM.map((s) => s.code));
/** 서버가 글자를 만드는 곳(AI 도구·내보내기·공개 화면)의 기본 이름 — 화면은 i18n qcalendar category.<code> */
const LABELS = {
  ko: { personal: '개인', work: '업무', meeting: '미팅', deadline: '마감', other: '기타' },
  en: { personal: 'Personal', work: 'Work', meeting: 'Meeting', deadline: 'Deadline', other: 'Other' },
};
/** 화면 스와치와 같은 10색 — 새 커스텀 분류의 기본 색(안 쓰인 첫 색) */
const SWATCHES = ['#0D9488', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#475569'];
const CUSTOM_LIMIT = 30;
const NAME_MAX = 30;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

class CalendarCategoryError extends Error {
  constructor(code, status = 400, extra = null) { super(code); this.code = code; this.status = status; this.extra = extra; }
}

function signal(businessId) {
  const io = global.__planqIo || null;
  if (!io) return;
  try { io.to(`business:${businessId}`).emit('calendar_category:updated', { business_id: businessId }); } catch (e) { /* 신호 실패는 저장을 막지 않는다 */ }
}

const normName = (v) => (typeof v === 'string' ? v.normalize('NFC').trim().replace(/\s+/g, ' ') : '');
const nameKey = (v) => normName(v).toLowerCase();

/** 이 분류를 부를 수 있는 이름들(소문자 키) — 정한 이름, 없으면 ko/en 기본 라벨, 시스템이면 code 도 */
function nameKeysOf(row) {
  const keys = new Set();
  if (row.name) keys.add(nameKey(row.name));
  if (row.code) {
    keys.add(row.code);
    if (!row.name) { keys.add(nameKey(LABELS.ko[row.code] || '')); keys.add(nameKey(LABELS.en[row.code] || '')); }
  }
  keys.delete('');
  return keys;
}

function displayName(row, lang = 'ko') {
  if (!row) return '';
  if (row.name) return row.name;
  const L = LABELS[lang] || LABELS.ko;
  return L[row.code] || row.code || '';
}

/** 이 사람이 이름·색·켜고 끄기·순서·삭제를 할 수 있나 — 휴가 종류·휴일 설정과 같은 술어 */
function canManage(actor = {}) {
  return actor.platformRole === 'platform_admin' || actor.businessRole === 'owner' || actor.businessRole === 'admin';
}

const seeded = new Set(); // 이 프로세스에서 씨앗을 확인한 워크스페이스(지우면 다시 확인할 뿐)

/** 시스템 5개가 없으면 만든다 — 목록·해석이 먼저 부른다. UNIQUE(biz,code) 가 경합을 막는다. */
async function ensureDefaults(businessId, { transaction } = {}) {
  const biz = Number(businessId);
  if (seeded.has(biz)) return;
  const have = await CalendarCategory.findAll({ where: { business_id: biz, code: { [Op.ne]: null } }, attributes: ['code'], transaction });
  const got = new Set(have.map((r) => r.code));
  for (const s of SYSTEM) {
    if (got.has(s.code)) continue;
    try {
      await CalendarCategory.findOrCreate({
        where: { business_id: biz, code: s.code },
        defaults: { business_id: biz, code: s.code, name: null, color: null, is_active: true, sort_order: s.sort_order },
        transaction,
      });
    } catch (e) {
      if (e?.name !== 'SequelizeUniqueConstraintError') throw e;
    }
  }
  if (!transaction) seeded.add(biz);
}

async function list(businessId, { includeInactive = false } = {}) {
  await ensureDefaults(businessId);
  const where = { business_id: Number(businessId) };
  if (!includeInactive) where.is_active = true;
  return CalendarCategory.findAll({ where, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
}

async function findById(businessId, id, opts = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return CalendarCategory.findOne({ where: { id: n, business_id: Number(businessId) }, ...opts });
}

/** 시스템 code 로 그 워크스페이스의 행 — 꺼져 있어도 돌려준다(예약 = meeting 은 꺼져 있어도 meeting) */
async function resolveByCode(businessId, code, opts = {}) {
  if (!SYSTEM_CODES.has(code)) return null;
  await ensureDefaults(businessId, opts);
  return CalendarCategory.findOne({ where: { business_id: Number(businessId), code }, ...opts });
}

/** AI 도구가 준 글자(시스템 code · 정한 이름 · 기본 ko/en 라벨, 대소문자·NFC 무시)로 **켜진** 분류를 찾는다. 없으면 null */
async function resolveByName(businessId, text) {
  const key = nameKey(String(text || ''));
  if (!key) return null;
  const rows = await list(businessId);
  return rows.find((r) => nameKeysOf(r).has(key)) || null;
}

/** 새 일정 기본값 — work 가 켜져 있으면 work, 아니면 정렬상 첫 활성 */
async function defaultCategory(businessId, opts = {}) {
  await ensureDefaults(businessId, opts);
  const rows = await CalendarCategory.findAll({ where: { business_id: Number(businessId), is_active: true }, order: [['sort_order', 'ASC'], ['id', 'ASC']], ...opts });
  return rows.find((r) => r.code === 'work') || rows[0] || resolveByCode(businessId, 'other', opts);
}

const mirrorOf = (row) => (row && row.code ? row.code : 'other');
const pack = (row) => ({ category_id: row.id, category: mirrorOf(row) });

/**
 * 일정 쓰기 입력을 해석한다 — 일정을 만들고 고치는 모든 문(화면·행동 계층·Cue·외부 AI)이 부른다.
 * input: { category_id?, category? } (category_id 우선, category 는 시스템 code — 옛 번들 호환)
 * current: 고치는 일정의 지금 값 { category_id, category } — 꺼진 분류라도 «지금 값 유지» 는 통과.
 * 돌려줌: { category_id, category } · 아무것도 안 주면 null(만들 때는 호출자가 defaultCategory).
 */
async function resolveInput(businessId, input = {}, { current = null } = {}) {
  const hasId = input.category_id !== undefined && input.category_id !== null && input.category_id !== '';
  const hasCode = input.category !== undefined && input.category !== null && input.category !== '';
  if (!hasId && !hasCode) return null;
  let row = null;
  if (hasId) {
    await ensureDefaults(businessId);
    row = await findById(businessId, input.category_id);
  } else {
    row = await resolveByCode(businessId, String(input.category));
  }
  if (!row) throw new CalendarCategoryError('invalid_category');
  if (!row.is_active) {
    const curRef = current ? await readRef(businessId, current) : null;
    if (!curRef || curRef.id !== row.id) throw new CalendarCategoryError('category_inactive');
  }
  return pack(row);
}

/** 일정 한 행의 분류 행(category_id → 없으면 code 폴백) */
async function readRef(businessId, ev) {
  if (ev.category_id) {
    const r = await findById(businessId, ev.category_id);
    if (r) return r;
  }
  return resolveByCode(businessId, ev.category || 'other');
}

function refOf(row) {
  return row ? { id: row.id, code: row.code || null, name: row.name || null, color: row.color || null, is_active: !!row.is_active } : null;
}

/**
 * 응답 일정들에 category_ref 를 붙인다 — business 당 조회 1회(JOIN 하지 않는다: literal 컬럼 ambiguous 전례).
 * rows: plain object 배열(또는 하나). 제자리에서 고치고 돌려준다.
 */
async function attachCategory(rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  const bizIds = [...new Set(arr.filter(Boolean).map((r) => Number(r.business_id)).filter(Boolean))];
  const byBiz = new Map();
  for (const b of bizIds) {
    await ensureDefaults(b);
    const cats = await CalendarCategory.findAll({ where: { business_id: b } });
    byBiz.set(b, { byId: new Map(cats.map((c) => [c.id, c])), byCode: new Map(cats.filter((c) => c.code).map((c) => [c.code, c])) });
  }
  for (const r of arr) {
    if (!r) continue;
    const m = byBiz.get(Number(r.business_id));
    if (!m) continue;
    const row = (r.category_id && m.byId.get(Number(r.category_id))) || m.byCode.get(r.category || 'other') || m.byCode.get('other');
    r.category_ref = refOf(row);
  }
  return rows;
}

/** 분류별 쓰인 일정 수 — category_id 정본 + NULL 행은 code 로 센다 */
async function usageCounts(businessId) {
  const biz = Number(businessId);
  const cats = await list(biz, { includeInactive: true });
  const [byId] = await sequelize.query(
    'SELECT category_id AS id, COUNT(*) AS n FROM calendar_events WHERE business_id = ? AND category_id IS NOT NULL GROUP BY category_id',
    { replacements: [biz] });
  const [byCode] = await sequelize.query(
    'SELECT category AS code, COUNT(*) AS n FROM calendar_events WHERE business_id = ? AND category_id IS NULL GROUP BY category',
    { replacements: [biz] });
  const out = new Map(cats.map((c) => [c.id, 0]));
  for (const r of byId) if (out.has(Number(r.id))) out.set(Number(r.id), Number(r.n));
  for (const r of byCode) {
    const c = cats.find((x) => x.code === r.code);
    if (c) out.set(c.id, (out.get(c.id) || 0) + Number(r.n));
  }
  return out;
}

async function assertNameFree(businessId, name, exceptId = null) {
  const key = nameKey(name);
  if (!key) return;
  const rows = await CalendarCategory.findAll({ where: { business_id: Number(businessId) } });
  if (rows.some((r) => r.id !== exceptId && nameKeysOf(r).has(key))) throw new CalendarCategoryError('name_taken', 409);
}

function checkName(raw) {
  const name = normName(raw);
  if (name.length > NAME_MAX) throw new CalendarCategoryError('name_too_long');
  return name;
}

function checkColor(raw) {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !HEX_RE.test(raw)) throw new CalendarCategoryError('invalid_color');
  return raw.toUpperCase();
}

async function audit(action, row, actorUserId, oldValue, newValue, transaction) {
  await writeAudit({
    user_id: actorUserId, business_id: row.business_id, action,
    entity_type: 'calendar_category', entity_id: row.id,
    old_value: oldValue || null, new_value: newValue || null,
  }, transaction ? { transaction } : undefined).catch((e) => { if (transaction) throw e; return null; });
}

async function createCategory(businessId, actorUserId, input = {}) {
  const biz = Number(businessId);
  await ensureDefaults(biz);
  const name = checkName(input.name);
  if (!name) throw new CalendarCategoryError('name_required');
  const customCount = await CalendarCategory.count({ where: { business_id: biz, code: null } });
  if (customCount >= CUSTOM_LIMIT) throw new CalendarCategoryError('limit_reached', 409);
  await assertNameFree(biz, name);
  let color = input.color === undefined ? undefined : checkColor(input.color);
  if (!color) {
    const used = new Set((await CalendarCategory.findAll({ where: { business_id: biz }, attributes: ['color'] })).map((r) => (r.color || '').toUpperCase()));
    color = SWATCHES.find((c) => !used.has(c)) || SWATCHES[customCount % SWATCHES.length];
  }
  const maxOrder = await CalendarCategory.max('sort_order', { where: { business_id: biz } });
  const row = await CalendarCategory.create({
    business_id: biz, code: null, name, color, is_active: true,
    sort_order: (Number(maxOrder) || 0) + 1, created_by: actorUserId,
  });
  await audit('calendar_category.create', row, actorUserId, null, row.toJSON());
  signal(biz);
  return row;
}

async function updateCategory(businessId, actorUserId, id, patch = {}) {
  const row = await findById(businessId, id);
  if (!row) throw new CalendarCategoryError('not_found', 404);
  const before = row.toJSON();
  const next = {};
  if (patch.name !== undefined) {
    const name = checkName(patch.name);
    if (!name) {
      if (!row.code) throw new CalendarCategoryError('name_required');
      next.name = null; // 시스템 분류는 비우면 기본 이름으로 돌아간다
    } else {
      await assertNameFree(businessId, name, row.id);
      next.name = name;
    }
  }
  if (patch.color !== undefined) next.color = checkColor(patch.color);
  if (patch.is_active !== undefined) {
    const active = !!patch.is_active;
    if (!active && row.code === 'other') throw new CalendarCategoryError('other_locked', 409);
    next.is_active = active;
  }
  if (!Object.keys(next).length) return row;
  await row.update(next);
  await audit('calendar_category.update', row, actorUserId, before, row.toJSON());
  signal(row.business_id);
  return row;
}

/** ids = 이 워크스페이스 분류 id 전부(꺼진 것 포함)를 원하는 순서로 */
async function reorder(businessId, actorUserId, ids) {
  const biz = Number(businessId);
  if (!Array.isArray(ids) || !ids.length) throw new CalendarCategoryError('invalid_order');
  const rows = await list(biz, { includeInactive: true });
  const want = ids.map(Number);
  const mine = new Set(rows.map((r) => r.id));
  if (new Set(want).size !== want.length || want.length !== rows.length || want.some((i) => !mine.has(i))) {
    throw new CalendarCategoryError('invalid_order');
  }
  const before = rows.map((r) => r.id);
  await sequelize.transaction(async (t) => {
    for (let i = 0; i < want.length; i += 1) {
      await CalendarCategory.update({ sort_order: i }, { where: { id: want[i], business_id: biz }, transaction: t });
    }
  });
  await audit('calendar_category.reorder', { business_id: biz, id: null }, actorUserId, { order: before }, { order: want });
  signal(biz);
  return list(biz, { includeInactive: true });
}

/** 커스텀만 지운다 — 그 분류 일정을 «기타»로 옮기고 지운다(한 트랜잭션). 돌려줌 { moved } */
async function deleteCategory(businessId, actorUserId, id) {
  const biz = Number(businessId);
  const row = await findById(biz, id);
  if (!row) throw new CalendarCategoryError('not_found', 404);
  if (row.code) throw new CalendarCategoryError('system_category', 409);
  const other = await resolveByCode(biz, 'other');
  const before = row.toJSON();
  const moved = await sequelize.transaction(async (t) => {
    const [n] = await CalendarEvent.update(
      { category_id: other.id, category: 'other' },
      { where: { business_id: biz, category_id: row.id }, transaction: t, hooks: false });
    await audit('calendar_category.delete', row, actorUserId, before, { moved_to: other.id, moved: n }, t);
    await row.destroy({ transaction: t });
    return n;
  });
  signal(biz);
  return { moved };
}

function serialize(row, usage) {
  return {
    id: row.id, code: row.code || null, name: row.name || null, color: row.color || null,
    is_active: !!row.is_active, sort_order: row.sort_order,
    ...(usage === undefined ? {} : { event_count: usage }),
  };
}

module.exports = {
  SYSTEM_CODES, LABELS, SWATCHES, CUSTOM_LIMIT, NAME_MAX,
  CalendarCategoryError,
  canManage, ensureDefaults, list, findById, resolveByCode, resolveByName, defaultCategory,
  resolveInput, readRef, attachCategory, refOf, usageCounts, displayName, nameKeysOf,
  createCategory, updateCategory, reorder, deleteCategory, serialize,
};
