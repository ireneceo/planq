// Q위키 (Q Wiki) — Platform Admin CRUD
// ─────────────────────────────────────────────────────────
// 카테고리/article CRUD + published 토글 + 스크린샷 캡처 + 재임베딩.
// 모든 엔드포인트 authenticateToken + requireRole('platform_admin') 이중 체크.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const HelpCategory = require('../models/HelpCategory');
const HelpArticle = require('../models/HelpArticle');
const { indexArticle, removeArticleIndex } = require('../services/wikiSearch');

router.use(authenticateToken, requireRole('platform_admin'));

const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `a-${Date.now()}`;

// ─── 카테고리 ───
router.get('/categories', async (req, res, next) => {
  try {
    const cats = await HelpCategory.findAll({
      include: [{ model: HelpArticle, as: 'articles', attributes: ['id'] }],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    const data = cats.map((c) => ({
      id: c.id, slug: c.slug, title_ko: c.title_ko, title_en: c.title_en,
      summary_ko: c.summary_ko, summary_en: c.summary_en, icon: c.icon,
      sort_order: c.sort_order, article_count: c.articles ? c.articles.length : 0,
    }));
    return successResponse(res, data);
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { slug, title_ko, title_en, summary_ko, summary_en, icon, sort_order } = req.body || {};
    if (!title_ko || !title_en) return errorResponse(res, 'title_ko/title_en 필수', 400);
    const cat = await HelpCategory.create({
      slug: slug ? slugify(slug) : slugify(title_en),
      title_ko, title_en, summary_ko: summary_ko || null, summary_en: summary_en || null,
      icon: icon || null, sort_order: Number(sort_order) || 0,
    });
    return successResponse(res, cat, '생성됨', 201);
  } catch (err) { next(err); }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const cat = await HelpCategory.findByPk(req.params.id);
    if (!cat) return errorResponse(res, 'not_found', 404);
    const fields = ['slug', 'title_ko', 'title_en', 'summary_ko', 'summary_en', 'icon', 'sort_order'];
    const patch = {};
    for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f];
    if (patch.slug) patch.slug = slugify(patch.slug);
    await cat.update(patch);
    return successResponse(res, cat);
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const cat = await HelpCategory.findByPk(req.params.id);
    if (!cat) return errorResponse(res, 'not_found', 404);
    const cnt = await HelpArticle.count({ where: { category_id: cat.id } });
    if (cnt > 0) return errorResponse(res, 'article 이 있는 카테고리는 삭제 불가', 400, 'category_not_empty');
    await cat.destroy();
    return successResponse(res, { id: cat.id }, '삭제됨');
  } catch (err) { next(err); }
});

// ─── article ───
router.get('/articles', async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = {};
    if (req.query.category) where.category_id = Number(req.query.category) || -1;
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      where[Op.or] = [{ title_ko: { [Op.like]: like } }, { title_en: { [Op.like]: like } }, { slug: { [Op.like]: like } }];
    }
    const { rows, count } = await HelpArticle.findAndCountAll({
      where,
      include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
      order: [['sort_order', 'ASC'], ['id', 'DESC']],
      limit, offset, distinct: true,
    });
    return paginatedResponse(res, rows, count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.get('/articles/:id', async (req, res, next) => {
  try {
    const a = await HelpArticle.findByPk(req.params.id, {
      include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
    });
    if (!a) return errorResponse(res, 'not_found', 404);
    return successResponse(res, a);
  } catch (err) { next(err); }
});

router.post('/articles', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title_ko || !b.title_en || !b.category_id) {
      return errorResponse(res, 'title_ko/title_en/category_id 필수', 400);
    }
    const cat = await HelpCategory.findByPk(b.category_id);
    if (!cat) return errorResponse(res, '카테고리 없음', 400, 'invalid_category');
    const article = await HelpArticle.create({
      slug: b.slug ? slugify(b.slug) : slugify(b.title_en),
      category_id: b.category_id,
      title_ko: b.title_ko, title_en: b.title_en,
      summary_ko: b.summary_ko || null, summary_en: b.summary_en || null,
      body_ko: b.body_ko || null, body_en: b.body_en || null,
      visibility: b.visibility === 'public' ? 'public' : 'authenticated',
      linked_route: b.linked_route || null,
      est_minutes: b.est_minutes != null ? Number(b.est_minutes) : null,
      sort_order: Number(b.sort_order) || 0,
      is_published: !!b.is_published,
    });
    // 비동기 재인덱싱 (검색/RAG 갱신) — fan-out 패턴
    indexArticle(article.id).catch((e) => console.warn('[admin_wiki] index fail', e.message));
    return successResponse(res, article, '생성됨', 201);
  } catch (err) { next(err); }
});

