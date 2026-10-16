// Q Mail — Inbound 트리아지 (사이클 N+83)
//   받은 메일을 수집 시점에 분류: human / automated / marketing / spam.
//   목적: (1) 사람 문의에 reply_needed 자동 설정 ("답변 필요" 폴더 작동)
//        (2) 자동알림·마케팅 벌크를 인박스에서 분리 (노이즈 제거)
//   원칙: LLM 호출 0 — 메일 헤더 + 발신자 패턴만으로 고신뢰 판정 (feedback_ai_minimal_usage).
//   spam 판정은 emailSpamFilter.classify 재사용 (단일 진실원천).

const { classify } = require('./emailSpamFilter');
// 판정 기준 목록 — 엔진과 설정 화면이 같은 목록을 읽는다(docs/MAIL_CRITERIA_DESIGN.md §3).
const CAT = require('./mailCriteriaCatalog');
// 헤더 읽기·정규화는 공용 모듈 단일 원천 (#221). 인입(mailparser Map)·재판정(평문 객체) 두 경로가
// 같은 입력으로 수렴한다 — 술어마다 Map 대응을 복붙하던 구조가 실제로 어긋났다 (services/emailHeaders.js 주석).
const { hget, normalizeHeaders, pickTriageHeaders, TRIAGE_HEADER_KEYS } = require('./emailHeaders');

// noreply / 시스템 발송 / 소셜 알림 발신자 패턴 (사람이 답장할 수 없는 주소)
// ★ 2026-09-12 — 구분자에 **밑줄**을 넣는다. 여태 `no-?reply` 라 `no_reply@`·`do_not_reply@` 를 놓쳤고,
//   그래서 `testflight_no_reply@email.apple.com` 같은 발송 전용 주소가 `triage='human'` 으로 저장돼
//   Q sale 상담 목록까지 올라왔다(Irene: "메일이 문의가 아닌데 가져오고 있어").
//   운영 읽기전용 시뮬로 **오강등 0**(새로 걸리는 것이 전부 발송 전용)을 확인한 뒤 바꿨다.
const AUTOMATED_SENDER = /(^|[._-])(no[._-]?reply|do[._-]?not[._-]?reply|donotreply|mailer-daemon|mailer|postmaster|bounce[sd]?|notifications?|alerts?|automated?|auto-?confirm|support\+|system|daemon|no[._-]?return)([._-]|@)/i;
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
//   반환: 걸린 기준 id('ad_prefix'|'bulk_headers') 또는 null. isMarketing 은 그 참/거짓.
function marketingCriterion(headers, subject) {
  if (hasAdPrefix(subject)) return 'ad_prefix';
  if (hget(headers, 'list-unsubscribe')) return 'bulk_headers';
  if (hget(headers, 'list-id')) return 'bulk_headers';
  const prec = (hget(headers, 'precedence') || '').toLowerCase();
  // ★ 2026-10-15 (Fable 설계 §2①) — 자동응답(`Auto-Submitted: auto-replied`)은 `Precedence: bulk` 를 같이 단다
  //   (RFC 3834 권고 — 자동응답끼리 핑퐁하지 않게). 그걸 광고로 읽어 학교의 «메일 잘 받았습니다» 가 자동·마케팅에
  //   묻혔다(Irene: "내가 미싱했어"). Precedence 는 **Auto-Submitted 가 없을 때만** 대량 발송 증거다.
  //   자동응답은 isAutomated 로 떨어지고 auto_ack 기준이 확인 권장으로 올린다.
  const autoSub = (hget(headers, 'auto-submitted') || '').toLowerCase();
  if (/\b(bulk|list|junk)\b/.test(prec) && !(autoSub && autoSub !== 'no')) return 'bulk_headers';
  // ★ 2026-10-11 — ESP(발송 대행) 헤더는 여기서 보지 않는다. isAutomated 로 옮겼다(hasEspHeader).
  //   SendGrid·Mailgun·Feedback-ID 는 **보낸 도구**의 표식이라 영수증·청구서·계정 경고에도 똑같이 붙는다.
  //   광고로 보면 내용 승격(BUSINESS_RELEVANT)을 못 타고 자동·마케팅 폴더에 묻힌다 — 파트너 가입 안내(G4049)·
  //   «Claude API access is turned off»·Stripe 세금계산서가 그랬다(docs/MAIL_TRIAGE_AUDIT_2026-10-11.md, Fable A).
  return null;
}
function isMarketing(headers, subject) {
  return !!marketingCriterion(headers, subject);
}

