// 워크스페이스 참여 신청 — 판정·쓰기 한 벌 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §5, Fable 설계)
//   신청자 라우트(routes/join.js)와 워크스페이스 라우트(routes/join_admin.js)가 같이 쓴다.
//   ★ 만료는 상태가 아니다 — pending ∧ expires_at < 지금(isLive). 새 cron 없음.
//   ★ 승인은 트랜잭션 안에서 행을 잠그고(FOR UPDATE) 다시 본다 — 같은 신청을 두 번 눌러도 멤버 행은 하나.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { WorkspaceJoinRequest, BusinessMember, Business, User } = require('../models');

const DAY_MS = 86400000;
const PENDING_MS = DAY_MS * 14;       // 대기 14일
const COOLDOWN_MS = DAY_MS * 7;       // 거절 뒤 7일
const SHOW_DECIDED_MS = DAY_MS * 30;  // 결정된 신청을 신청자에게 보여 주는 기간
const SHOW_EXPIRED_MS = DAY_MS * 7;   // 기한 지난 신청을 보여 주는 기간

class JoinError extends Error {
  constructor(code, status, body = null) { super(code); this.code = code; this.status = status; this.body = body; }
}

function isLive(row, nowMs = Date.now()) {
  return !!row && row.status === 'pending' && new Date(row.expires_at).getTime() > nowMs;
}

/** 신청자 쪽에 보여 줄 상태 — null 이면 신청 없음/오래된 것. */
function requestView(row, nowMs = Date.now()) {
  if (!row) return null;
  const expired = row.status === 'pending' && !isLive(row, nowMs);
  return {
    id: row.id,
    status: expired ? 'expired' : row.status,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    retry_after: row.retry_after && new Date(row.retry_after).getTime() > nowMs ? row.retry_after : null,
    decision_note: row.status === 'rejected' ? (row.decision_note || null) : null,
  };
}

async function activeMemberRow(businessId, userId, transaction) {
  return BusinessMember.findOne({ where: { business_id: businessId, user_id: userId, removed_at: null }, transaction });
}

/** owner·admin 활성 멤버 id (알림 받을 사람) — emailImapCron 과 같은 집합. */
async function workspaceManagerIds(businessId) {
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, user_id: { [Op.ne]: null }, role: { [Op.in]: ['owner', 'admin'] } },
    attributes: ['user_id'],
  });
  return [...new Set(rows.map((r) => r.user_id))];
}

function emitSignal(io, room, event, payload) {
  try { io?.to(room).emit(event, payload); } catch { /* 신호만 — 실패해도 본 동작은 끝났다 */ }
}

/**
 * 신청(또는 같은 행 재신청). 호출부가 열림 판정(도메인·코드)을 끝낸 뒤 부른다.
 * @returns {Promise<WorkspaceJoinRequest>}
 */
