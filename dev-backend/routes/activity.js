// routes/activity.js — 워크스페이스 활동 타임라인 (owner/admin 전용, 읽기)
//   6개 원장(감사·업무·청구·프로젝트·bill·메시지)을 통합한 event_stream 을 노출한다.
//   읽기 전용 — 쓰기·부작용 0. 멤버/고객은 볼 수 없다(운영 뷰).
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getWorkspaceStream } = require('../services/event_stream');

// GET /api/activity/:businessId?since=&actor=&kinds=audit,task&limit=100
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const isOwnerAdmin = req.businessRole === 'owner'
      || req.businessRole === 'admin'
      || req.user.platform_role === 'platform_admin';
    if (!isOwnerAdmin) return errorResponse(res, 'owner_only', 403);

    const businessId = parseInt(req.params.businessId, 10);
    const { since, actor, kinds, limit } = req.query;
    const events = await getWorkspaceStream(businessId, {
      since: since || null,
      actor: actor ? parseInt(actor, 10) : null,
      kinds: kinds ? String(kinds).split(',').map((s) => s.trim()).filter(Boolean) : null,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return successResponse(res, events);
  } catch (e) { next(e); }
});

module.exports = router;
