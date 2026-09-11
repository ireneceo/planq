# 워크스페이스 단일 정본 — 설계 (v2)

> Irene 2026-09-11:
> *"아무것도 없는 워크스페이스에서 이런 안내가 확인필요에 나와. 지연 업무 9건이 쌓여 있어요 … 오늘의 업무 리뷰 … 채팅 새 메시지 20건"*
> *"팝아웃에서 업무리스트가 워크스페이스 바꾸니까 다 없어졌는데 다시 바꿔도 돌아가지 않아. 워크스페이스 바뀌는게 팝아웃에도 연결되어서 저장되어야지. **모든 페이지가 하나의 워크스페이스로만 연결되어야지.**"*
> *"고치는 걸 왜 자꾸 단편적으로 해? **구조 자체를** 페이지 자체의 모든 데이터를 메뉴 자체를 제대로 적용해서 수정해야지"*

**상태: v2 — Fable 설계 게이트 v1 FAIL(2026-09-11) 필수 수정 반영 · Q4·Q7 Irene 결정 완료.**
**진행: 단계 0 ✅ · 단계 1 ✅(실HTTP 10/10 · wsscope 래칫 베이스 11 · 양성 대조군 확인) · 단계 2 구현 완료(카나리 `--suite wssync` 6/6 · 루프 안전망 대조군 2/2) · 단계 0~2 Fable PASS·커밋 `a276a321`.
단계 6 일부 선행(2026-09-11, 미커밋): **Q6 상세 전환 안내** — `DetailFallback status='other_workspace'` + `OtherWorkspaceNotice` + `utils/workspaceMatch` 를 업무 드로어·프로젝트 상세·문서·Q Note 세션·메모 팝아웃에 적용 · **탭 범위 섞임 수리**(`tabStore.setTabScope` 워크스페이스 간 전환은 현재 경로를 새 범위에 싣지 않음) · 전환기 숫자 제거(Irene 결정). 남음: Q Talk 대화(서버가 대화의 워크스페이스를 안 줌) · Q7 알림 현재 워크스페이스만 · 단계 3~5.**
> ★ 발견(미수리): q-note 는 JWT 의 `businessId` 클레임으로 워크스페이스를 읽는데 Node access token 에는 그 클레임이 없다 → q-note 쪽 L3/L4 같은 워크스페이스 공유 분기가 비소유자에게 **항상 불통**(`q-note/middleware/auth.py:22`, `services/authTokens.js:70`).

> **단계 2 에서 카나리가 잡은 결함 2건 (2026-09-11)**
> - **가드가 데스크탑 메인 창에 없었다** — `ModeGate` 가 로그인 데스크탑 앱 경로를 `TabAppShell`(전역 오버레이 `ChromeOverlays`)로, 그 외를 `ShellApp` 으로 보낸다. 가드를 ShellApp 에만 두어 팝아웃은 따라오고 메인 탭 창은 메시지를 받고도 무반응(청크 로드 0). → **App 루트(`ModeGate` 옆)에 한 번** 마운트. Router 불필요.
> - **루프 안전망이 정상 왕복을 막았다** — "10초 안 두 번째 재부팅 금지" 가 A→B→A 빠른 전환에서 팝아웃을 B 에 남겼다. 루프의 신호는 "방금 X 로 재부팅했는데 또 X" 이지 "빨리 두 번" 이 아니다. → 같은 대상 10초 금지 · 다른 대상은 30초 4회까지(`sessionStorage pq_ws_reboots`).
(R=1 인증/권한 미들웨어·멀티테넌트 격리 · S=1)

---

## 0. 왜 반복되나 — 감사로 확인한 사실 (2026-09-11, Fable 표본 재확인)

격리 누수를 이틀 사이 **네 번 따로** 고쳤다(확인필요 목록 → 안내 카드 → 오늘의 리뷰 채팅 → 팝아웃).
원인은 화면이 아니라 **구조에 정본·전파·기본값·가드가 없는 것**이다.

