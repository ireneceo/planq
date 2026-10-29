---
paths:
  - "dev-backend/routes/**"
  - "dev-backend/services/**"
  - "dev-backend/middleware/**"
  - "dev-frontend/src/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 워크스페이스 단일 정본 계약

## 워크스페이스 단일 정본 계약 — 한 창에는 한 워크스페이스 (2026-09-11 박제)

> Irene: *"모든 페이지가 하나의 워크스페이스로만 연결되어야지."* · *"절대 데이터 새면 안돼."*
> 설계 정본: `docs/WORKSPACE_SCOPE_DESIGN.md` (v2)

1. **정본은 `users.active_business_id` 하나다.** 창은 부팅 때 사본을 들고 있다. 사본이 틀리면 창이 틀린다 —
   서버 `routes/auth.js pickActiveBusinessId` 가 NULL·비멤버 값을 멱등 자가치유한다.
2. **서버는 범위를 추측하지 않는다.** `business_id` 가 없으면 첫 소속으로 떨어뜨리지 말고 400/403.
   `req.user.active_business_id` 를 읽는 새 코드는 가드 `--category=wsscope` 래칫이 막는다.
   ★ **창은 자기 워크스페이스를 `X-Workspace-Id` 로 싣는다** (2026-09-11 단계 3~5 — `apiFetch`·`apiUpload`, 같은 출처만).
   범위 인자가 없는 라우트는 `middleware/workspaceContext.requestScope(req, 명시값)` **한 함수**로 채운다:
   명시값 → 헤더==정본 → **헤더≠정본이면 409 `workspace_stale`**(창은 `WorkspaceSyncGuard` 가 따라간다) → 헤더 없음(옛 번들)만 종전 동작.
   엔티티 id 라우트·`/api/auth/*` 는 헤더를 보지 않는다(보류 창의 편집 보호). 옛 번들 호환 분기는 로그 `[wsctx] summary` 의
   `legacy` 가 0 이 되면 **그 파일 한 곳에서** 지운다. `req.workspaceCanonical` 을 판정 모듈 밖에서 읽는 것도 가드가 막는다.
   명시값≠헤더(Q3 mismatch)는 **관찰만** 한다(`[wsctx] mismatch`) — 목록·집계 분류 전에 막으면 의도된 교차 조회가 깨진다.
3. **전환은 모든 창에 전파된다** — `WorkspaceSyncGuard` 는 **App 루트 한 곳**(ModeGate 옆). ShellApp·ChromeOverlays
   어느 한 트리에만 두면 데스크탑 메인 창(TabAppShell)에서 안 돈다(2026-09-11 실측). 회귀: `--suite wssync`.
4. **id 로 여는 상세는 항목의 워크스페이스를 확인한다.** 엔티티 라우트는 항목 자기 워크스페이스 권한만 보므로(설계 C3)
   화면이 막는다 — `utils/workspaceMatch.isOtherWorkspace` + `DetailFallback status="other_workspace" businessId=…`
   (내용은 그리지 않고 전환 안내만). 새 상세 화면도 같은 두 줄을 넣는다.
   ★ **문이 두 종류다 (2026-09-11 2차).** URL 에 워크스페이스가 **없는** 문(`/api/tasks/:id`·`/api/posts/:id`)은 남의 내용을 200 으로 준다 → 위 두 줄.
   URL 에 **현재 워크스페이스를 넣는** 문(캘린더·메일·Q info·파일·청구·고객)은 새지 않는 대신 **404** 라 "찾을 수 없음"(또는 침묵)이 된다 →
   404 를 받으면 `findOtherWorkspaceOf(kind, id, 현재)` 로 **서버 한 곳**(`GET /api/entity-workspace/:kind/:id` — 멤버 이상·business_id 만·그 외 전부 404)에 묻는다.
   목록에서 골라 여는 화면은 `hooks/useDirectDetail` + `components/Common/DetailFallbackDrawer` 한 벌로(베끼지 않는다). 회귀: `--suite detailopen` 3폭.
