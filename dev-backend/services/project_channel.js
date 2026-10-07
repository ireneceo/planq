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
const { Op } = require('sequelize');
const { Conversation, ProjectMember, ConversationParticipant, Client, ProjectClient, Business } = require('../models');
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
  // 참가자 — 프로젝트 멤버 + 만든 사람. 없으면 아무도 그 방을 못 본다.
  const members = await ProjectMember.findAll({ where: { project_id: project.id }, attributes: ['user_id'] });
  const ids = new Set(members.map((m) => m.user_id));
  ids.add(userId);
  for (const uid of ids) {
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conv.id, user_id: uid },
      defaults: { conversation_id: conv.id, user_id: uid },
    });
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

/** 이 방에 고객(워크스페이스 멤버가 아닌 client 역할)으로 들어와 있는 사람이 있는가 */
async function hasClientParticipant(convId, { exceptUserIds = [], transaction } = {}) {
  const where = { conversation_id: convId, role: 'client' };
  if (exceptUserIds.length) where.user_id = { [Op.notIn]: exceptUserIds };
  return !!(await ConversationParticipant.findOne({ where, attributes: ['id'], transaction }));
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
  // 참가자 — 프로젝트 멤버 + 만든 사람 + Cue(프로젝트 생성 때 채널과 같은 기본값). 고객은 호출부가 들인다.
  const members = await ProjectMember.findAll({ where: { project_id: project.id }, attributes: ['user_id'], transaction });
  const ids = new Set(members.map((m) => m.user_id));
  if (actorUserId) ids.add(actorUserId);
  for (const uid of ids) {
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conv.id, user_id: uid },
      defaults: { conversation_id: conv.id, user_id: uid, role: 'member' },
      transaction,
    });
  }
  const biz = await Business.findByPk(project.business_id, { attributes: ['cue_user_id'], transaction });
  if (biz?.cue_user_id && !ids.has(biz.cue_user_id)) {
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conv.id, user_id: biz.cue_user_id },
      defaults: { conversation_id: conv.id, user_id: biz.cue_user_id, role: 'member' },
      transaction,
    });
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

module.exports = { ensureProjectCustomerChannel, findClientChannel, ensureClientChannel, customerChannelForClient };
