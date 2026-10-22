// 휴가 종류를 읽고 쓰는 **문 하나** (2026-10-22) — 설계 docs/LEAVE_TYPES_DESIGN.md §5.1
//
// ★ 종류 표의 pay 를 읽는 곳은 둘뿐이다 — leaveTransition.createRequest(신청 행에 박제 복사)와
//   POST /api/leave/grants(유급 종류에만 부여). 잔여·통계·급여·Cue 는 신청 행의 leave_type 박제만 읽는다.
//   그래서 종류를 고쳐도 옛 신청·잔여·급여는 한 숫자도 움직이지 않는다(§7-1).
// ★ 종류 id 를 받는 모든 문은 resolveType(businessId, id) — business_id 를 WHERE 에 건다.
// ★ 감사·방송은 여기 안에서. 방송은 신호만(`leave_type:updated {business_id}`).
const { Op } = require('sequelize');
const { LeaveType, LeaveGrant, LeaveRequest } = require('../models');
const { writeAudit } = require('./auditService');

const SYSTEM_TYPES = [
  { code: 'annual', pay: 'paid', sort_order: 0 },
  { code: 'sick', pay: 'paid', sort_order: 1 },
  { code: 'family', pay: 'paid', sort_order: 2 },
  { code: 'other', pay: 'paid', sort_order: 3 },
  { code: 'unpaid', pay: 'unpaid', sort_order: 4 },
];
/** 옛 category ENUM 에 쓸 수 있는 값 — 이중 기록(롤백용)에만 쓴다. 읽지 않는다. */
const LEGACY_CODES = new Set(['annual', 'sick', 'family', 'other']);
/** 서버가 글자를 만드는 곳(확인필요·Cue)의 폴백 — 화면은 i18n leave.category.<code> */
const FALLBACK_KO = { annual: '연차', sick: '병가', family: '경조사', other: '기타', unpaid: '무급휴가' };

class LeaveTypeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function getIO() { return global.__planqIo || null; }
function signal(businessId) {
  const io = getIO();
  if (!io) return;
  try { io.to(`business:${businessId}`).emit('leave_type:updated', { business_id: businessId }); } catch (e) { /* 신호 실패는 저장을 막지 않는다 */ }
}

const normName = (v) => (typeof v === 'string' ? v.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 50) : '');
const nameKey = (v) => normName(v).toLowerCase();

/** 옛 by_category 호환 응답에 넣을 코드인가 */
const isLegacyCode = (code) => LEGACY_CODES.has(code);

function legacyCategoryOf(type) {
  return type && LEGACY_CODES.has(type.code) ? type.code : 'other';
}
function displayName(type) {
  if (!type) return '';
  return type.name || FALLBACK_KO[type.code] || '';
}

/** 시스템 5종이 없으면 만든다 — 목록·해석이 먼저 부른다(가입 경로마다 심지 않는다). UNIQUE(biz,code) 가 경합을 막는다. */
async function ensureDefaults(businessId) {
  const have = await LeaveType.findAll({ where: { business_id: businessId, code: { [Op.ne]: null } }, attributes: ['code'] });
  const got = new Set(have.map((r) => r.code));
  for (const s of SYSTEM_TYPES) {
    if (got.has(s.code)) continue;
    try {
      await LeaveType.findOrCreate({
        where: { business_id: businessId, code: s.code },
        defaults: { business_id: businessId, code: s.code, name: null, pay: s.pay, default_days: null, is_active: true, sort_order: s.sort_order },
      });
    } catch (e) {
      if (e?.name !== 'SequelizeUniqueConstraintError') throw e;
    }
  }
}

async function listTypes(businessId, { includeInactive = false } = {}) {
  await ensureDefaults(businessId);
  const where = { business_id: businessId };
  if (!includeInactive) where.is_active = true;
  return LeaveType.findAll({ where, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
}

async function resolveType(businessId, leaveTypeId, { requireActive = true } = {}) {
  const id = Number(leaveTypeId);
  if (!Number.isInteger(id) || id <= 0) throw new LeaveTypeError('invalid_leave_type');
  const type = await LeaveType.findOne({ where: { id, business_id: businessId } });
  if (!type) throw new LeaveTypeError('invalid_leave_type');
  if (requireActive && !type.is_active) throw new LeaveTypeError('type_inactive');
  return type;
}

/** 옛 번들 호환 — category 코드로 시스템 종류를 찾는다(활성일 때만). */
async function resolveByCode(businessId, code, { requireActive = true } = {}) {
  await ensureDefaults(businessId);
  const type = await LeaveType.findOne({ where: { business_id: businessId, code: String(code) } });
  if (!type || !LEGACY_CODES.has(type.code)) throw new LeaveTypeError('invalid_leave_category');
  if (requireActive && !type.is_active) throw new LeaveTypeError('type_inactive');
  return type;
}

async function isUsed(type) {
  const [g, r] = await Promise.all([
    LeaveGrant.count({ where: { business_id: type.business_id, leave_type_id: type.id } }),
    LeaveRequest.count({ where: { business_id: type.business_id, leave_type_id: type.id } }),
  ]);
  return g + r > 0;
}

function parseDays(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 366 || Math.round(n * 2) !== n * 2) throw new LeaveTypeError('invalid_days');
  return n;
}

async function assertNameFree(businessId, name, exceptId = null) {
  const key = nameKey(name);
  if (!key) return;
  const rows = await LeaveType.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] });
  if (rows.some((r) => r.id !== exceptId && r.name && nameKey(r.name) === key)) throw new LeaveTypeError('name_taken', 409);
}

