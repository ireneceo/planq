// /api/businesses/:businessId/email-addresses — 주소 기준으로 메일 보기 (#261)
//
// 운영 신고: "메일에서 보낸 사람이나 받은 주소 기준으로 리스트업해서 보게 … 메일 기본 기능들 다 없어."
//   같은 신고에 "어떤 메일은 아예 안 들어와" 가 붙어 있었는데, 운영 실측 결과 그 메일은
//   **들어와 있었고 보관함에 있었다**(2026-08-22 확인, 본문까지 일치). 즉 못 찾은 것이지 못 받은 게 아니다.
//   사람을 기준으로 오간 메일을 모아 보여주면 그 상황 자체가 사라진다 — 그래서 이 라우트가 있다.
//
// 설계 원칙
//   · **보관된 것도 같이 보여준다.** 이 화면의 목적은 "그 사람과 오간 전부" 이고,
//     받은메일함에서 내린 것을 여기서도 숨기면 찾을 길이 다시 없어진다.
//   · 상대 주소만 센다 — 우리 계정 주소는 상대가 아니다(자기 자신이 목록 1위가 되면 쓸모가 없다).
//   · 계정 접근 범위(개인 메일함 격리)는 mailIdentity.accessibleAccountIds 한 곳을 그대로 쓴다.
const express = require('express');
const router = express.Router({ mergeParams: true });
const { Op } = require('sequelize');

const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse } = require('../utils/response');
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { EmailMessage, EmailThread, MailSenderRule, Client } = require('../models');
const { accessibleAccountIds } = require('../services/mailIdentity');
const { sequelize } = require('../config/database');

const norm = (e) => String(e || '').trim().toLowerCase();

/** 이 워크스페이스의 "우리 주소" 집합 — 상대 주소를 고를 때 걸러낸다. */
async function ownAddressSet(businessId) {
  const { buildOwnAddressMatcher } = require('../services/emailTriage');
  try {
    const m = await buildOwnAddressMatcher(businessId);
    return m && m.emails ? new Set(m.emails.map(norm)) : new Set();
  } catch { return new Set(); }
}

function counterpartsOf(msg, own) {
  // 받은 메일이면 보낸 사람이 상대. 보낸 메일이면 받는 사람들이 상대.
  const out = [];
  if (msg.direction === 'inbound') {
    if (msg.from_email && !own.has(norm(msg.from_email))) out.push({ email: norm(msg.from_email), name: msg.from_name || null });
  } else {
    const to = Array.isArray(msg.to_emails) ? msg.to_emails : [];
    for (const x of to) {
      const email = norm(typeof x === 'string' ? x : x?.email);
      if (email && !own.has(email)) out.push({ email, name: (typeof x === 'object' && x?.name) || null });
    }
  }
  return out;
}

