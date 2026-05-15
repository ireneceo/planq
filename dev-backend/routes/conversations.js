const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Conversation, ConversationParticipant, Message, User, Client, Business, Project, ProjectMember, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, conversationListWhere, canAccessConversation } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const cueOrchestrator = require('../services/cue_orchestrator');
const kbService = require('../services/kb_service');

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─────────────────────────────────────────────────────────
// List conversations — client 면 자기 참여 대화방만
// ─────────────────────────────────────────────────────────
router.get('/:businessId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const baseWhere = await conversationListWhere(req.user.id, Number(req.params.businessId), req.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const conversations = await Conversation.findAll({
      where: { ...baseWhere, status: 'active', archived_at: null },
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
    // 사용자 본인의 pinned_at + last_read_at 부착 (응답 sort 용 + unread 계산).
    // ConversationParticipant 의 두 필드는 사용자별 — 같은 conv 라도 사람마다 핀/읽음 상태가 다름.
    const myParts = await ConversationParticipant.findAll({
      where: { user_id: req.user.id, conversation_id: conversations.map(c => c.id) },
      attributes: ['conversation_id', 'pinned_at', 'last_read_at'],
    });
    const pinMap = new Map(myParts.map(p => [p.conversation_id, p.pinned_at]));

    // unread_count — 단일 SQL 로 일괄 집계 (N+1 방지).
    // 본인이 보낸 메시지는 제외, last_read_at 이후 메시지만, 삭제 메시지 제외.
    let unreadMap = new Map();
    const convIds = conversations.map(c => c.id);
    if (convIds.length > 0) {
      const [rows] = await sequelize.query(
        `SELECT m.conversation_id AS cid, COUNT(m.id) AS cnt
           FROM messages m
           LEFT JOIN conversation_participants cp
             ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid
          WHERE m.conversation_id IN (:cids)
            AND m.sender_id != :uid
            AND (m.is_deleted IS NULL OR m.is_deleted = 0)
            AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
          GROUP BY m.conversation_id`,
        { replacements: { uid: req.user.id, cids: convIds } }
      );
      unreadMap = new Map(rows.map(r => [r.cid, Number(r.cnt)]));
    }

    // 사이클 N+15-D — WhatsApp 패턴 last_message preview.
    // 채팅 리스트에서 채팅방 이름 아래 한 줄로 마지막 대화 표시 → 사용자가 어떤 대화인지 즉시 인식.
    let lastMsgMap = new Map();
    if (convIds.length > 0) {
      const [lastRows] = await sequelize.query(
        `SELECT m1.conversation_id AS cid, m1.content, m1.sender_id, m1.kind, m1.is_ai,
                m1.created_at,
                u.name AS sender_name,
                u.name_localized AS sender_name_localized,
                (SELECT COUNT(*) FROM message_attachments ma WHERE ma.message_id = m1.id) AS att_count
           FROM messages m1
           INNER JOIN (
             SELECT conversation_id, MAX(created_at) AS mt
             FROM messages
             WHERE conversation_id IN (:cids)
               AND (is_deleted IS NULL OR is_deleted = 0)
             GROUP BY conversation_id
           ) latest ON m1.conversation_id = latest.conversation_id AND m1.created_at = latest.mt
           LEFT JOIN users u ON u.id = m1.sender_id`,
        { replacements: { cids: convIds } }
      );
      for (const r of lastRows) {
        let preview = (r.content || '').trim();
        if (!preview) {
          if (r.kind === 'card') preview = '[카드]';
          else if (Number(r.att_count) > 0) preview = Number(r.att_count) === 1 ? '[첨부 1개]' : `[첨부 ${r.att_count}개]`;
        }
        // 200자 cap — 응답 크기 보호
        if (preview.length > 200) preview = preview.slice(0, 200);
        let nameLocalized = null;
        try { nameLocalized = r.sender_name_localized ? JSON.parse(r.sender_name_localized) : null; } catch { /* not JSON */ }
        lastMsgMap.set(r.cid, {
          content: preview,
          sender_id: r.sender_id,
          sender_name: r.sender_name || null,
          sender_name_localized: nameLocalized,
          is_ai: !!r.is_ai,
          created_at: r.created_at,
        });
      }
    }

    const enriched = conversations.map(c => {
      const obj = c.toJSON();
      obj.my_pinned_at = pinMap.get(c.id) || null;
      obj.unread_count = unreadMap.get(c.id) || 0;
      obj.last_message_preview = lastMsgMap.get(c.id) || null;
      return obj;
    });
    // 정렬: 핀 우선 (pinned_at NOT NULL DESC), 그 안에서 last_message_at DESC
    enriched.sort((a, b) => {
      const ap = a.my_pinned_at ? 1 : 0;
      const bp = b.my_pinned_at ? 1 : 0;
      if (ap !== bp) return bp - ap; // 핀이 위로
      const al = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bl = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bl - al;
    });
    successResponse(res, enriched);
  } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────
