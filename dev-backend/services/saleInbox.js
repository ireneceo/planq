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

/** 이메일 도메인으로 회사를 **추정**한다 — 무료메일은 제외(그건 개인 주소지 회사가 아니다).
 *
 * ★ 추정값이므로 화면은 이것을 **입력된 회사와 구분해서** 보여줘야 한다(estimated 플래그).
 *   도메인 목록은 services/emailTriage 의 FREE_MAIL_DOMAIN 단일 원천을 쓴다 — 베끼면 한쪽만 늘어난다.
 */
function companyFromEmail(email) {
  const addr = String(email || '').toLowerCase();
  const [local, dom] = addr.split('@');
  if (!dom || dom.length < 4) return null;
  const { FREE_MAIL_DOMAIN } = require('./emailTriage');
  if (FREE_MAIL_DOMAIN.test(dom)) return null;
  // ★ 발송 전용 주소는 회사가 아니다. 실측으로 잡았다 — no_reply@email.apple.com 을
  //   "회사: email.apple.com" 으로 내놓고 있었다. 추정이 거짓이면 안 하느니만 못하다.
  if (/^(no-?reply|donotreply|do-not-reply|mailer|bounce|postmaster|notification?s?|alerts?|news|info|admin)(\b|[-_.])/.test(local || '')) return null;
  if (/^(email|mail|mailer|notifications?|bounce|reply|em|mg|smtp)\./.test(dom)) return null;
  return { name: dom.replace(/^www\./, ''), estimated: true };
}

/** 한 대화방에 링크가 여럿일 때 **등록에 쓸 하나**를 고른다 — 확인된 이메일 → 이메일 있음 → 최근 사용순.
 *
 * ★ 구독(`routes/guest_subscribe.js`)은 **확인한 사람마다** personal 링크를 하나씩 만든다.
 *   아무거나 고르면 이메일이 없는 링크로 고객을 만들어 **연락처가 빈 고객**이 생긴다 —
 *   `routes/sale_save.js` 의 guest_link 분기가 링크의 contact_email 을 그대로 쓰기 때문이다.
 */
