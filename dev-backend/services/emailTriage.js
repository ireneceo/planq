// Q Mail — Inbound 트리아지 (사이클 N+83)
//   받은 메일을 수집 시점에 분류: human / automated / marketing / spam.
//   목적: (1) 사람 문의에 reply_needed 자동 설정 ("답변 필요" 폴더 작동)
//        (2) 자동알림·마케팅 벌크를 인박스에서 분리 (노이즈 제거)
//   원칙: LLM 호출 0 — 메일 헤더 + 발신자 패턴만으로 고신뢰 판정 (feedback_ai_minimal_usage).
//   spam 판정은 emailSpamFilter.classify 재사용 (단일 진실원천).

const { classify } = require('./emailSpamFilter');
// 헤더 읽기·정규화는 공용 모듈 단일 원천 (#221). 인입(mailparser Map)·재판정(평문 객체) 두 경로가
// 같은 입력으로 수렴한다 — 술어마다 Map 대응을 복붙하던 구조가 실제로 어긋났다 (services/emailHeaders.js 주석).
const { hget, normalizeHeaders, pickTriageHeaders, TRIAGE_HEADER_KEYS } = require('./emailHeaders');

// noreply / 시스템 발송 / 소셜 알림 발신자 패턴 (사람이 답장할 수 없는 주소)
const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|mailer|postmaster|bounce[sd]?|notifications?|alerts?|automated?|auto-?confirm|support\+|system|daemon|no_?return)([._-]|@)/i;
const SOCIAL_DOMAIN = /@([^>\s]*\.)?(linkedin|facebook|fb|twitter|instagram|tiktok|youtube|pinterest|reddit|medium|slack|notion|asana|trello|atlassian|zoom|calendly|meetup|eventbrite)\.[a-z.]+/i;

/** 재판정 시점 — 저장된 메시지 한 통에서 판정용 헤더를 복원한다.
 *  헤더 원문(triage_headers) + 이미 컬럼으로 있던 신호(to_emails · in_reply_to · references_chain)를 합친다.
 *  정규화는 `normalizeHeaders` 단일 원천 — 인입 경로와 **구조상 같은 객체**가 나와야 두 경로가 안 갈라진다. */
function headersFromMessage(msg) {
  if (!msg) return { headers: {}, complete: false };
  const stored = msg.triage_headers && typeof msg.triage_headers === 'object' ? msg.triage_headers : null;
  return {
    headers: normalizeHeaders({
      headers: stored,
      toEmails: msg.to_emails,
      inReplyTo: msg.in_reply_to,
      references: msg.references_chain,
    }),
    // complete = 수집 시점과 같은 정보를 갖췄다 → triage 를 처음부터 다시 계산해도 안전하다.
    complete: !!stored,
  };
}

// #200 — 한국 정보통신망법 §50: 영리 목적 광고 메일은 **제목 맨 앞에 `(광고)` 표기가 법정 의무**다.
//   헤더가 없는 옛 메일(triage_headers NULL)에도 통하는 유일한 확실 신호 — 실측: 운영 inbound 중
//   제목에 '광고' 가 든 11건 전부가 광고·자동발송이고, 접두 표기가 붙은 정당한 고객 메일은 0건.
//   ★ 반드시 **원문 subject + 맨 앞 앵커**로만 본다. thread.subject 는 'Re:' 가 제거돼 있어서
//     고객이 광고 메일을 인용해 되물은 회신("Re: (광고)…")을 광고로 오판할 수 있다.
const AD_PREFIX = /^\s*(re\s*:|fwd?\s*:)*\s*[([{<]\s*광고\s*[)\]}>]/i;
function hasAdPrefix(subject) {
  const s = String(subject || '');
  // 'Re:'/'Fwd:' 가 앞에 붙은 건 사람이 되보낸 것 — 광고 그 자체가 아니다
  if (/^\s*(re|fwd?)\s*:/i.test(s)) return false;
  return AD_PREFIX.test(s);
}

// 벌크/뉴스레터 시그널 — RFC 2369 List-* + Precedence (+ 법정 광고 표기)
function isMarketing(headers, subject) {
  if (hasAdPrefix(subject)) return true;
  if (hget(headers, 'list-unsubscribe')) return true;
  if (hget(headers, 'list-id')) return true;
  const prec = (hget(headers, 'precedence') || '').toLowerCase();
  if (/\b(bulk|list|junk)\b/.test(prec)) return true;
  // 흔한 ESP(대량발송) 헤더
  if (hget(headers, 'x-mailgun-sid') || hget(headers, 'x-sg-eid') || hget(headers, 'x-campaign') ||
      hget(headers, 'feedback-id') || hget(headers, 'x-csa-complaints')) return true;
  return false;
}

// 뉴스레터·캠페인 발신자 — List-* 헤더가 없는 옛 메일/일부 발송기 커버
// '@' 뒤(도메인 시작)도 경계로 인정한다 — team@news-mail.elementor.com 같은 발송 도메인이 흔하다
const NEWSLETTER_SENDER = /(^|[._@-])(news(letter)?s?|campaign|marketing|promo(tions?)?|digest|updates?|mailing|mailer)([._-]|@)/i;

