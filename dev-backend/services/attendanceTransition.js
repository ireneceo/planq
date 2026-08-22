// 출퇴근 상태 전이의 **단일 착지점** (#208 · #285) — docs/ATTENDANCE_LEAVE_DESIGN.md §4.1
//
// 라우트·cron·Focus 연동이 각자 attendance_days 를 고치면, 어느 경로가 롤업을 갱신하고
//   어느 경로가 원장을 안 남겼는지 금방 갈라진다(taskTransition 을 만든 이유와 같다).
//   그래서 상태를 바꾸는 길은 이 파일의 clockIn/breakStart/breakEnd/clockOut/applyAdminFix 다섯 뿐이다.
//
// 규칙
//   ① 모든 전이는 **원장(attendance_events) 추가 → 롤업 재계산 → AuditLog → broadcast** 를 한 함수 안에서 한다.
//   ② 근무·휴게 누계는 컬럼을 더하지 않고 **원장을 다시 접어서**(recomputeDay) 만든다.
//      더하기로 관리하면 정정 한 번에 어긋나고, 어긋난 뒤에는 무엇이 맞는지 알 방법이 없다.
//   ③ 하루의 경계는 **워크스페이스 타임존**이다. 서버 UTC 로 자르면 자정 무렵 출근이 어제에 붙는다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  AttendanceDay, AttendanceEvent, Business, AuditLog, User, FocusSession,
} = require('../models');
const { dateStrInTz, ymd } = require('../utils/datetime');

// 라우트가 아닌 경로(cron·Focus 연동)에서도 broadcast 해야 한다 — taskTransition 과 같은 방식.
function getIO() { return global.__planqIo || null; }

async function workspaceTz(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  return biz?.timezone || 'Asia/Seoul';
}

/** 워크스페이스 tz 기준 '오늘' (YYYY-MM-DD) */
async function todayFor(businessId, at = new Date()) {
  return dateStrInTz(at, await workspaceTz(businessId));
}

// ─── 롤업 재계산 ────────────────────────────────────────────────
// 원장을 시간순으로 훑으며 근무 스팬과 휴게 스팬을 접는다. 진행 중인 스팬(아직 닫히지 않은
//   clock_in / break_start)은 **누계에 넣지 않는다** — 화면이 "지금까지 몇 시간" 을 보여줄 때는
//   저장된 누계 + 진행 중 경과를 그 순간 더한다(§5.1 today). 저장값에 미완 스팬을 섞으면
//   두 번 세거나, 재계산할 때마다 값이 흔들린다.
function foldEvents(events) {
  // 무효 처리된 기록은 계산에서 뺀다(행은 남아 있다 — models/AttendanceEvent.superseded_at 주석).
  events = (events || []).filter((e) => !e.superseded_at);
  let work = 0, brk = 0;
  let workOpen = null, breakOpen = null;
  let firstIn = null, lastOut = null;
  for (const e of events) {
    const at = new Date(e.at).getTime();
    if (e.kind === 'clock_in') {
      if (!firstIn) firstIn = e.at;
      if (workOpen === null) workOpen = at;
    } else if (e.kind === 'break_start') {
      if (workOpen !== null) { work += Math.max(0, at - workOpen); workOpen = null; }
      if (breakOpen === null) breakOpen = at;
    } else if (e.kind === 'break_end') {
      if (breakOpen !== null) { brk += Math.max(0, at - breakOpen); breakOpen = null; }
      if (workOpen === null) workOpen = at;
    } else if (e.kind === 'clock_out') {
      if (workOpen !== null) { work += Math.max(0, at - workOpen); workOpen = null; }
      // 휴게 중 퇴근 — 휴게도 그 시점에 닫는다(§4.1 "휴게 중 퇴근 허용")
      if (breakOpen !== null) { brk += Math.max(0, at - breakOpen); breakOpen = null; }
      lastOut = e.at;
    }
  }
  return {
    work_total_sec: Math.floor(work / 1000),
    break_total_sec: Math.floor(brk / 1000),
    first_in: firstIn,
    // ★ 재출근하면 clock_out_at 은 NULL 로 돌아간다. "퇴근 시각" 을 보는 곳은 이 값 하나만 봐야 하고,
    //   그 정본은 항상 원장의 **마지막 clock_out 이 아직 열린 스팬보다 뒤인가** 로 정해진다.
    last_out: workOpen === null && breakOpen === null ? lastOut : null,
    work_open: workOpen,
    break_open: breakOpen,
  };
}

