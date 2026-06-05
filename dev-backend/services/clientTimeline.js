// 고객 통합 타임라인 (Customer 360) — 사이클 N+87, Phase A.
//   한 고객(client_id)의 채팅·메일·업무·청구를 채널 무관 시간순으로 merge.
//   ★ 내부 전용 (운영자/멤버). 고객 역할 노출 X (라우트에서 차단).
//   메일은 개인 격리 적용 (accessibleAccountIds — 남의 개인메일 제외).
//   설계: docs/QMAIL_CONTEXT_DESIGN.md §5.2
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Message, Conversation, EmailMessage, EmailThread, EmailAccount,
  Task, Invoice,
} = require('../models');

// 이 사용자가 접근 가능한 메일 계정 (회사 공용 + 본인 개인) — email_threads.js 와 동일 정책
async function accessibleAccountIds(businessId, userId) {
  const accts = await EmailAccount.findAll({
    where: { business_id: businessId, [Op.or]: [{ owner_user_id: null }, { owner_user_id: userId }] },
    attributes: ['id'],
  });
  return accts.map((a) => a.id);
}

const CHANNELS = ['chat', 'email', 'task', 'invoice'];

// 한 고객의 통합 타임라인. before(ISO) 이전 항목만 (페이지네이션). 채널별로 limit*2 가져와 merge 후 limit cut.
async function getClientTimeline(businessId, clientId, { userId, limit = 40, before = null, channels = null } = {}) {
  const want = Array.isArray(channels) && channels.length
    ? channels.filter((c) => CHANNELS.includes(c))
    : CHANNELS;
  const beforeDate = before ? new Date(before) : null;
  const perSource = Math.min(limit + 5, 60); // merge 후 잘리므로 소스별 약간 여유
  const items = [];

  // 1) 채팅 — conversations.client_id = X 의 messages
  if (want.includes('chat')) {
    const convs = await Conversation.findAll({
      where: { business_id: businessId, client_id: clientId },
      attributes: ['id', 'title'],
    });
    const convMap = new Map(convs.map((c) => [c.id, c.title]));
    if (convMap.size) {
      // Message 는 business_id 없음 (Conversation 이 보유) — conversation_id IN 으로 이미 biz+client 스코프됨
      const where = { conversation_id: { [Op.in]: [...convMap.keys()] }, is_deleted: false };
      if (beforeDate) where.createdAt = { [Op.lt]: beforeDate };
      const msgs = await Message.findAll({
        where, order: [['createdAt', 'DESC']], limit: perSource,
        attributes: ['id', 'conversation_id', 'content', 'sender_id', 'is_ai', 'createdAt'],
      });
      for (const m of msgs) {
        items.push({
          type: 'chat', id: m.id, at: m.createdAt,
          conversation_id: m.conversation_id,
          title: convMap.get(m.conversation_id) || null,
          preview: (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 140),
          meta: { is_ai: !!m.is_ai, sender_id: m.sender_id },
        });
      }
    }
  }

  // 2) 메일 — email_threads.client_id = X (접근 가능 계정만) 의 email_messages
  if (want.includes('email')) {
    const acctIds = await accessibleAccountIds(businessId, userId);
    if (acctIds.length) {
      const threads = await EmailThread.findAll({
        where: { business_id: businessId, client_id: clientId, account_id: { [Op.in]: acctIds } },
        attributes: ['id', 'subject'],
      });
      const thMap = new Map(threads.map((t) => [t.id, t.subject]));
      if (thMap.size) {
        const where = { business_id: businessId, thread_id: { [Op.in]: [...thMap.keys()] } };
        if (beforeDate) where.sent_at = { [Op.lt]: beforeDate };
        const ems = await EmailMessage.findAll({
          where, order: [['sent_at', 'DESC']], limit: perSource,
          attributes: ['id', 'thread_id', 'subject', 'direction', 'from_email', 'body_text', 'sent_at', 'createdAt'],
        });
        for (const e of ems) {
          items.push({
            type: 'email', id: e.id, at: e.sent_at || e.createdAt,
            thread_id: e.thread_id,
            title: e.subject || thMap.get(e.thread_id) || null,
            preview: (e.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 140),
            meta: { direction: e.direction, from_email: e.from_email },
          });
        }
      }
    }
  }

  // 3) 업무 — tasks.client_id = X
  if (want.includes('task')) {
    const where = { business_id: businessId, client_id: clientId };
    if (beforeDate) where.createdAt = { [Op.lt]: beforeDate };
    const tasks = await Task.findAll({
      where, order: [['createdAt', 'DESC']], limit: perSource,
      attributes: ['id', 'title', 'status', 'due_date', 'createdAt'],
    });
    for (const tk of tasks) {
      items.push({
        type: 'task', id: tk.id, at: tk.createdAt,
        title: tk.title,
        meta: { status: tk.status, due_date: tk.due_date },
      });
    }
  }

  // 4) 청구 — invoices.client_id = X
  if (want.includes('invoice')) {
    const where = { business_id: businessId, client_id: clientId };
    if (beforeDate) where.createdAt = { [Op.lt]: beforeDate };
    const invs = await Invoice.findAll({
      where, order: [['createdAt', 'DESC']], limit: perSource,
      attributes: ['id', 'invoice_number', 'title', 'status', 'grand_total', 'currency', 'issued_at', 'createdAt'],
    });
    for (const iv of invs) {
      items.push({
        type: 'invoice', id: iv.id, at: iv.issued_at || iv.createdAt,
        title: iv.title || iv.invoice_number,
        meta: { invoice_number: iv.invoice_number, status: iv.status, grand_total: Number(iv.grand_total), currency: iv.currency },
      });
    }
  }

  // merge — 시간 내림차순, null at 은 맨 뒤
  items.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });
  const has_more = items.length > limit;
  const page = items.slice(0, limit);
  const next_before = has_more && page.length ? page[page.length - 1].at : null;
  return { items: page, has_more, next_before };
}

// 채널별 카운트 + 각 채널 최근 1건 — 메일/채팅 우측 패널 "이 고객" 요약용 (cross-channel)
async function getClientChannelSummary(businessId, clientId, { userId } = {}) {
  const { items } = await getClientTimeline(businessId, clientId, { userId, limit: 60 });
  const counts = { chat: 0, email: 0, task: 0, invoice: 0 };
  const latest = {};
  for (const it of items) {
    counts[it.type] = (counts[it.type] || 0) + 1;
    if (!latest[it.type]) latest[it.type] = it;
  }
  return { counts, latest };
}

module.exports = { getClientTimeline, getClientChannelSummary, accessibleAccountIds };
