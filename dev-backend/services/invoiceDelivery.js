// 청구서 발송(채팅 카드 · 이메일) — **응답 뒤 백그라운드**에서 돈다.
//
// 왜 분리했나 (운영 신고 2026-09-03, Irene: "발송 누르면 계속 로딩되고 있어"):
//   여태 /send 라우트가 PDF 생성과 SMTP 발송을 **await** 했다. 실측 —
//     PDF 2.6초 + SMTP 타임아웃(connection 10s · greeting 10s · socket 30s)
//   메일 서버가 느리면 사용자는 30~50초를 빈 화면 앞에서 기다린다. 그 사이 상태는 이미
//   'sent' 로 커밋돼 있으므로, **기다릴 이유가 없는 대기**였다.
//
// 그래서: 상태 전이는 트랜잭션 안에서 끝내고 즉시 응답한다. 발송은 여기서 한다.
//   진행 상태는 invoice.meta.email_delivery / chat_delivery 에 남고, 매 전이마다
//   invoice:updated 를 broadcast 해서 목록·상세가 저절로 갱신된다(CLAUDE.md §16).
//
// ★ 상태값을 늘리면 읽는 곳을 전수로 고친다(CLAUDE.md 상태값 규약).
//   여기 status 는 queued | sending | sent | failed | skipped 다섯이다.
//   프론트는 utils/invoiceDelivery.ts 의 같은 목록을 쓴다 — 값이 갈라지면 화면이 조용히 빈다.
const { Invoice, InvoiceInstallment, Post, Client, Business, User, Conversation, Message } = require('../models');

const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'];
// 이 시간을 넘겨도 'sending' 이면 프로세스가 죽은 것이다 — 스위퍼가 failed 로 내린다.
const STALE_MS = 10 * 60 * 1000;

// ★ Sequelize 는 JSON 컬럼의 in-place 변형을 감지하지 못한다 — 새 객체로 갈아끼워야 저장된다
//   (memory feedback_sequelize_json_inplace_mutation). 여기서 한 번만 처리한다.
async function patchMeta(invoiceId, patch) {
  const inv = await Invoice.findByPk(invoiceId, { attributes: ['id', 'meta'] });
  if (!inv) return null;
  const next = { ...(inv.meta || {}), ...patch };
  await Invoice.update({ meta: next }, { where: { id: invoiceId } });
  return next;
}

async function broadcast(io, invoiceId) {
  if (!io) return;
  try {
    const fresh = await Invoice.findByPk(invoiceId, {
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status'], required: false },
      ],
    });
    if (fresh?.business_id) io.to(`business:${fresh.business_id}`).emit('invoice:updated', fresh.toJSON());
  } catch (e) { console.warn('[invoiceDelivery broadcast]', e.message); }
}

// 받는 사람 결정 — 청구서에 적힌 주소가 먼저, 없으면 고객의 세금계산서 > 청구 담당 > 초대 주소
async function resolveRecipient(invoice) {
  if (invoice.recipient_email) return invoice.recipient_email;
  if (!invoice.client_id) return null;
  const cl = await Client.findByPk(invoice.client_id, {
    attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'],
  });
  return cl?.tax_invoice_email || cl?.billing_contact_email || cl?.invite_email || null;
}

