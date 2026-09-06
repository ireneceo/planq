// routes/auth_oauth.js — PlanQ OAuth 로그인 (Google) 조립부.
//
// 흐름:
// 1. frontend: "Google 로 계속" 클릭 → /api/auth/google/initiate redirect
// 2. backend: Google OAuth URL 생성 → 302 redirect to accounts.google.com
// 3. 사용자: Google 로그인 + PlanQ 권한 동의
// 4. Google: /api/auth/google/callback?code=...&state=... redirect
// 5. backend: code 교환 → 프로필 fetch → User lookup or auto-create → 세션 쿠키
// 6. backend: `/inbox` redirect (AuthContext 가 refresh cookie 로 자동 로그인)
//
// ★ 2026-09-06 분리 — 이 파일이 610줄이 되어 god-file 래칫(라우트 >500)을 넘었다.
//   인증 경계라 **동작이 한 톨도 달라지면 안 된다.** 그래서 가장 보수적인 절단을 골랐다:
//
//   · 라우터는 **여전히 하나**다. 각 모듈은 자기 Router 를 만들지 않고 이 router 에 등록한다.
//     → 등록 순서가 분리 전과 글자 그대로 같고, server.js 의 마운트(`/api/auth`)도 무변경이다.
//       (라우터를 쪼개 mount 하면 순서·prefix 가 새 변수가 된다 — 보안 경계에서 만들 이유가 없다.)
//   · 함께 쓰는 가변 상태(confirmStash · usedNativeCodes)는 **oauth/core.js 가 단독 소유**한다.
//     모듈마다 새로 만들면 Map 이 두 벌이 되어 연결 확인이 "만료됨" 이 되고 일회용 code 의
//     replay 차단이 무너진다. 이것이 이 분리의 유일한 진짜 위험이었다.
//
//   등록 순서(분리 전과 동일): login → pairing → connections
const express = require('express');
const router = express.Router();

require('./oauth/login')(router);        // /google/initiate · /google/callback · /google/web-return
require('./oauth/pairing')(router);      // /google/pair/start · /google/claim · /google/native-exchange
require('./oauth/connections')(router);  // /google/connect-confirm{,/info} · /oauth-connections ×3

module.exports = router;
