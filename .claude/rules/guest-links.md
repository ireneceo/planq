---
paths:
  - "dev-backend/routes/guest*.js"
  - "dev-backend/services/guest*"
  - "dev-frontend/src/pages/Guest/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 게스트 링크(guest_links)

**게스트 링크 (1):** **guest_links** — 무로그인 링크(#259). **2026-09-05: `scope` ENUM('conversation','project') 추가, 기본값 `conversation`.** 이 컬럼이 곧 **여는 것의 상한**이다 — `conversation` 토큰으로 프로젝트 탭 라우트(`/api/guest/:token/tasks` 등)를 부르면 **404**. 기본값을 conversation 으로 둔 이유: **이미 나가 있는 링크가 조용히 넓어지면 안 된다**(운영 기존 행은 전부 conversation 으로 남는다). 운영 적용은 `dev-backend/scripts/migrate-guest-link-scope.js`(멱등) — **코드 배포 전에** 실행한다(컬럼이 없으면 500). 발급 가능 판정은 `services/guest_link.js assertGuestLinkIssuable` **한 함수**(대화방·프로젝트 두 라우트가 같이 부른다 — 복사했다가 한쪽에서 죽은 코드가 된 전례). 설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md


**워크스페이스 공개 페이지(창구 «안내») — 데이터 한 벌 (2026-11-20, 설계 docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md · Irene «권고대로»)**
- 저장 모양·기본값·밖으로 나가는 모양은 `services/workspacePage.js` **한 곳**(`normalizeEntry`·`entryOf`·`publicView`·`PROFILE_ATTRS`). 창구 안내 탭·로그인 고객 홈·설정 미리 보기·(P3) 공개 주소가 같은 `publicView` 를 지난다 — 라우트에서 손으로 모양을 쓰지 않는다.
- **가린 항목은 응답에 싣지 않는다**(화면에서 숨기지 않는다). 기본 가림: 처음 꾸미는 워크스페이스 = 이메일·대표자·업태 / 저장값 없이 창구 링크만 있던 곳 = 대표자·업태(지금까지 보이던 이메일 유지). 새 기본은 창구 링크를 처음 만들 때·링크 없이 처음 저장할 때 저장으로 박는다.
- 서비스 카드 사진은 브랜드 로고와 같은 길(`/api/businesses/symbol/<uuid>`, PNG·JPG·WEBP 3MB, SVG 거절) — 그 밖의 주소는 저장 때 버린다.
- 화면: 설정 «공개 페이지» 탭(`components/WorkspacePage/WorkspacePageSettings`) · 작은 창 `PageLinkDialog`(Q sale 머리 · 워크스페이스 메뉴). 회귀 `--suite wspage`(3폭 + 가림 대조군) · `--suite guestentry`(응답 키 11개·기본 가림 null).
