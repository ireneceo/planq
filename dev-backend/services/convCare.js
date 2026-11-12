// Q talk 고객 문의 «응대 상태 · 담당자» — 단일 원천 (2026-11-12 · Fable 설계 docs/QTALK_CARE_DESIGN.md DESIGN: READY).
//
// ★ ConversationCare 모델은 **이 파일 밖에서 쓰지 않는다.** 읽기(careFor)·쓰기(setCare/onCustomerMessage)·정리(clearAssignee)가 여기 한 곳.
// ★ 고객·게스트에게는 상태·담당이 **전혀 안 나간다** — 응답은 직원 판정 뒤에만 붙이고(routes), 실시간은 emitConvWide(직원 청중)만.
// ★ 상태와 담당은 서로 안 건드린다. 상태 `open`/`hold`/`resolved` 는 보관(active/archived)과 다른 축.
// ★ 고객 쪽 글만 상태를 바꾼다(해결·보류 → open). 직원 글·Cue·내부 메모는 안 바꾼다.
'use strict';

const { Op, QueryTypes } = require('sequelize');

const STATES = ['open', 'hold', 'resolved'];
const CLOSED_TASK = ['completed', 'canceled'];

function model() { return require('../models/ConversationCare'); }
function seq() { return require('../config/database').sequelize; }

/** 응대 상태를 다루는 방인가 — 고객 방만(내부·그룹·안내방 제외). */
function isCareRoom(conv) {
  return !!conv && conv.channel_type === 'customer';
}

/** 이 사람이 이 방에서 «고객 쪽» 인가 — 그 워크스페이스 고객(멤버 아님) 또는 게스트 그림자 계정. */
async function isCustomerSender(conv, userId) {
  if (!conv || !userId) return false;
  const { User } = require('../models');
  const u = await User.findByPk(userId, { attributes: ['id', 'is_guest'] });
  if (u && u.is_guest) return true;
  const { getUserScope } = require('../middleware/access_scope');
  const scope = await getUserScope(userId, conv.business_id).catch(() => null);
  return !!(scope && scope.isClient);
}

/** 배정할 수 있는 사람인가 — 그 워크스페이스 활성 사람 멤버(AI·고객·게스트 불가). */
async function isAssignableMember(businessId, userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return false;
  const { BusinessMember, User, Business } = require('../models');
  const u = await User.findByPk(uid, { attributes: ['id', 'is_ai', 'is_guest'] });
  if (!u || u.is_ai || u.is_guest) return false;
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: uid, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['id'],
  });
  if (bm) return true;
  // 운영 #14/#36 — BM 행 없이 owner_id 로만 대표인 워크스페이스(access_scope.getUserScope 와 같은 fallback)
  const biz = await Business.findOne({ where: { id: businessId, owner_id: uid, deleted_at: null }, attributes: ['id'] });
  return !!biz;
}

/** 그 방의 참여자인가(보는 중 행은 아니다 — defaultScope). */
async function isParticipant(convId, userId) {
  const { ConversationParticipant } = require('../models');
  const row = await ConversationParticipant.findOne({ where: { conversation_id: convId, user_id: userId }, attributes: ['id'] });
  return !!row;
}

/**
 * 기본 담당 — 행이 처음 생길 때 한 번. Client.assigned_member_id 가 활성 멤버 ∧ 이미 그 방 참여자면 그 사람, 아니면 null.
 * 기본값으로는 참여자를 늘리지 않는다. (migrate-conversation-care.js 백필과 같은 술어)
 */
async function defaultAssignee(conv) {
  if (!conv || !conv.client_id) return null;
  const { Client } = require('../models');
  const cl = await Client.findOne({ where: { id: conv.client_id, business_id: conv.business_id }, attributes: ['assigned_member_id'] });
  const uid = cl && cl.assigned_member_id;
  if (!uid) return null;
  if (!(await isAssignableMember(conv.business_id, uid))) return null;
  if (!(await isParticipant(conv.id, uid))) return null;
  return Number(uid);
}

/** 사람 이름 — 워크스페이스 표시명 우선(services/displayName), 없으면 계정 이름. */
async function nameMap(businessId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!ids.length) return new Map();
  const { getMemberNameMap } = require('./displayName');
  const { User } = require('../models');
  const bmMap = await getMemberNameMap(businessId, ids);
  const users = await User.findAll({ where: { id: ids }, attributes: ['id', 'name', 'name_localized'], raw: true });
  const out = new Map();
  for (const u of users) {
    const bm = bmMap.get(u.id);
    out.set(u.id, {
      id: u.id,
      name: (bm && bm.name) || u.name || null,
      name_localized: (bm && bm.name_localized) || null,
    });
  }
  return out;
}

