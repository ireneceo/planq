// 휴가 상태 전이의 **단일 착지점** (#208 · #285) — docs/ATTENDANCE_LEAVE_DESIGN.md §4.2 · §7.1
//
// 승인·반려·취소가 라우트마다 흩어지면 알림 한 종류가 빠지고(운영안정성 §13 의 실제 회귀),
//   잔여 검사도 경로마다 달라진다. 그래서 네 전이와 잔여 계산이 전부 이 파일에 있다.
//
// ★ 잔여는 저장하지 않는다 — 부여 합 − 승인된 사용 합. 컬럼으로 두면 취소·정정 때마다
//   맞춰 고쳐야 하고, 한 번 어긋나면 아무도 원인을 못 찾는다.
const { Op } = require('sequelize');
const { writeAudit } = require('./auditService');
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
  // full_day — #424(Irene 결정 2026-10-02): **근무일만** 센다(근무 요일 ∧ 워크스페이스 휴일 아님).
  //   금~월 휴가는 4일이 아니라 2일이다. 달력은 가용시간과 같은 한 벌(services/workspaceHolidays).
  //   ★ 이미 승인된 건은 days_charged 가 박제라 바뀌지 않는다 — 이 규칙은 앞으로의 승인·대기 추정에만 쓰인다.
  return countLeaveWorkdays(businessId, req_.start_date, req_.end_date);
}

async function countLeaveWorkdays(businessId, startYmd, endYmd) {
  const { getWorkCalendar, countWorkdays } = require('./workspaceHolidays');
  const s = ymd(startYmd); const e = ymd(endYmd);
  const cal = await getWorkCalendar(businessId, s, e);
  return countWorkdays(s, e, cal);
}

/** 그 해 잔여 — 전부 파생. 종류 축은 leave_type_id(2026-10-22, docs/LEAVE_TYPES_DESIGN.md §5.2).
 *  반환: `{ granted, used, pending, remaining, …, by_type: [{id, code, name, pay, …}], by_category: {annual: {...}, …} }`
 *  ★ 최상위 값은 **전 종류 합**이다(옛 호출부 호환). 실제 판정은 종류별 값으로 한다 —
 *    합으로 판정하면 병가를 쓰다 연차가 사라진다.
 *  ★ 사용량은 신청 행의 박제(leave_type='paid')만 센다 — 종류 표의 pay 를 읽지 않는다(§7-1).
 *  ★ by_category 는 한 릴리즈 호환(옛 번들·Cue) — 시스템 code 4종만. 다음 정리 때 지운다.
 */
