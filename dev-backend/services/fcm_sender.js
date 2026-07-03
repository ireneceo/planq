// FCM 발송 (Android 네이티브 푸시) — HTTP v1 직접 (firebase-admin 대신, 신규 무거운 의존성 0).
//   설계: docs/MOBILE_APP_DESIGN §5.2
//   서비스계정 JSON 1개 → jsonwebtoken(RS256) 으로 OAuth2 access token 발급(55분 캐시) →
//   POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send
//
// env (dev-backend/.env):
//   FCM_SERVICE_ACCOUNT_PATH — 서비스계정 JSON 절대경로 (client_email/private_key/project_id 포함)
//   FCM_PROJECT_ID           — (선택) SA JSON 의 project_id 대신 명시
//
// 미설정 시 isFcmConfigured()=false → 호출측(push_service)이 skipped 처리.
const fs = require('fs');
const jwt = require('jsonwebtoken');

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let _sa = null;
let _saLoaded = false;
function _serviceAccount() {
  if (_saLoaded) return _sa;
  _saLoaded = true;
  try {
    if (process.env.FCM_SERVICE_ACCOUNT_PATH) {
      _sa = JSON.parse(fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[fcm] 서비스계정 로드 실패:', e.message);
    _sa = null;
  }
  return _sa;
}

function _projectId() {
  return process.env.FCM_PROJECT_ID || (_serviceAccount() || {}).project_id || null;
}

function isFcmConfigured() {
  const sa = _serviceAccount();
  return !!(sa && sa.client_email && sa.private_key && _projectId());
}

// OAuth2 access token — 서비스계정 JWT(RS256) 교환. 55분 캐시.
let _cachedToken = { token: null, exp: 0 };
async function _accessToken() {
  if (_cachedToken.token && Date.now() < _cachedToken.exp) return _cachedToken.token;
  const sa = _serviceAccount();
  if (!sa) throw new Error('fcm_sa_missing');
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 },
    sa.private_key,
    { algorithm: 'RS256' }
  );
  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`fcm_token_http_${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error('fcm_token_empty');
  _cachedToken = { token: j.access_token, exp: Date.now() + 55 * 60 * 1000 };
  return j.access_token;
}

// payload: push_service 의 { title, body, link?, tag?, badge? }
// return: { ok, status, reason } — 404/UNREGISTERED = 죽은 토큰(row 정리)
async function sendFcm(deviceToken, payload, _retried = false) {
  if (!isFcmConfigured()) return { ok: false, status: 0, reason: 'no_fcm_key' };
  if (!deviceToken) return { ok: false, status: 0, reason: 'no_token' };

  let token;
  try { token = await _accessToken(); } catch (e) { return { ok: false, status: 0, reason: e.message || 'token_error' }; }

  const message = {
    token: deviceToken,
    notification: { title: payload.title, body: payload.body },
    data: { link: String(payload.link || '/') }, // FCM data 값은 문자열만
    android: {
      priority: 'high',
      notification: { channel_id: 'planq_default', ...(payload.tag ? { tag: String(payload.tag) } : {}) },
    },
  };

  let res;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${_projectId()}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    return { ok: false, status: 0, reason: e.name === 'TimeoutError' ? 'timeout' : (e.message || 'req_error') };
  }

  if (res.status === 200) return { ok: true, status: 200 };

  // 401 — access token 만료/무효. 캐시 무효화 후 1회 재시도.
  if (res.status === 401 && !_retried) {
    _cachedToken = { token: null, exp: 0 };
    return sendFcm(deviceToken, payload, true);
  }

  let reason = `http_${res.status}`;
  try {
    const err = await res.json();
    const status = err?.error?.status || '';
    const detailCode = (err?.error?.details || []).map((d) => d.errorCode).find(Boolean) || '';
    // 죽은 토큰 시그널: 404 NOT_FOUND / UNREGISTERED / INVALID_ARGUMENT(토큰형식)
    if (res.status === 404 || status === 'NOT_FOUND' || detailCode === 'UNREGISTERED') {
      return { ok: false, status: 404, reason: 'unregistered' };
    }
    reason = detailCode || status || reason;
  } catch { /* body 파싱 실패 — http_status 유지 */ }
  return { ok: false, status: res.status, reason };
}

module.exports = { sendFcm, isFcmConfigured };
