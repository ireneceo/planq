// 본인 근태 시각 수정 요청 — «본인 수정» 표시 · 관리자 «확인함» · 승인 설정 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §5·§6)
//
// 규칙 하나: 설정 «본인 수정은 승인 후 반영»(businesses.attendance_fix_approval)이
//   끔(기본 · #392 그대로) → 본인 값이 바로 유효(applied), 관리자는 «확인함»(confirmed)만.
//   켬                  → 승인 전까지 기계 값이 유효(pending), 승인(approved) 때 요청자 이름으로 반영 · 반려(rejected).
// 하루를 바꾸는 길은 계속 attendanceTransition(applyAdminFix) 하나다 — 여기는 그 앞의 «요청» 만 다룬다.
// 대표(owner)의 본인 수정은 승인 모드에서도 바로 반영한다(다른 관리자가 없을 수 있음 — 휴가 승인 선례). 감사 로그에 남는다.
const { Op } = require('sequelize');
const {
  AttendanceFixRequest, AttendanceDay, AttendanceEvent, Business, BusinessMember, User,
} = require('../models');
const A = require('./attendanceTransition');
const { ymd, addDaysStr, startOfDayInTz } = require('../utils/datetime');
const { sequelize } = require('../config/database');

const STATUSES = ['applied', 'pending', 'confirmed', 'approved', 'rejected', 'withdrawn'];
const ORIGINS = ['prompt_in', 'prompt_out', 'manual'];

class FixError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function snapshot(day) {
  return {
    clock_in_at: day.clock_in_at ? new Date(day.clock_in_at).toISOString() : null,
    clock_out_at: day.clock_out_at ? new Date(day.clock_out_at).toISOString() : null,
    work_total_sec: Number(day.work_total_sec || 0),
  };
}

async function approvalOn(businessId) {
  const b = await Business.findByPk(businessId, { attributes: ['attendance_fix_approval'] });
  return !!b?.attendance_fix_approval;
}
async function ownerIdOf(businessId) {
  const b = await Business.findByPk(businessId, { attributes: ['owner_id'] });
  return b?.owner_id || null;
}

async function currentEvents(dayId) {
  const evs = await AttendanceEvent.findAll({
    // 스코프: attendance_day_id 는 한 워크스페이스·한 사람의 하루다(호출부가 격리 검사함).
    where: { attendance_day_id: dayId, superseded_at: null },
    order: [['at', 'ASC'], ['id', 'ASC']],
    attributes: ['kind', 'at'],
  });
  return evs.map((e) => ({ kind: e.kind, at: new Date(e.at).toISOString() }));
}

/** 요청을 지금 하루 위에 얹은 타임라인 — prompt_in = 첫 출근만, prompt_out = 마지막 퇴근만, manual = 제출한 그대로. */
function timelineFor(origin, submitted, current) {
  if (origin === 'manual') return submitted;
  const at = submitted[0].at;
  const out = current.map((e) => ({ ...e }));
  if (origin === 'prompt_in') {
    const i = out.findIndex((e) => e.kind === 'clock_in');
    if (i < 0) throw new FixError('no_clock_in', 409);
    out[i].at = at;
  } else {
    let i = -1;
    out.forEach((e, k) => { if (e.kind === 'clock_out') i = k; });
    if (i < 0) throw new FixError('no_clock_out', 409);
    out[i].at = at;
  }
  return out;
}

/**
 * 하루 타임라인 검사 — **접수 때와 승인 때 같은 함수**(Fable 완료 검증 B1: 승인 대기 분기가 검사를 안 거쳐
 *   승인으로는 영영 끝낼 수 없는 요청·40일 전 출근 같은 값이 대기에 쌓였다).
 *   ① 종류 4개 ② 시각이 읽힘 ③ 출근으로 시작 ④ 모두 그 근무일 [0시, 다음 날 0시] 안 ⑤ 지금(+1분) 이후 금지.
 */
