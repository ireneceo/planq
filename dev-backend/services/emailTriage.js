// Q Mail — Inbound 트리아지 (사이클 N+83)
//   받은 메일을 수집 시점에 분류: human / automated / marketing / spam.
//   목적: (1) 사람 문의에 reply_needed 자동 설정 ("답변 필요" 폴더 작동)
//        (2) 자동알림·마케팅 벌크를 인박스에서 분리 (노이즈 제거)
//   원칙: LLM 호출 0 — 메일 헤더 + 발신자 패턴만으로 고신뢰 판정 (feedback_ai_minimal_usage).
//   spam 판정은 emailSpamFilter.classify 재사용 (단일 진실원천).

const { classify } = require('./emailSpamFilter');

// noreply / 시스템 발송 / 소셜 알림 발신자 패턴 (사람이 답장할 수 없는 주소)
const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|mailer|postmaster|bounce[sd]?|notifications?|alerts?|automated?|auto-?confirm|support\+|system|daemon)([._-]|@)/i;
const SOCIAL_DOMAIN = /@([^>\s]*\.)?(linkedin|facebook|fb|twitter|instagram|tiktok|youtube|pinterest|reddit|medium|slack|notion|asana|trello|atlassian|zoom|calendly|meetup|eventbrite)\.[a-z.]+/i;

// mailparser headers(Map) 안전 조회 (소문자 키)
// 헤더 읽기 — 동기화(mailparser)는 Map 을 주고, 재판정 스크립트는 평문 객체를 준다.
//   Map 만 받으면 평문 객체에서 조용히 null 이 나와 광고 판정이 통째로 죽는다 → 둘 다 받는다.
function hget(headers, key) {
  if (!headers) return null;
  try {
    let v = null;
    if (typeof headers.get === 'function') {
      v = headers.get(key);
    } else if (typeof headers === 'object') {
      const lower = String(key).toLowerCase();
      const hit = Object.keys(headers).find((k) => k.toLowerCase() === lower);
      v = hit ? headers[hit] : null;
    }
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return JSON.stringify(v); // List-Unsubscribe 등은 객체로 파싱될 수 있음
    return String(v);
  } catch { return null; }
}