| 층 | 지금 | 근거 |
|---|---|---|
| **정본** | 서버 `users.active_business_id` 사용자당 1개. 창은 **부팅 때 한 번** 복사(`user.business_id`, 88곳/55파일) | `models/User.js:178` · `routes/auth.js:134-146` · `AuthContext.tsx:573` |
| **정본의 구멍** | **로그인은 컬럼을 쓰지 않는다**(쓰는 곳: 가입 `oauth/core.js:144`·생성 `businesses.js:126`·전환 `auth.js:905`). `/auth/me` 는 NULL/무효면 `workspaces[0]` 로 **대체해서** 내려준다. dev 실측 컬럼 NULL 인 활성 사용자 88명(멤버십 보유 45·Client 12). 멤버 해제 시 컬럼 잔존(SET NULL 없음) | `auth.js:134-137` · Fable 실측 |
| **전환** | `switch-workspace` 가 컬럼만 바꾸고(emit·토큰 재발급 없음) **누른 창만** 리로드 | `auth.js:879-912` · `WorkspaceSwitcher.tsx:118-162` |
| **전파** | **없다** (user:N room 미사용 · 워크스페이스용 BroadcastChannel/storage 0) | `server.js:223` · `PopoutBridge.tsx` |
| **팝아웃** | 부팅값만 읽음 → 우연한 재부팅 때 그 순간 서버값, 되돌려도 모름(dev ws3 44건/ws88 0건). `MemoStandalonePage.tsx:41-48` 는 **세션의 business_id 로 자기 범위를 덮는다** | `TaskPopoutView.tsx:123` |
| **서버 기본값** | 첫 멤버십(`cue.js:88-109`) · 합산(`dashboard.js /todo` — Client 포함, `today_review myWorkspaces` — **Client 제외**, 두 합산이 서로 다름) · 컬럼 직접 폴백(`tasks.js:81,197,275,323` · `task_templates:47,79` · `task_priority:45` · `task_tags:68` · `posts.js:1100`) · **추측값 저장**(`push.js:142,162,196,212` · `inquiries.js:52`) · 조건 없음(`external_connections.js:131 /me/external-connections` 1곳 · `internal user-project-ids`) | Fable §1 |
| **범위 미적용 조회** | `collectInvites` 이메일만(**Q1: 의도 유지**) · `cue_context.js:228` 개인 캘린더 user_id 만 · 알림 3 라우트 user_id 만(`notifications.js:329,349,373`) · `focus/start` body business_id 멤버십 미검사 · `feedback.js:87` 존재하지 않는 `req.user.business_id` → 항상 NULL | |
| **프론트 호출 952곳** | A 422 · **B 7**(알림 3 전역 · Cue 실행 · 피드백 · 추정 미리보기 · 받은 서명) · **C 37**(프로젝트 상세 등 엔티티 워크스페이스로 열림) · 어긋남 버그 2(`PostsPage.tsx:753`, `TaskAttachments.tsx:36`) | 감사 ② |
| **요청 공통 수단 · 가드** | 없다 | |

---

## 1. 계약

### C1. 정본은 하나 — 해석 함수도 하나
- **현재 워크스페이스 = `resolveActiveBusinessId(user)`** — `auth.js getUserWithBusiness` 134-137 의 판정(컬럼이 유효한 멤버십/활성 고객이면 그것, 아니면 첫 워크스페이스)을 **한 함수로 뽑는다.**
  `/auth/me` · `refresh` · `switch-workspace` · `workspaceContext`(C3) 가 **같은 함수**를 부른다.
- **자가 치유**: me/refresh 에서 해석값 ≠ 컬럼이면 컬럼을 해석값으로 **멱등 UPDATE**. 그래야 컬럼이 정본일 수 있다(NULL 88명·해제 잔존).
- 창의 `user.business_id` 는 **사본**. 사본 ≠ 정본이면 그 창은 틀린 상태다(C3·C4).
- **다른 기기**: Q4 결론 — **모든 기기 같이**(Irene 2026-09-11).

