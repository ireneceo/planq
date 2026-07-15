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
const { EmailThread, EmailMessage, EmailAttachment, EmailAccount, EmailThreadParticipant, Business, Client, Project, User, File, EmailDraft } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName, getMemberNameMap } = require('../services/displayName');
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
  keyGenerator: (req) => req.user?.id ? `qmailsend-u${req.user.id}` : `qmailsend-ip${ipKeyGenerator(req.ip)}`,
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
    // 확인 권장 = "한 번 보고 판단할 것" — 처리 완료(옛 inbox)를 여기에 합쳤다.
    //   ① 애매한 메일 (status='uncertain'): 스팸·광고는 아닌데 업무인지 모르겠는 것,
    //      그리고 자동 발송이지만 내용이 업무인 것(결제 완료·보고서·시스템 업무 안내)
    //   ② 답변이 끝난 사람 메일 (답장했거나 "답변 완료" 로 넘긴 것)
    //   두 개가 사실상 같은 성격("답장할 건 아닌데 봐야 하는 것")이라 탭을 나눌 이유가 없다 (Irene).
    case 'uncertain':
    case 'inbox':
      return {
        [Op.or]: [
          { status: 'uncertain' },
          { status: 'open', reply_needed: false, triage: { [Op.notIn]: ['automated', 'marketing'] } },
        ],
      };
    case 'spam': return { status: 'spam' };
    case 'archived': return { status: 'archived' };
    // 자동·마케팅 — 광고·뉴스레터·기계 알림. 단, 내용이 업무라 확인 권장으로 올라간 건 제외
    //   (같은 메일이 두 폴더에 겹쳐 보이면 어느 쪽이 진짜인지 알 수 없다).
    case 'marketing': return { status: 'open', triage: { [Op.in]: ['automated', 'marketing'] } };
    // 전체 — 스팸·보관 뺀 모든 메일 (자동·마케팅 포함). "다 어디 갔지" 를 없애는 안전망.
    case 'all': return { status: { [Op.notIn]: ['spam', 'archived'] } };
    default:
      return { status: { [Op.notIn]: ['spam', 'archived'] } };
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
      const { folder, account_id, client_id, project_id, label, unread, starred, q } = req.query;
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
      // 라벨(태그) 필터 — labels 는 JSON 배열. 사용자 입력이라 이스케이프 후 JSON_CONTAINS.
      if (label && String(label).trim()) {
        const lb = String(label).trim().slice(0, 50);
        where[Op.and] = [
          ...(where[Op.and] || []),
          sequelize.literal(`JSON_CONTAINS(\`labels\`, ${sequelize.escape(JSON.stringify(lb))})`),
        ];
      }
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

      // 상대방(발신자) — 목록의 "보낸 사람" 자리.
      //   여태 이 값을 안 내려줘서 프론트가 내 메일함 이름(account.display_name)을 발신자로 그렸다
      //   → PlanQ 가 보낸 알림이 Q Mail 안에서만 "IRENE WP"(내 계정명)로 보였다.
      //   발신자가 헤더에 넣은 이름은 email_messages.from_name 에 그대로 있다. 그걸 쓴다.
      //   (participants JSON 은 옛 row 에 이름이 비어 있어 신뢰할 수 없다 — fallback 으로만.)
      const threadIds = rows.map(r => r.id);
      const senderByThread = new Map();
      if (threadIds.length > 0) {
        const lastInbound = await sequelize.query(
          `SELECT em.thread_id, em.from_name, em.from_email
             FROM email_messages em
             JOIN (SELECT thread_id, MAX(id) AS mid
                     FROM email_messages
                    WHERE thread_id IN (:ids) AND direction = 'inbound'
                 GROUP BY thread_id) last ON last.mid = em.id`,
          { replacements: { ids: threadIds }, type: sequelize.QueryTypes.SELECT }
        );
        for (const m of lastInbound) {
          senderByThread.set(m.thread_id, { name: m.from_name || null, email: m.from_email || null });
        }
      }

      const data = rows.map(t => {
        const obj = t.toJSON();
        const myAddr = String(obj.EmailAccount?.email || '').toLowerCase();
        const parts = Array.isArray(obj.participants) ? obj.participants : [];
        const fromParts = parts.find(p => p?.email && String(p.email).toLowerCase() !== myAddr) || parts[0] || null;
        const other = senderByThread.get(obj.id) || (fromParts ? { name: fromParts.name || null, email: fromParts.email || null } : null);
        return {
          id: obj.id,
          subject: obj.subject,
          last_message_preview: obj.last_message_preview,
          last_message_at: obj.last_message_at,
          last_message_direction: obj.last_message_direction,
          status: obj.status,
          reply_needed: obj.reply_needed,
          reply_needed_at: obj.reply_needed_at,
          reply_needed_reason: obj.reply_needed_reason,
          rule_id: obj.rule_id || null,        // 학습 규칙으로 분류된 건지 (화면 표시)
          is_starred: obj.is_starred,
          unread_count: obj.unread_count || 0,
          message_count: obj.message_count || 0,
          labels: obj.labels || [],
          account: obj.EmailAccount,
          counterpart: other ? { name: other.name || null, email: other.email || null } : null,
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
        rule_id: tj.rule_id || null,
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

// 스레드의 마지막 inbound 발신자 (학습 신호의 주체)
async function lastInboundSender(businessId, threadId) {
  const { EmailMessage } = require('../models');
  const m = await EmailMessage.findOne({
    where: { business_id: businessId, thread_id: threadId, direction: 'inbound' },
    attributes: ['from_email', 'from_name'],
    order: [['id', 'DESC']],
  });
  return m ? { email: m.from_email, name: m.from_name } : null;
}

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

      // 학습 — 같은 도메인을 2번 스팸 처리하면 도메인 단위 규칙 (사용자가 지울 수 있다)
      let learned = null;
      try {
        const sender = await lastInboundSender(Number(req.params.businessId), thread.id);
        if (sender?.email) {
          const rules = require('../services/mailSenderRules');
          const r = await rules.onMarkSpam({ businessId: Number(req.params.businessId), fromEmail: sender.email, userId: req.user.id });
          if (r.learned) learned = { pattern: r.rule.pattern };
        }
      } catch (e) { console.warn('[mailSenderRules spam]', e.message); }

      return successResponse(res, { id: thread.id, status: 'spam', learned });
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
// ─────────────────────────────────────────────
// POST mark-handled — "확인 완료" (확인 권장에서 내리기)
//   확인 권장은 "한 번 보고 판단할 것" 이 쌓이는 곳이다. 판단이 끝난 메일을 못 내리면
//   그 폴더는 영영 줄지 않고, 관리 자산이 아니라 쓰레기통이 된다.
//   원본은 그대로 — 분류만 바꾼다 (전체 탭에는 계속 있다). 같은 발신자 학습은 하지 않는다
//   (한 번 확인했다고 그 발신자 메일을 앞으로 안 볼 이유는 없다 — 그건 규칙 화면에서 명시적으로).
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/mark-handled',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      await thread.update({
        status: 'archived',
        reply_needed: false,
        reply_needed_at: null,
        reply_needed_reason: 'handled',
        uncertain_reason: null,
      });
      broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, handled: true });
      return successResponse(res, { id: thread.id, status: 'archived' });
    } catch (err) { next(err); }
  }
);

