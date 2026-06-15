// Web Push 발송 서비스 — 사이클 J + N+3 + N+12 + N+13 보완.
// 모든 발송 시도는 PushLog 에 기록 (운영 가시성·실패율·abuse 추적).
// VAPID 키는 .env 에 저장. 없으면 push 비활성 (백엔드 정상 기동).
//
// 운영 가시성 (사이클 N+12 보완):
//   - 동일 user 5분 윈도우 3회 이상 failed → platform_admin email 알림 (1시간 throttle).
//   - 박제: feedback_external_dispatch_validation.md
//
// 도착률 강화 (사이클 N+13):
//   - urgency 'high' — 즉시 전달 (iOS Safari / Chrome 모두 적용)
//   - TTL 86400 (1일) — push service 큐잉 시간. 1일 지난 stale 알림은 silent drop.
//   - topic = tag — 같은 conv/task 의 연속 알림 collapse (모바일 잠금화면 정리)
const webpush = require('web-push');
const { Op } = require('sequelize');
const { PushSubscription, PushLog } = require('../models');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@planq.kr';

// 도착률 옵션 — 전송 시점에 매 호출 적용
const DEFAULT_TTL_SECONDS = 86400;   // 1일
const DEFAULT_URGENCY = 'high';      // immediate delivery

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

function endpointHost(endpoint) {
  try { return new URL(endpoint).hostname.slice(0, 120); } catch { return null; }
}

async function logPush(payload) {
  // best-effort — 발송 흐름이 log 실패로 깨지지 않게
  try { await PushLog.create(payload); } catch (e) { console.error('[push] log failed:', e.message); }
}

// 실패 알림 throttle — 같은 user 에 대해 1시간 내 한 번만 platform_admin 에게 notify.
// memory 캐시 (단일 process). pm2 cluster 환경에선 process 별 throttle 이지만 spam 충분히 억제.
const FAILURE_ALERT_TTL_MS = 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 3;
const failureAlertCache = new Map();

async function maybeAlertOnFailure(userId) {
  if (!userId) return;
  try {
    const lastAlert = failureAlertCache.get(userId) || 0;
    if (Date.now() - lastAlert < FAILURE_ALERT_TTL_MS) return;
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const count = await PushLog.count({
      where: { user_id: userId, status: 'failed', createdAt: { [Op.gte]: since } },
    });
    if (count < FAILURE_THRESHOLD) return;
    failureAlertCache.set(userId, Date.now());
    // platform_admin email 만 발송 (push 발송 자체가 실패 중인 상황이라 push 채널 사용 불가)
    const { notifyPlatformAdmins } = require('./platformNotify');
    await notifyPlatformAdmins({
      eventKind: 'feedback',
      title: `Push 발송 실패 누적 — user ${userId}`,
      body: `최근 5분 내 ${count}회 발송 실패. PushLog 의 status='failed' rows 확인 필요. 가능 원인: subscription expired (410/404) / VAPID 키 mismatch / 좀비 p256dh.`,
      link: `/admin/users`,
      ctaLabel: 'Admin Users',
      relatedEntityId: userId,
    });
  } catch (e) {
    console.warn('[push] failure alert dispatch error:', e.message);
  }
}

// payload 형식: { title, body, link?, tag?, icon? }
// opts: { category?: string }
async function sendPushToUser(userId, payload, opts = {}) {
  const category = opts.category || null;
  if (!ensureInit()) {
    await logPush({ user_id: userId, status: 'skipped', error_message: 'no_vapid', category, payload_title: payload.title });
    return { sent: 0, skipped: 'no_vapid' };
  }
  const subs = await PushSubscription.findAll({
    where: { user_id: userId, expired_at: null },
  });
  if (subs.length === 0) {
    await logPush({ user_id: userId, status: 'skipped', error_message: 'no_subs', category, payload_title: payload.title });
    return { sent: 0, skipped: 'no_subs' };
  }

  const json = JSON.stringify(payload);
  // RFC 8030 옵션 — 모바일 도착률 안정성 (사이클 N+13)
  // TTL: 1일. urgency: 'high' — push service 가 즉시 전달 시도.
  // topic 은 의도적으로 비활성 — 짧은 시간 다건 메시지가 collapse 되지 않게.
  const sendOpts = { TTL: DEFAULT_TTL_SECONDS, urgency: DEFAULT_URGENCY };
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      }, json, sendOpts);
      await s.update({ last_used_at: new Date() });
      sent++;
      await logPush({
        user_id: userId, subscription_id: s.id, endpoint_host: endpointHost(s.endpoint),
        status: 'sent', status_code: 201, category, payload_title: payload.title,
      });
    } catch (e) {
      const code = e.statusCode || null;
      // 410 Gone / 404 Not Found — 죽은 endpoint 즉시 DB 삭제 (RFC 8030 정석, 좀비 row 누적 차단)
      if (code === 410 || code === 404) {
        await logPush({
          user_id: userId, subscription_id: s.id, endpoint_host: endpointHost(s.endpoint),
          status: 'expired', status_code: code, category, payload_title: payload.title,
        });
        await s.destroy();
      } else {
        console.error('[push] sendNotification failed:', e.message);
        await logPush({
          user_id: userId, subscription_id: s.id, endpoint_host: endpointHost(s.endpoint),
          status: 'failed', status_code: code, error_message: String(e.message || '').slice(0, 500),
          category, payload_title: payload.title,
        });
        // 5분 윈도우 3회 이상 실패 시 platform_admin 알림 (1시간 throttle)
        maybeAlertOnFailure(userId).catch(() => null);
      }
    }
  }
  return { sent, total: subs.length };
}

// 동시에 여러 user 에게 발송 (인박스 alert 등)
async function sendPushToUsers(userIds, payload, opts = {}) {
  const results = await Promise.all(userIds.map(u => sendPushToUser(u, payload, opts)));
  return { totalSent: results.reduce((s, r) => s + (r.sent || 0), 0) };
}

module.exports = { sendPushToUser, sendPushToUsers, getPublicKey, ensureInit };