// 발송 대행 서비스(ESP) 헤더 — 기계가 보냈다는 뜻이지 대량 광고라는 뜻이 아니다.
//   ★ 판정에서 **빼기만** 하면 사람 메일로 떨어져 영수증이 답변 필요로 올라간다(실측 2건) → automated 로 본다.
function hasEspHeader(headers) {
  return !!(hget(headers, 'x-mailgun-sid') || hget(headers, 'x-sg-eid') || hget(headers, 'x-campaign') ||
    hget(headers, 'feedback-id') || hget(headers, 'x-csa-complaints'));
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
  if (hasEspHeader(headers)) return true;             // SendGrid·Mailgun 등 — 기계 발송(2026-10-11)
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
const STRONG_REQUEST = CAT.regexOf('direct_request');   // 낱말 목록은 services/mailCriteriaCatalog.js (설정 화면과 한 벌)

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
const BUSINESS_RELEVANT = CAT.regexOf('automated_relevant');   // 낱말 목록은 services/mailCriteriaCatalog.js (설정 화면과 한 벌)

// 무료 메일 제공자 — Message-ID 도메인을 **제공자**가 발급한다(발신자가 아니다). isForgedReplyRef 의 자기참조 판정이
//   이 발신자에게는 증거가 되지 않는다(needsReply ① 주석 참조).
const FREE_MAIL_DOMAIN = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|msn\.com|yahoo\.[a-z.]+|ymail\.com|icloud\.com|me\.com|mac\.com|aol\.com|proton(mail)?\.(me|com)|naver\.com|daum\.net|hanmail\.net|kakao\.com|nate\.com)$/;

// 우리 플랫폼이 보낸 알림인가 (PlanQ 업무 안내·컨펌 요청 등) — 자동 발송이지만 우리 일 그 자체다
function isFromOurPlatform(fromEmail) {
  const f = String(fromEmail || '').toLowerCase();
  const platform = String(process.env.SMTP_FROM || '').toLowerCase();
  const domain = platform.includes('@') ? platform.split('@')[1] : 'planq.kr';
  return !!domain && f.endsWith('@' + domain);
}

// ── 로그인·인증 코드 / 계정 보안 통지 (Irene 2026-08-20) ──
//   신고: 넷플릭스 로그인 코드 메일이 **전체**로 들어갔다. "이런 이메일 인증은 확인권장으로 들어가야
//   하는 거 아니야?" — 내가 요청한 코드면 지나치면 되지만, **요청한 적 없는 코드는 계정 탈취 신호**라
//   반드시 한 번은 봐야 한다.
//
//   ★ 왜 BUSINESS_RELEVANT 와 따로 두는가 (Fable 실측 반증):
//     처음엔 BUSINESS_RELEVANT 에 넣었는데 **발화하지 않았다**. 넷플릭스·Dropbox·OpenAI 같은 대형
//     발송사는 로그인 코드 메일에도 List-Unsubscribe·Feedback-ID 를 달아 보내서 isMarketing 이
//     먼저 참이 되고, BUSINESS_RELEVANT 분기는 triage === 'automated' 에서만 돌기 때문이다.
//     실측: 이 계열 11건 중 9건이 marketing — 대상의 대부분이 규칙에 도달조차 못 했다.
//   → 그래서 이 술어는 **triage 와 무관하게**(스팸 제외) 확인 권장으로 올린다.
//   ★ '코드' 단독 금지 — "문서에서 코드 기능", "코드 리뷰" 같은 업무 메일이 걸린다. 짝으로만 본다.
const SECURITY_CODE = CAT.regexOf('security_code');   // 낱말 목록은 services/mailCriteriaCatalog.js (설정 화면과 한 벌)

// ── 꼭 봐야 하는 거래·사고 통지 (2026-10-11, Fable C) ──
//   대형 발송사는 결제 실패·연체·계정 보류 같은 **거래 메일에도 수신거부 헤더**를 단다 → marketing 으로 먼저
//   분류되고, 내용 승격(BUSINESS_RELEVANT)은 automated 에서만 돌아서 광고함에 갇혔다(Stripe 사기 결제 차단 ·
//   넷플릭스 결제 실패 · Time Fibre 연체 · Airbnb 예약 문의 · Codemagic 빌드 실패 …).
//   그래서 보안 코드처럼 **triage 와 무관하게** 확인 권장으로 올린다(답장할 상대는 없으니 답변 필요는 아니다).
//   ★ **제목만** 본다 — 본문까지 보면 광고 본문의 «overdue»·학교 공지 «Overdue» 가 걸린다(실측 +2 전부 오탐).
//   ★ 제외: 스팸 · 법정 광고 표기(hasAdPrefix). 새 제외 정규식을 만들지 않는다.
const CRITICAL_NOTICE = CAT.regexOf('critical_notice');   // 낱말 목록은 services/mailCriteriaCatalog.js (설정 화면과 한 벌)

