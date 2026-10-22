// 플랫폼 관리자 > SNS 발송 — 인사이트 글을 채널별 게시물로 (docs/SNS_PUBLISH_DESIGN.md, 단계 1: 외부 발송 없음).
//   마운트: /api/admin/social (routes/admin.js 가 /api/admin/* 를 이미 platform_admin 으로 막지만, 이 라우터도 스스로 막는다).
//   상태 전이는 services/social/socialTransition 한 문 · 채널 목록은 services/social/channels 한 벌.
//   단계 1 에 없는 것: 계정 연결(OAuth)·예약 발송(cron)·공개 미디어 주소 — 자동 채널은 «승인» 에서 멈춘다.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily, perUserLimiter } = require('../middleware/costGuard');
const { HelpArticle, SocialAccount, SocialPost, User } = require('../models');
const { BLOG_WHERE } = require('../services/publicContent');
const { CHANNELS, channelOf } = require('../services/social/channels');
const { renderCards, renderOgImage, resolveSocialFile, removeFile } = require('../services/social/cardRender');
const { draftForArticle } = require('../services/social/socialDraft');
const transition = require('../services/social/socialTransition');
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(authenticateToken, requireRole('platform_admin'));

// 카드 렌더는 브라우저를, 소재 만들기는 LLM 을 쓴다 — 관리자라도 연타를 막는다(costGuard)
const draftLimit = perUserDaily('social-draft', { perMin: 3, perDay: 40 });
const renderLimit = perUserLimiter('social-render', { windowMs: 60_000, max: 10 });

/** 관리자 화면 신호 — 행 대신 id 만(받는 화면이 다시 읽는다). 관리자 전용 방이 없어 각자 user: 방으로. */
async function signal(req, payload) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const admins = await User.findAll({ where: { platform_role: 'platform_admin', status: 'active' }, attributes: ['id'] });
    for (const a of admins) io.to(`user:${a.id}`).emit('social:changed', payload);
  } catch { /* 신호 실패가 저장을 실패시키지 않는다 */ }
}

const ogUrl = (a) => {
  if (!a.og_image_path) return null;
  const at = a.updatedAt ? Math.floor(new Date(a.updatedAt).getTime() / 1000) : 0;
  return `/api/insights/${encodeURIComponent(a.slug)}/og.jpg?v=${at}`;
};

function serializePost(p) {
  const ch = channelOf(p.provider);
  return {
    id: p.id, article_id: p.article_id, provider: p.provider, mode: ch ? ch.mode : null, angle: p.angle, kind: p.kind,
    body: p.body, first_comment: p.first_comment, link_url: p.link_url,
    media: (Array.isArray(p.media) ? p.media : []).map((m, i) => ({ index: i, w: m.w, h: m.h, template: m.template, has_jpg: !!m.jpg })),
    status: p.status, approved_at: p.approved_at, sent_at: p.sent_at, external_url: p.external_url,
    error_message: p.error_message, created_at: p.createdAt, updated_at: p.updatedAt,
  };
}

/** 계정 — 토큰은 응답에 싣지 않는다. 보유 여부는 인스턴스(원본 행)에서 읽어 서버가 만든다(Fable 지적 15). */
function serializeAccount(a) {
  return {
    id: a.id, provider: a.provider, external_id: a.external_id, display_name: a.display_name, avatar_url: a.avatar_url,
    status: a.status, token_expires_at: a.token_expires_at, connected_at: a.connected_at, last_error: a.last_error,
    token_set: !!a.getDataValue('access_token_enc'),
  };
}

function sendTransitionError(res, e, next) {
  if (e instanceof transition.TransitionError) return errorResponse(res, e.code, e.status);
  return next(e);
}