router.put('/articles/:id', async (req, res, next) => {
  try {
    const a = await HelpArticle.findByPk(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    const b = req.body || {};
    const fields = ['category_id', 'title_ko', 'title_en', 'summary_ko', 'summary_en',
      'body_ko', 'body_en', 'visibility', 'linked_route', 'est_minutes', 'sort_order', 'is_published'];
    const patch = {};
    for (const f of fields) if (b[f] !== undefined) patch[f] = b[f];
    if (b.slug !== undefined) patch.slug = slugify(b.slug);
    if (patch.visibility && !['public', 'authenticated'].includes(patch.visibility)) delete patch.visibility;
    await a.update(patch);
    // 본문/제목/요약 바뀌었으면 재인덱싱
    if (['title_ko', 'title_en', 'summary_ko', 'summary_en', 'body_ko', 'body_en'].some((f) => b[f] !== undefined)) {
      indexArticle(a.id).catch((e) => console.warn('[admin_wiki] reindex fail', e.message));
    }
    return successResponse(res, a);
  } catch (err) { next(err); }
});

router.delete('/articles/:id', async (req, res, next) => {
  try {
    const a = await HelpArticle.findByPk(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    await removeArticleIndex(a.id);
    await a.destroy();
    return successResponse(res, { id: a.id }, '삭제됨');
  } catch (err) { next(err); }
});

// ─── 스크린샷 캡처 (Puppeteer) — linked_route 캡처 → File → image 블록 ───
router.post('/articles/:id/capture', async (req, res, next) => {
  try {
    const a = await HelpArticle.findByPk(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    if (!a.linked_route) return errorResponse(res, 'linked_route 가 없어 캡처할 수 없습니다', 400, 'no_linked_route');
    // 비동기 캡처 — 즉시 응답 + 백그라운드 처리 (fan-out)
    const { captureArticleScreenshot } = require('../services/wikiScreenshot');
    captureArticleScreenshot(a.id).catch((e) => console.warn('[admin_wiki] capture fail', e.message));
    return successResponse(res, { id: a.id, status: 'capturing' }, '캡처를 시작했습니다');
  } catch (err) { next(err); }
});

// ─── 재임베딩 (전체 또는 단일) ───
router.post('/reembed', async (req, res, next) => {
  try {
    const { article_id } = req.body || {};
    if (article_id) {
      indexArticle(Number(article_id)).catch((e) => console.warn('[admin_wiki] reembed fail', e.message));
      return successResponse(res, { article_id: Number(article_id), status: 'reembedding' });
    }
    // 전체 — 백그라운드 순차
    const ids = (await HelpArticle.findAll({ attributes: ['id'] })).map((x) => x.id);
    (async () => {
      for (const id of ids) {
        try { await indexArticle(id); } catch (e) { console.warn('[admin_wiki] reembed', id, e.message); }
      }
      console.log(`[admin_wiki] reembed 완료 ${ids.length}건`);
    })();
    return successResponse(res, { count: ids.length, status: 'reembedding' });
  } catch (err) { next(err); }
});

// ─── KNOWLEDGE_LOOP 축3 — 블로그 발행 토글 ───
// PUT /api/admin/wiki/articles/:id/blog  body: { published: boolean, category?: string }
router.put('/articles/:id/blog', async (req, res, next) => {
  try {
    const article = await HelpArticle.findByPk(req.params.id);
    if (!article) return errorResponse(res, 'not_found', 404);
    const b = req.body || {};
    if (b.published) {
      // 내부용 글이 마케팅 페이지로 새는 것 방지 — public + 발행 글만 블로그 허용
      if (!article.is_published || article.visibility !== 'public') {
        return errorResponse(res, 'blog_requires_public_published', 400);
      }
      await article.update({
        blog_published_at: article.blog_published_at || new Date(),
        blog_category: b.category ? String(b.category).slice(0, 40) : (article.blog_category || 'insights'),
      });
    } else {
      await article.update({ blog_published_at: null });
    }
    return successResponse(res, {
      id: article.id,
      blog_published_at: article.blog_published_at,
      blog_category: article.blog_category,
    });
  } catch (err) { next(err); }
});

// ─── KNOWLEDGE_LOOP 축2 — 질문 로그 대시보드 ───
// GET /api/admin/wiki/question-logs?filter=unanswered|not_helpful|all&days=30
router.get('/question-logs', async (req, res, next) => {
  try {
    const HelpQuestionLog = require('../models/HelpQuestionLog');
    const days = Math.min(Number(req.query.days) || 30, 180);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = String(req.query.filter || 'all');
    const where = { created_at: { [Op.gte]: since } };
    if (filter === 'unanswered') where.answered = false;
    if (filter === 'not_helpful') where.feedback = 'not_helpful';
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const { rows, count } = await HelpQuestionLog.findAndCountAll({
      where, order: [['created_at', 'DESC']], limit, offset,
    });
    // 요약 통계 (같은 기간)
    const [total, unanswered, notHelpful] = await Promise.all([
      HelpQuestionLog.count({ where: { created_at: { [Op.gte]: since } } }),
      HelpQuestionLog.count({ where: { created_at: { [Op.gte]: since }, answered: false } }),
      HelpQuestionLog.count({ where: { created_at: { [Op.gte]: since }, feedback: 'not_helpful' } }),
    ]);
    return res.json({
      success: true,
      data: rows,
      pagination: { total: count, limit, page, offset, has_more: offset + rows.length < count },
      stats: { total, unanswered, not_helpful: notHelpful },
    });
  } catch (err) { next(err); }
});

// 수동 트리거 — 클러스터링 즉시 실행 (검증·운영 편의)
router.post('/question-cluster/run', async (req, res, next) => {
  try {
    const { runWikiQuestionClustering } = require('../services/wikiQuestionCluster');
    const result = await runWikiQuestionClustering();
    return successResponse(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
