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
const { EmailThread, EmailMessage, EmailAttachment, EmailAccount, EmailThreadParticipant, Business, Client, Project, User, File } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');
const { sendMail } = require('../services/emailSend');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// 발송 rate-limit (CLAUDE.md 운영안정성 #1 — 외부발송=quota/비용 = per-user 제한).
// 답장·새메일·전달 공용. user.id 기준(IP NAT 우회), 10분 30건.
const emailSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `qmailsend-u${req.user.id}` : `qmailsend-ip${ipKeyGenerator(req)}`,
  message: { success: false, message: 'rate_limited_email_send' },
});

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
    // assigned/following 은 EmailThreadParticipant 조인 필요 → 리스트 라우트에서 thread_id 필터로 처리. 여기선 status 기준만.
    case 'assigned':
    case 'following': return { status: { [Op.in]: ['open', 'uncertain'] } };
    case 'uncertain': return { status: 'uncertain' };
    case 'spam': return { status: 'spam' };
    case 'archived': return { status: 'archived' };
    // N+83 — 자동·마케팅 폴더 (noreply 알림 + 뉴스레터 벌크). 인박스 노이즈 분리.
    case 'marketing': return { status: 'open', triage: { [Op.in]: ['automated', 'marketing'] } };
    case 'inbox':
    default:
      // 인박스 = open 이면서 자동/마케팅 아닌 것 (human·unknown). uncertain·spam 은 별도 폴더.
      return { status: 'open', triage: { [Op.notIn]: ['automated', 'marketing'] } };
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
      // assigned/following 폴더 — 본인 participant 가 달린 thread 로 제한
      if (folder === 'assigned' || folder === 'following') {
        const pcol = folder === 'assigned' ? 'is_assigned' : 'is_following';
        const parts = await EmailThreadParticipant.findAll({ where: { user_id: req.user.id, [pcol]: true }, attributes: ['thread_id'] });
        const tids = parts.map(p => p.thread_id);
        if (!tids.length) return paginatedResponse(res, [], 0, { limit, page, offset });
        where.id = { [Op.in]: tids };
      }
      if (client_id) where.client_id = Number(client_id);
      if (project_id) where.project_id = Number(project_id);
      if (String(unread) === 'true') where.unread_count = { [Op.gt]: 0 };
      if (String(starred) === 'true') where.is_starred = true;
      // 풀텍스트 — subject + last_message_preview + 메시지 본문(body_text)
      if (q && String(q).trim()) {
        const kw = String(q).trim().slice(0, 100);
        // 본문 매칭 thread id (접근 가능 계정 스코프 내) — 제목/미리보기에 없어도 내용으로 검색
        const [bodyRows] = await sequelize.query(
          'SELECT DISTINCT thread_id FROM email_messages WHERE business_id = :bid AND account_scope_match AND body_text LIKE :kw LIMIT 500'
            .replace('account_scope_match', 'thread_id IN (SELECT id FROM email_threads WHERE business_id = :bid AND account_id IN (:acctIds))'),
          { replacements: { bid: businessId, kw: `%${kw}%`, acctIds: acctIds.length ? acctIds : [0] } }
        );
        const bodyTids = bodyRows.map(r => r.thread_id);
        const orConds = [
          { subject: { [Op.like]: `%${kw}%` } },
          { last_message_preview: { [Op.like]: `%${kw}%` } },
        ];
        if (bodyTids.length) orConds.push({ id: { [Op.in]: bodyTids } });
        where[Op.or] = orConds;
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
          triage: obj.triage,
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

      // M3-B — 담당/팔로우 상태 (EmailThreadParticipant)
      const parts = await EmailThreadParticipant.findAll({
        where: { thread_id: id },
        include: [{ model: User, attributes: ['id', 'name'], required: false }],
      });
      const assignedP = parts.find(p => p.is_assigned);
      const myP = parts.find(p => p.user_id === req.user.id);

      const tj = thread.toJSON();
      return successResponse(res, {
        id: tj.id,
        subject: tj.subject,
        status: tj.status,
        reply_needed: tj.reply_needed,
        reply_needed_reason: tj.reply_needed_reason,
        uncertain_reason: tj.uncertain_reason,
        spam_score: tj.spam_score,
        triage: tj.triage,
        ai_summary: tj.ai_summary,
        ai_summary_at: tj.ai_summary_at,
        is_starred: tj.is_starred,
        unread_count: tj.unread_count || 0,
        message_count: tj.message_count || 0,
        labels: tj.labels || [],
        assignee_user_id: assignedP ? assignedP.user_id : null,
        assignee_name: assignedP && assignedP.User ? assignedP.User.name : null,
        my_following: !!(myP && myP.is_following),
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
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'), emailSendLimiter,
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

// ─────────────────────────────────────────────
// 새 메일 작성/발송 (compose) — 새 스레드 + outbound 메시지 + SMTP 발송
// POST /:biz/email-compose  body: { account_id, to[], cc?, bcc?, subject, body_html, attachment_file_ids? }
// ─────────────────────────────────────────────
router.post('/:businessId/email-compose',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'), emailSendLimiter,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { account_id, to, cc, bcc, subject, body_html, attachment_file_ids } = req.body || {};
      if (!body_html || !String(body_html).trim()) return errorResponse(res, 'body_required', 400);
      const toList = (Array.isArray(to) ? to : [to]).map(s => String(s || '').trim()).filter(Boolean);
      if (!toList.length) return errorResponse(res, 'recipient_required', 400);

      // 발신 계정 — 본인이 접근 가능한 계정만 (개인 메일 격리 동일 적용)
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const accId = Number(account_id);
      if (!acctIds.includes(accId)) return errorResponse(res, 'account_not_accessible', 403);
      const account = await EmailAccount.findOne({ where: { id: accId, business_id: businessId } });
      if (!account) return errorResponse(res, 'account_not_found', 404);

      const { atts, files } = await resolveAttachments(attachment_file_ids, businessId);
      const subj = String(subject || '').trim() || '(제목 없음)';

      let sendResult;
      try {
        sendResult = await sendMail(account, { to: toList, cc, bcc, subject: subj, html: body_html, attachments: atts });
      } catch (e) {
        console.error('[qmail] compose send failed:', e.message);
        return errorResponse(res, `send_failed: ${e.message}`, 502);
      }

      const now = new Date();
      const preview = htmlToPreview(body_html);
      const thread = await EmailThread.create({
        business_id: businessId, account_id: accId, subject: subj, status: 'open',
        reply_needed: false, message_count: 1, unread_count: 0,
        last_message_at: now, last_message_direction: 'outbound', last_message_preview: preview,
      });
      const outMsg = await EmailMessage.create({
        thread_id: thread.id, business_id: businessId, direction: 'outbound',
        message_id: sendResult.messageId || `<planq-compose-${thread.id}-${now.getTime()}@planq>`,
        from_email: account.email, from_name: account.display_name || null,
        to_emails: toList,
        cc_emails: (Array.isArray(cc) && cc.length) ? cc : null,
        bcc_emails: (Array.isArray(bcc) && bcc.length) ? bcc : null,
        subject: subj, body_html, body_text: preview,
        sent_by_user_id: req.user.id, is_read: true, delivery_status: 'sent', sent_at: now,
      });
      for (const f of files) {
        await EmailAttachment.create({ message_id: outMsg.id, file_id: f.id, filename: f.file_name, mime_type: f.mime_type || null, size_bytes: f.file_size || null });
      }
      broadcastMail(req, businessId, 'mail:new', { thread_id: thread.id });
      return successResponse(res, { id: thread.id, thread_id: thread.id, rejected: sendResult.rejected }, 'sent', 201);
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// M3-C — AI 답변 제안 (Cue) — 마지막 inbound + 비즈니스 컨텍스트 → 답장 초안
// POST /:biz/email-threads/:id/ai-suggest → { suggestion(html), usage }
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/ai-suggest',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({ where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } } });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);

      const msgs = await EmailMessage.findAll({ where: { thread_id: threadId, business_id: businessId }, order: [['sent_at', 'ASC'], ['id', 'ASC']] });
      const lastInbound = [...msgs].reverse().find(m => m.direction === 'inbound');
      if (!lastInbound) return errorResponse(res, 'no_inbound_message', 400);

      // 본문 텍스트 확보 (body_text 우선, 없으면 body_html strip — AI 입력용 4000자)
      const stripped = lastInbound.body_text
        || String(lastInbound.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const latestInboundText = (stripped || '').slice(0, 4000);
      if (!latestInboundText) return errorResponse(res, 'empty_inbound', 400);

      const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name', 'default_language'] });
      const language = (req.body || {}).language || biz?.default_language || 'ko';

      // M4 — 등록된 FAQ 활용: 들어온 질문과 강하게 매칭되는 FAQ(KbDocument category=faq)를
      //   AI 답변의 권위 있는 근거로 주입 → "다음 같은 질문 자동답변" 가치 실현. (raw cosine ≥ 0.80)
      let faqContext = null; let faqSources = [];
      try {
        const kbService = require('../services/kb_service');
        const search = await kbService.hybridSearch(businessId, latestInboundText, { category: 'faq', limit: 3 });
        // text-embedding-3-small(한국어) 기준 — genuine 매칭 ~0.6+, 비매칭 ~0.5↓. 0.55 로 분리.
        //   주입해도 LLM 이 "질문과 매칭될 때만 사용" 지시 받으므로 borderline 도 안전(날조 금지 유지).
        const strong = (search.kb_chunks || []).filter(c => (c.raw_score || 0) >= 0.55);
        if (strong.length) {
          faqContext = strong.map(c => `- ${c.document_title}: ${c.snippet}`).join('\n');
          faqSources = [...new Set(strong.map(c => c.document_title).filter(Boolean))];
        }
      } catch { /* FAQ 활용은 선택 — 실패해도 일반 초안 생성 */ }

      const cueOrch = require('../services/cue_orchestrator');
      const out = await cueOrch.generateEmailReplyDraft(businessId, {
        businessName: (biz && (biz.brand_name || biz.name)) || null,
        subject: thread.subject,
        latestInboundText,
        language,
        faqContext,
      });
      if (out.error === 'usage_limit_exceeded') return errorResponse(res, 'cue_usage_limit_exceeded', 429);
      if (out.error === 'llm_unavailable') return errorResponse(res, 'ai_unavailable', 503);

      // 텍스트 → 안전한 HTML (문단/줄바꿈)
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = (out.content || '').trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

      return successResponse(res, { suggestion: html, usage: out.usage, faq_used: faqSources.length > 0, faq_sources: faqSources });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// M3-B — PUT thread (스타/라벨/보관/연결) · assign · follow · email-labels CRUD
// ─────────────────────────────────────────────

// PUT /:biz/email-threads/:id — 부분 수정 (is_starred / labels / status(archive) / client_id / project_id)
router.put('/:businessId/email-threads/:id',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const b = req.body || {};
      const patch = {};
      if (typeof b.is_starred === 'boolean') patch.is_starred = b.is_starred;
      if (Array.isArray(b.labels)) patch.labels = b.labels.map(s => String(s).slice(0, 50)).filter(Boolean).slice(0, 20);
      if (b.status && ['open', 'archived'].includes(b.status)) patch.status = b.status;
      if ('client_id' in b) patch.client_id = b.client_id ? Number(b.client_id) : null;
      if ('project_id' in b) patch.project_id = b.project_id ? Number(b.project_id) : null;
      if (!Object.keys(patch).length) return errorResponse(res, 'no_fields', 400);
      await thread.update(patch);
      broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, ...patch });
      return successResponse(res, { id: thread.id, ...patch });
    } catch (err) { next(err); }
  }
);

// POST /:biz/email-threads/:id/assign — body { user_id|null } (담당자 1명, EmailThreadParticipant.is_assigned)
router.post('/:businessId/email-threads/:id/assign',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({ where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } } });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const userId = (req.body || {}).user_id ? Number(req.body.user_id) : null;
      // 다른 담당 해제 (담당자 1명 정책)
      await EmailThreadParticipant.update({ is_assigned: false }, { where: { thread_id: threadId, is_assigned: true } });
      if (userId) {
        const [p] = await EmailThreadParticipant.findOrCreate({ where: { thread_id: threadId, user_id: userId }, defaults: { thread_id: threadId, user_id: userId } });
        await p.update({ is_assigned: true });
      }
      broadcastMail(req, businessId, 'mail:updated', { thread_id: threadId, assignee_user_id: userId });
      return successResponse(res, { thread_id: threadId, assignee_user_id: userId });
    } catch (err) { next(err); }
  }
);

