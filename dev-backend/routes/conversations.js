const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Conversation, ConversationParticipant, Message, User, Client, Business, Project, ProjectMember, BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const cueOrchestrator = require('../services/cue_orchestrator');
const kbService = require('../services/kb_service');

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─────────────────────────────────────────────────────────
// List conversations
// ─────────────────────────────────────────────────────────
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversations = await Conversation.findAll({
      where: { business_id: req.params.businessId, status: 'active' },
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name'] },
        {
          model: ConversationParticipant,
          as: 'participants',
          include: [{ model: User, attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai'] }]
        }
      ],
      order: [['last_message_at', 'DESC']]
    });
    successResponse(res, conversations);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// Create conversation
// ─────────────────────────────────────────────────────────
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const {
      title, client_id, participant_ids, participant_user_ids,
      project_id, channel_type,
    } = req.body;

    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    // 플랜 쿼터 — 대화방 수 한도
    const planCan = await require('../services/plan').can(req.params.businessId, 'create_conversation');
    if (!planCan.ok) {
      return errorResponse(res, `대화방 수 한도 초과 (최대 ${planCan.limit}개) — 플랜 업그레이드 필요`, 403);
    }

    // project_id 가 있으면 해당 프로젝트가 같은 워크스페이스인지 검증
    if (project_id) {
      const proj = await Project.findOne({ where: { id: project_id, business_id: req.params.businessId } });
      if (!proj) return errorResponse(res, 'invalid_project', 400);
    }

    // channel_type 정책:
    //  - 명시되면 그 값 ('customer' | 'internal' | 'direct' — direct 는 일반 대화)
    //  - 없고 client_id 있으면 'customer'
    //  - 없고 project_id 있으면 'internal'
    //  - 그 외 'direct' (프로젝트 없는 일반 대화)
    let finalChannel = channel_type;
    if (!finalChannel) {
      if (client_id) finalChannel = 'customer';
      else if (project_id) finalChannel = 'internal';
      else finalChannel = 'direct';
    }
    // DB ENUM 이 direct 를 모를 수 있으므로 fallback: direct → internal
    const allowed = ['customer', 'internal', 'direct'];
    if (!allowed.includes(finalChannel)) finalChannel = 'internal';

    const conversation = await Conversation.create({
      business_id: req.params.businessId,
      project_id: project_id || null,
      title: title?.trim() || '새 대화',
      client_id: client_id || null,
      channel_type: finalChannel === 'direct' ? 'internal' : finalChannel,
      cue_enabled: finalChannel === 'customer',
      auto_extract_enabled: finalChannel === 'customer',
    });

    await ConversationParticipant.create({
      conversation_id: conversation.id,
      user_id: req.user.id,
      role: 'owner'
    });

    if (finalChannel === 'customer' && business.cue_user_id) {
      await ConversationParticipant.create({
        conversation_id: conversation.id,
        user_id: business.cue_user_id,
        role: 'member'
      });
    }

    // participant_user_ids 우선, 없으면 participant_ids 호환
    const rawParticipants = Array.isArray(participant_user_ids)
      ? participant_user_ids
      : (Array.isArray(participant_ids) ? participant_ids : []);
    const uniq = [...new Set(rawParticipants.filter(Boolean))];
    for (const pid of uniq) {
      if (pid === req.user.id) continue;
      if (pid === business.cue_user_id) continue;
      await ConversationParticipant.create({
        conversation_id: conversation.id,
        user_id: pid,
        role: 'member'
      });
    }

    await createAuditLog({
      user_id: req.user.id, business_id: req.params.businessId,
      action: 'create', entity_type: 'conversation', entity_id: conversation.id,
      new_value: { title: conversation.title, project_id: conversation.project_id, channel_type: finalChannel },
    });

    successResponse(res, conversation, 'Conversation created', 201);
  } catch (error) { next(error); }
});

