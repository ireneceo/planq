// /api/posts/:id/revisions — 포스트 변경 기록 (2026-08-25).
//
// posts.js 에서 분리한 이유: god-file 래칫이 잡았고(1342 → 1549줄), 애초에 이력은 별개 관심사다.
// 권한·격리 규칙은 posts.js 와 동일하게 canEditPost + business_id WHERE 를 쓴다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const { Post, PostRevision, User } = require('../models');
const { canEditPost, extractText, broadcastPost } = require('./posts');

// ── 변경 기록 (2026-08-25) ─────────────────────────────────────────
//   "저장 버튼 없이 항상 저장" 의 안전망. 이력 조회·복원 권한 = **편집 권한과 동일**이다
//   (고객·읽기 전용 사용자에게 내부 편집 이력을 보여줄 이유가 없다).
//   ★ 모든 조회에 business_id 를 넣는다 — 격리 축을 조인에 의존하면 한 곳만 빠져도 샌다.
router.get('/:id/revisions', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await canEditPost(req.user.id, post, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const rows = await PostRevision.findAll({
      where: { post_id: post.id, business_id: post.business_id },
      order: [['revision_number', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 30, 50),
      attributes: ['id', 'revision_number', 'title', 'source', 'byte_size', 'editor_user_id', 'created_at'],
      include: [{ model: User, as: 'editor', attributes: ['id', 'name', 'username'], required: false }],
    });
    return successResponse(res, rows.map((r) => ({
      id: r.id,
      revision_number: r.revision_number,
      title: r.title,
      source: r.source,
      byte_size: r.byte_size,
      editor: r.editor ? { id: r.editor.id, name: r.editor.name || r.editor.username } : null,
      created_at: r.created_at,
    })));
  } catch (err) { next(err); }
});

// 특정 버전 본문 — 미리보기용. 목록에 본문을 담으면 응답이 수 MB 가 된다.
router.get('/:id/revisions/:revId', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await canEditPost(req.user.id, post, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const rev = await PostRevision.findOne({
      where: { id: req.params.revId, post_id: post.id, business_id: post.business_id },
    });
    if (!rev) return errorResponse(res, 'not_found', 404);
    let content = null;
    try { content = rev.content_json ? JSON.parse(rev.content_json) : null; } catch { content = null; }
    return successResponse(res, {
      id: rev.id, revision_number: rev.revision_number,
      title: rev.title, category: rev.category, content_json: content,
      created_at: rev.created_at,
    });
  } catch (err) { next(err); }
});

// 복원 — 파괴적이지 않다. 되돌린 결과가 **새 버전으로 한 번 더 쌓인다**(source='restore').
//   그래야 "되돌린 것을 다시 되돌리기" 가 된다.
router.post('/:id/revisions/:revId/restore', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await canEditPost(req.user.id, post, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const rev = await PostRevision.findOne({
      where: { id: req.params.revId, post_id: post.id, business_id: post.business_id },
    });
    if (!rev) return errorResponse(res, 'not_found', 404);

    // 복원 직전 상태를 먼저 남긴다 — 안 남기면 "복원 전으로" 돌아갈 방법이 사라진다.
    await require('../services/postRevisions').recordRevision({
      post, editorUserId: req.user.id, source: 'manual',
    });

    await post.update({
      title: rev.title,
      content_json: rev.content_json,
      content_text: extractText((() => { try { return rev.content_json ? JSON.parse(rev.content_json) : null; } catch { return null; } })()),
      category: rev.category,
    });
    // 첨부 목록도 그 시점으로 — 본문 안 이미지는 content_json 에 들어 있어 이미 돌아왔지만,
    //   하단 첨부는 별도 테이블이라 여기서 맞춰야 "그 시점 문서" 가 완성된다.
    //   ★ 파일 자체를 지우지는 않는다. 링크(연결)만 그 시점 구성으로 되돌린다.
    if (Array.isArray(rev.attachment_file_ids)) {
      const { PostAttachment } = require('../models');
      const want = rev.attachment_file_ids;
      const now = await PostAttachment.findAll({ where: { post_id: post.id }, attributes: ['id', 'file_id'] });
      const nowIds = now.map((a) => a.file_id);
      const toAdd = want.filter((id) => !nowIds.includes(id));
      const toRemove = now.filter((a) => !want.includes(a.file_id)).map((a) => a.id);
      if (toRemove.length) await PostAttachment.destroy({ where: { id: toRemove } });
      for (const fid of toAdd) {
        try { await PostAttachment.create({ post_id: post.id, file_id: fid }); } catch { /* 이미 지워진 파일 — 건너뛴다 */ }
      }
    }
    await require('../services/postRevisions').recordRevision({
      post, editorUserId: req.user.id, source: 'restore',
    });
    require('../services/auditService').logAudit(req, {
      action: 'post.restore', targetType: 'post', targetId: post.id,
      newValue: { revision_number: rev.revision_number },
    });
    broadcastPost(req, post, 'post:updated');
    const full = await Post.findByPk(post.id);
    return successResponse(res, full ? full.toJSON() : { id: post.id });
  } catch (err) { next(err); }
});


module.exports = router;
