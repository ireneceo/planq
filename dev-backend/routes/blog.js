// KNOWLEDGE_LOOP 축3 — 랜딩 블로그 public API (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   별도 CMS 없음: Q위키(help_articles)가 소스. blog_published_at 있는 public+published 글만 노출.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const HelpArticle = require('../models/HelpArticle');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const BLOG_WHERE = {
  blog_published_at: { [Op.ne]: null },
  is_published: true,
  visibility: 'public',
};

function serializeCard(a) {
  return {
    slug: a.slug,
    title_ko: a.title_ko,
    title_en: a.title_en,
    summary_ko: a.summary_ko,
    summary_en: a.summary_en,
    blog_category: a.blog_category,
    published_at: a.blog_published_at,
    est_minutes: a.est_minutes,
  };
}

// GET /api/blog/posts?category=
router.get('/posts', async (req, res, next) => {
  try {
    const where = { ...BLOG_WHERE };
    if (req.query.category && req.query.category !== 'all') where.blog_category = String(req.query.category).slice(0, 40);
    const rows = await HelpArticle.findAll({
      where,
      order: [['blog_published_at', 'DESC']],
      limit: 100,
    });
    return successResponse(res, rows.map(serializeCard));
  } catch (err) { next(err); }
});

// GET /api/blog/posts/:slug — 상세 (본문 블록 포함)
router.get('/posts/:slug', async (req, res, next) => {
  try {
    const a = await HelpArticle.findOne({ where: { ...BLOG_WHERE, slug: String(req.params.slug || '') } });
    if (!a) return errorResponse(res, 'not_found', 404);
    return successResponse(res, {
      ...serializeCard(a),
      body_ko: a.body_ko,
      body_en: a.body_en,
    });
  } catch (err) { next(err); }
});

module.exports = router;