async function getBalance(businessId, userId, year, leaveTypeId = null) {
  const LT = require('./leaveTypes');
  const y = Number(year) || new Date().getFullYear();
  const types = await LT.listTypes(businessId, { includeInactive: true });
  const grantWhere = { business_id: businessId, user_id: userId, year: y };
  if (leaveTypeId) grantWhere.leave_type_id = leaveTypeId;
  const grants = await LeaveGrant.findAll({
    where: grantWhere,
    attributes: ['days', 'leave_type_id'],
  });
  const reqWhere = {
    business_id: businessId, user_id: userId, leave_type: 'paid',
    status: { [Op.in]: ['approved', 'pending'] },
    start_date: { [Op.between]: [`${y}-01-01`, `${y}-12-31`] },
  };
  if (leaveTypeId) reqWhere.leave_type_id = leaveTypeId;
  const reqs = await LeaveRequest.findAll({
    where: reqWhere,
    attributes: ['status', 'days_charged', 'unit', 'start_date', 'end_date', 'hours', 'leave_type_id'],
  });
  const acc = new Map(types.map((t) => [t.id, { granted: 0, used: 0, pending: 0 }]));
  const slot = (id) => { if (!acc.has(id)) acc.set(id, { granted: 0, used: 0, pending: 0 }); return acc.get(id); };
  let granted = 0;
  for (const g of grants) { const d = Number(g.days || 0); granted += d; slot(g.leave_type_id).granted += d; }
  let used = 0, pending = 0;
  for (const r of reqs) {
    // pending 은 아직 days_charged 가 0 이다(승인 시 박제). 안내용으로 그 자리에서 추정한다 —
    //   "신청해 둔 것까지 빼면 얼마 남나" 를 보여주지 않으면 잔여를 넘겨 신청하게 된다.
    const d = r.status === 'approved'
      ? Number(r.days_charged || 0)
      : await computeDaysCharged(r, businessId, userId);
    if (r.status === 'approved') { used += d; slot(r.leave_type_id).used += d; }
    else { pending += d; slot(r.leave_type_id).pending += d; }
  }
  const round = (n) => Math.round(n * 10) / 10;
  // ★ 2026-09-09 — `daily_work_hours` 를 같이 내보낸다.
  //   신청 화면이 "이번 신청은 며칠짜리인가" 를 미리 보여주려면 이 값이 필요하다
  //   (computeDaysCharged 가 시간 단위를 이 값으로 나눈다 — 8 고정이 아니다).
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['daily_work_hours'],
  });
  const nums = (a) => ({
    granted: round(a.granted), used: round(a.used), pending: round(a.pending),
    remaining: round(a.granted - a.used), remaining_after_pending: round(a.granted - a.used - a.pending),
  });
  const byType = types
    .filter((t) => !leaveTypeId || t.id === Number(leaveTypeId))
    .map((t) => ({ id: t.id, code: t.code || null, name: t.name || null, pay: t.pay, is_active: !!t.is_active, ...nums(acc.get(t.id)) }));
  const byCategory = {};
  for (const t of types) {
    if (!LT.isLegacyCode(t.code)) continue;
    if (leaveTypeId && t.id !== Number(leaveTypeId)) continue;
    byCategory[t.code] = nums(acc.get(t.id));
  }
  return {
    year: y,
    granted: round(granted),
    used: round(used),
    pending: round(pending),
    remaining: round(granted - used),
    remaining_after_pending: round(granted - used - pending),
    daily_work_hours: Number(bm?.daily_work_hours) || 8,
    by_type: byType,
    by_category: byCategory,
  };
}

