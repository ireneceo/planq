// services/invoicePayments.js — Q Bill 회차 결제 확정 단일 착지점.
//   수동 mark-paid(routes/invoices.js) + Stripe 카드결제 webhook(routes/stripeWorkspaceWebhook.js) 공용.
//   구독측 billing.markPaymentPaid 와 대칭 — 멱등(재전송/재클릭 안전) + 부작용 일괄.
//   분리: SAAS_BILLING_VS_QBILL_SEPARATION.md (invoices/installments = Business 수취, payments 무관).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Invoice, InvoiceInstallment, InvoiceStatusHistory, InvoicePayment, Message } = require('../models');
const { logBillEvent } = require('./billEvents');

// 결제수단 → InvoicePayment.method ENUM(portone|bank_transfer|cash|other) 매핑.
//   stripe 는 ENUM 에 없어 other + pg_provider='stripe' 로 기록(portone 전환 대비 최소 변경).
//   QBILL_PAYMENT_LEDGER_FIX R5/method 매핑.
function toPaymentFields(method, pgTransactionId) {
  if (method === 'stripe') {
    return { method: 'other', pg_provider: 'stripe', pg_channel: 'stripe', pg_transaction_id: pgTransactionId || null };
  }
  return { method: 'bank_transfer', pg_provider: null, pg_channel: null, pg_transaction_id: pgTransactionId || null };
}

// 사이클 N+21 — Invoice 상태 전이 history 박제. (routes/invoices.js 에서 이관 — 라우트는 여기서 import)
async function recordInvoiceStatusChange(invoice, fromStatus, toStatus, userId, note = null) {
  if (!toStatus || fromStatus === toStatus) return;
  try {
    await InvoiceStatusHistory.create({
      invoice_id: invoice.id,
      business_id: invoice.business_id,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: userId,
      note,
    });
  } catch (e) { console.warn('[InvoiceStatusHistory create]', e.message); }
}

// 채팅 결제 카드 메타 동기 (best-effort). (routes/invoices.js 에서 이관)
//
// ★ sequelize.fn('JSON_EXTRACT', col, '$.card_type') 는 쓰면 안 된다 —
//   Sequelize 가 '$' 를 bind 파라미터 접두사로 보고 '$$' 로 이스케이프해서
//   `JSON_EXTRACT(meta, '$$.card_type')` 이 나가고 MySQL 이 "Invalid JSON path" 로 항상 실패한다.
//   그래서 이 함수는 여태 한 번도 성공한 적이 없고(catch 가 삼킴), 결제/상태가 바뀌어도
//   채팅방의 청구서 카드는 옛 상태 그대로 남아 있었다 (고객이 보는 화면).
//   literal 로 경로를 직접 쓴다. id 는 위에서 정수 검증됨.
async function updateInvoiceChatCards(invoiceId, patches, transaction = null) {
  try {
    const id = parseInt(invoiceId, 10);
    if (!Number.isInteger(id) || id <= 0) return 0;
    const messages = await Message.findAll({
      where: {
        kind: 'card',
        [Op.and]: [
          sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.card_type')) = 'invoice'"),
          sequelize.literal(`JSON_EXTRACT(\`meta\`, '$.invoice_id') = ${id}`),
        ],
      },
      transaction,
    });
    for (const m of messages) {
      const meta = { ...(m.meta || {}), ...patches };
      await m.update({ meta }, { transaction });
    }
    return messages.length;
  } catch (err) {
    console.error('[updateInvoiceChatCards]', err.message);
    return 0;
  }
}

// 카드 결제 확정 시 발행자(owner/admin/청구담당) 알림 — 고객 주도 결제라 owner 가 즉시 알아야 함.
//   수동 mark-paid(owner 본인 액션)는 호출 안 함. notifyOwnerPaymentNotified(bank notified) 와 대칭.
//   서버 생성 알림 문구는 기존 관례대로 한국어(Notification row 텍스트 — 프론트 t() 대상 아님).
async function notifyOwnerCardPaid({ invoice, label, amount, io }) {
  try {
    const { Op } = require('sequelize');
    const { BusinessMember, Business } = require('../models');
    const { notifyMany } = require('../routes/notifications');
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name', 'default_billing_owner_id'] });
    const members = await BusinessMember.findAll({
      where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
      attributes: ['user_id'],
    });
    const ids = new Set(members.map((m) => m.user_id));
    if (invoice.owner_user_id) ids.add(invoice.owner_user_id);
    if (biz?.default_billing_owner_id) ids.add(biz.default_billing_owner_id);
    if (ids.size === 0) return;
    const amtStr = `${Number(amount || 0).toLocaleString()}${invoice.currency || 'KRW'}`;
    await notifyMany({
      userIds: [...ids],
      businessId: invoice.business_id, eventKind: 'payment',
      title: '카드 결제 완료',
      body: `${invoice.invoice_number}${label ? ` ${label}` : ''} — 고객이 카드로 ${amtStr} 결제했습니다.`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
      ctaLabel: '청구서 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
      entityType: 'invoice', entityId: invoice.id, ioApp: io,
    });
  } catch (e) { console.warn('[card-paid owner notify]', e.message); }
}