### C2. 창은 자기가 믿는 워크스페이스를 요청에 싣는다
- `apiFetch` **와 `apiUpload`(XHR)** 가 로그인 상태면 `X-Workspace-Id: <사본>`. apiFetch 는 모듈 함수라 사본을 `accessToken` 처럼 **모듈 변수로 미러**한다.
- 사본이 없으면(로그인 직후 `/auth/me` 전) 헤더 없음 = 종전 동작.
- 헤더와 무관한 문(설계 대상 아님): `<img src>` kind 토큰 · blob 다운로드 · Socket.IO(C7) · q-note FastAPI(세션의 business_id 로 과금 — 전환해도 녹음 중 세션은 옛 워크스페이스에 적립, **의도**) · **MCP/API 토큰은 Express 를 거치지 않는 별도 문**(토큰의 business_id 로 scope, `mcp/server.js:33-39`).

### C3. 서버는 **범위를 헤더에서 채우는 요청만** 거절한다
- `authenticateToken` 직후 `workspaceContext`:
  - 정본 = `resolveActiveBusinessId(req.user)`. 헤더가 있고 정본과 다르면 **`req.workspaceStale = true`**, 같으면 `req.workspaceId = 헤더`.
  - 범위 추출은 기존 `workspaceAlive.js extractBusinessId`(params/query/body) 를 **재사용**한다 — 두 벌 금지.
- **409 를 내는 곳은 둘뿐**:
  1. **`workspace_stale`** — 명시 범위가 **없어서** `req.workspaceId` 로 범위를 채우는 요청인데 stale 인 경우. 프론트는 C4 전환 적용.
  2. **`workspace_mismatch`** — **목록·집계 라우트**에 명시 범위가 왔는데 헤더와 다른 경우(Q3). 프론트는 **재부팅하지 않는다**(화면이 Q6 로 안내).
- **엔티티 id 로 주소되는 요청**(`/api/tasks/:id`, `/api/posts/:id` 와 그 하위 등)은 **헤더를 무시**한다 — 권한은 이미 엔티티의 business_id 로 판정한다. 그래야 보류 창(C4)의 **편집·자동저장이 계속 저장**되고, 막는 것은 목록 누수뿐이다(신고는 전부 목록·집계였다).
- 예외 경로: `/api/auth/*` · 공개/게스트/토큰 · `/api/internal/*`.
- **도입은 관찰 모드부터**(§5 단계 3) — 불일치를 로그만 남기고 1~2일 뒤 활성.

### C4. 전환은 모든 창에 전해진다 — 멱등하게
- `switch-workspace` 성공 → `io.to('user:N').emit('workspace:switched', { user_id, business_id })` + 같은 브라우저 `BroadcastChannel('planq:workspace')` 도 `{ user_id, business_id }`.
- 수신(`applyWorkspaceSwitch`)은 **멱등**:
  - `user_id ≠ 내 id` → 버림(사칭 창·관리자 창이 같은 브라우저).
  - `business_id === 사본` → 버림(자기 수신·전환 누른 창).
  - 전환을 누른 창은 `switching` 모듈 플래그 동안 409·수신을 무시한다(진행 중 요청의 이중 리로드 방지).
  - 그 외: `clearPageCache()` 후 **안전하면 즉시 재부팅** — 메인은 워크스페이스 첫 화면, **팝아웃·핀·관리자 범위 창은 제자리**. 입력·녹음 중(`BuildVersionGuard.isReloadSafe` 와 **같은 술어**)이면 **보류**: 상단 줄 "워크스페이스가 바뀌었어요 · 지금 전환" + **읽기 요청만 멈춘다(쓰기는 계속, C3)**.
  - 10초 1회 캡(치명-1 을 고치면 루프는 구조적으로 불가 — 캡은 안전망).
