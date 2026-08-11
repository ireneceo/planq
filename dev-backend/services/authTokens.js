// services/authTokens.js — 세션 토큰·쿠키 **단일 원천**.
//
// 왜 분리했나
//   `routes/auth.js` 가 god-file 동결선을 넘겼다(1055 → 1141줄). 라우트 파일이 커진 이유는
//   **토큰 발급·쿠키 규칙이 라우팅과 같은 파일에 살아서**다. 이 규칙들은 라우팅이 아니라
//   세션 정책이고, `routes/auth_oauth.js` 도 같은 규칙을 필요로 한다(지금은 쿠키 로직을
//   중복 구현해 drift 위험이 있다 — 별도 사이클에서 이 모듈로 합칠 것).
//
// ★ 여기 있는 것은 전부 **정책**이다. 값을 바꾸면 전 사용자의 세션 수명이 바뀐다.
//   TTL / persist 승계 / 쿠키 속성 / 수령확인 기준 — 바꾸기 전에 반드시 게이트를 태울 것.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken } = require('../models');

// refresh_token 은 평문 저장 금지 — DB 유출 시 세션 탈취 위험.
// SHA-256 해시만 저장 + 클라이언트엔 raw 를 쿠키로 전달.
const hashRefreshToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// 다중 디바이스 세션 helper — refresh_tokens row 생성.
// 30년차 시각: user.refresh_token 단일 컬럼은 다중 디바이스에서 충돌 (한 디바이스가 refresh
// 하면 다른 디바이스 cookie 가 invalid). refresh_tokens 테이블은 device 별 row 라
// 모든 디바이스가 독립적으로 refresh.
//
// TTL 정책 (사이클 N+10):
//   pwa (모바일 PWA standalone) — 365일. 모바일 앱은 push 수신을 위해 사실상 무한 세션 유지.
//                                  refresh 호출 시마다 sliding renewal 로 365일 재설정.
//   web (데스크탑 브라우저)      — 30일. 활동 시 sliding renewal.
//   ios / android (Capacitor 네이티브 앱) — 365일. 푸시(APNs/FCM) 수신 위해 상시 세션 (pwa 정책과 동일).
// 결정 우선순위: req.body.client_kind > req.headers['x-client-kind'] > 옛 row.client_kind > 'web'.
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS_BY_KIND = {
  pwa: 365 * DAY_MS,
  ios: 365 * DAY_MS,
  android: 365 * DAY_MS,
  web: 30 * DAY_MS,
};
// 장기 세션(365일) client_kind 집합 — pwa + 네이티브 앱.
const LONG_KINDS = new Set(['pwa', 'ios', 'android']);
const VALID_KINDS = new Set(['pwa', 'ios', 'android', 'web']);
function resolveClientKind(req, fallback) {
  const body = (req?.body?.client_kind || '').toString().toLowerCase();
  if (VALID_KINDS.has(body)) return body;
  const hdr = (req?.headers?.['x-client-kind'] || '').toString().toLowerCase();
  if (VALID_KINDS.has(hdr)) return hdr;
  if (VALID_KINDS.has(fallback)) return fallback;
  return 'web';
}
function jwtExpiresInForKind(kind) {
  return LONG_KINDS.has(kind) ? '365d' : '30d';
}

async function createRefreshTokenRow(user, rawToken, req, transaction = null, opts = {}) {
  const kind = opts.clientKind || resolveClientKind(req);
  const expiresAt = new Date(Date.now() + TTL_MS_BY_KIND[kind]);
  const ua = (req?.headers?.['user-agent'] || '').slice(0, 500);
  const ip = (req?.ip || req?.connection?.remoteAddress || '').slice(0, 64);
  return RefreshToken.create({
    user_id: user.id,
    token_hash: hashRefreshToken(rawToken),
    user_agent: ua, ip_address: ip,
    client_kind: kind,
    expires_at: expiresAt,
    last_used_at: new Date(),
  }, transaction ? { transaction } : {});
}
// ============================================
// Helper: 토큰 생성
// ============================================
const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

