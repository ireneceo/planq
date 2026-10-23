// services/clientLinkSource.js — 고객을 «만들고 그 자리의 출처(메일·게스트 링크·고객 대화)에 연결» 하는 한 벌
//   설계: docs/CLIENT_ADD_INVITE_DESIGN.md §3 (Fable 2026-10-23).
//   쓰는 문 셋: POST /api/sale/:biz/save-as-client · POST /api/clients/:biz/managed · POST /api/clients/:biz/invite.
//   ★ 검증(resolveSource)은 **행을 만들거나 초대 메일을 보내기 전에** 부른다 — 실패하면 아무 부수효과 없이 끝나야 한다.
//   ★ 연결(attachSourceToClient)은 save-as-client 의 부수효과 블록을 그대로 옮긴 것이다(값·조건 그대로).
const { Op } = require('sequelize');

const KINDS = ['email_thread', 'guest_link', 'conversation'];

/** 입력 모양만 본다 — 없으면 null(연결 없음), 모양이 틀리면 { error } */
function parseSource(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const kind = String(raw.kind || '');
  const id = Number(raw.id);
  if (!KINDS.includes(kind) || !Number.isInteger(id) || id <= 0) return { error: 'invalid_source' };
  return { kind, id };
}

/**
 * 출처를 찾고 붙일 수 있는지 본다. 결과의 `boundClientId` = 이미 붙은 고객(없으면 null).
 *   email 은 사람이 폼에 적은 받는 주소 — 첫 발신자가 자동 발송 주소(웹폼 릴레이)인데 그 주소로 고객을 만들려 하면 막는다.
 * @returns {{ok:true, kind, thread?, link?, parent?, conv?, senderEmail?, boundClientId}} | {ok:false, http, code}
 */
async function resolveSource(businessId, actorUserId, source, { email = null } = {}) {
  const { EmailThread, EmailMessage, GuestLink, Conversation } = require('../models');
  if (source.kind === 'email_thread') {
    const { accessibleAccountIds } = require('./clientTimeline');
    const acctIds = await accessibleAccountIds(businessId, actorUserId);
    const thread = await EmailThread.findOne({
      where: { id: source.id, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } },
    });
    if (!thread) return { ok: false, http: 404, code: 'thread_not_found' };
    const first = await EmailMessage.findOne({
      where: { business_id: businessId, thread_id: thread.id, direction: 'inbound' },
      order: [['sent_at', 'ASC']],
      attributes: ['from_email'],
    });
    const { normEmail } = require('./saleCommon');
    const sender = normEmail(first?.from_email);
    const automated = !!sender && require('./emailTriage').isAutomatedSenderAddress(sender);
    // #449 D5 — 웹폼 릴레이(no-reply@…) 주소로 고객을 만들지 않는다(사람의 연락처는 본문에 있다)
    if (automated && normEmail(email) === sender) return { ok: false, http: 400, code: 'relay_sender_use_manual' };
    return { ok: true, kind: 'email_thread', thread, senderEmail: automated ? null : sender, boundClientId: thread.client_id || null };
  }
  if (source.kind === 'guest_link') {
    const link = await GuestLink.findOne({ where: { id: source.id, business_id: businessId } });
    if (!link) return { ok: false, http: 404, code: 'guest_link_not_found' };
    const parent = link.kind === 'personal' && link.parent_link_id
      ? await GuestLink.findOne({ where: { id: link.parent_link_id, business_id: businessId } })
      : null;
    return { ok: true, kind: 'guest_link', link, parent, boundClientId: link.client_id || parent?.client_id || null };
  }
  const conv = await Conversation.findOne({ where: { id: source.id, business_id: businessId } });
  if (!conv) return { ok: false, http: 404, code: 'conversation_not_found' };
  // 고객 대화방만 — 팀 대화방을 고객에 붙이면 상담 목록의 «누구» 가 우리 멤버가 된다(promote 와 같은 줄)
  if (conv.channel_type !== 'customer') return { ok: false, http: 400, code: 'not_customer_chat' };
  return { ok: true, kind: 'conversation', conv, boundClientId: conv.client_id || null };
}