// POST /:biz/email-threads/:id/follow — body { follow: bool } (본인 팔로우)
router.post('/:businessId/email-threads/:id/follow',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({ where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } } });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const follow = !!(req.body || {}).follow;
      const [p] = await EmailThreadParticipant.findOrCreate({ where: { thread_id: threadId, user_id: req.user.id }, defaults: { thread_id: threadId, user_id: req.user.id } });
      await p.update({ is_following: follow });
      return successResponse(res, { thread_id: threadId, is_following: follow });
    } catch (err) { next(err); }
  }
);

// ─── 라벨 마스터 (businesses.email_labels JSON — 별도 테이블 X) ───
router.get('/:businessId/email-labels',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const biz = await Business.findByPk(req.params.businessId, { attributes: ['id', 'email_labels'] });
      return successResponse(res, (biz && biz.email_labels) || []);
    } catch (err) { next(err); }
  }
);

router.post('/:businessId/email-labels',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const { name, color } = req.body || {};
      const nm = String(name || '').trim().slice(0, 50);
      if (!nm) return errorResponse(res, 'name_required', 400);
      const biz = await Business.findByPk(req.params.businessId);
      const labels = Array.isArray(biz.email_labels) ? [...biz.email_labels] : [];
      if (labels.some(l => l.name === nm)) return errorResponse(res, 'duplicate', 409);
      labels.push({ name: nm, color: /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#14B8A6' });
      await biz.update({ email_labels: labels });
      return successResponse(res, labels, 'created', 201);
    } catch (err) { next(err); }
  }
);