/** 원장에서 하루를 다시 만든다. 정정도 이 함수로만 반영된다. */
async function recomputeDay(dayId, t = null) {
  const day = await AttendanceDay.findByPk(dayId, { transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
  if (!day) return null;
  const events = await AttendanceEvent.findAll({
    // 스코프: attendance_day_id 는 이미 한 워크스페이스·한 사람의 하루에 묶인 자식이다(격리 상위 보장).
    where: { attendance_day_id: dayId, superseded_at: null },
    order: [['at', 'ASC'], ['id', 'ASC']],
    transaction: t,
  });
  const f = foldEvents(events);
  const state = f.break_open !== null ? 'on_break' : (f.work_open !== null ? 'working' : 'done');
  await day.update({
    state,
    clock_in_at: f.first_in || day.clock_in_at,
    clock_out_at: f.last_out,
    break_started_at: f.break_open !== null ? new Date(f.break_open) : null,
    work_total_sec: f.work_total_sec,
    break_total_sec: f.break_total_sec,
  }, { transaction: t });
  return day;
}

/**
 * "지금까지 몇 시간" — 저장된 누계에 **아직 닫히지 않은 스팬의 경과**를 얹어 돌려준다.
 * 저장값에 미완 스팬을 섞지 않는 이유는 recomputeDay 주석 참조(두 번 세는 것을 막는다).
 * 열린 스팬의 시작 시각은 롤업만 봐서는 알 수 없으므로 원장을 한 번 접는다.
 */
async function liveTotals(day, now = Date.now()) {
  const base = { work_sec: Number(day.work_total_sec || 0), break_sec: Number(day.break_total_sec || 0) };
  if (day.state === 'done') return base;
  const events = await AttendanceEvent.findAll({
    // 스코프: attendance_day_id 자체가 한 워크스페이스·한 사람의 하루다(상위에서 격리 검사됨).
    where: { attendance_day_id: day.id, superseded_at: null },
    order: [['at', 'ASC'], ['id', 'ASC']],
  });
  const f = foldEvents(events);
  if (f.work_open !== null) base.work_sec += Math.max(0, Math.floor((now - f.work_open) / 1000));
  if (f.break_open !== null) base.break_sec += Math.max(0, Math.floor((now - f.break_open) / 1000));
  return base;
}

// ─── 공통 전이 ──────────────────────────────────────────────────
async function appendEvent({ day, kind, at, source, actorUserId, fixReason }, t) {
  return AttendanceEvent.create({
    business_id: day.business_id,
    user_id: day.user_id,
    attendance_day_id: day.id,
    kind,
    at,
    source: source || 'user',
    actor_user_id: actorUserId,
    fix_reason: fixReason || null,
  }, { transaction: t });
}

function broadcast(day) {
  const io = getIO();
  if (!io) return;
  try {
    // ★ 수치는 싣지 않는다 — 이 이벤트는 워크스페이스 전원에게 간다(§6 동료는 뱃지만 본다).
    //   근무시간·출퇴근 시각이 payload 에 섞이면 권한 검사를 우회해 전파된다.
    io.to(`business:${day.business_id}`).emit('attendance:updated', {
      user_id: day.user_id, work_date: ymd(day.work_date), state: day.state,
    });
  } catch (e) { console.warn('[attendance broadcast]', e.message); }
}

async function audit({ action, day, actorUserId, oldValue, newValue }) {
  try {
    await AuditLog.create({
      user_id: actorUserId,
      business_id: day.business_id,
      action,
      target_type: 'attendance_day',
      target_id: day.id,
      old_value: oldValue || null,
      new_value: newValue || null,
    });
  } catch (e) { console.warn('[attendance audit]', e.message); }
}

/**
 * 하루 row 를 잠금과 함께 가져온다. 없으면 null.
 * 이중 클릭·모바일 재전송이 두 개의 출근을 만들지 못하게 모든 전이가 이 잠금을 지난다.
 */
async function lockDay({ businessId, userId, workDate }, t) {
  return AttendanceDay.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
    transaction: t, lock: t.LOCK.UPDATE,
  });
}

class AttendanceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/**
 * 출근. 미출근이면 row 생성, 퇴근 상태면 재출근(유연근무 — 저녁에 다시 일하는 경우).
 * 이미 근무/휴게 중이면 400 already_working.
 */
async function clockIn({ businessId, userId, actorUserId, source = 'user', at = new Date(), fixReason }) {
  const workDate = await todayFor(businessId, at);
  const t = await sequelize.transaction();
  try {
    let day = await lockDay({ businessId, userId, workDate }, t);
    if (day && (day.state === 'working' || day.state === 'on_break')) {
      throw new AttendanceError('already_working');
    }
    if (!day) {
      day = await AttendanceDay.create({
        business_id: businessId, user_id: userId, work_date: workDate,
        state: 'working', clock_in_at: at,
      }, { transaction: t });
    }
    await appendEvent({ day, kind: 'clock_in', at, source, actorUserId, fixReason }, t);
    await recomputeDay(day.id, t);
    await t.commit();
    await day.reload();
    await audit({ action: 'attendance.clock_in', day, actorUserId, newValue: { work_date: workDate, source } });
    broadcast(day);
    return day;
  } catch (err) { await t.rollback(); throw err; }
}

async function breakStart({ businessId, userId, actorUserId, source = 'user', at = new Date() }) {
  const workDate = await todayFor(businessId, at);
  const t = await sequelize.transaction();
  try {
    const day = await lockDay({ businessId, userId, workDate }, t);
    if (!day || day.state !== 'working') throw new AttendanceError('not_working');
    await appendEvent({ day, kind: 'break_start', at, source, actorUserId }, t);
    await recomputeDay(day.id, t);
    await t.commit();
    await day.reload();
    await audit({ action: 'attendance.break_start', day, actorUserId });
    broadcast(day);
    // 연동 C — 휴게 시작이면 진행 중인 업무 몰입도 같이 멈춘다. 재개는 자동으로 하지 않는다
    //   (업무 재개는 명시 행동이라는 Focus 의 기존 철학).
    await pauseActiveFocus(userId).catch(() => null);
    return day;
  } catch (err) { await t.rollback(); throw err; }
}

async function breakEnd({ businessId, userId, actorUserId, source = 'user', at = new Date() }) {
  const workDate = await todayFor(businessId, at);
  const t = await sequelize.transaction();
  try {
    const day = await lockDay({ businessId, userId, workDate }, t);
    if (!day || day.state !== 'on_break') throw new AttendanceError('not_on_break');
    await appendEvent({ day, kind: 'break_end', at, source, actorUserId }, t);
    await recomputeDay(day.id, t);
    await t.commit();
    await day.reload();
    await audit({ action: 'attendance.break_end', day, actorUserId });
    broadcast(day);
    return day;
  } catch (err) { await t.rollback(); throw err; }
}

async function clockOut({ businessId, userId, actorUserId, source = 'user', at = new Date(), workDate: forcedDate }) {
  const workDate = forcedDate || await todayFor(businessId, at);
  const t = await sequelize.transaction();
  try {
    const day = await lockDay({ businessId, userId, workDate }, t);
    if (!day || day.state === 'done') throw new AttendanceError('not_working');
    await appendEvent({ day, kind: 'clock_out', at, source, actorUserId }, t);
    if (source === 'auto_close') await day.update({ auto_closed: true }, { transaction: t });
    await recomputeDay(day.id, t);
    await t.commit();
    await day.reload();
    await audit({ action: 'attendance.clock_out', day, actorUserId, newValue: { source, at } });
    broadcast(day);
    // 연동 B — 퇴근했으면 켜져 있던 몰입 세션도 닫는다. 안 닫으면 밤새 켜진 세션이
    //   다음 날 업무시간으로 잡힌다.
    await stopActiveFocus(userId, 'clock_out').catch(() => null);
    return day;
  } catch (err) { await t.rollback(); throw err; }
}

/**
 * 관리자 정정 — 원장에 admin_fix event 들을 얹고 다시 접는다. 기존 row 는 고치지 않는다.
 * events: [{kind, at}] · fixReason 필수.
 */