function isCriticalNotice(subject) {
  const s = String(subject || '');
  if (hasAdPrefix(s)) return false;
  return CRITICAL_NOTICE.test(s);
}

/** 판정에 넘길 본문 — **수집·재판정이 같은 함수**를 쓴다(2026-10-11, Fable B).
 *  HTML 전용 메일(받은 메일의 28%)은 text 가 비어 여태 제목만으로 판정됐다. 각자 폴백을 쓰면 두 경로가 갈라진다. */
//  ★ HTML 의 **인용(앞 메일)** 은 잘라낸다 — 아는 고객의 HTML 답장이 인용한 뉴스레터 꼬리(수신거부 링크)를
//    isBulkBody 가 보고 «대량 발송» 으로 떨어뜨려 답변 필요에서 빠졌다(카나리 음성 대조군이 잡았다).
//    판정할 것은 보낸 사람이 **새로 쓴 말**이다.
const HTML_QUOTE_START = /<blockquote\b|class=["']?[^"'>]*\bgmail_quote\b|id=["']?(divRplyFwdMsg|appendonsend)\b|class=["']?[^"'>]*\b(yahoo_quoted|moz-cite-prefix)\b/i;
function triageBodyOf(text, html) {
  if (text && String(text).trim()) return String(text);
  if (!html) return '';
  let h = String(html);
  const m = HTML_QUOTE_START.exec(h);
  if (m) h = h.slice(0, h.lastIndexOf('<', m.index) >= 0 ? h.lastIndexOf('<', m.index) : m.index);
  return require('./emailBodyClean').htmlToText(h);
}

function isSecurityNotice(subject, bodyText) {
  return SECURITY_CODE.test(`${subject || ''}\n${String(bodyText || '').slice(0, 1500)}`);
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
function replyVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact, off }) {
  const on = (id) => CAT.isOn(id, off);
  const no = (criterion) => ({ ok: false, criterion });
  // ② 답장할 상대가 없는 메일 — 관계(아는 상대)보다, 회신 여부보다 **먼저** 걸러낸다.
  //    여태 isKnownContact 가 맨 앞에 있어서 고객사가 보낸 뉴스레터·우리 시스템의 자동 안내가
  //    전부 "답변 필요" 로 올라왔다. 메일의 성격이 관계보다 먼저다.
  if (isSelfSender(fromEmail, ownEmails) || isFromOurPlatform(fromEmail)) return no('self_sender');  // 우리가 보낸 것
  if (isBounce(fromEmail, subject)) return no('bounce');                                             // 반송 — 회신처럼 생겼다
  const mk = marketingCriterion(headers, subject);
  if (mk) return no(mk);                                                                             // 대량 발송·법정 광고 표기
  if (on('bulk_body') && isBulkBody(bodyText)) return no('bulk_body');
  if (on('transactional_notice') && isTransactionalNotice(subject)) return no('transactional_notice');  // 주문·배송·결제 알림

  // ① 우리 대화에 온 회신 — 여기까지 왔으면 사람이 쓴 회신이다 (반송·알림은 위에서 빠졌다).
  //    단 **발신자가 자기 도메인으로 지어낸 회신 헤더**는 제외한다 (콜드메일 위장).
  //    ★ 배제로 끝내면 안 된다 — 여기서 빠진 위조 회신이 아래 ④(우리 주소 + 물음표)에서 그대로
  //      부활한다. 실측: 콜드메일 발송기 2곳(주석에 위조 실사례로 박제된 바로 그 도메인)이 ④로
  //      승격됐다. 위조가 증명된 발송기에 물음표 하나로 답변 필요를 줄 이유가 없다 → 하드스톱.
  if (isThreadReply(headers)) {
    if (!isForgedReplyRef(headers, fromEmail)) return { ok: true, criterion: 'thread_reply' };
    // ★ 2026-09-11 — 무료 메일(Gmail 등) 발신자의 "자기참조" 는 위조 증거가 아니다.
    //   Gmail 의 Message-ID 는 `@mail.gmail.com` 이라 발신자 도메인(gmail.com)의 하위로 읽혀
    //   **자기 앞 메일에 이어 쓴 정상 후속**("Further to the above …")이 전부 위조로 하드스톱됐다 —
    //   아는 상대여도 답변 필요에 못 올라왔다(Joanne Low 실사례, 운영 id 3711).
    //   ID 도메인은 발신자가 아니라 **메일 제공자**가 발급하므로 자작 여부를 가를 수 없다 → 회신 신호로도,
    //   위조로도 쓰지 않고 **새 메일처럼** 아래 ③④ 로 판정한다. 자체 도메인 발송기의 위조는 종전대로 하드스톱.
    if (!FREE_MAIL_DOMAIN.test(String(fromEmail || '').toLowerCase().split('@')[1] || '')) return no('unclear_intent');
  }

  if (isAutomated(headers, fromEmail, ownEmails)) return no('automated_sender');                     // 자동 발송

  // ③ 아는 상대(고객·멤버·전에 답장한 상대)가 직접 쓴 메일
  if (isKnownContact) return { ok: true, criterion: 'known_contact' };

  // ④ 모르는 상대 — 우리 주소로 직접 왔고 명확한 요청·질문이 있을 때만.
  //    본문 창을 앞부분으로 좁힌다 — 사람의 용건은 앞에 오고, 뒤쪽 상투구("Need help?")가 아니다.
  if (!on('direct_request')) return no('unclear_intent');
  // ★ 수신 축만 matcher(도메인 규칙 포함). 위의 isSelfSender/isAutomated 는 ownEmails(정확 주소)를
  //   그대로 쓴다 — 도메인이 발신 축으로 새면 우리 도메인 동료의 문의가 자기발신으로 강등된다.
  if (!isAddressedToUs(headers, ownMatcher || ownEmails)) return no('unclear_intent');
  // ★ #450 (Irene 결정 2026-10-02) — **보낸 사람이 사람인가**를 Q sales 상담과 같은 부품으로 본다.
  //   역할·브랜드 주소(hosting@·mailmaster@·iclub@·account@)의 약관·마일리지·명세서가 물음표 하나로
  //   답변 필요에 올라왔다(운영 미연결 7건 중 6건). 상담 기준에는 이미 있던 조건이다(services/contactRelation).
  //   걸러진 메일은 사라지지 않고 **확인 권장**으로 간다. 운영 전수 시뮬: 뒤집히는 8건 중 진짜 문의 0건.
  //   ★ 아는 상대(③)는 위에서 이미 참이다 — 단일 토막 회사 주소의 기존 고객은 영향이 없다.
  //   ★ 2026-10-15 (Fable 설계 결정 ④) — Irene «안내·요청·문의면 무조건» 에도 이 조건은 유지한다:
  //     뒤집으면 dev 950건이 답변 필요로 올라간다(삼성생명·홈택스·은행 명세 …). 꼭 받아야 하는 역할 주소는
  //     «답변 필요로» 2회 학습 또는 규칙이 길이다. 자동이어도 «새 주문·문의·답변 도착» 은 inbound_action 이 올린다.
  if (!require('./contactRelation').isPersonalSender(fromEmail)) return no('unclear_intent');
  const body = plainText(bodyText).slice(0, 1200);
  return (hasStrongRequest(subject, body) || hasQuestion(`${subject || ''}\n${body}`))
    ? { ok: true, criterion: 'direct_request' } : no('unclear_intent');
}

