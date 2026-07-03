// costGuard — 외부 비용(LLM/STT/메일/스토리지) 발생 라우트의 per-user rate-limit + 입력 캡.
// 비용폭탄 총점검(2026-07-02) 산출물. 기존 reports.js narrativeLimiter 패턴 일반화.
//
// 사용:
//   const { perUserLimiter, perUserDaily, capText } = require('../middleware/costGuard');
//   router.post('/x', ...perUserDaily('ai-x', { perMin: 10, perDay: 100 }), handler)
//
// key: 로그인 사용자는 user.id 버킷(공용 사무실 IP NAT 우회), 미인증은 실 IP(trust proxy=1 → req.ip 정답).
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const DEFAULT_MSG = { success: false, message: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' };

/** per-user(폴백 IP) 단일 윈도우 rate-limiter. */
function perUserLimiter(name, { windowMs, max, message } = {}) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => (req.user?.id ? `${name}-u${req.user.id}` : `${name}-ip${ipKeyGenerator(req.ip)}`),
    standardHeaders: true,
    legacyHeaders: false,
    message: message ? { success: false, message } : DEFAULT_MSG,
  });
}

/** 분당 + 일당 이중 윈도우 (둘 다 통과해야 함). 미들웨어 배열 반환 → 스프레드로 라우트에 적용. */
function perUserDaily(name, { perMin, perDay, message } = {}) {
  const out = [];
  if (perMin) out.push(perUserLimiter(`${name}-m`, { windowMs: 60 * 1000, max: perMin, message }));
  if (perDay) out.push(perUserLimiter(`${name}-d`, { windowMs: 24 * 60 * 60 * 1000, max: perDay, message }));
  return out;
}

/** 문자열 입력 상한 — 초과 시 잘라 반환(토큰 폭발 방지). null/비문자열은 그대로. */
function capText(s, max) {
  return typeof s === 'string' && s.length > max ? s.slice(0, max) : s;
}

module.exports = { perUserLimiter, perUserDaily, capText };