async function audit({ action, request, actorUserId, oldValue, newValue }) {
  try {
    await writeAudit({
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
      // 승인은 설정 > 근태 관리에서 한다(#208). 옛 `/attendance?tab=team` 은 없는 탭이라 흰 화면이었다.
      link: `/business/settings/attendance?leave=${request.id}`,
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
  // ★ 종류가 유급/무급을 정한다(2026-10-22). 본문의 leave_type 은 무시한다(옛 번들이 보내도) —
  //   신청 행의 leave_type 은 «신청 시점에 그 종류가 유급이었나» 의 박제다.
  //   옛 번들: leave_type_id 없이 category 만 보내면 그 code 의 시스템 종류. 둘 다 없으면 연차.
  //   모르는 값은 거절한다 — 조용히 연차로 떨어뜨리면 병가를 신청한 줄 알았는데 연차가 깎인다.
  const LT = require('./leaveTypes');
  let type;
  try {
    if (payload.leave_type_id !== undefined && payload.leave_type_id !== null && payload.leave_type_id !== '') {
      type = await LT.resolveType(businessId, payload.leave_type_id);
    } else {
      type = await LT.resolveByCode(businessId, payload.category || 'annual');
    }
  } catch (e) {
    if (e instanceof LT.LeaveTypeError) throw new LeaveError(e.code, e.status);
    throw e;
  }
  const leaveType = type.pay;
  const start = payload.start_date;
  const end = unit === 'full_day' ? (payload.end_date || payload.start_date) : payload.start_date;
  if (!start || !end) throw new LeaveError('date_required');
  if (daysBetween(start, end) < 1) throw new LeaveError('invalid_range');
  if (unit === 'half_day' && !['am', 'pm'].includes(payload.half_kind)) throw new LeaveError('half_kind_required');
  if (unit === 'hours' && !(Number(payload.hours) > 0)) throw new LeaveError('hours_required');
  // #424 — 근무일이 하루도 없는 기간(주말·공휴일만)은 쉴 날이 없다. 0일짜리 승인 대기를 만들지 않는다.
  if (await countLeaveWorkdays(businessId, start, end) < 1) throw new LeaveError('no_workdays_in_range');

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
    leave_type: leaveType, leave_type_id: type.id, category: LT.legacyCategoryOf(type), unit,
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
      // ★ **그 종류의** 잔여로 검사한다. 전 종류 합으로 보면 병가 잔여로 연차가 승인된다.
      const bal = await getBalance(request.business_id, request.user_id, year, request.leave_type_id);
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

/**
 * 부여 고치기·지우기 (2026-10-22, Irene: «부여한 것도 관리하고 수정 삭제 해야지»).
 *   옛 원칙은 «정정은 음수 행을 얹는다» 였다 — 지금도 음수 행은 된다. 다만 잘못 넣은 행을 사람이 직접 고치고 지우게 한다.
 *   ★ 고친 결과 그 종류·그 해의 잔여가 **이미 승인된 사용량 아래로** 내려가면 막는다(409 grant_below_used) —
 *     막지 않으면 승인된 휴가가 «잔여 −2» 로 남고 그 뒤 승인 판정이 어긋난다. 신청 중(pending)은 보지 않는다(승인 때 다시 검사한다).
 *   ★ 감사(leave.grant_update·leave.grant_delete)에 옛 값·새 값을 남긴다 — 원장 행을 고치는 대신 «누가 언제 무엇을» 이 여기 남는다.
 */
async function updateGrant({ grantId, businessId, actorUserId, patch }) {
  const grant = await LeaveGrant.findOne({ where: { id: grantId, business_id: businessId } });
  if (!grant) throw new LeaveError('not_found', 404);
  const before = grant.toJSON();
  const next = {};
  if (patch.days !== undefined) {
    const d = Number(patch.days);
    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 366 || Math.round(d * 2) !== d * 2) throw new LeaveError('invalid_days');
    next.days = d;
  }
  if (patch.note !== undefined) next.note = (String(patch.note || '')).slice(0, 300) || null;
  if (!Object.keys(next).length) return grant;
  if (next.days !== undefined) {
    const bal = await getBalance(businessId, grant.user_id, grant.year, grant.leave_type_id);
    const after = bal.remaining - Number(grant.days) + next.days;
    if (after < 0) throw new LeaveError('grant_below_used', 409);
  }
  await grant.update(next);
  await writeAudit({
    user_id: actorUserId, business_id: businessId, action: 'leave.grant_update',
    entity_type: 'leave_grant', entity_id: grant.id, old_value: before, new_value: grant.toJSON(),
  }).catch((e) => console.warn('[leave grant audit] update', grant.id, e.message));
  broadcastGrant(grant);
  return grant;
}

async function deleteGrant({ grantId, businessId, actorUserId }) {
  const grant = await LeaveGrant.findOne({ where: { id: grantId, business_id: businessId } });
  if (!grant) throw new LeaveError('not_found', 404);
  const bal = await getBalance(businessId, grant.user_id, grant.year, grant.leave_type_id);
  if (bal.remaining - Number(grant.days) < 0) throw new LeaveError('grant_below_used', 409);
  const before = grant.toJSON();
  await grant.destroy();
  await writeAudit({
    user_id: actorUserId, business_id: businessId, action: 'leave.grant_delete',
    entity_type: 'leave_grant', entity_id: before.id, old_value: before, new_value: null,
  }).catch((e) => console.warn('[leave grant audit] delete', before.id, e.message));
  broadcastGrant(before);
}

function broadcastGrant(g) {
  const io = getIO();
  if (!io) return;
  try { io.to(`business:${g.business_id}`).emit('leave:updated', { grant_id: g.id, user_id: g.user_id }); } catch (e) { /* 신호 실패는 저장을 막지 않는다 */ }
}

/** 팀 잔여 — 관리 화면 표(멤버 × 종류). 숫자는 getBalance 한 벌(개인 화면·승인 판정과 같은 공식). */
async function getTeamBalances(businessId, userIds, year) {
  const out = [];
  for (const uid of userIds) out.push({ user_id: uid, ...(await getBalance(businessId, uid, year)) });
  return out;
}

module.exports = {
  LeaveError, getBalance, computeDaysCharged, daysBetween,
  createRequest, approve, reject, cancel,
  updateGrant, deleteGrant, getTeamBalances,
};
