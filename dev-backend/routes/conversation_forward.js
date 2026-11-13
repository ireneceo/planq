// routes/conversation_forward.js — Q talk 메시지를 다른 대화방으로 «전달» (docs/QTALK_FORWARD_DESIGN.md §3).
//   POST /api/conversations/:businessId/:id/forward   (:id = 원본 방)
//   본문 { message_ids: number[1..20], target_conversation_id } → 201 { target_conversation_id, messages }
//   판정·쓰기는 services/messageForward 한 곳 — 여기는 문만 연다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');

const forwardLimiter = perUserLimiter('msg-forward', { windowMs: 60 * 1000, max: 10, message: '전달이 너무 잦습니다. 잠시 후 다시 시도하세요.' });

router.post('/:businessId/:id/forward', authenticateToken, attachWorkspaceScope(), forwardLimiter, async (req, res, next) => {
  try {
    const { forwardMessages, ForwardError } = require('../services/messageForward');
    try {
      const { data, audit } = await forwardMessages(req);
      require('../services/auditService').logAudit(req, audit);   // message.forward — 원본 방·메시지 id 는 여기에만 남는다
      return successResponse(res, data, 'Forwarded', 201);
    } catch (e) {
      if (e instanceof ForwardError) return errorResponse(res, e.code, e.status, e.code);
      throw e;
    }
  } catch (err) { next(err); }
});

module.exports = router;
