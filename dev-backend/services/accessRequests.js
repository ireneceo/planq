// 열람 요청 — 만들기·결정·회수 (2026-11-25 · 설계 docs/FILE_SEARCH_DISCOVERY_DESIGN.md §3)
//
// ★ 요청은 잠금 술어(services/lockedDiscovery.lockedRow)를 통과한 항목에만 — 없는 id · L1 · 숨김 · 남의 워크스페이스 ·
//   설정 꺼짐 · 이미 볼 수 있음은 **모두 같은 404**(호출부가 not_found 하나로 답한다 · id 훑기 방지).
// ★ 승인 = access_requests 행 status 'approved'(그 사람·그 항목 하나 · services/accessGrants). 항목 공개 범위는 안 바꾼다.
// ★ 알림은 앱 + 푸시, 메일 없음. 항목 이름을 알림에 싣지 않는다(볼 때 보는 사람 권한으로).
// ★ 남용 방지: 항목×요청자 대기 1건(있으면 그것을 돌려줌) · 거절 뒤 7일 재요청 불가 · 1인 하루 10건 · 대기 14일 뒤 만료.
const { Op } = require('sequelize');
const { AccessRequest, BusinessMember, Business, File, Post } = require('../models');
const { getUserScope, isWorkspaceAdmin } = require('../middleware/access_scope');

const DAY = 24 * 3600 * 1000;
const PENDING_TTL_DAYS = 14;
const DENY_COOLDOWN_DAYS = 7;
const DAILY_LIMIT = 10;

async function expireStale(businessId) {
  await AccessRequest.update({ status: 'expired' }, {
    where: { business_id: businessId, status: 'pending', created_at: { [Op.lt]: new Date(Date.now() - PENDING_TTL_DAYS * DAY) } },
  });
}

async function overDailyLimit(businessId, userId) {
  const n = await AccessRequest.count({ where: { business_id: businessId, requester_id: userId, created_at: { [Op.gt]: new Date(Date.now() - DAY) } } });
  return n >= DAILY_LIMIT;
}

function ownerIdOf(type, row) { return Number(type === 'file' ? row.uploader_id : row.author_id) || null; }

/** 받을 사람 — 올린 사람·작성자가 지금 직원(대표·관리자·멤버)이면 그 사람, 아니면 null(대표·관리자 전원). */
async function approverFor(businessId, type, row) {
  const uid = ownerIdOf(type, row);
  if (!uid) return null;
  const bm = await BusinessMember.findOne({ where: { business_id: businessId, user_id: uid, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } }, attributes: ['user_id'] });
  return bm ? uid : null;
}

/** 알림을 받을 사람들 — approver_id 가 있으면 그 사람, 없으면 대표·관리자 전원. */
async function recipientsOf(businessId, approverId) {
  if (approverId) return [Number(approverId)];
  const ids = new Set();
  for (const a of await BusinessMember.findAll({ where: { business_id: businessId, role: { [Op.in]: ['owner', 'admin'] }, removed_at: null }, attributes: ['user_id'] })) if (a.user_id) ids.add(Number(a.user_id));
  const biz = await Business.findByPk(businessId, { attributes: ['owner_id'] });
  if (biz?.owner_id) ids.add(Number(biz.owner_id));
  return [...ids];
}

/** 이 사람이 이 요청을 결정(승인·거절·회수)할 수 있는가 — 받은 사람 · 올린 사람/작성자 · 대표·관리자. 요청자 본인은 안 된다. */
async function canDecide(user, reqRow) {
  if (!reqRow || Number(reqRow.requester_id) === Number(user.id)) return false;
  const scope = await getUserScope(user.id, reqRow.business_id, user.platform_role);
  if (scope.isClient && !scope.isMember && !scope.isOwner && !scope.isAdmin) return false;
  if (isWorkspaceAdmin(scope)) return true;
  if (reqRow.approver_id && Number(reqRow.approver_id) === Number(user.id)) return true;
  const row = await loadEntity(reqRow.business_id, reqRow.entity_type, reqRow.entity_id);
  return !!row && ownerIdOf(reqRow.entity_type, row) === Number(user.id);
}

async function loadEntity(businessId, type, id) {
  if (type === 'file') return File.findOne({ where: { id, business_id: businessId, deleted_at: null } });
  if (type === 'post') return Post.findOne({ where: { id, business_id: businessId } });
  return null;
}