// ── 채팅 카드 ────────────────────────────────────────────────────────
async function deliverChat({ invoice, actorUserId, message, shareUrl, io }) {
  if (!(invoice.project_id || invoice.client_id)) return { status: 'skipped', reason: 'no_target' };
  let conv = null;
  // 프로젝트 청구 → 그 프로젝트의 '고객' 대화방. 프로젝트 대화방은 client_id=null 이라
  // client_id 로 찾으면 못 찾는다.
  if (invoice.project_id) {
    conv = await Conversation.findOne({ where: { business_id: invoice.business_id, project_id: invoice.project_id, channel_type: 'customer' }, order: [['last_message_at', 'DESC']] });
    if (!conv) conv = await Conversation.findOne({ where: { business_id: invoice.business_id, project_id: invoice.project_id }, order: [['last_message_at', 'DESC']] });
  }
  if (!conv && invoice.client_id) {
    conv = await Conversation.findOne({ where: { business_id: invoice.business_id, client_id: invoice.client_id }, order: [['last_message_at', 'DESC']] });
  }
  if (!conv) return { status: 'failed', reason: 'no_conversation' };

  const userMessage = String(message || '').slice(0, 1000);
  const fallback = userMessage
    ? `[청구서] ${invoice.invoice_number} · ${invoice.title} — ${userMessage}`
    : `[청구서] ${invoice.invoice_number} · ${invoice.title}`;
  const msg = await Message.create({
    conversation_id: conv.id,
    sender_id: actorUserId,
    content: fallback,
    kind: 'card',
    meta: {
      card_type: 'invoice', invoice_id: invoice.id, invoice_number: invoice.invoice_number,
      share_token: invoice.share_token, share_url: shareUrl, title: invoice.title,
      total: Number(invoice.grand_total || 0), currency: invoice.currency,
      installment_mode: invoice.installment_mode, status: 'sent', paid_at: null,
      last_notify_at: null, last_notify_installment_id: null, note: userMessage || null,
    },
  });
  await conv.update({ last_message_at: new Date() });

  try {
    const full = await Message.findByPk(msg.id, { include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }] });
    const fullJson = full.toJSON();
    try { const { applyMemberDisplayNameOne } = require('./displayName'); await applyMemberDisplayNameOne(fullJson, conv.business_id, ['sender']); } catch { /* best-effort */ }
    if (io) {
      io.to(`conv:${conv.id}`).emit('message:new', fullJson);
      io.to(`business:${conv.business_id}`).emit('message:new', fullJson);
    }
  } catch (bErr) { console.warn('[invoiceDelivery chat broadcast]', bErr.message); }

  // 알림 fan-out — 누락하면 OS push 가 영영 0 이다 (CLAUDE.md §13)
  try {
    const { ConversationParticipant } = require('../models');
    const parts = await ConversationParticipant.findAll({ where: { conversation_id: conv.id }, attributes: ['user_id'] });
    const targetIds = parts.map((p) => p.user_id).filter((uid) => uid && uid !== actorUserId);
    if (targetIds.length) {
      const { notifyMany } = require('../routes/notifications');
      const biz = await Business.findByPk(conv.business_id, { attributes: ['name', 'brand_name'] }).catch(() => null);
      await notifyMany({
        userIds: targetIds,
        businessId: conv.business_id,
        eventKind: 'message',
        titleSpec: { feature: 'bill', action: 'bill_invoice_sent', subject: invoice.invoice_number },
        body: `${invoice.title || ''} 청구서가 도착했습니다.`,
        link: `/talk/${conv.id}`,
        workspaceName: biz?.brand_name || biz?.name || null,
      });
    }
  } catch (nErr) { console.warn('[invoiceDelivery chat notify]', nErr.message); }

  return { status: 'sent', conversation_id: conv.id, message_id: msg.id, title: conv.title || null };
}

// ── 이메일 ──────────────────────────────────────────────────────────
//   to 를 지정하면 그 주소로 보낸다(미리보기: 본인에게). 없으면 고객 주소를 찾는다.
async function deliverEmail({ invoice, actorUserId, message, shareUrl, to: forcedTo }) {
  const { sendInvoiceEmail } = require('./emailService');
  const { payerCodeOf, receiptKindOf } = require('./receiptsDue');
  const recipient = forcedTo || await resolveRecipient(invoice);
  if (!recipient) return { status: 'failed', reason: 'no_recipient_email' };

  const business = await Business.findByPk(invoice.business_id, {
    attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'],
  });
  const sender = await User.findByPk(actorUserId, { attributes: ['name'] });
  const { getMemberDisplayName } = require('./displayName');
  const senderDisp = await getMemberDisplayName(invoice.business_id, actorUserId, sender?.name);

  // PDF 첨부는 best-effort — 실패해도 메일 자체는 나간다
  let attachments = null;
  try {
    const { buildInvoicePdf } = require('./invoicePdf');
    const { pdf } = await buildInvoicePdf(invoice.id);
    attachments = [{ filename: `${invoice.invoice_number || 'invoice'}.pdf`, content: pdf, contentType: 'application/pdf' }];
  } catch (pdfErr) { console.warn('[invoiceDelivery] PDF attach failed:', pdfErr.message); }

  // ★ Client 가 include 안 된 경로가 있다 — invoice.Client 만 믿으면 입금 코드가 조용히 빈다
  const mailClient = invoice.Client || (invoice.client_id ? await Client.findByPk(invoice.client_id) : null);
  const ok = await sendInvoiceEmail({
    payerCode: payerCodeOf(invoice, mailClient),
    willIssueTax: receiptKindOf(invoice, mailClient) === 'tax' && invoice.tax_invoice_status !== 'issued',
    to: recipient,
    invoiceNumber: invoice.invoice_number,
    title: invoice.title,
    total: Number(invoice.grand_total || 0),
    currency: invoice.currency,
    dueDate: invoice.due_date,
    senderName: senderDisp.name || '',
    workspaceName: business?.brand_name || business?.name || '',
    message: String(message || '').slice(0, 1000) || null,
    shareUrl,
    attachments,
    fromName: business?.mail_from_name || business?.brand_name || business?.name || null,
    replyTo: business?.mail_reply_to || null,
  });
  // 실패에도 pdf_attached 를 남긴다 — "메일이 안 갔다" 와 "PDF 를 못 만들었다" 는 다른 사고다.
  return ok
    ? { status: 'sent', to: recipient, pdf_attached: !!attachments }
    : { status: 'failed', to: recipient, reason: 'smtp_rejected', pdf_attached: !!attachments };
}