const generateRefreshToken = (user, clientKind = 'web', persist = true) => {
  // jti (UUID) 추가 — jwt.iat 가 초 단위라 같은 초에 두 번 sign 시 동일 토큰 → token_hash unique 충돌.
  // 다중 탭 동시 refresh / 빠른 연속 login 같은 race 에서 401/409 회귀 차단.
  // expiresIn: pwa=365d (모바일 long-lived) / web=30d (데스크탑). cookie maxAge 와 동일.
  //
  // #244 — persist=false (로그인 시 "로그인 상태 유지" 해제, 공용 PC) 면 claim 으로 실어 보낸다.
  //   여태 refresh 라우트가 remember 와 무관하게 항상 maxAge 를 붙여, 첫 회전에서 세션 쿠키가
  //   영구 쿠키로 승격됐다 (공용 PC 에서 브라우저를 닫아도 세션이 남는 실질적 보안 결함).
  //   claim 이 없는 옛 토큰은 persist=true 로 해석 — 기존 동작 무회귀.
  const payload = { userId: user.id, jti: crypto.randomUUID() };
  if (persist === false) payload.persist = false;
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: jwtExpiresInForKind(clientKind) }
  );
};

// #244 (D3) — 진단 가능성.
//
//   문제: refresh 401 로그가 시각 없이 한 줄만 남고, `no_cookie` 는 **게스트가 로그인 화면을
//   열 때도 똑같이 찍힌다**(부팅 checkSession 이 무조건 refresh 를 호출한다). 그래서 크롤러·게스트
//   노이즈에 진짜 "세션 증발"이 묻혀, 사건 조사 때 로그 라인 회계를 간접 추론해야 했다.
//
//   해법: (a) 모든 auth 경고에 ISO 시각 (b) 동반 쿠키 has_session 으로 게스트와 표적 소실을 구분.
const authWarn = (msg, ...args) => console.warn('%s [auth] ' + msg, new Date().toISOString(), ...args);

// 동반 쿠키 — refresh_token(HttpOnly) 과 **같은 수명**으로 함께 살고 함께 죽는 non-HttpOnly 마커.
//   refresh 요청에 refresh_token 이 없을 때 이 쿠키의 유무가 원인을 갈라준다:
//     has_session 있음 + refresh_token 없음 → refresh_token 만 표적 삭제됨 (진짜 사고)
//     둘 다 없음                          → jar 전체 삭제 또는 그냥 게스트 (정상일 수 있음)
//   프론트도 이 값을 읽어 "세션이 있어야 정상인 상태"를 알 수 있다 (HttpOnly 가 아니므로 읽기 가능).
//   값에 비밀이 없다 — 인증에 쓰이지 않는 순수 진단 마커다.
const SESSION_HINT = 'has_session';
function setSessionHint(res, { maxAge, secure }) {
  const opts = { httpOnly: false, secure, sameSite: 'lax', path: '/' };
  if (maxAge != null) opts.maxAge = maxAge;
  res.cookie(SESSION_HINT, '1', opts);
}

// refresh 쿠키 한 벌(refresh_token + 동반 힌트)을 내리는 단일 지점.
//   persist=false 면 둘 다 세션 쿠키 — 브라우저를 닫으면 함께 사라진다(공용 PC 정책 유지).
//   maxAge 는 새 row 의 expires_at 기준 (DB 만료와 쿠키 만료를 항상 같은 시각으로 묶는다).
// #244 — `first_used_at` 이 실제로 기록되기 시작한 시점(이 기능의 배포일).
//   이 시각 **이전에 만들어진** row 는 first_used_at 이 NULL 이어도 "안 쓰였다" 는 뜻이 아니라
//   "기록이 없다" 는 뜻이다. 그걸 미수령으로 오판하면 **사용자가 지금 쓰고 있는 토큰을 폐기**한다.
//   그래서 이 시각 이전 row 는 수령확인 경로를 타지 않고 옛 시간 grace 로 폴백한다.
//   활성 체인은 사용 중 14분 주기로 회전하므로 하루 안에 전부 이 시각 이후 row 로 교체된다
//   → 그 뒤에는 이 가드가 무의미해지고, 안전하게 제거할 수 있다.
const DELIVERY_EPOCH_MS = Date.parse('2026-08-11T00:00:00Z');

function setRefreshCookies(res, rawToken, row, persist) {
  const secure = process.env.NODE_ENV === 'production';
  const opts = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' };
  if (persist) opts.maxAge = Math.max(0, new Date(row.expires_at).getTime() - Date.now());
  res.cookie('refresh_token', rawToken, opts);
  setSessionHint(res, { maxAge: opts.maxAge, secure });
}
module.exports = {
  hashRefreshToken,
  TTL_MS_BY_KIND, LONG_KINDS, VALID_KINDS,
  resolveClientKind, jwtExpiresInForKind,
  createRefreshTokenRow,
  generateAccessToken, generateRefreshToken,
  authWarn,
  SESSION_HINT, setSessionHint, setRefreshCookies,
  DELIVERY_EPOCH_MS,
};
