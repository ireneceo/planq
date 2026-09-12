// saleInbox — Q sale "상담" 목록 (고객으로 **등록되지 않은** 접점만)
//
// Irene 2026-09-12: *"이게 왜 고객 > 상세야? 상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지."*
//   *"게스트가 문의하거나 이메일로 문의온 경우 고객으로 등록 안된 경우."*
//
// 지금까지 Q sale 은 **고객 목록**이 입구였다. 그런데 실제로 들어오는 문의는 고객이 되기 **전**에 온다 —
// dev 워크스페이스 5 실측: 메일 스레드 3,412건이 **전부** client_id NULL, 게스트 링크 52건 중 47건이 NULL.
// 그 문의들은 Q sale 화면에 한 건도 보이지 않았다. 그래서 입구를 접점으로 바꾼다.
//
// ★ 새 테이블을 만들지 않는다 (Irene 결정: "원본 그대로 읽기").
//   게스트 링크·메일 스레드·고객 대화방을 **있는 그대로** 읽어 합친다. 고객으로 등록하는 순간
//   원본의 client_id 가 채워지고 이 목록에서 자연히 빠진다 — 두 벌 상태를 만들지 않는다.
//   (services/clientTimeline.js 가 client_id = X 로 읽는 것과 정확히 반대 축이다. 읽는 필드는 같게 맞춘다.)
const { Op } = require('sequelize');
const { Conversation, Message, EmailThread, GuestLink } = require('../models');
const { accessibleAccountIds } = require('./clientTimeline');

const SOURCES = ['guest_link', 'email', 'chat'];

const clean = (s, n = 140) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * 고객 미등록 접점 목록.
 * @param businessId 워크스페이스
 * @param opts.userId    접근 가능한 메일 계정 판정용(기존 술어 재사용)
 * @param opts.sources   ['guest_link','email','chat'] 부분집합. 비우면 전체
 * @param opts.q         검색어(제목·상대·미리보기)
 * @param opts.needsReply true 면 "답해야 하는 것"만
 * @returns { items, counts } — counts 는 화면 상단 스트립(전체·답 필요·소스별)
 */