function betterLink(a, b) {
  if (!a) return b;
  if (!b) return a;
  const av = a.email_verified_at ? 1 : 0;
  const bv = b.email_verified_at ? 1 : 0;
  if (av !== bv) return bv > av ? b : a;
  const ae = a.contact_email || a.requested_email ? 1 : 0;
  const be = b.contact_email || b.requested_email ? 1 : 0;
  if (ae !== be) return be > ae ? b : a;
  const at = new Date(a.last_used_at || a.created_at || 0).getTime();
  const bt = new Date(b.last_used_at || b.created_at || 0).getTime();
  return bt > at ? b : a;
}

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
  //
  // ★ 2026-09-12 — **행을 여기서 만들지 않는다.** 게스트 링크는 별개의 접점이 아니라
  //   그 대화방의 **신원**이다. 따로 세면 같은 대화가 두 줄로 보이고 집계도 그만큼 부푼다
  //   (실측: 미연결 고객 대화방 26개 중 3개가 링크를 갖고 있어 양쪽에 떴다).
  //   그래서 여기서는 **대화방별 대표 링크만** 고르고, 행은 아래 3)이 한 번만 만든다.
  //
  // ★ 대화방 기준으로 묶어도 되는 근거 — `services/guest_link.js ensurePersonalLink` 가
  //   자식(personal) 링크에 부모의 `business_id`·`conversation_id`·`project_id` 를 그대로
  //   물려준다. 구독은 **확인한 사람마다** personal 링크를 하나씩 만들므로 한 대화방에
  //   링크가 여러 개 달리는 것이 정상이다.
  // ★ 신원은 **소스 칩과 무관하게** 붙인다. 여기에 `want` 를 걸면 "채팅" 칩을 눌렀을 때
  //   링크를 아예 안 읽어 모든 대화가 링크 없는 방으로 보이고, 겹침 보정이 0 이 되어
  //   전체에서는 7 인 채팅이 칩을 누르면 9 로 튄다(실측). 거르는 것은 **행을 만들 때**다.
  const linksByConv = new Map();       // conversation_id -> 등록에 쓸 대표 링크
  const linkLikeConvIds = new Set();   // 검색어가 게스트 이름·이메일에 맞은 대화방
  if (want.includes('guest_link') || want.includes('chat')) {
    const base = { business_id: businessId, client_id: null, revoked_at: null };
    const links = await GuestLink.findAll({
      where: base, order: [['last_used_at', 'DESC']], limit: perSource,
      attributes: ['id', 'conversation_id', 'guest_name', 'requested_email', 'contact_email',
        'email_verified_at', 'message_count', 'last_used_at', 'account_requested_at', 'created_at'],
    });
    for (const g of links) linksByConv.set(g.conversation_id, betterLink(linksByConv.get(g.conversation_id), g));
    // 검색은 **DB 와 같은 렌즈로** 판정한다 — 여기서 자바스크립트 substring 으로 흉내내면
    // 대소문자·콜레이션이 갈려 화면과 숫자가 어긋난다.
    if (like) {
      const m = await GuestLink.findAll({
        where: { ...base, [Op.or]: [{ guest_name: like }, { requested_email: like }, { contact_email: like }] },
        attributes: ['conversation_id'],
      });
      for (const r of m) linkLikeConvIds.add(r.conversation_id);
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
          company: companyFromEmail(outside?.email),
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

  // 3) 대화방 = 접점 **한 줄**. 링크가 있으면 그 링크가 이 대화의 **신원**이 된다.
  //
  // ★ 상한을 두지 않는다. 미연결 고객 대화방은 고객으로 등록되면 목록에서 빠지는 유한한 집합이고,
  //   상한을 두는 순간 아래 needs_reply 를 **배열에서 세게 되어** 숫자가 목록 상한에 잘린다
  //   (메일에서 903 → 300 으로 잘렸던 것과 같은 계열). 목록만 끝에서 자른다.
  const wantChat = want.includes('chat');
  const wantGuest = want.includes('guest_link');
  const convWhere = { business_id: businessId, client_id: null, channel_type: 'customer', archived_at: null };
  // 검색어가 **게스트 이름·이메일**에 맞은 대화도 들어온다 — 영업에서 사람을 찾는 방식이 그것이다.
  // 대화방 제목만 보면 "이메일로 찾았는데 안 나온다" 가 된다.
  if (like) {
    convWhere[Op.or] = [
      { title: like }, { display_name: like },
      ...(linkLikeConvIds.size ? [{ id: { [Op.in]: [...linkLikeConvIds] } }] : []),
    ];
  }
  let convNeedsReply = 0;      // 이 묶음(채팅+게스트)에서 답할 차례인 것 — 배열 길이가 아니라 누적
  // 자격을 통과한 것만 센다(아래 ★ 외부 발화 기준). 칩 선택과 무관하게 세어야 전체와 칩이 일치한다.
  let qChat = 0;               // 링크 없는 대화방
  let qGuest = 0;              // 링크가 붙은 대화방
  let qOrphan = 0;             // 대화방이 목록에 없는 링크
  // ★ 바깥에서 선언한다 — 안쪽 블록에서 const 로 만들면 고아 링크 루프가 그 변수를 못 본다(500).
  const qualifiedIds = new Set();
  if (wantChat || wantGuest) {
    const where = convWhere;
    const convs = await Conversation.findAll({
      where, order: [['last_message_at', 'DESC']],
      attributes: ['id', 'title', 'display_name', 'last_message_at', 'created_at'],
    });
    if (convs.length) {
      // 마지막 메시지 한 줄 — 목록에서 "무슨 이야기인지" 가 보여야 누를지 정한다.
      // ★ conversations 에는 last_message_direction 컬럼이 **없다**(email_threads 에만 있다).
      //   그 컬럼으로 판정하면 조용히 언제나 false 가 된다 — 마지막 메시지의 **보낸 사람**으로 판정한다.
      //   우리 워크스페이스 멤버가 아닌 사람(게스트·고객)이 마지막이면 우리가 답할 차례다.
      const convIds = convs.map((c) => c.id);
      const rows = await Message.findAll({
        where: { conversation_id: { [Op.in]: convIds }, is_deleted: false },
        order: [['id', 'DESC']], limit: convs.length * 3,
        attributes: ['id', 'conversation_id', 'content', 'sender_id', 'is_ai', 'created_at'],
      });
      const lastByConv = new Map();
      for (const m of rows) if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);

      // ★ 2026-09-12 (Irene: "채팅도 고객이 아무말도 안남겨도 나오는데") —
      //   **고객·게스트가 실제로 말한 적이 있는 방만** 상담이다. 여태는 방이 있으면 올라왔다.
      //   방마다 발화자를 모아, 우리 멤버가 아닌 사람이 한 번이라도 말했는지로 가른다.
      //   (Cue 자동응답은 우리 쪽이므로 is_ai 는 제외한다 — 그것은 고객의 말이 아니다.)
      const speakers = await Message.findAll({
        where: { conversation_id: { [Op.in]: convIds }, is_deleted: false, is_ai: false },
        attributes: ['conversation_id', 'sender_id'],
        group: ['conversation_id', 'sender_id'], raw: true,
      });
      const senderIds = [...new Set([
        ...speakers.map((s) => s.sender_id),
        ...[...lastByConv.values()].map((m) => m.sender_id),
      ].filter(Boolean))];
      const memberIds = new Set();
      if (senderIds.length) {
        const { BusinessMember } = require('../models');
        const ms = await BusinessMember.findAll({
          where: { business_id: businessId, user_id: { [Op.in]: senderIds }, removed_at: null },
          attributes: ['user_id'],
        });
        for (const m of ms) memberIds.add(m.user_id);
      }
      const spoke = new Set();
      for (const s of speakers) if (s.sender_id && !memberIds.has(s.sender_id)) spoke.add(s.conversation_id);
      // 자격 통과분 — 목록도 집계도 이 집합만 본다(둘이 갈라지지 않게).
      const qualified = convs.filter((c) => spoke.has(c.id));
      for (const c of qualified) qualifiedIds.add(c.id);
      for (const c of qualified) {
        const link = linksByConv.get(c.id) || null;
        // 집계는 칩 선택과 무관하게 — 그래야 "전체 7" 인데 칩을 누르면 9 가 되는 일이 없다.
        if (link) qGuest += 1; else qChat += 1;
        // 선택한 소스 칩에 맞는 것만 그린다 — 링크가 있으면 "게스트 문의", 없으면 "채팅".
        if (link ? !wantGuest : !wantChat) continue;
        const last = lastByConv.get(c.id) || null;
        // 답할 차례 = 마지막 발화가 우리 쪽이 아니거나, 게스트가 계정을 달라고 했거나.
        const needsReplyRow = (!!last && !last.is_ai && !memberIds.has(last.sender_id))
          || !!(link && link.account_requested_at);
        if (needsReplyRow) convNeedsReply += 1;
        items.push({
          source: link ? 'guest_link' : 'chat',
          id: link ? `guest_link:${link.id}` : `chat:${c.id}`,
          // ★ 등록은 **링크로** 나간다 — 서버(sale_save.js)가 대화방은 안 받지만 링크는 받는다.
          //   그래서 이메일을 남긴 게스트 대화는 채팅이어도 "고객으로 등록" 이 된다.
          ref: link
            ? { kind: 'guest_link', id: link.id, conversation_id: c.id }
            : { kind: 'conversation', id: c.id },
          who: (link && (link.guest_name || link.contact_email || link.requested_email))
            || c.display_name || c.title || null,
          email: link ? link.contact_email || link.requested_email || null : null,
          company: companyFromEmail(link && (link.contact_email || link.requested_email)),
          title: c.title || null,
          preview: clean(last?.content),
          at: c.last_message_at || last?.created_at || c.created_at,
          needs_reply: needsReplyRow,
          meta: {
            email_verified: !!(link && link.email_verified_at),
            account_requested_at: link?.account_requested_at || null,
            message_count: link?.message_count ?? null,
          },
          open_path: `/talk?conv=${c.id}`,
        });
      }
    }
    // 대화방이 이 목록에 없는 링크(보관됨·고객 대화방이 아닌 방) — 그래도 문의는 문의다.
    // ★ 링크만 있고 **아무도 말하지 않은** 방은 상담이 아니다 — 우리가 문을 열어둔 것일 뿐이다.
    //   계정을 달라고 한 것(account_requested_at)은 그 자체가 말이므로 자격으로 친다.
    //   (자격을 통과한 링크 대화방은 위 루프가 이미 대화방 제목·미리보기와 함께 그렸다.)
    for (const [convId, g] of linksByConv) {
      if (qualifiedIds.has(convId) || !g.account_requested_at) continue;
      qOrphan += 1;
    }
    if (wantGuest) {
      for (const [convId, g] of linksByConv) {
        if (qualifiedIds.has(convId) || !g.account_requested_at) continue;
        if (g.account_requested_at) convNeedsReply += 1;
        items.push({
          source: 'guest_link',
          id: `guest_link:${g.id}`,
          ref: { kind: 'guest_link', id: g.id, conversation_id: convId },
          who: g.guest_name || g.contact_email || g.requested_email || null,
          email: g.contact_email || g.requested_email || null,
          company: companyFromEmail(g.contact_email || g.requested_email),
          title: null,
          preview: null,
          at: g.last_used_at || g.created_at,
          needs_reply: !!g.account_requested_at,
          meta: {
            email_verified: !!g.email_verified_at,
            account_requested_at: g.account_requested_at,
            message_count: g.message_count,
          },
          open_path: `/talk?conv=${convId}`,
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
  // 게스트·채팅은 **같은 대화**를 가리키므로 아래 한 곳에서 대화방 단위로 같이 센다.
  // 따로 세면 겹친 만큼 합계가 부푼다(실측 3건이 양쪽에 떠 있었다).
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
  if (wantChat || wantGuest) {
    // ★ 자격(외부 발화)을 통과한 것만 센다. 목록을 만들며 함께 세었으므로 두 숫자가 갈라지지 않는다.
    //   칩 선택과 무관하게 세므로 전체와 칩이 항상 일치한다.
    if (wantChat) counts.chat = qChat;
    if (wantGuest) counts.guest_link = qGuest + qOrphan;
    counts.needs_reply += convNeedsReply;
  }
  counts.total = counts.guest_link + counts.email + counts.chat;
  return { items: sliced.slice(0, limit), counts };
}

/**
 * 상담 목록 — **진행 중인 상담 전부**. (Irene 2026-09-12:
 *   "문의받은 내용 추가 > 상담 리스트에서 관리 및 다음 액션. 이렇게 되어야지.")
 *
 * ★ 여태 이 목록은 **미등록 접점만** 보여줬다. 그래서 문의를 추가하면 고객 레코드가 생겨
 *   상담 목록에서 **사라지고** 고객 탭으로 가버렸다 — 다음 액션을 할 자리가 없어졌다
 *   (Irene: "상담리스트에 아무것도 안나오고 고객리스트만 추가되더니 다음 할일 정할 액션 아무것도 없고").
 *   이제 두 원천을 **한 목록**으로 합친다:
 *     ① 아직 고객이 아닌 접점(게스트 링크·메일·채팅) — listUnlinkedTouchpoints
 *     ② 영업이 진행 중인 고객(sales_stage inquiry~negotiation) — 등록했어도 상담은 계속된다
 *   합치는 곳은 여기 하나다. 화면이 두 번 부르면 숫자와 목록이 갈라진다.
 */
async function listConsults(businessId, opts = {}) {
  const { userId = null, sources = null, q = null, needsReply = false, limit = 100 } = opts;
  const base = await listUnlinkedTouchpoints(businessId, { userId, sources, q, needsReply, limit });

  // 소스 칩으로 접점 종류를 고른 경우엔 고객 행을 섞지 않는다(그 칩의 뜻이 "메일 문의" 이므로).
  const wantClients = !Array.isArray(sources) || sources.length === 0;
  if (!wantClients) return { ...base, counts: { ...base.counts, client: 0 } };

  const { Client } = require('../models');
  const { IN_PROGRESS, saleOwnerWhere } = require('./saleCommon');
  const isManager = !!opts.isManager;
  const ownerWhere = userId ? await saleOwnerWhere(businessId, userId, { isManager }) : {};
  const where = { business_id: businessId, sales_stage: { [Op.in]: IN_PROGRESS }, ...ownerWhere };
  if (q) {
    const like = { [Op.like]: `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%` };
    where[Op.or] = [{ display_name: like }, { company_name: like }, { phone: like }, { invite_email: like }];
  }
  const rows = await Client.findAll({
    where,
    attributes: ['id', 'display_name', 'company_name', 'phone', 'invite_email', 'status',
      'sales_stage', 'sales_source', 'last_touch_at', 'created_at', 'assigned_member_id'],
    order: [['last_touch_at', 'DESC']],
    limit: Math.min(Math.max(limit * 3, 200), 500),
  });

  // 답할 차례 — 들어온 지 하루가 지났는데 우리가 아직 아무것도 안 한 문의(확인필요의 술어와 같은 뜻).
  //   여기서는 목록 표시용이므로 단순하게: 단계가 inquiry 이고 접점 기록이 없으면 답할 차례다.
  const { ClientInteraction } = require('../models');
  const ids = rows.map((c) => c.id);
  const touched = new Set();
  if (ids.length) {
    const its = await ClientInteraction.findAll({
      where: { business_id: businessId, client_id: { [Op.in]: ids }, deleted_at: null },
      attributes: ['client_id'], group: ['client_id'], raw: true,
    });
    for (const it of its) touched.add(it.client_id);
  }

  const clientItems = rows.map((c) => ({
    source: 'client',
    id: `client:${c.id}`,
    ref: { kind: 'client', id: c.id },
    client_id: c.id,
    stage: c.sales_stage,
    who: c.display_name || c.company_name || c.invite_email || `#${c.id}`,
    email: c.invite_email || null,
    phone: c.phone || null,
    company: c.company_name ? { name: c.company_name, estimated: false } : companyFromEmail(c.invite_email),
    title: null,
    preview: null,
    at: c.last_touch_at || c.created_at,
    needs_reply: c.sales_stage === 'inquiry' && !touched.has(c.id),
    meta: { status: c.status, sales_source: c.sales_source, assigned_member_id: c.assigned_member_id },
    open_path: `/sale/${c.id}`,
  }));

  const filtered = needsReply ? clientItems.filter((x) => x.needs_reply) : clientItems;
  // ★ **등록된 상담이 먼저다.** 시각만으로 섞으면 메일 접점 수백 건 뒤로 밀려 목록에서 사라진다
  //   (실측: dev 에서 메일 903건이 앞을 다 먹어 방금 만든 상담 고객이 첫 100건 안에 없었다).
  //   사람이 관리하는 대상(상담 중인 고객)이 위, 아직 손대지 않은 접점이 아래다.
  //   같은 묶음 안에서는 최신 접점 순 — `last_touch_at` 이 없으면 만든 시각을 쓴다(위에서 채웠다).
  const byAt = (a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime();
  const merged = [...filtered.sort(byAt), ...base.items.sort(byAt)].slice(0, limit);
  const counts = {
    ...base.counts,
    client: filtered.length,
    total: base.counts.total + filtered.length,
    needs_reply: base.counts.needs_reply + clientItems.filter((x) => x.needs_reply).length,
  };
  return { items: merged, counts };
}

module.exports = { listUnlinkedTouchpoints, listConsults, SOURCES };