async function validateTimeline(day, timeline) {
  if (!Array.isArray(timeline) || !timeline.length) throw new FixError('events_required');
  const tz = await A.workspaceTz(day.business_id);
  const wd = ymd(day.work_date);
  const lo = startOfDayInTz(wd, tz).getTime();
  const hi = startOfDayInTz(addDaysStr(wd, 1), tz).getTime();
  const nowMax = Date.now() + 60 * 1000;
  const parsed = [];
  for (const e of timeline) {
    if (!['clock_in', 'break_start', 'break_end', 'clock_out'].includes(e?.kind)) throw new FixError('invalid_kind');
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t)) throw new FixError('invalid_at');
    if (t > nowMax) throw new FixError('future_time_not_allowed');
    if (t < lo || t > hi) throw new FixError('outside_work_date');
    parsed.push({ kind: e.kind, t });
  }
  parsed.sort((a, b) => a.t - b.t);
  if (parsed[0].kind !== 'clock_in') throw new FixError('timeline_must_start_with_clock_in');
}

/** 요청 때 본 값이 지금도 그대로인가 — 아니면 409 day_changed(관리자 정정 등으로 그사이 바뀜). */
function stillSame(origin, before, day) {
  const now = snapshot(day);
  if (origin === 'prompt_in') return before.clock_in_at === now.clock_in_at;
  if (origin === 'prompt_out') return before.clock_out_at === now.clock_out_at;
  return before.clock_in_at === now.clock_in_at && before.clock_out_at === now.clock_out_at
    && before.work_total_sec === now.work_total_sec;
}

function emitFix(requestId, userIds) {
  const io = A.getIO();
  if (!io) return;
  // ★ 워크스페이스 방에 뿌리지 않는다 — 동료가 누가 근태를 고쳤는지 알게 된다. 요청자·관리자 개인 방에만, 신호만.
  for (const uid of new Set(userIds.filter(Boolean))) {
    try { io.to(`user:${uid}`).emit('attendance:fix_updated', { request_id: requestId }); } catch { /* 신호 실패가 요청을 무르지 않는다 */ }
  }
}

async function managerIds(businessId) {
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
    attributes: ['user_id'],
  });
  return rows.map((r) => r.user_id).filter(Boolean);
}

async function notifyOne({ userId, businessId, title, body, actorUserId, requestId, workDate, ioApp }) {
  const { notify } = require('../routes/notifications');
  await notify({
    userId, businessId, eventKind: 'system', title, body,
    // 사유는 사람이 쓴 글 — 메일·푸시로 내보내지 않고 인앱에만(#407 선례).
    previewPolicy: 'internal_only', skipChannels: ['email', 'push'], suppressEscalation: true,
    link: `/business/settings/attendance?date=${workDate}`,
    actorUserId, entityType: 'attendance_fix_request', entityId: requestId, ioApp,
  }).catch(() => null);
}

async function audit(action, req, actorUserId, oldValue, newValue) {
  require('./auditService').createAuditLog({
    action, targetType: 'attendance_fix_request', targetId: req.id,
    userId: actorUserId, businessId: req.business_id, oldValue: oldValue || null, newValue: newValue || null,
  });
}

/**
 * 본인 수정 제출. day 는 본인 하루(라우트가 본인·14일·미래 금지를 확인함).
 *   origin manual: events = 그날 확정 타임라인 / prompt_in·prompt_out: events = [{kind, at}] 한 개.
 *   alreadyApplied: 묻는 창 출근(끔 모드) — clockIn 이 이미 그 시각으로 찍었다. 기록만 남긴다(before 는 기계 값).
 * 돌려주는 값: { request, day, pending }
 */