/** 만들기. row 는 lockedRow 를 통과한 것. 돌려줌: { request, already } 또는 { error: 'recently_denied'|'daily_limit' } */
async function createRequest({ businessId, user, type, row, message }) {
  await expireStale(businessId);
  const existing = await AccessRequest.findOne({ where: { business_id: businessId, requester_id: user.id, entity_type: type, entity_id: row.id, status: 'pending' } });
  if (existing) return { request: existing, already: true };
  const recentDeny = await AccessRequest.findOne({ where: { business_id: businessId, requester_id: user.id, entity_type: type, entity_id: row.id, status: 'denied', decided_at: { [Op.gt]: new Date(Date.now() - DENY_COOLDOWN_DAYS * DAY) } } });
  if (recentDeny) return { error: 'recently_denied' };
  if (await overDailyLimit(businessId, user.id)) return { error: 'daily_limit' };
  const approverId = await approverFor(businessId, type, row);
  const request = await AccessRequest.create({
    business_id: businessId, entity_type: type, entity_id: row.id, requester_id: user.id, approver_id: approverId,
    status: 'pending', message: message ? String(message).slice(0, 300) : null,
  });
  return { request, already: false };
}

async function notifySafe(args) {
  try { await require('../routes/notifications').notify(args); } catch (e) { console.warn('[accessRequests] 알림 실패', e.message); }
}

/** 새 요청 → 받을 사람에게(이름은 요청자만 · 항목 이름 없음). */
async function notifyNew(io, businessId, reqRow, requesterName) {
  for (const uid of await recipientsOf(businessId, reqRow.approver_id)) {
    if (uid === Number(reqRow.requester_id)) continue;
    await notifySafe({
      userId: uid, businessId, eventKind: 'system', actorUserId: reqRow.requester_id,
      title: (lang) => (lang === 'en' ? `${requesterName || 'A member'} asked to view a restricted item` : `${requesterName || '멤버'} 님이 열람을 요청했어요`),
      body: (lang) => (lang === 'en' ? 'Open «Access requests» to approve or decline.' : '«열람 요청» 에서 승인하거나 거절할 수 있어요.'),
      link: '/access-requests', entityType: 'access_request', entityId: reqRow.id, skipChannels: ['email'],
    });
  }
  emitSignal(io, businessId, await recipientsOf(businessId, reqRow.approver_id));
}

/** 결정 결과 → 요청자에게. 승인이면 항목으로 가는 링크(그때는 볼 수 있다). */
async function notifyDecision(io, businessId, reqRow) {
  const approved = reqRow.status === 'approved';
  const link = approved ? (reqRow.entity_type === 'file' ? `/files?file=${reqRow.entity_id}` : `/docs?post=${reqRow.entity_id}`) : null;
  await notifySafe({
    userId: reqRow.requester_id, businessId, eventKind: 'system', actorUserId: reqRow.decided_by,
    title: (lang) => (approved
      ? (lang === 'en' ? 'Your access request was approved' : '열람 요청이 승인됐어요')
      : (lang === 'en' ? 'Your access request was declined' : '열람 요청이 거절됐어요')),
    body: (lang) => (approved
      ? (lang === 'en' ? 'You can open it now.' : '이제 열어 볼 수 있어요.')
      : (reqRow.decision_note ? reqRow.decision_note : (lang === 'en' ? 'Ask the owner if you still need it.' : '꼭 필요하면 올린 사람에게 직접 물어보세요.'))),
    link, entityType: 'access_request', entityId: reqRow.id, skipChannels: ['email'],
  });
  emitSignal(io, businessId, [Number(reqRow.requester_id)]);
}

/** 실시간 — 신호만(행 내용 없음). 받은 화면은 다시 읽는다. */
function emitSignal(io, businessId, userIds) {
  try {
    if (!io) return;
    for (const uid of userIds) io.to(`user:${uid}`).emit('access_request:changed', { business_id: Number(businessId) });
  } catch { /* 신호는 덤 — 화면은 복귀 때 다시 읽는다 */ }
}

/** 사람 이름 — 워크스페이스 표시명이 이긴다(계정 이름은 표시명이 없을 때만 · services/displayName 한 벌). id → { id, name, name_localized? } */
async function peopleOf(businessId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const { User } = require('../models');
  const rows = (await User.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true })).map((u) => ({ person: { id: u.id, name: u.name } }));
  await require('./displayName').applyMemberDisplayName(rows, businessId, ['person']);
  return new Map(rows.map((r) => [Number(r.person.id), r.person]));
}

module.exports = {
  peopleOf, overDailyLimit,
  expireStale, approverFor, recipientsOf, canDecide, loadEntity, createRequest, notifyNew, notifyDecision, emitSignal,
  PENDING_TTL_DAYS, DENY_COOLDOWN_DAYS, DAILY_LIMIT,
};
