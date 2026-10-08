// 플랫폼 관리자 알림 발송 헬퍼 — platform_admin role 사용자들에게 fan-out.
//
// 6 가지 event_kind 지원: inquiry / signup / payment / subscription / trial / feedback
// 각 이벤트마다 routes/inquiries.js, auth.js, services/billing.js 등에서 호출.
//
// 채널 정책:
//   - email: 즉시 발송 (notification_prefs business_id NULL + email 채널 isAllowed 체크)
//   - inbox·push: `notify()` 한 곳으로 보낸다 (business_id NULL = 플랫폼 알림 — 어느 워크스페이스 창에서든 종에 뜬다).
//     ★ 2026-10-08 — 여태 «미구현» 이었다. 그런데 관리자 알림 설정 화면(/admin/notifications)은 인박스·디바이스
//       토글을 보여 줘서 **받는 것처럼 보였고**, 입금 통보는 메일함에만 쌓였다(Irene: "입금확인해야 하는거 알림이 안떠").
//       메일은 위에서 따로 보내므로 notify 에는 skipChannels:['email'] — 안 그러면 두 통이 된다.
//   - client_crash 는 메일만 (설정 화면 설명과 같다 — 같은 오류가 몰려 종을 덮지 않게).
//
// notification_prefs row 가 없으면 default ON (열린 문화). 명시적 OFF 만 차단.

const { User } = require('../models');
const APP_URL = process.env.APP_URL || 'https://planq.kr';

const EMAIL_ONLY_KINDS = new Set(['client_crash']);

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
    if (!EMAIL_ONLY_KINDS.has(eventKind)) {
      const { notify } = notifications;
      await Promise.all(admins.map((adm) => notify({
        userId: adm.id,
        businessId: null,
        eventKind,
        title,
        body,
        link,
        ctaLabel,
        skipChannels: ['email'],
      }).catch((e) => console.warn('[platformNotify inapp]', eventKind, e.message))));
    }
    return { sent, skipped };
  } catch (e) {
    console.warn('[platformNotify]', eventKind, 'failed:', e.message);
    return { sent: 0, skipped: 0, error: e.message };
  }
}

module.exports = { notifyPlatformAdmins, APP_URL };
