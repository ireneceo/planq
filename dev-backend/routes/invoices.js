const express = require('express');
const router = express.Router();
const { Invoice, InvoiceItem, InvoiceInstallment, Client, User, Business, Post, Conversation, Message } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { sequelize } = require('../config/database');

// Generate invoice number
const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const last = await Invoice.findOne({
    where: sequelize.where(
      sequelize.fn('YEAR', sequelize.col('created_at')),
      year
    ),
    order: [['id', 'DESC']]
  });

  const seq = last ? parseInt(last.invoice_number.split('-')[2]) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
};

// List invoices
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId };
    if (req.query.status) where.status = req.query.status;

    const invoices = await Invoice.findAll({
      where,
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'is_business'] },
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token'], required: false },
      ],
      order: [['created_at', 'DESC']]
    });
    successResponse(res, invoices);
  } catch (error) {
    next(error);
  }
});

// Create invoice (Invoice + Items 를 단일 transaction 으로 원자화)
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      title, client_id, due_date, recipient_email, recipient_business_name, recipient_business_number,
      notes, items, vat_rate, installment_mode, installments,
      source_post_id, project_id, currency,
    } = req.body;
    if (!title) { await t.rollback(); return errorResponse(res, 'Title required', 400); }

    // 출처 post 검증 — 같은 business 의 published 게시물만 허용 (category 는 자유 분류라 검증 X)
    let sourcePostId = null;
    if (source_post_id) {
      const sp = await Post.findOne({
        where: { id: Number(source_post_id), business_id: req.params.businessId },
        transaction: t,
      });
      if (!sp) { await t.rollback(); return errorResponse(res, 'invalid source_post_id', 400); }
      if (sp.status !== 'published') {
        await t.rollback();
        return errorResponse(res, 'source post must be published', 400);
      }
      sourcePostId = sp.id;
    }

    // 분할 모드 검증
    const mode = installment_mode === 'split' ? 'split' : 'single';
    if (mode === 'split') {
      if (!Array.isArray(installments) || installments.length === 0) {
        await t.rollback(); return errorResponse(res, 'installments required for split mode', 400);
      }
      const sum = installments.reduce((s, x) => s + Number(x.percent || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        await t.rollback(); return errorResponse(res, `installment percent sum must be 100 (got ${sum})`, 400);
      }
      for (const inst of installments) {
        if (!inst.label || !Number.isFinite(Number(inst.percent))) {
          await t.rollback(); return errorResponse(res, 'each installment requires label and percent', 400);
        }
      }
      if (installments.length > 12) {
        await t.rollback(); return errorResponse(res, 'too many installments (max 12)', 400);
      }
    }

    // 발행 시점 워크스페이스 계좌 정보 스냅샷
    const business = await Business.findByPk(req.params.businessId, { transaction: t });
    const bank_snapshot = business
      ? { bank_name: business.bank_name || null, account_number: business.bank_account_number || null, account_holder: business.bank_account_name || business.name || null }
      : null;

    const invoice_number = await generateInvoiceNumber();
    const vatRateNum = vat_rate !== undefined ? Number(vat_rate) : 0.1;

    const invoice = await Invoice.create({
      business_id: req.params.businessId,
      client_id: client_id || null,
      invoice_number,
      title,
      due_date: due_date || null,
      recipient_email: recipient_email || null,
      recipient_business_name: recipient_business_name || null,
      recipient_business_number: recipient_business_number || null,
      notes: notes || null,
      created_by: req.user.id,
      installment_mode: mode,
      bank_snapshot,
      vat_rate: vatRateNum,
      source_post_id: sourcePostId,
      project_id: project_id || null,
      currency: currency || 'KRW',
    }, { transaction: t });

    let grandTotal = 0;
    if (items && items.length > 0) {
      let subtotal = 0;
      const itemRows = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const amount = Number(item.quantity || 1) * Number(item.unit_price || 0);
        subtotal += amount;
        itemRows.push({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          amount,
          sort_order: i,
        });
      }
      await InvoiceItem.bulkCreate(itemRows, { transaction: t });
      const taxAmount = Math.round(subtotal * vatRateNum);
      grandTotal = subtotal + taxAmount;
      await invoice.update({
        total_amount: subtotal,
        subtotal,
        tax_amount: taxAmount,
        grand_total: grandTotal,
      }, { transaction: t });
    }

    // 분할 일정 생성 — amount = grand_total * percent / 100 (정수 반올림, 마지막 row 가 잔여 흡수)
    if (mode === 'split') {
      const insts = installments.map((inst, idx) => ({
        invoice_id: invoice.id,
        installment_no: idx + 1,
        label: String(inst.label).slice(0, 40),
        percent: Number(inst.percent),
        amount: 0,  // 아래서 재계산
        due_date: inst.due_date || null,
        milestone_ref: inst.milestone_ref ? String(inst.milestone_ref).slice(0, 100) : null,
        status: 'pending',
      }));
      // 분배: 마지막 row 가 (grand_total - sum(이전)) 으로 잔여 흡수
      let allocated = 0;
      for (let i = 0; i < insts.length; i++) {
        if (i < insts.length - 1) {
          const a = Math.round(grandTotal * (insts[i].percent / 100));
          insts[i].amount = a;
          allocated += a;
        } else {
          insts[i].amount = grandTotal - allocated;
        }
      }
      await InvoiceInstallment.bulkCreate(insts, { transaction: t });
    }

    await t.commit();

    const result = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token', 'project_id'], required: false },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'is_business', 'country', 'tax_invoice_email', 'billing_contact_email', 'invite_email'] },
      ],
    });
    successResponse(res, result, 'Invoice created', 201);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── 출처 후보: 청구서 발행 모달용 (발행된 post 목록) ───
