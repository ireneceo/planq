const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// 응답에서 절대 노출 금지인 민감 필드
// password_hash · refresh_token · reset_token · reset_token_expires
const USER_SENSITIVE_FIELDS = [
  'password_hash', 'refresh_token', 'reset_token', 'reset_token_expires',
];

// List users (platform admin)
router.get('/', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: USER_SENSITIVE_FIELDS },
      order: [['created_at', 'DESC']]
    });
    successResponse(res, users);
  } catch (error) {
    next(error);
  }
});

// Get user by ID — 본인 또는 platform_admin 만. IDOR 차단.
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetId)) return errorResponse(res, 'invalid_id', 400);
    const isSelf = targetId === req.user.id;
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    if (!isSelf && !isPlatformAdmin) return errorResponse(res, 'forbidden', 403);
    const user = await User.findByPk(targetId, {
      attributes: { exclude: USER_SENSITIVE_FIELDS }
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

    const {
      name, phone, avatar_url, language,
      bio, expertise, organization, job_title,
      language_levels, expertise_level,
      answer_style_default, answer_length_default,
      timezone, reference_timezones,
    } = req.body;
    const updates = { name, phone, avatar_url };
    // 타임존 (IANA id — 자유형식 문자열로 저장, 포맷 검증만)
    if (timezone !== undefined) {
      if (timezone !== null && (typeof timezone !== 'string' || !/^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/.test(timezone))) {
        return errorResponse(res, 'Invalid timezone', 400);
      }
      updates.timezone = timezone || null;
    }
    if (reference_timezones !== undefined) {
      if (reference_timezones !== null && !Array.isArray(reference_timezones)) {
        return errorResponse(res, 'Invalid reference_timezones', 400);
      }
      const cleaned = (reference_timezones || [])
        .filter((t) => typeof t === 'string' && /^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/.test(t))
        .slice(0, 20);
      updates.reference_timezones = cleaned.length ? cleaned : null;
    }
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
    // 언어 레벨: { ko: { reading, speaking, listening, writing }, en: ... }
    if (language_levels !== undefined) {
      if (language_levels !== null && (typeof language_levels !== 'object' || Array.isArray(language_levels))) {
        return errorResponse(res, 'Invalid language_levels', 400);
      }
      const SKILLS = ['reading', 'speaking', 'listening', 'writing'];
      const cleaned = {};
      if (language_levels) {
        for (const [lang, block] of Object.entries(language_levels)) {
          if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) continue;
          if (!block || typeof block !== 'object') continue;
          const out = {};
          for (const s of SKILLS) {
            const v = block[s];
            if (v == null) continue;
            const n = parseInt(v, 10);
            if (Number.isInteger(n) && n >= 1 && n <= 6) out[s] = n;
          }
          if (Object.keys(out).length) cleaned[lang] = out;
        }
      }
      updates.language_levels = Object.keys(cleaned).length ? cleaned : null;
    }
    if (expertise_level !== undefined) {
      if (expertise_level !== null && !['layman', 'practitioner', 'expert'].includes(expertise_level)) {
        return errorResponse(res, 'Invalid expertise_level', 400);
      }
      updates.expertise_level = expertise_level || null;
    }
    if (answer_style_default !== undefined) {
      if (answer_style_default !== null && typeof answer_style_default !== 'string') {
        return errorResponse(res, 'Invalid answer_style_default', 400);
      }
      if (answer_style_default && answer_style_default.length > 2000) {
        return errorResponse(res, 'answer_style_default too long (max 2000)', 400);
      }
      updates.answer_style_default = answer_style_default || null;
    }
    if (answer_length_default !== undefined) {
      if (answer_length_default !== null && !['short', 'medium', 'long'].includes(answer_length_default)) {
        return errorResponse(res, 'Invalid answer_length_default', 400);
      }
      updates.answer_length_default = answer_length_default || null;
    }
    await user.update(updates);

    const updated = await User.findByPk(req.params.id, {
      attributes: { exclude: USER_SENSITIVE_FIELDS }
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