- 놓친 이벤트: **소켓이 끊겼다 복귀했을 때**와 14분 refresh 응답에서만 정본 비교(매 visibility 는 과함).
- **사칭(impersonate) 토큰은 `switch-workspace` 403** — 사칭 중 전환은 **대상 사용자의** 정본을 바꾸고 그의 창들을 재부팅시킨다.
- 핀(PiP): 홀더 창 body 의 `pipActive` 로 보류, PiP iframe 은 별도 문서라 자기 술어로 재부팅 — e2e 에 핀 케이스 필수.

### C5. 서버는 범위를 추측하지 않는다 — **C2 배포·옛 번들 소진 뒤에**
범위 결정 순서: ① 명시값(멤버십 검증) ② `req.workspaceId`(C3 검증 헤더) ③ 없으면 **400 `business_id_required`**.
제거: 첫 멤버십 · 전체 합산 · 컬럼 직접 읽기 · 조건 없음 · **추측값 저장**(push·inquiries 는 명시값 또는 NULL).
C2 이전에 지우면 깨지는 호출부: `CueActionCard.tsx:82` · `useCueChat.ts:97,146` · `CueHelpDrawer.tsx:418` · `AiTaskCreateModal.tsx:121` · `QTaskPage.tsx:1101` · `PostEditor.tsx:68`(조건부) · `ProfileIntegrationsPage.tsx:153`(조건부) · `TodoPage.tsx:97`·`DashboardPage.tsx:62`(bizId null 인 platform_admin → 빈 화면 처리).
합산이 **기능**인 곳은 `// wsscope-exempt: <이유>`: 전환기 배지 `unread-total-all` · 개인 보관함 `signatures/received` · 초대 `collectInvites`(Q1) · 플랫폼 관리자.

### C6. 범위를 받았으면 모든 수집기가 **처음 모을 때** WHERE 에 건다
(`collectSignatures`·오늘의 리뷰 채팅 전례.) 두 합산 모드의 멤버 정의가 달랐던 것(Client 포함/제외)도 `resolve` 계열 한 함수로.

### C7. 소켓 — 필터 헬퍼를 **분리**한다
- `onWorkspaceSocket(event, handler)`: payload 에 `business_id` 가 **있고** ≠ 현재 → 버림 / **없으면 통과**(재조회는 헤더 범위라 안전 — business room emit 중 business_id 없는 곳 25개).
- `onSocket` 원본은 **전역 이벤트만**(`user:N` 알림·핀·포커스·`workspace:switched` · 전환기 합산 배지 `useUnreadTotal`) — `// wsscope-exempt` 주석.
- `io()` 직접 호출(`usePostPresence.ts:18`)은 가드 대상.

### C8. 가드 — 반증 가능하게
- **BE 정적 래칫**(`--category=wsscope`): `active_business_id` 직접 읽기 · `BusinessMember.find*({user_id,…})`+`order id ASC` 첫 멤버십 · "business_id 없으면 전 멤버십" 분기 — 현재 부채 동결 후 감소만. **양성 대조군**: `cue.js:99-107` 폴백 원복 시 FAIL.
- **FE 정적 래칫**: 인증 요청 직접 `fetch(` — 허용 접두(`/api/auth/` · `/api/guest/` · `/public/by-token` · `/api/blog` · `/api/inquiries` · q-note `${BASE}`) 밖은 래칫. `io()` 직접 호출 포함.
- **런타임 카나리**: 범위 라우트 목록을 무인자·무헤더로 쳐서 **전부 400**(C5 이후). 양성: 한 라우트 폴백 원복 시 FAIL.
- **e2e `--suite wsscope`** — 픽스처: 임시 계정 + 워크스페이스 2 + Client 역할 1(`canary-scope-tabs.js:63-73` 확장, 약관 버전 포함):
  ① 창 A 전환 → 창 B·팝아웃·**핀(PiP)** ≤2s 재부팅 ② 되돌리면 되돌아온다(신고 재현) ③ stale 헤더 목록 요청 409 / 엔티티 PUT 200
  ④ 확인필요·인사이트·오늘의 리뷰·배지 B 에 A 데이터 0(양성: A 시드 → A 에만) ⑤ 입력 중 창은 줄만, 내용 보존, 편집 저장 200
  ⑥ 컬럼 NULL 계정 로그인 → 409 루프 0 · 컬럼 자가치유

