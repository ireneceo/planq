// 직접 정렬(사람별·보기별 업무 순서) 쓰기 라우트 — 얇은 HTTP 껍데기. 로직 정본은 services/taskUserOrder.js.
//   설계 docs/TASK_USER_ORDER_DESIGN.md (Fable 2026-10-12).
//   ★ mount 는 `/api/tasks` 체인 최상단(task_priority 옆) — 리터럴 `/my-order` 가 `/:id` 에 먹히지 않게.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { requestScope, staleResponse } = require('../middleware/workspaceContext');
const { moveTask, OrderError } = require('../services/taskUserOrder');

// PUT /api/tasks/my-order — body { business_id?, view: tag|project|due, task_id, before_id, after_id, visible_ids }
router.put('/my-order', authenticateToken, async (req, res, next) => { // audit-exempt: 개인 표시 선호(남의 데이터·업무 내용 불변, 드래그 빈도 높음) — whats_new 읽음·핀과 같은 계열
  try {
    const wsScope = requestScope(req, req.body.business_id);
    if (wsScope.stale) return staleResponse(res, wsScope);
    const businessId = Number(wsScope.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    // 고객(client) 배제 — 내 순서는 멤버의 업무 목록 도구다(task_priority.prepare 와 같은 모양).
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const r = await moveTask(req.user.id, businessId, req.user.platform_role, req.body);
    // 실시간 — 같은 사람의 다른 창(팝아웃·메인)만. business·project 방에는 보내지 않는다(남의 화면과 무관).
    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.id}`).emit('task:my-order', { business_id: businessId, view: r.view, positions: r.positions });
    return successResponse(res, r);
  } catch (err) {
    if (err instanceof OrderError) return errorResponse(res, err.code, err.status);
    next(err);
  }
});

module.exports = router;
