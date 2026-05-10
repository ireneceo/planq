// Web Push 라우트 — 사이클 J + 사이클 N+3 보완 (외부 점검 반영).
//
// frontend 흐름:
//   1) GET /api/push/vapid-public-key  — VAPID 공개키 가져오기
//   2) navigator.serviceWorker.register('/sw.js')
//   3) PushManager.subscribe({ applicationServerKey: vapidPublicKey })
//   4) POST /api/push/subscribe (endpoint, p256dh, auth, user_agent)
//   5) 알림 도착하면 sw.js 가 showNotification
//
// 사이클 N+3 보완:
//  - /test 엔드포인트 per-user rate-limit (분당 5회) — push quota 폭주 방어
//  - subscribe endpoint URL 화이트리스트 (https + 알려진 push service 도메인만 허용)
//  - 같은 endpoint 가 다른 user 로 재등록될 때 옛 row 를 명시적으로 expired 마크 후 신규 row 생성
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { PushSubscription } = require('../models');
const { getPublicKey, sendPushToUser } = require('../services/push_service');

// 외부 점검 반영 — 알려진 push service 도메인 화이트리스트
// (Chromium / FCM / Mozilla / Apple / Microsoft Edge)
const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'wns2-by3p.notify.windows.com', '*.notify.windows.com',
];
function isAllowedEndpoint(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_PUSH_HOSTS.some(h => {
      if (h.startsWith('*.')) return host.endsWith(h.slice(1));
      return host === h;
    });
  } catch {
    return false;
  }
}

// /test 만 별도 limiter — 본인 디바이스 폭주 발송 방어. 분당 5회.
//   keyGenerator: 인증된 user.id 기준 (IP 기준 X — NAT 뒤 여러 사용자 차단 방지)
const testPushLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id ? `push-test-u${req.user.id}` : `push-test-ip${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'push test 너무 자주 호출했습니다. 1분 후 다시 시도하세요.' },
});

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
    // 화이트리스트 검증 — 임의 URL DB 저장 차단
    if (!isAllowedEndpoint(endpoint)) {
      return errorResponse(res, 'invalid_endpoint_host', 400);
    }
    // 같은 endpoint 가 이미 있으면:
    //   - 같은 user → 갱신 (디바이스 같은 사람, 토큰 갱신)
    //   - 다른 user → 옛 row 명시적 expired 마크 후 신규 row 생성 (디바이스 양도/공용 PC 시나리오)
    const existing = await PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      if (existing.user_id === req.user.id) {
        await existing.update({
          business_id: req.user.active_business_id || existing.business_id || null,
          p256dh: keys.p256dh, auth: keys.auth,
          user_agent: user_agent || existing.user_agent,
          expired_at: null, last_used_at: new Date(),
        });
        return successResponse(res, { id: existing.id, updated: true });
      }
      // 다른 user — 옛 row 는 expired 마크 (감사 기록 보존). PushSubscription endpoint unique 라
      // 옛 row 의 endpoint 를 unique 해소 위해 prefix 변경.
      await existing.update({
        endpoint: `expired:${existing.id}:${existing.endpoint}`.slice(0, 500),
        expired_at: new Date(),
      });
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

// 본인에게 테스트 push — rate-limit (분당 5회 per-user)
router.post('/test', authenticateToken, testPushLimiter, async (req, res, next) => {
  try {
    const result = await sendPushToUser(req.user.id, {
      title: 'PlanQ 알림 테스트',
      body: '구독이 정상 작동합니다.',
      link: '/inbox',
    }, { category: 'test' });
    return successResponse(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
