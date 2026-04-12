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

    const { name, phone, avatar_url, language, bio, expertise, organization, job_title } = req.body;
    const updates = { name, phone, avatar_url };
    if (language !== undefined) {
      if (typeof language !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
        return errorResponse(res, 'Invalid language code', 400);
      }
      updates.language = language;
    }
    // Q Note 답변 생성용 프로필 필드 (모두 선택)
    if (bio !== undefined) {
      if (bio !== null && typeof bio !== 'string') return errorResponse(res, 'Invalid bio', 400);
      if (bio && bio.length > 2000) return errorResponse(res, 'bio too long (max 2000)', 400);
      updates.bio = bio || null;
    }
    if (expertise !== undefined) {
      if (expertise !== null && typeof expertise !== 'string') return errorResponse(res, 'Invalid expertise', 400);
      if (expertise && expertise.length > 500) return errorResponse(res, 'expertise too long (max 500)', 400);
      updates.expertise = expertise || null;
    }
    if (organization !== undefined) {
      if (organization !== null && typeof organization !== 'string') return errorResponse(res, 'Invalid organization', 400);
      if (organization && organization.length > 200) return errorResponse(res, 'organization too long (max 200)', 400);
      updates.organization = organization || null;
    }
    if (job_title !== undefined) {
      if (job_title !== null && typeof job_title !== 'string') return errorResponse(res, 'Invalid job_title', 400);
      if (job_title && job_title.length > 100) return errorResponse(res, 'job_title too long (max 100)', 400);
      updates.job_title = job_title || null;
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
