// Q위키 (Q Wiki) — 공개+로그인 read API
// ─────────────────────────────────────────────────────────
// 플랫폼 공통 도움말 콘텐츠. 격리 축은 visibility(public/authenticated) 만.
//   게스트(req.user=null) → is_published=1 AND visibility='public' 강제
//   로그인              → is_published=1 (public + authenticated)
// 설계: docs/Q_WIKI_DESIGN.md §3, §8
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const HelpCategory = require('../models/HelpCategory');
const HelpArticle = require('../models/HelpArticle');
const { searchArticleIds } = require('../services/wikiSearch');

// 요청 언어 — ?lang= 우선, Accept-Language fallback, 기본 ko
function reqLang(req) {
  const q = String(req.query.lang || '').toLowerCase();
  if (q === 'ko' || q === 'en') return q;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return al.startsWith('en') ? 'en' : 'ko';
}
function pick(article, base, lang) {
  // 요청 언어 우선, 없으면 반대 언어 fallback (빈 화면 금지 — V9)
  const other = lang === 'ko' ? 'en' : 'ko';
  return article[`${base}_${lang}`] || article[`${base}_${other}`] || null;
}

function serializeCategory(c, lang) {
  return {
    id: c.id,
    slug: c.slug,
    title: pick(c, 'title', lang),
    summary: pick(c, 'summary', lang),
    title_ko: c.title_ko, title_en: c.title_en,
    summary_ko: c.summary_ko, summary_en: c.summary_en,
    icon: c.icon,
    sort_order: c.sort_order,
    article_count: c.get ? (c.getDataValue('article_count') ?? undefined) : undefined,
  };
}

function serializeArticle(a, lang, { withBody = false } = {}) {
  const out = {
    id: a.id,
    slug: a.slug,
    category_id: a.category_id,
    title: pick(a, 'title', lang),
    summary: pick(a, 'summary', lang),
    title_ko: a.title_ko, title_en: a.title_en,
    summary_ko: a.summary_ko, summary_en: a.summary_en,
    visibility: a.visibility,
    linked_route: a.linked_route,
    est_minutes: a.est_minutes,
    sort_order: a.sort_order,
    is_published: a.is_published,
    view_count: a.view_count,
    updated_at: a.updated_at,
  };
  if (a.category) {
    out.category = { id: a.category.id, slug: a.category.slug, title: pick(a.category, 'title', lang) };
  }
  if (withBody) {
    out.body = pick(a, 'body', lang);
    out.body_ko = a.body_ko;
    out.body_en = a.body_en;
  }
  return out;
}

// visibility WHERE — 게스트는 public 만
function visibilityWhere(req) {
  const w = { is_published: true };
  if (!req.user) w.visibility = 'public';
  return w;
}

// #194 — 'updates'(제품 공지) 카테고리 id 캐시. 위키 read 표면(목록·검색)에서 공지를 걸러낸다.
//   콘텐츠 원천은 help_articles 이지만 updates 는 도움말이 아니므로 위키 브라우즈에 섞이면 안 됨.
let _updatesCatId; let _updatesCatAt = 0;
async function updatesCategoryId() {
  if (_updatesCatId !== undefined && Date.now() - _updatesCatAt < 300000) return _updatesCatId;
  const c = await HelpCategory.findOne({ where: { slug: 'updates' }, attributes: ['id'] });
  _updatesCatId = c ? c.id : null; _updatesCatAt = Date.now();
  return _updatesCatId;
}

