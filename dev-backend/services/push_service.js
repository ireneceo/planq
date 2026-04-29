// Web Push 발송 서비스 — 사이클 J.
// VAPID 키는 .env 에 저장. 없으면 push 비활성 (백엔드 정상 기동).
const webpush = require('web-push');
const { PushSubscription } = require('../models');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@planq.kr';

let inited = false;
function ensureInit() {
  if (inited) return VAPID_PUBLIC ? true : false;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 미설정 — push 비활성');
    inited = true;
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  inited = true;
  return true;
}

function getPublicKey() {
  return VAPID_PUBLIC || null;
}

// payload 형식: { title, body, link?, tag?, icon? }
async function sendPushToUser(userId, payload) {
  if (!ensureInit()) return { sent: 0, skipped: 'no_vapid' };
  const subs = await PushSubscription.findAll({
    where: { user_id: userId, expired_at: null },
  });
  if (subs.length === 0) return { sent: 0, skipped: 'no_subs' };

  const json = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      }, json);
      await s.update({ last_used_at: new Date() });
      sent++;
    } catch (e) {
      // 410 Gone / 404 Not Found — 만료 표시
      if (e.statusCode === 410 || e.statusCode === 404) {
        await s.update({ expired_at: new Date() });
      } else {
        console.error('[push] sendNotification failed:', e.message);
      }
    }
  }
  return { sent, total: subs.length };
}

// 동시에 여러 user 에게 발송 (인박스 alert 등)
async function sendPushToUsers(userIds, payload) {
  const results = await Promise.all(userIds.map(u => sendPushToUser(u, payload)));
  return { totalSent: results.reduce((s, r) => s + (r.sent || 0), 0) };
}

module.exports = { sendPushToUser, sendPushToUsers, getPublicKey, ensureInit };
