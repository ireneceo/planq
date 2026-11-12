// routes/conversation_care.js — Q talk 고객 문의 «응대 상태 · 담당자» 바꾸기 (직원만).
//   설계 docs/QTALK_CARE_DESIGN.md (Fable DESIGN: READY). 읽기는 대화 목록·상세(routes/conversations.js)가 직원에게만 싣는다.
//   쓰기·검증·감사·방송·알림은 services/convCare.setCare 한 곳 — 여기는 판정 순서만.
//
// 판정 순서(설계): 방 없음·워크스페이스 다름 404 → 고객이거나 멤버 이상 아님 403 → 그 방을 못 봄 404
//   → 고객 방 아님 409 not_customer_room → 보관 방 409 conversation_archived → 값 틀림 400.
const express = require('express');
const router = express.Router();
const { Conversation } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, canAccessConversation, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const convCare = require('../services/convCare');
const { isArchived } = require('../services/conversationLifecycle');

// PUT /api/conversations/:businessId/:id/care  body { state?, assignee_user_id? } (하나 이상)
router.put('/:businessId/:id/care', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const conv = await Conversation.findOne({ where: { id: Number(req.params.id) || 0, business_id: businessId } });
    if (!conv) return errorResponse(res, 'Conversation not found', 404);
    if (req.scope?.isClient || !isMemberOrAbove(req.scope)) return errorResponse(res, 'forbidden', 403);
    if (!(await canAccessConversation(req.user.id, conv, req.scope))) return errorResponse(res, 'Conversation not found', 404);
    if (!convCare.isCareRoom(conv)) return errorResponse(res, 'not_customer_room', 409, 'not_customer_room');
    if (isArchived(conv)) return errorResponse(res, 'conversation_archived', 409, 'conversation_archived');

    const body = req.body || {};
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'state')) patch.state = body.state;
    if (Object.prototype.hasOwnProperty.call(body, 'assignee_user_id')) {
      const v = body.assignee_user_id;
      if (v === null) patch.assignee_user_id = null;
      else if (Number.isInteger(Number(v)) && Number(v) > 0) patch.assignee_user_id = Number(v);
      else return errorResponse(res, 'invalid_assignee', 400, 'invalid_assignee');
    }
    let care;
    try {
      care = await convCare.setCare(conv, { req, userId: req.user.id }, patch);
    } catch (e) {
      if (e instanceof convCare.CareError) return errorResponse(res, e.code, e.status, e.code);
      throw e;
    }
    const openTaskCount = await convCare.openTaskCount(conv, req.user.id, req.scope);
    return successResponse(res, {
      conversation_id: conv.id,
      state: care ? care.state : null,
      state_changed_at: care ? care.state_changed_at : null,
      assignee_user_id: care ? care.assignee_user_id : null,
      assignee: care ? care.assignee : null,
      open_task_count: openTaskCount,
    });
  } catch (err) { next(err); }
});

module.exports = router;
