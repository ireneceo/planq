// 대화방 참여자 행을 **쓰는 문** — 한 곳 (2026-10-15 Fable 설계 판정 A · docs/QTALK_PARTICIPATION_DESIGN.md).
//
// 왜: 방을 «열기만» 해도 읽음 처리(/read)·핀이 role 'member' 참여자 행을 만들었다. 그래서 초대 안 한 사람이
//   참여자 목록·@ 후보·메시지 알림·읽음 분모에 들어갔다(Irene «초대 안 했는데 들어가 있다»).
//   이제 행이 두 종류다 —
//     · 참여자(is_viewer 0) : 초대됐거나 그 방에서 말한 사람. 모델 defaultScope 가 기본으로 보는 것.
//     · 보는 중(is_viewer 1): 열어 본 사람의 읽음 커서·핀만 담는다. 어디에도 참여자로 세지 않는다.
//   목록에 보이는 범위(멤버 이상은 프로젝트·고객 방을 본다 — 열린 문화)는 바꾸지 않는다.
//
// ★ viewer 를 만드는 문은 touchOwnRow 하나, 참여자로 올리는 문은 joinParticipant 하나.
//   이 파일 밖에서 ConversationParticipant.unscoped()/create/findOrCreate/bulkCreate 를 쓰면 가드
//   `--category=convparticipants` 가 막는다(scoped findOrCreate 는 viewer 행을 못 보고 만들다 unique 로 죽는다).
'use strict';

const { UniqueConstraintError } = require('sequelize');

function model() { return require('../models').ConversationParticipant; }

/**
 * 내 행(참여자든 viewer 든)을 찾아 patch 를 적용한다. 없으면 **viewer 로** 만든다.
 * 읽음·핀처럼 «내 상태» 를 저장하는 곳만 부른다. 접근 판정(canAccessConversation)은 호출부가 먼저 한다.
 */
async function touchOwnRow(conversationId, userId, patch = {}, opts = {}) {
  const M = model().unscoped();
  const where = { conversation_id: conversationId, user_id: userId };
  let row = await M.findOne({ where, transaction: opts.transaction });
  if (!row) {
    try {
      row = await M.create({ ...where, role: 'member', is_viewer: true, ...patch }, { transaction: opts.transaction });
      return row;
    } catch (e) {
      if (!(e instanceof UniqueConstraintError)) throw e;
      row = await M.findOne({ where, transaction: opts.transaction });
      if (!row) throw e;
    }
  }
  if (Object.keys(patch).length) await row.update(patch, { transaction: opts.transaction });
  return row;
}

/** 내 행을 그대로 읽는다(viewer 포함) — 목록의 핀·읽음 커서처럼 «내 상태» 를 보여줄 때만. */
async function ownRows(userId, conversationIds, attributes) {
  if (!conversationIds || !conversationIds.length) return [];
  return model().unscoped().findAll({
    where: { user_id: userId, conversation_id: conversationIds },
    attributes,
  });
}

/**
 * 참여자로 들인다(초대·생성·말하기). 없으면 참여자로 만들고, viewer 행이면 **참여자로 올린다**
 * (joined_at = 지금, 읽음 커서·핀은 그대로). 이미 참여자면 아무것도 안 한다.
 * @returns {{ row, created: boolean, promoted: boolean }}
 */
async function joinParticipant(conversationId, userId, role = 'member', opts = {}) {
  const M = model().unscoped();
  const where = { conversation_id: conversationId, user_id: userId };
  let row = await M.findOne({ where, transaction: opts.transaction });
  if (!row) {
    try {
      row = await M.create({ ...where, role, is_viewer: false }, { transaction: opts.transaction });
      return { row, created: true, promoted: false };
    } catch (e) {
      if (!(e instanceof UniqueConstraintError)) throw e;
      row = await M.findOne({ where, transaction: opts.transaction });
      if (!row) throw e;
    }
  }
  if (row.is_viewer) {
    await row.update({ is_viewer: false, role, joined_at: new Date() }, { transaction: opts.transaction });
    return { row, created: false, promoted: true };
  }
  return { row, created: false, promoted: false };
}

/**
 * 그 방에서 말한 사람은 참여자다 — viewer 가 메시지를 보내면 올린다(Fable 판정 3: 말한 사람이 패널에 없고
 * @ 로 못 부르면 다음 신고다). 원래 참여자이거나 행이 없으면(고객·게스트 경로 등) 아무것도 안 한다.
 * best-effort — 실패가 메시지 전송을 막지 않는다. 올렸으면 true.
 */
async function promoteSpeaker(conversationId, userId, { io } = {}) {
  try {
    const row = await model().unscoped().findOne({
      where: { conversation_id: conversationId, user_id: userId }, attributes: ['id', 'is_viewer'],
    });
    if (!row || !row.is_viewer) return false;
    const r = await joinParticipant(conversationId, userId, 'member');
    if (!r.promoted) return false;
    try {
      const conv = await require('../models').Conversation.findByPk(conversationId, { attributes: ['business_id'] });
      require('../middleware/audit').createAuditLog({
        user_id: userId, business_id: conv?.business_id || null,
        action: 'conversation.participant_join', entity_type: 'conversation', entity_id: conversationId,
        new_value: { user_id: Number(userId), via: 'message' },
      });
    } catch { /* best-effort */ }
    if (io) {
      // routes/conversations.js emitParticipantsChanged 와 같은 방(신호만)
      io.to(`conv:${conversationId}`).to(`conv:${conversationId}:staff`).to(`user:${userId}`)
        .emit('conversation:participants', { conversation_id: conversationId });
    }
    return true;
  } catch (e) {
    console.warn('[convParticipants.promoteSpeaker]', e.message);
    return false;
  }
}

/** 행 지우기 — viewer 행까지(참여자 내보내기는 핀·커서도 리셋, 대화 삭제는 FK 때문에 전부). */
async function removeRows(where, opts = {}) {
  return model().unscoped().destroy({ where, transaction: opts.transaction });
}

/**
 * 한 사람의 참여 역할을 바꾼다(viewer 행 포함) — 고객이 멤버가 됐을 때 client → member (services/clientToMember, 2026-10-16).
 * @returns {Promise<number>} 바뀐 행 수
 */
async function changeRole(userId, conversationIds, fromRole, toRole, opts = {}) {
  if (!userId || !Array.isArray(conversationIds) || !conversationIds.length) return 0;
  const { Op } = require('sequelize');
  const [n] = await model().unscoped().update(
    { role: toRole },
    { where: { user_id: userId, role: fromRole, conversation_id: { [Op.in]: conversationIds } }, transaction: opts.transaction },
  );
  return n || 0;
}

module.exports = { touchOwnRow, ownRows, joinParticipant, promoteSpeaker, removeRows, changeRole };