// 벌크/뉴스레터 시그널 — RFC 2369 List-* + Precedence
function isMarketing(headers) {
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
const NEWSLETTER_SENDER = /(^|[._-])(news(letter)?s?|campaign|marketing|promo(tions?)?|digest|updates?|mailing)([._-]|@)/i;

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

// 이 워크스페이스가 "우리 주소" 로 인정할 집합 — 연결된 메일 계정 + 플랫폼 발신 주소
async function buildOwnEmailSet(businessId) {
  const set = new Set();
  const platformFrom = (process.env.SMTP_FROM || '').toLowerCase().trim();
  if (platformFrom) set.add(platformFrom);
  try {
    const { EmailAccount } = require('../models');
    const accs = await EmailAccount.findAll({
      where: { business_id: businessId },
      attributes: ['email'],
    });
    for (const a of accs) {
      const e = String(a.email || '').toLowerCase().trim();
      if (e) set.add(e);
    }
  } catch (e) { console.warn('[emailTriage] buildOwnEmailSet', e.message); }
  return set;
}


// ── 업무 신호 (LLM 0) — Irene 정의:
//     답변 필요 = 업무 처리가 필요한 것 · 문의 · 기존 일과 연결되는 것 · 고객이 보낸 것
//     확인 권장 = 스팸·광고는 아닌데 업무인지 애매한 것
//
//   신호는 "사람이 우리에게 뭔가를 요구/문의했는가" 를 본다. 아는 상대(고객·멤버·기존 대화 상대)면
//   내용과 무관하게 답변 필요 — 관계 자체가 가장 강한 신호다.
const WORK_SIGNAL = new RegExp([
  '문의', '요청', '부탁', '확인\\s*부탁', '회신', '답변', '검토', '견적', '계약', '청구', '입금', '세금계산서',
  '일정', '미팅', '회의', '가능(할까요|한가요|하신가요)', '언제', '어떻게', '알려\\s*주', '보내\\s*주', '주실',
  '요약', '진행', '완료', '수정', '피드백', '승인', '결재',
  '\\bplease\\b', '\\bcould you\\b', '\\bcan you\\b', '\\bwould you\\b', '\\brequest\\b', '\\bquote\\b',
  '\\binquiry\\b', '\\bquestion\\b', '\\bfollow[- ]?up\\b', '\\blet me know\\b', '\\bfeedback\\b',
].join('|'), 'i');

// 질문 부호 — 한 줄이라도 물음표가 있으면 사람이 뭔가 묻고 있다
function hasQuestion(text) {
  return /[?？]/.test(String(text || '').slice(0, 4000));
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
  const head = `${subject || ''}\n${String(bodyText || '').slice(0, 2000)}`;
  return STRONG_REQUEST.test(head);
}

// 우리 주소가 To 에 직접 있는가 (참조·숨은참조·대량발송 목록이 아니라)
function isAddressedToUs(headers, ownEmails) {
  const own = new Set((ownEmails || []).map((e) => String(e).toLowerCase()));
  if (own.size === 0) return false;
  const to = String((headers && (headers.to || headers.To)) || '').toLowerCase();
  if (!to) return false;
  for (const e of own) { if (to.includes(e)) return true; }
  return false;
}

// 우리 대화에 대한 회신인가 (기존 일과 연결 — 가장 확실한 신호 중 하나)
function isThreadReply(headers) {
  if (!headers) return false;
  return !!(headers['in-reply-to'] || headers['In-Reply-To'] || headers.references || headers.References);
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

// 메인 — { triage, reply_needed, spam_score, status, uncertain_reason }
//   status/spam_score/uncertain_reason 은 classify 결과 그대로 통과 (호환 유지).
function triageInbound({ subject, bodyText, fromEmail, headers, ownEmails, isKnownContact = false }) {
  const c = classify({ subject, bodyText, fromEmail, headers });

  let triage;
  if (c.status === 'spam') {
    triage = 'spam';
  } else if (isMarketing(headers)) {
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
    const sure = isKnownContact
      || isThreadReply(headers)
      || (isAddressedToUs(headers, ownEmails) && hasStrongRequest(subject, bodyText));
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

// 재판정 전용 — 이미 저장된 triage 를 신뢰하고 status/reply_needed 만 다시 계산한다.
//   동기화 시점에는 메일 헤더 원문(List-Unsubscribe·Auto-Submitted)이 있어서 automated/marketing
//   판정이 정확했다. 재판정 시점에는 그 헤더가 없으므로 triage 를 다시 계산하면 안 된다
//   (실제로 다시 계산했다가 광고 109건이 human 으로 뒤집혔다 → 백업에서 복원).
function retriageStored({ triage, subject, bodyText, fromEmail, headers, ownEmails, isKnownContact = false }) {
  if (triage === 'spam') return { triage, status: 'spam', reply_needed: false, uncertain_reason: null };

  // 자동 발송 — 내용이 업무이거나 우리 시스템 알림이면 확인 권장으로 올린다
  if (triage === 'automated' || triage === 'marketing') {
    const relevant = triage === 'automated'
      && (isFromOurPlatform(fromEmail) || hasBusinessRelevance(subject, bodyText));
    return relevant
      ? { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'automated_relevant' }
      : { triage, status: 'open', reply_needed: false, uncertain_reason: null };
  }

  // 사람이 보낸 메일 — 답변 필요는 확실한 것만, 나머지는 확인 권장
  const sure = isKnownContact
    || isThreadReply(headers)
    || (isAddressedToUs(headers, ownEmails) && hasStrongRequest(subject, bodyText));
  return sure
    ? { triage, status: 'open', reply_needed: true, uncertain_reason: null }
    : { triage, status: 'uncertain', reply_needed: false, uncertain_reason: 'unclear_intent' };
}

module.exports = {
  retriageStored,
  hasWorkSignal,
  hasBusinessRelevance,
  isFromOurPlatform,
  hasStrongRequest,
  isAddressedToUs,
  isThreadReply,
  buildOwnEmailSet, triageInbound, triageBySenderOnly, isMarketing, isAutomated };
