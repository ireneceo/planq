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
const { mailThreadVerdict } = require('./saleMailCriteria');

/** 스레드별 **사람이 내린 최신 판단** 1건 — dismiss · purge · restore · promote 가 한 원장을 쓴다.
 *
 * ★ 원장은 **한 번만** 읽는다. 보관함 수집기와 메일 판정이 각자 읽으면 같은 기록을 두 번 해석하게 되고,
 *   그 둘이 어긋나는 날 "보관했는데 상담에도 있다" 가 된다(같은 값의 공식 두 벌).
 */
async function latestMailJudgments(businessId) {
  const { AuditLog } = require('../models');
  const logs = await AuditLog.findAll({
    where: { business_id: businessId, action: 'mail.triage_correct', target_type: 'email_thread' },
    attributes: ['target_id', 'new_value', 'created_at', 'user_id'],
    // ★ 동률 깨기로 id 를 같이 쓴다. created_at 만으로 정렬하면 **같은 초에 찍힌 두 판단**의
    //   순서가 갈리지 않아, 되돌려도 보관함에 남는다(양성 대조군이 실제로 FAIL 을 냈다).
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: 2000,
  });
  const latest = new Map();   // thread_id -> 최신 판단 1건
  for (const l of logs) if (!latest.has(l.target_id)) latest.set(l.target_id, l);
  return latest;
}

/** 사람이 [상담으로 보내기] 를 누른 **대화방** id. 메일과 같은 축(판단의 기록)이다.
 *  ★ 되돌림(sale_inbox_demote)이 더 최신이면 빠진다 — 지우지 않고 새 기록으로 뒤집는다. */
async function promotedConversationIds(businessId) {
  const { AuditLog } = require('../models');
  const logs = await AuditLog.findAll({
    where: { business_id: businessId, action: 'sale.inbox_promote', target_type: 'conversation' },
    attributes: ['target_id', 'new_value', 'created_at'],
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit: 2000,
  });
  const latest = new Map();
  for (const l of logs) if (!latest.has(l.target_id)) latest.set(l.target_id, l);
  const out = new Set();
  for (const [cid, l] of latest) {
    if ((l.new_value && l.new_value.origin) !== 'sale_inbox_demote') out.add(cid);
  }
  return out;
}

/**
 * 고객 미연결 메일을 **상담 / 후보** 로 가른다 (2026-09-16).
 *
 * ★ 목록과 집계가 **이 함수 하나**를 쓴다. 여태는 각자 돌면서 같은 술어를 두 벌로 적어 두었고,
 *   그래서 한쪽만 고치면 "숫자는 903인데 목록엔 889" 가 될 수 있는 구조였다.
 *   판정 자체는 services/saleMailCriteria 한 곳이다.
 */
