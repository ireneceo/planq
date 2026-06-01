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
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread, EmailMessage, EmailAttachment, EmailAccount, Client, Project, User, File } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { sendMail } = require('../services/emailSend');

// HTML → 미리보기 텍스트 (480자) — 스레드 last_message_preview / body_text 용
function htmlToPreview(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);
}

// 실시간 broadcast (CLAUDE.md 16번 — 모든 mutation 라우트 필수)
function broadcastMail(req, businessId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit(event, payload);
}

// attachment_file_ids → nodemailer attachments + 검증된 File rows (멀티테넌트 + 물리 존재)
async function resolveAttachments(fileIds, businessId) {
  if (!Array.isArray(fileIds) || !fileIds.length) return { atts: [], files: [] };
  const files = await File.findAll({
    where: { id: { [Op.in]: fileIds.map(Number) }, business_id: businessId, deleted_at: null },
  });
  const atts = files
    .map(f => {
      const abs = path.isAbsolute(f.file_path) ? f.file_path : path.join(__dirname, '..', f.file_path);
      return { filename: f.file_name, path: abs, contentType: f.mime_type || undefined, _exists: fs.existsSync(abs) };
    })
    .filter(a => a._exists)
    .map(({ _exists, ...a }) => a);
  return { atts, files };
}

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

