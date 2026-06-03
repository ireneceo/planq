// 고객 정기 구독청구 엔진 (사이클 N+83) — ClientSubscription 이 next_billing_at 도달 시 Invoice 자동 생성.
//   recurring_invoice(billOneProject) 패턴 재사용: Invoice+Item, share_token 공개결제, VAT, 이메일/PDF, auto/draft.
//   멱등: 발행 후 next_billing_at 을 interval 만큼 전진 → 같은 날 재실행/과거 누적분도 1회만 발행하고 미래로 resync.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ClientSubscription, Client, Business, Invoice, InvoiceItem, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');

// invoice_number — recurring_invoice 와 동일 포맷 (INV-YYYY-NNNN)
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const last = await Invoice.findOne({
    where: sequelize.where(sequelize.fn('YEAR', sequelize.col('created_at')), year),
    order: [['id', 'DESC']],
    attributes: ['invoice_number'],
  });
  const seq = last && last.invoice_number ? parseInt(last.invoice_number.split('-')[2]) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

// DATEONLY 값(Date | string) → 'YYYY-MM-DD' 문자열 정규화
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// 날짜(YYYY-MM-DD) 를 interval 만큼 전진. 월/분기/연은 일자 유지(월말 clamp).
function advanceDate(dateInput, interval) {
  const dateStr = toDateStr(dateInput);
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (interval === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
  } else {
    const months = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12;
    const anchorDay = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(anchorDay, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

function todayStr(today = new Date()) {
  return new Date(today).toISOString().slice(0, 10);
}

// 라벨 — 발행 시점 회차 표기 (예: "월 유지보수 (2026-06)")
function periodLabel(planName, dateInput, interval) {
  const dateStr = toDateStr(dateInput) || '';
  const tag = interval === 'weekly' ? dateStr : dateStr.slice(0, 7);
  return `${planName} (${tag})`;
}

// Invoice.created_by(notNull) 용 creator 해석 — 구독 생성자 > 청구담당 > owner 멤버
async function resolveCreator(sub, business) {
  if (sub.created_by) return sub.created_by;
  if (business.default_billing_owner_id) return business.default_billing_owner_id;
  const owner = await BusinessMember.findOne({ where: { business_id: business.id, role: 'owner', removed_at: null }, attributes: ['user_id'] });
  return owner?.user_id || null;
}

// 단일 구독 1회 발행
async function billOneSubscription(sub, today = new Date()) {
  const client = await Client.findByPk(sub.client_id);
  if (!client) return { subscription_id: sub.id, skipped: 'client_not_found' };
  const business = await Business.findByPk(sub.business_id);
  if (!business) return { subscription_id: sub.id, skipped: 'business_not_found' };
  const creatorId = await resolveCreator(sub, business);
  if (!creatorId) return { subscription_id: sub.id, skipped: 'no_creator' };

  const isAuto = sub.auto_mode === 'auto';
  const fee = Number(sub.amount || 0);
  if (fee <= 0) return { subscription_id: sub.id, skipped: 'no_amount' };
  const vatRate = Number(sub.vat_rate || 0);

  const subtotal = fee;
  const taxAmount = Math.round(subtotal * (vatRate / 100));
  const grandTotal = subtotal + taxAmount;
  const invoiceNumber = await nextInvoiceNumber();
  const shareToken = crypto.randomBytes(24).toString('hex');
  const title = periodLabel(sub.plan_name, sub.next_billing_at, sub.interval);

  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + Number(sub.due_days || 14));

  const bankSnapshot = {
    bank_name: business.bank_name || null,
    account_number: business.bank_account_number || null,
    account_holder: business.bank_account_name || business.brand_name || business.name || null,
  };

  const invoice = await Invoice.create({
    business_id: sub.business_id,
    project_id: null,
    client_id: client.id,
    invoice_number: invoiceNumber,
    title,
    due_date: dueDate.toISOString().slice(0, 10),
    notes: '정기 구독 자동 청구',
    created_by: creatorId,
    owner_user_id: creatorId,
    installment_mode: 'single',
    bank_snapshot: bankSnapshot,
    vat_rate: vatRate / 100, // ClientSubscription 은 %(10), Invoice.vat_rate 는 분수(0.1)
    currency: sub.currency || business.default_currency || 'KRW',
    subtotal,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    total_amount: subtotal,
    share_token: shareToken,
    status: isAuto ? 'sent' : 'draft',
    sent_at: isAuto ? new Date() : null,
  });
  await InvoiceItem.create({
    invoice_id: invoice.id,
    description: title,
    quantity: 1,
    unit_price: fee,
    amount: fee,
    sort_order: 0,
  });

  // 발행 후 next_billing_at 전진 (과거 누적분은 미래로 resync — 1회만 발행)
  let next = advanceDate(sub.next_billing_at, sub.interval);
  const t = todayStr(today);
  let guard = 0;
  while (next <= t && guard < 120) { next = advanceDate(next, sub.interval); guard++; }
  await sub.update({ next_billing_at: next, last_invoiced_at: new Date() });

  // 이메일(auto) / 멤버 검토 알림(draft) — cron 차단 방지 위해 setImmediate
  if (isAuto) {
    setImmediate(async () => {
      try {
        const { sendInvoiceEmail } = require('./emailService');
        const recipient = client.tax_invoice_email || client.billing_contact_email || client.invite_email;
        if (!recipient) { console.warn('[clientSub email] sub', sub.id, 'no recipient'); return; }
        const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/invoice/${shareToken}`;
        let attachments = null;
        try {
          const { buildInvoicePdf } = require('./pdfBuilder');
          if (typeof buildInvoicePdf === 'function') {
            const { pdf } = await buildInvoicePdf(invoice.id);
            attachments = [{ filename: `${invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }];
          }
        } catch { /* pdf 미지원 */ }
        await sendInvoiceEmail({
          to: recipient, invoiceNumber, title, total: grandTotal, currency: invoice.currency,
          dueDate: invoice.due_date, senderName: business.brand_name || business.name || '',
          workspaceName: business.brand_name || business.name || '',
          message: '정기 구독 자동 청구 메일입니다. 결제 안내는 첨부된 청구서를 참고해주세요.',
          shareUrl, attachments,
          fromName: business.mail_from_name || business.brand_name || business.name || null,
          replyTo: business.mail_reply_to || null,
        });
      } catch (e) { console.warn('[clientSub email async] sub', sub.id, e.message); }
    });
  } else {
    setImmediate(async () => {
      try {
        const members = await BusinessMember.findAll({
          where: { business_id: sub.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
          attributes: ['user_id'],
        });
        const { notifyMany } = require('../routes/notifications');
        await notifyMany({
          userIds: members.map((m) => m.user_id), businessId: sub.business_id, eventKind: 'invoice',
          title: '정기 구독 청구서 검토 요청',
          body: `${title} 초안이 생성되었습니다. 검토 후 발송해주세요.`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?invoice=${invoice.id}`,
          ctaLabel: '검토하기', workspaceName: business.brand_name || business.name || null,
        });
      } catch (e) { console.warn('[clientSub notify async] sub', sub.id, e.message); }
    });
  }

  return { subscription_id: sub.id, invoice_id: invoice.id, mode: sub.auto_mode, next_billing_at: next };
}

// Cron 진입점 — next_billing_at 도달한 active 구독 모두 처리
async function runClientSubscriptionBilling(today = new Date()) {
  const due = await ClientSubscription.findAll({
    where: { status: 'active', next_billing_at: { [Op.lte]: todayStr(today) } },
  });
  const results = [];
  for (const sub of due) {
    try { results.push(await billOneSubscription(sub, today)); }
    catch (e) { console.warn('[clientSubscriptionBilling] sub', sub.id, e.message); results.push({ subscription_id: sub.id, error: e.message }); }
  }
  const billed = results.filter((r) => r.invoice_id).length;
  if (due.length) console.log(`[clientSubscriptionBilling] ${due.length} due, ${billed} invoiced`);
  return { due: due.length, billed, results };
}

module.exports = { runClientSubscriptionBilling, billOneSubscription, advanceDate };