async function classifyMailThreads(businessId, { userId = null, like = null, judgments = null } = {}) {
  const empty = { inquiryIds: [], candidateIds: [], meta: new Map(), acctIds: [] };
  const acctIds = await accessibleAccountIds(businessId, userId);
  if (!acctIds.length) return empty;
  const w = {
    business_id: businessId, client_id: null, account_id: { [Op.in]: acctIds },
    // ★ 2026-09-17 — **`archived` 를 빼지 않는다.** Q mail 의 [확인완료] 가 찍는 값이
    //   `status='archived'` 인데(`routes/email_threads.js` mark-handled), 여기서 제외하는 바람에
    //   **메일을 처리하는 순간 그 건이 Q sale 상담에서 사라졌다.**
    //   «우리가 답하면 관계로 인정» 해 놓고 «확인완료하면 소멸» 시키는 자기모순이었고,
    //   그래서 파이프라인이 쌓일 수가 없었다 — 운영 실측 biz1 `human/archived` 210건 안에
    //   실제 거래(멤버십 문의·계약갱신·POS 교체·협력 제안 등)가 최소 7~8건 들어 있었다.
    //   상담에서 나가는 문은 «고객으로 등록»(client_id 가 채워져 자연히 빠진다) 또는 [보관] 이지
    //   «메일 확인완료» 가 아니다. spam 만 계속 뺀다.
    status: { [Op.ne]: 'spam' }, triage: 'human',
  };
  if (like) w[Op.or] = [{ subject: like }, { last_message_preview: like }];
  // 가볍게 전부 받아 분류한다 — 상한에서 자르면 **숫자가 잘린다**(목록만 뒤에서 자른다).
  const rows = await EmailThread.findAll({
    where: w, order: [['last_message_at', 'DESC']],
    attributes: ['id', 'participants', 'reply_needed', 'last_message_at', 'status'], raw: true, limit: 5000,
  });
  if (!rows.length) return { ...empty, acctIds };

  const { EmailMessage } = require('../models');
  const ids = rows.map((r) => r.id);
  // 바깥 사람 주소 — participants 에 없으면 첫 **수신** 메일의 보낸 주소로 채운다(실측: who 가 빈 스레드가 있다)
  const needWho = rows.filter((r) => !(Array.isArray(r.participants) ? r.participants : []).some((x) => x && !x.is_internal)).map((r) => r.id);
  const firstInbound = new Map();
  for (let i = 0; i < needWho.length; i += 1000) {
    const chunk = needWho.slice(i, i + 1000);
    const ems = await EmailMessage.findAll({
      where: { business_id: businessId, thread_id: { [Op.in]: chunk }, direction: 'inbound' },
      order: [['sent_at', 'ASC']], attributes: ['thread_id', 'from_name', 'from_email'], raw: true,
    });
    for (const e of ems) if (!firstInbound.has(e.thread_id)) firstInbound.set(e.thread_id, e);
  }
  // 우리가 보낸 메일 수 — **관계**의 증거다. 스레드마다 세지 않고 한 번에 묶어 센다.
  const outByThread = new Map();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const cnt = await EmailMessage.findAll({
      where: { business_id: businessId, thread_id: { [Op.in]: chunk }, direction: 'outbound' },
      attributes: ['thread_id'], raw: true,
    });
    for (const c of cnt) outByThread.set(c.thread_id, (outByThread.get(c.thread_id) || 0) + 1);
  }

  const { isAutomatedSenderAddress } = require('./emailTriage');
  const inquiryIds = []; const candidateIds = []; const meta = new Map();
  for (const r of rows) {
    const outside = (Array.isArray(r.participants) ? r.participants : []).find((x) => x && !x.is_internal)
      || (() => { const e = firstInbound.get(r.id); return e ? { name: e.from_name, email: e.from_email } : null; })();
    // ★ 사람의 판단을 **기계 판정보다 먼저** 읽는다 (2026-09-17, Fable 게이트 FAIL).
    //   여태는 발송전용 주소를 여기서 통째로 `continue` 시켰는데, 그 자리가 **[상담으로 보내기]의
    //   막다른 길**이었다 — 웹폼 릴레이(`no-reply@wix.com`·`tally.so`·구글폼)로 들어온 **진짜 문의**를
    //   사람이 올려도 상담에도 후보에도 안 나타났다. 서버는 200 `promoted` 를 주고 화면은 메뉴를
    //   내주는데 아무 일도 안 일어난다(Fable 실측: 상담 35→35 · 후보 854→854).
    //   자동발송 판정은 **자동 유입을 좁히는 휴리스틱**이다. 사람이 "이건 문의다" 라고 말한 것을
    //   휴리스틱이 덮으면 그 문은 존재하지 않는 것과 같다.
    const j = judgments ? judgments.get(r.id) : null;
    const origin = j && j.new_value && j.new_value.origin;
    // 보관·영구삭제는 이 칸의 소관이 아니다(2-B 가 따로 본다). 여기서 또 세면 두 곳에 뜬다.
    if (origin === 'sale_inbox_dismiss' || origin === 'sale_inbox_purge') continue;
    // 되돌리기도 올리기와 같은 뜻이다(아래 `promoted` 와 **같은 목록**을 쓴다 — 두 벌이면 갈라진다).
    const humanPromoted = origin === 'sale_inbox_promote' || origin === 'sale_inbox_restore';
    // 발송 전용 주소는 **어느 칸에도** 넣지 않는다 — 후보로도 볼 일이 없다(2026-09-12 판정 그대로).
    //   단, 사람이 올린 것은 예외다(위 주석).
    if (!humanPromoted && outside?.email && isAutomatedSenderAddress(outside.email)) continue;
    const v = mailThreadVerdict({
      email: outside?.email || null,
      outboundCount: outByThread.get(r.id) || 0,
      // ★ 되돌리기도 **사람이 "이건 문의다" 라고 말한 것**이다. 올리기와 같은 뜻으로 읽는다.
      //   (실측으로 잡았다 — 보관함에서 되돌렸더니 상담이 아니라 후보로 떨어졌다.
      //    사용자에게는 "되돌렸는데 안 돌아온다" 로 보인다. 되돌리기의 뜻이 사라진 자리다.)
      promoted: humanPromoted,
    });
    // ★ 확인완료(archived)한 건은 목록에 **남되 «답할 차례» 로 세지 않는다.**
    //   그 숫자는 «지금 내가 할 일» 의 수다 — 처리한 것을 거기 넣으면 숫자가 거짓이 된다.
    const handled = r.status === 'archived';
    meta.set(r.id, { outside, verdict: v, reply_needed: handled ? false : !!r.reply_needed, handled });
    (v.kind === 'inquiry' ? inquiryIds : candidateIds).push(r.id);
  }
  return { inquiryIds, candidateIds, meta, acctIds };
}


