const express = require('express');
const router = express.Router();
const { Invoice, InvoiceItem, InvoiceInstallment, Client, User, Business } = require('../models');
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
        { model: Client, attributes: ['id', 'display_name', 'company_name'] },
        { model: InvoiceItem, as: 'items' }
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
    } = req.body;
    if (!title) { await t.rollback(); return errorResponse(res, 'Title required', 400); }

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
      ],
    });
    successResponse(res, result, 'Invoice created', 201);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// Get invoice detail
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: InvoiceItem, as: 'items', order: [['sort_order', 'ASC']] },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'company_name'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] }
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
router.post('/:businessId/:id/send', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    if (invoice.status !== 'draft') { await t.rollback(); return errorResponse(res, 'invalid_state — only draft can be sent', 400); }
    const crypto = require('crypto');
    const updates = { status: 'sent', issued_at: new Date() };
    if (!invoice.share_token) updates.share_token = crypto.randomBytes(32).toString('hex');
    await invoice.update(updates, { transaction: t });
    if (invoice.installment_mode === 'split') {
      await InvoiceInstallment.update(
        { status: 'sent' },
        { where: { invoice_id: invoice.id, status: 'pending' }, transaction: t }
      );
    }
    await t.commit();
    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
    });
    successResponse(res, refreshed, 'Invoice sent');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

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
