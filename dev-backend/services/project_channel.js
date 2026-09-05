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
const { Conversation, ProjectMember, ConversationParticipant } = require('../models');
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

module.exports = { ensureProjectCustomerChannel };