// 자동발송(트랜잭션/알림) 시그널 — Auto-Submitted + 발신자 패턴
//   ownEmails: 이 워크스페이스가 소유한 메일 주소들 + 플랫폼 발신 주소.
//   우리가 보낸 메일이 우리 인박스로 되돌아오는 경우(시스템 알림·자기 참조)는 사람 문의가 아니다.
//   실측: 운영 "답변 필요" 116건 중 93건이 PlanQ 가 자기 자신에게 보낸 알림이었다.
function isAutomated(headers, fromEmail, ownEmails) {
  const auto = (hget(headers, 'auto-submitted') || '').toLowerCase();
  if (auto && auto !== 'no') return true;            // auto-generated / auto-replied
  if (hget(headers, 'x-auto-response-suppress')) return true;
  const f = String(fromEmail || '').toLowerCase().trim();
  if (ownEmails && ownEmails.size > 0 && ownEmails.has(f)) return true;   // 우리가 보낸 것
  if (AUTOMATED_SENDER.test(f)) return true;
  if (NEWSLETTER_SENDER.test(f)) return true;
  if (SOCIAL_DOMAIN.test(f)) return true;
  return false;
}

// 이 워크스페이스가 "우리 주소" 로 인정할 집합 — 연결된 메일 계정 + **발신 별칭** + 플랫폼 발신 주소
//
// ★ 이 집합이 현실보다 작으면 조용히 기능이 죽는다. isAddressedToUs 가 여기 없는 주소로 온 메일을
//   "우리에게 온 게 아님" 으로 읽어 **명백한 요청이 확인 권장으로 강등된다** (#221 · 재발 신고).
//   한 메일함이 여러 도메인 주소를 받는 것이 정상 운영이고(help@ 를 여러 브랜드로 운영), 그 주소들은
//   email_account_aliases 에 등록된다. 여태 별칭 테이블을 **아예 읽지 않아서** 별칭을 등록해도
//   판정이 달라지지 않았다 — 실측상 실제 도착 주소 9개 중 계정 3개만 알고 있었다.
//   (관측된 To 를 자동 등록하지는 않는다 — BCC 대량발송의 남의 주소가 섞여 집합이 오염된다.)
async function buildOwnEmailSet(businessId) {
  const set = new Set();
  const platformFrom = (process.env.SMTP_FROM || '').toLowerCase().trim();
  if (platformFrom) set.add(platformFrom);
  try {
    const { EmailAccount, EmailAccountAlias } = require('../models');
    const accs = await EmailAccount.findAll({
      where: { business_id: businessId },
      attributes: ['id', 'email'],
    });
    for (const a of accs) {
      const e = String(a.email || '').toLowerCase().trim();
      if (e) set.add(e);
    }
    // 별칭은 **계정 소속으로** 조회한다 — alias.business_id 를 믿지 않는다(계정 이관 시 어긋날 수 있다).
    const accIds = accs.map(a => a.id);
    if (accIds.length > 0) {
      const aliases = await EmailAccountAlias.findAll({
        where: { account_id: accIds },
        attributes: ['email'],
      });
      for (const al of aliases) {
        const e = String(al.email || '').toLowerCase().trim();
        if (e) set.add(e);
      }
    }
  } catch (e) { console.warn('[emailTriage] buildOwnEmailSet', e.message); }
  return set;
}


// 수신 인식용 주소 매처 — 정확 주소 + **우리 도메인 규칙**.
//
// ★ buildOwnEmailSet 을 넓히지 않고 별도 함수로 둔 이유가 핵심이다. ownEmails 는 두 가지 의미로
//   쓰인다:
//     · 수신 축 — isAddressedToUs("우리 주소로 왔는가")
//     · 발신 축 — isSelfSender / isAutomated("우리가 보낸 것인가" → 답변 필요에서 강등)
//   도메인을 그냥 합치면 발신 축까지 넓어져서, **우리 도메인의 미등록 동료**(예: PlanQ 에 연결 안 된
//   sales@irenewp.com)가 보낸 진짜 문의가 "우리가 보낸 것" 으로 강등된다. 조용히 사라지는 미스다.
//   그래서 도메인은 **수신 축에만** 들어간다.
//
// 반환은 plain object 로 고정한다 — Set 을 넘기다 재판정 경로에서 한 번 어긋난 전례가 있다.
async function buildOwnAddressMatcher(businessId) {
  const emails = [...(await buildOwnEmailSet(businessId))];
  let domains = [];
  try {
    const { EmailDomainRule } = require('../models');
    const rows = await EmailDomainRule.findAll({ where: { business_id: businessId }, attributes: ['domain'] });
    domains = rows.map((r) => String(r.domain || '').toLowerCase().trim()).filter(Boolean);
  } catch (e) { console.warn('[emailTriage] buildOwnAddressMatcher', e.message); }
  return { emails, domains };
}