// 프라이버시 격리 (외부 연동 Phase 3) — 이 사용자가 볼 수 있는 메일 계정 id 집합:
//   회사 공용 계정 (owner_user_id NULL, 모든 멤버) + 본인 개인 계정 (owner_user_id = 나).
//   다른 사람의 개인 메일은 절대 노출 X (admin 도 차단 — 개인정보 보호).
async function accessibleAccountIds(businessId, userId) {
  const accts = await EmailAccount.findAll({
    where: { business_id: businessId, [Op.or]: [{ owner_user_id: null }, { owner_user_id: userId }] },
    attributes: ['id'],
  });
  return accts.map(a => a.id);
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
      // 프라이버시 격리 — 접근 가능한 계정으로만 제한 (개인 메일 격리)
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      if (!acctIds.length) return paginatedResponse(res, [], 0, { limit, page, offset });
      if (account_id) {
        const reqId = Number(account_id);
        if (!acctIds.includes(reqId)) return paginatedResponse(res, [], 0, { limit, page, offset });
        where.account_id = reqId;
      } else {
        where.account_id = { [Op.in]: acctIds };
      }
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
// GET mail-accounts — 폴더트리용 접근 가능 계정 (회사 공용 + 본인 개인) + 계정별 unread
//   :id 충돌 방지 위해 별도 literal 경로 사용 (express literal 우선)
// ─────────────────────────────────────────────
router.get('/:businessId/mail-accounts',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const accts = await EmailAccount.findAll({
        where: {
          business_id: businessId, is_active: true,
          [Op.or]: [{ owner_user_id: null }, { owner_user_id: req.user.id }],
        },
        attributes: ['id', 'email', 'display_name', 'owner_user_id'],
        order: [['owner_user_id', 'ASC'], ['created_at', 'ASC']],
      });
      const ids = accts.map(a => a.id);
      const unreadMap = {};
      if (ids.length) {
        const rows = await EmailThread.findAll({
          where: { business_id: businessId, account_id: { [Op.in]: ids } },
          attributes: ['account_id', [sequelize.fn('SUM', sequelize.col('unread_count')), 'unread']],
          group: ['account_id'],
        });
        rows.forEach(r => { unreadMap[r.account_id] = Number(r.get('unread')) || 0; });
      }
      const data = accts.map(a => ({
        id: a.id,
        email: a.email,
        display_name: a.display_name,
        is_personal: a.owner_user_id != null,
        unread: unreadMap[a.id] || 0,
      }));
      return successResponse(res, data);
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

      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({
        where: { id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
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
      const acctIds = await accessibleAccountIds(Number(req.params.businessId), req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
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
      const acctIds = await accessibleAccountIds(Number(req.params.businessId), req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
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
      const acctIds = await accessibleAccountIds(Number(req.params.businessId), req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: req.params.businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      if (thread.status !== 'spam') return errorResponse(res, 'not_spam', 400);
      await thread.update({ status: 'open' });
      return successResponse(res, { id: thread.id, status: 'open' });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// POST 답장 — outbound 메시지 발송 + 스레드 갱신 + reply_needed 해제 + broadcast
//   body: { body_html, to?, cc?, bcc?, attachment_file_ids? }
//   to 미지정 시 마지막 inbound 발신자에게 자동 답장
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/messages',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const { body_html, to, cc, bcc, attachment_file_ids } = req.body || {};
      if (!body_html || !String(body_html).trim()) return errorResponse(res, 'body_required', 400);

      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);

      const account = await EmailAccount.findOne({ where: { id: thread.account_id, business_id: businessId } });
      if (!account) return errorResponse(res, 'account_not_found', 404);

      // 스레드 메시지 — 스레딩 헤더 + 답장 수신자 결정
      const msgs = await EmailMessage.findAll({
        where: { thread_id: threadId, business_id: businessId },
        order: [['sent_at', 'ASC'], ['id', 'ASC']],
      });
      const lastInbound = [...msgs].reverse().find(m => m.direction === 'inbound');
      const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;

      // 수신자: 명시 to 우선, 없으면 마지막 inbound 발신자
      let toList = (Array.isArray(to) && to.length) ? to : (lastInbound ? [lastInbound.from_email] : []);
      toList = toList.map(s => String(s || '').trim()).filter(Boolean);
      if (!toList.length) return errorResponse(res, 'recipient_required', 400);

      // 제목: Re: 접두 (이미 있으면 그대로)
      const baseSubject = (thread.subject || (lastMsg && lastMsg.subject) || '').trim();
      const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`.trim();

      // RFC 스레딩 헤더
      const inReplyTo = lastMsg ? lastMsg.message_id : null;
      const references = msgs.map(m => m.message_id).filter(Boolean);

      const { atts, files } = await resolveAttachments(attachment_file_ids, businessId);

      // 발송 (실패 시 502 — outbound row 안 만듦. 프론트는 작성 내용 유지)
      let sendResult;
      try {
        sendResult = await sendMail(account, {
          to: toList, cc, bcc, subject, html: body_html,
          inReplyTo, references, attachments: atts,
        });
      } catch (e) {
        console.error('[qmail] reply send failed:', e.message);
        return errorResponse(res, `send_failed: ${e.message}`, 502);
      }

      const now = new Date();
      const preview = htmlToPreview(body_html);

      const outMsg = await EmailMessage.create({
        thread_id: threadId,
        business_id: businessId,
        direction: 'outbound',
        message_id: sendResult.messageId || `<planq-${threadId}-${now.getTime()}@planq>`,
        in_reply_to: inReplyTo,
        references_chain: references.join(' ') || null,
        from_email: account.email,
        from_name: account.display_name || null,
        to_emails: toList,
        cc_emails: (Array.isArray(cc) && cc.length) ? cc : null,
        bcc_emails: (Array.isArray(bcc) && bcc.length) ? bcc : null,
        subject,
        body_html,
        body_text: preview,
        sent_by_user_id: req.user.id,
        is_read: true,
        delivery_status: 'sent',
        sent_at: now,
      });

      for (const f of files) {
        await EmailAttachment.create({
          message_id: outMsg.id,
          file_id: f.id,
          filename: f.file_name,
          mime_type: f.mime_type || null,
          size_bytes: f.file_size || null,
        });
      }

      // 답장 했으니 reply_needed 해제 + uncertain → open
      await thread.update({
        reply_needed: false,
        reply_needed_reason: null,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_preview: preview,
        message_count: (thread.message_count || 0) + 1,
        ...(thread.status === 'uncertain' ? { status: 'open' } : {}),
      });

      broadcastMail(req, businessId, 'mail:updated', {
        thread_id: threadId,
        reply_needed: false,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_preview: preview,
      });

      return successResponse(res, {
        id: outMsg.id,
        thread_id: threadId,
        direction: 'outbound',
        message_id: outMsg.message_id,
        delivery_status: 'sent',
        sent_at: now,
        rejected: sendResult.rejected,
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;
