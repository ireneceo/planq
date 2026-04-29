// Web Push 라우트 — 사이클 J.
// frontend 흐름:
//   1) GET /api/push/vapid-public-key  — VAPID 공개키 가져오기
//   2) navigator.serviceWorker.register('/sw.js')
//   3) PushManager.subscribe({ applicationServerKey: vapidPublicKey })
//   4) POST /api/push/subscribe (endpoint, p256dh, auth, user_agent)
//   5) 알림 도착하면 sw.js 가 showNotification
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { PushSubscription } = require('../models');
const { getPublicKey, sendPushToUser } = require('../services/push_service');

// 공개 — 인증 X (구독 시작 시점에는 user 토큰 있지만 publicKey 자체는 비밀 X)
router.get('/vapid-public-key', (req, res) => {
  const k = getPublicKey();
  if (!k) return errorResponse(res, 'push_disabled_no_vapid', 503);
  return successResponse(res, { publicKey: k });
});

// 구독 등록
router.post('/subscribe', authenticateToken, async (req, res, next) => {
  try {
    const { endpoint, keys, user_agent } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return errorResponse(res, 'invalid_subscription', 400);
    }
    // 같은 endpoint 가 이미 있으면 갱신 (사용자 변경 가능 — 디바이스 다른 사람에게 양도 케이스)
    const existing = await PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      await existing.update({
        user_id: req.user.id,
        business_id: req.user.active_business_id || existing.business_id || null,
        p256dh: keys.p256dh, auth: keys.auth,
        user_agent: user_agent || existing.user_agent,
        expired_at: null, last_used_at: new Date(),
      });
      return successResponse(res, { id: existing.id, updated: true });
    }
    const row = await PushSubscription.create({
      user_id: req.user.id,
      business_id: req.user.active_business_id || null,
      endpoint,
      p256dh: keys.p256dh, auth: keys.auth,
      user_agent: user_agent || null,
      last_used_at: new Date(),
    });
    return successResponse(res, { id: row.id, created: true }, 'subscribed', 201);
  } catch (e) { next(e); }
});

// 구독 해지 — endpoint 기준 (현재 디바이스만)
router.delete('/subscribe', authenticateToken, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return errorResponse(res, 'endpoint_required', 400);
    const row = await PushSubscription.findOne({ where: { endpoint, user_id: req.user.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    await row.destroy();
    return successResponse(res, { deleted: true });
  } catch (e) { next(e); }
});

// 본인에게 테스트 push
router.post('/test', authenticateToken, async (req, res, next) => {
  try {
    const result = await sendPushToUser(req.user.id, {
      title: 'PlanQ 알림 테스트',
      body: '구독이 정상 작동합니다.',
      link: '/inbox',
    });
    return successResponse(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