// To/CC 헤더 문자열에서 실제 주소만 뽑는다.
//   부분 문자열 검사로는 도메인 경계를 지킬 수 없다 — '@wor-pro.com' 부분 일치는
//   evil@wor-pro.com.attacker.com 에도 걸린다.
function extractAddresses(headerValue) {
  const out = [];
  const re = /[^\s<>,;"']+@[^\s<>,;"']+/g;
  let m;
  while ((m = re.exec(String(headerValue || ''))) !== null) {
    const a = m[0].toLowerCase().replace(/[.,;:>]+$/, '');
    if (a.includes('@')) out.push(a);
  }
  return out;
}

// ── 업무 신호 (LLM 0) — Irene 정의:
//     답변 필요 = 업무 처리가 필요한 것 · 문의 · 기존 일과 연결되는 것 · 고객이 보낸 것
//     확인 권장 = 스팸·광고는 아닌데 업무인지 애매한 것
//
//   신호는 "사람이 우리에게 뭔가를 요구/문의했는가" 를 본다. 아는 상대(고객·멤버·기존 대화 상대)가
//   직접 쓴 메일이면 내용과 무관하게 답변 필요 — 단, 대량·자동 발송은 관계보다 먼저 걸러낸다(needsReply 참조).
const WORK_SIGNAL = new RegExp([
  '문의', '요청', '부탁', '확인\\s*부탁', '회신', '답변', '검토', '견적', '계약', '청구', '입금', '세금계산서',
  '일정', '미팅', '회의', '가능(할까요|한가요|하신가요)', '언제', '어떻게', '알려\\s*주', '보내\\s*주', '주실',
  '요약', '진행', '완료', '수정', '피드백', '승인', '결재',
  '\\bplease\\b', '\\bcould you\\b', '\\bcan you\\b', '\\bwould you\\b', '\\brequest\\b', '\\bquote\\b',
  '\\binquiry\\b', '\\bquestion\\b', '\\bfollow[- ]?up\\b', '\\blet me know\\b', '\\bfeedback\\b',
].join('|'), 'i');

// 사람이 쓴 말만 남긴다 — 링크·이미지·추적 URL 을 걷어낸다.
//   URL 쿼리스트링의 '?' 가 물음표로 잡혀서 배송 알림("...?u=aHR0cHM6...")이 답변 필요로 올라왔다.
function plainText(text) {
  return String(text || '')
    .replace(/<https?:\/\/[^>]*>/gi, ' ')   // 메일 클라이언트가 감싼 링크
    .replace(/https?:\/\/\S+/gi, ' ')       // 맨 URL
    .replace(/\[image:[^\]]*\]/gi, ' ')
    .replace(/\[cid:[^\]]*\]/gi, ' ');
}

// 질문 부호 — 한 줄이라도 물음표가 있으면 사람이 뭔가 묻고 있다 (링크 제외)
function hasQuestion(text) {
  return /[?？]/.test(plainText(text).slice(0, 4000));
}

function hasWorkSignal(subject, bodyText) {
  const head = `${subject || ''}\n${String(bodyText || '').slice(0, 2000)}`;
  return WORK_SIGNAL.test(head) || hasQuestion(head);
}

// ── 확실한 요청 (Irene 정책: 답변 필요는 "확실히 답해야 하는 것" 만, 애매하면 전부 확인 권장)
//   위 WORK_SIGNAL 은 물음표·'확인'·'진행' 같은 약한 신호까지 잡아서 뉴스레터도 통과했다
//   ("Your Weekly WP Mail SMTP ... ?"). 여기선 상대가 우리에게 무언가를 해달라고 한 문장만 본다.
const STRONG_REQUEST = new RegExp([
  '문의(드|합|가|를|사항)', '요청(드|합|이|을|사항)', '부탁\\s*(드|합)', '의뢰',
  '회신\\s*(부탁|주|바랍)', '답변\\s*(부탁|주|바랍)', '검토\\s*(부탁|요청|해\\s*주)',
  // '확인 바랍니다' 는 고지서·통지문의 상투구다 → 강한 요청으로 보지 않는다 (아는 상대면 어차피 답변 필요)
  '확인\\s*부탁', '보내\\s*주(세요|시)', '알려\\s*주(세요|시)', '주실\\s*수\\s*있',
  '견적', '계약서', '청구서', '세금계산서', '입금\\s*(확인|예정|완료)',
  '(미팅|회의|일정)\\s*(잡|조율|가능|어떠)', '가능(할까요|한가요|하신가요|하실까요)',
  '\\bcould you\\b', '\\bcan you\\b', '\\bwould you\\b', '\\bplease (send|share|review|confirm|advise|let us know)\\b',
  '\\brequest for\\b', '\\bquotation?\\b', '\\binquiry\\b', '\\bproposal\\b',
  '\\blooking forward to your (reply|response)\\b', '\\bawaiting your\\b',
].join('|'), 'i');