/**
 * 회차(installment) 결제 확정 — 단일 착지점.
 *   멱등: 이미 paid 면 { alreadyPaid:true } 반환 (webhook 재전송·중복 클릭 안전).
 *   커밋 후 부작용(status history, 채팅 카드, socket, stage engine, overdue, bill event) 일괄.
 *   audit / owner 알림은 호출자 맥락(요청 vs 시스템)이 달라 호출자가 수행.
 * @param {number} businessId  멀티테넌트 격리 — invoice.business_id 강제 대조
 * @param {number} markedByUserId  수동=요청자 / 카드결제(webhook)=null(system)
 * @param {'bank_transfer'|'stripe'} method
 * @param {string|null} pgTransactionId  Stripe PaymentIntent id (installment 에 기록)
 * @param {object|null} io  socket.io 인스턴스 (business room broadcast)
 */
async function markInstallmentPaid({ businessId, invoiceId, installmentId, paidAt, payerMemo, markedByUserId = null, method = 'bank_transfer', pgTransactionId = null, io = null }) {
  const t = await sequelize.transaction();
  let invoice, inst, prevStatus, newStatus, paidSum, totalSum;
  try {
    invoice = await Invoice.findOne({ where: { id: invoiceId, business_id: businessId }, transaction: t });
    if (!invoice) { await t.rollback(); const e = new Error('invoice_not_found'); e.code = 'NOT_FOUND'; throw e; }
    // ★ FOR UPDATE 락 — Stripe 는 checkout.session.completed + payment_intent.succeeded 를 거의 동시에
    //   보낸다. 락 없이 findOne 하면 두 트랜잭션이 모두 status='pending' 스냅샷으로 아래 멱등 가드를
    //   통과 → payment 2행 = 매출 이중계상. 락 후 status 재검사로 직렬화한다. (R2)
    inst = await InvoiceInstallment.findOne({ where: { id: installmentId, invoice_id: invoice.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!inst) { await t.rollback(); const e = new Error('installment_not_found'); e.code = 'NOT_FOUND'; throw e; }
    if (inst.status === 'canceled') { await t.rollback(); const e = new Error('installment_canceled'); e.code = 'INVALID_STATE'; throw e; }
    if (inst.status === 'paid') {
      // 멱등 — webhook 재전송/중복 결제 세션. 락 뒤에서 재검사하므로 동시 도착도 여기로 수렴.
      await t.rollback();
      return { alreadyPaid: true, invoice, installment: inst };
    }

    await inst.update({
      status: 'paid',
      paid_at: paidAt || new Date(),
      payer_memo: payerMemo || inst.payer_memo,
      marked_by_user_id: markedByUserId,
      marked_at: new Date(),
      ...(pgTransactionId ? { stripe_payment_intent: pgTransactionId } : {}),
    }, { transaction: t });

    // Invoice paid_amount + status 자동 갱신 (route 1578 와 동일 공식)
    const all = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, transaction: t });
    paidSum = all.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
    totalSum = all.reduce((s, i) => s + Number(i.amount), 0);
    prevStatus = invoice.status;
    newStatus = paidSum >= totalSum ? 'paid' : (paidSum > 0 ? 'partially_paid' : invoice.status);
    await invoice.update({
      paid_amount: paidSum,
      status: newStatus,
      paid_at: newStatus === 'paid' ? new Date() : invoice.paid_at,
    }, { transaction: t });

    // ★ 결제 원장 append — 같은 트랜잭션 안에서 원자화(R1). 매출 통계(stats.js)의 유일한 원천.
    //   회차 status='paid' 전환과 원장이 항상 일치(불변식). 락으로 직렬화돼 중복 생성 없음.
    await InvoicePayment.create({
      invoice_id: invoice.id,
      installment_id: inst.id,
      amount: Number(inst.amount),
      paid_at: paidAt || new Date(),
      currency: invoice.currency || 'KRW',
      recorded_by: markedByUserId,
      memo: payerMemo || null,
      ...toPaymentFields(method, pgTransactionId),
    }, { transaction: t });

    await t.commit();
  } catch (e) { try { await t.rollback(); } catch { /* */ } throw e; }

  // ── 커밋 후 부작용 (route 1578 와 동일 순서·내용) ──
  const noteLabel = method === 'stripe' ? 'stripe card payment' : 'mark-paid';
  setImmediate(() => recordInvoiceStatusChange(invoice, prevStatus, newStatus, markedByUserId, noteLabel));
  const refreshed = await Invoice.findByPk(invoice.id, {
    include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
  });
  await updateInvoiceChatCards(invoice.id, {
    status: refreshed.status,
    paid_at: refreshed.paid_at ? new Date(refreshed.paid_at).toISOString() : null,
    paid_amount: Number(refreshed.paid_amount || 0),
  });
  if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'installment_paid', invoice_id: invoice.id });
  if (refreshed?.project_id) require('./projectStageEngine').onInvoiceChanged(refreshed.id).catch(() => null);
  if (newStatus === 'paid') require('./overdue_handler').unpauseProjectIfApplicable(refreshed).catch(() => null);
  await logBillEvent('invoice', invoice.id, newStatus === 'paid' ? 'paid_full' : 'paid_partial', {
    actorUserId: markedByUserId,
    detail: { installment_no: inst.installment_no, label: inst.label, amount: inst.amount, paid_sum: paidSum, total: totalSum, method },
  });
  // 카드 결제(고객 주도)만 owner 알림 — 수동 mark-paid 는 owner 본인 액션이라 제외.
  if (method === 'stripe') await notifyOwnerCardPaid({ invoice: refreshed, label: inst.label, amount: inst.amount, io });

  return { alreadyPaid: false, invoice: refreshed, installment: inst, prevStatus, newStatus, paidSum, totalSum };
}

