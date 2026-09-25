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

/**
 * 대화방이 **있어야** 하는 라우트의 문 (2026-09-25, 워크스페이스 창구).
 *
 * ★ 워크스페이스 창구(scope='workspace')의 공유 링크에는 방이 없다 — 방은 방문자가 이메일을
 *   확인한 뒤 개인 링크마다 생긴다(services/guest_link.js ensureVisitorConversation).
 *   그래서 메시지·카드·계정요청 라우트가 `conversation.id` 를 그냥 읽으면 **500** 이 난다.
 *   무인증 표면에서 500 은 그 자체가 정보다(그 토큰이 어떤 종류인지 알려 준다).
 * ★ **한 곳에 둔다.** 라우트마다 `if (!conversation)` 을 손으로 적으면 새 라우트에서 빠진다 —
 *   이 파일이 존재하는 이유와 같다(토큰 해석·한도 키가 파일마다 달라지는 것을 막는다).
 * ★ 404 다(403 이 아니다) — "그 토큰은 있는데 방이 없다" 를 흘리지 않는다.
 *   화면은 이 상태를 **누르기 전에** 안다(확인 전에는 버튼을 비활성 + 이유로 둔다,
 *   docs/CLIENT_ENTRY_DESIGN.md §4.3 과 같은 규약). 눌리게 두고 404 로 거절하면
 *   사용자에게는 "아무 일도 안 일어남" 이다.
 */
function requireRoom(req, res, next) {
  if (!req.guest || !req.guest.conversation) return errorResponse(res, 'not_found', 404);
  next();
}

module.exports = { guestLimiter, attachGuest, rootLink, requireRoom };