async function submit({ day, userId, origin, events, reason, before: beforeOverride, alreadyApplied = false, ioApp }) {
  if (!ORIGINS.includes(origin)) throw new FixError('invalid_origin');
  if (!reason || !String(reason).trim()) throw new FixError('fix_reason_required');
  const businessId = day.business_id;
  const workDate = ymd(day.work_date);
  const before = beforeOverride || snapshot(day);
  const ownerId = await ownerIdOf(businessId);
  const needApproval = !alreadyApplied && (await approvalOn(businessId)) && userId !== ownerId;
  // 접수 때 검사 — 승인 때와 같은 함수(대기로 가는 값도 반영될 수 있는 값이어야 한다).
  const timeline = timelineFor(origin, events, await currentEvents(day.id));
  await validateTimeline(day, timeline);

  // 같은 날 대기는 한 건 — 다시 고치면 앞 요청은 거둔다. 하루 행을 잠가 동시 요청 두 개가 둘 다 대기로 남지 않게(Fable 비차단).
  const t = await sequelize.transaction();
  let request;
  const withdrawn = [];
  try {
    await AttendanceDay.findByPk(day.id, { transaction: t, lock: t.LOCK.UPDATE });
    const prevPending = await AttendanceFixRequest.findAll({
      where: { business_id: businessId, attendance_day_id: day.id, user_id: userId, status: 'pending' }, transaction: t,
    });
    for (const p of prevPending) {
      await p.update({ status: 'withdrawn', decided_at: new Date(), decided_by: userId }, { transaction: t });
      withdrawn.push(p);
    }
    if (needApproval) {
      request = await AttendanceFixRequest.create({
        business_id: businessId, user_id: userId, attendance_day_id: day.id, work_date: workDate,
        origin, before, events, reason: String(reason).slice(0, 300), status: 'pending',
      }, { transaction: t });
    }
    await t.commit();
  } catch (e) { await t.rollback().catch(() => null); throw e; }
  for (const p of withdrawn) await audit('attendance.fix_withdraw', p, userId, { status: 'pending' }, { status: 'withdrawn', reason: 'replaced' });

  let updatedDay = day;
  if (!needApproval && !alreadyApplied) {
    updatedDay = await A.applyAdminFix({ dayId: day.id, events: timeline, fixReason: String(reason).slice(0, 300), actorUserId: userId });
  }
  // 자동 마감된 날을 본인이 고쳤거나(또는 승인 대기로 답했으면) «확인 안 된 자동 마감» 에서 뺀다.
  if (updatedDay.auto_closed && !updatedDay.close_confirmed_at) {
    await updatedDay.update({ close_confirmed_at: new Date() });
  }

  if (!request) {
    request = await AttendanceFixRequest.create({
      business_id: businessId, user_id: userId, attendance_day_id: day.id, work_date: workDate,
      origin, before, events, reason: String(reason).slice(0, 300), status: 'applied',
    });
  }
  await audit('attendance.fix_request', request, userId, before, { origin, status: request.status, events });

  const managers = await managerIds(businessId);
  emitFix(request.id, [userId, ...managers]);

  // 알림 — 끔 모드: 정정 창(manual)만 관리자에게(매일 생기는 묻는 창 수정은 목록에만) · 켬 모드: 대기가 생기면 관리자에게.
  if (origin === 'manual' || needApproval) {
    const me = await require('./displayName').getMemberDisplayNameByUser(businessId, userId).catch(() => null);
    const name = me?.name || '멤버';
    for (const m of managers) {
      if (m === userId) continue;
      await notifyOne({
        userId: m, businessId, actorUserId: userId, requestId: request.id, workDate, ioApp,
        title: needApproval ? '근태 수정 승인 요청' : '근태 기록 정정',
        body: `${name} 님 ${workDate} — ${String(reason).slice(0, 120)}`,
      });
    }
  }
  return { request, day: updatedDay, pending: needApproval };
}