router.put('/:businessId/email-labels/:name',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const oldName = decodeURIComponent(req.params.name);
      const { newName, color } = req.body || {};
      const biz = await Business.findByPk(req.params.businessId);
      const labels = Array.isArray(biz.email_labels) ? [...biz.email_labels] : [];
      const idx = labels.findIndex(l => l.name === oldName);
      if (idx < 0) return errorResponse(res, 'not_found', 404);
      const nm = newName ? String(newName).trim().slice(0, 50) : oldName;
      if (nm !== oldName && labels.some(l => l.name === nm)) return errorResponse(res, 'duplicate', 409);
      labels[idx] = { name: nm, color: /^#[0-9A-Fa-f]{6}$/.test(color) ? color : labels[idx].color };
      await biz.update({ email_labels: labels });
      return successResponse(res, labels);
    } catch (err) { next(err); }
  }
);

router.delete('/:businessId/email-labels/:name',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const name = decodeURIComponent(req.params.name);
      const biz = await Business.findByPk(req.params.businessId);
      const labels = Array.isArray(biz.email_labels) ? biz.email_labels.filter(l => l.name !== name) : [];
      await biz.update({ email_labels: labels });
      return successResponse(res, labels, 'deleted');
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────
// Q Mail M4 — FAQ 자동 클러스터링 제안 (사이클 N+80)
//   cron(emailFaqCluster) 이 만든 EmailFaqSuggestion(pending) 을 노출 → 등록(KbDocument FAQ)/무시.
// ─────────────────────────────────────────────────────────
const { EmailFaqSuggestion, KbDocument } = require('../models');

router.get('/:businessId/email-faq-suggestions',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const rows = await EmailFaqSuggestion.findAll({
        where: { business_id: businessId, status: 'pending' },
        order: [['occurrence_count', 'DESC'], ['updated_at', 'DESC']],
        limit: 50,
      });
      return successResponse(res, rows.map((r) => r.toJSON()));
    } catch (err) { next(err); }
  }
);