/**
 * 발송을 백그라운드로 돌린다. **await 하지 말 것** — 그러면 분리한 의미가 없다.
 * 진행 상태는 invoice.meta 에 남고 매 전이마다 broadcast 된다.
 */
function queueDelivery({ invoiceId, actorUserId, sendChat, sendEmail, message, shareUrl, io, emailTo = null }) {
  const now = new Date().toISOString();
  const initial = {};
  if (sendChat) initial.chat_delivery = { status: 'queued', queued_at: now };
  if (sendEmail) initial.email_delivery = { status: 'queued', queued_at: now };
  // 큐 표시는 응답 전에 남긴다 — 사용자가 즉시 "보내는 중" 을 본다
  const started = patchMeta(invoiceId, initial);

  setImmediate(async () => {
    await started.catch(() => null);
    let invoice;
    try {
      invoice = await Invoice.findByPk(invoiceId, { include: [{ model: Client, required: false }] });
      if (!invoice) return;
    } catch (e) { console.warn('[invoiceDelivery load]', e.message); return; }

    const patch = {};
    if (sendChat) {
      await patchMeta(invoiceId, { chat_delivery: { status: 'sending', queued_at: now } });
      await broadcast(io, invoiceId);
      try {
        patch.chat_delivery = { ...(await deliverChat({ invoice, actorUserId, message, shareUrl, io })), finished_at: new Date().toISOString() };
      } catch (e) {
        patch.chat_delivery = { status: 'failed', reason: e.message, finished_at: new Date().toISOString() };
      }
    }
    if (sendEmail) {
      await patchMeta(invoiceId, { email_delivery: { status: 'sending', queued_at: now } });
      await broadcast(io, invoiceId);
      try {
        patch.email_delivery = { ...(await deliverEmail({ invoice, actorUserId, message, shareUrl, to: emailTo })), finished_at: new Date().toISOString() };
      } catch (e) {
        patch.email_delivery = { status: 'failed', reason: e.message, finished_at: new Date().toISOString() };
      }
    }
    await patchMeta(invoiceId, patch);
    await broadcast(io, invoiceId);

    // 이력 — 무엇이 어디로 나갔는지는 화면 상태와 별개로 남긴다
    try {
      const { logBillEvent } = require('./billEvents');
      await logBillEvent('invoice', invoiceId, 'delivered', {
        actorUserId,
        detail: {
          chat: patch.chat_delivery?.status || null,
          email: patch.email_delivery?.status || null,
          email_to: patch.email_delivery?.to || null,
          chat_conversation_id: patch.chat_delivery?.conversation_id || null,
        },
      });
    } catch (e) { console.warn('[invoiceDelivery billEvent]', e.message); }
  });

  return { queued: true, chat: !!sendChat, email: !!sendEmail };
}

/**
 * 죽은 발송 정리 — 프로세스가 발송 도중 재시작되면 'sending' 이 영원히 남는다.
 * 화면은 그것을 "보내는 중" 으로 그리므로, 사용자에게는 무한 로딩과 같아진다.
 */
async function sweepStaleDeliveries() {
  const { Op } = require('sequelize');
  const cutoff = new Date(Date.now() - STALE_MS);
  const rows = await Invoice.findAll({
    where: { meta: { [Op.ne]: null }, updated_at: { [Op.lt]: cutoff } },
    attributes: ['id', 'meta'],
    limit: 500,
    order: [['updated_at', 'DESC']],
  });
  let fixed = 0;
  for (const r of rows) {
    const m = r.meta || {};
    const patch = {};
    for (const key of ['email_delivery', 'chat_delivery']) {
      const d = m[key];
      if (d && (d.status === 'sending' || d.status === 'queued')) {
        const at = new Date(d.queued_at || 0).getTime();
        if (!at || Date.now() - at > STALE_MS) {
          patch[key] = { ...d, status: 'failed', reason: 'timeout_no_result', finished_at: new Date().toISOString() };
        }
      }
    }
    if (Object.keys(patch).length) { await patchMeta(r.id, patch); fixed++; }
  }
  if (fixed) console.log(`[invoiceDelivery] 죽은 발송 ${fixed}건 정리`);
  return fixed;
}

module.exports = { queueDelivery, sweepStaleDeliveries, DELIVERY_STATUSES, STALE_MS, resolveRecipient, deliverEmail, deliverChat };
