// 메일 발신자 규칙 — 학습·적용 단일 원천. LLM 0 (feedback_ai_minimal_usage).
//
// 흐름:
//   [적용] emailTriage.triageInbound 이 판정하기 전에 규칙을 먼저 본다 (규칙 > 휴리스틱).
//   [학습] 같은 발신자 2회 "답변 완료"(dismiss) → no_reply 규칙 + 그 발신자 미처리 건 일괄 정리
//          같은 발신자 2회 "스팸으로" → 도메인 spam 규칙
//          같은 도메인의 주소 3개가 no_reply → 도메인 no_reply 로 승격
//   [해제] 그 발신자에게 답장을 보내면 → 규칙 즉시 삭제 (사람이 대응한다 = 더 강한 신호)
//
// 안전장치:
//   - 규칙은 원본 메일을 지우지 않는다. 분류만 바꾼다 → 규칙 삭제 시 즉시 원상복구.
//   - 워크스페이스 격리 (business_id 필수).
//   - 학습 근거(evidence)를 남겨 사용자가 "왜 이렇게 분류됐는지" 볼 수 있게 한다.
const { Op } = require('sequelize');
const { MailSenderRule, EmailThread, EmailMessage } = require('../models');

const DISMISS_THRESHOLD = 2;      // 같은 발신자 N회 "답변 완료" → no_reply 학습
const SPAM_THRESHOLD = 2;         // 같은 발신자 N회 "스팸" → 도메인 spam 학습
const DOMAIN_PROMOTE_THRESHOLD = 3; // 같은 도메인의 주소 N개가 no_reply → 도메인 승격

function normalizeEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  const m = s.match(/<([^>]+)>/);          // "이름 <a@b.com>" 형태 대응
  const addr = (m ? m[1] : s).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : null;
}

function domainOf(email) {
  const e = normalizeEmail(email);
  return e ? e.split('@')[1] : null;
}

/**
 * 이 발신자에 적용되는 규칙 (주소 규칙 우선, 없으면 도메인 규칙).
 * @returns {Promise<MailSenderRule|null>}
 */
async function findRuleFor(businessId, fromEmail) {
  const addr = normalizeEmail(fromEmail);
  if (!businessId || !addr) return null;
  const dom = domainOf(addr);

  const rules = await MailSenderRule.findAll({
    where: {
      business_id: businessId,
      [Op.or]: [
        { pattern_type: 'address', pattern: addr },
        ...(dom ? [{ pattern_type: 'domain', pattern: dom }] : []),
      ],
    },
  });
  if (rules.length === 0) return null;
  // 더 구체적인 것(주소)이 도메인보다 우선
  return rules.find((r) => r.pattern_type === 'address') || rules[0];
}

/** 규칙 적중 기록 (통계·투명성용, best-effort) */
async function recordHit(rule) {
  try {
    await rule.update({ hit_count: (rule.hit_count || 0) + 1, last_hit_at: new Date() });
  } catch { /* 통계 실패가 메일 수신을 막으면 안 된다 */ }
}

/**
 * 규칙을 triage 결과에 적용. 규칙이 없으면 원본 그대로 반환.
 * @param {object} triaged - emailTriage.triageInbound 결과
 * @returns {Promise<object>} { ...triaged, rule_applied?: {id, pattern, verdict} }
 */
async function applyRules(businessId, fromEmail, triaged) {
  const rule = await findRuleFor(businessId, fromEmail);
  if (!rule) return triaged;

  const out = { ...triaged, rule_applied: { id: rule.id, pattern: rule.pattern, verdict: rule.verdict } };
  switch (rule.verdict) {
    case 'no_reply':
      out.triage = triaged.triage === 'spam' ? 'spam' : 'automated';
      out.reply_needed = false;
      break;
    case 'always_reply':
      // 자동화 헤더가 붙어 있어도 사람이 챙겨야 하는 발신자 (예: 자동발송이지만 대응 필요한 고객사 시스템)
      out.triage = 'human';
      out.reply_needed = out.status === 'open' || out.status === 'uncertain';
      break;
    case 'marketing':
      out.triage = 'marketing';
      out.reply_needed = false;
      break;
    case 'spam':
      out.triage = 'spam';
      out.status = 'spam';
      out.reply_needed = false;
      break;
    default:
      break;
  }
  await recordHit(rule);
  return out;
}

/** 이 워크스페이스에서 그 발신자가 보낸 스레드들 (마지막 inbound 발신자 기준) */
async function threadsFromSender(businessId, addr) {
  const msgs = await EmailMessage.findAll({
    where: { business_id: businessId, direction: 'inbound', from_email: addr },
    attributes: ['thread_id'],
    group: ['thread_id'],
  });
  return msgs.map((m) => m.thread_id).filter(Boolean);
}

/**
 * 학습 신호 — 사용자가 "답변 완료"(dismiss) 를 눌렀다.
 * 같은 발신자를 DISMISS_THRESHOLD 회 이상 눌렀으면 no_reply 규칙을 만든다.
 * @returns {Promise<{learned: boolean, rule?: object, cleaned?: number}>}
 */