/** 관리자 «확인함» — applied → confirmed. 다른 상태는 건너뛰고 건수만 돌려준다. */
async function confirm({ businessId, ids, actorUserId }) {
  const rows = await AttendanceFixRequest.findAll({
    where: { business_id: businessId, id: { [Op.in]: ids.map(Number).filter(Boolean) } },
  });
  let done = 0; let skipped = 0;
  // 자기 것은 자기가 못 정한다 — «확인함» 도 같다(대표만 예외 · Fable 완료 검증 B3).
  const ownerId = await ownerIdOf(businessId);
  let ownSkipped = 0;
  for (const r of rows) {
    if (r.status !== 'applied') { skipped += 1; continue; }
    if (r.user_id === actorUserId && actorUserId !== ownerId) { skipped += 1; ownSkipped += 1; continue; }
    await r.update({ status: 'confirmed', decided_by: actorUserId, decided_at: new Date() });
    await audit('attendance.fix_confirm', r, actorUserId, { status: 'applied' }, { status: 'confirmed' });
    emitFix(r.id, [r.user_id, ...(await managerIds(businessId))]);
    done += 1;
  }
  skipped += ids.length - rows.length;
  return { confirmed: done, skipped, own_skipped: ownSkipped };
}

async function loadForDecision({ businessId, id, actorUserId }) {
  const r = await AttendanceFixRequest.findOne({ where: { id: Number(id), business_id: businessId } });
  if (!r) throw new FixError('not_found', 404);
  if (r.status !== 'pending') throw new FixError('not_pending', 409);
  // 자기 것은 자기가 못 정한다 — 대표만 예외.
  if (r.user_id === actorUserId && actorUserId !== (await ownerIdOf(businessId))) throw new FixError('cannot_decide_own', 403);
  return r;
}

async function approve({ businessId, id, actorUserId, decideNote, ioApp }) {
  const r = await loadForDecision({ businessId, id, actorUserId });
  const day = await AttendanceDay.findByPk(r.attendance_day_id);
  if (!day) throw new FixError('not_found', 404);
  if (!stillSame(r.origin, r.before || {}, day)) throw new FixError('day_changed', 409);
  const timeline = timelineFor(r.origin, r.events, await currentEvents(day.id));
  await validateTimeline(day, timeline);
  // 먼저 «승인» 으로 잡는다(조건부 갱신) — 동시에 두 번 눌러도 반영은 한 번(Fable 비차단).
  const [claimed] = await AttendanceFixRequest.update(
    { status: 'approved', decided_by: actorUserId, decided_at: new Date(), decide_note: decideNote ? String(decideNote).slice(0, 300) : null },
    { where: { id: r.id, business_id: businessId, status: 'pending' } },
  );
  if (!claimed) throw new FixError('not_pending', 409);
  let updated;
  try {
    // 요청자 이름으로 반영 — 원장 actor 가 요청자다(«누가 고쳤는지» 는 요청자, «누가 승인했는지» 는 요청 행).
    updated = await A.applyAdminFix({ dayId: day.id, events: timeline, fixReason: r.reason || 'approved', actorUserId: r.user_id });
  } catch (e) {
    await AttendanceFixRequest.update({ status: 'pending', decided_by: null, decided_at: null, decide_note: null }, { where: { id: r.id } });
    throw e;
  }
  await r.reload();
  await audit('attendance.fix_approve', r, actorUserId, { status: 'pending' }, { status: 'approved' });
  emitFix(r.id, [r.user_id, ...(await managerIds(businessId))]);
  if (r.user_id !== actorUserId) {
    await notifyOne({
      userId: r.user_id, businessId, actorUserId, requestId: r.id, workDate: ymd(r.work_date), ioApp,
      title: '근태 수정이 승인됐어요', body: `${ymd(r.work_date)}`,
    });
  }
  return { request: r, day: updated };
}