/** 답변 필요인가(참/거짓) — replyVerdict 의 얇은 껍데기. 기존 호출부 호환. */
function needsReply(args) {
  return replyVerdict(args).ok;
}

/** 자동응답·접수 확인(«메일 잘 받았습니다», 부재중) — 2026-10-15 auto_ack.
 *  헤더(Auto-Submitted: auto-replied · X-Autoreply) 또는 제목, 사람 메일이 아니면 본문 앞 600자까지 본다.
 *  ★ 사람 메일(human)에는 본문 패턴을 쓰지 않는다 — «Thank you for contacting us, …» 로 시작하는 진짜 답장이 있다.
 *  ★ 반송(DSN)도 auto-replied 를 단다 — 반송은 반송 경로 그대로(호출부가 isBounce 를 먼저 거른다). */
function isAutoAck(headers, subject, bodyText, { useBody = true } = {}) {
  const auto = (hget(headers, 'auto-submitted') || '').toLowerCase();
  if (/auto-replied/.test(auto)) return true;
  if (hget(headers, 'x-autoreply') || hget(headers, 'x-autorespond')) return true;
  if (CAT.regexOf('auto_ack_subject').test(String(subject || ''))) return true;
  if (!useBody) return false;
  return CAT.regexOf('auto_ack_body').test(plainText(bodyText).slice(0, 600));
}

/** 일정 안내(예약 확정·리마인더·변경·취소) — 2026-10-16 schedule_notice. 사람 메일이 아닐 때만 부른다.
 *  제목은 늘 본다. 본문(앞 1500자) «예약 번호:»·«Appointment date:» 칸 이름은 자동 발송(automated)일 때만 —
 *  대량 발송(marketing)은 제목으로만 올린다(광고 본문에 «Booking No:» 를 다는 바우처가 있다).
 *  우리 시스템(PlanQ) 알림·우리가 보낸 것은 뺀다 — 그쪽은 platform_notice·self_sender 가 따로 다룬다. */
