// 알림 prefs 라우트 (Phase E4)
// GET /api/notifications/prefs — 내 워크스페이스의 prefs 매트릭스 (없으면 기본 ON)
// PUT /api/notifications/prefs — 매트릭스 업데이트 (off 만 row 생성)
// 알림 발송 시점에 isAllowed(userId, businessId, eventKind, channel) 로 차단 검사

const express = require('express');
const router = express.Router();
const { NotificationPref } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const EVENT_KINDS = [
  // 워크스페이스 멤버 알림
  'signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'mention',
  // 플랫폼 관리자 알림 (business_id NULL row 로 저장)
  'inquiry', 'signup', 'payment', 'subscription', 'trial', 'feedback',
];
const CHANNELS = ['inbox', 'chat', 'email', 'push']; // 사이클 J4 — push 채널 추가

// GET /api/notifications/prefs?business_id=X
router.get('/prefs', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    // business_id 미지정 = 전역(platform-wide, NULL row 만) — 사용자 cross-workspace 매트릭스 mix 방지
    const where = { user_id: req.user.id, business_id: businessId };
    const rows = await NotificationPref.findAll({ where });
    // 매트릭스 형태로 변환 — 기본 ON, 명시적 row 만 반영
    const matrix = {};
    for (const ev of EVENT_KINDS) {
      matrix[ev] = {};
      for (const ch of CHANNELS) matrix[ev][ch] = true; // 기본 ON
    }
    for (const r of rows) {
      if (matrix[r.event_kind]) matrix[r.event_kind][r.channel] = r.enabled;
    }
    return successResponse(res, { matrix, business_id: businessId });
  } catch (err) { next(err); }
});

// PUT /api/notifications/prefs — body: { business_id?, event_kind, channel, enabled }
router.put('/prefs', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body?.business_id ? Number(req.body.business_id) : null;
    const eventKind = String(req.body?.event_kind || '');
    const channel = String(req.body?.channel || '');
    const enabled = !!req.body?.enabled;
    if (!EVENT_KINDS.includes(eventKind)) return errorResponse(res, 'invalid_event_kind', 400);
    if (!CHANNELS.includes(channel)) return errorResponse(res, 'invalid_channel', 400);

    const [row] = await NotificationPref.findOrCreate({
      where: {
        user_id: req.user.id,
        business_id: businessId,
        event_kind: eventKind,
        channel,
      },
      defaults: { enabled },
    });
    if (row.enabled !== enabled) await row.update({ enabled });
    return successResponse(res, { event_kind: eventKind, channel, enabled, business_id: businessId });
  } catch (err) { next(err); }
});

// 알림 발송 시점 helper — false 면 차단 (다른 모듈에서 require 시 export)
async function isAllowed(userId, businessId, eventKind, channel) {
  try {
    const row = await NotificationPref.findOne({
      where: {
        user_id: userId,
        business_id: businessId || null,
        event_kind: eventKind,
        channel,
      },
    });
    if (!row) return true; // 기본 ON
    return !!row.enabled;
  } catch { return true; }
}

router.isAllowed = isAllowed;

// 사이클 J4 — 통합 알림 헬퍼
//   notify({ userId, businessId, eventKind, title, body, link, ctaLabel, workspaceName })
//     - inbox: TodoList 가 별도 fetch (별도 처리 X)
//     - email: isAllowed('email') 통과 시 sendNotificationEmail
//     - push:  isAllowed('push')  통과 시 web push
//
// 외부 client (NotificationPref 가 없는 사람) 메일 발송은 매트릭스와 무관 —
//   전용 helper (sendInvoiceEmail / sendSignatureRequestEmail / sendPostShareEmail) 사용.
//
// 시스템 메일 (인증 OTP, 비밀번호 재설정) 도 매트릭스 무관 —
//   전용 helper (sendVerificationCodeEmail / sendSignatureOtpEmail) 사용.
async function notify({ userId, businessId, eventKind, title, body, link, ctaLabel, workspaceName, tag }) {
  if (!userId || !eventKind) return { inbox: false, email: false, push: false };
  const results = { inbox: true, email: false, push: false };

  // email 채널
  if (await isAllowed(userId, businessId, eventKind, 'email')) {
    try {
      const { User } = require('../models');
      const user = await User.findByPk(userId, { attributes: ['email'] });
      if (user?.email) {
        const { sendNotificationEmail } = require('../services/emailService');
        results.email = await sendNotificationEmail({
          to: user.email,
          title, body, link, ctaLabel, workspaceName,
          businessId, eventKind, recipientUserId: userId,
        });
      }
    } catch (e) {
      console.error('[notify email]', e.message);
    }
  }

  // push 채널 — tag 로 OS 알림 그룹핑 (같은 대화방 연속 메시지는 마지막 것으로 대체)
  if (await isAllowed(userId, businessId, eventKind, 'push')) {
    try {
      const { sendPushToUser } = require('../services/push_service');
      // badge — 사용자의 현재 Q Talk unread total. SW 가 정확한 dock 아이콘 숫자 표시용.
      // 발송 직전 +1 (이번 알림이 unread 으로 추가될 거라 가정 — message/mention 류).
      // 실패해도 push 는 발송 (badge 는 활성 클라이언트가 정확하게 덮어씀).
      let badge;
      try {
        if (businessId) {
          const { sequelize } = require('../config/database');
          const [rows] = await sequelize.query(
            `SELECT COUNT(m.id) AS cnt
               FROM messages m
               LEFT JOIN conversation_participants cp
                 ON cp.conversation_id = m.conversation_id AND cp.user_id = :uid
              INNER JOIN conversations c ON c.id = m.conversation_id AND c.business_id = :bid
              WHERE m.sender_id != :uid
                AND (m.is_deleted IS NULL OR m.is_deleted = 0)
                AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
            { replacements: { uid: userId, bid: businessId } }
          );
          // 이번 알림은 message 류면 이미 DB 에 INSERT 된 상태라 cnt 에 포함됨
          badge = Number(rows[0]?.cnt || 0);
        }
      } catch { /* badge 계산 실패해도 push 자체는 보냄 */ }
      const r = await sendPushToUser(userId, {
        title: title || 'PlanQ',
        body: body || '',
        link: link || '/',
        tag: tag || `${eventKind}:${userId}`,
        ...(badge !== undefined ? { badge } : {}),
      });
      results.push = r;
    } catch (e) {
      console.error('[notify push]', e.message);
    }
  }
  return results;
}

// 멀티 수신자용 (워크스페이스 멤버 N 명에게 한 번에)
async function notifyMany({ userIds, businessId, eventKind, title, body, link, ctaLabel, workspaceName, excludeUserId, tag }) {
  const filtered = (userIds || []).filter((id) => id && id !== excludeUserId);
  const results = await Promise.all(
    filtered.map((uid) => notify({ userId: uid, businessId, eventKind, title, body, link, ctaLabel, workspaceName, tag }))
  );
  return results;
}

module.exports = router;
module.exports.isAllowed = isAllowed;
module.exports.notify = notify;
module.exports.notifyMany = notifyMany;
