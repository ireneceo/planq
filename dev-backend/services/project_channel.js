// 프로젝트의 **고객 채널** — 있으면 그 방, 없으면 만든다. 단일 착지점.
//
//   docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §9 — 원래 이 본문은 라우트
//   (`POST /api/projects/:id/guest-channel`)에 있었다. 화면이 "채널을 찾아 오는" API 를
//   직접 부르게 두었더니, 프로젝트 헤더의 공유 버튼이 **채팅방 링크 버튼**이 됐다
//   (Irene: "프로젝트 헤더에 고객공유링크 버튼이 누르면 채팅창 링크가 생겨. 이 버튼 왜 있어?").
//   화면은 "링크를 만든다" 만 알면 된다 — 어느 방에 거는지는 서버의 판단이다.
//
// ★ "있으면 그 방" 의 정렬은 목록 라우트와 **같아야** 한다(`id ASC`). 다르면 화면에 보이는
//   첫 고객 채널과 링크가 걸리는 방이 갈린다.
// platformroom-exempt: 이 파일은 project_id 로 묶인 프로젝트 방만 찾는다 — PlanQ 안내방은 프로젝트에 달리지 않는다
const { Op } = require('sequelize');
const { Conversation, ProjectMember, ConversationParticipant, Client, ProjectClient, Business, User } = require('../models');
const { createAuditLog } = require('./auditService');

/**
 * @param {object} project  Project 인스턴스 (business_id·id·name 필요)
 * @param {number} userId   요청자 — 새 방을 만들 때 참가자로 넣는다
 * @param {object} [opts]
 * @param {boolean} [opts.createIfMissing=true] 방이 하나도 없을 때 만들 것인가
 * @returns {Promise<{ conversation: object|null, created: boolean }>}
 */
