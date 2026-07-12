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
function hget(headers, key) {
  if (!headers || typeof headers.get !== 'function') return null;
  try {
    const v = headers.get(key);
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

// 메인 — { triage, reply_needed, spam_score, status, uncertain_reason }
//   status/spam_score/uncertain_reason 은 classify 결과 그대로 통과 (호환 유지).
function triageInbound({ subject, bodyText, fromEmail, headers, ownEmails }) {
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

  // 답장 필요 = 사람이 보낸 직접 메일 + 정상(open) 상태만.
  //   자동/마케팅/스팸 제외. uncertain(확인권장)은 사용자가 수동 검토 → 자동 플래그 X.
  const reply_needed = triage === 'human' && c.status === 'open';

  return {
    triage,
    reply_needed,
    spam_score: c.spam_score,
    status: c.status,
    uncertain_reason: c.uncertain_reason,
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

module.exports = {
  buildOwnEmailSet, triageInbound, triageBySenderOnly, isMarketing, isAutomated };