// 참여자 개별 추가/제거
router.post('/:businessId/:id/participants', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) return errorResponse(res, 'user_id required', 400);
    const businessId = Number(req.params.businessId);
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!conv) return errorResponse(res, 'Conversation not found', 404);
    // 추가 대상 user 가 같은 워크스페이스 멤버 또는 프로젝트 고객이어야 함 (타 워크스페이스 유저 유입 차단)
    const isWorkspaceMember = await BusinessMember.findOne({ where: { user_id, business_id: businessId } });
    let allowed = !!isWorkspaceMember;
    if (!allowed && conv.project_id) {
      const { ProjectClient } = require('../models');
      const pc = await ProjectClient.findOne({ where: { project_id: conv.project_id, contact_user_id: user_id } });
      allowed = !!pc;
    }
    if (!allowed) return errorResponse(res, 'user_not_in_workspace', 403);
    const exists = await ConversationParticipant.findOne({ where: { conversation_id: conv.id, user_id } });
    if (exists) return successResponse(res, exists);
    const created = await ConversationParticipant.create({
      conversation_id: conv.id, user_id, role: role || 'member',
    });
    successResponse(res, created, 'Participant added', 201);
  } catch (error) { next(error); }
});
router.delete('/:businessId/:id/participants/:userId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!conv) return errorResponse(res, 'Conversation not found', 404);
    await ConversationParticipant.destroy({ where: { conversation_id: conv.id, user_id: req.params.userId } });
    successResponse(res, { removed: true });
  } catch (error) { next(error); }
});
ProjectMember; // silence unused import (future: project member pre-selection)

// ─────────────────────────────────────────────────────────
// Get conversation detail + messages
// ─────────────────────────────────────────────────────────
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const messageWhere = { is_deleted: false };
    // Client 역할이면 내부 메모 + 미승인 Draft 제외
    if (req.businessRole === 'member' || req.businessRole === 'client') {
      // member 는 전체 볼 수 있게 두되, client 는 차단
    }

    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'summary', 'summary_updated_at', 'assigned_member_id'] },
        { model: ConversationParticipant, as: 'participants', include: [{ model: User, attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai'] }] },
        {
          model: Message,
          as: 'messages',
          where: messageWhere,
          required: false,
          include: [
            { model: User, as: 'sender', attributes: ['id', 'name', 'avatar_url', 'is_ai'] },
            { model: require('../models').MessageAttachment, as: 'attachments', required: false },
          ],
          order: [['created_at', 'ASC']],
          limit: 200
        }
      ]
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    // Client 역할은 is_internal + 미승인 Draft 필터링
    let messages = conversation.messages || [];
    if (req.businessRole === 'client') {
      messages = messages.filter(m =>
        !m.is_internal &&
        !(m.is_ai && m.ai_mode_used === 'draft' && m.ai_draft_approved !== true)
      );
    }

    const result = conversation.toJSON();
    result.messages = messages;
    successResponse(res, result);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// Send message (사람이 작성)
// ─────────────────────────────────────────────────────────
router.post('/:businessId/:id/messages', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { content, is_internal } = req.body;
    if (!content || !String(content).trim()) return errorResponse(res, 'content required', 400);

    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    const msg = await Message.create({
      conversation_id: conversation.id,
      sender_id: req.user.id,
      content: String(content),
      kind: 'text',
      is_ai: false,
      is_internal: !!is_internal
    });

    await conversation.update({ last_message_at: new Date() });

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'message.create',
      targetType: 'Message',
      targetId: msg.id
    });

    // Cue 자동 응답 트리거 (비동기 백그라운드)
    // 조건: 내부 메모가 아니고, 메시지를 보낸 사람이 관리자/멤버(사람)이면 Cue 는 스킵
    //       (Cue 는 오직 고객 메시지에만 자동 응답)
    // 단, 현재 테스트에서는 사람의 메시지도 Cue 에게 전달해볼 수 있도록 trigger 엔드포인트 분리.

    successResponse(res, msg, 'Message sent', 201);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// 수동으로 Cue 트리거 (현재 대화의 마지막 고객 메시지로)
// ─────────────────────────────────────────────────────────
router.post('/:businessId/:id/cue/trigger', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const lastClientMsg = await Message.findOne({
      where: {
        conversation_id: conversation.id,
        is_ai: false,
        is_internal: false,
        is_deleted: false
      },
      order: [['created_at', 'DESC']]
    });
    if (!lastClientMsg) return errorResponse(res, 'No recent customer message', 400);

    const client = conversation.client_id ? await Client.findByPk(conversation.client_id) : null;

    const result = await cueOrchestrator.respondToMessage({
      message: lastClientMsg,
      conversation,
      business,
      client
    });

    successResponse(res, result);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// 대화별 Cue 일시정지/재개
// ─────────────────────────────────────────────────────────
router.post('/:businessId/:id/cue/pause', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    await conversation.update({ cue_enabled: false });
    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'cue.pause',
      targetType: 'Conversation',
      targetId: conversation.id
    });
    successResponse(res, { cue_enabled: false });
  } catch (err) { next(err); }
});