router.post('/:businessId/email-faq-suggestions/:id/accept',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sug = await EmailFaqSuggestion.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
      if (!sug) return errorResponse(res, 'not_found', 404);
      if (sug.status === 'accepted' && sug.kb_document_id) return successResponse(res, sug.toJSON()); // 멱등
      const doc = await KbDocument.create({
        business_id: businessId,
        title: String(sug.question).slice(0, 300),
        body: `Q. ${sug.question}\n\nA. ${sug.answer}`,
        source_type: 'faq',
        category: 'faq',
        vlevel: 'L3',
        uploaded_by: req.user.id,
        status: 'pending',
      });
      require('../services/kb_service').indexDocument(doc.id).catch((e) => console.error('[m4-faq] index', e.message));
      await sug.update({ status: 'accepted', kb_document_id: doc.id, created_by: req.user.id });
      return successResponse(res, { ...sug.toJSON(), status: 'accepted', kb_document_id: doc.id });
    } catch (err) { next(err); }
  }
);

router.post('/:businessId/email-faq-suggestions/:id/dismiss',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sug = await EmailFaqSuggestion.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
      if (!sug) return errorResponse(res, 'not_found', 404);
      await sug.update({ status: 'dismissed' });
      return successResponse(res, sug.toJSON());
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────
// Q Mail Phase B (N+87) — 메일 스레드에서 업무 추출 → Q Task 통합
//   task_extractor 파이프라인 재사용. 후보는 task_candidates(email_thread_id 스코프).
// ─────────────────────────────────────────────────────────
const { TaskCandidate } = require('../models');

// 스레드 소유권(접근) 검증 헬퍼
async function accessibleThread(req) {
  const businessId = Number(req.params.businessId);
  const acctIds = await accessibleAccountIds(businessId, req.user.id);
  return EmailThread.findOne({ where: { id: Number(req.params.id), business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } } });
}

