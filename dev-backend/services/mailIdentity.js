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

/**
 * 답장 제목 — `Re:` 접두(이미 있으면 그대로). **미리보기와 발송이 같은 공식을 쓴다.**
 *   `detectLang` 이 제목을 ×3 가중하므로, 화면이 제목을 안 보내면 서명 언어가 갈린다
 *   (Fable 실측: 한국어 제목 스레드에 영어 답장 → 미리보기 en / 실발송 ko).
 */
function replySubjectOf(baseSubject) {
  const b = String(baseSubject || '').trim();
  return /^re:/i.test(b) ? b : `Re: ${b}`.trim();
}

async function outgoingIdentityFor({ businessId, userId, accountId = null, threadId = null, fromAliasId = null, bodyHtml = '', subject = '' }) {
  const acctIds = await accessibleAccountIds(businessId, userId);
  if (!acctIds.length) return { error: 'no_mail_account', status: 404 };
  if (accountId && !acctIds.includes(accountId)) return { error: 'forbidden_account', status: 403 };

  // 스레드가 주어지면 그 스레드의 계정 + 받은 주소로 실제 답장 분기를 태운다.
  let replyToAddresses = null;
  let resolvedAccountId = accountId;
  if (threadId) {
    const thread = await EmailThread.findOne({
      where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds } },
      attributes: ['id', 'account_id', 'subject'],
    });
    if (!thread) return { error: 'thread_not_found', status: 404 };
    resolvedAccountId = thread.account_id;
    const lastIn = await EmailMessage.findOne({
      where: { thread_id: thread.id, direction: 'inbound' },
      order: [['sent_at', 'DESC']], attributes: ['to_emails'],
    });
    if (lastIn) replyToAddresses = emailsOf(lastIn.to_emails);
    // ★ 답장 제목은 **서버가 만든다** — 발송 라우트와 같은 공식(replySubjectOf).
    //   화면이 제목을 안 보내던 탓에 «미리보기 en / 실발송 ko» 가 났다(Fable 실측).
    if (!subject) {
      const last = await EmailMessage.findOne({
        where: { thread_id: thread.id }, order: [['sent_at', 'DESC']], attributes: ['subject'],
      });
      subject = replySubjectOf(thread.subject || (last && last.subject) || '');
    }
  }
  if (!resolvedAccountId) resolvedAccountId = acctIds[0];

  const account = await EmailAccount.findOne({ where: { id: resolvedAccountId, business_id: businessId } });
  if (!account) return { error: 'no_mail_account', status: 404 };

  // ★ 서명 **언어**도 여기서 같이 계산한다 — 화면이 스스로 판정하면 실발송과 갈라진다.
  //   원천은 «나가는 본문+제목». 답장 화면이 아직 비어 있으면 워크스페이스 기본 언어로 떨어진다
  //   (resolveOutgoingIdentity 안의 detectLang 폴백).
  // ★ 본문 정규화도 **발송과 같은 렌즈**여야 한다 — 화면이 자체 stripHtml 로 2000자만 보내던 탓에
  //   장문 이중언어에서 판정이 갈렸다. 원본 HTML 을 받아 sendMail 과 같은 함수로 텍스트화한다.
  const { htmlToTextForWire } = require('./emailSend');
  const ident = await resolveOutgoingIdentity(account, {
    fromAliasId, replyToAddresses,
    langText: htmlToTextForWire(bodyHtml || ''), langSubject: subject || '',
  });
  return {
    data: {
      account_id: account.id,
      from_name: ident.fromName || null,
      from_email: ident.fromEmail,
      // 'alias' | 'account' | 'workspace' | 'none' | 'disabled' — 화면이 "팀/개인" 을 말할 근거
      signature_source: ident.signatureSource,
      signature_html: ident.signatureHtml || null,
      // 'ko' | 'en' — 이 메일에 붙을 서명의 언어. 화면은 이 값을 **보여주기만** 한다.
      signature_lang: ident.signatureLang,
      // true = 그 언어 칸이 비어 기본 서명으로 떨어졌다 (화면이 "영문 서명 없음" 을 말할 근거)
      signature_lang_fallback: !!ident.signatureLangFallback,
      // ★ 영문 서명을 **어느 층에 저장해야 이 메일에 붙는지**. 화면이 스스로 고르면
      //   «저장했는데 안 붙는다» 가 된다(이긴 층이 아니면 내려오지 않는다).
      signature_target: ident.signatureSource === 'alias' && ident.signatureAliasId
        ? { layer: 'alias', account_id: account.id, alias_id: ident.signatureAliasId }
        : ident.signatureSource === 'workspace'
          ? { layer: 'workspace', account_id: account.id, alias_id: null }
          : { layer: 'account', account_id: account.id, alias_id: null },
    },
  };
}

module.exports = {
  replySubjectOf, outgoingIdentityFor, accessibleAccountIds };