function serialize(row, names) {
  if (!row) return null;
  const aid = row.assignee_user_id ? Number(row.assignee_user_id) : null;
  return {
    state: row.state,
    state_changed_at: row.state_changed_at,
    assignee_user_id: aid,
    assignee: aid ? (names.get(aid) || { id: aid, name: null, name_localized: null }) : null,
  };
}

/** 여러 방의 응대 상태 — Map(conversation_id → care). 행 없는 방은 Map 에 없다. */
async function careFor(convIds, businessId) {
  const ids = (convIds || []).map(Number).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await model().findAll({ where: { conversation_id: ids, business_id: businessId }, raw: true });
  const names = await nameMap(businessId, rows.map((r) => r.assignee_user_id));
  return new Map(rows.map((r) => [Number(r.conversation_id), serialize(r, names)]));
}

async function careOne(conv) {
  const m = await careFor([conv.id], conv.business_id);
  return m.get(Number(conv.id)) || null;
}

/** 내가 답할 문의 id — open ∧ (담당 = 나 [∨ 미배정]). convIds 는 이미 내가 볼 수 있는 방으로 좁혀서 넘긴다. */
async function myOpenInquiryIds(convIds, userId, { includeUnassigned = false } = {}) {
  const ids = (convIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const who = includeUnassigned
    ? { [Op.or]: [{ assignee_user_id: Number(userId) }, { assignee_user_id: null }] }
    : { assignee_user_id: Number(userId) };
  const rows = await model().findAll({
    where: { conversation_id: ids, state: 'open', ...who },
    attributes: ['conversation_id', 'state_changed_at'], raw: true,
  });
  return rows.map((r) => ({ conversation_id: Number(r.conversation_id), state_changed_at: r.state_changed_at }));
}

/** 실시간 — 직원 청중만(services/convBroadcast.emitConvWide). `conv:`·`business:` 방으로 보내지 않는다. */
async function emitCare(io, conv, care) {
  if (!io || !conv) return;
  const payload = { conversation_id: Number(conv.id), care: care === undefined ? await careOne(conv) : care };
  await require('./convBroadcast').emitConvWide(io, conv, 'conversation:care', payload);
}

function emitParticipants(io, convId, userId) {
  if (!io) return;
  // routes/conversations.js emitParticipantsChanged 와 같은 방(신호만)
  io.to(`conv:${convId}`).to(`conv:${convId}:staff`).to(`user:${userId}`)
    .emit('conversation:participants', { conversation_id: Number(convId) });
}

/**
 * 고객 쪽 글 저장 **뒤** — best-effort(실패가 메시지 전송을 막지 않는다).
 *   행 없음 → open + 기본 담당 / hold·resolved → open(by NULL) / open → 아무것도.
 *   원자적(INSERT IGNORE · 조건부 UPDATE) — 바뀌었을 때만 방송.
 * @param {object} conv Conversation 인스턴스
 * @param {{ io?, isClient?: boolean, senderId?: number }} opts  isClient 가 true 가 아니면 senderId 로 판정한다
 * @returns {Promise<boolean>} 바뀌었는가
 */
async function onCustomerMessage(conv, { io, isClient, senderId } = {}) {
  try {
    if (!isCareRoom(conv)) return false;
    if (isClient !== true) {
      if (!senderId || !(await isCustomerSender(conv, senderId))) return false;
    }
    const sq = seq();
    let changed = false;
    const existing = await model().findByPk(conv.id, { attributes: ['conversation_id'], raw: true });
    if (!existing) {
      const assignee = await defaultAssignee(conv);
      const [, n] = await sq.query(
        `INSERT IGNORE INTO conversation_care
           (conversation_id, business_id, state, state_changed_at, state_changed_by, assignee_user_id, assigned_at, assigned_by, created_at, updated_at)
         VALUES (:cid, :biz, 'open', NOW(), NULL, :aid, CASE WHEN :aid IS NULL THEN NULL ELSE NOW() END, NULL, NOW(), NOW())`,
        { replacements: { cid: conv.id, biz: conv.business_id, aid: assignee }, type: QueryTypes.INSERT },
      );
      changed = Number(n) > 0;
    }
    if (!changed) {
      const [, meta] = await sq.query(
        `UPDATE conversation_care SET state = 'open', state_changed_at = NOW(), state_changed_by = NULL, updated_at = NOW()
          WHERE conversation_id = :cid AND state <> 'open'`,
        { replacements: { cid: conv.id } },
      );
      changed = Number(meta?.affectedRows ?? meta ?? 0) > 0;
    }
    if (changed) await emitCare(io, conv);
    return changed;
  } catch (e) {
    console.warn('[convCare.onCustomerMessage]', e.message);
    return false;
  }
}

/** 이 대화에서 나온 진행 중 업무 수 — 보는 사람이 볼 수 있는 업무만(access_scope.taskListWhere). */
async function openTaskCount(conv, userId, scope) {
  const { Task } = require('../models');
  const { taskListWhere } = require('../middleware/access_scope');
  const where = await taskListWhere(userId, conv.business_id, scope);
  if (!where) return 0;
  return Task.count({
    where: { [Op.and]: [where, { conversation_id: conv.id, status: { [Op.notIn]: CLOSED_TASK } }] },
  });
}

class CareError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

/**
 * 직원이 상태·담당을 바꾼다. 검증 → 쓰기 → 감사 → 방송 → 알림. 접근 판정은 호출부(routes/conversation_care.js)가 먼저.
 * @param {object} conv
 * @param {{ req, userId }} actor
 * @param {{ state?: string, assignee_user_id?: number|null }} patch  하나 이상
 * @returns {Promise<object>} 새 care
 */
async function setCare(conv, actor, patch) {
  const hasState = Object.prototype.hasOwnProperty.call(patch || {}, 'state');
  const hasAssignee = Object.prototype.hasOwnProperty.call(patch || {}, 'assignee_user_id');
  if (!hasState && !hasAssignee) throw new CareError('nothing_to_change', 400);
  if (hasState && !STATES.includes(patch.state)) throw new CareError('invalid_state', 400);
  let assignee = null;
  if (hasAssignee && patch.assignee_user_id !== null) {
    assignee = Number(patch.assignee_user_id);
    if (!(await isAssignableMember(conv.business_id, assignee))) throw new CareError('invalid_assignee', 400);
  }
  const actorId = Number(actor.userId);
  const req = actor.req || null;
  const io = req && req.app && req.app.get('io');
  const M = model();
  const now = new Date();

  let row = await M.findByPk(conv.id);
  const before = row ? { state: row.state, assignee_user_id: row.assignee_user_id } : null;
  if (!row) {
    try {
      row = await M.create({
        conversation_id: conv.id, business_id: conv.business_id,
        state: hasState ? patch.state : 'open', state_changed_at: now, state_changed_by: actorId,
        assignee_user_id: hasAssignee ? assignee : null,
        assigned_at: hasAssignee && assignee ? now : null,
        assigned_by: hasAssignee ? actorId : null,
      });
    } catch (e) {
      if (e.name !== 'SequelizeUniqueConstraintError') throw e;
      row = await M.findByPk(conv.id);   // 동시에 고객 글이 행을 만들었다 — 그 위에 덮는다
    }
  }
  const upd = {};
  if (hasState && row.state !== patch.state) Object.assign(upd, { state: patch.state, state_changed_at: now, state_changed_by: actorId });
  const prevAssignee = row.assignee_user_id ? Number(row.assignee_user_id) : null;
  const assigneeChanged = hasAssignee && prevAssignee !== assignee;
  if (assigneeChanged) Object.assign(upd, { assignee_user_id: assignee, assigned_at: assignee ? now : null, assigned_by: actorId });
  if (Object.keys(upd).length) await row.update(upd);
  const stateChanged = hasState && (!before || before.state !== patch.state);
  const assignChanged = hasAssignee && (before ? Number(before.assignee_user_id || 0) !== Number(assignee || 0) : !!assignee);

  const { logAudit } = require('./auditService');
  if (stateChanged) {
    logAudit(req, {
      action: 'conversation.care_state', targetType: 'conversation', targetId: conv.id, businessId: conv.business_id,
      oldValue: { state: before ? before.state : null }, newValue: { state: patch.state },
    });
  }
  if (assignChanged) {
    logAudit(req, {
      action: 'conversation.care_assign', targetType: 'conversation', targetId: conv.id, businessId: conv.business_id,
      oldValue: { assignee_user_id: before ? before.assignee_user_id : null }, newValue: { assignee_user_id: assignee },
    });
  }

  // 담당 = 참여자 — 아니면 알림을 못 받고 멤버는 방을 못 본다. 참여자 추가 판정은 POST …/participants 와 같다
  //   (대상이 그 워크스페이스 활성 멤버 — isAssignableMember 가 이미 봤다).
  if (assignChanged && assignee) {
    const { joinParticipant } = require('./convParticipants');
    const r = await joinParticipant(conv.id, assignee, 'member');
    if (r.created || r.promoted) {
      logAudit(req, {
        action: 'conversation.participant_add', targetType: 'conversation', targetId: conv.id, businessId: conv.business_id,
        newValue: { user_id: assignee, role: 'member', via: 'care_assign' },
      });
      emitParticipants(io, conv.id, assignee);
    }
  }

  const care = await careOne(conv);
  if (stateChanged || assignChanged) await emitCare(io, conv, care).catch((e) => console.warn('[convCare emit]', e.message));

  // 알림 — 남에게 배정할 때만 앱 안·푸시 1통(메일 없음). 고객에게 나가는 것 0.
  if (assignChanged && assignee && assignee !== actorId) {
    try {
      const { notifyMany } = require('../routes/notifications');
      const { getMemberDisplayName } = require('./displayName');
      const { User, Business } = require('../models');
      const me = await User.findByPk(actorId, { attributes: ['name'] });
      const disp = await getMemberDisplayName(conv.business_id, actorId, me?.name);
      const biz = await Business.findByPk(conv.business_id, { attributes: ['name', 'brand_name'] });
      const roomName = conv.title || conv.display_name || '';
      await notifyMany({
        userIds: [assignee], businessId: conv.business_id, eventKind: 'mention',
        titleSpec: { feature: 'chat', action: 'chat_assigned', subject: [disp.name || '', roomName].filter(Boolean).join(' · ') },
        body: '',
        link: `/talk?conv=${conv.id}`,
        workspaceName: biz?.brand_name || biz?.name || null,
        tag: `conv:${conv.id}`,
        entityType: 'conversation', entityId: conv.id,
        actorUserId: actorId, ioApp: req ? req.app : undefined,
        skipChannels: ['email'],
      });
    } catch (e) { console.warn('[convCare notify]', e.message); }
  }
  return care;
}

/**
 * 한 사람이 담당인 행을 비우거나(to 없음) 넘긴다(to = 인수자, 참여자로 들인다).
 *   멤버 제거 · 인수인계 · 참여자 내보내기(conversationId 로 한 방만) 세 곳이 부른다. best-effort.
 * @returns {Promise<number>} 바뀐 행 수
 */
async function clearAssignee(businessId, userId, { to = null, io = null, conversationId = null, actorUserId = null, req = null } = {}) {
  try {
    const where = { business_id: businessId, assignee_user_id: Number(userId) };
    if (conversationId) where.conversation_id = Number(conversationId);
    const rows = await model().findAll({ where, attributes: ['conversation_id'], raw: true });
    if (!rows.length) return 0;
    const ids = rows.map((r) => Number(r.conversation_id));
    const toId = to ? Number(to) : null;
    await model().update(
      { assignee_user_id: toId, assigned_at: toId ? new Date() : null, assigned_by: actorUserId || null },
      { where: { ...where, conversation_id: ids } },
    );
    const { Conversation } = require('../models');
    const convs = await Conversation.findAll({ where: { id: ids } });
    const { logAudit } = require('./auditService');
    for (const conv of convs) {
      logAudit(req, {
        userId: actorUserId || null, action: 'conversation.care_assign', targetType: 'conversation', targetId: conv.id, businessId,
        oldValue: { assignee_user_id: Number(userId) }, newValue: { assignee_user_id: toId, via: toId ? 'handover' : 'cleanup' },
      });
      if (toId) {
        const r = await require('./convParticipants').joinParticipant(conv.id, toId, 'member');
        if (r.created || r.promoted) emitParticipants(io, conv.id, toId);
      }
      if (io) await emitCare(io, conv).catch(() => {});
    }
    return ids.length;
  } catch (e) {
    console.warn('[convCare.clearAssignee]', e.message);
    return 0;
  }
}

module.exports = {
  STATES, isCareRoom, isCustomerSender, isAssignableMember, defaultAssignee,
  careFor, careOne, myOpenInquiryIds, onCustomerMessage, setCare, clearAssignee, openTaskCount, emitCare, CareError,
};
