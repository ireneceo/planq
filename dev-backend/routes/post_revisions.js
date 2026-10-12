// /api/posts/:id/revisions — 포스트 변경 기록 (2026-08-25).
//
// posts.js 에서 분리한 이유: god-file 래칫이 잡았고(1342 → 1549줄), 애초에 이력은 별개 관심사다.
// 권한·격리 규칙은 posts.js 와 동일하게 canEditPost + business_id WHERE 를 쓴다.
const express = require('express');
const router = express.Router();
const { blockIfSigned } = require('../services/signatureCore');
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
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    const rows = await PostRevision.findAll({
      where: { post_id: post.id, business_id: post.business_id },
      order: [['revision_number', 'DESC']],
      limit,
      attributes: ['id', 'revision_number', 'title', 'category', 'content_json', 'source', 'byte_size', 'editor_user_id', 'created_at', 'updated_at'],
      include: [{ model: User, as: 'editor', attributes: ['id', 'name', 'username'], required: false }],
    });
    // 글자 수 — 본문은 응답에 싣지 않고 «얼마나 바뀌었나» 만 보여 준다(목록이 수 MB 가 되지 않게).
    const textLen = (r) => {
      try { return extractText(r.content_json ? JSON.parse(r.content_json) : null).replace(/\s+/g, '').length; }
      catch { return 0; }
    };
    const lens = rows.map(textLen);
    return successResponse(res, rows.map((r, i) => {
      const prev = rows[i + 1];   // 내림차순이라 다음 행이 바로 앞 버전
      return {
        id: r.id,
        revision_number: r.revision_number,
        title: r.title,
        source: r.source,
        byte_size: r.byte_size,
        editor: r.editor ? { id: r.editor.id, name: r.editor.name || r.editor.username } : null,
        // ★ 인스턴스의 r.created_at 은 undefined 다(속성 이름은 createdAt, 전역 toJSON 만 바꿔 준다) —
        //   2026-08-25 부터 이 목록의 시각은 늘 빈칸이었다. get() 으로 읽는다.
        created_at: r.get('created_at'),
        // 같은 사람이 이어 쓴 저장은 한 버전으로 합쳐진다 — «언제 고쳤나» 는 그 묶음의 마지막 저장 시각이다.
        saved_at: r.get('updated_at') || r.get('created_at'),
        text_len: lens[i],
        // 앞 버전이 목록 밖(상한·limit)이면 차이를 모른다 — null 로 둔다(0 은 «안 바뀜» 이라는 거짓이 된다).
        text_delta: prev ? lens[i] - lens[i + 1] : null,
        title_changed: prev ? prev.title !== r.title : false,
        category_changed: prev ? (prev.category || null) !== (r.category || null) : false,
        is_first: r.revision_number === 1,
      };
    }));
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
    const editor = rev.editor_user_id ? await User.findByPk(rev.editor_user_id, { attributes: ['id', 'name', 'username'] }) : null;
    let content = null;
    try { content = rev.content_json ? JSON.parse(rev.content_json) : null; } catch { content = null; }
    return successResponse(res, {
      id: rev.id, revision_number: rev.revision_number,
      title: rev.title, category: rev.category, content_json: content,
      source: rev.source,
      editor: editor ? { id: editor.id, name: editor.name || editor.username } : null,
      created_at: rev.get('created_at'),
      saved_at: rev.get('updated_at') || rev.get('created_at'),
    });
  } catch (err) { next(err); }
});

// 복원 — 파괴적이지 않다. 되돌린 결과가 **새 버전으로 한 번 더 쌓인다**(source='restore').
//   그래야 "되돌린 것을 다시 되돌리기" 가 된다.
router.post('/:id/revisions/:revId/restore', authenticateToken, async (req, res, next) => {
  try {
    // 서명 잠금 — 복원은 본문을 통째로 교체한다(서명 대상 변조).
    if (await blockIfSigned(res, req.params.id)) return;
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
      editor_id: req.user.id,
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
      action: 'post.restore', targetType: 'post', targetId: post.id, businessId: post.business_id,
      newValue: { revision_number: rev.revision_number },
    });
    broadcastPost(req, post, 'post:updated');
    const full = await Post.findByPk(post.id);
    return successResponse(res, full ? full.toJSON() : { id: post.id });
  } catch (err) { next(err); }
});


module.exports = router;