// POST dismiss-reply — "답변 필요" 해제 (답장 완료 / 답장 불필요)
//   Q Mail 밖(Gmail·맥 메일 등)에서 답장하면 플래그가 영영 안 꺼져 "답변 필요" 가 죽은 지표가 된다.
//   IMAP 수집기는 inbound 만 보므로 우리가 밖에서 보낸 답장을 알 수 없다 → 사람이 끄는 문을 연다.
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/dismiss-reply',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({
        where: { id: req.params.id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
      });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      await thread.update({
        reply_needed: false,
        reply_needed_at: null,
        reply_needed_reason: 'dismissed',
      });

      // 학습 — 같은 발신자를 2번 "답변 완료" 하면 앞으로 안 묻는다 (규칙 생성 + 그 발신자 미처리 일괄 정리).
      //   LLM 0. 사용자가 클릭으로 알려준 정답을 그대로 규칙화한다.
      let learned = null;
      try {
        const sender = await lastInboundSender(businessId, thread.id);
        if (sender?.email) {
          const rules = require('../services/mailSenderRules');
          const r = await rules.onDismissReply({
            businessId, fromEmail: sender.email, threadId: thread.id,
            subject: thread.subject, userId: req.user.id,
          });
          if (r.learned) learned = { pattern: r.rule.pattern, cleaned: r.cleaned };
        }
      } catch (e) { console.warn('[mailSenderRules dismiss]', e.message); }

      broadcastMail(req, businessId, 'mail:updated', { id: thread.id, reply_needed: false });
      return successResponse(res, { id: thread.id, reply_needed: false, learned });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// #154 일괄 처리 — 선택한 스레드들 "모두 답변불필요" / "모두 읽음". 접근 가능한 계정으로 스코프.