function isScheduleNotice({ triage, subject, bodyText, fromEmail, ownEmails }) {
  if (isFromOurPlatform(fromEmail) || isSelfSender(fromEmail, ownEmails)) return false;
  const s = String(subject || '');
  if (hasAdPrefix(s) || isBounce(fromEmail, s)) return false;
  if (CAT.regexOf('schedule_notice_subject').test(s)) return true;
  if (triage !== 'automated') return false;
  return CAT.regexOf('schedule_notice_body').test(plainText(bodyText).slice(0, 1500));
}

/** 상대의 행동이 도착했다는 알림(새 주문·새 문의·답변 도착) — 2026-10-15 inbound_action. **제목만** 본다.
 *  먼저 거른다: 우리 시스템(PlanQ) 알림(앱 안에서 이미 알린다) · 반송 · (광고) · 내가 산 주문 알림(켜져 있으면). */
function isInboundAction({ subject, fromEmail, ownEmails, off }) {
  const s = String(subject || '');
  if (!CAT.regexOf('inbound_action').test(s)) return false;
  // ★ 우리 시스템(PlanQ) 발신만 뺀다 — «우리 주소»(계정·별칭)는 빼지 않는다(Fable 게이트 ③).
  //   상점 주소(help@withmin.info)를 별칭으로 등록한 워크스페이스에서는 그 상점이 보내는 «New order #» 가
  //   «우리 주소» 라 영영 답변 필요에 못 갔다 — Irene 이 말한 바로 그 메일이다. 설계 §4.1 제외 목록 그대로.
  if (isFromOurPlatform(fromEmail)) return false;
  if (isBounce(fromEmail, s) || hasAdPrefix(s)) return false;
  if (CAT.isOn('transactional_notice', off) && isTransactionalNotice(s)) return false;
  return true;
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
const TRANSACTIONAL_NOTICE = CAT.regexOf('transactional_notice');   // 낱말 목록은 services/mailCriteriaCatalog.js (설정 화면과 한 벌)

/** 발신 주소만 보고 자동발송인가 — 저장된 triage 가 틀렸을 때 **다시 볼** 수 있게 내보낸다.
 *  (2026-09-12: 은행 거래 알림이 `triage='human'` 으로 저장돼 Q sale 상담 목록에 올라왔다.
 *   헤더가 비어 있어 수집 시점 판정이 눈을 감았고, 주소 패턴은 여전히 유효한 단서다.) */
function isAutomatedSenderAddress(fromEmail) {
  return AUTOMATED_SENDER.test(String(fromEmail || '').toLowerCase().trim());
}

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
  // ★ 인용 줄(`> …`)도 본다 — 빼 봤더니 WordPress 플러그인 심사의 «자동 접수 확인»(우리 글을 인용) 6건이
  //   답변 필요로 올라왔다(2026-10-11 dev 전수). 아는 상대의 평문 답장이 인용 꼬리로 빠지는 것은 알려진 남은 구멍.
  const b = String(bodyText || '');
  if (!b) return false;
  return /(수신\s?거부|구독\s?취소|unsubscribe|opt[-\s]?out)/i.test(b) && /https?:\/\//.test(b);
}