// GET /:businessId/source-candidates?category=&client_id=
// /:id 라우트보다 위에 정의해야 매칭됨 (Express 등록 순서)
router.get('/:businessId/source-candidates', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId, status: 'published' };
    if (req.query.category) where.category = req.query.category;
    const posts = await Post.findAll({
      where,
      attributes: ['id', 'category', 'title', 'status', 'project_id', 'created_at', 'shared_at'],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    successResponse(res, posts);
  } catch (error) { next(error); }
});

// ─── 채팅방 자동 검색 ───
// GET /:businessId/find-conversation?client_id=X&project_id=Y
router.get('/:businessId/find-conversation', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const clientId = req.query.client_id ? Number(req.query.client_id) : null;
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    if (!clientId) return errorResponse(res, 'client_id required', 400);
    const where = { business_id: req.params.businessId, client_id: clientId };
    let conv = null;
    if (projectId) {
      conv = await Conversation.findOne({
        where: { ...where, project_id: projectId },
        attributes: ['id', 'title', 'project_id', 'last_message_at'],
        order: [['last_message_at', 'DESC']],
      });
    }
    if (!conv) {
      conv = await Conversation.findOne({
        where,
        attributes: ['id', 'title', 'project_id', 'last_message_at'],
        order: [['last_message_at', 'DESC']],
      });
    }
    successResponse(res, { conversation: conv, suggest_create: !conv });
  } catch (error) { next(error); }
});

// Get invoice detail
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: InvoiceItem, as: 'items', order: [['sort_order', 'ASC']] },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'biz_address_en', 'biz_type', 'biz_item', 'is_business', 'country', 'tax_invoice_email', 'billing_contact_email', 'invite_email'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token', 'project_id', 'shared_at'], required: false },
      ]
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    successResponse(res, invoice);
  } catch (error) {
    next(error);
  }
});

