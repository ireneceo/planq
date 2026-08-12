// #262 — 이 발송에 **실제로** 붙을 발신자·서명을 조회한다 (화면 미리보기용).
//
// Irene: "메일 보낼 때 서명이 팀서명과 개인서명 뭐가 붙는지도 모르고 알 수도 없어."
// 서명은 발송 시점에 emailSend 가 별칭 > 계정 > 워크스페이스 순으로 고른다 — 화면엔 그 결과가
// 전혀 없었다. 여기서 **sendMail 과 같은 함수**(resolveOutgoingIdentity)를 태워 계산한다.
// 같은 함수가 아니면 미리보기와 실발송이 어긋나고, 그건 "표시≠실발신" 사고다.
//
// threadId 를 받는 이유: 답장은 별칭을 사용자가 고른 게 아니라 **받은 주소**로 자동 결정된다
// (resolveSender ②). alias 만 받으면 답장 미리보기가 실제와 달라진다.
const { Op } = require('sequelize');
const { EmailAccount, EmailThread, EmailMessage } = require('../models');
const { resolveOutgoingIdentity } = require('./emailSend');
const { emailsOf } = require('./emailAddress');

// 프라이버시 격리 — 회사 공용 계정(owner_user_id NULL) + 본인 개인 계정만.
async function accessibleAccountIds(businessId, userId) {
  const accts = await EmailAccount.findAll({
    where: { business_id: businessId, [Op.or]: [{ owner_user_id: null }, { owner_user_id: userId }] },
    attributes: ['id'],
  });
  return accts.map(a => a.id);
}

async function outgoingIdentityFor({ businessId, userId, accountId = null, threadId = null, fromAliasId = null }) {
  const acctIds = await accessibleAccountIds(businessId, userId);
  if (!acctIds.length) return { error: 'no_mail_account', status: 404 };
  if (accountId && !acctIds.includes(accountId)) return { error: 'forbidden_account', status: 403 };

  // 스레드가 주어지면 그 스레드의 계정 + 받은 주소로 실제 답장 분기를 태운다.
  let replyToAddresses = null;
  let resolvedAccountId = accountId;
  if (threadId) {
    const thread = await EmailThread.findOne({
      where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds } },
      attributes: ['id', 'account_id'],
    });
    if (!thread) return { error: 'thread_not_found', status: 404 };
    resolvedAccountId = thread.account_id;
    const lastIn = await EmailMessage.findOne({
      where: { thread_id: thread.id, direction: 'inbound' },
      order: [['sent_at', 'DESC']], attributes: ['to_emails'],
    });
    if (lastIn) replyToAddresses = emailsOf(lastIn.to_emails);
  }
  if (!resolvedAccountId) resolvedAccountId = acctIds[0];

  const account = await EmailAccount.findOne({ where: { id: resolvedAccountId, business_id: businessId } });
  if (!account) return { error: 'no_mail_account', status: 404 };

  const ident = await resolveOutgoingIdentity(account, { fromAliasId, replyToAddresses });
  return {
    data: {
      account_id: account.id,
      from_name: ident.fromName || null,
      from_email: ident.fromEmail,
      // 'alias' | 'account' | 'workspace' | 'none' | 'disabled' — 화면이 "팀/개인" 을 말할 근거
      signature_source: ident.signatureSource,
      signature_html: ident.signatureHtml || null,
    },
  };
}

module.exports = { outgoingIdentityFor, accessibleAccountIds };
