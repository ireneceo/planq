const express = require('express');
const router = express.Router();
const { Business, BusinessMember, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

// List businesses for current user
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.platform_role === 'platform_admin') {
      const businesses = await Business.findAll({
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
        order: [['created_at', 'DESC']]
      });
      return successResponse(res, businesses);
    }

    const memberships = await BusinessMember.findAll({
      where: { user_id: req.user.id },
      include: [{
        model: Business,
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }]
      }]
    });
    const businesses = memberships.map(m => m.Business);
    successResponse(res, businesses);
  } catch (error) {
    next(error);
  }
});

// Create business
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return errorResponse(res, 'Name and slug required', 400);
    }

    const existing = await Business.findOne({ where: { slug } });
    if (existing) return errorResponse(res, 'Slug already taken', 409);

    const business = await Business.create({
      name, slug, owner_id: req.user.id
    });

    await BusinessMember.create({
      business_id: business.id,
      user_id: req.user.id,
      role: 'owner',
      joined_at: new Date()
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'create',
      targetType: 'business',
      targetId: business.id
    });

    successResponse(res, business, 'Business created', 201);
  } catch (error) {
    next(error);
  }
});

// Get business detail
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: BusinessMember, as: 'members', include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }] }
      ]
    });
    if (!business) return errorResponse(res, 'Business not found', 404);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// Update business
router.put('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Business not found', 404);

    const { name, logo_url } = req.body;
    await business.update({ name, logo_url });
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