function hasStrongRequest(subject, bodyText) {
  const head = `${subject || ''}\n${plainText(bodyText).slice(0, 2000)}`;
  return STRONG_REQUEST.test(head);
}

// 우리 주소가 To 에 직접 있는가 (참조·숨은참조·대량발송 목록이 아니라)
//   own 은 세 형태를 받는다: Set / 배열(둘 다 옛 emails-only) / { emails, domains }(도메인 규칙 포함).
//   호출부가 섞여 있어서 형태를 좁히면 한쪽 경로가 조용히 죽는다.
function isAddressedToUs(headers, own) {
  let emails = [];
  let domains = [];
  if (own instanceof Set) emails = [...own];
  else if (Array.isArray(own)) emails = own;
  else if (own && typeof own === 'object') {
    emails = Array.isArray(own.emails) ? own.emails : [];
    domains = Array.isArray(own.domains) ? own.domains : [];
  }
  const ownSet = new Set(emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  const domSet = new Set(domains.map((d) => String(d).toLowerCase().trim()).filter(Boolean));
  if (ownSet.size === 0 && domSet.size === 0) return false;
  const to = (headers && (headers.to || headers.To)) || '';
  if (!to) return false;
  for (const addr of extractAddresses(to)) {
    if (ownSet.has(addr)) return true;
    // 도메인은 **정확 등가만** — 서브도메인 suffix 매치는 하지 않는다(fail-closed).
    //   help@mail.wor-pro.com 이 필요하면 그 도메인을 따로 등록한다.
    const at = addr.lastIndexOf('@');
    if (at > 0 && domSet.has(addr.slice(at + 1))) return true;
  }
  return false;
}

// 우리 대화에 대한 회신인가 (기존 일과 연결 — 가장 확실한 신호 중 하나)
function isThreadReply(headers) {
  if (!headers) return false;
  return !!(headers['in-reply-to'] || headers['In-Reply-To'] || headers.references || headers.References);
}

/** #221 — 회신 헤더가 **발신자가 자기 도메인으로 지어낸 것**인가.
 *
 *  콜드메일 발송기는 답장률을 올리려고 존재하지도 않는 대화에 In-Reply-To/References 를 달고 온다.
 *  헤더 모양만 보면 그게 전부 "우리 대화에 대한 회신" 이 되어 답변 필요 폴더를 오염시킨다.
 *
 *  ★ 판별자는 "우리 DB 에 그 Message-ID 가 있는가" 가 **아니다.** 그렇게 보면 플랫폼이 SMTP 로 보낸
 *    메일(청구서 안내 등)은 email_messages 에 없으므로, 거기에 온 **정당한 고객 회신이 강등된다**
 *    (실측: 기율법률사무소의 INV-2026-0003 결제 회신, 링크솔루션 유지보수 회신).
 *
 *  진짜 지문은 **자기 참조**다 — 정상 회신은 원 메일을 만든 쪽(우리 또는 우리 메일 제공자)이 발급한
 *  ID 를 참조하므로 발신자 도메인과 다르다. 조작된 회신은 자기 도메인 ID 를 스스로 지어낸다.
 *  실측 대조: 정당 3건은 `@irenewp.com`·`@mx.google.com`(우리 Gmail 발송)·`@irenewp.com` /
 *  콜드메일 2건은 `@prospectmaghub.site`·`@bestfloridabizbrokers.com` (발신자 도메인과 동일).
 */
function isForgedReplyRef(headers, fromEmail) {
  const { referencedMessageIds } = require('./emailHeaders');
  const ids = referencedMessageIds(headers);
  if (!ids.length) return false;
  const senderDomain = String(fromEmail || '').toLowerCase().split('@')[1];
  if (!senderDomain) return false;
  const domainOf = (id) => {
    const at = String(id).toLowerCase().replace(/[<>]/g, '').split('@');
    return at.length > 1 ? at[at.length - 1] : '';
  };
  // 참조된 ID 가 **전부** 발신자 자기 도메인이면 자작으로 본다.
  //   하나라도 남의 도메인(=원 대화를 만든 쪽)을 가리키면 정상 회신이다.
  return ids.every((id) => {
    const d = domainOf(id);
    return !!d && (d === senderDomain || d.endsWith('.' + senderDomain) || senderDomain.endsWith('.' + d));
  });
}

// ── 자동 발송이어도 사람이 확인해야 하는 내용 (Irene: "자동이라고 다 빼면 어떻게 해")
//   결제·입금·청구·증빙, 보고서, 우리 시스템이 보내는 업무 안내, 계약·서명, 장애·보안 공지 등.
//   발신 방식(자동)이 아니라 **내용**으로 판단한다 → 확인 권장(uncertain)으로 올린다.
//   광고·홍보(marketing)와 스팸은 대상이 아니다 — 그건 봐도 할 일이 없다.
const BUSINESS_RELEVANT = new RegExp([
  // 돈 — 결제·입금·증빙 (놓치면 돈이 샌다)
  '결제', '입금', '출금', '송금', '환불',   // 돈이 움직인 알림은 자동이어도 반드시 본다
  '청구서', '세금계산서', '현금영수증', '거래명세', '정산(서|\\s*내역)', '납부(\\s*안내|\\s*기한)?', '연체', '미납',
  '\\bpayment (received|failed|confirmed|due)\\b', '\\binvoice\\b', '\\breceipt\\b', '\\brefund(ed)?\\b',
  '\\bsubscription (renewed|canceled|cancelled|expiring|payment)\\b',
  // 문서·서명·계약
  '서명(\\s*요청|\\s*완료|하셨)', '전자계약', '계약(서|\\s*체결|\\s*완료)', '견적서', '제안서',
  '\\bsignature request\\b', '\\bsigned\\b', '\\bcontract\\b',
  // 보고서
  '보고서', '주간\\s*보고', '월간\\s*보고', '리포트가', '\\bweekly (report|summary|digest)\\b', '\\breport is ready\\b',
  // 발송 실패·반송 (고객에게 메일이 안 갔다는 뜻 — 반드시 봐야 한다)
  'delivery status notification', '반송', '\\bundeliverable\\b', '\\bmail delivery failed\\b',
  // 계정·운영 사고
  '서비스\\s*(장애|중단)', '보안\\s*(경고|사고|알림)', '개인정보\\s*유출', '비밀번호\\s*(재설정|변경)',
  '\\b(account|password|certificate|domain|card) (expir|suspend)', '\\bsecurity alert\\b', '\\bincident\\b',
  // #221 — **내가 움직여야 완료되는** 자동 메일. 돈이 오간 것도 사고도 아니라서 위 어느 범주에도
  //   안 걸렸고, 그래서 Apple Developer 등록 안내("등록 절차를 완료하려면 로그인…")가 자동·마케팅
  //   폴더에 묻혔다 — Irene: "무조건 확인해야 하는데 확인권장에 안 들어와서 업무 미스 했어."
  //   답장할 상대는 없으니 답변 필요가 아니라 **확인 권장**까지만 올린다.
  '등록\\s*(요청|절차|신청|승인)', '가입\\s*(승인|완료|신청)', '멤버십', '승인\\s*(요청|되었|완료)',
  '(계속|이어서)\\s*진행', '완료하려면', '조치가?\\s*필요', '확인이\\s*필요',
  '\\benrollment\\b', '\\bmembership\\b', '\\bcomplete your\\b', '\\baction (required|needed)\\b',
  '\\bcontinue your\\b', '\\bpending (approval|review|action)\\b',
].join('|'), 'i');

// 우리 플랫폼이 보낸 알림인가 (PlanQ 업무 안내·컨펌 요청 등) — 자동 발송이지만 우리 일 그 자체다
function isFromOurPlatform(fromEmail) {
  const f = String(fromEmail || '').toLowerCase();
  const platform = String(process.env.SMTP_FROM || '').toLowerCase();
  const domain = platform.includes('@') ? platform.split('@')[1] : 'planq.kr';
  return !!domain && f.endsWith('@' + domain);
}

function hasBusinessRelevance(subject, bodyText) {
  const head = `${subject || ''}\n${String(bodyText || '').slice(0, 1500)}`;
  return BUSINESS_RELEVANT.test(head);
}


// ── 답변 필요 판정 — **단일 원천**. 동기화(triageInbound)와 재판정(retriageStored)이 같은 문을 쓴다.
//   여태 두 곳에 같은 조건을 복붙해 두어, 한쪽만 고치면 조용히 어긋났다 (실제로 어긋났다).
//
//   순서가 곧 규칙이다 (아래 코드와 1:1):
//     ① 우리 대화에 대한 회신 → 답변 필요. 관계가 가장 확실하다.
//     ② 답장할 상대가 없는 메일(우리가 보낸 것 · 대량 발송 · 자동 발송) → 아니오.
//        아는 상대여도 여기서 걸린다 — 고객사가 보낸 뉴스레터에 답장할 사람은 없다.
//     ③ 아는 상대(고객·멤버·전에 우리가 답장한 상대)가 직접 쓴 메일 → 답변 필요.
//     ④ 모르는 상대 → 우리 주소로 직접 왔고 명확한 요청·질문이 있을 때만.
//   그 외는 스팸·광고가 아니어도 확인 권장 — 사람이 한 번 보고 판단한다.
function needsReply({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact }) {
  // ② 답장할 상대가 없는 메일 — 관계(아는 상대)보다, 회신 여부보다 **먼저** 걸러낸다.
  //    여태 isKnownContact 가 맨 앞에 있어서 고객사가 보낸 뉴스레터·우리 시스템의 자동 안내가
  //    전부 "답변 필요" 로 올라왔다. 메일의 성격이 관계보다 먼저다.
  if (isSelfSender(fromEmail, ownEmails) || isFromOurPlatform(fromEmail)) return false;  // 우리가 보낸 것
  if (isBounce(fromEmail, subject)) return false;                                        // 반송 — 회신처럼 생겼다
  if (isMarketing(headers, subject) || isBulkBody(bodyText)) return false;               // 대량 발송·법정 광고 표기
  if (isTransactionalNotice(subject)) return false;                                      // 주문·배송·결제 알림

  // ① 우리 대화에 온 회신 — 여기까지 왔으면 사람이 쓴 회신이다 (반송·알림은 위에서 빠졌다).
  //    단 **발신자가 자기 도메인으로 지어낸 회신 헤더**는 제외한다 (콜드메일 위장).
  //    ★ 배제로 끝내면 안 된다 — 여기서 빠진 위조 회신이 아래 ④(우리 주소 + 물음표)에서 그대로
  //      부활한다. 실측: 콜드메일 발송기 2곳(주석에 위조 실사례로 박제된 바로 그 도메인)이 ④로
  //      승격됐다. 위조가 증명된 발송기에 물음표 하나로 답변 필요를 줄 이유가 없다 → 하드스톱.
  if (isThreadReply(headers)) {
    return !isForgedReplyRef(headers, fromEmail);
  }

  if (isAutomated(headers, fromEmail, ownEmails)) return false;                          // 자동 발송

  // ③ 아는 상대(고객·멤버·전에 답장한 상대)가 직접 쓴 메일
  if (isKnownContact) return true;

  // ④ 모르는 상대 — 우리 주소로 직접 왔고 명확한 요청·질문이 있을 때만.
  //    본문 창을 앞부분으로 좁힌다 — 사람의 용건은 앞에 오고, 뒤쪽 상투구("Need help?")가 아니다.
  // ★ 수신 축만 matcher(도메인 규칙 포함). 위의 isSelfSender/isAutomated 는 ownEmails(정확 주소)를
  //   그대로 쓴다 — 도메인이 발신 축으로 새면 우리 도메인 동료의 문의가 자기발신으로 강등된다.
  if (!isAddressedToUs(headers, ownMatcher || ownEmails)) return false;
  const body = plainText(bodyText).slice(0, 1200);
  return hasStrongRequest(subject, body) || hasQuestion(`${subject || ''}\n${body}`);
}

/** 반송(bounce) — 메일 서버가 되돌려보낸 것. In-Reply-To 를 달고 오기 때문에 "우리 대화 회신" 으로
 *  오인된다(실측: mailer-daemon 9건이 답변 필요로 올라왔다). 기계가 보낸 것이라 답장할 상대가 없다. */
function isBounce(fromEmail, subject) {
  const f = String(fromEmail || '').toLowerCase();
  if (/(^|[._-])(mailer-daemon|postmaster|bounces?)([._-]|@)/i.test(f)) return true;
  return /(delivery status notification|undelivered mail|mail delivery (failed|subsystem)|returned mail|address not found)/i
    .test(String(subject || ''));
}

/** 거래 알림 (주문·배송·결제 확인) — 사람이 답장을 기대하고 쓴 글이 아니다.
 *
 *  헤더(List-Unsubscribe)는 DB 에 저장하지 않아서 **재판정 경로에선 광고 판정이 눈을 감는다**.
 *  그래서 쇼핑몰 알림이 그물을 빠져나갔다. 게다가 본문 상투구("Need help?" · "problems?")가
 *  물음표·요청 신호에 걸려 오히려 답변 필요로 올라왔다 — 제목으로 성격을 먼저 판정한다. */
const TRANSACTIONAL_NOTICE = new RegExp([
  'your (order|payment|parcel|shipment|delivery|refund|booking)',
  'order #?[\\w-]+ (has been|is now)', 'have you received (your |the )?order',
  '(has been|was) (delivered|shipped|dispatched|confirmed|cancell?ed)',
  'out for delivery', 'on the way', 'tracking (number|code)',
  'payment (has been )?(confirmed|received|successful)',
  '주문(이)? (완료|접수|확인)', '배송(이)? (완료|시작|출발)', '결제(가)? (완료|확인)', '발송(이)? (완료|시작)',
  // #221 — 규칙 ④(우리 주소로 직접 + 물음표)가 살아나면서 새로 노출된 오탐 계열.
  //   "안내드립니다…변경하시겠습니까?" 처럼 상투적 물음표를 단 통지가 답변 필요로 올라왔다.
  //   답장할 상대가 없는 통지이므로 여기서 막고 확인 권장으로 보낸다 (내용은 여전히 볼 가치가 있다).
  '주문\\s*승인', '\\border acknowledgment\\b',
  '운항\\s*(변경|취소|지연)', '\\bflight status change\\b', '\\bschedule change\\b',
  // PG 영수증 계열 — "결제하신 내역"·"이용내역 안내". 답장 상대가 없다.
  //   ('안내'·'확인' 전체를 잡으면 진짜 문의까지 강등되므로 '내역' 에만 건다.)
  '(결제|이용|거래)하?신?\\s*내역',
].join('|'), 'i');

function isTransactionalNotice(subject) {
  return TRANSACTIONAL_NOTICE.test(String(subject || ''));
}

/** 발신자가 우리 자신(이 워크스페이스의 메일 계정) — 우리가 보낸 메일에 우리가 답장할 일은 없다 */
function isSelfSender(fromEmail, ownEmails) {
  const f = String(fromEmail || '').toLowerCase().trim();
  if (!f || !ownEmails) return false;
  const set = ownEmails instanceof Set ? ownEmails : new Set(Array.isArray(ownEmails) ? ownEmails : []);
  return set.has(f);
}

/** 본문에 수신거부 링크 — List-Unsubscribe 헤더 없이 보내는 자체 발송기(뉴스레터 플러그인 등)를 잡는다.
 *  회신(quoted 원문에 수신거부가 딸려 올 수 있다)은 위에서 이미 통과했으므로 여기 안 온다. */
function isBulkBody(bodyText) {
  const b = String(bodyText || '');
  if (!b) return false;
  return /(수신\s?거부|구독\s?취소|unsubscribe|opt[-\s]?out)/i.test(b) && /https?:\/\//.test(b);
}

// 메인 — { triage, reply_needed, spam_score, status, uncertain_reason }
//   status/spam_score/uncertain_reason 은 classify 결과 그대로 통과 (호환 유지).
function triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact = false }) {
  const c = classify({ subject, bodyText, fromEmail, headers });

  let triage;
  if (c.status === 'spam') {
    triage = 'spam';
  } else if (isMarketing(headers, subject)) {
    triage = 'marketing';
  } else if (isAutomated(headers, fromEmail, ownEmails)) {
    triage = 'automated';
  } else {
    triage = 'human';
  }

  let status = c.status;
  let uncertain_reason = c.uncertain_reason;
  let reply_needed = false;

  // 자동 발송(automated)이어도 내용이 업무면 확인 권장으로 올린다 — 결제 완료·보고서·시스템 업무
  // 안내가 '자동·마케팅' 폴더에 묻혀 아무도 안 보는 일을 막는다. 답장할 상대는 없으니 답변 필요는 아니다.
  if (triage === 'automated' && c.status === 'open'
      && (isFromOurPlatform(fromEmail) || hasBusinessRelevance(subject, bodyText))) {
    status = 'uncertain';
    uncertain_reason = 'automated_relevant';
    reply_needed = false;
  }

  if (triage === 'human' && c.status === 'open') {
    // Irene 정책: "확인 권장을 많이 쓰고, 답변 필요는 확실히 답해야 하는 것만."
    //   답변 필요 = ① 아는 상대(고객·멤버·전에 우리가 답장한 상대) — 관계가 가장 확실한 신호
    //              ② 우리 대화에 대한 회신 (기존 일과 연결)
    //              ③ 우리 주소로 직접 온 메일 + 명확한 요청 문장 (문의·견적·회신 부탁…)
    //   그 외는 스팸·광고가 아니어도 확인 권장 — 사람이 한 번 보고 판단한다.
    const sure = needsReply({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact });
    if (sure) {
      reply_needed = true;
    } else {
      status = 'uncertain';
      uncertain_reason = 'unclear_intent';
      reply_needed = false;
    }
  }

  return {
    triage,
    reply_needed,
    spam_score: c.spam_score,
    status,
    uncertain_reason,
  };
}

