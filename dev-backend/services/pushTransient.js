// services/pushTransient.js — 푸시 발송 실패가 **일시적인가**의 단일 판정.
//
// 왜 이 모듈이 있는가 (2026-08-29 실측)
//   APNs·FCM·Web Push 세 경로가 각자 재시도 규칙을 가지고 있었는데, 셋 다 **인증 실패에만**
//   재시도를 걸어 뒀다(APNs 403 InvalidProviderToken · FCM 401). 그래서 네트워크 계층 오류는
//   그대로 영구 실패로 처리되고 **그 알림은 영영 사라졌다.**
//   운영 최근 7일 네이티브 34건 중 2건이 `ECONNRESET` 으로 유실됐다(약 6%).
//
//   ECONNRESET 이 나는 이유: APNs 는 유휴 HTTP/2 세션을 끊는다. 우리는 연결을 재사용하므로
//   (apns_sender.js `_getClient`) 이미 반쯤 죽은 세션으로 요청이 나가는 창이 있다.
//   그래서 재시도할 때는 **캐시된 연결을 버리고** 새 세션으로 보내야 한다 — 같은 죽은 세션으로
//   다시 쏘면 두 번 실패할 뿐이다.
//
// 규칙 (Apple·Google 문서 정합)
//   · 5xx        → 일시적. 양쪽 다 재시도를 권고한다.
//   · 4xx        → 영구. 410 Unregistered · 400 BadDeviceToken 등은 재시도해도 같은 답이다.
//   · status 0   → 네트워크 계층. 아래 사유 집합으로 판정한다.
//
// ★ 재시도는 **1회만**. 푸시는 사용자 알림이라 늦게 두 번 오는 것보다 한 번 늦는 게 낫고,
//   무한 재시도는 외부 quota 를 태운다(CLAUDE.md 운영 안정성 규칙 1).

const TRANSIENT_REASONS = new Set([
  // 우리 코드가 만드는 합성 사유 (apns_sender / fcm_sender)
  'timeout', 'connect_error', 'request_error', 'req_error',
  // Node 네트워크 오류 코드
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_SOCKET_CONNECTION_TIMEOUT',
  // Node HTTP/2 세션 오류 (APNs 연결 재사용 중 끊김)
  'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_INVALID_SESSION', 'ERR_HTTP2_STREAM_CANCEL',
  'ERR_HTTP2_STREAM_ERROR', 'ERR_HTTP2_SESSION_ERROR',
  // 서비스측 일시 장애 문자열
  'UNAVAILABLE', 'INTERNAL',                      // FCM
  'InternalServerError', 'ServiceUnavailable',    // APNs
]);

/**
 * @param {number|null} status HTTP 상태 (네트워크 계층 오류면 0/null)
 * @param {string|null} reason 사유 문자열 (Node 오류 코드 또는 서비스 사유)
 * @returns {boolean} 한 번 더 보내볼 가치가 있는가
 */
function isTransientPushFailure(status, reason) {
  const s = Number(status) || 0;
  if (s >= 500) return true;
  if (s >= 400) return false;
  const r = String(reason || '');
  if (TRANSIENT_REASONS.has(r)) return true;
  // web-push 는 코드 대신 메시지로 온다 ('socket hang up' 등)
  return /socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|network|timeout/i.test(r);
}

const RETRY_DELAY_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { isTransientPushFailure, RETRY_DELAY_MS, sleep };
