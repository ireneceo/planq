// routes/client_errors.js — 화면이 통째로 죽었을 때 **우리가 먼저 안다**.
//
// Irene 2026-09-08: *"이렇게 에러가 나는 건 우리가 미리 미리 몰라?"*
//   몰랐다. 렌더 크래시는 ErrorBoundary 가 화면만 갈아 끼우고 끝이었고, 서버에는 아무 흔적이
//   남지 않았다. 사용자가 "이 문제 신고" 를 눌러 글을 써 줘야만 알 수 있었다 —
//   즉 **신고하지 않으면 영영 모른다.** 어느 화면에서 났는지조차 못 물어본다.
//
// 그래서 크래시를 **경로와 메시지만** 서버 로그에 남긴다.
//   · 새 테이블·컬럼 없음 (스키마를 늘릴 만한 값이 아니다 — 조사에 필요한 건 경로와 메시지다)
//   · 인증 필수 (무인증 표면을 넓히지 않는다)
//   · per-user rate limit (한 화면이 루프로 죽으면 초당 수십 번 올 수 있다 — 그게 이번 #185 다)
//   · 본문 캡 (긴 스택으로 로그를 채우지 않는다)
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');

// 분당 5회 / 일 100회 — 루프 크래시가 로그를 삼키지 못하게. 넘으면 조용히 버린다(사용자 화면엔 영향 없음).
const limiter = perUserDaily('client-error', { perMin: 5, perDay: 100 });

const cap = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

router.post('/', authenticateToken, ...limiter, async (req, res) => {
  const b = req.body || {};
  // ★ 사용자가 보낸 값이다 — 그대로 믿고 로그에 붓지 않는다. 길이를 자르고 개행을 없앤다
  //   (개행이 살아 있으면 한 건이 여러 줄로 흩어져 로그 grep 이 어긋난다).
  console.error('[client-crash]', JSON.stringify({
    at: new Date().toISOString(),
    user_id: req.user.id,
    business_id: Number(b.business_id) || null,
    route: cap(b.route, 200),
    message: cap(b.message, 300),
    component: cap(b.component, 200),
    build: cap(b.build, 60),
    ua: cap(req.get('user-agent'), 160),
  }));
  // 응답은 언제나 200 — 크래시 보고가 또 실패해서 화면을 두 번 죽이면 안 된다.
  return successResponse(res, { ok: true });
});

module.exports = router;