router.post('/:businessId/:id/cue/resume', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    await conversation.update({ cue_enabled: true });
    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'cue.resume',
      targetType: 'Conversation',
      targetId: conversation.id
    });
    successResponse(res, { cue_enabled: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Cue 답변 후보 제안 (현재 맥락 기반)
// ─────────────────────────────────────────────────────────
router.get('/:businessId/:id/cue/suggestions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    const lastClientMsg = await Message.findOne({
      where: { conversation_id: conversation.id, is_ai: false, is_deleted: false, is_internal: false },
      order: [['created_at', 'DESC']]
    });
    if (!lastClientMsg) return successResponse(res, { suggestions: [] });

    const searchResults = await kbService.hybridSearch(req.params.businessId, lastClientMsg.content, { limit: 3 });
    successResponse(res, { suggestions: searchResults });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Draft 메시지 승인 / 거절
// ─────────────────────────────────────────────────────────
router.post('/messages/:msgId/approve', authenticateToken, async (req, res, next) => {
  try {
    const msg = await Message.findByPk(req.params.msgId, {
      include: [{ model: Conversation }]
    });
    if (!msg) return errorResponse(res, 'Message not found', 404);
    if (!msg.is_ai || msg.ai_mode_used !== 'draft') {
      return errorResponse(res, 'Not a draft message', 400);
    }

    // 권한 검사 — 해당 비즈니스 멤버
    const BusinessMember = require('../models/BusinessMember');
    const membership = await BusinessMember.findOne({
      where: { business_id: msg.Conversation.business_id, user_id: req.user.id }
    });
    if (!membership || membership.role === 'ai') {
      return errorResponse(res, 'Permission denied', 403);
    }

    await msg.update({
      ai_draft_approved: true,
      ai_draft_approved_by: req.user.id,
      ai_draft_approved_at: new Date()
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: msg.Conversation.business_id,
      action: 'cue.draft_approve',
      targetType: 'Message',
      targetId: msg.id
    });

    successResponse(res, msg);
  } catch (err) { next(err); }
});

router.post('/messages/:msgId/reject', authenticateToken, async (req, res, next) => {
  try {
    const msg = await Message.findByPk(req.params.msgId, {
      include: [{ model: Conversation }]
    });
    if (!msg) return errorResponse(res, 'Message not found', 404);
    if (!msg.is_ai || msg.ai_mode_used !== 'draft') {
      return errorResponse(res, 'Not a draft message', 400);
    }

    const BusinessMember = require('../models/BusinessMember');
    const membership = await BusinessMember.findOne({
      where: { business_id: msg.Conversation.business_id, user_id: req.user.id }
    });
    if (!membership || membership.role === 'ai') {
      return errorResponse(res, 'Permission denied', 403);
    }

    await msg.update({
      ai_draft_approved: false,
      ai_draft_approved_by: req.user.id,
      ai_draft_approved_at: new Date(),
      is_deleted: true,
      deleted_at: new Date()
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: msg.Conversation.business_id,
      action: 'cue.draft_reject',
      targetType: 'Message',
      targetId: msg.id
    });

    successResponse(res, { rejected: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Archive conversation
// ─────────────────────────────────────────────────────────
router.patch('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    await conversation.update({ status: 'archived' });
    successResponse(res, conversation);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// 고객 요약 (조회 + 갱신)
// ─────────────────────────────────────────────────────────
router.get('/:businessId/client/:clientId/summary', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({
      where: { id: req.params.clientId, business_id: req.params.businessId }
    });
    if (!client) return errorResponse(res, 'Client not found', 404);
    successResponse(res, {
      summary: client.summary,
      updated_at: client.summary_updated_at,
      manual: !!client.summary_manual
    });
  } catch (err) { next(err); }
});

router.post('/:businessId/client/:clientId/summary/refresh', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({
      where: { id: req.params.clientId, business_id: req.params.businessId }
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    const summary = await cueOrchestrator.generateClientSummary(client.id);
    successResponse(res, { summary, refreshed: !!summary });
  } catch (err) { next(err); }
});

module.exports = router;