// ─── Invoice 발송 (draft → sent) ───
// 발송 시 invoice + installments status='sent' 동시
// body: { send_chat?: boolean, send_email?: boolean, message?: string }
//  - send_chat: 해당 client/project 의 기존 conversation 자동 검색 → 결제 요청 카드 메시지 (없으면 무시)
//  - send_email: 공개 링크 + 메모로 이메일 발송 (recipient_email 또는 client.email)
//  - 새 채팅방 자동 생성 금지
router.post('/:businessId/:id/send', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { send_chat = false, send_email = false, message = '' } = req.body || {};

    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    if (invoice.status !== 'draft') { await t.rollback(); return errorResponse(res, 'invalid_state — only draft can be sent', 400); }
    const crypto = require('crypto');
    const updates = { status: 'sent', issued_at: new Date(), sent_at: new Date() };
    if (!invoice.share_token) updates.share_token = crypto.randomBytes(32).toString('hex');
    await invoice.update(updates, { transaction: t });
    if (invoice.installment_mode === 'split') {
      await InvoiceInstallment.update(
        { status: 'sent' },
        { where: { invoice_id: invoice.id, status: 'pending' }, transaction: t }
      );
    }
    await t.commit();

    // 발송 채널 처리 (post-commit)
    const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
    const shareUrl = `${APP_URL}/public/invoices/${invoice.share_token}`;
    const deliver = { chat: null, email: null };

    // ① 채팅방 카드 메시지 (자동 검색 — 새 방 생성 X)
    if (send_chat && invoice.client_id) {
      try {
        // project_id 우선, 없으면 client_id 단독
        const where = { business_id: req.params.businessId, client_id: invoice.client_id };
        let conv = null;
        if (invoice.project_id) {
          conv = await Conversation.findOne({ where: { ...where, project_id: invoice.project_id }, order: [['last_message_at', 'DESC']] });
        }
        if (!conv) conv = await Conversation.findOne({ where, order: [['last_message_at', 'DESC']] });

        if (conv) {
          const userMessage = String(message || '').slice(0, 1000);
          const fallback = userMessage
            ? `[청구서] ${invoice.invoice_number} · ${invoice.title} — ${userMessage}`
            : `[청구서] ${invoice.invoice_number} · ${invoice.title}`;
          const msg = await Message.create({
            conversation_id: conv.id,
            sender_id: req.user.id,
            content: fallback,
            kind: 'card',
            meta: {
              card_type: 'invoice',
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              share_token: invoice.share_token,
              share_url: shareUrl,
              title: invoice.title,
              total: Number(invoice.grand_total || 0),
              currency: invoice.currency,
              note: userMessage || null,
            },
          });
          await conv.update({ last_message_at: new Date() });
          deliver.chat = { conversation_id: conv.id, message_id: msg.id };
        } else {
          deliver.chat = { error: 'no_conversation_for_client' };
        }
      } catch (err) {
        deliver.chat = { error: err.message };
      }
    }

    // ② 이메일 발송 (우선순위: recipient_email → tax_invoice_email → billing_contact_email → invite_email)
    if (send_email) {
      try {
        const { sendInvoiceEmail } = require('../services/emailService');
        let recipient = invoice.recipient_email;
        if (!recipient && invoice.client_id) {
          const cl = await Client.findByPk(invoice.client_id, { attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'] });
          recipient = cl?.tax_invoice_email || cl?.billing_contact_email || cl?.invite_email || null;
        }
        if (!recipient) {
          deliver.email = { error: 'no_recipient_email' };
        } else {
          const business = await Business.findByPk(req.params.businessId, { attributes: ['name'] });
          const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
          const ok = await sendInvoiceEmail({
            to: recipient,
            invoiceNumber: invoice.invoice_number,
            title: invoice.title,
            total: Number(invoice.grand_total || 0),
            currency: invoice.currency,
            dueDate: invoice.due_date,
            senderName: sender?.name || '',
            workspaceName: business?.name || '',
            message: String(message || '').slice(0, 1000) || null,
            shareUrl,
          });
          deliver.email = { to: recipient, sent: ok };
        }
      } catch (err) {
        deliver.email = { error: err.message };
      }
    }

    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status'], required: false },
      ],
    });
    successResponse(res, { invoice: refreshed, deliver }, 'Invoice sent');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// (이동됨: source-candidates / find-conversation 은 라우트 매칭 순서를 위해 위(GET /:businessId 다음)로 이동)

