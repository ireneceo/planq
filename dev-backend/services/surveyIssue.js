// 설문 회차 — 만들기·보내기·다시 보내기·회수. **수동 보내기와 (Phase 2) 자동 규칙 cron 이 같은 함수**를 쓴다(두 벌이면 갈라진다).
// 설계 docs/SURVEY_V2_DESIGN.md §5
//
// ★ 받는 사람마다 개인 열쇠(응답 1회). 열쇠는 메일에만 실리고 어느 API 응답에도 안 나간다.
// ★ 보내는 주소를 정하는 함수는 services/clientContact.primaryEmailOf 하나.
// ★ 다른 워크스페이스 고객·이메일 없는 고객이 섞이면 **조용히 빼지 않고 400** 으로 알린다(설계 §7 멀티테넌트).
// ★ 한 사람 실패가 다음을 막지 않는다 — 순차 발송, 실패는 status='failed' + EmailLog 사유.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { newToken } = require('./survey');
const { primaryEmailOf, displayNameOf, cleanEmail } = require('./clientContact');

const MAX_RECIPIENTS = 500;   // 한 회차 받는 사람 상한
const SYNC_SEND_MAX = 20;     // 이 이하면 응답 전에 다 보내고, 넘으면 응답 뒤 이어서 보낸다(HTTP 를 오래 붙잡지 않게)
const APP_URL = () => process.env.APP_URL || 'https://dev.planq.kr';

class IssueError extends Error {
  constructor(code, status, extra) { super(code); this.code = code; this.status = status; this.extra = extra || null; }
}

/**
 * 받는 사람 정리 — client_ids(이 워크스페이스 고객만) + 직접 적은 emails. 이메일 기준으로 겹치면 하나.
 * @returns {Promise<Array<{client_id:number|null,email:string,display_name:string|null}>>}
 */
async function resolveRecipients(businessId, { clientIds = [], emails = [] } = {}) {
  const { Client } = require('../models');
  const ids = [...new Set((Array.isArray(clientIds) ? clientIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = []; const seen = new Set();
  if (ids.length) {
    const clients = await Client.findAll({ where: { id: ids } });
    if (clients.length !== ids.length || clients.some((c) => c.business_id !== businessId)) {
      throw new IssueError('client_not_in_workspace', 400);
    }
    const noEmail = [];
    for (const c of clients) {
      const email = await primaryEmailOf(c);
      if (!email) { noEmail.push(c.id); continue; }
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ client_id: c.id, email, display_name: displayNameOf(c) || null });
    }
    if (noEmail.length) throw new IssueError('client_no_email', 400, { client_ids: noEmail });
  }
  for (const raw of (Array.isArray(emails) ? emails : [])) {
    const email = cleanEmail(raw);
    if (!email) throw new IssueError('invalid_email', 400, { email: String(raw).slice(0, 254) });
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ client_id: null, email, display_name: null });
  }
  if (!out.length) throw new IssueError('no_recipients', 400);
  if (out.length > MAX_RECIPIENTS) throw new IssueError('too_many_recipients', 400, { max: MAX_RECIPIENTS });
  return out;
}

/** 받는 사람 1명에게 메일 1통 — 결과로 상태·EmailLog 를 남긴다. */
async function sendOne(recipient, { issue, post, business, initiatedBy }) {
  const { EmailLog } = require('../models');
  const { sendSurveyInviteEmail } = require('./emailService');
  const token = recipient.token;
  if (!token) return recipient;   // 회수된 사람에게는 보내지 않는다
  const respondUrl = `${APP_URL()}/public/survey/${token}`;
  let ok = false; let err = null;
  try {
    ok = await sendSurveyInviteEmail({
      to: recipient.email,
      subject: issue.title,
      surveyTitle: post.title || '',
      workspaceName: business.brand_name || business.name || '',
      recipientName: recipient.display_name || null,
      message: issue.message || null,
      respondUrl,
      closesAt: issue.closes_at,
      fromName: business.mail_from_name || business.brand_name || business.name || null,
      replyTo: business.mail_reply_to || null,
      businessId: business.id,
      recipientId: recipient.id,
      initiatedBy: initiatedBy || null,
    });
  } catch (e) { err = e; ok = false; }
  const log = await EmailLog.findOne({
    where: { related_entity_type: 'survey_recipient', related_entity_id: recipient.id },
    order: [['id', 'DESC']], attributes: ['id', 'status', 'error_message'],
  });
  // 개발서버는 발송을 끈다(EMAIL_SENDING_ENABLED=false → EmailLog skipped «sending disabled»). 거기서는 보낸 것으로 본다 —
  //   그래야 개발서버에서 응답·통계 흐름을 끝까지 시험할 수 있다. 운영에서는 이 분기가 오지 않는다.
  const devSuppressed = !ok && !err && log && log.status === 'skipped' && /sending disabled/.test(String(log.error_message || ''));
  const now = new Date();
  await recipient.update({
    status: ok || devSuppressed ? (recipient.status === 'responded' ? 'responded' : 'sent') : 'failed',
    sent_at: now,
    email_log_id: log ? log.id : recipient.email_log_id,
  });
  return recipient;
}

