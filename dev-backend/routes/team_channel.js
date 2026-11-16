// 워크스페이스 «전체» 대화방 + 공지 (2026-11-16 · Fable 설계 B — services/team_channel.js 머리말이 계약).
//
//   GET  /api/team-channel/:businessId                                — 방 보장 + 참여자 맞춤 → { conversation_id, can_announce }
//   GET  /api/team-channel/:businessId/announcements                  — 지난 공지 목록(게시 중 먼저 표시는 화면 몫) · pagination
//   POST /api/team-channel/:businessId/announcements { title, body }  — 공지 올리기(대표·관리자) → 메시지 + 핀 + 알림
//   PUT  /api/team-channel/:businessId/announcements/:msgId { title, body } — 고치기(작성자·대표·관리자) · 다시 알리지 않음
//   GET  /api/team-channel/:businessId/announcements/:msgId/readers  — 읽은/안 읽은 사람(작성자·대표·관리자)
//
// platformroom-exempt: 워크스페이스 «전체» 방 하나(businesses.team_conversation_id)만 id 로 찾는다 — PlanQ 안내방을 세지 않는다
// 모두 멤버 전용(checkBusinessAccess — 고객 403). 방 자체의 읽기·쓰기는 기존 대화 API 가 한다(사적 방 = 참여자만).
const express = require('express');
const router = express.Router();
const { Op, literal } = require('sequelize');
const { Business, Conversation, ConversationParticipant, Message, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { isWorkspaceAdminReq } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { perUserDaily } = require('../middleware/costGuard');
const team = require('../services/team_channel');
const { applyMemberDisplayName, applyMemberDisplayNameOne, getMemberDisplayName } = require('../services/displayName');
const { countOthers } = require('../services/convParticipants');

// 공지 = 멤버 전원에게 푸시가 간다 — 사람당 분 5·일 50(외부 발송 비용 라우트, ops-backend 1번).
const announceLimiter = perUserDaily('team-announce', { perMin: 5, perDay: 50 });

async function teamConv(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'team_conversation_id'] });
  if (!biz || !biz.team_conversation_id) return null;
  return Conversation.findOne({ where: { id: biz.team_conversation_id, business_id: businessId } });
}

/** 메시지 → 공지 응답 모양(읽음 수 포함). */
async function shapeAnnouncements(msgs, conv, businessId) {
  if (!msgs.length) return [];
  const parts = await require('../services/convParticipants').participantRows(conv.id, ['user_id', 'last_read_at']);
  const out = msgs.map((m) => {
    const j = m.toJSON ? m.toJSON() : m;
    const created = new Date(j.created_at).getTime();
    const others = parts.filter((p) => Number(p.user_id) !== Number(j.sender_id));
    const readBy = others.filter((p) => p.last_read_at && new Date(p.last_read_at).getTime() >= created).length;
    return {
      id: j.id,
      conversation_id: conv.id,
      title: j.meta?.announcement?.title || '',
      content: j.content,
      sender_id: j.sender_id,
      sender: j.sender || null,
      created_at: j.created_at,
      is_edited: !!j.is_edited,
      edited_at: j.edited_at || null,
      pinned_at: j.pinned_at || null,
      read_by_count: readBy,
      other_count: others.length,
    };
  });
  await applyMemberDisplayName(out, businessId, ['sender']);
  return out;
}

router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const r = await team.ensureTeamChannel(businessId);
    if (!r) return errorResponse(res, 'workspace_not_found', 404);
    return successResponse(res, { conversation_id: r.conversation.id, can_announce: isWorkspaceAdminReq(req) });
  } catch (err) { next(err); }
});