// ★ 2026-09-13 (Irene: "문의아님 분류한거 다시 되돌리고 싶으면 어떻게 해? 문의아님으로 분리한 탭이나
//   휴지통처럼 따로 임시보관 해야 하는 거 아니야?") — `dismissed` 는 **보관함**이다.
//   ☐ 급소: [문의 아님]은 triage 를 'automated' 로 바꾸는데, 그건 **원래 자동발송 메일과 구별이 안 된다**
//     (dev 실측 2,137건). 그래서 보관함은 triage 로 찾지 않고 **사람이 내린 판단의 기록**,
//     즉 감사 로그(action='mail.triage_correct' · new_value.origin='sale_inbox_dismiss')로 찾는다.
//     새 컬럼 0건이고, "누가 언제 내렸는지" 도 그 기록에 이미 있다.
// ★ 2026-09-17 — **`candidate`(후보) 칸을 뺐다.** 2026-09-16 에 «기준을 좁힌 대신 걸러진 것을
//   볼 자리» 로 두었는데, 운영에 쌓인 **22건을 전수로 열어 보니 진짜 문의가 0건**이었다
//   (삼성생명 자동이체 · 카드 약관 · 주문알림 · 뉴스레터…). 후보는 «좁혀서 놓친 문의» 가 아니라
//   **triage 가 사람으로 오판한 자동메일**이 모이는 자리였다. 행동도 그것을 말한다 —
//   [상담으로 보내기] 0회 · [보관/무시] 7회. 열어서 **버리기만** 했다. 기능이 일을 만들었다.
//
//   ★ 좁히는 기준(`mailThreadVerdict`)과 **[상담으로 보내기] 문은 그대로 둔다.**
//     그 문은 Q mail 목록 우클릭·상세 ⋯ 에 이미 있다 — 메일을 읽다가 «이건 문의다» 하고 올리는 것이
//     후보 탭에서 노이즈를 뒤지는 것보다 자연스럽다. 문이 없으면 놓친 문의를 살릴 길이 사라진다.
//   ★ 분류 자체는 남는다(`candidateIds`) — 상담에 넣지 않을 근거로 계속 쓴다.
//   보관함(dismissed)과 같은 성격이다 — 목록엔 기본으로 안 넣고, 숫자는 늘 센다.
const SOURCES = ['guest_link', 'email', 'chat', 'dismissed'];

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
  // ★ 2026-09-14 (Irene: *"리스트에는 보관함에 있는 리스트는 전체 리스트에서 빼고."*)
  //   `SOURCES` 에 'dismissed' 가 들어 있어서, 소스를 안 고르면(= 전체) **보관한 것까지 같이** 나왔다.
  //   보관함은 "치운 것" 이다 — 치웠는데 전체 목록에 그대로 있으면 치운 것이 아니다.
  //   숫자(칩의 보관함 N)는 계속 세야 하므로 **집계는 늘 하고, 목록에만 안 넣는다.**
  const ACTIVE_SOURCES = ['guest_link', 'email', 'chat'];
  const want = Array.isArray(sources) && sources.length
    ? sources.filter((s) => SOURCES.includes(s))
    : ACTIVE_SOURCES;
  const wantDismissedItems = want.includes('dismissed');
  // ★ 소스별 조회 상한은 **목록용 여유분**이고 집계(counts)를 자르면 안 된다.
  //   운영 #(확인필요 35→51)과 같은 계열 — 숫자가 목록 상한에 잘리면 사용자는 "왜 숫자가 안 맞지" 로 읽는다.
  //   목록은 아래에서 limit 으로 자르고, counts 는 여기서 모은 전체로 센다.
  const perSource = Math.min(Math.max(limit * 3, 300), 1000);
  const like = q ? { [Op.like]: `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%` } : null;
  const items = [];
  // 사람이 내린 판단(보관·되돌림·영구삭제·상담으로 보내기)은 **한 번** 읽어 아래 두 곳이 같이 쓴다.
  const judgments = await latestMailJudgments(businessId);
  const promotedConvs = await promotedConversationIds(businessId);

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
  //
  // ★ 2026-09-16 — 이 칸에 들어오는 기준이 **관계**로 바뀌었다(services/saleMailCriteria).
  //   Irene: *"영업 상담으로 가져오는 기준설정 좀 잡아봐. 그냥 신청하라는 홍보메일도 가져오면 어떻게 해?"*
  //   우리가 답했거나 · 개인 주소에서 온 것만 자동으로 들어오고, 나머지는 **후보** 칸으로 간다.
  //   판정은 위 classifyMailThreads 한 번으로 끝난다 — 목록과 집계가 같은 결과를 읽는다.
  const mailClass = await classifyMailThreads(businessId, { userId, like, judgments });
  {
    const wantIds = want.includes('email') ? mailClass.inquiryIds : [];
    const asCandidate = false;   // 후보 칸 제거(위 주석) — 분류는 남지만 목록에는 안 나온다
    if (wantIds.length) {
      const showIds = wantIds.slice(0, perSource);
      const threads = await EmailThread.findAll({
        where: { id: { [Op.in]: showIds } }, order: [['last_message_at', 'DESC']],
        attributes: ['id', 'subject', 'last_message_at', 'last_message_preview',
          'last_message_direction', 'unread_count', 'reply_needed', 'reply_needed_reason', 'created_at'],
      });
      for (const t of threads) {
        const m = mailClass.meta.get(t.id);
        const outside = m ? m.outside : null;
        items.push({
          source: asCandidate ? 'candidate' : 'email',
          id: `${asCandidate ? 'candidate' : 'email'}:${t.id}`,
          ref: { kind: 'email_thread', id: t.id },
          who: outside?.name || outside?.email || null,
          email: outside?.email || null,
          company: companyFromEmail(outside?.email),
          title: t.subject || null,
          preview: clean(t.last_message_preview),
          at: t.last_message_at || t.created_at,
          // 후보는 아직 상담이 아니다 — "답할 차례" 로 세지 않는다(그 숫자는 할 일의 수다).
          //   확인완료한 건은 답할 차례가 아니다(위 meta 와 같은 판정 — 두 벌로 쓰지 않는다).
          needs_reply: asCandidate ? false : !!(m && m.reply_needed),
          handled: !!(m && m.handled),
          meta: {
            unread_count: t.unread_count, direction: t.last_message_direction,
            reason: t.reply_needed_reason,
            // 왜 이 칸에 있는지 — 화면이 기준을 한 줄로 알려줄 근거다(feedback_rules_must_be_explained_briefly)
            verdict: m ? m.verdict.reason : null,
          },
          open_path: `/mail?thread=${t.id}`,
        });
      }
    }
  }

  // 2-B) 보관함 — 사람이 [문의 아님] 이라고 판단해 내린 것. **되돌릴 수 있어야 한다**(Irene 2026-09-13).
  //
  // ★ triage='automated' 로 찾으면 **원래 자동발송 메일까지 전부 딸려온다**(dev 실측 2,137건).
  //   보관함의 뜻은 "사람이 내린 판단" 이므로 그 **판단의 기록**(감사 로그)으로 찾는다. 새 컬럼 0건.
  // ★ 스레드별 **최신 1건**만 본다 — 되돌리면 `sale_inbox_restore` 가 최신이 되어 자동으로 빠진다.
  //   (지우지 않고 새 기록으로 뒤집는다 — 누가 언제 내린 판단인지가 남아야 한다.)
  let qDismissed = 0;          // 보관함 수 — counts 는 아래에서 선언되므로 여기선 누적만 한다
  // 집계는 **언제나** 한다(칩에 숫자가 떠야 한다). 행을 목록에 넣는 것만 고른 때로 제한한다.
  {
    // 원장은 위에서 한 번 읽었다(judgments) — 여기서 또 읽지 않는다.
    const latest = judgments;
    const dismissedIds = [];
    const byThread = new Map();
    for (const [tid, l] of latest) {
      const origin = l.new_value && l.new_value.origin;
      // 최신 판단이 purge 이면 **보관함에서도 뺀다**(2026-09-14 "영구히 삭제").
      //   메일 자체는 Q mail 에 그대로 있다 — 여기서 빠지는 것은 상담 목록에서의 자리다.
      if (origin === 'sale_inbox_dismiss') { dismissedIds.push(tid); byThread.set(tid, l); }
    }
    if (dismissedIds.length) {
      const acctIds = await accessibleAccountIds(businessId, userId);
      const w = {
        id: { [Op.in]: dismissedIds }, business_id: businessId, client_id: null,
        account_id: { [Op.in]: acctIds.length ? acctIds : [0] },
      };
      if (like) w[Op.or] = [{ subject: like }, { last_message_preview: like }];
      const rows = await EmailThread.findAll({
        where: w, order: [['last_message_at', 'DESC']], limit: perSource,
        attributes: ['id', 'subject', 'participants', 'last_message_at', 'last_message_preview', 'created_at'],
      });
      // ★ counts 는 **아래(386줄)에서 선언**된다 — 여기서 쓰면 선언 전 참조다.
      //   누적만 해두고 숫자는 그 뒤에 옮긴다(2026-09-12 qualifiedIds 와 같은 사고를 되풀이하지 않는다).
      qDismissed += rows.length;
      for (const t of wantDismissedItems ? rows : []) {
        const outside = (Array.isArray(t.participants) ? t.participants : []).find((p) => p && !p.is_internal);
        const l = byThread.get(t.id);
        items.push({
          source: 'dismissed',
          id: `dismissed:${t.id}`,
          ref: { kind: 'email_thread', id: t.id },
          who: outside?.name || outside?.email || null,
          email: outside?.email || null,
          company: companyFromEmail(outside?.email),
          title: t.subject || null,
          preview: clean(t.last_message_preview),
          at: t.last_message_at || t.created_at,
          needs_reply: false,                    // 보관함은 대응 대상이 아니다
          meta: { dismissed_at: l ? l.created_at : null, dismissed_by: l ? l.user_id : null },
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
      // ★ 2026-09-16 — 사람이 [상담으로 보내기] 를 누른 방은 **발화 조건을 묻지 않는다.**
      //   기계 기준(외부 발화 있음)은 놓치는 것이 있고, 그때 사람이 올리는 문이 이것이다.
      //   Irene: *"메일목록에서, 채팅 메시지에서, 상담리스트로 보내기 기능이 있어야 할 것 같아."*
      const qualified = convs.filter((c) => spoke.has(c.id) || promotedConvs.has(c.id));
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
  const counts = { total: 0, needs_reply: 0, guest_link: 0, email: 0, chat: 0, dismissed: 0 };
  // 보관함은 위에서 목록을 만들며 함께 세었다 — 두 숫자가 갈라지지 않게 그 값을 그대로 옮긴다.
  // ★ 2026-09-14 — 여기 `if (want.includes('dismissed'))` 가 있었다. 기본 목록에서 보관함을
  //   **빼면서**(ACTIVE_SOURCES) 이 조건이 거짓이 되어, **칩에는 1건이 있는데 숫자는 0** 이 됐다.
  //   양성 대조군이 잡았다(실제로 하나 보관해 보니 0 → 0). 집계는 **언제나** 옮긴다 —
  //   숫자와 목록이 갈라지는 것은 이 저장소에서 이미 여러 번 난 사고다.
  counts.dismissed = qDismissed;
  // 게스트·채팅은 **같은 대화**를 가리키므로 아래 한 곳에서 대화방 단위로 같이 센다.
  // 따로 세면 겹친 만큼 합계가 부푼다(실측 3건이 양쪽에 떠 있었다).
  // ★ 메일 숫자는 위 분류(classifyMailThreads)가 이미 **전부** 센 값이다 — 여기서 다시 세지 않는다.
  //   여태는 목록과 집계가 각자 같은 술어를 적어 두 벌이었다. 한 벌로 줄이면 갈라질 수가 없다.
  //   칩 선택과 무관하게 옮긴다 — 보관함에서 "칩엔 1건인데 숫자는 0" 이 났던 것과 같은 계열이다.
  counts.email = mailClass.inquiryIds.length;
  counts.needs_reply += mailClass.inquiryIds.filter((id) => mailClass.meta.get(id)?.reply_needed).length;
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
  const {
    userId = null, sources = null, q = null, needsReply = false, limit = 100,
    // ★ 2026-09-13 (Irene: "리스트에도 필터가 제대로 있어야지 단계필터 나오게 해" ·
    //   "상담 리스트에는 종료 가리기 넣고 체크해놔")
    //   · stage       — 단계 한 개로 좁힌다. 미등록 문의는 단계가 없으므로 이때 제외된다(단계로 고른 것이니 당연하다)
    //   · includeClosed — 기본 false(= 종료 가림). 성사/불발은 **끝난 상담**이라 기본 목록에 없다
    stage = null, includeClosed = false,
    // ★ 2026-09-14 (Irene: *"고객탭이랑 같은 필터 나오게 해. 상담탭에도."*)
    //   접근 종류·담당자는 고객 목록의 축이었는데 상담 목록에는 없었다. 같은 축을 같은 술어로 건다.
    //   · access   — `services/clientAccess.accessWhere` 하나를 쓴다(목록마다 다시 쓰지 않는다)
    //   · assignee — 숫자면 그 멤버, 'none' 이면 미배정
    access = null, assignee = null,
  } = opts;
  // 단계와 같은 이유로, **고객에만 있는 축**으로 고르면 미등록 접점은 뜻이 없다.
  const clientOnlyFilter = !!(stage || access || assignee);
  // ★ 단계로 고르면 **미등록 접점은 뜻이 없다** — 단계가 아직 없기 때문이다.
  //   섞어 두면 "단계로 골랐는데 단계 없는 행이 남는" 화면이 된다.
  const base = clientOnlyFilter
    ? { items: [], counts: { total: 0, needs_reply: 0, guest_link: 0, email: 0, chat: 0, dismissed: 0 } }
    : await listUnlinkedTouchpoints(businessId, { userId, sources, q, needsReply, limit });

  // 소스 칩으로 접점 종류를 고른 경우엔 고객 행을 섞지 않는다(그 칩의 뜻이 "메일 문의" 이므로).
  const wantClients = !Array.isArray(sources) || sources.length === 0;
  if (!wantClients) return { ...base, counts: { ...base.counts, client: 0 } };

  const { Client } = require('../models');
  const { IN_PROGRESS, saleOwnerWhere } = require('./saleCommon');
  const isManager = !!opts.isManager;
  const ownerWhere = userId ? await saleOwnerWhere(businessId, userId, { isManager }) : {};
  // 종료(won/lost)를 포함할지 — 체크를 풀면 끝난 상담까지 보인다
  const CLOSED = ['won', 'lost'];
  const stageSet = stage ? [stage] : (includeClosed ? [...IN_PROGRESS, ...CLOSED] : IN_PROGRESS);
  const where = { business_id: businessId, sales_stage: { [Op.in]: stageSet }, ...ownerWhere };
  if (access) {
    const { accessWhere } = require('./clientAccess');
    const aw = accessWhere(access);
    if (aw) where[Op.and] = [...(where[Op.and] || []), aw];
  }
  if (assignee) {
    where.assigned_member_id = assignee === 'none' ? null : Number(assignee);
  }
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
  // ★ 2026-09-14 — 여기서 세던 것은 **메모가 아니라 응대 내역**이었다(다른 표다).
  //   그걸 `note_count` 로 내보내서 ①메모를 달아도 숫자가 안 늘고 ②응대 내역만 있는 행에
  //   메모 손잡이가 떴다. 메모 건수는 아래에서 `noteCountsForItems` 한 술어로 센다.
  //   이 쿼리는 이제 **`touched`(답할 차례 판정)** 만을 위한 것이다 — 그 뜻 그대로 남긴다.
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
  // ★ 메모 건수는 **행 종류를 가리지 않는다** — 메일·채팅·게스트·고객 전부에 붙인다.
  //   전에는 고객 행에만(그것도 응대 내역 건수로) 있어서, 메일 행에 메모를 달면 숫자가 영영 0 이었다.
  //   술어는 `services/saleCommon` 한 곳(화면 SaleNoteThread 의 대상 판정과 같다).
  const { noteCountsForItems, applyNoteCounts } = require('./saleCommon');
  applyNoteCounts(merged, await noteCountsForItems(merged, userId));
  const counts = {
    ...base.counts,
    client: filtered.length,
    total: base.counts.total + filtered.length,
    needs_reply: base.counts.needs_reply + clientItems.filter((x) => x.needs_reply).length,
  };
  return { items: merged, counts };
}

module.exports = { listUnlinkedTouchpoints, listConsults, SOURCES };
