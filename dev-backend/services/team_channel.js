// platformroom-exempt: 워크스페이스 «전체» 방 하나(businesses.team_conversation_id)만 만들고 찾는다 — PlanQ 안내방과 무관
// 워크스페이스 «전체» 대화방 — 멤버 전원이 들어가는 방 1개 + 공지 (2026-11-16 · Fable 설계 B).
//
// 왜 대화방인가 — 읽음(last_read_at)·핀·소켓·알림·방 알림 끄기·감사·마스킹 삭제가 채팅에 이미 있다.
//   공지를 따로 만들면 «소통 표면» 이 둘이 되고, 플랫폼 공지(notifications.js business_id NULL)와 이름도 겹친다.
//   공지 = 이 방의 text 메시지 + `meta.announcement = { title }` + 올릴 때 자동 핀. 핀 해제 = 게시 종료(목록엔 남는다).
//
// 계약
//   - 방은 워크스페이스당 하나 — `businesses.team_conversation_id` 가 가리킨다. channel_type internal · 프로젝트/고객 없음
//     = 사적 방(access_scope.isPrivateConversation) → 참여자만 본다. Cue 끔.
//   - 참여자 = 활성 멤버(owner·admin·member) 전원. 고객·게스트·AI 는 넣지 않는다.
//     맞추는 문은 `syncTeamMembers` 하나(멱등 — 빠진 사람 넣고, 멤버 아닌 사람 뺀다). 부르는 곳:
//       방을 열 때(GET) · 공지 올릴 때 · 멤버 가입(clientToMember.afterPromote) · 내보내기(businesses.js).
//     계정 탈퇴·복구 같은 다른 길은 다음 열기/공지 때 맞춰진다(이 방은 참여자 술어라 그 전에도 워크스페이스 접근이 먼저 막는다).
//   - 이 방에서는 나가기·내보내기·참여자 추가·보관·삭제를 막는다(isTeamConversation) — 열어 두면 동기화가 깨진다. 알림 끄기는 된다.
//   - 공지 알림은 방 알림을 꺼도 간다(ignoreMute). 즉시 메일은 없고, 안 읽으면 채팅과 같은 5분 묶음 메일(unreadEscalationCron).
const { Op } = require('sequelize');

const TEAM_ROLES = ['owner', 'admin', 'member'];

function models() { return require('../models'); }

/** 이 방이 그 워크스페이스의 «전체» 방인가. conv 는 business_id·id 가 있어야 한다. */
async function isTeamConversation(conv) {
  if (!conv || !conv.business_id) return false;
  const biz = await models().Business.findByPk(conv.business_id, { attributes: ['id', 'team_conversation_id'] });
  return !!biz && Number(biz.team_conversation_id) === Number(conv.id);
}

/** 활성 멤버(사람) user_id 목록 — 고객·AI·초대 대기(user_id NULL)·내보낸 사람 제외. */
async function activeMemberIds(businessId, { transaction } = {}) {
  const rows = await models().BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, user_id: { [Op.ne]: null }, role: TEAM_ROLES },
    attributes: ['user_id'], raw: true, transaction,
  });
  return [...new Set(rows.map((r) => Number(r.user_id)))];
}

/**
 * «전체» 방을 보장한다 — 있으면 그 방, 없으면 만든다(멱등 · 워크스페이스 행 잠금으로 동시 호출에도 방 1개).
 * 만들 때는 조용히(시스템 메시지·알림 없음) 활성 멤버를 들인다.
 * @returns {Promise<{ conversation: object, created: boolean }|null>} 워크스페이스가 없으면 null
 */
