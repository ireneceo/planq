// 문서(Q docs) 댓글 — 설계 docs/DOC_COMMENTS_DESIGN.md (2026-10-15 Fable).
//
//   ★ /api/posts 에 posts.js **보다 앞에** 마운트한다 — 같은 접두어를 여러 라우터가 나눈다.
//     이 파일에는 `/:id/comments…` 꼬리 경로만 둔다(posts.js 의 `/:id` 와 겹치지 않게).
//   ★ 읽기 판정은 문서 본문과 같은 canReadPost 하나. 못 읽으면(휴지통 포함) 404 — 존재를 말하지 않는다.
//   ★ 인증된 사람만(공개 링크·게스트·설문 응답자는 댓글을 모른다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { errorResponse, parsePagination } = require('../middleware/errorHandler');
const { Post, PostComment, User } = require('../models');
const AUTHOR = { model: User, as: 'author', attributes: ['id', 'name'] };
const { canReadPost } = require('../services/postAccess');
const pc = require('../services/postComments');
const postActions = require('../services/actions/post_actions');

const actorOf = (req) => ({ kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req });

async function loadReadable(req) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return null;
  const post = await Post.findByPk(id);   // paranoid — 휴지통 문서는 여기서 걸러진다
  if (!post) return null;
  if (!(await canReadPost(req.user, post))) return null;
  return post;
}

async function serializeRows(rows, post, viewerId, scope) {
  const authors = await pc.authorsFor(post.business_id, rows.map((r) => r.user_id));
  const moderate = pc.canModerate(scope);
  return rows.map((r) => pc.serializeComment(r, { viewerId, canModerate: moderate, authors }));
}

// GET /api/posts/:id/comments — 보는 사람 기준(고객은 shared 만), 오래된 것부터
router.get('/:id/comments', authenticateToken, async (req, res, next) => {
  try {
    const post = await loadReadable(req);
    if (!post) return errorResponse(res, 'not_found', 404);
    const viewer = await pc.viewerOf(req.user, post);
    if (!viewer.isMember && !viewer.isClient) return errorResponse(res, 'not_found', 404);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await PostComment.findAndCountAll({
      where: pc.visibleWhere(post.id, viewer),
      include: [AUTHOR],
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      limit, offset,
    });
    const data = await serializeRows(rows, post, req.user.id, viewer.scope);
    // paginatedResponse 는 추가 키를 pagination 안에 넣는다 — meta 는 옆에 직접 싣는다.
    return res.json({
      success: true,
      data,
      pagination: { total: count, limit, page, offset, has_more: (offset + data.length) < count },
      meta: {
        viewer_kind: viewer.isMember ? 'member' : 'client',
        can_share_with_clients: viewer.isMember ? await pc.canShareWithClients(post) : false,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/comments { content, visibility? }
// audit-exempt: 감사는 행동 계층(post_actions.createComment → post.comment_create)이 남긴다 — 본문 없이
router.post('/:id/comments', authenticateToken, async (req, res, next) => {
  try {
    const post = await loadReadable(req);
    if (!post) return errorResponse(res, 'not_found', 404);
    const r = await postActions.createComment(actorOf(req), post, {
      content: req.body?.content, visibility: req.body?.visibility,
    });
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    const viewer = await pc.viewerOf(req.user, post);
    const row = await PostComment.findByPk(r.data.id, { include: [AUTHOR] });
    const [one] = await serializeRows([row], post, req.user.id, viewer.scope);
    return res.status(201).json({ success: true, data: one });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/comments/:cid — 작성자 또는 owner/admin
// audit-exempt: 감사는 행동 계층(post_actions.deleteComment → post.comment_delete)이 남긴다
router.delete('/:id/comments/:cid', authenticateToken, async (req, res, next) => {
  try {
    const post = await loadReadable(req);
    if (!post) return errorResponse(res, 'not_found', 404);
    const r = await postActions.deleteComment(actorOf(req), post, Number(req.params.cid));
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    return res.json({ success: true, data: r.data });
  } catch (err) { next(err); }
});

module.exports = router;