// ─── Installment: 결제 완료 마킹 ───
router.post('/:businessId/:id/installments/:installId/mark-paid', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }, transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id }, transaction: t,
    });
    if (!inst) { await t.rollback(); return errorResponse(res, 'Installment not found', 404); }
    if (inst.status === 'paid' || inst.status === 'canceled') {
      await t.rollback(); return errorResponse(res, 'invalid_state', 400);
    }
    const paidAt = req.body?.paid_at ? new Date(req.body.paid_at) : new Date();
    const memo = req.body?.payer_memo ? String(req.body.payer_memo).slice(0, 200) : null;
    await inst.update({
      status: 'paid', paid_at: paidAt, payer_memo: memo,
      marked_by_user_id: req.user.id, marked_at: new Date(),
    }, { transaction: t });

    // Invoice paid_amount + status 자동 갱신
    const all = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, transaction: t });
    const paidSum = all.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
    const totalSum = all.reduce((s, i) => s + Number(i.amount), 0);
    const newStatus = paidSum >= totalSum ? 'paid' : (paidSum > 0 ? 'partially_paid' : invoice.status);
    await invoice.update({
      paid_amount: paidSum,
      status: newStatus,
      paid_at: newStatus === 'paid' ? new Date() : invoice.paid_at,
    }, { transaction: t });

    await t.commit();
    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
    });
    successResponse(res, refreshed, 'Installment paid');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// ─── Installment: 결제 완료 마킹 취소 ───
router.post('/:businessId/:id/installments/:installId/unmark-paid', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }, transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id }, transaction: t,
    });
    if (!inst || inst.status !== 'paid') { await t.rollback(); return errorResponse(res, 'not_paid', 400); }
    await inst.update({ status: 'sent', paid_at: null, marked_by_user_id: null, marked_at: null, payer_memo: null }, { transaction: t });
    const all = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, transaction: t });
    const paidSum = all.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
    const totalSum = all.reduce((s, i) => s + Number(i.amount), 0);
    const newStatus = paidSum >= totalSum ? 'paid' : (paidSum > 0 ? 'partially_paid' : 'sent');
    await invoice.update({ paid_amount: paidSum, status: newStatus, paid_at: newStatus === 'paid' ? invoice.paid_at : null }, { transaction: t });
    await t.commit();
    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
    });
    successResponse(res, refreshed, 'Installment payment unmarked');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// ─── Installment: 세금계산서 발행 마킹 ───
router.post('/:businessId/:id/installments/:installId/mark-tax-invoice', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id },
    });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
    const no = req.body?.tax_invoice_no ? String(req.body.tax_invoice_no).slice(0, 50) : null;
    const at = req.body?.tax_invoice_at ? new Date(req.body.tax_invoice_at) : new Date();
    if (!no) return errorResponse(res, 'tax_invoice_no required', 400);
    await inst.update({ tax_invoice_no: no, tax_invoice_at: at, tax_invoice_marked_by: req.user.id });
    successResponse(res, inst, 'Tax invoice marked');
  } catch (error) { next(error); }
});

// ─── Installment: 취소 ───
router.delete('/:businessId/:id/installments/:installId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id },
    });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
    if (inst.status === 'paid') return errorResponse(res, 'cannot_cancel_paid', 400);
    await inst.update({ status: 'canceled' });
    successResponse(res, inst, 'Installment canceled');
  } catch (error) { next(error); }
});

// Update invoice status
router.patch('/:businessId/:id/status', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 인보이스 상태 변경(특히 'paid')은 owner 또는 platform_admin 만
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);

    const { status } = req.body;
    const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'canceled'];
    if (!validStatuses.includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const updates = { status };
    if (status === 'sent' && !invoice.sent_at) {
      updates.sent_at = new Date();
      updates.issued_at = new Date();
    }
    if (status === 'paid') updates.paid_at = new Date();

    await invoice.update(updates);
    successResponse(res, invoice);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
