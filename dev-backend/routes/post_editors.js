// 문서 공동 편집자 — 넣기·빼기 (2026-10-23, docs/DOC_COEDITORS_DESIGN.md · Fable DESIGN-OK).
//
//   ★ /api/posts 에 posts.js **보다 앞에** 마운트한다 — 이 파일에는 `/:id/editors…` 꼬리 경로만 둔다.
//   ★ 판정·쓰기·알림·실시간은 services/postEditors 한 곳. 목록은 문서 상세(GET /api/posts/:id)의 co_editors 가 정본이다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const postEditors = require('../services/postEditors');

const send = (res, r) => (r.ok ? successResponse(res, r.data) : errorResponse(res, r.code, r.http, r.code));

// POST /api/posts/:id/editors  { user_id }
router.post('/:id/editors', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/postEditors.add 가 쓴다(post.editors_update)
  try {
    send(res, await postEditors.add({ req, postId: Number(req.params.id), userId: req.body?.user_id }));
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/editors/:userId
router.delete('/:id/editors/:userId', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/postEditors.remove 가 쓴다(post.editors_update)
  try {
    send(res, await postEditors.remove({ req, postId: Number(req.params.id), userId: req.params.userId }));
  } catch (err) { next(err); }
});

module.exports = router;
