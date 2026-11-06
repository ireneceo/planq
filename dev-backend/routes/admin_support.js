// PlanQ 안내방 — 플랫폼 관리자 받은편지함(2026-11-04, docs/PLANQ_GUIDE_ROOM_DESIGN.md §2).
// ★ 관리자 화면은 이 라우터만 쓴다 — 워크스페이스 대화 라우트(/api/projects/conversations…)를 부르지 않는다.
//   주소는 워크스페이스 번호로 받는다: 그 워크스페이스의 안내방 하나만 열린다(다른 대화방 번호를 넣을 길이 없다).
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse, paginatedResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const supportRoom = require('../services/supportRoom');

router.use(authenticateToken, requireRole('platform_admin'));

// GET /api/admin/support/rooms?limit&offset
router.get('/support/rooms', async (req, res, next) => {
  try {
    const { rows, total, limit, offset } = await supportRoom.listRoomsForAdmin({ limit: req.query.limit, offset: req.query.offset });
    return paginatedResponse(res, rows, total, { limit, offset, page: Math.floor(offset / limit) + 1 });
  } catch (err) { next(err); }
});

// GET /api/admin/support/rooms/:businessId — 열기(없으면 만든다) · 최근 메시지 · 읽음 · 감사 support.admin_read
router.get('/support/rooms/:businessId', async (req, res, next) => {
  try {
    const biz = Number(req.params.businessId);
    if (!biz) return errorResponse(res, 'invalid_id', 400);
    const r = await supportRoom.openForAdmin(biz, req.user);
    if (!r) return errorResponse(res, 'business_not_found', 404);
    return successResponse(res, r);
  } catch (err) { next(err); }
});

// POST /api/admin/support/rooms/:businessId/messages { content, rule_key? } — PlanQ 팀 답(푸시) · 감사 support.admin_send
// audit-exempt: services/supportRoom.postStaffMessage 가 writeAudit(support.admin_send) 를 남긴다
router.post('/support/rooms/:businessId/messages', perUserLimiter('admin-support-send', { windowMs: 60 * 1000, max: 30, message: 'too_many' }), async (req, res, next) => {
  try {
    const biz = Number(req.params.businessId);
    if (!biz) return errorResponse(res, 'invalid_id', 400);
    // rule_key(선택) — 신규 고객 팔로업 «도울 일» 초안으로 쓴 글. 규칙표에 있는 키만(아니면 400). 막지 않고 «보냄» 표시용.
    const ruleKey = req.body && req.body.rule_key != null && req.body.rule_key !== '' ? String(req.body.rule_key) : null;
    if (ruleKey && !require('../services/followupRules').RULE_KEYS.includes(ruleKey)) return errorResponse(res, 'invalid_rule', 400);
    const r = await supportRoom.postStaffMessage({ businessId: biz, adminUser: req.user, content: req.body && req.body.content, io: req.app.get('io'), ruleKey });
    if (r.error === 'content_required') return errorResponse(res, 'content_required', 400);
    if (r.error) return errorResponse(res, r.error, 404);
    return successResponse(res, r, undefined, 201);
  } catch (err) { next(err); }
});

module.exports = router;