// 메인 — { triage, reply_needed, spam_score, status, uncertain_reason, criterion }
//   status/spam_score/uncertain_reason 은 classify 결과 그대로 통과 (호환 유지).
//   criterion — 이 폴더를 **정한** 기준 id(services/mailCriteriaCatalog.js). email_threads.triage_criterion 에 남는다.
//   off — 이 워크스페이스가 끈 기준(Set|배열, services/mailCriteria.offFor). 꺼진 기준은 분기가 없는 것처럼 돈다.
//
//   적용 순서 = 카탈로그 order (docs/MAIL_CRITERIA_DESIGN.md §3.3):
//     스팸 → 스팸 구제(아는 상대) → 보안 알림 → 상대 행동 도착(답변 필요) → 꼭 봐야 하는 통지 → 자동응답
//     → 자동 발송의 업무 내용·우리 시스템 알림 → 사람 메일(답변 필요 판정, 아니면 확인 권장)
function triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact = false, off = null, impersonation = null }) {
  const on = (id) => CAT.isOn(id, off);
  const c = classify({ subject, bodyText, fromEmail, headers });
  // 사칭 의심 격리 — 모든 기준보다 먼저(카탈로그 order 5). 판정은 services/mailImpersonation 한 곳이고
  //   여기는 «격리할지» 만 정한다(아는 상대·사람이 풀어 준 스레드는 그 함수가 이미 경고로 낮췄다).
  if (require('./mailImpersonation').shouldQuarantine(impersonation, off)) {
    return { triage: 'spam', reply_needed: false, spam_score: c.spam_score, status: 'spam', uncertain_reason: null, criterion: 'impersonation' };
  }
  // 우리 주소는 «아는 상대» 로 치지 않는다 — 우리가 우리에게 보낸 테스트가 스팸 구제되면 안 된다(설계 §2③).
  const known = !!isKnownContact && !isSelfSender(fromEmail, ownEmails);

  let triage;
  let baseCriterion = null;
  const mk = c.status === 'spam' ? null : marketingCriterion(headers, subject);
  if (c.status === 'spam') {
    triage = 'spam'; baseCriterion = 'spam_filter';
  } else if (mk) {
    triage = 'marketing'; baseCriterion = mk;
  } else if (isAutomated(headers, fromEmail, ownEmails)) {
    triage = 'automated';
    baseCriterion = isSelfSender(fromEmail, ownEmails) ? 'self_sender' : 'automated_sender';
  } else {
    triage = 'human';
  }
  const out = (status, reply_needed, uncertain_reason, criterion) =>
    ({ triage, reply_needed, spam_score: c.spam_score, status, uncertain_reason, criterion });

  // 스팸 — 아는 상대(고객·멤버·우리가 답한 주소)면 확인 권장으로 구제한다(spam_rescue). triage 는 spam 그대로라
  //   스팸 표시가 남아 왜 왔는지 보인다. 개인 주소 «모양» 으로는 구제하지 않는다 — dev 실측 30건 전부 콜드메일.
  if (triage === 'spam') {
    if (on('spam_rescue') && known) return out('uncertain', false, 'spam_rescue', 'spam_rescue');
    return out(c.status, false, c.uncertain_reason, 'spam_filter');
  }

  // 로그인·인증 코드 — **marketing 이든 automated 든 human 이든** 확인 권장까지 올린다.
  //   대형 발송사가 수신거부 헤더를 달아 보내 marketing 으로 먼저 분류되는 것이 이 계열의 정상이라,
  //   triage 로 게이트하면 대상 대부분을 놓친다(SECURITY_CODE 주석의 실측).
  //   답장할 상대는 없으니 답변 필요는 아니다 — human 경로에서 본문 상투구("요청이 아니라면")가
  //   요청 문장으로 잡혀 답변 필요로 오승격되던 것도 여기서 같이 막힌다.
  if (c.status === 'open' && on('security_code') && isSecurityNotice(subject, bodyText)) {
    return out('uncertain', false, 'security_code', 'security_code');
  }

  // 상대의 행동이 도착했다는 알림(새 주문·새 문의·답변 도착) — 발송 방식(자동)과 무관하게 **답변 필요**.
  //   Irene 2026-10-15: *"자동메일이어도 주문이 들어왔다. 답변이나 문의가 왔다 같은 안내는 무조건 답변필요"*.
  //   꼭 봐야 하는 통지(«new ticket»·«booking inquiry» 도 들어 있다)보다 먼저 본다 — 그쪽은 확인 권장까지라서.
  if (c.status !== 'spam' && on('inbound_action') && isInboundAction({ subject, fromEmail, ownEmails, off })) {
    return out('open', true, null, 'inbound_action');
  }

  // 꼭 봐야 하는 통지(CRITICAL_NOTICE) — 자동·광고로 분류된 것을 확인 권장으로 올린다.
  //   사람 메일(human)은 아래에서 답변 필요 판정을 먼저 받는다 — 답변 필요가 확인 권장으로 내려가면 안 된다.
  if (triage !== 'human' && c.status === 'open' && on('critical_notice') && isCriticalNotice(subject)) {
    return out('uncertain', false, 'critical_notice', 'critical_notice');
  }

  // 자동응답·접수 확인 — 답장할 상대는 없지만 «상대가 받았다» 는 봐야 하는 정보다(확인 권장).
  if (triage !== 'human' && c.status === 'open' && on('auto_ack')
      && !isBounce(fromEmail, subject) && isAutoAck(headers, subject, bodyText)) {
    return out('uncertain', false, 'auto_ack', 'auto_ack');
  }

  // 일정 안내(예약 확정·변경·취소) — 날짜가 박힌 약속이라 자동 폴더에 묻히면 놓친다(확인 권장).
  if (triage !== 'human' && c.status === 'open' && on('schedule_notice')
      && isScheduleNotice({ triage, subject, bodyText, fromEmail, ownEmails })) {
    return out('uncertain', false, 'schedule_notice', 'schedule_notice');
  }

  // 자동 발송(automated)이어도 내용이 업무면 확인 권장으로 올린다 — 결제 완료·보고서·시스템 업무
  // 안내가 '자동·마케팅' 폴더에 묻혀 아무도 안 보는 일을 막는다. 답장할 상대는 없으니 답변 필요는 아니다.
  //   우리 시스템(PlanQ) 알림은 따로 끌 수 있게 platform_notice 로 가른다(앱 안에서 이미 알린다).
  if (triage === 'automated' && c.status === 'open') {
    if (isFromOurPlatform(fromEmail)) {
      if (on('platform_notice')) return out('uncertain', false, 'platform_notice', 'platform_notice');
    } else if (on('automated_relevant') && hasBusinessRelevance(subject, bodyText)) {
      return out('uncertain', false, 'automated_relevant', 'automated_relevant');
    }
  }

  if (triage === 'human' && c.status === 'open') {
    // Irene 정책: "확인 권장을 많이 쓰고, 답변 필요는 확실히 답해야 하는 것만."
    //   답변 필요 = ① 아는 상대(고객·멤버·전에 우리가 답장한 상대) — 관계가 가장 확실한 신호
    //              ② 우리 대화에 대한 회신 (기존 일과 연결)
    //              ③ 우리 주소로 직접 온 메일 + 명확한 요청 문장 (문의·견적·회신 부탁…)
    //   그 외는 스팸·광고가 아니어도 확인 권장 — 사람이 한 번 보고 판단한다.
    const v = replyVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact: known, off });
    if (v.ok) return out('open', true, c.uncertain_reason, v.criterion);
    const critical = on('critical_notice') && isCriticalNotice(subject);
    return out('uncertain', false, critical ? 'critical_notice' : 'unclear_intent', critical ? 'critical_notice' : v.criterion);
  }

  return out(c.status, false, c.uncertain_reason, baseCriterion || (c.status === 'uncertain' ? 'unclear_intent' : null));
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
//   순서는 triageInbound 와 같다 — 두 경로가 갈라지면 안 된다.
function retriageStored({ triage, subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact = false, headersComplete = false, off = null, impersonation = null }) {
  // 헤더가 있으면 동기화와 같은 문을 그대로 지난다 — 판정 로직이 두 벌로 갈라지지 않는다.
  if (headersComplete) {
    return triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact, off, impersonation });
  }
  const on = (id) => CAT.isOn(id, off);
  // 사칭 의심 격리 — triageInbound 와 같은 자리(맨 앞).
  if (require('./mailImpersonation').shouldQuarantine(impersonation, off)) {
    return { triage: 'spam', status: 'spam', reply_needed: false, uncertain_reason: null, criterion: 'impersonation' };
  }
  const known = !!isKnownContact && !isSelfSender(fromEmail, ownEmails);

  if (triage === 'spam') {
    if (on('spam_rescue') && known) return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'spam_rescue', criterion: 'spam_rescue' };
    return { triage, status: 'spam', reply_needed: false, uncertain_reason: null, criterion: 'spam_filter' };
  }

  // 로그인·인증 코드 — triage 무관 승격(triageInbound 와 같은 규칙. 두 경로가 갈라지면 안 된다).
  if (on('security_code') && isSecurityNotice(subject, bodyText)) {
    return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'security_code', criterion: 'security_code' };
  }

  // 상대 행동 도착 — triageInbound 와 같은 자리(꼭 봐야 하는 통지보다 먼저).
  if (on('inbound_action') && isInboundAction({ subject, fromEmail, ownEmails, off })) {
    return { triage, status: 'open', reply_needed: true, uncertain_reason: null, criterion: 'inbound_action' };
  }

  // 꼭 봐야 하는 통지 — triageInbound 와 같은 규칙(사람 메일은 아래 답변 필요 판정이 먼저).
  if (triage !== 'human' && on('critical_notice') && isCriticalNotice(subject)) {
    return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'critical_notice', criterion: 'critical_notice' };
  }

  // 자동응답 — 헤더가 없으니 제목·본문만(사람 메일은 제외 — triageInbound 와 같다).
  if (triage !== 'human' && on('auto_ack') && !isBounce(fromEmail, subject) && isAutoAck({}, subject, bodyText)) {
    return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'auto_ack', criterion: 'auto_ack' };
  }

  // 일정 안내 — triageInbound 와 같은 자리(자동응답 다음).
  if (triage !== 'human' && on('schedule_notice') && isScheduleNotice({ triage, subject, bodyText, fromEmail, ownEmails })) {
    return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'schedule_notice', criterion: 'schedule_notice' };
  }

  // #200 — 헤더가 없어도 법정 광고 표기(제목 맨 앞 `(광고)`)는 확실하다. 이 한 가지만 triage 를 고쳐준다.
  //   "헤더 없이 triage 재계산 금지" 규칙의 취지는 **광고가 사람 메일로 뒤집히는 것**을 막는 것이라
  //   marketing 쪽 단방향 승격은 그 위험이 없다.
  if (triage === 'human' && hasAdPrefix(subject)) triage = 'marketing';

  // 자동 발송 — 내용이 업무이거나 우리 시스템 알림이면 확인 권장으로 올린다
  if (triage === 'automated' || triage === 'marketing') {
    if (triage === 'automated' && isFromOurPlatform(fromEmail) && on('platform_notice')) {
      return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'platform_notice', criterion: 'platform_notice' };
    }
    if (triage === 'automated' && !isFromOurPlatform(fromEmail) && on('automated_relevant') && hasBusinessRelevance(subject, bodyText)) {
      return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'automated_relevant', criterion: 'automated_relevant' };
    }
    const crit = triage === 'marketing' ? (hasAdPrefix(subject) ? 'ad_prefix' : 'bulk_headers')
      : (isSelfSender(fromEmail, ownEmails) ? 'self_sender' : 'automated_sender');
    return { triage, status: 'open', reply_needed: false, uncertain_reason: null, criterion: crit };
  }

  // 사람이 보낸 메일 — 답변 필요는 확실한 것만, 나머지는 확인 권장
  //   ③ 우리 주소로 직접 온 메일 + (명확한 요청 || 질문). 사람이 물어봤으면 답해야 한다 —
  //      "…폐쇄를 진행하면 될까요?" 처럼 요청 단어 없이 질문만 있는 메일이 확인 권장에 갇혔다.
  //      광고·뉴스레터는 이미 자동·마케팅으로 빠지므로(triage) 여기 human 경로엔 오지 않는다.
  const v = replyVerdict({ subject, bodyText, fromEmail, headers, ownEmails, ownMatcher, isKnownContact: known, off });
  if (v.ok) return { triage, status: 'open', reply_needed: true, uncertain_reason: null, criterion: v.criterion };
  const critical = on('critical_notice') && isCriticalNotice(subject);
  return { triage, status: 'uncertain', reply_needed: false, uncertain_reason: critical ? 'critical_notice' : 'unclear_intent', criterion: critical ? 'critical_notice' : v.criterion };
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
  // #344 — 규칙이 "무조건 중요" 라고 했으면 별표를 켠다.
  //   ★ 끄지는 않는다. 사용자가 손으로 켠 별표를 규칙이 지우면, 사용자가 한 일이 사라진다.
  const important = tr.mark_important ? { is_starred: true } : {};
  if (isNew) {
    return {
      ...important,
      status: tr.status,
      spam_score: tr.spam_score,
      uncertain_reason: tr.uncertain_reason,
      triage: tr.triage,
      // 이 폴더를 정한 기준 — 설정 «메일 분류 기준» 의 적중 수·끄기 소급 근거(2026-10-15).
      triage_criterion: tr.rule_applied ? 'rule' : (tr.criterion || null),
      reply_needed: replyNeeded,
      rule_id: tr.rule_applied?.id || null,
      ...(replyNeeded ? { reply_needed_at: at, reply_needed_reason: ruleReason } : {}),
    };
  }
  if (thread.status === 'spam' || tr.triage === 'spam') return {};

  // 확인 완료했던 스레드에 새 메일 → 다시 검토 대상으로 (reason 도 비워 재판정이 돌게)
  const crit = tr.rule_applied ? 'rule' : (tr.criterion || null);
  const reopen = thread.status === 'archived'
    ? { status: tr.status, uncertain_reason: tr.uncertain_reason, reply_needed_reason: null, triage_criterion: crit }
    : {};
  Object.assign(reopen, important);

  if (replyNeeded) {
    return { ...reopen, reply_needed: true, reply_needed_at: at, reply_needed_reason: ruleReason, rule_id: tr.rule_applied?.id || null, triage_criterion: crit };
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
  isAutomatedSenderAddress,
  threadFieldsForInbound,
  retriageStored,
  isBulkBody,
  isSelfSender,
  hasEspHeader,
  isCriticalNotice,
  triageBodyOf,
  needsReply,
  replyVerdict,
  isAutoAck,
  isInboundAction,
  isScheduleNotice,
  marketingCriterion,
  // 무료메일 도메인 — 회사 추정에서 제외하는 데 쓴다(services/saleInbox).
  //   목록을 베껴 가면 한쪽만 늘어난다. 여기가 단일 원천이다.
  FREE_MAIL_DOMAIN,
  hasWorkSignal,
  hasBusinessRelevance,
  isFromOurPlatform,
  hasStrongRequest,
  isAddressedToUs,
  isThreadReply,
  isForgedReplyRef,
  buildOwnEmailSet, buildOwnAddressMatcher,
  triageInbound, triageBySenderOnly, isMarketing, isAutomated };
