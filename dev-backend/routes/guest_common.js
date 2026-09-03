// routes/guest_common.js — 무인증 게스트 표면의 **공용 조각**
//
// ★ 게스트 라우트가 두 파일로 갈렸다(대화 `guest.js` / 답글 알림 `guest_subscribe.js`).
//   갈라지는 순간 위험한 것은 **토큰을 푸는 방식과 한도 키가 파일마다 달라지는 것**이다.
//   그래서 그 둘은 여기 한 벌만 둔다 — 새 파일이 생겨도 같은 문을 지난다.
const rateLimit = require('express-rate-limit');
const { errorResponse } = require('../middleware/errorHandler');
const { resolveGuestToken } = require('../services/guest_link');

// 게스트 rate-limit — **토큰을 키로 쓴다.** 인증이 없어 req.user 가 없고, IP 는 NAT·모바일망에서
//   여러 고객이 한 덩어리로 뭉친다(한 사람이 남을 잠근다).
//   ★ costGuard 의 perUserLimiter 는 keyGenerator 를 **인자로 받지 않는다** — 넘겨도 조용히
//     무시되고 IP 키로 떨어진다. 그래서 여기서 직접 만든다.
const guestLimiter = (name, { windowMs, max }) => rateLimit({
  windowMs,
  max,
  keyGenerator: (req) => `${name}-${String(req.params.token || '').slice(0, 32)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'too_many_requests' },
});

/** 토큰을 풀어 req.guest 에 담는다. 실패하면 **무조건 404**. */
async function attachGuest(req, res, next) {
  const ctx = await resolveGuestToken(req.params.token, {
    touch: true,
    ip: req.headers['x-forwarded-for'] || req.ip,
  });
  if (!ctx) return errorResponse(res, 'not_found', 404);
  req.guest = ctx;
  next();
}

/** 이 요청이 가리키는 **부모(shared) 링크**. personal 토큰으로 들어와도 뿌리를 잡는다. */
const rootLink = (g) => g.parent || g.link;

module.exports = { guestLimiter, attachGuest, rootLink };