async function applyAdminFix({ dayId, events, fixReason, actorUserId }) {
  if (!fixReason) throw new AttendanceError('fix_reason_required');
  if (!Array.isArray(events) || !events.length) throw new AttendanceError('events_required');
  const t = await sequelize.transaction();
  try {
    const day = await AttendanceDay.findByPk(dayId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!day) throw new AttendanceError('not_found', 404);
    const before = { work_total_sec: day.work_total_sec, break_total_sec: day.break_total_sec, state: day.state };

    // 제출된 것은 **그날의 확정 타임라인**이다. 덧붙이기가 아니다 —
    //   잘못 찍힌 퇴근을 무를 방법이 없으면 정정이라는 말이 성립하지 않는다.
    const parsed = [];
    for (const e of events) {
      if (!['clock_in', 'break_start', 'break_end', 'clock_out'].includes(e.kind)) {
        throw new AttendanceError('invalid_kind');
      }
      const at = new Date(e.at);
      if (Number.isNaN(at.getTime())) throw new AttendanceError('invalid_at');
      parsed.push({ kind: e.kind, at });
    }
    parsed.sort((a, b) => a.at - b.at);
    // 하루는 출근으로 시작해야 한다 — 출근 없는 타임라인은 근무 스팬이 열리지 않아 0h 가 된다.
    //   조용히 0 을 만들지 말고 거절해서, 관리자가 무엇이 빠졌는지 알게 한다.
    if (parsed[0].kind !== 'clock_in') throw new AttendanceError('timeline_must_start_with_clock_in');

    // 기존 기록은 지우지 않고 무효로 표시한다(무엇이 원래였는지 남는다).
    await AttendanceEvent.update(
      { superseded_at: new Date() },
      { where: { attendance_day_id: day.id, superseded_at: null }, transaction: t },
    );
    for (const e of parsed) {
      await appendEvent({ day, kind: e.kind, at: e.at, source: 'admin_fix', actorUserId, fixReason }, t);
    }
    await day.update({ admin_fixed: true }, { transaction: t });
    await recomputeDay(day.id, t);
    await t.commit();
    await day.reload();
    await audit({
      action: 'attendance.admin_fix', day, actorUserId,
      oldValue: before,
      newValue: { work_total_sec: day.work_total_sec, break_total_sec: day.break_total_sec, state: day.state, fix_reason: fixReason },
    });
    broadcast(day);
    return day;
  } catch (err) { await t.rollback(); throw err; }
}

// ─── Focus 연동 (§2.1) ──────────────────────────────────────────
async function stopActiveFocus(userId, reason) {
  const s = await FocusSession.findOne({ where: { user_id: userId, state: { [Op.in]: ['active', 'paused'] } } });
  if (!s) return null;
  let extraPause = 0;
  if (s.state === 'paused' && s.paused_at) {
    extraPause = Math.max(0, Math.floor((Date.now() - new Date(s.paused_at).getTime()) / 1000));
  }
  await s.update({
    state: 'stopped', ended_at: new Date(),
    pause_total_sec: s.pause_total_sec + extraPause, paused_at: null,
    end_reason: reason,
  });
  if (s.task_id) {
    const { recomputeActualHours } = require('./taskActualHours');
    await recomputeActualHours(s.task_id).catch(() => null);
  }
  return s;
}

async function pauseActiveFocus(userId) {
  const s = await FocusSession.findOne({ where: { user_id: userId, state: 'active' } });
  if (!s) return null;
  await s.update({ state: 'paused', paused_at: new Date(), auto_paused: true });
  return s;
}

/**
 * 연동 A — 업무 몰입을 시작하면 출근도 같이 찍는다.
 * 실패해도 절대 throw 하지 않는다: 근태 때문에 업무 시작이 막히면 안 된다(부가 기능이 본 기능을 죽이는 형태).
 */
