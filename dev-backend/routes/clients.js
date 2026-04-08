const express = require('express');
const router = express.Router();
const { Client, User, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// List clients for a business
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const clients = await Client.findAll({
      where: { business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] }],
      order: [['created_at', 'DESC']]
    });
    successResponse(res, clients);
  } catch (error) {
    next(error);
  }
});

// Create client (invite)
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { user_id, display_name, company_name, notes } = req.body;
    if (!user_id) return errorResponse(res, 'User ID required', 400);

    const existing = await Client.findOne({
      where: { business_id: req.params.businessId, user_id }
    });
    if (existing) return errorResponse(res, 'Client already exists', 409);

    const client = await Client.create({
      business_id: req.params.businessId,
      user_id,
      display_name,
      company_name,
      notes,
      invited_by: req.user.id,
      invited_at: new Date()
    });
    successResponse(res, client, 'Client invited', 201);
  } catch (error) {
    next(error);
  }
});

// Update client
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    const { display_name, company_name, notes, status } = req.body;
    await client.update({ display_name, company_name, notes, status });
    successResponse(res, client);
  } catch (error) {
    next(error);
  }
});

// Delete (archive) client
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    await client.update({ status: 'archived' });
    successResponse(res, null, 'Client archived');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