// 채널 목록 + 연결된 계정 (단계 1 은 연결 문이 없어 계정이 비어 있다)
router.get('/overview', async (req, res, next) => {
  try {
    const accounts = await SocialAccount.findAll({ order: [['provider', 'ASC'], ['id', 'ASC']] });
    return successResponse(res, {
      channels: CHANNELS.map((c) => ({ provider: c.provider, mode: c.mode, max_chars: c.maxChars })),
      accounts: accounts.map(serializeAccount),
      publish_enabled: false, // 예약·자동 발송은 단계 2
    });
  } catch (e) { next(e); }
});

router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await SocialAccount.findAll({ order: [['provider', 'ASC'], ['id', 'ASC']] });
    return successResponse(res, accounts.map(serializeAccount));
  } catch (e) { next(e); }
});

// 대상 글 = 랜딩 /insights 와 같은 술어(BLOG_WHERE — how-to 제외, Fable 지적 11)
router.get('/articles', async (req, res, next) => {
  try {
    const where = { ...BLOG_WHERE };
    if (req.query.category && req.query.category !== 'all') where.blog_category = String(req.query.category).slice(0, 40);
    const rows = await HelpArticle.findAll({
      where,
      attributes: ['id', 'slug', 'title_ko', 'summary_ko', 'blog_category', 'blog_published_at', 'og_image_path', 'updatedAt'],
      order: [['blog_published_at', 'DESC']],
      limit: 500,
    });
    const ids = rows.map((r) => r.id);
    const counts = ids.length ? await SocialPost.findAll({
      where: { article_id: { [Op.in]: ids } },
      attributes: ['article_id', 'status', [SocialPost.sequelize.fn('COUNT', SocialPost.sequelize.col('id')), 'n']],
      group: ['article_id', 'status'],
      raw: true,
    }) : [];
    const byArticle = {};
    for (const c of counts) {
      byArticle[c.article_id] = byArticle[c.article_id] || {};
      byArticle[c.article_id][c.status] = Number(c.n);
    }
    return successResponse(res, rows.map((a) => ({
      id: a.id, slug: a.slug, title_ko: a.title_ko, summary_ko: a.summary_ko, blog_category: a.blog_category,
      published_at: a.blog_published_at, og_image_url: ogUrl(a), post_counts: byArticle[a.id] || {},
    })));
  } catch (e) { next(e); }
});

async function loadTarget(id) {
  return HelpArticle.findOne({ where: { ...BLOG_WHERE, id: Number(id) || 0 } });
}