---

## 2. 적용 대상 (서버)

| 위치 | 지금 | 바꿈 | 단계 |
|---|---|---|---|
| `auth.js getUserWithBusiness` 134-137 | 판정이 이 안에만 | `resolveActiveBusinessId` 추출 + me/refresh 자가치유 | 0 |
| 미커밋: `insights.js` · `services/insights.js` · `today_review.js` 채팅 · `InsightCards` · `TodoPage` | | 흡수(C5·C6 정합 — Fable 확인) | 1 |
| `focus.js:118-142 /start` | body business_id 멤버십 미검사 | 멤버십 검증 | 1 |
| `feedback.js:87` | 없는 필드 → NULL | 명시값/헤더 | 1 |
| `push.js:142-212` · `inquiries.js:52` | 추측값 저장 | 명시값 또는 NULL | 1 |
| `services/cue_context.js:228` | 개인 캘린더 user_id 만 | business_id 추가 | 1 |
| `auth.js switch-workspace` | emit 없음 · 사칭 허용 | C4 emit · 사칭 403 | 2 |
| `middleware` `workspaceContext` | 없음 | C3 (관찰 → 활성) | 3·4 |
| `dashboard.js /todo` 합산 · `today_review myWorkspaces` 합산 | 무인자 합산(정의 다름) | C5 | 5 |
| `cue.js resolveBusinessId` | 첫 멤버십 · body 무시 | C5 | 5 |
| `tasks.js`·`task_templates`·`task_priority`·`task_tags`·`posts.js:1100` | 컬럼 직접 폴백 | `req.workspaceId` | 5 |
| `external_connections.js:131` · `internal user-project-ids` | 무인자 전체 | 인자 필수 | 5 |
| `notifications.js:329,349,373` | user_id 만 | Q7 결론대로 | 6 |
| 상세 응답 | business_id 보장 안 됨 | 모든 상세 응답에 `business_id`(Q6 판정용) | 6 |

## 3. 적용 대상 (프론트) — 호출 952곳 전수 분류 (감사 ②)

| 분류 | 개수 | 뜻 |
|---|---:|---|
| A 현재 워크스페이스를 넘김 | 422 | 뿌리는 대부분 `user.business_id` |
| **B 안 넘김** | **7** | 알림 3(전역) · Cue 실행 · 피드백 · 추정 미리보기 · 받은 서명 |
| **C 넘기지만 출처가 현재가 아닐 수 있음** | **37** | C-1 프로젝트 상세 · C-2 확인필요 드로어 · C-3 문서 공유·서명 모달 · C-4 통계 첫 워크스페이스 폴백 |
| U 사용자 전역 정당 | 72 | |
| 엔티티 id 전용 | 265 | |
| 공개·관리·죽은 래퍼 | 149 | |

| 위치 | 바꿈 | 단계 |
|---|---|---|
| `AuthContext` apiFetch · apiUpload | C2 헤더 · 모듈 변수 미러 · 409 처리 | 3·4 |
| `AuthContext` 수신 | C4 `applyWorkspaceSwitch`(멱등·user_id·switching 플래그·safe 술어·보류 줄·admin/팝아웃 제자리) | 2 |
| `WorkspaceSwitcher` | switching 플래그 | 2 |
| 팝아웃 3종 | AuthContext 경로로 따라옴 — **`MemoStandalonePage` 세션 범위는 Q6 대상** | 2·6 |
| `fetchTodo(bizId ?? undefined)` · `InsightsPage.tsx:31-33` 첫 워크스페이스 | 선택 인자·폴백 제거 | 5 |
| 어긋남 2(`PostsPage.tsx:753` · `TaskAttachments.tsx:36`) · `TodoPage.tsx:206/245` 갈림 | 엔티티 워크스페이스로 / 하나로 | 1 |
| `hooks/useDetailResource` + `DetailFallback` | Q6 "○○ 워크스페이스 항목 · 전환해서 열기" | 6 |
| 소켓 | `onWorkspaceSocket` 분리 | 6 |