router.get('/:businessId/announcements', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const conv = await teamConv(businessId);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    if (!conv) return paginatedResponse(res, [], 0, { limit, page, offset });
    // 이 방 참여자만 본다(사적 방 술어와 같다) — 멤버면 동기화로 들어와 있다
    const me = await ConversationParticipant.findOne({ where: { conversation_id: conv.id, user_id: req.user.id }, attributes: ['id'] });
    if (!me && !isWorkspaceAdminReq(req)) return errorResponse(res, 'forbidden', 403);
    const { rows, count } = await Message.findAndCountAll({
      where: {
        conversation_id: conv.id, is_deleted: false,
        [Op.and]: [literal("JSON_EXTRACT(`Message`.`meta`, '$.announcement') IS NOT NULL")],
      },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']], limit, offset,
    });
    return paginatedResponse(res, await shapeAnnouncements(rows, conv, businessId), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.post('/:businessId/announcements', authenticateToken, checkBusinessAccess, ...announceLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!isWorkspaceAdminReq(req)) return errorResponse(res, 'announce_admin_only', 403);
    const { title, content } = team.cleanAnnouncement(req.body);
    if (!title) return errorResponse(res, 'title_required', 400);
    if (!content) return errorResponse(res, 'body_required', 400);
    const r = await team.ensureTeamChannel(businessId);
    if (!r) return errorResponse(res, 'workspace_not_found', 404);
    const conv = r.conversation;
    const io = req.app.get('io');
    // 보내는 사람도 참여자(플랫폼 관리자가 멤버가 아니어도 방에 글이 남는다 — 참여는 동기화 대상 아님)
    await require('../services/convParticipants').joinParticipant(conv.id, req.user.id, 'member');
    const now = new Date();
    const msg = await Message.create({
      conversation_id: conv.id, sender_id: req.user.id, content, kind: 'text',
      meta: { announcement: { title } }, is_ai: false, is_internal: false,
      pinned_at: now, pinned_by_user_id: req.user.id,
    });
    await conv.update({ last_message_at: now });

    const full = await Message.findByPk(msg.id, { include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized'] }] });
    const payload = full.toJSON();
    await applyMemberDisplayNameOne(payload, businessId, ['sender']);
    payload.other_count = await countOthers(conv.id, req.user.id);
    payload.read_by_count = 0;
    const chatPost = require('../services/chatPost');
    chatPost.broadcastNewMessage(io, conv, payload);
    if (io) io.to(`conv:${conv.id}`).to(`conv:${conv.id}:staff`).emit('message:pinned', { id: msg.id, conversation_id: conv.id, pinned_at: msg.pinned_at });
    if (io) require('../services/convBroadcast').emitConvWide(io, conv, 'team:announcement', { id: msg.id, conversation_id: conv.id, business_id: businessId }).catch(() => {});

    // 알림 — 보낸 사람 뺀 참여자(멤버). 방 알림을 꺼도 간다(ignoreMute). 즉시 메일 없음(안 읽으면 채팅과 같은 5분 묶음 메일).
    try {
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conv.id, user_id: { [Op.ne]: req.user.id } }, attributes: ['user_id'], raw: true,
      });
      const memberIds = new Set(await team.activeMemberIds(businessId));
      const userIds = parts.map((p) => Number(p.user_id)).filter((id) => memberIds.has(id));
      if (userIds.length) {
        const { notifyMany } = require('./notifications');
        const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
        const disp = await getMemberDisplayName(businessId, req.user.id, full.sender?.name).catch(() => ({}));
        await notifyMany({
          userIds, businessId, eventKind: 'message',
          titleSpec: { feature: 'chat', action: 'chat_announcement', subject: [disp?.name, title].filter(Boolean).join(' · ') },
          body: content.slice(0, 140),
          link: `/talk?conv=${conv.id}`,
          workspaceName: biz?.brand_name || biz?.name || null,
          previewPolicy: 'excerpt',
          tag: `announce:${msg.id}`,
          entityType: 'conversation', entityId: conv.id,
          actorUserId: req.user.id,
          skipChannels: ['email'],
          ignoreMute: true,
        });
      }
    } catch (e) { console.warn('[team announce notify]', e.message); }

    createAuditLog({ userId: req.user.id, businessId, action: 'announcement.create', targetType: 'Message', targetId: msg.id, newValue: { title } });
    return successResponse(res, { id: msg.id, conversation_id: conv.id, title, content, pinned_at: msg.pinned_at }, 'created', 201);
  } catch (err) { next(err); }
});