// ─── GET / — 주소 목록 ──────────────────────────────────────────
// ?q= 부분검색 · ?limit=
router.get('/', authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const acctIds = await accessibleAccountIds(businessId, req.user.id);
    if (!acctIds.length) return successResponse(res, []);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const q = norm(req.query.q);

    // 스레드를 통해 계정 범위를 건다 — 메시지에는 account_id 가 없다.
    const threads = await EmailThread.findAll({
      where: { business_id: businessId, account_id: { [Op.in]: acctIds } },
      attributes: ['id'],
    });
    const threadIds = threads.map((t) => t.id);
    if (!threadIds.length) return successResponse(res, []);

    const msgs = await EmailMessage.findAll({
      where: { business_id: businessId, thread_id: { [Op.in]: threadIds } },
      attributes: ['id', 'thread_id', 'direction', 'from_email', 'from_name', 'to_emails', 'sent_at', 'is_read'],
      order: [['sent_at', 'DESC']],
      limit: 20000,   // 안전 상한 — 전수 집계이므로 상한에 걸리면 최근 것부터 센다
    });

    const own = await ownAddressSet(businessId);
    const acc = new Map();
    for (const m of msgs) {
      for (const c of counterpartsOf(m, own)) {
        if (q && !c.email.includes(q) && !String(c.name || '').toLowerCase().includes(q)) continue;
        const cur = acc.get(c.email) || {
          email: c.email, name: null, total: 0, inbound: 0, outbound: 0,
          unread: 0, last_at: null, thread_ids: new Set(),
        };
        cur.total += 1;
        if (m.direction === 'inbound') cur.inbound += 1; else cur.outbound += 1;
        if (m.direction === 'inbound' && !m.is_read) cur.unread += 1;
        if (!cur.name && c.name) cur.name = c.name;
        if (!cur.last_at || new Date(m.sent_at) > new Date(cur.last_at)) cur.last_at = m.sent_at;
        cur.thread_ids.add(m.thread_id);
        acc.set(c.email, cur);
      }
    }

    // 고객으로 이미 저장돼 있는지 · 규칙(차단·분류)이 걸려 있는지 — 화면이 "할 수 있는 일"을 결정한다.
    const emails = [...acc.keys()];
    // 고객 매칭은 emailImapCron.matchClient 와 **같은 필드**를 본다 — 두 벌로 갈라지면
    //   "메일은 고객으로 붙었는데 이 화면엔 고객이 아니라고 나오는" 어긋남이 생긴다.
    const clients = emails.length
      ? await Client.findAll({
        where: {
          business_id: businessId,
          [Op.or]: [
            { invite_email: { [Op.in]: emails } },
            { billing_contact_email: { [Op.in]: emails } },
          ],
        },
        attributes: ['id', 'invite_email', 'billing_contact_email', 'display_name', 'company_name'],
      })
      : [];
    const clientBy = new Map();
    for (const c of clients) {
      const label = c.display_name || c.company_name || null;
      for (const e of [c.invite_email, c.billing_contact_email]) {
        if (e) clientBy.set(norm(e), { id: c.id, name: label });
      }
    }
    const rules = await MailSenderRule.findAll({
      where: { business_id: businessId },
      attributes: ['id', 'pattern', 'pattern_type', 'verdict'],
    });
    const ruleFor = (email) => {
      const dom = email.split('@')[1] || '';
      return rules.find((r) => (r.pattern_type === 'address' && norm(r.pattern) === email))
        || rules.find((r) => (r.pattern_type === 'domain' && norm(r.pattern) === dom))
        || null;
    };

    const list = [...acc.values()]
      .map((r) => ({
        email: r.email,
        name: r.name,
        total: r.total, inbound: r.inbound, outbound: r.outbound, unread: r.unread,
        last_at: r.last_at,
        thread_count: r.thread_ids.size,
        client: clientBy.get(r.email) || null,
        rule: (() => { const x = ruleFor(r.email); return x ? { id: x.id, verdict: x.verdict, pattern_type: x.pattern_type } : null; })(),
      }))
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

    return paginatedResponse(res, list.slice(offset, offset + limit), list.length, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /:email/threads — 그 주소와 오간 스레드 (보관 포함) ────
router.get('/:email/threads', authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const email = norm(req.params.email);
    if (!email || !email.includes('@')) return errorResponse(res, 'invalid_email', 400);
    const acctIds = await accessibleAccountIds(businessId, req.user.id);
    if (!acctIds.length) return successResponse(res, []);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });

    // 그 주소가 등장하는 메시지 → 스레드 집합. 보낸 메일의 수신자는 JSON 이라 LIKE 로 훑는다
    // (주소 문자열이 그대로 들어 있어 오탐이 거의 없고, 워크스페이스 범위라 양이 작다).
    const rows = await sequelize.query(
      `SELECT DISTINCT m.thread_id AS id
         FROM email_messages m
         JOIN email_threads t ON t.id = m.thread_id
        WHERE m.business_id = :biz
          AND t.account_id IN (:accts)
          AND (LOWER(m.from_email) = :email
               OR LOWER(CAST(m.to_emails AS CHAR)) LIKE :like
               OR LOWER(CAST(COALESCE(m.cc_emails, '[]') AS CHAR)) LIKE :like)`,
      { replacements: { biz: businessId, accts: acctIds, email, like: `%${email}%` }, type: sequelize.QueryTypes.SELECT },
    );
    const ids = rows.map((r) => r.id);
    if (!ids.length) return paginatedResponse(res, [], 0, { limit, page, offset });

    const { rows: threads, count } = await EmailThread.findAndCountAll({
      // ★ 보관된 것도 포함한다 — 이 화면은 "그 사람과 오간 전부" 다(파일 상단 주석).
      where: { id: { [Op.in]: ids }, business_id: businessId },
      order: [['last_message_at', 'DESC']],
      limit, offset,
    });
    return paginatedResponse(res, threads.map((t) => ({
      id: t.id, subject: t.subject, status: t.status, triage: t.triage,
      reply_needed: !!t.reply_needed, unread_count: t.unread_count,
      last_message_at: t.last_message_at, participants: t.participants,
    })), count, { limit, page, offset });
  } catch (err) { next(err); }
});

module.exports = router;