//   개별 dismiss-reply/mark-read 의 벌크판. 학습(규칙 생성)은 벌크에선 생략(개별 클릭 시에만).
// ─────────────────────────────────────────────
// 대상 스레드 id 해석 — { all:true, folder } 이면 폴더 전체(folderWhere+스코프, 500 캡), 아니면 thread_ids.
//   Fable 권고: "모두"가 로드된 페이지만이 아니라 폴더 전체에 진짜로 적용되게.
const BULK_FOLDERS = new Set(['reply_needed', 'uncertain', 'all']);
async function resolveBulkTargetIds(body, businessId, userId) {
  const acctIds = await accessibleAccountIds(businessId, userId);
  const acctScope = { [Op.in]: acctIds.length ? acctIds : [0] };
  if (body?.all && BULK_FOLDERS.has(body?.folder)) {
    const rows = await EmailThread.findAll({
      where: { ...folderWhere(body.folder, userId), business_id: businessId, account_id: acctScope },
      attributes: ['id'], limit: 500,
    });
    return { ids: rows.map((r) => r.id), acctScope };
  }
  return { ids: parseThreadIds(body), acctScope };
}
const parseThreadIds = (body) => (Array.isArray(body?.thread_ids)
  ? body.thread_ids.map(Number).filter(Boolean).slice(0, 500) : []);

router.post('/:businessId/email-threads/bulk-dismiss',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { ids, acctScope } = await resolveBulkTargetIds(req.body, businessId, req.user.id);
      if (!ids.length) return errorResponse(res, 'no_threads', 400);
      const [count] = await EmailThread.update(
        { reply_needed: false, reply_needed_at: null, reply_needed_reason: 'dismissed' },
        { where: { id: { [Op.in]: ids }, business_id: businessId, account_id: acctScope, reply_needed: true } },
      );
      broadcastMail(req, businessId, 'mail:updated', { bulk: true, reply_needed: false });
      return successResponse(res, { updated: count });
    } catch (err) { next(err); }
  },
);

router.post('/:businessId/email-threads/bulk-read',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { ids, acctScope } = await resolveBulkTargetIds(req.body, businessId, req.user.id);
      if (!ids.length) return errorResponse(res, 'no_threads', 400);
      const [count] = await EmailThread.update(
        { unread_count: 0 },
        { where: { id: { [Op.in]: ids }, business_id: businessId, account_id: acctScope, unread_count: { [Op.gt]: 0 } } },
      );
      await EmailMessage.update({ is_read: true }, { where: { thread_id: { [Op.in]: ids }, is_read: false } }).catch(() => {});
      broadcastMail(req, businessId, 'mail:updated', { bulk: true, unread: 0 });
      return successResponse(res, { updated: count });
    } catch (err) { next(err); }
  },
);