## 4. 결론 (Fable v1 게이트)
| Q | 결론 |
|---|---|
| Q1 초대 | 전 워크스페이스 노출 유지(`wsscope-exempt`) — 워크스페이스 밖의 사용자 행동 |
| Q2 포커스 | 사용자 전역 유지 · 위젯에 세션 워크스페이스 표시 · `focus/start` 멤버십 검증 추가 |
| Q3 명시값≠헤더 | 목록·집계만 409 `workspace_mismatch`(재부팅 안 함) · 엔티티는 헤더 무시 |
| **Q4 다른 기기** | ✅ **Irene 2026-09-11: 모든 기기 같이** — 사람당 워크스페이스 하나. 어느 기기에서 바꿔도 다른 기기 창이 따라온다(입력·녹음 중이면 보류 줄) |
| Q5 보류 중 | 읽기만 멈춤, 쓰기는 계속 |
| Q6 다른 워크스페이스 엔티티 | `useDetailResource`+`DetailFallback` 한 곳 · 자동 전환 금지 · 사람이 "전환해서 열기" |
| **Q7 알림** | ✅ **Irene 2026-09-11: 현재 워크스페이스만** — 종 목록·안읽음 수·모두 읽음 = 현재 워크스페이스 + 플랫폼 공지(business_id NULL). ~~다른 워크스페이스는 전환기에 숫자~~ → **Irene 2026-09-11 추가 결정: "워크스페이스 선택하는 곳에는 알림숫자 필요없어" — 전환기 숫자(트리거·드롭다운) 제거** |

## 5. 구현 순서 — 각 단계 단독 배포 안전

| 단계 | 내용 | 검증 기준 |
|---|---|---|
| **0** | `resolveActiveBusinessId` + me/refresh 자가치유 | 로그인 후 그 사용자 컬럼 NULL 0 · `/auth/me.business_id === 컬럼` 100% |
| **1** | 미커밋 C6 수리 흡수 · focus/start 멤버십 · feedback · push/inquiries · cue_context · 어긋남 2 · **BE wsscope 래칫 신설(부채 동결)** | insights 무인자 400/유인자 200 · A 시드 → B 0(양성 A 에만) · 가드 양성 대조군 FAIL |
| **2** | C4 전파(emit·채널·applyWorkspaceSwitch·사칭 403) | e2e ①②⑤ + 핀 · ≤2s · 입력 보존 |
| **3** | C2 헤더(apiFetch·apiUpload) + C3 **관찰 모드** | 1~2일 운영 로그 stale ≈ 0 · 양성: 컬럼 손 변경 시 로그 1건 |
| **4** | C3 409 활성(범위-없음·목록만) + 보류 읽기 정지 | e2e ③⑥ · 보류 창 PUT 200 · 409 < 0.1%/일 |
| **5** | C5 폴백 제거(라우트별) — 옛 번들 소진 후 | 라우트마다 무인자·무헤더 400 / 헤더 200 · 런타임 카나리 |
| **6** | C7 소켓 헬퍼 · Q6 DetailFallback · Q7(승인 후) · 상세 응답 business_id | 합산 배지 유지 · 남의 워크스페이스 이벤트로 리로드 0 |

스키마 변경 없음 · 기능 플래그 없음(관찰 모드는 로그 분기, 기본값 꺼짐 스위치가 아님) · 되돌리기 = 코드 되돌리기.

## 6. R/S/F
R=1 · S=1 → 설계 v2 재게이트는 **단계 0·1 구현과 묶어서** 올린다(같은 기능 쪼개 올리지 않기).
