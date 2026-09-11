// 제품 공지 / 체인지로그 (#194) — 인앱 "새 소식" 패널 API
// ─────────────────────────────────────────────────────────
// 콘텐츠 원천: help_articles(blog_category='updates', is_published, blog_published_at != null).
//   별도 테이블 없음 — Q위키 블로그 발행 파이프라인 재사용.
// 미읽음 워터마크: users.whats_new_seen_at (이 시각 이후 발행분 = 미읽음).
// push fan-out 없음 (설계) — badge 는 mount·focus 시 폴링으로 갱신.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const HelpArticle = require('../models/HelpArticle');
const User = require('../models/User');
const WhatsNewRead = require('../models/WhatsNewRead');

const UPDATES_WHERE = {
  blog_category: 'updates',
  is_published: true,
  blog_published_at: { [Op.ne]: null },
};
const LIST_LIMIT = 20;

// 요청 언어 — ?lang= 우선, Accept-Language fallback, 기본 ko
function reqLang(req) {
  const q = String(req.query.lang || '').toLowerCase();
  if (q === 'ko' || q === 'en') return q;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return al.startsWith('en') ? 'en' : 'ko';
}
function pick(a, base, lang) {
  const other = lang === 'ko' ? 'en' : 'ko';
  return a[`${base}_${lang}`] || a[`${base}_${other}`] || null;
}
// 미읽음 = 워터마크("모두 읽음") 이후 발행 AND 개별로 읽지 않음(whats_new_reads) — 알림과 같은 규칙
function serialize(a, lang, seenAt, readSlugs) {
  return {
    slug: a.slug,
    title: pick(a, 'title', lang),
    summary: pick(a, 'summary', lang),
    body: pick(a, 'body', lang),
    published_at: a.blog_published_at,
    is_new: (!seenAt || new Date(a.blog_published_at) > seenAt) && !readSlugs.has(a.slug),
  };
}

// GET /api/whats-new — 최근 공지 목록 + 미읽음 수
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const lang = reqLang(req);
    const me = await User.findByPk(req.user.id, { attributes: ['whats_new_seen_at'] });
    const seenAt = me && me.whats_new_seen_at ? new Date(me.whats_new_seen_at) : null;

    const rows = await HelpArticle.findAll({
      where: UPDATES_WHERE,
      order: [['blog_published_at', 'DESC']],
      limit: LIST_LIMIT,
    });
    const reads = rows.length
      ? await WhatsNewRead.findAll({ where: { user_id: req.user.id, slug: { [Op.in]: rows.map((a) => a.slug) } }, attributes: ['slug'] })
      : [];
    const readSlugs = new Set(reads.map((r) => r.slug));
    const items = rows.map((a) => serialize(a, lang, seenAt, readSlugs));
    const unread_count = items.filter((i) => i.is_new).length;
    return successResponse(res, { items, unread_count, seen_at: seenAt });
  } catch (err) { next(err); }
});

// POST /api/whats-new/seen — "모두 읽음" (워터마크 갱신). 드롭다운을 **여는 것만으로는 부르지 않는다**(2026-09-11).
router.post('/seen', authenticateToken, async (req, res, next) => {
  try {
    const now = new Date();
    await User.update({ whats_new_seen_at: now }, { where: { id: req.user.id } });
    return successResponse(res, { seen_at: now });
  } catch (err) { next(err); }
});

// POST /api/whats-new/:slug/read — 개별 읽음 (알림의 항목 클릭과 같다). 발행된 새 소식 slug 만 받는다. 멱등.
router.post('/:slug/read', authenticateToken, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').slice(0, 200);
    const exists = await HelpArticle.findOne({ where: { ...UPDATES_WHERE, slug }, attributes: ['id'] });
    if (!exists) return errorResponse(res, 'not_found', 404);
    await WhatsNewRead.findOrCreate({ where: { user_id: req.user.id, slug }, defaults: { read_at: new Date() } });
    return successResponse(res, { slug });
  } catch (err) { next(err); }
});

module.exports = router;
