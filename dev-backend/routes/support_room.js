// PlanQ 안내방 — 워크스페이스 쪽(2026-11-04, docs/PLANQ_GUIDE_ROOM_DESIGN.md §1).
// 메시지 읽기·쓰기는 Q talk 의 보통 대화 라우트를 그대로 쓴다(참여자만 — access_scope 사적 방 줄).
// 여기는 «방 찾기 · 들어가기 · PlanQ 팀에게 묻기» 세 가지뿐. 워크스페이스 사람 멤버만(고객·게스트·비멤버 403).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const supportRoom = require('../services/supportRoom');

router.use(authenticateToken);

const bizOf = (req) => Number(req.query.business_id || (req.body && req.body.business_id)) || null;

// GET /api/support-room?business_id= → { conversation_id, joined, can_join, human_requested }
router.get('/', async (req, res, next) => {
  try {
    const biz = bizOf(req);
    if (!biz) return errorResponse(res, 'business_id_required', 400);
    const r = await supportRoom.roomForMember(biz, req.user.id, req.app.get('io'));
    if (!r) return errorResponse(res, 'forbidden', 403);
    return successResponse(res, r);
  } catch (err) { next(err); }
});

// audit-exempt: 자기 자신을 이 방 참여자로 넣는 것뿐(다른 사람 권한 변화 없음)
router.post('/join', async (req, res, next) => {
  try {
    const biz = bizOf(req);
    if (!biz) return errorResponse(res, 'business_id_required', 400);
    const r = await supportRoom.join(biz, req.user.id, req.app.get('io'));
    if (!r) return errorResponse(res, 'forbidden', 403);
    return successResponse(res, r);
  } catch (err) { next(err); }
});

// audit-exempt: 안내방 상태 표시(human_requested_at)만 바꾼다 — 방에 남는 안내 줄이 기록이다
router.post('/human', perUserLimiter('support-human', { windowMs: 60 * 1000, max: 3, message: 'too_many' }), async (req, res, next) => {
  try {
    const biz = bizOf(req);
    if (!biz) return errorResponse(res, 'business_id_required', 400);
    const r = await supportRoom.requestHuman(biz, req.user.id, req.app.get('io'));
    if (!r) return errorResponse(res, 'forbidden', 403);
    return successResponse(res, r);
  } catch (err) { next(err); }
});

module.exports = router;
