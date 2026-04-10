const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// List users (platform admin)
router.get('/', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']]
    });
    successResponse(res, users);
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] }
    });
    if (!user) return errorResponse(res, 'User not found', 404);
    successResponse(res, user);
  } catch (error) {
    next(error);
  }
});

// Update user
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id) && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'Insufficient permissions', 403);
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const { name, phone, avatar_url, language } = req.body;
    const updates = { name, phone, avatar_url };
    if (language !== undefined) {
      // ISO 639-1 코드 검증 (2~10자, 알파벳/하이픈만)
      if (typeof language !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
        return errorResponse(res, 'Invalid language code', 400);
      }
      updates.language = language;
    }
    await user.update(updates);

    const updated = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] }
    });
    successResponse(res, updated);
  } catch (error) {
    next(error);
  }
});

// Suspend/Activate user (platform admin)
router.patch('/:id/status', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    await user.update({ status });
    successResponse(res, { id: user.id, status });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