5. **워크스페이스 간 전환은 보던 경로를 새 범위 탭에 싣지 않는다**(`tabStore.setTabScope`). 키가 갈려도 **내용**이 섞이면 누수다.
6. **격리 점검은 두 축으로 나눠 판정한다** — ①비소속자(남의 워크스페이스, 403) ②같은 사람의 다른 워크스페이스 섞임(화면).
   200 을 곧 누수로 단정하지 말고 응답 id 를 DB 와 대조한다(today-review 비소속 200 은 빈 응답이었다).
7. **알림(종)은 현재 워크스페이스 + 플랫폼 공지만** (Q7, 2026-09-11) — `/api/notifications{,/unread-count,/read-all}?business_id=` 세 라우트가
   `notificationScope` **한 함수**를 쓴다(수와 목록이 갈라지지 않게). 인자가 없으면 **플랫폼 공지만** — 가장 좁은 쪽으로 떨어진다.
   화면은 `hooks/useNotifications` 한 곳에서 범위를 붙인다.
   ★ **도착 카드(토스터)는 범위가 아니다** (2026-10-23, Irene «데스크탑앱에는 안 왔어 … 지금 보는 워크스페이스가 아닌 경우만 표시») —
   내가 멤버인 다른 워크스페이스의 `notification:new` 도 띄우고(채팅류 포함 — 그 대화방엔 join 안 해 두 번이 안 된다) 제목 위에 워크스페이스 이름,
   누르면 `utils/workspaceLink.enterWorkspaceLink` 로 전환해 연다. 종 목록·숫자는 그대로 현재 범위.
   ★ 모두 읽음 소켓은 범위를 싣는다 — 받는 창은 0 으로 덮지 말고 자기 범위로 다시 센다.

### 같은 날 박제한 술어 단일 원천
- **컨펌 단계** — `services/reviewStage.js stageWhere/inStage/stageOf` · `utils/reviewStage.ts inReviewStage`.
  외부컨펌(external_review)은 **단계 표시**이고 리스트업 조건을 바꾸지 않는다(직전 상태 `hold_prev_status` 로 판정).
  `status IN ('reviewing','revision_requested')` 를 손으로 새로 쓰지 않는다 — 7곳 복사본이 외부컨펌에서 전부 사라졌다.
- **검색 강조** — `utils/searchMatch`(FE)·`dev-backend/utils/searchMatch.js`(BE)가 같은 규칙(NFC·공백무시·토큰 ≤4).
  결과 행은 `HighlightText`, 행에 안 보이는 칸에서 맞았으면 `MatchReason`. 서버 `match.snippet` 에 본문 원문·secret 값 금지.
- **새 소식 읽음** — `whats_new_reads`(개별) + `users.whats_new_seen_at`(모두 읽음). 드롭다운을 **여는 것만으로는 읽음이 아니다**.

---

### 워크스페이스 삭제 (2026-10-29 · 설계 `docs/WORKSPACE_DELETION_DESIGN.md` · Fable 설계 판정)
- 대표(owner_id)만 · 비밀번호 + 이름 입력 · soft(`deleted_at`) + 30일 `purge_after` → `services/workspacePurge` 가 파일·연결·고객 연락처 정리(행·청구·감사는 남김).
- **사유가 갈린다** — `deletion_reason` `account_deletion`(계정 탈퇴 동반) / `owner_request`(대표 삭제). 복구 문은 각자 자기 사유만 되살린다.
- **cron 은 지운 워크스페이스를 건너뛴다** — `services/workspaceAlive`(filterAliveRows·aliveBusinessWhere). server.js 가 부르는 새 서비스가 여러 행을 고르면 그 술어를 쓰거나 `// cronalive-exempt: 이유` — 가드 `--category=cronalive`(HARD).
- 삭제·복구는 `middleware/workspaceAlive.invalidate()` 를 부른다(30초 캐시). 열린 창은 소켓 `workspace:deleted` + 404 `workspace_deleted`(business_id 동봉) 두 길로 옮긴다(`WorkspaceSyncGuard` ⑥).

