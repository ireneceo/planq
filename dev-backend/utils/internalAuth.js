// utils/internalAuth.js — 내부 전용(Python Q Note ↔ Node) 라우트의 관문 **한 벌**.
//
// ★ 왜 한 벌인가 — 같은 검사가 세 곳에 복붙돼 있었고(`routes/internal.js`, `routes/files.js:internal/:fileId`,
//   `routes/cloud.js:qnote/sync`), 그중 **둘은 nginx 의 `location /api/internal { deny all; }` 밖**에 있었다.
//   즉 심층방어라고 믿은 층이 두 라우트에는 아예 없었다 (2026-09-02 보안감사 C-2:
//   유출된 키로 인터넷에서 크로스테넌트 파일 메타 + 서버 절대경로를 200 으로 받아냈다).
//
// 두 가지를 같이 건다:
//   ① **루프백에서만** — 이 라우트들의 정당한 호출자는 같은 서버의 q-note(`http://localhost:3003`)뿐이다.
//      키가 새더라도 인터넷에서는 닿지 않는다. (`app.set('trust proxy', 1)` 이라 `req.ip` 는
//      nginx 가 넣은 실 클라이언트 IP — 공격자가 X-Forwarded-For 를 위조해도 nginx 가 뒤에 덧붙인다.)
//   ② **타이밍 안전 비교** — `!==` 는 앞자리부터 차이 나는 위치가 시간에 드러난다.
const crypto = require('crypto');
const { errorResponse } = require('../middleware/errorHandler');

// ★ `app.set('trust proxy', 1)` 이라 `req.ip` 는 nginx 가 넣은 실 클라이언트 IP 다.
//   부작용 하나 — **루프백 호출자라도 `X-Forwarded-For` 를 붙이면 그 값이 req.ip 가 되어 막힌다.**
//   q-note 는 XFF 를 보내지 않으므로 현재 무해하다. 앞으로 로컬 호출자를 추가할 때
//   그 클라이언트가 XFF 를 붙이지 않는지 확인할 것(붙이면 조용히 403 이 된다).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(req) {
  const ip = String(req.ip || req.connection?.remoteAddress || '');
  if (LOOPBACK.has(ip)) return true;
  return ip.startsWith('127.');
}

function keyMatches(provided) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;          // 길이는 어차피 드러난다
  return crypto.timingSafeEqual(a, b);
}

function requireInternalKey(req, res, next) {
  if (!isLoopback(req)) return errorResponse(res, 'forbidden', 403);
  if (!keyMatches(req.header('x-internal-api-key'))) return errorResponse(res, 'forbidden', 403);
  next();
}

module.exports = { requireInternalKey, isLoopback };
