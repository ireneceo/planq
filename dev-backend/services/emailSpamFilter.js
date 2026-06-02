// Q Mail M5 — 자동 스팸/Uncertain 분류 (사이클 N+81)
//   IMAP X-Spam-* 헤더 우선 + 자체 룰(키워드·링크·발신) → spam_score.
//   >5.0 spam / 2.5~5.0 uncertain(+사유 코드) / <2.5 정상(open). AI 미사용(키워드 룰).
//   uncertain_reason 은 i18n 코드 — 프론트가 qmail.uncertain.<code> 로 매핑.

const SPAM_PATTERNS = [
  /\bviagra\b/i, /\bcasino\b/i, /lottery|복권|당첨금/i, /비트코인.*(투자|수익)/i,
  /무료.*(수익|머니|현금)/i, /대출.*(승인|한도)/i, /\${3,}/, /click here to (claim|win)/i,
  /수익보장|원금보장|고수익|단기간.*수익/i, /성인.*(사이트|광고)/i, /\bunsubscribe\b.*\bclick\b/i,
];
const QUOTE_PATTERNS = [/견적|estimate|\bquote\b|quotation/i, /계약|contract|\bsow\b|제안서|proposal/i];
const BILLING_PATTERNS = [/청구|invoice|결제|payment|세금계산서|영수증|receipt/i];

// mailparser headers(Map)에서 spam 점수 추출 (외부 mail server 가 SpamAssassin 등으로 채움)
function headerSpamScore(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  try {
    const raw = headers.get('x-spam-score') || headers.get('x-spamd-bar') || headers.get('x-spam-status');
    if (raw) {
      const mm = String(raw).match(/-?\d+\.?\d*/);
      if (mm) { const n = parseFloat(mm[0]); if (!Number.isNaN(n)) return n; }
    }
    const flag = headers.get('x-spam-flag');
    if (flag && /yes/i.test(String(flag))) return 6.0;
  } catch { /* ignore */ }
  return null;
}

function selfRuleScore({ subject, bodyText, fromEmail }) {
  let score = 0;
  const text = `${subject || ''} ${bodyText || ''}`.slice(0, 4000);
  for (const re of SPAM_PATTERNS) if (re.test(text)) score += 2.5;
  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links > 8) score += 1.5; else if (links > 4) score += 0.8;
  if (subject && subject.length > 12 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)) score += 1.0;
  if (!fromEmail || !fromEmail.includes('@')) score += 1.5;
  return Math.min(score, 10);
}

// returns { spam_score, status, uncertain_reason }  (status: 'open'|'spam'|'uncertain')
function classify({ subject, bodyText, fromEmail, headers }) {
  const hs = headerSpamScore(headers);
  const score = hs != null ? hs : selfRuleScore({ subject, bodyText, fromEmail });
  let status = 'open';
  let uncertain_reason = null;
  if (score > 5.0) {
    status = 'spam';
  } else if (score >= 2.5) {
    status = 'uncertain';
    const text = `${subject || ''} ${bodyText || ''}`;
    if (BILLING_PATTERNS.some((re) => re.test(text))) uncertain_reason = 'billing';
    else if (QUOTE_PATTERNS.some((re) => re.test(text))) uncertain_reason = 'quote';
    else uncertain_reason = 'review';
  }
  return { spam_score: Number(score.toFixed(2)), status, uncertain_reason };
}

module.exports = { classify };
