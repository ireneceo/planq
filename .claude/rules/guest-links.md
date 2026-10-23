---
paths:
  - "dev-backend/routes/guest*.js"
  - "dev-backend/services/guest*"
  - "dev-frontend/src/pages/Guest/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 게스트 링크(guest_links)

**게스트 링크 (1):** **guest_links** — 무로그인 링크(#259). **2026-09-05: `scope` ENUM('conversation','project') 추가, 기본값 `conversation`.** 이 컬럼이 곧 **여는 것의 상한**이다 — `conversation` 토큰으로 프로젝트 탭 라우트(`/api/guest/:token/tasks` 등)를 부르면 **404**. 기본값을 conversation 으로 둔 이유: **이미 나가 있는 링크가 조용히 넓어지면 안 된다**(운영 기존 행은 전부 conversation 으로 남는다). 운영 적용은 `dev-backend/scripts/migrate-guest-link-scope.js`(멱등) — **코드 배포 전에** 실행한다(컬럼이 없으면 500). 발급 가능 판정은 `services/guest_link.js assertGuestLinkIssuable` **한 함수**(대화방·프로젝트 두 라우트가 같이 부른다 — 복사했다가 한쪽에서 죽은 코드가 된 전례). 설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md

