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
const { sendApns } = require('./apns_sender');
const { sendFcm } = require('./fcm_sender');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@planq.kr';

// 도착률 옵션 — 전송 시점에 매 호출 적용
const DEFAULT_TTL_SECONDS = 86400;   // 1일
const DEFAULT_URGENCY = 'high';      // immediate delivery

// Declarative Web Push (Safari 18.4+ / iOS 18.4·iOS 26) — navigate 는 절대 URL 필수.
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
function toAbsoluteUrl(link) {
  if (!link) return APP_URL.replace(/\/$/, '') + '/';
  if (/^https?:\/\//i.test(link)) return link;
  return APP_URL.replace(/\/$/, '') + (link.startsWith('/') ? link : '/' + link);
}

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

// payload 형식: { title, body, link?, tag?, icon?, badge? }
// opts: { category?: string }
// 한 user 의 web push + 네이티브(APNs/FCM) 구독 모두에게 kind 별 발송 (fan-out).
//   notify()/트리거/prefs/badge 계산은 무변경 — 이 함수의 말단만 kind 별로 갈라짐.
async function sendPushToUser(userId, payload, opts = {}) {
  const category = opts.category || null;
  const subs = await PushSubscription.findAll({
    where: { user_id: userId, expired_at: null },
  });
  if (subs.length === 0) {
    await logPush({ user_id: userId, status: 'skipped', error_message: 'no_subs', category, payload_title: payload.title });
    return { sent: 0, skipped: 'no_subs' };
  }

  // ★ 2026-06-15 declarative 형식 revert — web_push:8030 payload 를 구버전 iOS 가
  //   시스템 레벨에서 가로채 버리고 SW 도 안 깨워 구버전까지 미표시되는 회귀 발생.
  //   검증된 classic 형식({title,body,link,tag,icon,badge})으로 복귀. sw.js 는 raw 직접 읽음.
  const json = JSON.stringify(payload);
  // RFC 8030 옵션 — 모바일 도착률 안정성 (사이클 N+13)
  const sendOpts = { TTL: DEFAULT_TTL_SECONDS, urgency: DEFAULT_URGENCY };
  let sent = 0;
  for (const s of subs) {
    try {
      // ── 네이티브 APNs (iOS) ──
      if (s.kind === 'apns') {
        const r = await sendApns(s.device_token, payload);
        if (r.reason === 'no_apns_key') {
          // APNs 키 미설정 — web push 의 no_vapid 와 동일 패턴. 실패로 카운트하지 않음.
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'apns', status: 'skipped', error_message: 'no_apns_key', category, payload_title: payload.title });
        } else if (r.status === 410) {
          // Unregistered — 죽은 토큰 즉시 삭제 (web push 410 정리와 동일)
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'apns', status: 'expired', status_code: 410, category, payload_title: payload.title });
          await s.destroy();
        } else if (r.ok) {
          await s.update({ last_used_at: new Date() });
          sent++;
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'apns', status: 'sent', status_code: 200, category, payload_title: payload.title });
        } else {
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'apns', status: 'failed', status_code: r.status || null, error_message: String(r.reason || '').slice(0, 500), category, payload_title: payload.title });
          maybeAlertOnFailure(userId).catch(() => null);
        }
        continue;
      }
      // ── 네이티브 FCM (Android) ──
      if (s.kind === 'fcm') {
        const r = await sendFcm(s.device_token, payload);
        if (r.reason === 'no_fcm_key') {
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'fcm', status: 'skipped', error_message: 'no_fcm_key', category, payload_title: payload.title });
        } else if (r.status === 404 || r.reason === 'unregistered') {
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'fcm', status: 'expired', status_code: 404, category, payload_title: payload.title });
          await s.destroy();
        } else if (r.ok) {
          await s.update({ last_used_at: new Date() });
          sent++;
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'fcm', status: 'sent', status_code: 200, category, payload_title: payload.title });
        } else {
          await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: 'fcm', status: 'failed', status_code: r.status || null, error_message: String(r.reason || '').slice(0, 500), category, payload_title: payload.title });
          maybeAlertOnFailure(userId).catch(() => null);
        }
        continue;
      }
      // ── Web Push (브라우저/PWA — 기존 로직 무변경) ──
      // VAPID 게이트는 여기(webpush 분기)로 이동 — VAPID 미설정이어도 APNs 발송은 가능해야 함.
      if (!ensureInit()) {
        await logPush({ user_id: userId, subscription_id: s.id, endpoint_host: endpointHost(s.endpoint), status: 'skipped', error_message: 'no_vapid', category, payload_title: payload.title });
        continue;
      }
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