async function autoClockInOnFocus({ businessId, userId }) {
  try {
    const u = await User.findByPk(userId, { attributes: ['id', 'auto_clock_in_on_focus'] });
    if (!u || u.auto_clock_in_on_focus === false) return null;
    const workDate = await todayFor(businessId);
    const existing = await AttendanceDay.findOne({
      where: { business_id: businessId, user_id: userId, work_date: workDate },
    });
    // 이미 근무중·휴게중이면 할 일이 없다.
    if (existing && (existing.state === 'working' || existing.state === 'on_break')) return null;
    // ★ 퇴근한 뒤라도 **다시 일을 시작하면 근무중이 된다.**
    //   처음엔 "퇴근을 눌렀는데 업무 하나 건드렸다고 되살아나면 안 된다" 고 막아뒀는데,
    //   그 결과 업무를 진행 중인데 화면은 '퇴근' 인 모순이 남았다
    //   (운영: "업무중인데 그냥 퇴근상태 그대로고, 근무한걸로 나와야지").
    //   일을 하고 있다는 사실이 도장보다 강한 신호다 — 유연근무라 저녁 재근무도 정상이고,
    //   재출근은 원장에 clock_in 으로 남아 나중에 무슨 일이 있었는지 그대로 읽힌다.
    return await clockIn({ businessId, userId, actorUserId: userId, source: 'auto_focus' });
  } catch (e) {
    console.warn('[attendance auto clock-in]', e.message);
    return null;
  }
}

/** 되돌릴 수 있는 창 — 30분. 그 뒤엔 이미 하루의 일부라 정정(관리자)의 영역이다. */
const AUTO_UNDO_WINDOW_MS = 30 * 60 * 1000;

/**
 * "업무를 시작해서 출근으로 기록했다" 를 화면에 알릴 재료.
 * 되돌릴 수 있는지까지 같이 판정한다 — 버튼을 띄울지 화면이 다시 계산하지 않게.
 */
async function autoClockInNotice(day) {
  try {
    const events = await AttendanceEvent.findAll({
      // 스코프: attendance_day_id 는 한 워크스페이스·한 사람의 하루다(상위에서 격리 검사됨).
      where: { attendance_day_id: day.id, superseded_at: null },
      order: [['at', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'kind', 'at', 'source'],
    });
    if (!events.length) return null;
    const last = events[events.length - 1];
    if (last.kind !== 'clock_in' || last.source !== 'auto_focus') return null;
    const age = Date.now() - new Date(last.at).getTime();
    return {
      source: 'auto_focus',
      at: last.at,
      // 되돌리기는 **자동 출근 하나뿐일 때**만. 사용자가 휴게·퇴근을 눌렀다면 그건 되돌리기가 아니다.
      can_undo: events.length === 1 && age <= AUTO_UNDO_WINDOW_MS,
    };
  } catch (e) {
    console.warn('[attendance auto notice]', e.message);
    return null;
  }
}

/**
 * 자동 출근 취소. 하루 기록 자체를 지워 '미출근' 으로 되돌린다(미출근 = row 없음).
 * ★ 지운 사실은 AuditLog 에 남긴다 — 원장이 사라지므로 여기에라도 흔적이 있어야
 *   나중에 "그날 왜 비어 있나" 를 설명할 수 있다.
 */
async function undoAutoClockIn({ businessId, userId }) {
  const workDate = await todayFor(businessId);
  const day = await AttendanceDay.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
  });
  if (!day) throw new AttendanceError('not_found', 404);
  const notice = await autoClockInNotice(day);
  if (!notice || !notice.can_undo) throw new AttendanceError('cannot_undo');

  const snapshot = { work_date: ymd(day.work_date), clock_in_at: day.clock_in_at, source: 'auto_focus' };
  await AttendanceEvent.destroy({ where: { attendance_day_id: day.id } });
  await day.destroy();
  try {
    await AuditLog.create({
      user_id: userId,
      business_id: businessId,
      action: 'attendance.undo_auto_clock_in',
      target_type: 'attendance_day',
      target_id: day.id,
      old_value: snapshot,
      new_value: null,
    });
  } catch (e) { console.warn('[attendance undo audit]', e.message); }
  // 화면(다른 기기 포함)이 즉시 미출근으로 돌아가게.
  const io = getIO();
  if (io) {
    try {
      io.to(`business:${businessId}`).emit('attendance:updated', { user_id: userId, work_date: workDate, state: null });
    } catch { /* broadcast 실패가 되돌리기를 무르지는 않는다 */ }
  }
  return day;
}

module.exports = {
  AttendanceError,
  clockIn, breakStart, breakEnd, clockOut, applyAdminFix,
  recomputeDay, foldEvents, liveTotals,
  autoClockInOnFocus, stopActiveFocus, pauseActiveFocus,
  autoClockInNotice, undoAutoClockIn,
  todayFor, workspaceTz, getIO,
};
