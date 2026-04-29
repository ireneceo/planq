// 사이클 P6 — 사용자 → 운영팀 피드백 라우트
//   POST   /api/feedback              (자기 제출)
//   GET    /api/feedback/mine         (내 제출 이력)
//   GET    /api/feedback/admin        (platform_admin 전체 — 상태/카테고리 필터)
//   PATCH  /api/feedback/:id/respond  (platform_admin — 상태 변경 + 답변)
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FeedbackItem, User } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const ALLOWED_CATS = ['bug', 'improve', 'feature', 'other'];
const ALLOWED_STATUS = ['pending', 'reviewing', 'done', 'wontfix'];
const ALLOWED_PRIORITY = ['normal', 'high'];

// POST — 사용자 제출 (자동 메타 page_url, user_agent 수집)
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { category, priority, title, body, page_url, attachments } = req.body || {};
    if (!title || !String(title).trim()) return errorResponse(res, 'title_required', 400);
    if (!body || !String(body).trim()) return errorResponse(res, 'body_required', 400);

    const finalCategory = ALLOWED_CATS.includes(category) ? category : 'other';
    const finalPriority = ALLOWED_PRIORITY.includes(priority) ? priority : 'normal';
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const item = await FeedbackItem.create({
      user_id: req.user.id,
      business_id: req.user.business_id || null,
      category: finalCategory,
      priority: finalPriority,
      title: String(title).slice(0, 200),
      body: String(body),
      attachments: Array.isArray(attachments) ? attachments.slice(0, 5) : null,
      page_url: page_url ? String(page_url).slice(0, 500) : null,
      user_agent: ua,
      status: 'pending',
    });
    return successResponse(res, item, 'Submitted', 201);
  } catch (err) { next(err); }
});

// GET /mine — 내 제출 이력 (자기 추적)
router.get('/mine', authenticateToken, async (req, res, next) => {
  try {
    const items = await FeedbackItem.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    return successResponse(res, items);
  } catch (err) { next(err); }
});

// GET /admin — platform_admin 전체 (상태/카테고리 필터)
router.get('/admin', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status && ALLOWED_STATUS.includes(req.query.status)) where.status = req.query.status;
    if (req.query.category && ALLOWED_CATS.includes(req.query.category)) where.category = req.query.category;
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 80);
      where[Op.or] = [
        { title: { [Op.like]: `%${q}%` } },
        { body: { [Op.like]: `%${q}%` } },
      ];
    }
    const items = await FeedbackItem.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'responder', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    return successResponse(res, items);
  } catch (err) { next(err); }
});

// GET /admin/counts — 상태별 카운트 (탭 뱃지용)
router.get('/admin/counts', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const counts = {};
    for (const status of ALLOWED_STATUS) {
      counts[status] = await FeedbackItem.count({ where: { status } });
    }
    counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
    return successResponse(res, counts);
  } catch (err) { next(err); }
});

// PATCH /:id/respond — 상태 변경 + 답변 작성
router.patch('/:id/respond', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { status, admin_response } = req.body || {};
    const item = await FeedbackItem.findByPk(req.params.id);
    if (!item) return errorResponse(res, 'not_found', 404);

    const updates = {};
    if (status && ALLOWED_STATUS.includes(status)) updates.status = status;
    if (typeof admin_response === 'string') updates.admin_response = admin_response.slice(0, 5000);
    if (Object.keys(updates).length > 0) {
      updates.responded_by = req.user.id;
      updates.responded_at = new Date();
    }
    await item.update(updates);
    return successResponse(res, item, 'Updated');
  } catch (err) { next(err); }
});

module.exports = router;