async function ensureTeamChannel(businessId) {
  const { Business, Conversation } = models();
  const { sequelize } = require('../config/database');
  const t = await sequelize.transaction();
  let conv = null;
  let created = false;
  try {
    const biz = await Business.findByPk(businessId, {
      attributes: ['id', 'team_conversation_id', 'deleted_at'], transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!biz || biz.deleted_at) { await t.rollback(); return null; }
    if (biz.team_conversation_id) {
      conv = await Conversation.findOne({ where: { id: biz.team_conversation_id, business_id: businessId }, transaction: t });
    }
    if (!conv) {
      conv = await Conversation.create({
        business_id: businessId,
        title: '전체',            // 표시는 화면이 is_team 을 보고 번역한다(ko «전체» / en «Everyone»)
        channel_type: 'internal',
        cue_enabled: false,
        auto_extract_enabled: false,
      }, { transaction: t });
      await biz.update({ team_conversation_id: conv.id }, { transaction: t });
      created = true;
    }
    await t.commit();
  } catch (e) {
    if (!t.finished) await t.rollback().catch(() => {});
    throw e;
  }
  if (created) {
    try {
      require('./auditService').createAuditLog({
        user_id: null, business_id: businessId,
        action: 'create', entity_type: 'conversation', entity_id: conv.id,
        new_value: { channel_type: 'internal', reason: 'team_channel' },
      });
    } catch { /* 감사 실패가 방 생성을 막지 않는다 */ }
  }
  await syncTeamMembers(businessId, { conv });
  return { conversation: conv, created };
}

/**
 * 참여자를 활성 멤버와 맞춘다(멱등). 방이 아직 없으면 아무것도 안 한다(만들지 않는다 — 만드는 문은 ensure 하나).
 * @returns {Promise<{ added: number[], removed: number[] }>}
 */
async function syncTeamMembers(businessId, { conv, io } = {}) {
  const out = { added: [], removed: [] };
  const { Business, Conversation } = models();
  let room = conv;
  if (!room) {
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'team_conversation_id'] });
    if (!biz || !biz.team_conversation_id) return out;
    room = await Conversation.findOne({ where: { id: biz.team_conversation_id, business_id: businessId }, attributes: ['id', 'business_id'] });
    if (!room) return out;
  }
  const want = new Set(await activeMemberIds(businessId));
  const cp = require('./convParticipants');
  const rows = await cp.participantRows(room.id, ['user_id', 'is_viewer'], { includeViewers: true });
  const have = new Map(rows.map((r) => [Number(r.user_id), r]));
  for (const uid of want) {
    const r = have.get(uid);
    if (r && !r.is_viewer) continue;
    await cp.joinParticipant(room.id, uid, 'member');
    out.added.push(uid);
  }
  for (const [uid] of have) {
    if (want.has(uid)) continue;
    await cp.removeRows({ conversation_id: room.id, user_id: uid });
    out.removed.push(uid);
    if (io) io.in(`user:${uid}`).socketsLeave([`conv:${room.id}`, `conv:${room.id}:staff`]);
  }
  if (io && (out.added.length || out.removed.length)) {
    const ids = [...out.added, ...out.removed];
    let em = io.to(`conv:${room.id}`);
    for (const uid of ids) em = em.to(`user:${uid}`);
    em.emit('conversation:participants', { conversation_id: room.id });
  }
  return out;
}

/** 실패해도 본 일(가입·내보내기)을 막지 않는 훅용. */
function syncTeamMembersQuiet(businessId, opts = {}) {
  return syncTeamMembers(businessId, opts).catch((e) => console.warn('[team_channel] sync', e.message));
}

/** 공지 제목·본문 정리 — 제목 ≤100자, 본문 ≤5000자, 텍스트만. */
function cleanAnnouncement(body = {}) {
  const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const content = String(body.body ?? body.content ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  return { title, content };
}

function isAnnouncement(msg) {
  const m = msg && msg.meta;
  return !!(m && typeof m === 'object' && m.announcement && typeof m.announcement === 'object');
}

module.exports = {
  TEAM_ROLES, isTeamConversation, activeMemberIds, ensureTeamChannel, syncTeamMembers, syncTeamMembersQuiet,
  cleanAnnouncement, isAnnouncement,
};
