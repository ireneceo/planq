// 플랫폼 관리자 알림 발송 헬퍼 — platform_admin role 사용자들에게 fan-out.
//
// 6 가지 event_kind 지원: inquiry / signup / payment / subscription / trial / feedback
// 각 이벤트마다 routes/inquiries.js, auth.js, services/billing.js 등에서 호출.
//
// 채널 정책:
//   - inbox: 미구현 (사이드바 알림 인박스가 platform-wide 아직 없음 — 별도 사이클)
//   - push: 미구현 (web push subscription 이 워크스페이스 단위라 platform-wide 별도)
//   - email: 즉시 발송 (notification_prefs business_id NULL + email 채널 isAllowed 체크)
//
// notification_prefs row 가 없으면 default ON (열린 문화). 명시적 OFF 만 차단.

const { User } = require('../models');
const APP_URL = process.env.APP_URL || 'https://planq.kr';

async function notifyPlatformAdmins({ eventKind, title, body, link, ctaLabel, relatedEntityId }) {
  try {
    const admins = await User.findAll({
      where: { platform_role: 'platform_admin', status: 'active' },
      attributes: ['id', 'name', 'email'],
    });
    if (!admins.length) return { sent: 0, skipped: 0 };

    const notifications = require('../routes/notifications');
    const emailService = require('./emailService');
    let sent = 0, skipped = 0;
    for (const adm of admins) {
      if (!adm.email) { skipped += 1; continue; }
      const allow = await notifications.isAllowed(adm.id, null, eventKind, 'email');
      if (!allow) { skipped += 1; continue; }
      await emailService.sendNotificationEmail({
        to: adm.email,
        title, body, link, ctaLabel,
        businessId: null,
        eventKind,
        recipientUserId: adm.id,
        relatedEntityId: relatedEntityId || null,
      }).catch(() => null);
      sent += 1;
    }
    return { sent, skipped };
  } catch (e) {
    console.warn('[platformNotify]', eventKind, 'failed:', e.message);
    return { sent: 0, skipped: 0, error: e.message };
  }
}

module.exports = { notifyPlatformAdmins, APP_URL };