async function reject({ businessId, id, actorUserId, decideNote, ioApp }) {
  if (!decideNote || !String(decideNote).trim()) throw new FixError('decide_note_required');
  const r = await loadForDecision({ businessId, id, actorUserId });
  const [claimed] = await AttendanceFixRequest.update(
    { status: 'rejected', decided_by: actorUserId, decided_at: new Date(), decide_note: String(decideNote).slice(0, 300) },
    { where: { id: r.id, business_id: businessId, status: 'pending' } },
  );
  if (!claimed) throw new FixError('not_pending', 409);
  await r.reload();
  await audit('attendance.fix_reject', r, actorUserId, { status: 'pending' }, { status: 'rejected', note: r.decide_note });
  emitFix(r.id, [r.user_id, ...(await managerIds(businessId))]);
  await notifyOne({
    userId: r.user_id, businessId, actorUserId, requestId: r.id, workDate: ymd(r.work_date), ioApp,
    title: '근태 수정이 반려됐어요', body: `${ymd(r.work_date)} — ${r.decide_note}`,
  });
  return { request: r };
}

async function withdraw({ businessId, id, userId }) {
  const r = await AttendanceFixRequest.findOne({ where: { id: Number(id), business_id: businessId } });
  if (!r) throw new FixError('not_found', 404);
  if (r.user_id !== userId) throw new FixError('forbidden', 403);
  if (r.status !== 'pending') throw new FixError('not_pending', 409);
  await r.update({ status: 'withdrawn', decided_by: userId, decided_at: new Date() });
  await audit('attendance.fix_withdraw', r, userId, { status: 'pending' }, { status: 'withdrawn' });
  emitFix(r.id, [r.user_id, ...(await managerIds(businessId))]);
  return { request: r };
}

/** 응답 모양 — 화이트리스트. 사람 이름은 워크스페이스 표시명. */
async function serializeList(rows, businessId) {
  const ids = [...new Set(rows.flatMap((r) => [r.user_id, r.decided_by]).filter(Boolean))];
  const users = ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'name'] }) : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const display = await require('./displayName').getMemberNameMap(businessId, ids);
  const nameOf = (id) => (id ? (display.get(id)?.name || nameMap.get(id) || null) : null);
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: nameOf(r.user_id),
    attendance_day_id: r.attendance_day_id,
    work_date: ymd(r.work_date),
    origin: r.origin,
    before: r.before || null,
    events: r.events || [],
    reason: r.reason || null,
    status: r.status,
    decided_by: r.decided_by || null,
    decided_by_name: nameOf(r.decided_by),
    decided_at: r.decided_at || null,
    decide_note: r.decide_note || null,
    created_at: r.created_at || r.get?.('created_at') || null,
  }));
}

/**
 * 날짜별 «본인 수정» 표시 재료 — 그 하루의 가장 최근 요청 하나(거둔 것 제외).
 *   { request_id, status, origin, before, events, reason, decided_by_name, decide_note } · 본인/관리자 응답에만 싣는다(§6 열람 범위와 같다).
 */
async function selfFixOf(dayIds) {
  const out = new Map();
  const ids = (dayIds || []).filter(Boolean);
  if (!ids.length) return out;
  const rows = await AttendanceFixRequest.findAll({
    where: { attendance_day_id: { [Op.in]: ids }, status: { [Op.ne]: 'withdrawn' } },
    order: [['created_at', 'DESC'], ['id', 'DESC']],
  });
  const latest = [];
  for (const r of rows) if (!out.has(r.attendance_day_id)) { out.set(r.attendance_day_id, null); latest.push(r); }
  if (!latest.length) return new Map();
  const ser = await serializeList(latest, latest[0].business_id);
  const map = new Map();
  ser.forEach((x) => map.set(x.attendance_day_id, {
    request_id: x.id, status: x.status, origin: x.origin, before: x.before, events: x.events,
    reason: x.reason, decided_by_name: x.decided_by_name, decided_at: x.decided_at, decide_note: x.decide_note,
  }));
  return map;
}

module.exports = {
  selfFixOf, validateTimeline,
  STATUSES, ORIGINS, FixError, snapshot, approvalOn, submit, confirm, approve, reject, withdraw, serializeList,
};