async function createOrReapply({ businessId, user, source, message, io, actorReq }) {
  const now = new Date();
  if (await activeMemberRow(businessId, user.id)) throw new JoinError('already_member', 409);
  const msg = message ? String(message).trim().slice(0, 300) || null : null;
  let row = await WorkspaceJoinRequest.findOne({ where: { business_id: businessId, user_id: user.id } });
  if (row) {
    if (isLive(row)) throw new JoinError('already_requested', 409);
    if (row.retry_after && new Date(row.retry_after) > now) throw new JoinError('join_cooldown', 409, { success: false, message: 'join_cooldown', retry_after: row.retry_after });
    await row.update({
      source, status: 'pending', message: msg, requested_at: now, expires_at: new Date(now.getTime() + PENDING_MS),
      decided_at: null, decided_by: null, decision_note: null, retry_after: null,
    });
  } else {
    try {
      row = await WorkspaceJoinRequest.create({
        business_id: businessId, user_id: user.id, source, status: 'pending', message: msg,
        requested_at: now, expires_at: new Date(now.getTime() + PENDING_MS),
      });
    } catch (e) {
      // 동시 두 요청 — UNIQUE 가 막았다. 이미 들어간 행이 곧 내 신청이다.
      if (e?.name === 'SequelizeUniqueConstraintError') throw new JoinError('already_requested', 409);
      throw e;
    }
  }
  // 알림 — owner·admin 전원(초대와 같은 «멤버십» 알림 종류 invite 를 쓴다 · 새 메일 양식 없음)
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'brand_name', 'name'] });
  const wsName = biz?.brand_name || biz?.name || '';
  const { notify } = require('../routes/notifications');
  const managers = await workspaceManagerIds(businessId);
  for (const uid of managers) {
    notify({
      userId: uid, businessId, eventKind: 'invite',
      title: '참여 신청이 왔습니다', body: `${user.name || ''} (${user.email || ''})`,
      link: '/business/members?tab=requests', ctaLabel: '참여 신청 보기', workspaceName: wsName,
      actorUserId: user.id, entityType: 'workspace_join_request', entityId: row.id, ioApp: io,
    }).catch((e) => console.warn('[join notify managers]', e.message));
  }
  emitSignal(io, `business:${businessId}`, 'join_request:updated', { id: row.id, business_id: businessId });
  try {
    require('./auditService').logAudit(actorReq, {
      action: 'workspace.join_request', targetType: 'workspace_join_request', targetId: row.id, businessId,
      newValue: { source, user_id: user.id },
    });
  } catch { /* 감사 실패는 신청을 막지 않는다 */ }
  return row;
}

async function cancel({ requestId, userId, io, actorReq }) {
  const row = await WorkspaceJoinRequest.findOne({ where: { id: requestId, user_id: userId } });
  if (!row || !isLive(row)) throw new JoinError('join_request_not_found', 404);
  await row.update({ status: 'canceled', decided_at: new Date(), decided_by: userId });
  emitSignal(io, `business:${row.business_id}`, 'join_request:updated', { id: row.id, business_id: row.business_id });
  try {
    require('./auditService').logAudit(actorReq, {
      action: 'workspace.join_cancel', targetType: 'workspace_join_request', targetId: row.id, businessId: row.business_id,
    });
  } catch { /* noop */ }
  return row;
}

/**
 * 승인 — 멤버 행(기본 member · admin 선택 가능) + 고객 흔적 → 멤버(clientToMember) + 행 approved.
 * @throws JoinError(join_request_not_found 404 · already_member 409 · quota 422)
 */