async function loadSendCtx(issue) {
  const { Post, Business } = require('../models');
  const post = await Post.findOne({ where: { q_record_id: issue.q_record_id } });
  const business = await Business.findByPk(issue.business_id, { attributes: ['id', 'name', 'brand_name', 'mail_from_name', 'mail_reply_to'] });
  return { post, business };
}

/** 회차의 받는 사람들에게 순차 발송. only = 받는 사람 id 목록(다시 보내기). */
async function sendIssue(issue, { initiatedBy = null, only = null } = {}) {
  const { SurveyRecipient } = require('../models');
  const { post, business } = await loadSendCtx(issue);
  if (!post || !business) return { sent: 0, failed: 0 };
  const where = { issue_id: issue.id, token: { [Op.ne]: null } };
  if (only) where.id = only;
  else where.status = 'queued';
  const list = await SurveyRecipient.findAll({ where, order: [['id', 'ASC']] });
  let sent = 0; let failed = 0;
  for (const r of list) {
    // eslint-disable-next-line no-await-in-loop
    await sendOne(r, { issue, post, business, initiatedBy });
    if (r.status === 'failed') failed += 1; else sent += 1;
  }
  return { sent, failed };
}

/**
 * 수동 회차 만들기 + 보내기. 판정(권한·보안등급·요금제)은 부르는 쪽이 먼저 한다 — 여기서는 만들고 보낸다.
 * @returns {Promise<{issue, recipients:number, background:boolean}>}
 */
async function createManualIssue({ record, post, userId, recipients, title, message, closesAt }) {
  const { sequelize } = require('../config/database');
  const { SurveyIssue, SurveyRecipient } = require('../models');
  const issue = await sequelize.transaction(async (t) => {
    const now = new Date();
    const iss = await SurveyIssue.create({
      business_id: record.business_id,
      q_record_id: record.id,
      origin: 'manual',
      idempotency_key: `manual:${crypto.randomUUID()}`,
      status: 'sent',
      title: String(title || post.title || '').slice(0, 200) || 'Survey',
      message: message ? String(message).slice(0, 500) : null,
      closes_at: closesAt || null,
      created_by: userId,
      approved_by: userId,
      approved_at: now,
      sent_at: now,
    }, { transaction: t });
    await SurveyRecipient.bulkCreate(recipients.map((r) => ({
      issue_id: iss.id,
      business_id: record.business_id,
      client_id: r.client_id,
      email: r.email,
      display_name: r.display_name,
      token: newToken(),
      status: 'queued',
    })), { transaction: t });
    return iss;
  });
  const background = recipients.length > SYNC_SEND_MAX;
  if (background) {
    setImmediate(() => { sendIssue(issue, { initiatedBy: userId }).catch((e) => console.warn('[surveyIssue] send', issue.id, e.message)); });
  } else {
    await sendIssue(issue, { initiatedBy: userId });
  }
  return { issue, recipients: recipients.length, background };
}

/** 회차 목록 응답 모양 — 열쇠 없음. 받는 사람은 이름·이메일·상태·시각만. */
function serializeIssue(issue, recipients) {
  const { responseRate } = require('./surveyStats');
  const rs = recipients.map((r) => ({
    id: r.id,
    client_id: r.client_id,
    email: r.email,
    display_name: r.display_name,
    status: r.status,
    sent_at: r.sent_at,
    opened_at: r.opened_at,
    responded_at: r.responded_at,
    revoked: !r.token && !!r.revoked_at,
    has_responded: r.status === 'responded',
  }));
  const rate = responseRate(recipients);
  return {
    id: issue.id,
    origin: issue.origin,
    rule_id: issue.rule_id,
    status: issue.status,
    title: issue.title,
    message: issue.message,
    closes_at: issue.closes_at,
    sent_at: issue.sent_at,
    created_at: issue.created_at,
    counts: {
      total: rs.length,
      sent: rate.sent,
      failed: rs.filter((x) => x.status === 'failed').length,
      opened: rs.filter((x) => x.opened_at).length,
      responded: rate.responded,
      missing: rs.filter((x) => x.status === 'sent' && !x.revoked).length,
    },
    rate: rate.rate,
    recipients: rs,
  };
}

/** 문서 보안등급을 올리면 열린 회차의 개인 열쇠도 전부 회수한다(설계 §7 — 공개 링크 열쇠와 같이). */
async function revokeOpenTokensForRecord(recordId, { transaction } = {}) {
  const { SurveyIssue, SurveyRecipient } = require('../models');
  const issues = await SurveyIssue.findAll({ where: { q_record_id: recordId }, attributes: ['id'], transaction });
  if (!issues.length) return 0;
  const [n] = await SurveyRecipient.update(
    { token: null, revoked_at: new Date() },
    { where: { issue_id: issues.map((i) => i.id), token: { [Op.ne]: null } }, transaction },
  );
  return n;
}

module.exports = { IssueError, MAX_RECIPIENTS, resolveRecipients, createManualIssue, sendIssue, serializeIssue, revokeOpenTokensForRecord };