// POST extract-tasks — 이 스레드에서 업무 후보 추출
router.post('/:businessId/email-threads/:id/extract-tasks',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const extractor = require('../services/task_extractor');
      const out = await extractor.extractEmailTaskCandidates({ emailThreadId: thread.id, userId: req.user.id, businessId });
      if (out.skipped === 'usage_limit_exceeded') return errorResponse(res, 'cue_usage_limit_exceeded', 429);
      if ((out.candidates || []).length) {
        broadcastMail(req, businessId, 'email_candidate:created', { thread_id: thread.id, count: out.candidates.length });
      }
      return successResponse(res, { candidates: out.candidates || [], message_count: out.message_count || 0, reason: out.reason || null });
    } catch (err) {
      if (err.message === 'thread_not_found') return errorResponse(res, 'thread_not_found', 404);
      next(err);
    }
  }
);

// GET task-candidates — 이 스레드의 pending 후보
router.get('/:businessId/email-threads/:id/task-candidates',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const rows = await TaskCandidate.findAll({
        where: { email_thread_id: thread.id, status: 'pending' },
        include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'], required: false }],
        order: [['id', 'DESC']],
      });
      const items = rows.map((r) => r.toJSON());
      await applyMemberDisplayName(items, thread.business_id, ['guessedAssignee']);
      return successResponse(res, items);
    } catch (err) { next(err); }
  }
);

// POST register — 후보 → 정식 업무 (overrides: title/assignee_id/due_date/description)
router.post('/:businessId/email-threads/:id/task-candidates/:cid/register',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const cand = await TaskCandidate.findOne({ where: { id: Number(req.params.cid), email_thread_id: thread.id } });
      if (!cand) return errorResponse(res, 'candidate_not_found', 404);
      const extractor = require('../services/task_extractor');
      const out = await extractor.registerCandidate(cand.id, req.user.id, req.body || {});
      // Q Task 실시간 — task:new 브로드캐스트 (CLAUDE.md §16)
      broadcastMail(req, businessId, 'task:new', out.task);
      return successResponse(res, out, 'registered', 201);
    } catch (err) {
      if (/candidate_(not_found|already_resolved)/.test(err.message)) return errorResponse(res, err.message, 400);
      next(err);
    }
  }
);