// 백필용 — 헤더 없는 기존 메일을 발신자 패턴만으로 재분류 (보수적: 확실한 것만 이동)
//   헤더가 없으므로 marketing 은 거의 못 잡고 automated(noreply·소셜)만 신뢰성 있게 분류.
function triageBySenderOnly({ subject, bodyText, fromEmail, ownEmails }) {
  const c = classify({ subject, bodyText, fromEmail, headers: null });
  let triage;
  if (c.status === 'spam') triage = 'spam';
  else if (isAutomated(null, fromEmail, ownEmails)) triage = 'automated';
  else triage = 'human';
  return { triage, reply_needed: triage === 'human' && c.status === 'open', spam_score: c.spam_score, status: c.status, uncertain_reason: c.uncertain_reason };
}

// 재판정 전용.
//
//   headersComplete=true  — 판정용 헤더가 저장돼 있다(triage_headers). 수집 시점과 같은 정보이므로
//                           triage 부터 처음부터 다시 계산한다. 규칙을 고치면 옛 메일도 같이 교정된다.
//   headersComplete=false — 헤더가 없는 옛 메일. 저장된 triage 를 신뢰하고 status/reply_needed 만 다시 센다.
//                           헤더 없이 triage 를 다시 계산하면 광고가 사람 메일로 뒤집힌다
//                           (실제로 그랬다 — 109건이 human 으로 뒤집혀 백업에서 복원했다).
function retriageStored({ triage, subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact = false, headersComplete = false }) {
  // 헤더가 있으면 동기화와 같은 문을 그대로 지난다 — 판정 로직이 두 벌로 갈라지지 않는다.
  if (headersComplete) {
    return triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact });
  }

  if (triage === 'spam') return { triage, status: 'spam', reply_needed: false, uncertain_reason: null };

  // #200 — 헤더가 없어도 법정 광고 표기(제목 맨 앞 `(광고)`)는 확실하다. 이 한 가지만 triage 를 고쳐준다.
  //   "헤더 없이 triage 재계산 금지" 규칙의 취지는 **광고가 사람 메일로 뒤집히는 것**을 막는 것이라
  //   marketing 쪽 단방향 승격은 그 위험이 없다.
  if (triage === 'human' && hasAdPrefix(subject)) triage = 'marketing';

  // 자동 발송 — 내용이 업무이거나 우리 시스템 알림이면 확인 권장으로 올린다
  if (triage === 'automated' || triage === 'marketing') {
    const relevant = triage === 'automated'
      && (isFromOurPlatform(fromEmail) || hasBusinessRelevance(subject, bodyText));
    return relevant
      ? { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'automated_relevant' }
      : { triage, status: 'open', reply_needed: false, uncertain_reason: null };
  }

  // 사람이 보낸 메일 — 답변 필요는 확실한 것만, 나머지는 확인 권장
  //   ③ 우리 주소로 직접 온 메일 + (명확한 요청 || 질문). 사람이 물어봤으면 답해야 한다 —
  //      "…폐쇄를 진행하면 될까요?" 처럼 요청 단어 없이 질문만 있는 메일이 확인 권장에 갇혔다.
  //      광고·뉴스레터는 이미 자동·마케팅으로 빠지므로(triage) 여기 human 경로엔 오지 않는다.
  const sure = needsReply({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact });
  return sure
    ? { triage, status: 'open', reply_needed: true, uncertain_reason: null }
    : { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'unclear_intent' };
}