// ─── GET /categories — 발행 article 있는 카테고리만 ───
router.get('/categories', optionalAuth, async (req, res, next) => {
  try {
    const lang = reqLang(req);
    const articleWhere = visibilityWhere(req);
    // 발행(+게스트는 public) article 이 1건 이상 있는 카테고리만 노출
    // #194 — 'updates'(제품 공지/체인지로그) 카테고리는 도움말이 아니므로 위키 목록에서 제외.
    const cats = await HelpCategory.findAll({
      where: { slug: { [Op.ne]: 'updates' } },
      include: [{
        model: HelpArticle, as: 'articles', attributes: ['id'], where: articleWhere, required: true,
      }],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    // 카운트 채우기 (include 가 1:N 이라 distinct 처리)
    const seen = new Map();
    for (const c of cats) {
      if (!seen.has(c.id)) seen.set(c.id, { cat: c, count: 0 });
      seen.get(c.id).count += (c.articles ? c.articles.length : 0);
    }
    const data = [...seen.values()].map(({ cat, count }) => ({
      ...serializeCategory(cat, lang),
      article_count: count,
    }));
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ─── GET /articles — 목록·검색 (pagination 표준) ───
router.get('/articles', optionalAuth, async (req, res, next) => {
  try {
    const lang = reqLang(req);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = visibilityWhere(req);

    // 카테고리 필터 (slug 또는 id)
    if (req.query.category) {
      const cv = String(req.query.category);
      let catId = /^\d+$/.test(cv) ? Number(cv) : null;
      if (catId === null) {
        const cat = await HelpCategory.findOne({ where: { slug: cv }, attributes: ['id'] });
        catId = cat ? cat.id : -1;
      }
      where.category_id = catId;
    } else {
      // 카테고리 필터가 없으면 updates(제품 공지)는 위키 목록에서 제외 (#194)
      const upId = await updatesCategoryId();
      if (upId) where.category_id = { [Op.ne]: upId };
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      // 하이브리드 검색 → id 순서 보존
      const ids = await searchArticleIds(q, { onlyPublic: !req.user, limit: 50 });
      if (!ids.length) return paginatedResponse(res, [], 0, { limit, page, offset });
      where.id = { [Op.in]: ids };
      const all = await HelpArticle.findAll({
        where,
        include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
      });
      // 검색 점수 순서대로 재정렬
      const orderMap = new Map(ids.map((id, i) => [id, i]));
      all.sort((x, y) => (orderMap.get(x.id) ?? 999) - (orderMap.get(y.id) ?? 999));
      const total = all.length;
      const pageRows = all.slice(offset, offset + limit);
      return paginatedResponse(res, pageRows.map((a) => serializeArticle(a, lang)), total, { limit, page, offset });
    }

    // 일반 목록
    const { rows, count } = await HelpArticle.findAndCountAll({
      where,
      include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      limit, offset, distinct: true,
    });
    return paginatedResponse(res, rows.map((a) => serializeArticle(a, lang)), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /context — 현재 화면 linked_route 매칭 article (드로어 "이 화면에서") ───
// 구체 라우트가 /articles/:slug 보다 먼저 정의되어야 함 (Express 매칭 순서)
router.get('/context', authenticateToken, async (req, res, next) => {
  try {
    const lang = reqLang(req);
    const path = String(req.query.path || '').trim();
    if (!path) return successResponse(res, []);
    // path 정규화 — 쿼리스트링 제거, 가장 구체적 prefix 매칭
    const cleanPath = path.split('?')[0].replace(/\/+$/, '') || '/';
    const arts = await HelpArticle.findAll({
      where: { is_published: true, linked_route: { [Op.ne]: null } },
      include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
      order: [['sort_order', 'ASC']],
    });
    const matched = arts
      .filter((a) => {
        const lr = String(a.linked_route || '').replace(/\/+$/, '');
        if (!lr) return false;
        return cleanPath === lr || cleanPath.startsWith(lr + '/');
      })
      // 가장 긴(구체적) linked_route 우선
      .sort((x, y) => (y.linked_route || '').length - (x.linked_route || '').length)
      .slice(0, 5);
    return successResponse(res, matched.map((a) => serializeArticle(a, lang)));
  } catch (err) { next(err); }
});

// ─── GET /articles/:slug — 상세 + view_count++ ───
router.get('/articles/:slug', optionalAuth, async (req, res, next) => {
  try {
    const lang = reqLang(req);
    const article = await HelpArticle.findOne({
      where: { slug: req.params.slug },
      include: [{ model: HelpCategory, as: 'category', attributes: ['id', 'slug', 'title_ko', 'title_en'] }],
    });
    if (!article || !article.is_published) {
      return errorResponse(res, 'article_not_found', 404, 'not_found');
    }
    // 게스트는 public 만 (격리 — V2)
    if (!req.user && article.visibility !== 'public') {
      return errorResponse(res, 'login_required', 401, 'auth_required');
    }
    // view_count++ (조회 통계, 비차단)
    HelpArticle.increment('view_count', { by: 1, where: { id: article.id } }).catch(() => {});

    // 같은 카테고리 관련 article (최대 5)
    const relatedWhere = { category_id: article.category_id, id: { [Op.ne]: article.id }, ...visibilityWhere(req) };
    const related = await HelpArticle.findAll({
      where: relatedWhere, order: [['sort_order', 'ASC']], limit: 5,
    });

    const data = serializeArticle(article, lang, { withBody: true });
    data.related = related.map((a) => serializeArticle(a, lang));

    // 캐시 — article 은 거의 불변 (§8). ETag = updated_at 해시.
    res.set('Cache-Control', 'public, max-age=300');
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ─── GET /image/:fileId — 위키 스크린샷 이미지 서빙 (공개) ───
// IDOR 방지: 발행된 help_article body 의 image 블록에 file_id 가 실제 참조될 때만 서빙.
const fs = require('fs');
const path = require('path');
const File = require('../models/File');
router.get('/image/:fileId', async (req, res, next) => {
  try {
    const fid = Number(req.params.fileId);
    if (!Number.isInteger(fid) || fid <= 0) return res.status(400).end();
    const like = `%"file_id":${fid}%`;
    const referenced = await HelpArticle.findOne({
      where: { is_published: true, [Op.or]: [{ body_ko: { [Op.like]: like } }, { body_en: { [Op.like]: like } }] },
      attributes: ['id'],
    });
    if (!referenced) return res.status(404).end();
    const file = await File.findOne({ where: { id: fid, deleted_at: null } });
    if (!file || !file.file_path || !fs.existsSync(file.file_path)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    if (file.mime_type) res.type(file.mime_type);
    return res.sendFile(path.resolve(file.file_path));
  } catch (err) { next(err); }
});

module.exports = router;
