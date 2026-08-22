// 휴가 상태 전이의 **단일 착지점** (#208 · #285) — docs/ATTENDANCE_LEAVE_DESIGN.md §4.2 · §7.1
//
// 승인·반려·취소가 라우트마다 흩어지면 알림 한 종류가 빠지고(운영안정성 §13 의 실제 회귀),
//   잔여 검사도 경로마다 달라진다. 그래서 네 전이와 잔여 계산이 전부 이 파일에 있다.
//
// ★ 잔여는 저장하지 않는다 — 부여 합 − 승인된 사용 합. 컬럼으로 두면 취소·정정 때마다
//   맞춰 고쳐야 하고, 한 번 어긋나면 아무도 원인을 못 찾는다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  LeaveRequest, LeaveGrant, BusinessMember, Business, AuditLog, User,
} = require('../models');
const { ymd } = require('../utils/datetime');

function getIO() { return global.__planqIo || null; }

class LeaveError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function daysBetween(startYmd, endYmd) {
  // ★ DATEONLY 는 Date 객체로 돌아온다 — 그대로 템플릿에 넣으면 NaN 이 되고 결과가 0 이 된다(utils/datetime.ymd 주석).
  const a = new Date(`${ymd(startYmd)}T00:00:00Z`).getTime();
  const b = new Date(`${ymd(endYmd)}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * 차감일 환산 (§7.1) — **승인 시점의 근무 설정**으로 계산하고 그대로 박제한다.
 * 나중에 하루 근무시간이 바뀌어도 지나간 승인은 움직이지 않는다.
 */
async function computeDaysCharged(req_, businessId, userId) {
  if (req_.unit === 'half_day') return 0.5;
  if (req_.unit === 'hours') {
    const bm = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: userId, removed_at: null },
      attributes: ['daily_work_hours'],
    });
    const daily = Number(bm?.daily_work_hours) || 8;
    return Math.round((Number(req_.hours || 0) / daily) * 10) / 10;
  }
  // full_day — 기간의 날짜 수를 그대로 센다. 요일제 근무 캘린더는 이 시스템에 없다(설계 §7.1 한계 명시).
  return daysBetween(req_.start_date, req_.end_date);
}

/** 그 해 잔여 — 전부 파생. `{granted, used, pending, remaining}` */
async function getBalance(businessId, userId, year) {
  const y = Number(year) || new Date().getFullYear();
  const grants = await LeaveGrant.findAll({
    where: { business_id: businessId, user_id: userId, year: y },
    attributes: ['days'],
  });
  const granted = grants.reduce((s, g) => s + Number(g.days || 0), 0);
  const reqs = await LeaveRequest.findAll({
    where: {
      business_id: businessId, user_id: userId, leave_type: 'paid',
      status: { [Op.in]: ['approved', 'pending'] },
      start_date: { [Op.between]: [`${y}-01-01`, `${y}-12-31`] },
    },
    attributes: ['status', 'days_charged', 'unit', 'start_date', 'end_date', 'hours'],
  });
  let used = 0, pending = 0;
  for (const r of reqs) {
    // pending 은 아직 days_charged 가 0 이다(승인 시 박제). 안내용으로 그 자리에서 추정한다 —
    //   "신청해 둔 것까지 빼면 얼마 남나" 를 보여주지 않으면 잔여를 넘겨 신청하게 된다.
    const d = r.status === 'approved'
      ? Number(r.days_charged || 0)
      : await computeDaysCharged(r, businessId, userId);
    if (r.status === 'approved') used += d; else pending += d;
  }
  const round = (n) => Math.round(n * 10) / 10;
  return {
    year: y,
    granted: round(granted),
    used: round(used),
    pending: round(pending),
    remaining: round(granted - used),
    remaining_after_pending: round(granted - used - pending),
  };
}

async function audit({ action, request, actorUserId, oldValue, newValue }) {
  try {
    await AuditLog.create({
      user_id: actorUserId,
      business_id: request.business_id,
      action,
      target_type: 'leave_request',
      target_id: request.id,
      old_value: oldValue || null,
      new_value: newValue || null,
    });
  } catch (e) { console.warn('[leave audit]', e.message); }
}

function broadcast(request) {
  const io = getIO();
  if (!io) return;
  try {
    io.to(`business:${request.business_id}`).emit('leave:updated', {
      request_id: request.id, user_id: request.user_id, status: request.status,
    });
  } catch (e) { console.warn('[leave broadcast]', e.message); }
}

// 알림은 전이 안에서 보낸다 — 라우트에 두면 다른 경로(Cue·cron)로 상태가 바뀔 때 조용히 빠진다.
async function notifyManagers(request, actorUserId) {
  try {
    const { notifyMany } = require('../routes/notifications');
    const mgrs = await BusinessMember.findAll({
      where: { business_id: request.business_id, role: { [Op.in]: ['owner', 'admin'] }, removed_at: null },
      attributes: ['user_id'],
    });
    const biz = await Business.findByPk(request.business_id, { attributes: ['name'] });
    const applicant = await User.findByPk(request.user_id, { attributes: ['name'] });
    await notifyMany({
      userIds: mgrs.map((m) => m.user_id),
      businessId: request.business_id,
      eventKind: 'leave',
      title: `휴가 신청 — ${applicant?.name || ''}`,
      body: `${ymd(request.start_date)}${ymd(request.end_date) !== ymd(request.start_date) ? ` ~ ${ymd(request.end_date)}` : ''}`,
      link: `/attendance?tab=team&leave=${request.id}`,
      workspaceName: biz?.name,
      excludeUserId: actorUserId,
      actorUserId,
      entityType: 'leave_request',
      entityId: request.id,
    });
  } catch (e) { console.warn('[leave notify managers]', e.message); }
}

async function notifyApplicant(request, actorUserId, kind) {
  try {
    const { notify } = require('../routes/notifications');
    const biz = await Business.findByPk(request.business_id, { attributes: ['name'] });
    const titleMap = { approved: '휴가가 승인되었습니다', rejected: '휴가가 반려되었습니다', canceled: '휴가가 취소되었습니다' };
    await notify({
      userId: request.user_id,
      businessId: request.business_id,
      eventKind: 'leave',
      title: titleMap[kind] || '휴가 상태가 변경되었습니다',
      body: `${ymd(request.start_date)}${ymd(request.end_date) !== ymd(request.start_date) ? ` ~ ${ymd(request.end_date)}` : ''}`,
      link: `/attendance?tab=leave&leave=${request.id}`,
      workspaceName: biz?.name,
      actorUserId,
      entityType: 'leave_request',
      entityId: request.id,
    });
  } catch (e) { console.warn('[leave notify applicant]', e.message); }
}

/** 신청. 겹치는 기간은 막는다 — 같은 날에 두 건이 승인되면 잔여가 이중으로 빠진다. */
async function createRequest({ businessId, userId, payload, actorUserId }) {
  const unit = payload.unit || 'full_day';
  if (!['full_day', 'half_day', 'hours'].includes(unit)) throw new LeaveError('invalid_unit');
  const leaveType = payload.leave_type === 'unpaid' ? 'unpaid' : 'paid';
  const start = payload.start_date;
  const end = unit === 'full_day' ? (payload.end_date || payload.start_date) : payload.start_date;
  if (!start || !end) throw new LeaveError('date_required');
  if (daysBetween(start, end) < 1) throw new LeaveError('invalid_range');
  if (unit === 'half_day' && !['am', 'pm'].includes(payload.half_kind)) throw new LeaveError('half_kind_required');
  if (unit === 'hours' && !(Number(payload.hours) > 0)) throw new LeaveError('hours_required');

  const overlap = await LeaveRequest.findOne({
    where: {
      business_id: businessId, user_id: userId,
      status: { [Op.in]: ['pending', 'approved'] },
      start_date: { [Op.lte]: end }, end_date: { [Op.gte]: start },
    },
  });
  if (overlap) throw new LeaveError('overlapping_leave');

  const request = await LeaveRequest.create({
    business_id: businessId, user_id: userId,
    leave_type: leaveType, unit,
    start_date: start, end_date: end,
    half_kind: unit === 'half_day' ? payload.half_kind : null,
    hours: unit === 'hours' ? Number(payload.hours) : null,
    days_charged: 0,           // 승인 시 박제
    reason: (payload.reason || '').slice(0, 500) || null,
    status: 'pending',
  });
  await audit({ action: 'leave.request', request, actorUserId, newValue: request.toJSON() });
  broadcast(request);
  await notifyManagers(request, actorUserId);
  return request;
}

/** 승인 — 여기서만 days_charged 가 확정되고 잔여가 검사된다. */
async function approve({ requestId, actorUserId, decideNote }) {
  const t = await sequelize.transaction();
  try {
    const request = await LeaveRequest.findByPk(requestId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!request) throw new LeaveError('not_found', 404);
    if (request.status !== 'pending') throw new LeaveError('not_pending');
    const charged = await computeDaysCharged(request, request.business_id, request.user_id);
    if (request.leave_type === 'paid') {
      const year = Number(ymd(request.start_date).slice(0, 4));
      const bal = await getBalance(request.business_id, request.user_id, year);
      if (bal.remaining < charged) throw new LeaveError('insufficient_leave_balance');
    }
    await request.update({
      status: 'approved', days_charged: charged,
      decided_by: actorUserId, decided_at: new Date(),
      decide_note: (decideNote || '').slice(0, 300) || null,
    }, { transaction: t });
    await t.commit();
    await audit({ action: 'leave.approve', request, actorUserId, newValue: { days_charged: charged } });
    broadcast(request);
    await notifyApplicant(request, actorUserId, 'approved');
    return request;
  } catch (err) { await t.rollback(); throw err; }
}

async function reject({ requestId, actorUserId, decideNote }) {
  const request = await LeaveRequest.findByPk(requestId);
  if (!request) throw new LeaveError('not_found', 404);
  if (request.status !== 'pending') throw new LeaveError('not_pending');
  await request.update({
    status: 'rejected', decided_by: actorUserId, decided_at: new Date(),
    decide_note: (decideNote || '').slice(0, 300) || null,
  });
  await audit({ action: 'leave.reject', request, actorUserId });
  broadcast(request);
  await notifyApplicant(request, actorUserId, 'rejected');
  return request;
}

/**
 * 취소. 시작일이 지난 승인 건은 본인이 못 지운다 — 그건 신청 철회가 아니라 기록 정정이다(§4.2).
 * 잔여는 파생값이라 status 만 바뀌면 자동으로 되돌아온다(따로 더해줄 곳이 없다).
 */
async function cancel({ requestId, actorUserId, isManager }) {
  const request = await LeaveRequest.findByPk(requestId);
  if (!request) throw new LeaveError('not_found', 404);
  if (!['pending', 'approved'].includes(request.status)) throw new LeaveError('not_cancelable');
  const isOwnerOfRequest = request.user_id === actorUserId;
  if (!isOwnerOfRequest && !isManager) throw new LeaveError('forbidden', 403);
  if (request.status === 'approved' && !isManager) {
    const today = new Date().toISOString().slice(0, 10);
    if (ymd(request.start_date) <= today) throw new LeaveError('already_started', 403);
  }
  await request.update({ status: 'canceled', canceled_by: actorUserId, canceled_at: new Date() });
  await audit({ action: 'leave.cancel', request, actorUserId });
  broadcast(request);
  if (!isOwnerOfRequest) await notifyApplicant(request, actorUserId, 'canceled');
  return request;
}

module.exports = {
  LeaveError, getBalance, computeDaysCharged, daysBetween,
  createRequest, approve, reject, cancel,
};
