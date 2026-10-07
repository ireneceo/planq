// [스팸 아님] — 업체 스팸함에서 가져온 스레드를 받은 메일로 되돌린다.
//   설계: docs/MAIL_SENT_SPAM_SYNC_DESIGN.md · Fable 판정 2026-10-07 쟁점 ①·④
//
// 왜 그 자리에서 판정을 다시 돌리나
//   스팸함 메일은 수집 때 수신 판정(isKnownContact·발신자 규칙·고객 연결)을 **전부 건너뛰고** 들어온다
//   (스팸이 고객 이력·상담·답변 필요를 오염시키지 않게). 사람이 «스팸 아님» 이라 한 순간 그 메일은
//   보통의 받은 메일이 되므로, 받은편지함 수집과 **같은 판정**(emailTriage + mailSenderRules + mailLink)을 지금 돌린다.
//   ★ 알림은 보내지 않는다 — 사람이 지금 보고 있는 메일이다.
//   ★ 원 대화에 다시 붙이지 않는다(쟁점 ① — 스팸은 항상 새 스레드 유지).
//   ★ spam_origin·spam_since 를 비운다 = 30일 삭제 대상에서 빠진다.
//   업체 쪽(Gmail·네이버)의 스팸 표시는 그대로다 — 우리는 업체에 아무것도 쓰지 않는다. 화면이 그것을 말한다.
const { EmailMessage } = require('../models');

async function releaseProviderSpam(thread) {
  const base = { spam_origin: null, spam_since: null };
  const msg = await EmailMessage.findOne({
    where: { thread_id: thread.id, direction: 'inbound' },
    order: [['sent_at', 'DESC'], ['id', 'DESC']],
  });
  if (!msg) { await thread.update({ ...base, status: 'open' }); return { retriaged: false }; }

  const businessId = Number(thread.business_id);
  const T = require('./emailTriage');
  const { applyRules } = require('./mailSenderRules');
  const { isKnownContact } = require('./emailImapCron');
  const fromEmail = String(msg.from_email || '').toLowerCase();
  const [ownEmails, ownMatcher] = await Promise.all([T.buildOwnEmailSet(businessId), T.buildOwnAddressMatcher(businessId)]);
  const known = await isKnownContact(businessId, fromEmail, { excludeMessageId: msg.id });
  const { headers, complete } = T.headersFromMessage(msg);
  const triaged = T.retriageStored({
    triage: 'human',
    subject: msg.subject || thread.subject,
    bodyText: msg.body_text || '',
    fromEmail,
    headers,
    headersComplete: complete,
    ownEmails,
    ownMatcher,
    isKnownContact: known,
  });
  const tr = await applyRules(businessId, fromEmail, triaged, { subject: msg.subject, bodyText: msg.body_text });

  let fields;
  if (tr.status === 'spam' || tr.triage === 'spam') {
    // 휴리스틱·규칙이 여전히 스팸이라 해도 사람이 «아니다» 라 했다 — 사람의 판단이 이긴다.
    //   다만 확신이 없으므로 답변 필요가 아니라 확인 권장으로 둔다.
    fields = { status: 'uncertain', triage: 'unknown', reply_needed: false, uncertain_reason: 'unclear_intent', rule_id: null };
  } else {
    fields = T.threadFieldsForInbound({
      isNew: true, thread, tr, replyNeeded: !!tr.reply_needed,
      ruleReason: tr.rule_applied ? 'rule' : 'inbound', messageDate: msg.sent_at,
    });
  }

  // 고객·프로젝트 연결 — 수집 때 건너뛴 것을 지금 한다(술어는 mailLink 하나).
  let link = {};
  try {
    const addrs = [
      fromEmail,
      ...((Array.isArray(msg.to_emails) ? msg.to_emails : []).map((x) => x && x.email)),
      ...((Array.isArray(msg.cc_emails) ? msg.cc_emails : []).map((x) => x && x.email)),
    ];
    const linked = await require('./mailLink').linkThread(thread, { addresses: addrs });
    link = { client_id: linked.client_id ?? thread.client_id ?? null };
  } catch (e) { console.warn('[mailSpamRelease] linkThread', e.message); }

  await thread.update({ ...fields, ...link, ...base });
  return { retriaged: true, status: fields.status, reply_needed: !!fields.reply_needed };
}

module.exports = { releaseProviderSpam };
