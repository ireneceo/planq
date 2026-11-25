// routes/profile_cards.js — 채팅 «고객 정보·멤버 정보» 카드. 설계 docs/CHAT_PROFILE_CARDS_DESIGN.md (Fable 2026-11-25)
//
//   GET  /api/businesses/:businessId/conversations/:convId/profile-card-room  — 이 방에 보낼 수 있나(«+» 항목 비활성 + 이유)
//   POST /api/businesses/:businessId/profile-card-messages {conversation_id, type:'client'|'member', target_id}
//   GET  /api/businesses/:businessId/profile-cards/:type/:id                  — 보는 사람 기준 요약(카드 본문)
//   ★ 판정은 services/profileCard 한 곳. 메시지에는 card_type·id 만(이름·연락처 0). 쓰는 문은 chatPost.postCardMessage 하나.
//   ★ 고르기 목록 API 는 만들지 않는다 — 고객은 Q sale 목록, 멤버는 /members(같은 권한 사슬).
//   ★ AI 에이전트 쓰기 표면(services/agent/registry.js)에 넣지 않는다.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const pc = require('../services/profileCard');

const TYPES = ['client', 'member'];
// 정수 id 만 — 배열([2614])·소수·객체가 Number() 로 풀려 통과하지 않게(Fable 비차단 지적)
const intId = (v) => ((typeof v === 'number' && Number.isInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v)) ? Number(v) : 0);
// platformroom-exempt: 방을 세지 않고 id 로 한 방만 읽는다 — PlanQ 안내방은 services/profileCard.roomRejectReason 허용 목록(internal·group)이 거절한다

async function loadConv(bizId, convId) {
  const { Conversation } = require('../models');
  return Conversation.findOne({ where: { id: Number(convId) || 0, business_id: bizId } });
}

async function canUseConv(req, bizId, conv) {
  const { canAccessConversation, getUserScope } = require('../middleware/access_scope');
  const scope = await getUserScope(req.user.id, bizId, req.user.platform_role);
  return canAccessConversation(req.user.id, conv, scope);
}

function isStaffReq(req) {
  return ['owner', 'admin', 'member'].includes(req.businessRole) || req.user.platform_role === 'platform_admin';
}

router.get('/:businessId/conversations/:convId/profile-card-room', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    if (!isStaffReq(req)) return errorResponse(res, 'forbidden', 403);
    const conv = await loadConv(bizId, req.params.convId);
    if (!conv || !(await canUseConv(req, bizId, conv))) return errorResponse(res, 'not_found', 404);
    const reason = await pc.roomRejectReason(conv);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, {
      allowed: !reason,
      reason,
      can_send_client: !reason && (await pc.canReadClientCards(bizId, req.user)),
    });
  } catch (e) { return next(e); }
});

router.post('/:businessId/profile-card-messages', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    if (!isStaffReq(req)) return errorResponse(res, 'forbidden', 403);
    const body = req.body || {};
    const type = String(body.type || '');
    if (!TYPES.includes(type)) return errorResponse(res, 'invalid_type', 400);
    const conv = intId(body.conversation_id) ? await loadConv(bizId, intId(body.conversation_id)) : null;
    if (!conv) return errorResponse(res, 'invalid_conversation_id', 400);
    if (!(await canUseConv(req, bizId, conv))) return errorResponse(res, 'forbidden', 403);
    const roomWhy = await pc.roomRejectReason(conv);
    if (roomWhy) return errorResponse(res, roomWhy, 400);
    // 보내기 = 읽기와 같은 술어(고객 카드는 Q sale 읽기)
    if (type === 'client' && !(await pc.canReadClientCards(bizId, req.user))) return errorResponse(res, 'forbidden', 403);
    const targetWhy = await pc.targetRejectReason(bizId, type, intId(body.target_id));
    if (targetWhy === 'not_found') return errorResponse(res, 'not_found', 404);
    if (targetWhy) return errorResponse(res, targetWhy, 400);

    const targetId = intId(body.target_id);
    const cardType = pc.CARD_TYPES[type];
    // 본문은 이름 없는 고정 문구(알림·미리보기·검색·Cue 로 이름이 나가지 않게). 화면은 card 로 그린다.
    const content = type === 'client' ? '[고객 정보]' : '[멤버 정보]';
    const meta = type === 'client' ? { card_type: cardType, client_id: targetId } : { card_type: cardType, user_id: targetId };
    const msg = await require('../services/chatPost').postCardMessage({
      conv, senderId: req.user.id, io: req.app.get('io'), content, meta,
    });
    require('../services/auditService').logAudit(req, {
      action: 'profile_card.sent_to_chat', targetType: 'conversation', targetId: conv.id, businessId: bizId,
      newValue: { card_type: cardType, target_id: targetId, message_id: msg.id },
    });
    return successResponse(res, { message_id: msg.id }, 'sent', 201);
  } catch (e) { return next(e); }
});

router.get('/:businessId/profile-cards/:type/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    res.set('Cache-Control', 'no-store');
    if (!isStaffReq(req)) return errorResponse(res, 'forbidden', 403);
    const type = String(req.params.type);
    if (!TYPES.includes(type) || !/^\d+$/.test(String(req.params.id))) return errorResponse(res, 'not_found', 404);
    const r = await pc.resolveForViewer(bizId, req.user, type, Number(req.params.id));
    return successResponse(res, { type, state: r.state, view: r.view });
  } catch (e) { return next(e); }
});

module.exports = router;
