// 통합 공유 — entity 무관 발송 라우트 (사이클 N+4 5차)
//
// POST /api/share/email
//   body: { entity_type, entity_id, to, message? }
//   entity_type ∈ ['task', 'file', 'kb_document', 'calendar_event']
//   to: string | string[] (이메일)
//   share_token 자동 발급 (없으면).
//   응답: { share_url, results: [{ to, sent }] }

const express = require('express');
const router = express.Router();
const { Task, File, KbDocument, CalendarEvent, Business, User, Conversation, Message } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const { applyShareUpdate } = require('../services/share_helper');
const { sendEntityShareEmail } = require('../services/emailService');
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

const ENTITY_CONFIG = {
  task: {
    model: Task,
    titleField: 'title',
    publicPath: 'tasks',
    cardLabel: '업무',
    cardType: 'task',
    extraMeta: (e) => ({ task_id: e.id, status: e.status, due_date: e.due_date }),
  },
  file: {
    model: File,
    titleField: 'file_name',
    publicPath: 'files',
    cardLabel: '파일',
    cardType: 'file',
    extraMeta: (e) => ({ file_id: e.id, mime_type: e.mime_type, file_size: Number(e.file_size || 0) }),
  },
  kb_document: {
    model: KbDocument,
    titleField: 'title',
    publicPath: 'kb',
    cardLabel: '대화 자료',
    cardType: 'kb_document',
    extraMeta: (e) => ({ kb_id: e.id, source_type: e.source_type }),
  },
  calendar_event: {
    model: CalendarEvent,
    titleField: 'title',
    publicPath: 'calendar',
    cardLabel: '일정',
    cardType: 'calendar_event',
    extraMeta: (e) => ({ event_id: e.id, start_at: e.start_at, end_at: e.end_at }),
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/email', authenticateToken, async (req, res, next) => {
  try {
    const { entity_type, entity_id, to, message } = req.body || {};
    const cfg = ENTITY_CONFIG[entity_type];
    if (!cfg) return errorResponse(res, 'unsupported_entity_type', 400);
    if (!entity_id) return errorResponse(res, 'entity_id_required', 400);

    const recipients = Array.isArray(to)
      ? to
      : (typeof to === 'string' ? to.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []);
    if (recipients.length === 0) return errorResponse(res, 'to_required', 400);
    for (const e of recipients) {
      if (!EMAIL_RE.test(e)) return errorResponse(res, `invalid_email:${e}`, 400);
    }

    const entity = await cfg.model.findByPk(entity_id, {
      include: [{ model: Business, attributes: ['id', 'name', 'brand_name'], required: false }],
    });
    if (!entity) return errorResponse(res, 'not_found', 404);
    // soft-delete 체크 (file 만 deleted_at 컬럼)
    if (entity_type === 'file' && entity.deleted_at) return errorResponse(res, 'not_found', 404);

    const scope = await getUserScope(req.user.id, entity.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope) && entity.created_by !== req.user.id && entity.uploader_id !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }

    // share_token 자동 발급 (없으면)
    const r = await applyShareUpdate(entity, {});
    const shareUrl = `${APP_URL}/public/${cfg.publicPath}/${r.token}`;
    const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
    const workspace = entity.Business;
    const workspaceName = workspace ? (workspace.brand_name || workspace.name || '') : '';
    const entityTitle = String(entity[cfg.titleField] || '');

    const results = [];
    for (const email of recipients) {
      const ok = await sendEntityShareEmail({
        to: email,
        entityType: entity_type,
        entityTitle,
        senderName: sender?.name || '',
        workspaceName,
        message: message ? String(message).slice(0, 1000) : null,
        shareUrl,
        hasPassword: !!entity.share_password_hash,
      });
      results.push({ to: email, sent: ok });
    }
    return successResponse(res, { share_url: shareUrl, share_token: r.token, results });
  } catch (err) { next(err); }
});

// POST /api/share/chat
//   body: { entity_type, entity_id, conversation_id, message? }
//   대화방에 카드 메시지 전송. share_token 자동 발급.
//   응답: { share_url, share_token, message: { id } }
router.post('/chat', authenticateToken, async (req, res, next) => {
  try {
    const { entity_type, entity_id, conversation_id, message } = req.body || {};
    const cfg = ENTITY_CONFIG[entity_type];
    if (!cfg) return errorResponse(res, 'unsupported_entity_type', 400);
    if (!entity_id) return errorResponse(res, 'entity_id_required', 400);
    const convId = Number(conversation_id || 0);
    if (!convId) return errorResponse(res, 'conversation_id_required', 400);

    const entity = await cfg.model.findByPk(entity_id);
    if (!entity) return errorResponse(res, 'not_found', 404);
    if (entity_type === 'file' && entity.deleted_at) return errorResponse(res, 'not_found', 404);

    const scope = await getUserScope(req.user.id, entity.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope) && entity.created_by !== req.user.id && entity.uploader_id !== req.user.id) {
      return errorResponse(res, 'forbidden', 403);
    }

    // 대화방은 같은 워크스페이스여야 함
    const conv = await Conversation.findOne({ where: { id: convId, business_id: entity.business_id } });
    if (!conv) return errorResponse(res, 'invalid_conversation_id', 400);

    // share_token 자동 발급
    const r = await applyShareUpdate(entity, {});
    const shareUrl = `${APP_URL}/public/${cfg.publicPath}/${r.token}`;
    const entityTitle = String(entity[cfg.titleField] || '');
    const userMessage = message ? String(message).slice(0, 1000) : '';
    const fallbackContent = userMessage
      ? `[${cfg.cardLabel}] ${entityTitle} — ${userMessage}`
      : `[${cfg.cardLabel}] ${entityTitle}`;

    const msg = await Message.create({
      conversation_id: conv.id,
      sender_id: req.user.id,
      content: fallbackContent,
      kind: 'card',
      meta: {
        card_type: cfg.cardType,
        share_token: r.token,
        share_url: shareUrl,
        title: entityTitle,
        note: userMessage || null,
        has_password: !!entity.share_password_hash,
        ...cfg.extraMeta(entity),
      },
      is_ai: false,
      is_internal: false,
    });
    await conv.update({ last_message_at: new Date() });

    return successResponse(res, {
      share_url: shareUrl,
      share_token: r.token,
      message: { id: msg.id, conversation_id: conv.id },
    });
  } catch (err) { next(err); }
});

// GET /api/share/conversations?business_id=N
//   ShareModal 의 채팅방 탭에서 사용 — 워크스페이스의 대화방 목록.
//   카드 발송 가능한 대화방만 (참여중인 멤버).
router.get('/conversations', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id || 0);
    if (!businessId) return errorResponse(res, 'business_id_required', 400);

    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);

    const convs = await Conversation.findAll({
      where: { business_id: businessId, archived_at: null },
      attributes: ['id', 'title', 'last_message_at'],
      order: [['last_message_at', 'DESC']],
      limit: 50,
    });
    return successResponse(res, convs.map(c => ({
      id: c.id,
      title: c.title || `#${c.id}`,
      last_message_at: c.last_message_at,
    })));
  } catch (err) { next(err); }
});

module.exports = router;
