---
paths:
  - "dev-backend/routes/oauth/**"
  - "dev-backend/routes/auth*.js"
  - "dev-backend/services/*oauth*"
  - "dev-backend/services/authTokens.js"
  - "dev-backend/middleware/security.js"
  - "dev-frontend/src/pages/Login/**"
  - "dev-frontend/src/pages/Register/**"
  - "dev-frontend/src/services/auth*"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 인증 — 외부 로그인(구글·애플)·refresh 토큰

> - **refresh_token chain 격리** — reuse_detected 가 같은 user 의 모든 active row 일괄 revoke 하던 회귀 → chain (`replaced_by_id` 사슬) 만 revoke. rotation grace 30s → 5min (모바일 PWA wake-up). memory `project_multi_device_session.md` 업데이트
> - **refresh_token TTL by client_kind (사이클 N+10, 2026-05-12):** `refresh_tokens.client_kind` ENUM('pwa','web'). PWA standalone=365일 / web=30일 sliding renewal. 결정 우선순위: `req.body.client_kind` > `X-Client-Kind` 헤더 > 옛 row.client_kind > 'web'. frontend `detectClientKind()` 가 `display-mode: standalone` 매치 시 'pwa' 결정. login/register/refresh fetch 에 헤더 + body 자동 전달. cookie maxAge 동기. JWT expiresIn 도 동일 분기 (365d/30d).
## 외부 로그인(구글·애플)은 **끝부분이 한 벌**이다 (2026-09-21 박제)

> Irene: *"iOS는 정식으로 하려면 어떻게 해?"* → App Store 심사 4.8(구글 로그인이 있으면 애플도).

- **3분기(연결된 subject → 로그인 / 같은 이메일 → 연결 확인 / 없음 → 신규 가입)와 실패 착지는
  `routes/oauth/finish.js` 하나다.** 공급자 파일(`oauth/login.js` 구글 · `oauth/apple.js` 애플)은
  프로필을 얻고 `finishOauthLogin` 을 부를 뿐이다. 베끼면 #259·네이티브 연결확인·실패 착지 같은 수리가 한쪽에만 남는다.
- **네이티브 여부는 호출부가 명시적으로 넘긴다.** 구글은 GET 콜백이라 쿠키(`oauth_native`), 애플은
  **교차 사이트 POST(form_post)** 라 SameSite=Lax 쿠키가 안 와서 **state 에 실어 온다.**
- 애플 콜백만 CORS 를 건너뛴다(`middleware/security.js`, 경로·메서드 정확 일치). Origin 이 appleid.apple.com 이라 걸리면 500 이다.
- 애플 자격은 **플랫폼 관리자 > 플랫폼 설정 > Apple 로그인**(개인키 .p8 은 파일로, 암호화 저장·재표시 없음).
  넷이 다 있어야 로그인 화면에 버튼이 뜬다(`GET /api/auth/oauth-providers`). 채팅으로 키를 주고받지 않는다.
- ★ **`sequelize` 는 `config/database` 에서 가져온다** — `require('../models').sequelize` 는 undefined 다.
  옛 구글 콜백이 그렇게 받아 **구글 신규 가입이 운영에서 한 번도 성공하지 못했다**(2026-08-27 로그 · OAuth 전용 가입자 0명).
- 운영 스키마: `dev-backend/scripts/migrate-apple-login.js`(ENUM 끝 append 2 · 컬럼 4, 멱등) — 코드 배포 전(deploy 슬롯).

