// APNs 발송 — .p8 token-based auth + HTTP/2 직접 (신규 의존성 0, 기존 jsonwebtoken 재사용).
//   설계: docs/MOBILE_APP_DESIGN §5.2
//
// env (dev-backend/.env):
//   APNS_KEY_ID          — .p8 Key ID
//   APNS_TEAM_ID         — Apple Developer Team ID
//   APNS_KEY_P8_PATH     — .p8 파일 절대경로 (권한 640, planq 그룹)  ※ 또는 APNS_KEY_P8 인라인
//   APNS_BUNDLE_ID       — app.planq (apns-topic)
//   APNS_PRODUCTION      — 'true'(운영 api.push.apple.com) | 'false'(sandbox, Xcode 직접설치)
//
// 미설정 시 isApnsConfigured()=false → 호출측(push_service)이 skipped 처리. 서버 정상 기동.
const http2 = require('http2');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const HOST_PROD = 'https://api.push.apple.com';
const HOST_SANDBOX = 'https://api.sandbox.push.apple.com';
const DEFAULT_TTL_SECONDS = 86400; // 1일 — web push 정책(push_service.js) 미러

function _host() {
  return process.env.APNS_PRODUCTION === 'true' ? HOST_PROD : HOST_SANDBOX;
}

function _p8() {
  if (process.env.APNS_KEY_P8) return process.env.APNS_KEY_P8.replace(/\\n/g, '\n');
  if (process.env.APNS_KEY_P8_PATH) return fs.readFileSync(process.env.APNS_KEY_P8_PATH, 'utf8');
  return null;
}

function isApnsConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID
    && (process.env.APNS_KEY_P8 || process.env.APNS_KEY_P8_PATH));
}

// provider JWT — APNs 규정상 20~60분 유효. 50분 캐시 후 재발급.
let _cachedJwt = { token: null, iat: 0 };
function _providerToken() {
  if (_cachedJwt.token && Date.now() - _cachedJwt.iat < 50 * 60 * 1000) return _cachedJwt.token;
  const key = _p8();
  if (!key) throw new Error('apns_p8_missing');
  const token = jwt.sign({}, key, {
    algorithm: 'ES256',
    issuer: process.env.APNS_TEAM_ID,
    keyid: process.env.APNS_KEY_ID,
    // jsonwebtoken 이 iat 자동 포함
  });
  _cachedJwt = { token, iat: Date.now() };
  return token;
}

// HTTP/2 연결 재사용 — 매 발송 새 연결은 APNs 가 rate-limit. 모듈 레벨 client 1개, 끊기면 재생성.
let _client = null;
function _getClient() {
  if (_client && !_client.closed && !_client.destroyed) return _client;
  const c = http2.connect(_host());
  c.on('error', () => { try { c.destroy(); } catch { /* noop */ } if (_client === c) _client = null; });
  c.on('goaway', () => { try { c.close(); } catch { /* noop */ } if (_client === c) _client = null; });
  c.on('close', () => { if (_client === c) _client = null; });
  _client = c;
  return c;
}

// payload: push_service 의 { title, body, link?, tag?, badge? }
// return: { ok, status, reason } — status 410 = Unregistered(토큰 죽음 → row 정리), 403 InvalidProviderToken → JWT 무효화
async function sendApns(deviceToken, payload, _retried = false) {
  if (!isApnsConfigured()) return { ok: false, status: 0, reason: 'no_apns_key' };
  if (!deviceToken) return { ok: false, status: 0, reason: 'no_token' };

  let token;
  try { token = _providerToken(); } catch { return { ok: false, status: 0, reason: 'token_error' }; }

  const aps = {
    alert: { title: payload.title, body: payload.body },
    sound: 'default',
  };
  if (typeof payload.badge === 'number') aps.badge = payload.badge;
  if (payload.tag) aps['thread-id'] = String(payload.tag); // 알림 그룹핑 = 기존 tag 의미 보존
  const body = JSON.stringify({ aps, link: payload.link || '/' }); // custom key 'link' — 앱이 딥링크로 사용

  const headers = {
    ':method': 'POST',
    ':path': `/3/device/${deviceToken}`,
    authorization: `bearer ${token}`,
    'apns-topic': process.env.APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS),
  };
  if (payload.tag) headers['apns-collapse-id'] = String(payload.tag).slice(0, 64);

  const result = await new Promise((resolve) => {
    let c;
    try { c = _getClient(); } catch { return resolve({ ok: false, status: 0, reason: 'connect_error' }); }
    let req;
    try { req = c.request(headers); } catch { return resolve({ ok: false, status: 0, reason: 'request_error' }); }
    let status = 0;
    let data = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    req.setTimeout(5000, () => { try { req.close(); } catch { /* noop */ } done({ ok: false, status: 0, reason: 'timeout' }); });
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      if (status === 200) return done({ ok: true, status });
      let reason = '';
      try { reason = (JSON.parse(data) || {}).reason || ''; } catch { /* noop */ }
      done({ ok: false, status, reason });
    });
    req.on('error', (e) => done({ ok: false, status: 0, reason: e.code || 'req_error' }));
    req.end(body);
  });

  // InvalidProviderToken — JWT 캐시 무효화 후 1회 재시도.
  if (!result.ok && result.status === 403 && result.reason === 'InvalidProviderToken' && !_retried) {
    _cachedJwt = { token: null, iat: 0 };
    return sendApns(deviceToken, payload, true);
  }
  return result;
}

module.exports = { sendApns, isApnsConfigured };
