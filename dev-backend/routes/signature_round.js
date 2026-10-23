// routes/signature_round.js — 서명 회차 닫기 [고쳐서 다시 보내기] (2026-10-22, Fable 설계 PASS · docs/SIGNATURE_REVISE_ROUND_DESIGN.md)
//
// 서버 마운트: app.use('/api', require('./routes/signature_round'))  ← signatures 와 같은 base. 꼬리 경로 고유(close-round).
// 판정·처리는 services/signatureRound 한 곳. 여기는 권한(D6)만 본다:
//   그 워크스페이스 멤버 이상 ∧ services/signatureList.canManageRows(취소·재알림과 같은 한 술어 —
//   회차 어느 행의 요청자 ∨ 문서를 고칠 수 있는 사람 ∨ owner/admin ∧ 문서를 읽을 수 있음).
const express = require('express');
const router = express.Router();
const { Post } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { assertMember } = require('../services/signatureCore');
const { canManageRows } = require('../services/signatureList');
const round = require('../services/signatureRound');

// POST /api/posts/:id/signatures/close-round  body: { reason? }
router.post('/posts/:id/signatures/close-round', authenticateToken, async (req, res, next) => { // audit-exempt: 감사(signature.round_closed)는 services/signatureRound.closeRound 가 남긴다
  const t = await sequelize.transaction();
  try {
    const post = await Post.findByPk(req.params.id, { transaction: t });
    if (!post) { await t.rollback(); return errorResponse(res, 'not_found', 404); }
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      await t.rollback(); return errorResponse(res, 'forbidden', 403);
    }
    const rows = await round.roundRows(post.id, { transaction: t });
    if (!(await canManageRows(req.user, post, rows))) {
      await t.rollback(); return errorResponse(res, 'forbidden', 403);
    }
    const out = await round.closeRound({
      postId: post.id, businessId: post.business_id, userId: req.user.id,
      reason: req.body?.reason || null, transaction: t,
    });
    if (!out.ok) { await t.rollback(); return errorResponse(res, out.code, out.status); }
    await t.commit();

    const io = req.app.get('io');
    if (io) io.to(`business:${post.business_id}`).emit('inbox:refresh', { reason: 'signature_round_closed', entity_type: 'post', entity_id: post.id });
    // 거래 단계·직원 계약서 재계산 — 회차의 아무 행 하나로 문서를 가리킨다(훅은 문서 단위로 다시 센다)
    require('../services/signatureHooks').afterSignatureChange(out.ids[0]);
    return successResponse(res, { closed: true, superseded_ids: out.ids });
  } catch (err) {
    try { await t.rollback(); } catch { /* */ }
    next(err);
  }
});

module.exports = router;