async function ensureProjectCustomerChannel(project, userId, { createIfMissing = true } = {}) {
  const existing = await Conversation.findOne({
    where: { project_id: project.id, channel_type: 'customer', archived_at: null },
    order: [['id', 'ASC']],
  });
  if (existing) return { conversation: existing, created: false };

  // ★ **보관된 방도 찾는다.** 안 찾으면 "보관했다" 는 판정이 아예 도달하지 못하고
  //   새 방이 생겨 버린다 — 멤버가 닫은 대화가 링크 한 번으로 되살아나고 고객채널이
  //   복제된다(2026-09-05 Fable 실측: 닫힌 프로젝트에 201 + 채널 2개).
  //   찾아서 그대로 돌려주면 호출측의 `assertGuestLinkIssuable` 이 409 로 막는다.
  const archived = await Conversation.findOne({
    where: { project_id: project.id, channel_type: 'customer' },
    order: [['id', 'ASC']],
  });
  if (archived) return { conversation: archived, created: false };
  if (!createIfMissing) return { conversation: null, created: false };

  // 없으면 만든다 — 프로젝트 생성 시의 채널 생성과 **같은 기본값**(cue·자동추출 on).
  const conv = await Conversation.create({
    business_id: project.business_id,
    project_id: project.id,
    title: `${project.name} 고객`,
    channel_type: 'customer',
    cue_enabled: true,
    auto_extract_enabled: true,
  });
  // 참가자 — 만든 사람 + 프로젝트 PM (+ 사람 0명이면 대표). 프로젝트 멤버 전원이 아니다(2026-11-24 Fable 판정 4 —
  //   고객방은 필요해서 만드는 방이라 «갑자기 다른 사람이 들어와 고객이 놀라는» 일이 없게). 새 고객방 문은 둘 다 initialCustomerRoomStaff 한 함수.
  const ids = await initialCustomerRoomStaff(project, userId, null);
  for (const uid of ids) {
    await require('./convParticipants').joinParticipant(conv.id, uid, 'member');
  }
  // Cue — 고객방 기본값(ensureClientChannel 과 같다 · Fable 완료 검증 비차단 1)
  const biz = await Business.findByPk(project.business_id, { attributes: ['cue_user_id'] });
  if (biz?.cue_user_id && !ids.includes(Number(biz.cue_user_id))) {
    await require('./convParticipants').joinParticipant(conv.id, biz.cue_user_id, 'member');
  }
  // ★ createAuditLog 는 내부에서 setImmediate 로 던지고 **아무것도 반환하지 않는다**.
  //   `.catch()` 를 붙이면 undefined 에 접근해 500 이 난다 — 실제로 났다.
  try {
    createAuditLog({
      user_id: userId, business_id: project.business_id,
      action: 'create', entity_type: 'conversation', entity_id: conv.id,
      new_value: { project_id: project.id, channel_type: 'customer', reason: 'guest_link' },
    });
  } catch { /* 감사 실패가 채널 생성을 막지 않는다 */ }

  return { conversation: conv, created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 고객 채널의 축은 **프로젝트 × 고객(client)** 이다 (2026-10-07 Fable B 판정 7 — Irene "fable 판정대로 해").
//
//   한 프로젝트에 고객사가 둘이면 방도 둘이다. 한 방을 같이 쓰면 상대 회사의 요청·청구서·첨부가 보인다
//   (운영 K-DINE: Kate 의 방에 Aidan 이 들어가 있어 청구서 카드가 Aidan 에게도 보였다).
//   같은 회사의 담당자 둘은 **한 client 행에 연락처 둘**이 맞는 구조다 — client 행 둘이 아니다.
//
//   그래서 고객을 방에 들이는 문(초대 수락 · 워크스페이스 초대 수락 · 프로젝트에 고객 추가)과
//   청구서 카드 배달은 전부 아래 두 함수를 쓴다. 다른 고객의 방으로 «대신» 떨어뜨리지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 새 고객방의 처음 직원 참여자 (2026-11-24 Fable 판정 4 — docs/PROJECT_ROOM_MEMBERSHIP_DESIGN.md Q1).
 *   만든 사람(워크스페이스 활성 직원일 때) — 없으면(초대 수락처럼 actor 없음) 그 고객을 프로젝트에 붙인 사람(project_clients.invited_by,
 *   지금도 프로젝트 멤버 ∧ 활성 직원일 때만) + 프로젝트 PM(활성 직원) + 사람이 0명이면 워크스페이스 대표 1명(고객 메시지 알림을 받을 사람).
 *   «다른 고객방 참여자 따라가기» 는 하지 않는다 — A 고객 방에 필요해서 넣은 사람이 B 고객 방에 나타난다.
 * @returns {Promise<number[]>} 사람 user_id (Cue 제외 — 호출부가 넣는다)
 */
async function initialCustomerRoomStaff(project, actorUserId, clientId, { transaction } = {}) {
  const out = new Set();
  const isStaff = async (uid) => !!uid && (await humanMemberIds(project.business_id, [uid], { transaction })).length > 0;
  if (await isStaff(actorUserId)) out.add(Number(actorUserId));
  else if (clientId) {
    const pc = await ProjectClient.findOne({
      where: { project_id: project.id, client_id: clientId, invited_by: { [Op.ne]: null } },
      attributes: ['invited_by'], order: [['id', 'ASC']], transaction,
    });
    const inv = pc ? Number(pc.invited_by) : null;
    if (inv && await isStaff(inv)
      && await ProjectMember.findOne({ where: { project_id: project.id, user_id: inv }, attributes: ['id'], transaction })) out.add(inv);
  }
  const pms = await ProjectMember.findAll({ where: { project_id: project.id, is_pm: true }, attributes: ['user_id'], transaction });
  for (const uid of await humanMemberIds(project.business_id, pms.map((m) => m.user_id), { transaction })) out.add(uid);
  if (!out.size) {
    const biz = await Business.findByPk(project.business_id, { attributes: ['owner_id'], transaction });
    if (biz?.owner_id && await isStaff(biz.owner_id)) out.add(Number(biz.owner_id));
  }
  return [...out];
}

/** 이 프로젝트에서 이 고객의 채널 — 살아 있는 방 우선, 없으면 보관된 방. 없으면 null. */
async function findClientChannel(projectId, clientId, { transaction } = {}) {
  if (!projectId || !clientId) return null;
  const live = await Conversation.findOne({
    where: { project_id: projectId, channel_type: 'customer', client_id: clientId, archived_at: null },
    order: [['id', 'ASC']], transaction,
  });
  if (live) return live;
  return Conversation.findOne({
    where: { project_id: projectId, channel_type: 'customer', client_id: clientId },
    order: [['id', 'ASC']], transaction,
  });
}

/** 이 방에 **다른 고객**(워크스페이스 멤버가 아닌 client 역할)이 들어와 있는가.
 *  ★ 게스트 링크 방문자(그림자 계정 users.is_guest=1)는 세지 않는다 — 그 방에 걸린 외부 열람 링크로 들어온 사람이지
 *    다른 고객사가 아니다. 세면 링크가 걸린 주인 없는 방을 넘겨받지 못하고 새 방을 만들어, 옛 링크가 재사용·교체(회수)
 *    되지 않는다(Fable 2026-10-07 3차 — 운영 프로젝트 3 · 링크 5 · 방 6 이 정확히 이 모양). */
async function hasClientParticipant(convId, { exceptUserIds = [], transaction } = {}) {
  const where = { conversation_id: convId, role: 'client' };
  if (exceptUserIds.length) where.user_id = { [Op.notIn]: exceptUserIds };
  return !!(await ConversationParticipant.findOne({
    where, attributes: ['id'], transaction,
    include: [{ model: User, attributes: [], required: true, where: { is_guest: { [Op.not]: true } } }],
  }));
}

/**
 * 이 프로젝트에 이 고객의 채널을 보장한다 — 멱등.
 *   ①이미 있으면 그 방 ②주인 없는(client_id 비어 있는) 고객 채널에 다른 고객이 아무도 없으면 그 방을 이 고객 것으로
 *   (프로젝트를 만들 때 생긴 방은 처음 들어오는 고객의 것이 된다) ③없으면 새로 만든다.
 * @returns {Promise<{ conversation: object|null, created: boolean, adopted: boolean }>}
 */
async function ensureClientChannel(project, clientId, actorUserId, { transaction, createIfMissing = true } = {}) {
  if (!project || !clientId) return { conversation: null, created: false, adopted: false };
  const client = await Client.findOne({
    where: { id: clientId, business_id: project.business_id },
    attributes: ['id', 'user_id', 'display_name', 'company_name', 'invite_email'], transaction,
  });
  if (!client) return { conversation: null, created: false, adopted: false };   // 남의 워크스페이스 고객 — 아무것도 안 한다

  const found = await findClientChannel(project.id, client.id, { transaction });
  if (found) return { conversation: found, created: false, adopted: false };

  const orphans = await Conversation.findAll({
    where: { project_id: project.id, channel_type: 'customer', client_id: null, archived_at: null },
    order: [['id', 'ASC']], transaction,
  });
  for (const cv of orphans) {
    const others = await hasClientParticipant(cv.id, { exceptUserIds: client.user_id ? [client.user_id] : [], transaction });
    if (others) continue;   // 이미 다른 고객이 있는 방은 가져오지 않는다
    await cv.update({ client_id: client.id }, { transaction });
    return { conversation: cv, created: false, adopted: true };
  }
  if (!createIfMissing) return { conversation: null, created: false, adopted: false };

  const clientName = client.display_name || client.company_name || client.invite_email || '';
  const conv = await Conversation.create({
    business_id: project.business_id,
    project_id: project.id,
    client_id: client.id,
    title: clientName ? `${project.name} · ${clientName}` : `${project.name} 고객`,
    channel_type: 'customer',
    cue_enabled: true,
    auto_extract_enabled: true,
  }, { transaction });
  // 참가자 — 만든 사람(없으면 그 고객을 프로젝트에 붙인 사람) + 프로젝트 PM + Cue. 고객은 호출부가 들인다.
  //   프로젝트 멤버 전원이 아니다(2026-11-24 Fable 판정 4 · Q1).
  const ids = await initialCustomerRoomStaff(project, actorUserId, client.id, { transaction });
  for (const uid of ids) {
    await require('./convParticipants').joinParticipant(conv.id, uid, 'member', { transaction });
  }
  const biz = await Business.findByPk(project.business_id, { attributes: ['cue_user_id'], transaction });
  if (biz?.cue_user_id && !ids.includes(Number(biz.cue_user_id))) {
    await require('./convParticipants').joinParticipant(conv.id, biz.cue_user_id, 'member', { transaction });
  }
  try {
    createAuditLog({
      user_id: actorUserId || null, business_id: project.business_id,
      action: 'create', entity_type: 'conversation', entity_id: conv.id,
      new_value: { project_id: project.id, client_id: client.id, channel_type: 'customer', reason: 'client_channel' },
    });
  } catch { /* 감사 실패가 채널 생성을 막지 않는다 */ }
  return { conversation: conv, created: true, adopted: false };
}

/**
 * 청구서 카드처럼 «그 고객에게» 가는 것을 둘 방 — 없으면 null(다른 고객의 방으로 대신 보내지 않는다).
 *   client_id 가 없는 청구는 프로젝트에 연결 고객이 하나뿐일 때만 그 고객의 방.
 */
async function customerChannelForClient({ businessId, projectId, clientId, transaction } = {}) {
  if (!projectId) return null;
  let cid = clientId || null;
  if (!cid) {
    const rows = await ProjectClient.findAll({
      where: { project_id: projectId, client_id: { [Op.ne]: null } }, attributes: ['client_id'], transaction,
    });
    const set = [...new Set(rows.map((r) => r.client_id))];
    if (set.length !== 1) return null;
    cid = set[0];
  }
  const cv = await findClientChannel(projectId, cid, { transaction });
  if (!cv || (businessId && Number(cv.business_id) !== Number(businessId))) return null;
  return cv;
}

/**
 * 프로젝트 멤버 → 그 프로젝트의 대화방 전부에 참여자로 (2026-11-16 Irene «프로젝트에 추가하면 채팅에도 추가되게»).
 *   프로젝트 방(내부·고객 채널)은 사적 방이 아니라 프로젝트의 것 — 방을 만들 때 넣는 규칙(ensureClientChannel 등)을
 *   **나중에 들어온 멤버**에게도 똑같이. joinParticipant 는 멱등(이미 참여자면 그대로, «보는 중» 이면 올림).
 *   보관된 방도 넣는다 — 되살리면 그 멤버도 그 방 사람이다.
 * @returns {Promise<number[]>} 새로 들어간(또는 올라간) 대화방 id
 */
async function joinProjectMemberToChannels({ projectId, businessId, userIds, actorUserId, via = 'project_member', io, exceptConversationId } = {}) {
  if (!projectId || !businessId) return [];
  // ★ «자동 참여» 가 켜진 방만(2026-11-24 Irene «고객이나 다른 채팅방 만들면 그건 각각 필요해서 만드는 거» · Fable 판정 3).
  //   보관된 방도 켜져 있으면 넣는다 — 되살리면 그 멤버도 그 방 사람이다. 고객방·따로 만든 방은 직접 초대만.
  const convs = await Conversation.findAll({
    where: { project_id: projectId, business_id: businessId, project_auto_join: true }, attributes: ['id'],
  });
  return joinUsersToConversations({
    convIds: convs.map((c) => c.id).filter((id) => !(exceptConversationId && Number(id) === Number(exceptConversationId))),
    businessId, userIds, actorUserId, via, io,
  });
}

/** 사람 멤버를 정해진 방들에 참여자로 — 멱등(이미 참여자면 그대로, «보는 중» 이면 올림). 감사·신호 같이. @returns 새로 들어간 방 id */
async function joinUsersToConversations({ convIds, businessId, userIds, actorUserId, via, io } = {}) {
  const ids = await humanMemberIds(businessId, userIds);
  if (!businessId || !ids.length || !convIds?.length) return [];
  const joined = [];
  for (const cvId of convIds) {
    const cv = { id: cvId };
    for (const uid of ids) {
      const r = await require('./convParticipants').joinParticipant(cv.id, uid, 'member');
      if (!r.created && !r.promoted) continue;
      joined.push(cv.id);
      try {
        createAuditLog({
          user_id: actorUserId || null, business_id: businessId,
          action: 'conversation.participant_add', entity_type: 'conversation', entity_id: cv.id,
          new_value: { user_id: uid, role: 'member', via },
        });
      } catch { /* 감사 실패가 참여를 막지 않는다 */ }
      // routes/conversations.js emitParticipantsChanged 와 같은 신호
      if (io) io.to(`conv:${cv.id}`).to(`conv:${cv.id}:staff`).to(`user:${uid}`).emit('conversation:participants', { conversation_id: cv.id });
    }
  }
  return [...new Set(joined)];
}

// 사람 멤버만(owner·admin·member) — Cue(ai)는 방을 만들 때 넣는 규칙이 따로 있어 여기서 넣거나 빼지 않는다
async function humanMemberIds(businessId, userIds, { transaction, includeRemoved = false } = {}) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!businessId || !ids.length) return [];
  const rows = await require('../models').BusinessMember.findAll({
    where: { business_id: businessId, user_id: ids, role: ['owner', 'admin', 'member'], ...(includeRemoved ? {} : { removed_at: null }) }, attributes: ['user_id'], raw: true, transaction,
  });
  return [...new Set(rows.map((r) => Number(r.user_id)))];
}