/** 이미 **다른** 고객이 붙어 있으면 충돌 — 같은 고객이면 그대로 통과(no-op). targetId 가 없으면(새 행) 붙어 있기만 해도 충돌 */
function sourceConflict(resolved, targetId) {
  if (!resolved || !resolved.boundClientId) return null;
  if (targetId && Number(resolved.boundClientId) === Number(targetId)) return null;
  return { http: 409, code: 'already_client', existing_client_id: resolved.boundClientId };
}

/**
 * 만든(또는 승격한) 고객에 출처를 붙인다. 비어 있는 연결만 채운다(사람이 이미 건 연결을 덮지 않는다).
 *   같은 발신 주소의 미연결 스레드도 붙인다 — 워크스페이스 전체(들어오는 메일 자동 연결 mailLink 와 같은 범위).
 *   ★ 붙인 개수는 응답에 싣지 않는다(남의 개인 메일 계정에 몇 통 있는지가 샌다) — 감사 로그에만.
 * @param opts.email       같은 발신자 스레드를 찾을 주소(기본 = 출처의 첫 발신자)
 * @param opts.inquiryStage 단계가 비었거나 none 이면 inquiry 로(새 문 /managed·/invite). save-as-client 는 자기가 정한다.
 */
async function attachSourceToClient({ businessId, actorUserId, client, resolved, req, email = null, inquiryStage = false }) {
  if (!resolved) return;
  const { EmailThread, EmailMessage, GuestLink, Conversation } = require('../models');
  let threadsLinked = 0;
  if (resolved.kind === 'guest_link') {
    const { link } = resolved;
    if (!link.client_id) await link.update({ client_id: client.id });
    if (link.kind === 'personal' && link.parent_link_id) {
      await GuestLink.update({ client_id: client.id },
        { where: { id: link.parent_link_id, business_id: businessId, client_id: null } });
    }
    await Conversation.update({ client_id: client.id },
      { where: { id: link.conversation_id, business_id: businessId, client_id: null } });
  } else if (resolved.kind === 'conversation') {
    await Conversation.update({ client_id: client.id },
      { where: { id: resolved.conv.id, business_id: businessId, client_id: null } });
  } else if (resolved.kind === 'email_thread') {
    const { thread } = resolved;
    if (!thread.client_id) { await thread.update({ client_id: client.id }); threadsLinked += 1; }
    const addr = email || resolved.senderEmail;
    if (addr) {
      const msgs = await EmailMessage.findAll({
        where: { business_id: businessId, direction: 'inbound', from_email: addr },
        attributes: ['thread_id'], group: ['thread_id'], limit: 500, raw: true,
      });
      const ids = msgs.map((m) => m.thread_id).filter((id) => id !== thread.id);
      if (ids.length) {
        const [n] = await EmailThread.update({ client_id: client.id },
          { where: { id: { [Op.in]: ids }, business_id: businessId, client_id: null } });
        threadsLinked += n || 0;
      }
    }
    if (req) {
      try { require('./mailBroadcast').broadcastMail(req, businessId, 'mail:updated', { thread_id: thread.id, client_id: client.id }); } catch { /* 신호일 뿐 */ }
    }
  }

  if (inquiryStage && (!client.sales_stage || client.sales_stage === 'none')) {
    const reason = resolved.kind === 'email_thread' ? 'mail_inquiry' : 'guest_inquiry';
    await require('./salesStage').setStage(client, 'inquiry', { origin: 'manual', by: actorUserId, reason });
  }

  const { createAuditLog } = require('./auditService');
  createAuditLog({
    userId: actorUserId, businessId,
    action: 'client.link_source', targetType: 'client', targetId: client.id,
    newValue: { kind: resolved.kind, id: resolved.thread?.id || resolved.link?.id || resolved.conv?.id || null, threads_linked: threadsLinked },
  });
}

module.exports = { parseSource, resolveSource, sourceConflict, attachSourceToClient, SOURCE_KINDS: KINDS };