/**
 * 단일 발행(installment 없음) invoice 결제 확정 — invoice-level.
 *   분할은 markInstallmentPaid, 단일은 이 함수. 멱등(이미 paid 면 alreadyPaid).
 *   부작용은 PATCH /:id/status(paid) 라우트와 동일.
 */
async function markInvoicePaid({ businessId, invoiceId, paidAt, markedByUserId = null, method = 'bank_transfer', pgTransactionId = null, io = null }) {
  // ★ 트랜잭션 신설(R1) — 원래는 트랜잭션이 없어 invoice.update 와 payment.create 를 원자화할 수 없었다.
  //   FOR UPDATE 락(R2)으로 Stripe 2이벤트 동시 도착 시 payment 이중 생성 방지.
  const t = await sequelize.transaction();
  let invoice, prevStatus;
  try {
    invoice = await Invoice.findOne({ where: { id: invoiceId, business_id: businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) { await t.rollback(); const e = new Error('invoice_not_found'); e.code = 'NOT_FOUND'; throw e; }
    if (invoice.status === 'canceled' || invoice.status === 'draft') { await t.rollback(); const e = new Error('invoice_not_payable'); e.code = 'INVALID_STATE'; throw e; }
    if (invoice.status === 'paid') { await t.rollback(); return { alreadyPaid: true, invoice }; } // 멱등 (락 뒤 재검사)

    prevStatus = invoice.status;
    await invoice.update({
      status: 'paid',
      paid_at: paidAt || new Date(),
      paid_amount: invoice.grand_total,
      ...(pgTransactionId ? { stripe_payment_intent: pgTransactionId } : {}),
    }, { transaction: t });

    // ★ 결제 원장 append — 단일 invoice 결제(installment_id=NULL). amount=grand_total.
    await InvoicePayment.create({
      invoice_id: invoice.id,
      installment_id: null,
      amount: Number(invoice.grand_total),
      paid_at: paidAt || new Date(),
      currency: invoice.currency || 'KRW',
      recorded_by: markedByUserId,
      ...toPaymentFields(method, pgTransactionId),
    }, { transaction: t });

    await t.commit();
  } catch (e) { try { await t.rollback(); } catch { /* */ } throw e; }

  const noteLabel = method === 'stripe' ? 'stripe card payment' : 'mark-paid';
  setImmediate(() => recordInvoiceStatusChange(invoice, prevStatus, 'paid', markedByUserId, noteLabel));
  await updateInvoiceChatCards(invoice.id, {
    status: invoice.status,
    paid_at: invoice.paid_at ? new Date(invoice.paid_at).toISOString() : null,
    paid_amount: Number(invoice.paid_amount || 0),
  });
  if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'invoice_status', invoice_id: invoice.id, status: 'paid' });
  if (invoice.project_id) require('./projectStageEngine').onInvoiceChanged(invoice.id).catch(() => null);
  require('./overdue_handler').unpauseProjectIfApplicable(invoice).catch(() => null);
  await logBillEvent('invoice', invoice.id, 'paid_full', { actorUserId: markedByUserId, detail: { amount: invoice.grand_total, from: prevStatus, method } });
  if (method === 'stripe') await notifyOwnerCardPaid({ invoice, label: null, amount: invoice.grand_total, io });

  return { alreadyPaid: false, invoice, prevStatus };
}

module.exports = { markInstallmentPaid, markInvoicePaid, recordInvoiceStatusChange, updateInvoiceChatCards };