// Pin / Unpin (사용자별 즐겨찾기)
// ─────────────────────────────────────────────────────────
//   POST   /api/conversations/:businessId/:id/pin    — 핀
//   DELETE /api/conversations/:businessId/:id/pin    — 핀 해제
//   참여자가 아니어도 멤버 이상이면 핀 가능 (해당 사용자의 ConversationParticipant 자동 생성).
router.post('/:businessId/:id/pin', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const convId = Number(req.params.id);
    const conv = await Conversation.findOne({ where: { id: convId, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    const [part] = await ConversationParticipant.findOrCreate({
      where: { conversation_id: convId, user_id: req.user.id },
      defaults: { conversation_id: convId, user_id: req.user.id, role: 'member' },
    });
    await part.update({ pinned_at: new Date() });
    // 다중 디바이스 동기화 — 같은 user 의 모든 socket 에 핀 상태 broadcast
    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.id}`).emit('conversation:pin', { conversation_id: convId, pinned_at: part.pinned_at });
    return successResponse(res, { pinned_at: part.pinned_at });
  } catch (err) { next(err); }
});
router.delete('/:businessId/:id/pin', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const convId = Number(req.params.id);
    const part = await ConversationParticipant.findOne({
      where: { conversation_id: convId, user_id: req.user.id },
    });
    if (part && part.pinned_at) {
      await part.update({ pinned_at: null });
    }
    // 다중 디바이스 동기화 — 같은 user 의 모든 socket 에 핀 해제 broadcast
    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.id}`).emit('conversation:pin', { conversation_id: convId, pinned_at: null });
    return successResponse(res, { pinned_at: null });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Read 처리 — 대화방 진입 시 last_read_at = NOW()
//   PUT /api/conversations/:businessId/:id/read
//   참여자가 아니어도 워크스페이스 멤버 이상이면 자동으로 ConversationParticipant 생성
//   (핀과 동일 — 핀 안 한 채팅도 읽으면 unread 카운터 0 으로 정확하게 유지)
// ─────────────────────────────────────────────────────────
router.put('/:businessId/:id/read', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const convId = Number(req.params.id);
    const conv = await Conversation.findOne({ where: { id: convId, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!(await canAccessConversation(req.user.id, conv, req.scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const [part] = await ConversationParticipant.findOrCreate({
      where: { conversation_id: convId, user_id: req.user.id },
      defaults: { conversation_id: convId, user_id: req.user.id, role: 'member' },
    });
    await part.update({ last_read_at: new Date() });
    // 사이클 N+15-C — 같은 conv room 의 다른 참여자에게 "이 user 가 읽었음" broadcast.
    // 발송자는 자기 메시지의 read_by_count 를 실시간 +1.
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${convId}`).emit('conversation:read', {
        conversation_id: convId,
        user_id: req.user.id,
        last_read_at: part.last_read_at,
      });
    }
    return successResponse(res, { last_read_at: part.last_read_at });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// 사이드바용 — 워크스페이스 전체 대화방의 토탈 unread 카운트.
//   GET /api/conversations/:businessId/unread-total
//   응답: { total: 12, by_conversation: { 1: 3, 5: 9 } }
// ─────────────────────────────────────────────────────────
router.get('/:businessId/unread-total', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const baseWhere = await conversationListWhere(req.user.id, Number(req.params.businessId), req.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const conversations = await Conversation.findAll({
      where: { ...baseWhere, status: 'active', archived_at: null },
      attributes: ['id'],
    });
    const convIds = conversations.map(c => c.id);
    if (convIds.length === 0) return successResponse(res, { total: 0, by_conversation: {} });
    const [rows] = await sequelize.query(
      `SELECT m.conversation_id AS cid, COUNT(m.id) AS cnt
         FROM messages m
         LEFT JOIN conversation_participants cp
           ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid
        WHERE m.conversation_id IN (:cids)
          AND m.sender_id != :uid
          AND (m.is_deleted IS NULL OR m.is_deleted = 0)
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
        GROUP BY m.conversation_id`,
      { replacements: { uid: req.user.id, cids: convIds } }
    );
    const byConv = {};
    let total = 0;
    rows.forEach(r => { byConv[r.cid] = Number(r.cnt); total += Number(r.cnt); });
    return successResponse(res, { total, by_conversation: byConv });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Create conversation
// ─────────────────────────────────────────────────────────
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const {
      title, client_id, participant_ids, participant_user_ids,
      project_id, channel_type,
      auto_extract_enabled, translation_enabled, translation_languages,
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

    // 채팅 설정 (NewChatModal 에서 결정 — 사용자 명시 우선, 안 주면 채널 종류로 디폴트)
    let finalAutoExtract = typeof auto_extract_enabled === 'boolean'
      ? auto_extract_enabled
      : (finalChannel === 'customer');
    let finalTranslationEnabled = false;
    let finalTranslationLanguages = null;
    if (translation_enabled === true && Array.isArray(translation_languages)) {
      const { validateLanguages } = require('../services/translation_service');
      const v = validateLanguages(translation_languages);
      if (!v.ok) return errorResponse(res, `translation_languages_${v.reason}`, 400);
      finalTranslationEnabled = true;
      finalTranslationLanguages = v.normalized;
    }

    const conversation = await Conversation.create({
      business_id: req.params.businessId,
      project_id: project_id || null,
      title: title?.trim() || '새 대화',
      client_id: client_id || null,
      channel_type: finalChannel === 'direct' ? 'internal' : finalChannel,
      cue_enabled: finalChannel === 'customer',
      auto_extract_enabled: finalAutoExtract,
      translation_enabled: finalTranslationEnabled,
      translation_languages: finalTranslationLanguages,
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
// 권한: 본인이 나가는 경우(셀프 제거) 또는 owner/platform_admin 만.
// 다른 멤버가 타인을 임의 제거하는 것은 협업 파괴 → 차단.
router.delete('/:businessId/:id/participants/:userId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!conv) return errorResponse(res, 'Conversation not found', 404);
    const targetUserId = Number(req.params.userId);
    const isSelfLeave = targetUserId === req.user.id;
    const isOwner = req.businessRole === 'owner' || req.user.platform_role === 'platform_admin';
    if (!isSelfLeave && !isOwner) {
      return errorResponse(res, '본인 나가기 또는 오너만 대화방에서 멤버를 제거할 수 있습니다', 403);
    }
    await ConversationParticipant.destroy({ where: { conversation_id: conv.id, user_id: targetUserId } });
    successResponse(res, { removed: true });
  } catch (error) { next(error); }
});
ProjectMember; // silence unused import (future: project member pre-selection)

// ─────────────────────────────────────────────────────────
// 보관함 — 보관된 채팅 목록 (workspace admin only).
// 라우트 순서 주의: `/:businessId/archived` (literal) 가 `/:businessId/:id` (param)
// 보다 먼저 정의되어야 Express 가 archived 를 :id 로 잘못 매칭하지 않음.
// ─────────────────────────────────────────────────────────
router.get('/:businessId/archived', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertWorkspaceAdmin(req, businessId))) {
      return errorResponse(res, 'workspace_owner_required', 403);
    }
    const conversations = await Conversation.findAll({
      where: { business_id: businessId, archived_at: { [Op.ne]: null } },
      include: [
        { model: Project, attributes: ['id', 'name'], required: false },
        { model: User, as: 'archivedBy', attributes: ['id', 'name', 'email'], required: false },
      ],
      order: [['archived_at', 'DESC']],
    });
    return successResponse(res, conversations.map(c => c.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Get conversation detail + messages
// ─────────────────────────────────────────────────────────
router.get('/:businessId/:id', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'summary', 'summary_updated_at', 'assigned_member_id'] },
        { model: ConversationParticipant, as: 'participants', include: [{ model: User, attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai'] }] },
        {
          model: Message,
          as: 'messages',
          where: { is_deleted: false },
          required: false,
          include: [
            { model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'avatar_url', 'is_ai'] },
            { model: require('../models').MessageAttachment, as: 'attachments', required: false },
          ],
          order: [['created_at', 'ASC']],
          limit: 200
        }
      ]
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    // Client: 자기 참여 대화방만 통과
    if (!(await canAccessConversation(req.user.id, conversation, req.scope))) {
      return errorResponse(res, 'forbidden', 403);
    }

    // Client 역할은 is_internal + 미승인 Draft 필터링 (PERMISSION_MATRIX §7)
    let messages = conversation.messages || [];
    if (req.scope?.isClient) {
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
router.post('/:businessId/:id/messages', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const { content, is_internal } = req.body;
    // 첨부만 있는 메시지 허용 (빈 content OK — 첨부는 이후 link 단계에서 추가됨)
    const cleanedContent = content ? String(content) : '';

    const conversation = await Conversation.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);

    // Client: 자기 참여 대화방만 작성 가능 (PERMISSION_MATRIX §5.3)
    if (!(await canAccessConversation(req.user.id, conversation, req.scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // Client 는 internal 메모 작성 금지
    const internalFlag = req.scope?.isClient ? false : !!is_internal;

    const msg = await Message.create({
      conversation_id: conversation.id,
      sender_id: req.user.id,
      content: cleanedContent,
      kind: 'text',
      is_ai: false,
      is_internal: internalFlag
    });

    await conversation.update({ last_message_at: new Date() });

    // Socket.IO broadcast — 채팅 페이지 실시간 반영 + 우측 상단 in-app 토스터 트리거.
    // (projects.js 의 메시지 라우트와 동일 패턴. NotificationToaster 의 'message:new' 핸들러가 받음.)
    const fullMsg = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
    });
    const io = req.app.get('io');
    if (io && fullMsg) io.to(`conv:${conversation.id}`).emit('message:new', fullMsg.toJSON());

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'message.create',
      targetType: 'Message',
      targetId: msg.id
    });

    // 멘션 + 새 메시지 알림 fan-out
    // - 멘션된 사용자 → eventKind='mention' (강조 + 매트릭스 별도 토글)
    // - 그 외 참여자 (sender 제외) → eventKind='message' (일반 새 메시지)
    // - is_internal=true 메시지는 client 제외
    try {
      const { resolveMentions } = require('../services/mention_parser');
      const { notifyMany } = require('./notifications');
      const biz = await Business.findByPk(req.params.businessId, { attributes: ['name', 'brand_name'] });
      const wsName = biz?.brand_name || biz?.name || null;
      const previewBody = String(content).length > 140 ? String(content).slice(0, 140) + '…' : String(content);
      const link = `${process.env.APP_URL || 'https://dev.planq.kr'}/talk?conv=${conversation.id}`;
      const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
      const senderName = sender?.name || 'PlanQ';
      const convTitle = conversation.title || '대화';

      const mentioned = await resolveMentions(content, req.params.businessId, req.user.id);

      // 참여자 수집 — sender 제외, internal 이면 client 제외
      const participants = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id, user_id: { [Op.ne]: req.user.id } },
        attributes: ['user_id', 'role'],
      });
      let plainRecipients = participants.map(p => p.user_id);
      if (internalFlag) {
        const clientParts = participants.filter(p => p.role === 'client').map(p => p.user_id);
        plainRecipients = plainRecipients.filter(id => !clientParts.includes(id));
      }
      // 멘션된 사용자는 'mention' 으로 가니까 'message' 에서 빼서 중복 알림 방지
      const mentionedSet = new Set(mentioned);
      const messageRecipients = plainRecipients.filter(id => !mentionedSet.has(id));

      if (mentioned.length > 0) {
        notifyMany({
          userIds: mentioned, businessId: Number(req.params.businessId), eventKind: 'mention',
          title: `${senderName} 님이 ${convTitle} 에서 언급`,
          body: previewBody, link, ctaLabel: '대화 보기', workspaceName: wsName,
          tag: `conv:${conversation.id}`,
        }).catch((e) => console.warn('[notify mention msg]', e.message));
      }
      if (messageRecipients.length > 0) {
        notifyMany({
          userIds: messageRecipients, businessId: Number(req.params.businessId), eventKind: 'message',
          title: `${senderName} · ${convTitle}`,
          body: previewBody, link, ctaLabel: '대화 보기', workspaceName: wsName,
          tag: `conv:${conversation.id}`,
        }).catch((e) => console.warn('[notify message msg]', e.message));
      }
    } catch (e) { console.warn('[notify msg outer]', e.message); }

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

    // 사이클 G — conversation 의 project/client 컨텍스트 전달
    const searchResults = await kbService.hybridSearch(req.params.businessId, lastClientMsg.content, {
      limit: 3,
      project_id: conversation.project_id || null,
      client_id: conversation.client_id || null,
    });
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
// 권한: owner/platform_admin 만 (대화방 보관은 전체에 영향). PERMISSION_MATRIX.md §5.5.
router.patch('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
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

// ============================================
// POST /api/conversations/:businessId/:id/archive — 채팅방 soft delete
// 정책: archived_at NOT NULL → list/검색에서 제외 (메시지/참가자 row 보존).
// 권한: workspace owner OR (project_id 있으면) 프로젝트 owner OR platform_admin. client 차단.
// ============================================
router.post('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (conv.archived_at) return errorResponse(res, 'already_archived', 400);

    const wsMember = await BusinessMember.findOne({
      where: { user_id: req.user.id, business_id: businessId, removed_at: null },
      attributes: ['role'],
    });
    const isWorkspaceOwner = wsMember?.role === 'owner';
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';

    let isProjectOwner = false;
    if (conv.project_id) {
      const pm = await ProjectMember.findOne({
        where: { project_id: conv.project_id, user_id: req.user.id },
        attributes: ['role'],
      });
      isProjectOwner = pm?.role === 'owner';
    }

    if (!isPlatformAdmin && !isWorkspaceOwner && !isProjectOwner) {
      return errorResponse(res, 'workspace_owner_or_project_owner_required', 403);
    }

    await conv.update({ archived_at: new Date(), archived_by_user_id: req.user.id });
    require('../services/auditService').logAudit(req, {
      action: 'conversation.archive',
      targetType: 'conversation',
      targetId: conv.id,
      oldValue: { archived_at: null },
      newValue: { archived_at: conv.archived_at, archived_by_user_id: req.user.id, project_id: conv.project_id },
    });
    return successResponse(res, conv.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// 보관함 — 보관된 채팅방 관리 (사이클 N+10)
// ============================================
// 권한: workspace owner OR platform_admin (member·client 차단).
//   archive 라우트와 일관 — 보관/복원/영구삭제는 모두 관리자 권한.

async function assertWorkspaceAdmin(req, businessId) {
  const wsMember = await BusinessMember.findOne({
    where: { user_id: req.user.id, business_id: businessId, removed_at: null },
    attributes: ['role'],
  });
  const isWorkspaceOwner = wsMember?.role === 'owner';
  const isPlatformAdmin = req.user.platform_role === 'platform_admin';
  return isPlatformAdmin || isWorkspaceOwner;
}

// 보관함 GET /:businessId/archived 는 라우트 순서 충돌 방지를 위해 파일 상단 (`/:businessId/:id` 정의 직전) 으로 이동됨.

// POST /api/conversations/:businessId/:id/unarchive — 보관 해제 (복원)
router.post('/:businessId/:id/unarchive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertWorkspaceAdmin(req, businessId))) {
      return errorResponse(res, 'workspace_owner_required', 403);
    }
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!conv.archived_at) return errorResponse(res, 'not_archived', 400);
    const oldArchivedAt = conv.archived_at;
    await conv.update({ archived_at: null, archived_by_user_id: null });
    require('../services/auditService').logAudit(req, {
      action: 'conversation.unarchive',
      targetType: 'conversation',
      targetId: conv.id,
      oldValue: { archived_at: oldArchivedAt },
      newValue: { archived_at: null },
    });
    return successResponse(res, conv.toJSON());
  } catch (err) { next(err); }
});

// DELETE /api/conversations/:businessId/:id — 영구 삭제 (보관함 안에서만)
//   안전핀: archived_at NOT NULL 인 conv 만 삭제 가능. 활성 conv 직접 삭제 차단.
//   30년차 정책: 활성 채팅을 직접 hard delete 하면 메시지·파일·업무까지 연쇄 손실 위험 → 보관 단계 강제.
//   삭제 후 메시지·첨부 row 는 DB FK ON DELETE CASCADE 또는 별도 cleanup cron 으로 처리.
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertWorkspaceAdmin(req, businessId))) {
      return errorResponse(res, 'workspace_owner_required', 403);
    }
    const conv = await Conversation.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!conv.archived_at) return errorResponse(res, 'must_archive_first', 400);
    const snapshot = { id: conv.id, name: conv.name, project_id: conv.project_id, archived_at: conv.archived_at };

    // 사이클 N+14 hotfix — child rows 명시 cascade 삭제 (FK DELETE_RULE='NO ACTION' 회피).
    // conversations 참조 FK 중 NO ACTION 인 것: conversation_participants, messages, task_candidates.
    // messages 참조 FK 중 NO ACTION 인 것: message_attachments.
    // 순서: message_attachments → messages → conversation_participants → task_candidates → conversation
    const convId = conv.id;
    const t = await sequelize.transaction();
    try {
      const MessageAttachment = require('../models').MessageAttachment;
      const TaskCandidate = require('../models').TaskCandidate;
      // 1. message_attachments — messages.conversation_id 기반 IN 절
      await sequelize.query(
        `DELETE ma FROM message_attachments ma
         INNER JOIN messages m ON ma.message_id = m.id
         WHERE m.conversation_id = :cid`,
        { replacements: { cid: convId }, transaction: t }
      );
      // 2. messages
      await Message.destroy({ where: { conversation_id: convId }, transaction: t });
      // 3. conversation_participants
      await ConversationParticipant.destroy({ where: { conversation_id: convId }, transaction: t });
      // 4. task_candidates
      await TaskCandidate.destroy({ where: { conversation_id: convId }, transaction: t });
      // 5. conversation 본체
      await conv.destroy({ transaction: t });
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }

    require('../services/auditService').logAudit(req, {
      action: 'conversation.delete',
      targetType: 'conversation',
      targetId: snapshot.id,
      oldValue: snapshot,
      newValue: null,
    });
    return successResponse(res, { id: snapshot.id, deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