// #154 — "모두 확인완료"(확인권장 폴더). 개별 mark-handled 의 벌크판: status=archived + reply_needed 해제
//   → 확인 권장 목록에서 내려간다("판단 끝난 메일"). 전체 탭엔 남는다(원본 보존).
router.post('/:businessId/email-threads/bulk-handled',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { ids, acctScope } = await resolveBulkTargetIds(req.body, businessId, req.user.id);
      if (!ids.length) return errorResponse(res, 'no_threads', 400);
      const [count] = await EmailThread.update(
        { status: 'archived', reply_needed: false, reply_needed_at: null, reply_needed_reason: 'handled', uncertain_reason: null },
        { where: { id: { [Op.in]: ids }, business_id: businessId, account_id: acctScope } },
      );
      broadcastMail(req, businessId, 'mail:updated', { bulk: true, handled: true });
      return successResponse(res, { updated: count });
    } catch (err) { next(err); }
  },
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

      // 이 스레드가 "어느 주소로" 왔는지 — 그 주소로 답한다 (별칭 자동 선택의 근거)
      let lastInboundTo = null;
      try {
        const lastIn = await EmailMessage.findOne({
          where: { thread_id: thread.id, direction: 'inbound' },
          order: [['sent_at', 'DESC']],
          attributes: ['to_emails'],
        });
        if (lastIn && Array.isArray(lastIn.to_emails)) lastInboundTo = lastIn.to_emails.map((x) => (typeof x === 'string' ? x : x?.address)).filter(Boolean);
      } catch (e) { console.warn('[qmail] lastInboundTo', e.message); }

      // 발송 (실패 시 502 — outbound row 안 만듦. 프론트는 작성 내용 유지)
      let sendResult;
      try {
        sendResult = await sendMail(account, {
          to: toList, cc, bcc, subject, html: body_html,
          inReplyTo, references, attachments: atts,
          // 발신 주소 — 사용자가 고른 별칭이 있으면 그것, 없으면 "이 메일이 온 주소" 로 답한다.
          //   다른 도메인 주소로 답장이 나가면 사고다 (Send-as: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §A-4).
          fromAliasId: (req.body || {}).from_alias_id || null,
          replyToAddresses: lastInboundTo,
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

      // 반대 신호 — 사람이 직접 답장한 발신자는 "답장 불필요" 규칙에서 즉시 빼준다.
      //   (학습된 규칙보다 실제 대응이 강한 신호. 안 그러면 시스템이 계속 그 사람 메일을 숨긴다)
      try {
        const rules = require('../services/mailSenderRules');
        const removed = await rules.onReplySent({ businessId, toEmails: toList });
        if (removed.removed > 0) console.log(`[mailSenderRules] 답장 발송 → 규칙 ${removed.removed}건 해제`);
      } catch (e) { console.warn('[mailSenderRules reply]', e.message); }

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
        sendResult = await sendMail(account, { to: toList, cc, bcc, subject: subj, html: body_html, attachments: atts, fromAliasId: (req.body || {}).from_alias_id || null });
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
// 전달(Forward) — 원본 메시지를 새 수신자에게. 원본 첨부는 서버가 message_id 로 해석(재유지).
// POST /:biz/email-threads/:id/forward  body: { account_id, message_id, to[], cc?, bcc?, subject, body_html, attachment_file_ids? }
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/forward',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'), emailSendLimiter,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const { account_id, message_id, to, cc, bcc, subject, body_html, attachment_file_ids } = req.body || {};
      if (!body_html || !String(body_html).trim()) return errorResponse(res, 'body_required', 400);
      const toList = (Array.isArray(to) ? to : [to]).map(s => String(s || '').trim()).filter(Boolean);
      if (!toList.length) return errorResponse(res, 'recipient_required', 400);

      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const accId = Number(account_id);
      if (!acctIds.includes(accId)) return errorResponse(res, 'account_not_accessible', 403);
      const account = await EmailAccount.findOne({ where: { id: accId, business_id: businessId } });
      if (!account) return errorResponse(res, 'account_not_found', 404);

      // 원본 메시지 — 스레드·비즈 격리. 원본 첨부 file_id 서버 해석(클라 신뢰 X).
      const srcMsg = await EmailMessage.findOne({ where: { id: Number(message_id), thread_id: threadId, business_id: businessId } });
      if (!srcMsg) return errorResponse(res, 'source_message_not_found', 404);
      const srcAtts = await EmailAttachment.findAll({ where: { message_id: srcMsg.id }, attributes: ['file_id'] });
      const origFileIds = srcAtts.map(a => a.file_id).filter(Boolean);
      const userFileIds = Array.isArray(attachment_file_ids) ? attachment_file_ids : [];
      const { atts, files } = await resolveAttachments([...origFileIds, ...userFileIds], businessId);
      const subj = String(subject || '').trim() || `Fwd: ${srcMsg.subject || ''}`;

      let sendResult;
      try {
        sendResult = await sendMail(account, { to: toList, cc, bcc, subject: subj, html: body_html, attachments: atts, fromAliasId: (req.body || {}).from_alias_id || null });
      } catch (e) {
        console.error('[qmail] forward send failed:', e.message);
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
        message_id: sendResult.messageId || `<planq-fwd-${thread.id}-${now.getTime()}@planq>`,
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
// 임시저장(Draft) — 본인 작성 중 메일 자동저장/복원. (business_id+user_id+thread_id) 키.
//   thread_id 없음 = 새 메일(compose) 초안, thread_id 있음 = 해당 스레드 답장 초안.
// GET    /:biz/email-drafts?thread_id=  → 본인 초안 1건(없으면 null)
// PUT    /:biz/email-drafts             → upsert
// DELETE /:biz/email-drafts?thread_id=  → 발송/취소 시 삭제
// ─────────────────────────────────────────────
function draftThreadKey(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }
router.get('/:businessId/email-drafts',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = draftThreadKey(req.query.thread_id);
      const draft = await EmailDraft.findOne({ where: { business_id: businessId, user_id: req.user.id, thread_id: threadId } });
      return successResponse(res, draft || null);
    } catch (err) { next(err); }
  }
);
router.put('/:businessId/email-drafts',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { thread_id, account_id, in_reply_to_message_id, to_emails, cc_emails, bcc_emails, subject, body_html, attachment_file_ids } = req.body || {};
      const threadId = draftThreadKey(thread_id);
      const fields = {
        account_id: account_id || null,
        in_reply_to_message_id: in_reply_to_message_id || null,
        to_emails: Array.isArray(to_emails) ? to_emails : null,
        cc_emails: Array.isArray(cc_emails) ? cc_emails : null,
        bcc_emails: Array.isArray(bcc_emails) ? bcc_emails : null,
        subject: subject != null ? String(subject).slice(0, 500) : null,
        body_html: body_html != null ? String(body_html) : null,
        attachment_file_ids: Array.isArray(attachment_file_ids) ? attachment_file_ids : null,
      };
      const [draft, created] = await EmailDraft.findOrCreate({
        where: { business_id: businessId, user_id: req.user.id, thread_id: threadId },
        defaults: { business_id: businessId, user_id: req.user.id, thread_id: threadId, ...fields },
      });
      if (!created) await draft.update(fields);
      return successResponse(res, draft);
    } catch (err) { next(err); }
  }
);
router.delete('/:businessId/email-drafts',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = draftThreadKey(req.query.thread_id);
      const n = await EmailDraft.destroy({ where: { business_id: businessId, user_id: req.user.id, thread_id: threadId } });
      return successResponse(res, { deleted: n });
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
      // #153 — 답장은 받은 메일의 언어로. 수신 본문에 한글이 있으면 ko, 없으면 en 을
      //   워크스페이스 default_language 보다 우선(영어 메일에 한글 답장 나가던 것 방지). 명시 override 는 최우선.
      const detectedLang = /[가-힣]/.test(latestInboundText) ? 'ko' : 'en';
      const language = (req.body || {}).language || detectedLang || biz?.default_language || 'ko';

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
      // broadcast·알림·감사는 행동 계층(createTask)이 소유한다 — 여기서 또 쏘면 중복이다.
      const out = await extractor.registerCandidate(cand.id, req.user.id, req.body || {});
      return successResponse(res, out, 'registered', 201);
    } catch (err) {
      // 행동 계층의 거부는 그 상태 그대로 (cannot_assign·menu_forbidden 403 …) — 사람이 쓰는 POST /api/tasks 와 같은 코드
      if (err.http) return errorResponse(res, err.message, err.http);
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
      // 이슈도 코멘트다 — 시간 순(오래된 것 위)으로, 누가 썼는지 같이 (메모와 동일 규칙)
      const rows = await ProjectIssue.findAll({ where: { email_thread_id: thread.id }, order: [['id', 'ASC']] });
      const nameMap = await authorNameMap(Number(req.params.businessId), rows.map((r) => r.author_user_id));
      return successResponse(res, rows.map((r) => ({ ...r.toJSON(), author_name: nameMap[r.author_user_id] || null })));
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
      const nameMap = await authorNameMap(businessId, [req.user.id]);
      return successResponse(res, { ...issue.toJSON(), author_name: nameMap[req.user.id] || null }, 'created', 201);
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


// 작성자 표시명 — 워크스페이스 표시명(BusinessMember.name) 우선, 없으면 계정명(User.name).
//   memory: feedback_member_display_name_on_lists — 리스트에 계정명이 새어 나오면 안 된다.
async function authorNameMap(businessId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return {};
  const [members, users] = await Promise.all([
    getMemberNameMap(businessId, ids),
    User.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true }),
  ]);
  const out = {};
  for (const u of users) out[u.id] = u.name || null;
  for (const [uid, v] of members) if (v && v.name) out[uid] = v.name;
  return out;
}
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
      // 메모는 댓글이다 — 누가 언제 썼는지 없으면 대화가 안 된다. 이름은 워크스페이스 표시명 우선.
      const nameMap = await authorNameMap(Number(req.params.businessId), rows.map((r) => r.author_user_id));
      return successResponse(res, rows.map((r) => ({
        ...r.toJSON(),
        author_name: nameMap[r.author_user_id] || null,
      })));
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
      const nameMap = await authorNameMap(businessId, [req.user.id]);
      return successResponse(res, { ...note.toJSON(), author_name: nameMap[req.user.id] || null }, 'created', 201);
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
