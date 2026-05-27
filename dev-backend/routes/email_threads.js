// Q Mail M2 — 인박스 read-only API (사이클 N+75-D 박제)
//
// 라우트:
//   GET    /api/businesses/:bizId/email-threads                 list (필터: folder/account/unread/q/...)
//   GET    /api/businesses/:bizId/email-threads/:id             detail (모든 message + read 마킹)
//   POST   /api/businesses/:bizId/email-threads/:id/mark-read   읽음 처리
//   POST   /api/businesses/:bizId/email-threads/:id/mark-spam   스팸 마킹 (status='spam')
//   POST   /api/businesses/:bizId/email-threads/:id/mark-not-spam  스팸 해제 (→ 'open')
//
// 권한: requireMenu('qmail', 'read'). 멀티테넌트 — 모든 query 에 business_id 강제.
// 응답 표준 (CLAUDE.md): { success, data, pagination? }

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread, EmailMessage, EmailAttachment, EmailAccount, Client, Project, User, File } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');

// 폴더 → where 매핑 (Q_MAIL_SPEC §4.1 폴더 트리 정합)
function folderWhere(folder, userId) {
  switch (folder) {
    case 'reply_needed': return { reply_needed: true, status: { [Op.in]: ['open', 'uncertain'] } };
    case 'assigned': return { assignee_user_id: userId, status: 'open' };
    case 'following': return { status: 'open' };  // EmailThreadFollower 별도 모델 — M3 (skip)
    case 'uncertain': return { status: 'uncertain' };
    case 'spam': return { status: 'spam' };
    case 'archived': return { status: 'archived' };
    case 'inbox':
    default: return { status: { [Op.in]: ['open', 'uncertain'] } };  // 일반 인박스 = open + uncertain
  }
}

// ─────────────────────────────────────────────
// GET list — 인박스 / 폴더별
// ─────────────────────────────────────────────
router.get('/:businessId/email-threads',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { folder, account_id, client_id, project_id, unread, starred, q } = req.query;
      const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

      const where = {
        business_id: businessId,
        ...folderWhere(folder, req.user.id),
      };
      if (account_id) where.account_id = Number(account_id);
      if (client_id) where.client_id = Number(client_id);
      if (project_id) where.project_id = Number(project_id);
      if (String(unread) === 'true') where.unread_count = { [Op.gt]: 0 };
      if (String(starred) === 'true') where.is_starred = true;
      // 풀텍스트 — subject + last_message_preview
      if (q && String(q).trim()) {
        const kw = String(q).trim().slice(0, 100);
        where[Op.or] = [
          { subject: { [Op.like]: `%${kw}%` } },
          { last_message_preview: { [Op.like]: `%${kw}%` } },
        ];
      }

      const { rows, count } = await EmailThread.findAndCountAll({
        where,
        include: [
          { model: EmailAccount, attributes: ['id', 'email', 'display_name'], required: false },
          { model: Client, attributes: ['id', 'display_name', 'company_name'], required: false },
          { model: Project, attributes: ['id', 'name', 'color'], required: false },
        ],
        order: [['last_message_at', 'DESC']],
        limit, offset,
        distinct: true,
      });

      const data = rows.map(t => {
        const obj = t.toJSON();
        return {
          id: obj.id,
          subject: obj.subject,
          last_message_preview: obj.last_message_preview,
          last_message_at: obj.last_message_at,
          status: obj.status,
          reply_needed: obj.reply_needed,
          reply_needed_reason: obj.reply_needed_reason,
          is_starred: obj.is_starred,
          unread_count: obj.unread_count || 0,
          message_count: obj.message_count || 0,
          labels: obj.labels || [],
          account: obj.EmailAccount,
          client: obj.Client,
          project: obj.Project,
          uncertain_reason: obj.uncertain_reason,
          spam_score: obj.spam_score,
        };
      });

      return paginatedResponse(res, data, count, { limit, page, offset });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// GET detail — 스레드의 모든 message + 첨부
// ─────────────────────────────────────────────
router.get('/:businessId/email-threads/:id',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const id = Number(req.params.id);

      const thread = await EmailThread.findOne({
        where: { id, business_id: businessId },
        include: [
          { model: EmailAccount, attributes: ['id', 'email', 'display_name'], required: false },
          { model: Client, attributes: ['id', 'display_name', 'company_name', 'invite_email'], required: false },
          { model: Project, attributes: ['id', 'name', 'color'], required: false },
        ],
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);

      const messages = await EmailMessage.findAll({
        where: { thread_id: id, business_id: businessId },
        include: [{
          model: EmailAttachment,
          as: 'attachments',
          required: false,
        }],
        order: [['sent_at', 'ASC'], ['id', 'ASC']],
      });

      const tj = thread.toJSON();
      return successResponse(res, {
        id: tj.id,
        subject: tj.subject,
        status: tj.status,
        reply_needed: tj.reply_needed,
        reply_needed_reason: tj.reply_needed_reason,
        uncertain_reason: tj.uncertain_reason,
        spam_score: tj.spam_score,
        is_starred: tj.is_starred,
        unread_count: tj.unread_count || 0,
        message_count: tj.message_count || 0,
        labels: tj.labels || [],
        last_message_at: tj.last_message_at,
        account: tj.EmailAccount,
        client: tj.Client,
        project: tj.Project,
        messages: messages.map(m => {
          const mj = m.toJSON();
          return {
            id: mj.id,
            direction: mj.direction,
            from_email: mj.from_email,
            from_name: mj.from_name,
            to_emails: mj.to_emails,
            cc_emails: mj.cc_emails,
            subject: mj.subject,
            body_html: mj.body_html,
            body_text: mj.body_text,
            sent_at: mj.sent_at,
            is_read: mj.is_read,
            attachments: (mj.attachments || []).map(a => ({
              id: a.id,
              file_name: a.file_name,
              file_size: a.file_size,
              mime_type: a.mime_type,
            })),
          };
        }),
      });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// POST mark-read — 스레드 unread_count → 0
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/mark-read',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      if (thread.unread_count > 0) {
        await thread.update({ unread_count: 0 });
        // EmailMessage 의 is_read 도 같이 갱신
        await EmailMessage.update(
          { is_read: true },
          { where: { thread_id: thread.id, is_read: false } }
        );
      }
      return successResponse(res, { id: thread.id, unread_count: 0 });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// POST mark-spam — 스레드 status='spam'
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/mark-spam',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      await thread.update({ status: 'spam' });
      return successResponse(res, { id: thread.id, status: 'spam' });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// POST mark-not-spam — 스레드 status='open'
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/mark-not-spam',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      if (thread.status !== 'spam') return errorResponse(res, 'not_spam', 400);
      await thread.update({ status: 'open' });
      return successResponse(res, { id: thread.id, status: 'open' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