async function audit(action, type, actorUserId, oldValue, newValue) {
  await writeAudit({
    user_id: actorUserId, business_id: type.business_id, action,
    entity_type: 'leave_type', entity_id: type.id,
    old_value: oldValue || null, new_value: newValue || null,
  }).catch(() => null);
}

async function createType(businessId, actorUserId, input = {}) {
  await ensureDefaults(businessId);
  const name = normName(input.name);
  if (!name) throw new LeaveTypeError('name_required');
  const pay = input.pay === 'unpaid' ? 'unpaid' : input.pay === 'paid' || input.pay === undefined ? 'paid' : null;
  if (!pay) throw new LeaveTypeError('invalid_pay');
  const defaultDays = pay === 'unpaid' ? null : parseDays(input.default_days);
  await assertNameFree(businessId, name);
  const maxOrder = await LeaveType.max('sort_order', { where: { business_id: businessId } });
  const type = await LeaveType.create({
    business_id: businessId, code: null, name, pay, default_days: defaultDays,
    is_active: true, sort_order: (Number(maxOrder) || 0) + 1, created_by: actorUserId,
  });
  await audit('leave_type.create', type, actorUserId, null, type.toJSON());
  signal(businessId);
  return type;
}

async function updateType(businessId, actorUserId, id, patch = {}) {
  const type = await resolveType(businessId, id, { requireActive: false });
  const before = type.toJSON();
  const next = {};
  if (patch.name !== undefined) {
    const name = normName(patch.name);
    if (!name) {
      if (!type.code) throw new LeaveTypeError('name_required');
      next.name = null; // 시스템 종류는 비우면 기본 이름으로 돌아간다
    } else {
      await assertNameFree(businessId, name, type.id);
      next.name = name;
    }
  }
  if (patch.pay !== undefined && patch.pay !== type.pay) {
    if (!['paid', 'unpaid'].includes(patch.pay)) throw new LeaveTypeError('invalid_pay');
    if (await isUsed(type)) throw new LeaveTypeError('pay_locked', 409);
    next.pay = patch.pay;
    if (patch.pay === 'unpaid') next.default_days = null;
  }
  if (patch.default_days !== undefined) {
    const pay = next.pay || type.pay;
    next.default_days = pay === 'unpaid' ? null : parseDays(patch.default_days);
  }
  if (patch.is_active !== undefined) {
    const active = !!patch.is_active;
    if (!active && type.is_active) {
      const left = await LeaveType.count({ where: { business_id: businessId, is_active: true, id: { [Op.ne]: type.id } } });
      if (left < 1) throw new LeaveTypeError('last_active_type', 409);
    }
    next.is_active = active;
  }
  if (!Object.keys(next).length) return type;
  await type.update(next);
  await audit('leave_type.update', type, actorUserId, before, type.toJSON());
  signal(businessId);
  return type;
}

async function deleteType(businessId, actorUserId, id) {
  const type = await resolveType(businessId, id, { requireActive: false });
  if (type.code) throw new LeaveTypeError('system_type');
  if (await isUsed(type)) throw new LeaveTypeError('type_in_use', 409);
  if (type.is_active) {
    const left = await LeaveType.count({ where: { business_id: businessId, is_active: true, id: { [Op.ne]: type.id } } });
    if (left < 1) throw new LeaveTypeError('last_active_type', 409);
  }
  const before = type.toJSON();
  await type.destroy();
  await audit('leave_type.delete', type, actorUserId, before, null);
  signal(businessId);
}

function serializeType(t, inUse) {
  return {
    id: t.id, code: t.code || null, name: t.name || null, pay: t.pay,
    default_days: t.default_days === null || t.default_days === undefined ? null : Number(t.default_days),
    is_active: !!t.is_active, sort_order: t.sort_order,
    ...(inUse === undefined ? {} : { in_use: !!inUse }),
  };
}
/** 신청·부여 행에 붙일 짧은 모양 */
const briefType = (t) => (t ? { id: t.id, code: t.code || null, name: t.name || null, pay: t.pay } : null);

module.exports = {
  LeaveTypeError, SYSTEM_TYPES,
  ensureDefaults, listTypes, resolveType, resolveByCode, isUsed,
  createType, updateType, deleteType,
  legacyCategoryOf, isLegacyCode, displayName, serializeType, briefType,
};