/**
 * 프로젝트에서 빠진 멤버 → 그 프로젝트의 대화방(보관 포함) 참여에서도 뺀다 (2026-11-16 Fable 완료 검증 FAIL 1 — 넣기가 방 N개를 주는데
 *   빼기가 0개를 거두면 숨은 프로젝트에서 빠진 사람이 고객·내부 대화를 계속 읽는다). 넣기와 대칭 — 같은 방 집합, 같은 사람 범위.
 *   참여 행(viewer 포함)·응대 담당·열린 소켓까지 거둔다(채팅 «내보내기» 와 같은 세 단계). 채팅 → 프로젝트 빼기는 하지 않는다.
 * @returns {Promise<number[]>} 빠진 대화방 id
 */
async function leaveProjectMemberFromChannels({ projectId, businessId, userIds, actorUserId, io, req } = {}) {
  const ids = await humanMemberIds(businessId, userIds, { includeRemoved: true });   // 빼기는 넓게 — 내보낸 멤버도 거둔다
  if (!projectId || !businessId || !ids.length) return [];
  const convs = await Conversation.findAll({
    where: { project_id: projectId, business_id: businessId }, attributes: ['id'],
  });
  const left = [];
  for (const cv of convs) {
    for (const uid of ids) {
      const removed = await require('./convParticipants').removeRows({ conversation_id: cv.id, user_id: uid });
      if (!removed) continue;
      left.push(cv.id);
      if (io) {
        io.in(`user:${uid}`).socketsLeave([`conv:${cv.id}`, `conv:${cv.id}:staff`]);
        io.to(`conv:${cv.id}`).to(`conv:${cv.id}:staff`).to(`user:${uid}`).emit('conversation:participants', { conversation_id: cv.id });
      }
      await require('./convCare').clearAssignee(businessId, uid, { conversationId: cv.id, io, actorUserId, req });
      try {
        createAuditLog({
          user_id: actorUserId || null, business_id: businessId,
          action: 'conversation.participant_remove', entity_type: 'conversation', entity_id: cv.id,
          old_value: { user_id: uid }, new_value: { via: 'project_member_removed', project_id: projectId },
        });
      } catch { /* 감사 실패가 회수를 막지 않는다 */ }
    }
  }
  return [...new Set(left)];
}

/** PUT /api/projects/:id/members 뒤 — 든 멤버는 넣고 빠진 멤버(프로젝트 owner 제외)는 뺀다. 실패는 로그만(저장은 이미 끝났다). */
async function syncProjectMemberChannels({ project, added = [], removed = [], actorUserId, io, req } = {}) {
  const base = { projectId: project.id, businessId: project.business_id, actorUserId, io };
  try { if (added.length) await joinProjectMemberToChannels({ ...base, userIds: added }); } catch (e) { console.warn('[project_channel] join', e.message); }
  const out = removed.filter((uid) => Number(uid) !== Number(project.owner_user_id));
  try { if (out.length) await leaveProjectMemberFromChannels({ ...base, userIds: out, req }); } catch (e) { console.warn('[project_channel] leave', e.message); }
}

module.exports = { ensureProjectCustomerChannel, findClientChannel, ensureClientChannel, customerChannelForClient, joinProjectMemberToChannels, joinUsersToConversations, leaveProjectMemberFromChannels, syncProjectMemberChannels, initialCustomerRoomStaff, humanMemberIds };
