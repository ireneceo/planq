// KNOWLEDGE_LOOP 축3 — 랜딩 블로그 public API (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   별도 CMS 없음: Q위키(help_articles)가 소스. blog_published_at 있는 public+published 글만 노출.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const HelpArticle = require('../models/HelpArticle');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// 운영 #289 — 'updates'(제품 업데이트 내역)는 같은 help_articles 를 쓰지만 **랜딩 인사이트가 아니다**.
//   What's New 드로어(routes/whats_new.js)가 그 카테고리를 단독으로 읽는다.
//   여기서 빼지 않으면 카테고리 미지정 목록(/insights)에 업데이트 공지가 섞여 나간다.
//   ★ 2026-09-07 IA 정리 (Irene 승인) — **사용법은 도움말 한 곳에서만 본다.**
//     `how-to` 15건은 이미 help_categories 에 정확히 배치돼 `/wiki` 에서 보이고 있었다.
//     그런데 blog_category='how-to' 라 **같은 글이 `/insights` 에도** 떴다 —
//     사용자에게는 "사용가이드가 도움말 아니야?"(Irene) 로 읽힌다. 옮길 데이터는 없고,
//     인사이트에서 빼기만 하면 된다.
//   ★ 반대로 `updates`(제품 소식 8건)는 **인사이트로 들여보낸다.** 여태 What's New 드로어만
//     읽어서, 인사이트에는 칼럼 3건뿐이라 비어 보였다("내용이 빈약한데" — Irene).
//     드로어는 자기 엔드포인트(routes/whats_new.js)를 그대로 쓴다 — 두 곳에서 보이는 것이 맞다.
const BLOG_EXCLUDED_CATEGORIES = ['how-to'];

const BLOG_WHERE = {
  blog_published_at: { [Op.ne]: null },
  is_published: true,
  visibility: 'public',
  // NULL 안전 — `NOT IN` 은 NULL 에 대해 NULL(=거짓)이라, 그냥 쓰면 카테고리 미지정 글이 통째로 사라진다.
  [Op.or]: [
    { blog_category: null },
    { blog_category: { [Op.notIn]: BLOG_EXCLUDED_CATEGORIES } },
  ],
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
    if (req.query.category && req.query.category !== 'all') {
      const cat = String(req.query.category).slice(0, 40);
      // 제외 카테고리를 직접 지정해도 열리지 않는다 (기본 where 를 덮어쓰지 않게).
      if (BLOG_EXCLUDED_CATEGORIES.includes(cat)) return successResponse(res, []);
      where.blog_category = cat;
    }
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