// POST reject — 후보 무시
router.post('/:businessId/email-threads/:id/task-candidates/:cid/reject',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const cand = await TaskCandidate.findOne({ where: { id: Number(req.params.cid), email_thread_id: thread.id } });
      if (!cand) return errorResponse(res, 'candidate_not_found', 404);
      const extractor = require('../services/task_extractor');
      await extractor.rejectCandidate(cand.id, req.user.id);
      return successResponse(res, { id: cand.id, status: 'rejected' });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────
// Q Mail Phase C (N+87) — 요약 / 이슈 / 노트 (Q Talk 우측 패널 패리티)
// ─────────────────────────────────────────────────────────
const { ProjectIssue, ProjectNote } = require('../models');

// POST summarize — 스레드 AI 요약 (on-demand)
router.post('/:businessId/email-threads/:id/summarize',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const msgs = await EmailMessage.findAll({
        where: { thread_id: thread.id, business_id: businessId },
        order: [['sent_at', 'ASC'], ['id', 'ASC']],
        attributes: ['from_name', 'from_email', 'direction', 'subject', 'body_text'],
      });
      if (!msgs.length) return errorResponse(res, 'no_messages', 400);
      const threadText = msgs.map((m) => {
        const who = m.direction === 'outbound' ? '우리 팀' : (m.from_name || m.from_email || '상대');
        return `${who}: ${(m.body_text || m.subject || '').replace(/\s+/g, ' ').trim().slice(0, 2000)}`;
      }).join('\n\n');
      const biz = await Business.findByPk(businessId, { attributes: ['default_language'] });
      const language = (req.body || {}).language || biz?.default_language || 'ko';
      const cueOrch = require('../services/cue_orchestrator');
      const out = await cueOrch.summarizeThread(businessId, { subject: thread.subject, threadText, language });
      if (out.error === 'usage_limit_exceeded') return errorResponse(res, 'cue_usage_limit_exceeded', 429);
      if (out.error === 'llm_unavailable') return errorResponse(res, 'ai_unavailable', 503);
      const now = new Date();
      await thread.update({ ai_summary: out.content, ai_summary_at: now, ai_summary_model: 'gpt-4o-mini' });
      broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, ai_summary: out.content, ai_summary_at: now });
      return successResponse(res, { ai_summary: out.content, ai_summary_at: now });
    } catch (err) { next(err); }
  }
);

// ─── 이슈 (project_issues, email_thread_id 스코프) ───
router.get('/:businessId/email-threads/:id/issues',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const rows = await ProjectIssue.findAll({ where: { email_thread_id: thread.id }, order: [['id', 'DESC']] });
      return successResponse(res, rows.map((r) => r.toJSON()));
    } catch (err) { next(err); }
  }
);
router.post('/:businessId/email-threads/:id/issues',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const body = String((req.body || {}).body || '').trim();
      if (!body) return errorResponse(res, 'body_required', 400);
      const issue = await ProjectIssue.create({
        project_id: thread.project_id || null, conversation_id: null, email_thread_id: thread.id,
        body: body.slice(0, 5000), author_user_id: req.user.id,
      });
      broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, issue_added: true });
      return successResponse(res, issue.toJSON(), 'created', 201);
    } catch (err) { next(err); }
  }
);
router.delete('/:businessId/email-threads/:id/issues/:issueId',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const issue = await ProjectIssue.findOne({ where: { id: Number(req.params.issueId), email_thread_id: thread.id } });
      if (!issue) return errorResponse(res, 'not_found', 404);
      await issue.destroy();
      return successResponse(res, { id: issue.id, deleted: true });
    } catch (err) { next(err); }
  }
);

// ─── 노트 (project_notes, email_thread_id 스코프, visibility) ───
router.get('/:businessId/email-threads/:id/notes',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      // personal 은 본인 것만. internal/shared 는 멤버 모두.
      const rows = await ProjectNote.findAll({
        where: { email_thread_id: thread.id, [Op.or]: [{ visibility: { [Op.ne]: 'personal' } }, { author_user_id: req.user.id }] },
        order: [['id', 'ASC']],
      });
      return successResponse(res, rows.map((r) => r.toJSON()));
    } catch (err) { next(err); }
  }
);
router.post('/:businessId/email-threads/:id/notes',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const b = req.body || {};
      const body = String(b.body || '').trim();
      if (!body) return errorResponse(res, 'body_required', 400);
      const visibility = ['personal', 'internal', 'shared'].includes(b.visibility) ? b.visibility : 'internal';
      const note = await ProjectNote.create({
        project_id: thread.project_id || null, conversation_id: null, email_thread_id: thread.id,
        author_user_id: req.user.id, visibility, body: body.slice(0, 5000),
      });
      if (visibility !== 'personal') broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, note_added: true });
      return successResponse(res, note.toJSON(), 'created', 201);
    } catch (err) { next(err); }
  }
);
router.delete('/:businessId/email-threads/:id/notes/:noteId',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const thread = await accessibleThread(req);
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const note = await ProjectNote.findOne({ where: { id: Number(req.params.noteId), email_thread_id: thread.id } });
      if (!note) return errorResponse(res, 'not_found', 404);
      if (note.author_user_id !== req.user.id) return errorResponse(res, 'only_author', 403);
      await note.destroy();
      return successResponse(res, { id: note.id, deleted: true });
    } catch (err) { next(err); }
  }
);

module.exports = router;
