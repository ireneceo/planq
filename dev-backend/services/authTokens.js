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
  // 세션이 새로 서는 자리에서는 이미지 쿠키도 같이 준다 (heal · refresh 회전).
  setImageCookie(res, { id: row.user_id });
}

// ============================================
// 이미지 전용 쿠키 (보안 Stage 1 — 발급만, 게이트는 Stage 2)
// ============================================
//
// ★ 왜 쿠키인가 — 이미지는 `<img src>` 가 부른다. 평범한 img 태그는 **Authorization 헤더를
//   실을 수 없다.** 그래서 무인증 이미지 라우트 4곳은 신원을 알 방법이 없었고,
//   "URL 을 아는 사람 = 볼 수 있는 사람" (capability URL) 으로만 굴러갔다.
//   그것이 L1(개인 파일) 어휘와 어긋난다 — 운영 개인 이미지 154건이 링크만 알면 열린다.
//   브라우저가 서브리소스 요청에 자동으로 실어 보내는 채널은 쿠키뿐이므로 쿠키를 쓴다.
//
// ★ 왜 refresh 쿠키를 재사용하지 않는가 — refresh 는 **장기 비밀**이다(pwa 365일).
//   그것을 이미지 요청 수천 건에 실어 보내면 노출면이 그만큼 넓어진다. path 도 `/api/auth` 로
//   좁혀 둔 것을 일부러 넓히는 셈이다. 짧은 수명의 별도 토큰을 만든다.
//
// ★ 왜 path 를 4번 나눠 다는가 — 쿠키는 path 를 하나만 가진다. 네 라우트에 공통 접두사가
//   `/api` 뿐인데 거기에 달면 **모든 API 호출에 딸려 간다.** 같은 이름·값으로 네 경로에
//   각각 달면 브라우저가 해당 경로 요청에만 보낸다.
const IMAGE_COOKIE = 'pq_img';
// 이미지 쿠키를 보낼 경로 — 무인증 이미지 서빙 라우트 전수.
//   ★ 새 이미지 서빙 라우트를 만들면 여기에 더한다. 안 더하면 그 화면만 조용히 신원을 잃는다.
const IMAGE_COOKIE_PATHS = [
  '/api/files/public-image',
  '/api/tasks/public/attach',
  '/api/posts/editor-image',
  '/api/message-attachments/public',
];

// 수명 — access token 과 같이 간다. 회수 지연이 access token 을 넘지 않게 하기 위함이다.
//   다만 `<img>` 는 401 을 재시도하지 않으므로, refresh 주기 사이에 끊기면 그림만 사라진다.
//   그래서 access(15분)보다 넉넉히 잡되 refresh 수명보다는 짧게 둔다.
//   ★ 2시간. 처음엔 1일로 잡았는데 너무 길다 — 이 토큰은 **서버가 회수할 수 없다**(stateless).
//     로그아웃해도 쿠키를 지울 뿐, 그 값을 손에 쥔 쪽은 만료까지 계속 쓴다.
//     프론트가 14분마다 refresh 하면서 갱신하므로 짧아도 화면은 안 끊긴다.
const IMAGE_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;   // 2시간

// ★★ 이미지 토큰은 **JWT_SECRET 으로 서명하지 않는다.**
//   처음엔 JWT_SECRET + `kind:'img'` 로 만들고 "검증하는 쪽이 kind 를 본다" 고 적었는데,
//   **그건 내 쪽 이야기였다.** 일반 인증 미들웨어(middleware/auth.js)·socket.io 핸드셰이크·
//   점검모드·문의 라우트는 전부 `jwt.verify(…, JWT_SECRET)` 뒤 `decoded.userId` 만 본다.
//   그래서 이 쿠키 값을 그대로 `Authorization: Bearer` 에 넣으면 **일반 API 가 통과했다**
//   (Fable 실측: `GET /api/auth/me` → 200). 15분짜리 신원을 **2시간짜리 bearer 로 만들어
//   쿠키 jar 에 심고 이미지 요청마다 흘려보내는** 꼴이었다.
//
//   나는 한 방향만 반증했다 — "일반 access token 을 pq_img 자리에 넣으면 거부되는가".
//   반대 방향을 안 봤다. 검사로 막는 대신 **애초에 받아들여질 수 없는 서명**을 쓴다:
//   파생 비밀로 서명하면 JWT_SECRET 을 쓰는 소비처는 어디서도 이 토큰을 검증하지 못한다.
//   (검사는 빠뜨릴 수 있지만, 열쇠가 다르면 빠뜨릴 자리가 없다.)
const IMAGE_TOKEN_SECRET = crypto.createHmac('sha256', String(process.env.JWT_SECRET || ''))
  .update('pq_img/v1').digest();

function generateImageToken(user) {
  return jwt.sign(
    { userId: user.id, kind: 'img' },
    IMAGE_TOKEN_SECRET,
    { expiresIn: Math.floor(IMAGE_COOKIE_TTL_MS / 1000) }
  );
}

function setImageCookie(res, user) {
  if (!user || !user.id) return;
  const secure = process.env.NODE_ENV === 'production';
  const token = generateImageToken(user);
  for (const path of IMAGE_COOKIE_PATHS) {
    // maxAge 를 항상 준다 — 세션 쿠키로 두면 PWA 재시작마다 그림이 사라진다.
    res.cookie(IMAGE_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path, maxAge: IMAGE_COOKIE_TTL_MS });
  }
}

function clearImageCookie(res) {
  for (const path of IMAGE_COOKIE_PATHS) res.clearCookie(IMAGE_COOKIE, { path });
}
module.exports = {
  hashRefreshToken,
  TTL_MS_BY_KIND, LONG_KINDS, VALID_KINDS,
  resolveClientKind, jwtExpiresInForKind,
  createRefreshTokenRow,
  generateAccessToken, generateRefreshToken,
  authWarn,
  SESSION_HINT, setSessionHint, setRefreshCookies,
  IMAGE_COOKIE, IMAGE_COOKIE_PATHS, IMAGE_COOKIE_TTL_MS, IMAGE_TOKEN_SECRET,
  setImageCookie, clearImageCookie,
  DELIVERY_EPOCH_MS,
};