async function approve({ businessId, requestId, role, approver, io, actorReq }) {
  const accessRole = require('./memberInvite').resolveAccessRole(role);
  if (accessRole.error) throw new JoinError(accessRole.error, 400);
  const t = await sequelize.transaction();
  let conv = null; let row = null; let memberRow = null;
  try {
    row = await WorkspaceJoinRequest.findOne({ where: { id: requestId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row || !isLive(row)) { await t.rollback(); throw new JoinError('join_request_not_found', 404); }
    if (await activeMemberRow(businessId, row.user_id, t)) { await t.rollback(); throw new JoinError('already_member', 409); }
    const planEngine = require('./plan');
    const can = await planEngine.can(businessId, 'add_member');
    if (!can.ok) { await t.rollback(); throw new JoinError('quota', 422, planEngine.buildQuotaError(can, businessId)); }
    const now = new Date();
    // 예전에 나간 사람이면 그 행을 되살린다(business_id·user_id UNIQUE)
    //   ★ unscoped — 모델 defaultScope 가 removed_at NULL 만 보여 줘서 나간 사람의 행을 못 찾고 INSERT 가 UNIQUE 에 걸렸다(실측 409 ERR_DUPLICATE)
    const old = await BusinessMember.unscoped().findOne({ where: { business_id: businessId, user_id: row.user_id }, transaction: t, lock: t.LOCK.UPDATE });
    if (old) {
      await old.update({ removed_at: null, removed_reason: null, role: accessRole.role, joined_at: now, invited_by: approver.id, invited_at: now }, { transaction: t });
      memberRow = old;
    } else {
      memberRow = await BusinessMember.create({
        business_id: businessId, user_id: row.user_id, role: accessRole.role, joined_at: now, invited_by: approver.id, invited_at: now,
      }, { transaction: t });
    }
    conv = await require('./clientToMember').promoteClientToMember({ businessId, userId: row.user_id, transaction: t });
    await row.update({ status: 'approved', decided_at: now, decided_by: approver.id, decision_note: null, retry_after: null }, { transaction: t });
    // 신청자에게 지금 워크스페이스가 없으면 이곳으로(있으면 건드리지 않는다)
    await User.update({ active_business_id: businessId }, { where: { id: row.user_id, active_business_id: null }, transaction: t });
    await t.commit();
  } catch (e) {
    if (!t.finished) await t.rollback().catch(() => {});
    throw e;
  }
  require('./clientToMember').afterPromote(conv, { businessId, userId: row.user_id, actorUserId: approver.id, io });
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'brand_name', 'name'] });
  const wsName = biz?.brand_name || biz?.name || '';
  const { notify } = require('../routes/notifications');
  notify({
    userId: row.user_id, businessId, eventKind: 'invite',
    title: `${wsName} 참여가 승인됐어요`, body: '', link: '/dashboard', ctaLabel: '들어가기', workspaceName: wsName,
    actorUserId: approver.id, entityType: 'workspace_join_request', entityId: row.id, ioApp: io,
  }).catch((e) => console.warn('[join notify approve]', e.message));
  emitSignal(io, `user:${row.user_id}`, 'join_request:decided', { id: row.id, business_id: businessId, status: 'approved' });
  emitSignal(io, `business:${businessId}`, 'join_request:updated', { id: row.id, business_id: businessId });
  emitSignal(io, `business:${businessId}`, 'member:updated', { id: memberRow.id });
  try {
    require('./auditService').logAudit(actorReq, {
      action: 'workspace.join_approve', targetType: 'business_member', targetId: memberRow.id, businessId,
      newValue: { user_id: row.user_id, role: accessRole.role, request_id: row.id },
    });
  } catch { /* noop */ }
  return { row, member: memberRow };
}

async function reject({ businessId, requestId, note, approver, io, actorReq }) {
  const row = await WorkspaceJoinRequest.findOne({ where: { id: requestId, business_id: businessId } });
  if (!row || !isLive(row)) throw new JoinError('join_request_not_found', 404);
  const now = new Date();
  const n = note ? String(note).trim().slice(0, 300) || null : null;
  await row.update({ status: 'rejected', decided_at: now, decided_by: approver.id, decision_note: n, retry_after: new Date(now.getTime() + COOLDOWN_MS) });
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'brand_name', 'name'] });
  const wsName = biz?.brand_name || biz?.name || '';
  const { notify } = require('../routes/notifications');
  // 아직 그 워크스페이스 사람이 아니다 — 범위 없는 알림(inviteNotify 와 같은 규칙)
  notify({
    userId: row.user_id, businessId: null, eventKind: 'invite',
    title: `${wsName} 참여가 승인되지 않았어요`, body: n || '', link: '/welcome', ctaLabel: '시작하기',
    actorUserId: approver.id, entityType: 'workspace_join_request', entityId: row.id, ioApp: io,
  }).catch((e) => console.warn('[join notify reject]', e.message));
  emitSignal(io, `user:${row.user_id}`, 'join_request:decided', { id: row.id, business_id: businessId, status: 'rejected' });
  emitSignal(io, `business:${businessId}`, 'join_request:updated', { id: row.id, business_id: businessId });
  try {
    require('./auditService').logAudit(actorReq, {
      action: 'workspace.join_reject', targetType: 'workspace_join_request', targetId: row.id, businessId,
      newValue: { user_id: row.user_id },
    });
  } catch { /* noop */ }
  return row;
}

module.exports = {
  JoinError, isLive, requestView, createOrReapply, cancel, approve, reject, workspaceManagerIds,
  PENDING_MS, COOLDOWN_MS, SHOW_DECIDED_MS, SHOW_EXPIRED_MS,
};