async function onDismissReply({ businessId, fromEmail, threadId, subject, userId }) {
  const addr = normalizeEmail(fromEmail);
  if (!businessId || !addr) return { learned: false };

  // 이미 규칙이 있으면 학습 불필요
  const existing = await findRuleFor(businessId, addr);
  if (existing) return { learned: false, rule: existing.toJSON() };

  // 이 발신자의 dismiss 이력 — reply_needed_reason='dismissed' 인 스레드 수로 센다
  const senderThreadIds = await threadsFromSender(businessId, addr);
  if (senderThreadIds.length === 0) return { learned: false };

  const dismissedCount = await EmailThread.count({
    where: {
      business_id: businessId,
      id: { [Op.in]: senderThreadIds },
      reply_needed_reason: 'dismissed',
    },
  });
  if (dismissedCount < DISMISS_THRESHOLD) return { learned: false, progress: dismissedCount };

  // 학습 — no_reply 규칙 생성
  const dismissedThreads = await EmailThread.findAll({
    where: { business_id: businessId, id: { [Op.in]: senderThreadIds }, reply_needed_reason: 'dismissed' },
    attributes: ['id', 'subject'],
    limit: 5,
  });
  const rule = await MailSenderRule.create({
    business_id: businessId,
    pattern: addr,
    pattern_type: 'address',
    verdict: 'no_reply',
    source: 'learned',
    created_by: userId || null,
    evidence: {
      signal: `dismiss_x${dismissedCount}`,
      thread_ids: dismissedThreads.map((t) => t.id),
      subjects: dismissedThreads.map((t) => String(t.subject || '').slice(0, 80)),
      learned_at: new Date().toISOString(),
    },
  });

  // 그 발신자의 남은 "답변 필요" 일괄 정리 (원본은 그대로 — 분류만 해제)
  const [cleaned] = await EmailThread.update(
    { reply_needed: false, reply_needed_at: null, reply_needed_reason: 'rule' },
    { where: { business_id: businessId, id: { [Op.in]: senderThreadIds }, reply_needed: true } }
  );

  // 같은 도메인의 주소가 여럿 no_reply 면 도메인으로 승격
  await maybePromoteDomain(businessId, addr, userId);

  return { learned: true, rule: rule.toJSON(), cleaned: cleaned || 0 };
}

/** 같은 도메인 주소 N개가 no_reply → 도메인 규칙으로 승격 (개별 주소 규칙은 유지) */
async function maybePromoteDomain(businessId, addr, userId) {
  const dom = domainOf(addr);
  if (!dom) return null;
  const already = await MailSenderRule.findOne({
    where: { business_id: businessId, pattern: dom, pattern_type: 'domain' },
  });
  if (already) return null;

  const sameDomain = await MailSenderRule.findAll({
    where: {
      business_id: businessId,
      pattern_type: 'address',
      verdict: 'no_reply',
      pattern: { [Op.like]: `%@${dom}` },
    },
    attributes: ['id', 'pattern'],
  });
  if (sameDomain.length < DOMAIN_PROMOTE_THRESHOLD) return null;

  return MailSenderRule.create({
    business_id: businessId,
    pattern: dom,
    pattern_type: 'domain',
    verdict: 'no_reply',
    source: 'learned',
    created_by: userId || null,
    evidence: {
      signal: `domain_promote_from_${sameDomain.length}_addresses`,
      addresses: sameDomain.map((r) => r.pattern),
      learned_at: new Date().toISOString(),
    },
  });
}

/** 학습 신호 — "스팸으로" 2회 → 도메인 spam 규칙 */
async function onMarkSpam({ businessId, fromEmail, userId }) {
  const addr = normalizeEmail(fromEmail);
  const dom = domainOf(addr);
  if (!businessId || !addr || !dom) return { learned: false };

  const existing = await MailSenderRule.findOne({
    where: { business_id: businessId, pattern: dom, pattern_type: 'domain', verdict: 'spam' },
  });
  if (existing) return { learned: false, rule: existing.toJSON() };

  const spamCount = await EmailThread.count({
    where: { business_id: businessId, status: 'spam' },
    include: [{
      model: EmailMessage, as: 'messages', required: true,
      where: { direction: 'inbound', from_email: { [Op.like]: `%@${dom}` } },
      attributes: [],
    }],
    distinct: true,
  });
  if (spamCount < SPAM_THRESHOLD) return { learned: false, progress: spamCount };

  const rule = await MailSenderRule.create({
    business_id: businessId,
    pattern: dom,
    pattern_type: 'domain',
    verdict: 'spam',
    source: 'learned',
    created_by: userId || null,
    evidence: { signal: `spam_x${spamCount}`, learned_at: new Date().toISOString() },
  });
  return { learned: true, rule: rule.toJSON() };
}

/**
 * 반대 신호 — 그 발신자에게 답장을 보냈다.
 * 사람이 직접 대응한다는 뜻이므로 no_reply/marketing/spam 규칙을 즉시 해제한다 (학습보다 강한 신호).
 * @returns {Promise<{removed: number}>}
 */
async function onReplySent({ businessId, toEmails }) {
  const addrs = (Array.isArray(toEmails) ? toEmails : [toEmails])
    .map(normalizeEmail).filter(Boolean);
  if (!businessId || addrs.length === 0) return { removed: 0 };
  const doms = [...new Set(addrs.map(domainOf).filter(Boolean))];

  const removed = await MailSenderRule.destroy({
    where: {
      business_id: businessId,
      verdict: { [Op.in]: ['no_reply', 'marketing', 'spam'] },
      [Op.or]: [
        { pattern_type: 'address', pattern: { [Op.in]: addrs } },
        { pattern_type: 'domain', pattern: { [Op.in]: doms } },
      ],
    },
  });
  return { removed };
}

module.exports = {
  findRuleFor,
  applyRules,
  onDismissReply,
  onMarkSpam,
  onReplySent,
  normalizeEmail,
  domainOf,
  DISMISS_THRESHOLD,
  SPAM_THRESHOLD,
  DOMAIN_PROMOTE_THRESHOLD,
};
