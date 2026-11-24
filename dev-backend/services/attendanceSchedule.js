// 근태 근무 일정 — 찾기·저장·예정 취소 한 곳 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §2.1 · §4)
//
// 일정은 «적용 시작일이 붙은 이력» 이다. 저장은 내일 이후로만 — 지난 날·오늘 판정이 저장 때문에 바뀌지 않는다(D2 · §3.5).
// 행이 하나도 없으면 유연 근무 = 지금 동작 그대로. 판정은 services/attendancePunctuality 가 이 파일의 resolve 로만 한다.
// ★ user_id NULL 행은 MySQL unique 가 못 막는다 → 쓰기는 save() 한 곳에서 트랜잭션 + 행 잠금으로 upsert.
const { Op } = require('sequelize');
const { AttendanceSchedule, Business, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { ymd, addDaysStr, dateStrInTz } = require('../utils/datetime');
const { normalizeWorkHours, serializeWorkHours } = require('./booking');

const GRACE_CHOICES = [0, 5, 10, 15, 30];
const WS_MODES = ['flex', 'fixed'];
const MEMBER_MODES = ['inherit', 'flex', 'fixed'];

class ScheduleError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

async function tzOf(businessId) {
  const b = await Business.findByPk(businessId, { attributes: ['timezone'] });
  return b?.timezone || 'Asia/Seoul';
}

/** 화면·판정이 쓰는 모양. hours = 요일(0=일)별 [시작분, 끝분] | null. */
function view(row) {
  if (!row) return null;
  const norm = row.schedule ? normalizeWorkHours(row.schedule) : null;
  return {
    id: row.id,
    user_id: row.user_id || null,
    effective_from: ymd(row.effective_from),
    mode: row.mode,
    schedule: row.schedule ? serializeWorkHours(row.schedule) : null,
    hours: norm ? norm.map((h) => (h ? [Math.round(h[0] * 60), Math.round(h[1] * 60)] : null)) : null,
    grace_min: Number(row.grace_min || 0),
    half_day_at: row.half_day_at === null || row.half_day_at === undefined ? null : Number(row.half_day_at),
  };
}

/** 워크스페이스 일정 행 전부(작다 — 워크스페이스 기본 + 사람별 이력). 판정이 여러 날·여러 사람을 한 번에 풀 때 쓴다. */
async function loadAll(businessId) {
  const rows = await AttendanceSchedule.findAll({
    where: { business_id: businessId },
    order: [['effective_from', 'DESC'], ['id', 'DESC']],
  });
  return rows.map(view);
}

/**
 * 그 날의 일정 — 사람 행(flex/fixed) > 워크스페이스 행 > 유연. rows = loadAll 결과(효력일 내림차순).
 *   반환 { mode:'flex'|'fixed', source:'member'|'workspace'|'default', row }
 */
function resolveFrom(rows, userId, date) {
  const mine = rows.find((r) => r.user_id === userId && r.effective_from <= date);
  if (mine && (mine.mode === 'flex' || mine.mode === 'fixed')) return { mode: mine.mode, source: 'member', row: mine };
  const ws = rows.find((r) => r.user_id === null && r.effective_from <= date);
  if (ws) return { mode: ws.mode, source: 'workspace', row: ws };
  return { mode: 'flex', source: 'default', row: null };
}

async function resolveSchedule(businessId, userId, date) {
  return resolveFrom(await loadAll(businessId), userId, date);
}

/** 오늘 이후에 시작하는 예정 행 하나(가장 이른 것). */
function upcomingOf(rows, userId, today) {
  const list = rows.filter((r) => (r.user_id || null) === (userId || null) && r.effective_from > today);
  return list.length ? list[list.length - 1] : null;
}
function currentOf(rows, userId, today) {
  return rows.find((r) => (r.user_id || null) === (userId || null) && r.effective_from <= today) || null;
}

function validate({ mode, schedule, grace_min, half_day_at }, isMember) {
  const modes = isMember ? MEMBER_MODES : WS_MODES;
  if (!modes.includes(mode)) throw new ScheduleError('invalid_mode');
  const out = { mode, schedule: null, grace_min: 0, half_day_at: null };
  if (mode !== 'fixed') return out;
  const ser = serializeWorkHours(schedule);
  if (!ser) throw new ScheduleError('invalid_schedule');
  out.schedule = ser;
  const g = grace_min === undefined || grace_min === null ? 0 : Number(grace_min);
  if (!GRACE_CHOICES.includes(g)) throw new ScheduleError('invalid_grace');
  out.grace_min = g;
  if (half_day_at !== undefined && half_day_at !== null && half_day_at !== '') {
    const h = Number(half_day_at);
    if (!Number.isFinite(h) || h < 0 || h > 24 || Math.round(h * 2) !== h * 2) throw new ScheduleError('invalid_half_day_at');
    out.half_day_at = h;
  }
  return out;
}

/**
 * 저장 — effective_from 은 워크스페이스 «내일» 이후만. 같은 (사람, 날짜) 행이 있으면 덮어쓴다.
 *   userId null = 워크스페이스 기본. 반환 { row, prev }(감사 로그용 직전 값).
 */
async function save({ businessId, userId = null, actorUserId, payload }) {
  const tz = await tzOf(businessId);
  const today = dateStrInTz(new Date(), tz);
  const from = String(payload.effective_from || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new ScheduleError('invalid_effective_from');
  if (from <= today) throw new ScheduleError('effective_from_must_be_future');
  if (from > addDaysStr(today, 366)) throw new ScheduleError('effective_from_too_far');
  const v = validate(payload, userId !== null);
  if (userId !== null) {
    const m = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: userId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
      attributes: ['id'],
    });
    if (!m) throw new ScheduleError('member_not_found', 404);
  }
  return sequelize.transaction(async (t) => {
    // 워크스페이스 한 줄을 잠가 같은 (사람, 날짜) 동시 저장이 두 행이 되지 않게 한다(user_id NULL 은 unique 가 못 막는다).
    await Business.findByPk(businessId, { attributes: ['id'], transaction: t, lock: t.LOCK.UPDATE });
    const where = { business_id: businessId, user_id: userId, effective_from: from };
    const existing = await AttendanceSchedule.findOne({ where, transaction: t });
    const prev = existing ? view(existing) : null;
    let row;
    if (existing) {
      row = await existing.update({ ...v, created_by: actorUserId }, { transaction: t });
    } else {
      row = await AttendanceSchedule.create({ ...where, ...v, created_by: actorUserId }, { transaction: t });
    }
    return { row: view(row), prev };
  });
}

/** 예정 취소 — 아직 시작 안 한 행만. 시작된 행은 이력이라 지울 수 없다(409). */
async function cancel({ businessId, id }) {
  const row = await AttendanceSchedule.findOne({ where: { id, business_id: businessId } });
  if (!row) throw new ScheduleError('not_found', 404);
  const today = dateStrInTz(new Date(), await tzOf(businessId));
  if (ymd(row.effective_from) <= today) throw new ScheduleError('already_started', 409);
  const prev = view(row);
  await row.destroy();
  return { prev };
}

module.exports = {
  ScheduleError, GRACE_CHOICES, loadAll, resolveFrom, resolveSchedule, upcomingOf, currentOf, save, cancel, view, tzOf,
};
