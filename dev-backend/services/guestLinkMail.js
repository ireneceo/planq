// 고객 링크를 **고객에게 메일로** 보낸다 — 대화방 링크·프로젝트 외부 열람 링크가 같이 쓰는 한 벌 (2026-11-19).
//
// Irene: "고객에게 링크보내기 누르면 이메일로 보내줘야지."
//   그 전에는 [보내기] 가 폰 공유 시트(없으면 복사)였다 — 데스크탑에서 누르면 «복사됨» 만 떴다.
//
// ★ 받는 사람은 **서버가 정한다** — 링크가 걸린 대화방의 고객(conv.client_id) → 그 고객의 보낼 주소
//   (`clientContact.primaryEmailOf`: 계정 이메일 → 초대 이메일 → 프로젝트 고객 담당 이메일). 요청 body 의 주소는
//   받지 않는다 — 받으면 이 문이 «아무 주소로나 우리 이름의 메일을 보내는 문» 이 된다.
// ★ 화면은 누르기 전에 **보낼 주소를 보여 주고 확인**을 받는다(CLAUDE.md «외부 발송은 확인을 받는다»).
//   그래서 목록 응답에 `recipient` 를 싣고, 발송 응답도 실제로 보낸 주소를 돌려준다(둘이 같은 함수).
// ★ 메일 본문에는 대화 내용·고객 이름 외의 정보를 싣지 않는다 — 워크스페이스 이름 + 받는 분 이름 + 여는 버튼.
// platformroom-exempt: 링크가 걸린 대화방을 id 로만 찾는다(세지 않는다) — 안내방은 client_id 가 없어 받는 사람이 null 이다
const { Client, ProjectClient } = require('../models');
const { primaryEmailOf, displayNameOf } = require('./clientContact');

/**
 * 이 링크를 받을 고객. 대화방에 고객이 없거나 보낼 주소가 없으면 null.
 * @returns {Promise<{ client_id: number, name: string, email: string } | null>}
 */
async function guestLinkRecipient(conv, businessId) {
  if (!conv || !conv.client_id) return null;
  const client = await Client.findOne({ where: { id: conv.client_id, business_id: businessId } });
  if (!client) return null;
  let pc = null;
  if (conv.project_id) {
    pc = await ProjectClient.findOne({ where: { project_id: conv.project_id, client_id: client.id } });
  }
  const email = await primaryEmailOf(client, pc);
  if (!email) return null;
  return { client_id: client.id, name: displayNameOf(client) || (pc && pc.contact_name) || '', email };
}

/** 링크 행들의 방마다 받는 사람 — 프로젝트 링크 목록용(고객마다 방이 따로다). Map(conversation_id → recipient|null). */
async function recipientsByConversation(links, businessId) {
  const { Conversation } = require('../models');
  const out = new Map();
  for (const l of links) {
    if (!l.conversation_id || out.has(l.conversation_id)) continue;
    const cv = await Conversation.findOne({ where: { id: l.conversation_id, business_id: businessId } });
    out.set(l.conversation_id, cv ? await guestLinkRecipient(cv, businessId) : null);
  }
  return out;
}

/**
 * 발송 본체. 부르는 쪽(두 라우트)이 권한·링크 소속을 이미 확인했다.
 * @returns {Promise<{ ok: true, to: string, suppressed: boolean } | { ok: false, code: string, status: number }>}
 */
async function sendGuestLinkMail({ link, url, conv, businessId, userId, locale }) {
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at).getTime() <= Date.now())) {
    return { ok: false, code: 'link_not_live', status: 409 };
  }
  // 옛 난수 링크는 주소를 되살릴 수 없다 — 보낼 주소가 없다.
  if (!url) return { ok: false, code: 'link_url_unavailable', status: 409 };
  const { assertGuestLinkIssuable } = require('./guest_link');
  // 킬스위치(플랫폼·워크스페이스)·고객 대화방·보관 — 발급과 **같은 술어**. 꺼진 링크를 메일로 보내면 «눌러도 안 열리는 메일» 이다.
  const blocked = await assertGuestLinkIssuable(conv, businessId);
  if (blocked) return { ok: false, code: blocked.code, status: blocked.status };

  const rcpt = await guestLinkRecipient(conv, businessId);
  if (!rcpt) return { ok: false, code: 'no_recipient_email', status: 400 };

  const { loadWorkspaceSender } = require('./workspaceSender');
  const { workspaceName, fromName, replyTo } = await loadWorkspaceSender(businessId);
  const { sendGuestLinkEmail, emailSendingDisabled } = require('./emailService');
  // 개발 서버는 메일을 실제로 보내지 않는다(EmailLog 에 skipped 로만 남는다) — «보냈다» 고 말하지 않고 그 사실을 돌려준다.
  const suppressed = emailSendingDisabled();
  const sent = await sendGuestLinkEmail({
    to: rcpt.email,
    recipientName: rcpt.name,
    workspaceName, fromName, replyTo,
    openUrl: url,
    scope: link.scope || 'conversation',
    businessId,
    conversationId: conv.id,
    initiatedBy: userId,
    locale,
  });
  if (!sent && !suppressed) return { ok: false, code: 'mail_send_failed', status: 502 };

  const { createAuditLog } = require('./auditService');
  createAuditLog({
    userId, businessId,
    action: 'guest_link.email', targetType: 'GuestLink', targetId: link.id,
    newValue: { to: rcpt.email, client_id: rcpt.client_id, conversation_id: conv.id, scope: link.scope || 'conversation', suppressed },
  });
  return { ok: true, to: rcpt.email, suppressed };
}

module.exports = { guestLinkRecipient, recipientsByConversation, sendGuestLinkMail };
