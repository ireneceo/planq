// 알림 prefs 라우트 (Phase E4)
// GET /api/notifications/prefs — 내 워크스페이스의 prefs 매트릭스 (없으면 기본 ON)
// PUT /api/notifications/prefs — 매트릭스 업데이트 (off 만 row 생성)
// 알림 발송 시점에 isAllowed(userId, businessId, eventKind, channel) 로 차단 검사

const express = require('express');
const router = express.Router();
const { NotificationPref } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const EVENT_KINDS = ['signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'mention'];
const CHANNELS = ['inbox', 'chat', 'email'];

// GET /api/notifications/prefs?business_id=X
router.get('/prefs', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    const where = { user_id: req.user.id };
    if (businessId) where.business_id = businessId;
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
module.exports = router;
module.exports.isAllowed = isAllowed;