async function listUnlinkedTouchpoints(businessId, opts = {}) {
  const { userId = null, sources = null, q = null, needsReply = false, limit = 100 } = opts;
  const want = Array.isArray(sources) && sources.length
    ? sources.filter((s) => SOURCES.includes(s))
    : SOURCES;
  // ★ 소스별 조회 상한은 **목록용 여유분**이고 집계(counts)를 자르면 안 된다.
  //   운영 #(확인필요 35→51)과 같은 계열 — 숫자가 목록 상한에 잘리면 사용자는 "왜 숫자가 안 맞지" 로 읽는다.
  //   목록은 아래에서 limit 으로 자르고, counts 는 여기서 모은 전체로 센다.
  const perSource = Math.min(Math.max(limit * 3, 300), 1000);
  const like = q ? { [Op.like]: `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%` } : null;
  const items = [];

  // 1) 게스트 링크 — 고객으로 저장되지 않은 링크. 문의가 **여기로** 들어온다(#259 게스트 대화).
  if (want.includes('guest_link')) {
    const where = { business_id: businessId, client_id: null, revoked_at: null };
    if (like) where[Op.or] = [{ guest_name: like }, { requested_email: like }, { contact_email: like }];
    const links = await GuestLink.findAll({
      where, order: [['last_used_at', 'DESC']], limit: perSource,
      attributes: ['id', 'conversation_id', 'guest_name', 'requested_email', 'contact_email',
        'message_count', 'last_used_at', 'account_requested_at', 'created_at'],
    });
    for (const g of links) {
      items.push({
        source: 'guest_link',
        id: `guest_link:${g.id}`,
        ref: { kind: 'guest_link', id: g.id, conversation_id: g.conversation_id },
        who: g.guest_name || g.contact_email || g.requested_email || null,
        email: g.contact_email || g.requested_email || null,
        title: null,
        preview: null,
        at: g.last_used_at || g.created_at,
        // 계정 요청은 사람이 답해야 하는 신호다(게스트가 "정식으로 쓰고 싶다" 고 말한 것)
        needs_reply: !!g.account_requested_at,
        meta: { message_count: g.message_count, account_requested_at: g.account_requested_at },
        open_path: `/talk?conv=${g.conversation_id}`,
      });
    }
  }

  // 2) 메일 — 고객에 연결되지 않은 스레드. 접근 가능한 계정만(기존 술어 그대로).
  if (want.includes('email')) {
    const acctIds = await accessibleAccountIds(businessId, userId);
    if (acctIds.length) {
      // ★ 사람이 보낸 것만 — 영업 상담 목록이지 받은편지함이 아니다.
      //   실측(dev 워크스페이스 5, 고객 미연결 3,410건): 자동발송 2,137 · 광고 366 · 알 수 없음 4 · **사람 903**.
      //   거르지 않으면 목록 첫 화면이 "(광고) …" 와 시스템 알림으로 덮여 영업에서 할 일이 보이지 않는다.
      //   판정은 메일이 이미 갖고 있는 분류(services/emailTriage)를 그대로 쓴다 — 새 술어를 만들지 않는다.
      const where = {
        business_id: businessId, client_id: null,
        account_id: { [Op.in]: acctIds },
        status: { [Op.notIn]: ['spam', 'archived'] },
        triage: 'human',
      };
      if (needsReply) where.reply_needed = true;
      if (like) where[Op.or] = [{ subject: like }, { last_message_preview: like }];
      const threads = await EmailThread.findAll({
        where, order: [['last_message_at', 'DESC']], limit: perSource,
        attributes: ['id', 'subject', 'participants', 'last_message_at', 'last_message_preview',
          'last_message_direction', 'unread_count', 'reply_needed', 'reply_needed_reason', 'created_at'],
      });
      // ★ participants 에 바깥 사람이 없거나 비어 있는 스레드가 있다(실측: 첫 행의 who 가 null 이었다).
      //   목록에서 "누구" 가 비면 그 줄은 쓸모가 없다 → 첫 **수신** 메일의 보낸 주소로 채운다.
      const needWho = threads.filter((t) => !(Array.isArray(t.participants) ? t.participants : []).some((p) => p && !p.is_internal));
      const firstInbound = new Map();
      if (needWho.length) {
        const { EmailMessage } = require('../models');
        const ems = await EmailMessage.findAll({
          where: { business_id: businessId, thread_id: { [Op.in]: needWho.map((t) => t.id) }, direction: 'inbound' },
          order: [['sent_at', 'ASC']],
          attributes: ['thread_id', 'from_name', 'from_email'],
        });
        for (const e of ems) if (!firstInbound.has(e.thread_id)) firstInbound.set(e.thread_id, e);
      }
      for (const t of threads) {
        // participants 는 [{name,email,is_internal}] — 바깥 사람 첫 명이 상대다
        const outside = (Array.isArray(t.participants) ? t.participants : []).find((p) => p && !p.is_internal)
          || (() => { const e = firstInbound.get(t.id); return e ? { name: e.from_name, email: e.from_email } : null; })();
        items.push({
          source: 'email',
          id: `email:${t.id}`,
          ref: { kind: 'email_thread', id: t.id },
          who: outside?.name || outside?.email || null,
          email: outside?.email || null,
          title: t.subject || null,
          preview: clean(t.last_message_preview),
          at: t.last_message_at || t.created_at,
          needs_reply: !!t.reply_needed,
          meta: { unread_count: t.unread_count, direction: t.last_message_direction, reason: t.reply_needed_reason },
          open_path: `/mail?thread=${t.id}`,
        });
      }
    }
  }

  // 3) 고객 대화방 — channel_type='customer' 인데 client_id 가 비어 있는 방(초대 전 대화)
  if (want.includes('chat')) {
    const where = { business_id: businessId, client_id: null, channel_type: 'customer', archived_at: null };
    if (like) where[Op.or] = [{ title: like }, { display_name: like }];
    const convs = await Conversation.findAll({
      where, order: [['last_message_at', 'DESC']], limit: perSource,
      attributes: ['id', 'title', 'display_name', 'last_message_at', 'created_at'],
    });
    if (convs.length) {
      // 마지막 메시지 한 줄 — 목록에서 "무슨 이야기인지" 가 보여야 누를지 정한다.
      // ★ conversations 에는 last_message_direction 컬럼이 **없다**(email_threads 에만 있다).
      //   그 컬럼으로 판정하면 조용히 언제나 false 가 된다 — 마지막 메시지의 **보낸 사람**으로 판정한다.
      //   우리 워크스페이스 멤버가 아닌 사람(게스트·고객)이 마지막이면 우리가 답할 차례다.
      const rows = await Message.findAll({
        where: { conversation_id: { [Op.in]: convs.map((c) => c.id) }, is_deleted: false },
        order: [['id', 'DESC']], limit: convs.length * 3,
        attributes: ['id', 'conversation_id', 'content', 'sender_id', 'is_ai', 'created_at'],
      });
      const lastByConv = new Map();
      for (const m of rows) if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
      const senderIds = [...new Set([...lastByConv.values()].map((m) => m.sender_id).filter(Boolean))];
      const memberIds = new Set();
      if (senderIds.length) {
        const { BusinessMember } = require('../models');
        const ms = await BusinessMember.findAll({
          where: { business_id: businessId, user_id: { [Op.in]: senderIds }, removed_at: null },
          attributes: ['user_id'],
        });
        for (const m of ms) memberIds.add(m.user_id);
      }
      for (const c of convs) {
        const last = lastByConv.get(c.id) || null;
        items.push({
          source: 'chat',
          id: `chat:${c.id}`,
          ref: { kind: 'conversation', id: c.id },
          who: c.display_name || c.title || null,
          email: null,
          title: c.title || null,
          preview: clean(last?.content),
          at: c.last_message_at || last?.created_at || c.created_at,
          needs_reply: !!last && !last.is_ai && !memberIds.has(last.sender_id),
          meta: {},
          open_path: `/talk?conv=${c.id}`,
        });
      }
    }
  }

  items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const sliced = needsReply ? items.filter((x) => x.needs_reply) : items;

  // ★ 집계는 **세어서** 만든다 — 모은 배열 길이로 세면 소스별 조회 상한(perSource)에 잘린다.
  //   실측: 사람이 보낸 미연결 메일이 903건인데 배열 길이로는 300 으로 나왔다(상한값 그대로).
  //   숫자가 상한에 잘리는 것은 이미 한 번 사고가 난 계열이다(확인필요 35→51) — 목록만 자르고 숫자는 참으로.
  const counts = { total: 0, needs_reply: 0, guest_link: 0, email: 0, chat: 0 };
  if (want.includes('guest_link')) {
    const w = { business_id: businessId, client_id: null, revoked_at: null };
    if (like) w[Op.or] = [{ guest_name: like }, { requested_email: like }, { contact_email: like }];
    counts.guest_link = await GuestLink.count({ where: w });
    counts.needs_reply += await GuestLink.count({ where: { ...w, account_requested_at: { [Op.ne]: null } } });
  }
  if (want.includes('email')) {
    const acctIds = await accessibleAccountIds(businessId, userId);
    if (acctIds.length) {
      const w = {
        business_id: businessId, client_id: null, account_id: { [Op.in]: acctIds },
        status: { [Op.notIn]: ['spam', 'archived'] }, triage: 'human',
      };
      if (like) w[Op.or] = [{ subject: like }, { last_message_preview: like }];
      counts.email = await EmailThread.count({ where: w });
      counts.needs_reply += await EmailThread.count({ where: { ...w, reply_needed: true } });
    }
  }
  if (want.includes('chat')) {
    // 채팅의 "답할 차례" 는 마지막 메시지 발신자로 정해지므로 위에서 만든 항목으로 센다(대화방 수는 적다).
    const w = { business_id: businessId, client_id: null, channel_type: 'customer', archived_at: null };
    if (like) w[Op.or] = [{ title: like }, { display_name: like }];
    counts.chat = await Conversation.count({ where: w });
    counts.needs_reply += items.filter((x) => x.source === 'chat' && x.needs_reply).length;
  }
  counts.total = counts.guest_link + counts.email + counts.chat;
  return { items: sliced.slice(0, limit), counts };
}

module.exports = { listUnlinkedTouchpoints, SOURCES };
