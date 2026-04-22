const express = require('express');
const router = express.Router();
const { Invoice, InvoiceItem, Client, User } = require('../models');
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

// Create invoice
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { title, client_id, due_date, recipient_email, recipient_business_name, recipient_business_number, notes, items } = req.body;
    if (!title) return errorResponse(res, 'Title required', 400);

    const invoice_number = await generateInvoiceNumber();

    const invoice = await Invoice.create({
      business_id: req.params.businessId,
      client_id: client_id || null,
      invoice_number,
      title,
      due_date,
      recipient_email,
      recipient_business_name,
      recipient_business_number,
      notes,
      created_by: req.user.id
    });

    if (items && items.length > 0) {
      let totalAmount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const amount = (item.quantity || 1) * (item.unit_price || 0);
        totalAmount += amount;
        await InvoiceItem.create({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          amount,
          sort_order: i
        });
      }
      await invoice.update({
        total_amount: totalAmount,
        grand_total: totalAmount + (invoice.tax_amount || 0)
      });
    }

    const result = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceItem, as: 'items' }]
    });
    successResponse(res, result, 'Invoice created', 201);
  } catch (error) {
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