router.get('/articles/:id', async (req, res, next) => {
  try {
    const a = await loadTarget(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    const posts = await SocialPost.findAll({ where: { article_id: a.id }, order: [['angle', 'DESC'], ['id', 'ASC']] });
    return successResponse(res, {
      article: {
        id: a.id, slug: a.slug, title_ko: a.title_ko, summary_ko: a.summary_ko, blog_category: a.blog_category,
        published_at: a.blog_published_at, og_image_url: ogUrl(a),
      },
      posts: posts.map(serializePost),
    });
  } catch (e) { next(e); }
});

// 글 링크 미리보기 이미지 만들기(다시 만들기) — 새 파일을 쓴 뒤 옛 파일을 지운다
router.post('/articles/:id/og-image', renderLimit, async (req, res, next) => {
  try {
    const a = await loadTarget(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    const r = await renderOgImage({ slug: a.slug, title: a.title_ko, summary: a.summary_ko, tag: '인사이트' });
    if (r.overflow) return res.status(422).json({ success: false, message: 'text_overflow', data: { overflow: r.overflow } });
    const old = a.og_image_path;
    await a.update({ og_image_path: r.path });
    if (old && old !== r.path) await removeFile(old);
    await writeAudit({ userId: req.user.id, businessId: null, action: 'social.og_image', targetType: 'help_article', targetId: a.id, newValue: { path: r.path } });
    await signal(req, { article_id: a.id });
    return successResponse(res, { og_image_url: ogUrl(a) });
  } catch (e) { next(e); }
});

// 소재 만들기 — AI 초안(채널 6곳 본문) + 카드 4장. 같은 글을 다시 만들면 angle 이 하나 늘어난다(옛 것은 그대로).
// audit-exempt: 만든 게시물마다 socialTransition.createDrafts 가 같은 트랜잭션에서 social.create 감사를 남긴다
router.post('/articles/:id/drafts', ...draftLimit, async (req, res, next) => {
  try {
    const a = await loadTarget(req.params.id);
    if (!a) return errorResponse(res, 'not_found', 404);
    const d = await draftForArticle(a);
    if (!d.ok) return errorResponse(res, d.reason, 502);
    const r = await renderCards(d.cards, 'feed');
    if (r.overflow) return res.status(422).json({ success: false, message: 'text_overflow', data: { overflow: r.overflow } });
    const media = r.media.map((m, i) => ({ ...m, card: d.cards[i] }));
    const maxAngle = (await SocialPost.max('angle', { where: { article_id: a.id } })) || 0;
    const rows = Object.entries(d.channels).map(([provider, c]) => {
      const ch = channelOf(provider);
      return {
        article_id: a.id, account_id: null, provider, angle: maxAngle + 1,
        kind: ch.kind === 'image' ? 'image' : (media.length > 1 ? 'carousel' : 'image'),
        body: c.body, first_comment: c.first_comment, link_url: c.link_url,
        media: ch.kind === 'image' ? media.slice(0, 1) : media,
      };
    });
    const posts = await transition.createDrafts(rows, req.user.id);
    await signal(req, { article_id: a.id });
    return successResponse(res, { hooks: d.hooks, angle: maxAngle + 1, posts: posts.map(serializePost) });
  } catch (e) { next(e); }
});

// 본문·첫 댓글 수정(자동저장) — 승인된 것을 고치면 초안으로 돌아간다
// audit-exempt: socialTransition.editContent 가 같은 트랜잭션에서 social.edit 감사를 남긴다
router.patch('/posts/:id', async (req, res, next) => {
  try {
    const post = await transition.editContent(Number(req.params.id), req.body || {}, req.user.id);
    await signal(req, { article_id: post.article_id });
    return successResponse(res, serializePost(post));
  } catch (e) { return sendTransitionError(res, e, next); }
});

const ACTIONS = {
  approve: (id, req) => transition.approve(id, req.user.id),
  'mark-posted': (id, req) => transition.markPosted(id, req.user.id, req.body && req.body.external_url),
  cancel: (id, req) => transition.cancel(id, req.user.id),
  restore: (id, req) => transition.restore(id, req.user.id),
};
// audit-exempt: 전이 함수(socialTransition)가 같은 트랜잭션에서 social.<행위> 감사를 남긴다
router.post('/posts/:id/:action(approve|mark-posted|cancel|restore)', async (req, res, next) => {
  try {
    const post = await ACTIONS[req.params.action](Number(req.params.id), req);
    await signal(req, { article_id: post.article_id });
    return successResponse(res, serializePost(post));
  } catch (e) { return sendTransitionError(res, e, next); }
});

// 카드 이미지 — 관리자 화면 미리보기·내려받기(반자동 채널). 공개 주소가 아니다(단계 2 의 공개 미디어 주소와 별개).
router.get('/posts/:id/media/:idx', async (req, res, next) => {
  try {
    const post = await SocialPost.findByPk(Number(req.params.id));
    const m = post && Array.isArray(post.media) ? post.media[Number(req.params.idx)] : null;
    if (!m) return errorResponse(res, 'not_found', 404);
    const jpg = req.query.format === 'jpg' && m.jpg;
    const abs = resolveSocialFile(jpg ? m.jpg : m.file);
    if (!abs || !fs.existsSync(abs)) return errorResponse(res, 'not_found', 404);
    res.set('Cache-Control', 'private, max-age=300');
    if (req.query.download) {
      const art = await HelpArticle.findByPk(post.article_id, { attributes: ['slug'] });
      const name = `${(art && art.slug) || 'card'}-${post.provider}-${Number(req.params.idx) + 1}${path.extname(abs)}`;
      return res.download(abs, name);
    }
    return res.sendFile(abs);
  } catch (e) { next(e); }
});

module.exports = router;