router.put('/:businessId/announcements/:msgId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const conv = await teamConv(businessId);
    if (!conv) return errorResponse(res, 'message_not_found', 404);
    const msg = await Message.findOne({ where: { id: req.params.msgId, conversation_id: conv.id } });
    if (!msg || !team.isAnnouncement(msg)) return errorResponse(res, 'message_not_found', 404);
    if (msg.is_deleted) return errorResponse(res, 'message_deleted', 400);
    const isSender = Number(msg.sender_id) === Number(req.user.id);
    if (!isSender && !isWorkspaceAdminReq(req)) return errorResponse(res, 'forbidden', 403);
    const { title, content } = team.cleanAnnouncement(req.body);
    if (!title) return errorResponse(res, 'title_required', 400);
    if (!content) return errorResponse(res, 'body_required', 400);
    const old = { title: msg.meta?.announcement?.title || '', content: msg.content };
    await msg.update({ content, meta: { ...(msg.meta || {}), announcement: { ...(msg.meta?.announcement || {}), title } }, is_edited: true, edited_at: new Date() });

    const full = await Message.findByPk(msg.id, { include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized'] }] });
    const [shaped] = await shapeAnnouncements([full], conv, businessId);
    // 방송은 고른 칸만(행 통째 X) — 화면은 없는 칸(반응·첨부)을 지금 값 그대로 둔다(QTalkPage message:updated)
    const io = req.app.get('io');
    if (io) io.to(`conv:${conv.id}`).to(`conv:${conv.id}:staff`).emit('message:updated', {
      id: shaped.id, conversation_id: conv.id, sender_id: shaped.sender_id, sender: shaped.sender,
      kind: 'text', content: shaped.content, meta: { announcement: { title: shaped.title } },
      is_ai: false, is_internal: false, is_deleted: false, is_edited: true, edited_at: shaped.edited_at,
      created_at: shaped.created_at, pinned_at: shaped.pinned_at,
      read_by_count: shaped.read_by_count, other_count: shaped.other_count,
    });
    createAuditLog({ userId: req.user.id, businessId, action: 'announcement.edit', targetType: 'Message', targetId: msg.id, oldValue: old, newValue: { title, content } });
    return successResponse(res, { id: msg.id, title, content, is_edited: true });
  } catch (err) { next(err); }
});

router.get('/:businessId/announcements/:msgId/readers', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const conv = await teamConv(businessId);
    if (!conv) return errorResponse(res, 'message_not_found', 404);
    const msg = await Message.findOne({ where: { id: req.params.msgId, conversation_id: conv.id }, attributes: ['id', 'sender_id', 'created_at', 'meta', 'is_deleted'] });
    if (!msg || !team.isAnnouncement(msg) || msg.is_deleted) return errorResponse(res, 'message_not_found', 404);
    // 명단은 작성자·대표·관리자만 — 멤버는 화면에서 숫자만 본다(Fable 설계)
    if (Number(msg.sender_id) !== Number(req.user.id) && !isWorkspaceAdminReq(req)) return errorResponse(res, 'forbidden', 403);
    const parts = await ConversationParticipant.findAll({
      where: { conversation_id: conv.id, user_id: { [Op.ne]: msg.sender_id } },
      attributes: ['user_id', 'last_read_at'],
      include: [{ model: User, attributes: ['id', 'name', 'name_localized'], required: true }],
    });
    const created = new Date(msg.get('created_at')).getTime();
    const people = parts.map((p) => ({
      user: { id: p.User.id, name: p.User.name, name_localized: p.User.name_localized },
      read_at: p.last_read_at && new Date(p.last_read_at).getTime() >= created ? p.last_read_at : null,
    }));
    await applyMemberDisplayName(people, businessId, ['user']);
    const read = people.filter((x) => x.read_at).map((x) => ({ user_id: x.user.id, name: x.user.name, read_at: x.read_at }));
    const unread = people.filter((x) => !x.read_at).map((x) => ({ user_id: x.user.id, name: x.user.name }));
    return successResponse(res, { read, unread });
  } catch (err) { next(err); }
});

module.exports = router;
