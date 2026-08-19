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
const { sendMail, deliveryFromSendResult } = require('../services/emailSend');
// 폴더 정의·정렬은 services/mailFolders 가 단일 원천 (리스트 라우트 + 벌크 처리 공용)
const { folderWhere, sentOrder, BULK_FOLDERS } = require('../services/mailFolders');
// accessibleAccountIds 도 여기서 온다 — 프라이버시 격리 정의를 두 벌 두지 않는다
const { outgoingIdentityFor, accessibleAccountIds } = require('../services/mailIdentity');
const { serializeThreadRow } = require('../services/mailSerialize');

// 발신 별칭 id 파싱 — **0 은 "계정 주소 명시 선택"이고 미지정이 아니다.**
//   `from_alias_id || null` 로 뭉개면 서버가 기본별칭으로 덮어써, 화면은 help@ 를 보여주는데
//   실제 From 은 support@ 로 나간다(표시≠실발신). Fable 게이트가 실 From 헤더로 재현한 사고.
function parseFromAliasId(body) {
  const v = (body || {}).from_alias_id;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const { emailsOf, mergeParticipants, selfEmailsForAccount } = require('../services/emailAddress');
const { isEmbedded, isNoiseAttachment, NOISE_MIMES } = require('../services/emailAttachments');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
// #221 — LLM 라우트 3종 세트(rate-limit + plan 게이트 + 입력 캡) 중 rate-limit.
//   `ai-suggest` 는 여태 plan 게이트(orchestrator 내부)와 입력 캡만 있고 **per-user rate-limit 이 없었다**
//   — 사용자 1명이 연타로 LLM 비용을 태울 수 있는 상태. 신규 `ai-compose` 와 **양쪽에** 붙인다.
const { perUserDaily } = require('../middleware/costGuard');
const aiDraftLimiter = perUserDaily('mail-ai-draft', { perMin: 10, perDay: 200 });

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
        ...folderWhere(folder, req.user.id, businessId),
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
      // 별칭별 보기 — "support@ 로 온 것만" 처럼 우리 쪽 수신 주소로 좁힌다.
      //   계정 격리(위 account_id 조건) 안에서만 동작하므로 남의 개인 메일이 새지 않는다.
      if (req.query.received_at) {
        where.received_at_email = String(req.query.received_at).toLowerCase().slice(0, 255);
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
      // 풀텍스트 — subject + last_message_preview + 메시지(본문·제목·보낸사람)
      // #212 — 공백은 토큰 구분자. "wordpress org" 는 두 토큰이 각각 어딘가에 있으면 매칭(AND).
      //        옛 동작(공백 포함 단일 LIKE)은 "wordpress.org" 같은 실제 문자열을 못 찾았다.
      if (q && String(q).trim()) {
        const tokens = String(q).trim().slice(0, 100).split(/\s+/)
          .map(s => s.trim()).filter(Boolean).slice(0, 4);
        const andConds = [];
        // 사용자 입력의 LIKE 와일드카드(% _ \)는 리터럴로 — 검색어 "50%" 가 전건 매칭되지 않게
        const esc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
        for (const raw of tokens) {
          const tk = esc(raw);
          // 토큰별 메시지 매칭 thread id (접근 가능 계정 스코프 내) — 제목/미리보기에 없어도 내용·발신자로 검색
          const [msgRows] = await sequelize.query(
            `SELECT DISTINCT thread_id FROM email_messages
              WHERE business_id = :bid
                AND thread_id IN (SELECT id FROM email_threads WHERE business_id = :bid AND account_id IN (:acctIds))
                AND (body_text LIKE :kw OR subject LIKE :kw OR from_name LIKE :kw OR from_email LIKE :kw)
              LIMIT 1000`,
            { replacements: { bid: businessId, kw: `%${tk}%`, acctIds: acctIds.length ? acctIds : [0] } }
          );
          const msgTids = msgRows.map(r => r.thread_id);
          const orConds = [
            { subject: { [Op.like]: `%${tk}%` } },
            { last_message_preview: { [Op.like]: `%${tk}%` } },
          ];
          if (msgTids.length) orConds.push({ id: { [Op.in]: msgTids } });
          andConds.push({ [Op.or]: orConds });
        }
        if (andConds.length) where[Op.and] = [...(where[Op.and] || []), ...andConds];
      }

      const { rows, count } = await EmailThread.findAndCountAll({
        where,
        include: [
          { model: EmailAccount, attributes: ['id', 'email', 'display_name'], required: false },
          { model: Client, attributes: ['id', 'display_name', 'company_name'], required: false },
          { model: Project, attributes: ['id', 'name', 'color'], required: false },
        ],
        // 보낸메일함은 **내가 보낸 시각** 순이어야 한다 (#262) — 상대 수신 시각(last_message_at)이
        //   섞이면 "내가 방금 보낸 메일"이 옛 답장 아래로 내려간다.
        //   파생 컬럼(last_outbound_at)을 두지 않고 상관 서브쿼리로 푼다: outbound 쓰기 경로가
        //   reply·compose·forward 3곳 + 향후 IMAP Sent 동기화까지 있어 컬럼은 조용히 어긋난다
        //   (memory feedback_dual_column_authority_write_side). 인덱스 email_messages_thread_time 이 받쳐 준다.
        order: folder === 'sent' ? sentOrder() : [['last_message_at', 'DESC']],
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
      const lastOutByThread = new Map();
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
        // "응답 없음 N일" 판정용 — 마지막 보낸 메일이 실제로 나갔는지 확인해야 한다.
        //   못 나간 걸 "응답 없음" 으로 표시하면 사용자가 상대를 탓하게 된다.
        //   #262 — 보낸메일함 행 표시도 이 배치 결과를 쓴다 (수신자·내 발송시각·내 발송 미리보기).
        //   새 쿼리를 만들지 않고 컬럼만 넓힌다 (N+1 금지).
        const lastOut = await sequelize.query(
          `SELECT em.thread_id, em.delivery_status, em.to_emails, em.sent_at,
                  LEFT(COALESCE(em.body_text, ''), 200) AS preview
             FROM email_messages em
             JOIN (SELECT thread_id, MAX(id) AS mid
                     FROM email_messages
                    WHERE thread_id IN (:ids) AND direction = 'outbound'
                 GROUP BY thread_id) last ON last.mid = em.id`,
          { replacements: { ids: threadIds }, type: sequelize.QueryTypes.SELECT }
        );
        for (const m of lastOut) {
          lastOutByThread.set(m.thread_id, {
            delivery_status: m.delivery_status,
            to_emails: m.to_emails,
            sent_at: m.sent_at,
            preview: m.preview,
          });
        }
      }

      // #215-I — 첨부 유무 배치 집계 (원문 "첨부파일 있고 없고도 알기 편하게" — 열기 전에 인지).
      //   목록은 body_html 을 로드하지 않으므로 detail 의 `isEmbedded(cid, body)` 술어를 그대로 쓸 수 없다.
      //   대신 `is_inline` 컬럼을 쓴다 — B(쓰기측 교정)+C(백필) 이후 이 컬럼은 **같은 술어의 물질화 캐시**라
      //   목록 클립 ↔ 상세 칩이 정의상 일치한다("클립 보고 열었는데 첨부가 없는" 배신이 구조적으로 불가능).
      //   ★ 그 대가로 C 백필이 리스트 표시의 데이터 전제가 된다 — 설계 §9-1 이 백필을 배포 완료 조건으로 격상.
      //   N+1 없음: threadIds 1 쿼리.
      const attachCountByThread = new Map();
      if (threadIds.length > 0) {
        const attRows = await sequelize.query(
          `SELECT em.thread_id, COUNT(*) AS cnt
             FROM email_attachments ea
             JOIN email_messages em ON em.id = ea.message_id
            WHERE em.business_id = :bid AND em.thread_id IN (:ids)
              AND ea.is_inline = 0
              AND ea.file_id IS NOT NULL
              AND (ea.mime_type IS NULL OR LOWER(ea.mime_type) NOT IN (:noise))
            GROUP BY em.thread_id`,
          {
            replacements: { bid: businessId, ids: threadIds, noise: [...NOISE_MIMES] },
            type: sequelize.QueryTypes.SELECT,
          }
        );
        for (const r of attRows) attachCountByThread.set(r.thread_id, Number(r.cnt) || 0);
      }

      const data = rows.map(t => serializeThreadRow(t, {
        folder, senderByThread, lastOutByThread, attachCountByThread,
      }));

      return paginatedResponse(res, data, count, { limit, page, offset });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// GET outgoing-identity — 이 발송에 **실제로** 붙을 발신자·서명 (#262)
//
//   Irene: "메일 보낼 때 서명이 팀서명과 개인서명 뭐가 붙는지도 모르고 알 수도 없어."
//   서명은 발송 시점에 emailSend 가 별칭 > 계정 > 워크스페이스 순으로 고른다 — 화면엔 그 결과가
//   전혀 안 보였다. 여기서 **sendMail 과 같은 함수**(resolveOutgoingIdentity)로 계산해 내려준다.
//   같은 함수가 아니면 미리보기와 실발송이 어긋나고, 그건 "표시≠실발신" 사고다.
//
//   thread_id 를 받는 이유: 답장은 별칭을 사용자가 고른 게 아니라 **받은 주소**로 자동 결정된다
//   (resolveSender ②). alias 파라미터만 받으면 답장 미리보기가 실제와 달라진다 (Fable 지적).
//   :id 충돌 방지 위해 literal 경로 (express literal 우선).
// ─────────────────────────────────────────────
router.get('/:businessId/mail-outgoing-identity',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const out = await outgoingIdentityFor({
        businessId: Number(req.params.businessId),
        userId: req.user.id,
        accountId: req.query.account_id ? Number(req.query.account_id) : null,
        threadId: req.query.thread_id ? Number(req.query.thread_id) : null,
        fromAliasId: parseFromAliasId(req.query),
      });
      if (out.error) return errorResponse(res, out.error, out.status);
      return successResponse(res, out.data);
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
      // 운영 #220 — "팀메일이면 다른 담당자가 보내도 [나] 라고만 나오는데 누가 보냈는지 알 수 없어?"
      //   sent_by_user_id 는 처음부터 기록돼 있었는데 직렬화에서 빠져 화면에 도달한 적이 없다.
      //   표시명은 워크스페이스 프로필 우선(BusinessMember.name → User.name) — 목록 표시명 규칙과 동일.
      const senderIds = [...new Set(messages.map(m => m.sent_by_user_id).filter(Boolean))];
      const senderMap = new Map();
      if (senderIds.length) {
        const users = await User.findAll({ where: { id: senderIds }, attributes: ['id', 'name'], raw: true });
        const shells = users.map(u => ({ user_id: u.id, sender: { id: u.id, name: u.name, name_localized: null } }));
        await applyMemberDisplayName(shells, businessId, ['sender']);
        for (const sh of shells) senderMap.set(sh.user_id, sh.sender);
      }

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
            // #220 — 이 메일을 우리 쪽에서 누가 보냈는지. inbound 면 null.
            sent_by_user_id: mj.direction === 'outbound' ? (mj.sent_by_user_id || null) : null,
            sent_by_name: mj.direction === 'outbound' && mj.sent_by_user_id
              ? ((senderMap.get(mj.sent_by_user_id) || {}).name || null) : null,
            // 발송 상태 — outbound 만 의미 있다. 'sent' 는 SMTP 250 accept 까지이고
            //   수신자 메일함 도착 보증이 아니다. 'suppressed'(서버 발송 정지)를 'sent' 로 뭉개지 않는다.
            delivery_status: mj.direction === 'outbound' ? mj.delivery_status : null,
            delivery_error: mj.direction === 'outbound' ? (mj.delivery_error || null) : null,
            // inline 이미지(cid)는 본문에 속하므로 첨부 목록에서 제외. 모델 필드명(filename/size_bytes) 정정 +
            //   file_id 를 내려줘야 프론트가 다운로드 가능(여태 file_name/file_size 오필드라 'undefined (NaN KB)' + 다운로드 불가 회귀).
            // #215 — 판정 권위를 `is_inline` 컬럼에서 **본문 cid 참조**로 옮겼다. 옛 로직은 Content-ID 가 붙었다는
            //   이유만으로 숨겨서 첨부 66%(부가세 납부서·매입매출장·영수증 포함)가 화면에서 사라져 있었다.
            //   컬럼을 안 보므로 옛 데이터도 백필 없이 즉시 정상화된다. + 기계 파트(반송 헤더 등) 노이즈 제거.
            attachments: (mj.attachments || [])
              .filter(a => !isEmbedded(a.content_id, mj.body_html) && !isNoiseAttachment(a.mime_type))
              .map(a => ({
                id: a.id,
                file_id: a.file_id,
                file_name: a.filename,
                file_size: a.size_bytes,
                mime_type: a.mime_type,
              })),
            // #215-H — 본문이 cid 로 참조하는 이미지. 본문은 sandbox iframe srcDoc 이라 `cid:` 를 해석할 수 없어
            //   여태 깨진 채였다. 프론트가 인증 다운로드 → data: URI 치환에 쓰는 재료.
            inline_images: (mj.attachments || [])
              .filter(a => a.file_id
                && String(a.mime_type || '').startsWith('image/')
                && isEmbedded(a.content_id, mj.body_html))
              .map(a => ({
                file_id: a.file_id,
                content_id: a.content_id,
                mime_type: a.mime_type,
                size_bytes: a.size_bytes,
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
        // #205 — "확인 완료" 는 곧 "봤다" 다. 읽음까지 같이 내려야 미읽음 뱃지가 남지 않는다
        //   (Irene: "제대로 읽음표시랑 함께 리스트에서 없어져야지"). mark-read 와 같은 처리.
        unread_count: 0,
      });
      await EmailMessage.update(
        { is_read: true },
        { where: { thread_id: thread.id, is_read: false } },
      ).catch(() => {});
      broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, handled: true, unread: 0 });
      return successResponse(res, { id: thread.id, status: 'archived', unread_count: 0 });
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
async function resolveBulkTargetIds(body, businessId, userId) {
  const acctIds = await accessibleAccountIds(businessId, userId);
  const acctScope = { [Op.in]: acctIds.length ? acctIds : [0] };
  if (body?.all && BULK_FOLDERS.has(body?.folder)) {
    const rows = await EmailThread.findAll({
      where: { ...folderWhere(body.folder, userId, businessId), business_id: businessId, account_id: acctScope },
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
        // #205 — 개별 mark-handled 와 같은 처리(읽음까지). 두 경로가 갈리면 벌크로 내린 메일만
        //   미읽음 뱃지가 남는다.
        { status: 'archived', reply_needed: false, reply_needed_at: null, reply_needed_reason: 'handled', uncertain_reason: null, unread_count: 0 },
        { where: { id: { [Op.in]: ids }, business_id: businessId, account_id: acctScope } },
      );
      await EmailMessage.update(
        { is_read: true },
        { where: { thread_id: { [Op.in]: ids }, is_read: false } },
      ).catch(() => {});
      broadcastMail(req, businessId, 'mail:updated', { bulk: true, handled: true, unread: 0 });
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
        //   #200(b') — 여기서 `x?.address` 로 읽던 탓에 저장 shape `{email,name}` 이 통째로
        //   걸러져 항상 빈 배열이었다 (resolveSender ② 별칭 자동 선택이 죽어 있었다).
        if (lastIn) lastInboundTo = emailsOf(lastIn.to_emails);
      } catch (e) { console.warn('[qmail] lastInboundTo', e.message); }

      // 발송 (실패 시 502 — outbound row 안 만듦. 프론트는 작성 내용 유지)
      let sendResult;
      try {
        sendResult = await sendMail(account, {
          to: toList, cc, bcc, subject, html: body_html,
          inReplyTo, references, attachments: atts,
          // 발신 주소 — 사용자가 고른 별칭이 있으면 그것, 없으면 "이 메일이 온 주소" 로 답한다.
          //   다른 도메인 주소로 답장이 나가면 사고다 (Send-as: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §A-4).
          fromAliasId: parseFromAliasId(req.body),
          replyToAddresses: lastInboundTo,
          // #262 — 이 발송만 서명 끄기. 계정 설정(signature_enabled)은 건드리지 않는다.
          signature: req.body.signature !== false,
        });
      } catch (e) {
        console.error('[qmail] reply send failed:', e.message);
        return errorResponse(res, `send_failed: ${e.message}`, 502);
      }

      const now = new Date();
      const preview = htmlToPreview(body_html);
      const delivery = deliveryFromSendResult(sendResult);

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
        ...delivery,
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
      // #200 — reason 을 null 로 지우면 재판정(retriage-mail.js)의 제외 필터를 그대로 통과해
      //   **이미 답장한 스레드가 답변 필요로 되살아났다**(운영 189 의 reason 진동이 물증).
      //   'replied' 로 박제한다. 새 inbound 가 오면 threadFieldsForInbound 가 'inbound' 로 덮어
      //   재점등은 정상 작동한다.
      // #200(b') — 발송 수신자도 스레드 참여자다. 여태 outbound 경로가 participants 를
      //   전혀 안 써서, 내가 먼저 보낸 스레드는 상대가 답장해도 findOrCreateThread 의
      //   "제목+참여자" 매칭이 실패해 새 스레드로 쪼개졌다.
      const replySelfEmails = await selfEmailsForAccount(account);
      const nextParticipants = mergeParticipants(
        thread.participants,
        [...toList, ...(Array.isArray(cc) ? cc : [])],
        { excludeEmails: replySelfEmails },
      );

      await thread.update({
        reply_needed: false,
        reply_needed_reason: 'replied',
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_preview: preview,
        message_count: (thread.message_count || 0) + 1,
        participants: nextParticipants,
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
        delivery_status: delivery.delivery_status,
        delivery_error: delivery.delivery_error,
        suppressed: !!sendResult.suppressed,   // 프론트가 "실제 발송 안 됨" 안내를 띄우는 근거
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
        sendResult = await sendMail(account, { to: toList, cc, bcc, subject: subj, html: body_html, attachments: atts, fromAliasId: parseFromAliasId(req.body), signature: req.body.signature !== false });
      } catch (e) {
        console.error('[qmail] compose send failed:', e.message);
        return errorResponse(res, `send_failed: ${e.message}`, 502);
      }

      const now = new Date();
      const preview = htmlToPreview(body_html);
      // #200(b') — 새 스레드도 처음부터 참여자를 갖는다. 이게 비어 있으면 상대 답장이
      //   헤더 없이 올 때 같은 제목 스레드로 못 붙는다.
      const composeParticipants = mergeParticipants(
        [],
        [...toList, ...(Array.isArray(cc) ? cc : [])],
        { excludeEmails: await selfEmailsForAccount(account) },
      );
      const thread = await EmailThread.create({
        business_id: businessId, account_id: accId, subject: subj, status: 'open',
        reply_needed: false, message_count: 1, unread_count: 0,
        last_message_at: now, last_message_direction: 'outbound', last_message_preview: preview,
        participants: composeParticipants,
      });
      const outMsg = await EmailMessage.create({
        thread_id: thread.id, business_id: businessId, direction: 'outbound',
        message_id: sendResult.messageId || `<planq-compose-${thread.id}-${now.getTime()}@planq>`,
        from_email: account.email, from_name: account.display_name || null,
        to_emails: toList,
        cc_emails: (Array.isArray(cc) && cc.length) ? cc : null,
        bcc_emails: (Array.isArray(bcc) && bcc.length) ? bcc : null,
        subject: subj, body_html, body_text: preview,
        sent_by_user_id: req.user.id, is_read: true, ...deliveryFromSendResult(sendResult), sent_at: now,
      });
      for (const f of files) {
        await EmailAttachment.create({ message_id: outMsg.id, file_id: f.id, filename: f.file_name, mime_type: f.mime_type || null, size_bytes: f.file_size || null });
      }
      broadcastMail(req, businessId, 'mail:new', { thread_id: thread.id });
      return successResponse(res, {
        id: thread.id, thread_id: thread.id, rejected: sendResult.rejected,
        delivery_status: outMsg.delivery_status, suppressed: !!sendResult.suppressed,
      }, 'sent', 201);
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
        sendResult = await sendMail(account, { to: toList, cc, bcc, subject: subj, html: body_html, attachments: atts, fromAliasId: parseFromAliasId(req.body), signature: req.body.signature !== false });
      } catch (e) {
        console.error('[qmail] forward send failed:', e.message);
        return errorResponse(res, `send_failed: ${e.message}`, 502);
      }

      const now = new Date();
      const preview = htmlToPreview(body_html);
      // #200(b') — 전달도 수신자를 참여자로 박제한다.
      //   한계: 전달 스레드 제목은 `Fwd: ...` 접두를 정규화 없이 저장하는데(위 subj),
      //   findOrCreateThread step3 는 정규화 제목 완전일치라 참여자를 채워도 이 스레드에는
      //   붙지 않는다. 제목 저장 방식 변경은 목록 표시에 영향이 있어 이번 범위 밖 —
      //   전달 스레드는 In-Reply-To/References(step1·2)로만 이어진다.
      const fwdParticipants = mergeParticipants(
        [],
        [...toList, ...(Array.isArray(cc) ? cc : [])],
        { excludeEmails: await selfEmailsForAccount(account) },
      );
      const thread = await EmailThread.create({
        business_id: businessId, account_id: accId, subject: subj, status: 'open',
        reply_needed: false, message_count: 1, unread_count: 0,
        last_message_at: now, last_message_direction: 'outbound', last_message_preview: preview,
        participants: fwdParticipants,
      });
      const outMsg = await EmailMessage.create({
        thread_id: thread.id, business_id: businessId, direction: 'outbound',
        message_id: sendResult.messageId || `<planq-fwd-${thread.id}-${now.getTime()}@planq>`,
        from_email: account.email, from_name: account.display_name || null,
        to_emails: toList,
        cc_emails: (Array.isArray(cc) && cc.length) ? cc : null,
        bcc_emails: (Array.isArray(bcc) && bcc.length) ? bcc : null,
        subject: subj, body_html, body_text: preview,
        sent_by_user_id: req.user.id, is_read: true, ...deliveryFromSendResult(sendResult), sent_at: now,
      });
      for (const f of files) {
        await EmailAttachment.create({ message_id: outMsg.id, file_id: f.id, filename: f.file_name, mime_type: f.mime_type || null, size_bytes: f.file_size || null });
      }
      broadcastMail(req, businessId, 'mail:new', { thread_id: thread.id });
      return successResponse(res, {
        id: thread.id, thread_id: thread.id, rejected: sendResult.rejected,
        delivery_status: outMsg.delivery_status, suppressed: !!sendResult.suppressed,
      }, 'sent', 201);
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
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'), ...aiDraftLimiter,
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

      // 본문 텍스트 확보 — 정리된 "새로 쓴 본문"(인용/전달/서명 제거) 우선. AI 입력·언어감지 공통.
      const { cleanVisibleBody, detectLang } = require('../services/emailBodyClean');
      const cleaned = cleanVisibleBody(lastInbound.body_text, lastInbound.body_html);
      const stripped = cleaned
        || lastInbound.body_text
        || String(lastInbound.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const latestInboundText = (stripped || '').slice(0, 4000);
      if (!latestInboundText) return errorResponse(res, 'empty_inbound', 400);

      const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name', 'default_language'] });
      // #153 — 답장은 받은 메일의 언어로. 정리된 본문의 ko/en 지배 비율로 판정(인용된 옛 한글 답장·
      //   한글 서명 한 글자에 ko 로 끌려가던 편향 제거). 워크스페이스 default 는 둘 다 0 일 때만. 명시 override 최우선.
      //   제목도 함께 본다(3배 가중) — 한글 제목 + 영문 템플릿 본문인 자동발송 메일을 구제한다.
      const detectedLang = detectLang(cleaned || latestInboundText, biz?.default_language || 'ko', thread.subject);
      const language = (req.body || {}).language || detectedLang;

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

      // #192 — 사용자 수정 요청(instruction) + 현재 초안(current_draft) 을 받아 초안을 다듬는다.
      //   입력 캡(costGuard 원칙): instruction 1000자 / current_draft 는 HTML strip 후 4000자.
      const instruction = String((req.body || {}).instruction || '').trim().slice(0, 1000) || null;
      const currentDraftRaw = (req.body || {}).current_draft;
      const currentDraft = currentDraftRaw
        ? String(currentDraftRaw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000) || null
        : null;

      const cueOrch = require('../services/cue_orchestrator');
      const out = await cueOrch.generateEmailReplyDraft(businessId, {
        businessName: (biz && (biz.brand_name || biz.name)) || null,
        subject: thread.subject,
        latestInboundText,
        language,
        faqContext,
        userInstruction: instruction,
        currentDraft: instruction ? currentDraft : null,
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
// #221 — **새 메일** AI 작성 (스레드 없음). Irene: "메일 작성폼, 새 메일에서도 ai로 작성할 수 있어야지"
// POST /:biz/email-threads/ai-compose  { instruction, to?, subject?, current_draft?, language? }
//   → { suggestion(html), usage }
//
//   ai-suggest 와 달리 받은 메일이 없다 — 사용자의 지시가 유일한 근거이므로 지시는 필수다.
//   라우트 자리: 스레드 자원이 아니지만 Q Mail 권한·격리 축이 같아 이 라우터에 둔다.
//   ★ 경로가 `email-threads/` 뒤 **한 세그먼트**라, 이 라우터의 POST 들(전부 `:id/...` 2세그먼트 이상
//     또는 bulk-* 리터럴) 중 어느 것에도 가려지지 않는다. 나중에 `POST /:businessId/email-threads/:id`
//     같은 한 세그먼트 라우트를 추가한다면 **그보다 위**에 있어야 한다 (Express 는 선언 순서로 매칭).
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/ai-compose',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'), ...aiDraftLimiter,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      // 입력 캡 (costGuard 원칙) — 지시 1000자 / 초안은 HTML strip 후 4000자
      const instruction = String((req.body || {}).instruction || '').trim().slice(0, 1000);
      if (!instruction) return errorResponse(res, 'instruction_required', 400);
      const to = String((req.body || {}).to || '').trim().slice(0, 300) || null;
      const subject = String((req.body || {}).subject || '').trim().slice(0, 300) || null;
      const draftRaw = (req.body || {}).current_draft;
      const currentDraft = draftRaw
        ? String(draftRaw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000) || null
        : null;

      const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name', 'default_language'] });
      // 언어는 명시 > 지시문 자체의 언어 > 워크스페이스 기본. 받은 메일이 없으므로 지시문으로 판정한다.
      const { detectLang } = require('../services/emailBodyClean');
      const language = (req.body || {}).language || detectLang(instruction, biz?.default_language || 'ko');

      const cueOrch = require('../services/cue_orchestrator');
      const out = await cueOrch.generateEmailComposeDraft(businessId, {
        businessName: (biz && (biz.brand_name || biz.name)) || null,
        instruction, to, subject, language, currentDraft,
      });
      if (out.error === 'usage_limit_exceeded') return errorResponse(res, 'cue_usage_limit_exceeded', 429);
      if (out.error === 'llm_unavailable') return errorResponse(res, 'ai_unavailable', 503);

      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = (out.content || '').trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      return successResponse(res, { suggestion: html, usage: out.usage });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────
// #184 — 메일 본문 번역 (원본보기/번역하기 토글). 지정 언어로 번역, translateWithRetry 재사용(검출+재시도+한도).
// POST /:biz/email-threads/:id/messages/:msgId/translate  { target_lang } → { detected_language, target_lang, translated }
// ─────────────────────────────────────────────
router.post('/:businessId/email-threads/:id/messages/:msgId/translate',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.params.id);
      const msgId = Number(req.params.msgId);
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const thread = await EmailThread.findOne({ where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } } });
      if (!thread) return errorResponse(res, 'thread_not_found', 404);
      const msg = await EmailMessage.findOne({ where: { id: msgId, thread_id: threadId, business_id: businessId } });
      if (!msg) return errorResponse(res, 'message_not_found', 404);

      const SUPPORTED = ['ko', 'en', 'ja', 'zh', 'es'];
      const target = String((req.body || {}).target_lang || 'ko');
      if (!SUPPORTED.includes(target)) return errorResponse(res, 'unsupported_language', 400);

      // 본문 텍스트 — 정리된 본문 우선(인용/전달/서명 제거), 없으면 원문 / HTML strip.
      const { cleanVisibleBody } = require('../services/emailBodyClean');
      const text = cleanVisibleBody(msg.body_text, msg.body_html) || msg.body_text
        || String(msg.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || !text.trim()) return errorResponse(res, 'empty_body', 400);

      // 단방향 번역 — 메일은 대상 언어 하나만 필요하다. 양방향(채팅용)을 쓰면 출력 토큰이 2배라
      // 본문 1천 자만 넘어도 JSON 이 잘리고 재시도까지 겹쳐 2분 대기 후 실패했다(#197).
      const { translateOneWithRetry } = require('../services/translation_service');
      const r = await translateOneWithRetry(text, target, businessId);
      if (r.fallback || !r.translated) {
        return errorResponse(res, r.reason === 'usage_limit_exceeded' ? 'usage_limit_exceeded' : 'translation_unavailable', 503);
      }
      return successResponse(res, { detected_language: r.detected_language, target_lang: target, translated: r.translated });
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
      // #179 — LLM 이 아예 안 돈 것(키 미설정·게이트웨이 폴백)을 "업무 없음"으로 위장하지 않는다.
      //   summarize 처럼 503 으로 표면화 → 프론트가 "AI 잠시 불가"로 구분 표시(무반응처럼 보이던 근본).
      if (out.fallback) return errorResponse(res, 'ai_unavailable', 503);
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

// 검증용 노출 — 이 파싱이 틀리면 표시≠실발신 사고가 난다. 단위 검증 가능해야 한다.
router._parseFromAliasId = parseFromAliasId;

module.exports = router;