// 수신된 메일 한 통이 스레드의 상태를 어떻게 바꾸는가 — 신규/후속을 한 곳에서 결정한다.
//
// 여태 이 규칙이 IMAP 수집기 안에 인라인으로 있었고, "확인 완료(archived) 한 스레드" 는 후속 inbound 에서
// 통째로 제외됐다. 그래서 처리한 대화에 새 메일이 오면 어느 폴더에도 안 나타나고 조용히 묻혔다.
// 확인 완료는 **그때까지의 내용** 에 대한 처리다. 새 메일이 오면 다시 열려야 한다.
// 스팸만 예외 — 스팸함에 넣은 발신자는 계속 스팸이다.
//
// @param thread  기존 스레드 (isNew 면 무시)
// @param tr      triageInbound + 규칙 적용 결과
// @param replyNeeded  백필 보정까지 끝난 최종 값
// @param ruleReason   'rule' | 'inbound'
// @returns 스레드에 그대로 update 할 필드
function threadFieldsForInbound({ isNew, thread, tr, replyNeeded, ruleReason, messageDate }) {
  const at = messageDate || new Date();
  if (isNew) {
    return {
      status: tr.status,
      spam_score: tr.spam_score,
      uncertain_reason: tr.uncertain_reason,
      triage: tr.triage,
      reply_needed: replyNeeded,
      rule_id: tr.rule_applied?.id || null,
      ...(replyNeeded ? { reply_needed_at: at, reply_needed_reason: ruleReason } : {}),
    };
  }
  if (thread.status === 'spam' || tr.triage === 'spam') return {};

  // 확인 완료했던 스레드에 새 메일 → 다시 검토 대상으로 (reason 도 비워 재판정이 돌게)
  const reopen = thread.status === 'archived'
    ? { status: tr.status, uncertain_reason: tr.uncertain_reason, reply_needed_reason: null }
    : {};

  if (replyNeeded) {
    return { ...reopen, reply_needed: true, reply_needed_at: at, reply_needed_reason: ruleReason, rule_id: tr.rule_applied?.id || null };
  }
  if (tr.rule_applied) {
    // 규칙이 "답장 불필요" 로 판정 → 기존 스레드의 답변 필요도 해제
    return { ...reopen, reply_needed: false, reply_needed_at: null, reply_needed_reason: 'rule', rule_id: tr.rule_applied.id };
  }
  return reopen;
}

module.exports = {
  // 헤더 유틸은 emailHeaders 단일 원천 — 기존 호출부 호환을 위해 여기서도 그대로 내보낸다.
  TRIAGE_HEADER_KEYS,
  pickTriageHeaders,
  normalizeHeaders,
  headersFromMessage,
  isBounce,
  isTransactionalNotice,
  threadFieldsForInbound,
  retriageStored,
  isBulkBody,
  isSelfSender,
  needsReply,
  hasWorkSignal,
  hasBusinessRelevance,
  isFromOurPlatform,
  hasStrongRequest,
  isAddressedToUs,
  isThreadReply,
  isForgedReplyRef,
  buildOwnEmailSet, buildOwnAddressMatcher,
  triageInbound, triageBySenderOnly, isMarketing, isAutomated };
