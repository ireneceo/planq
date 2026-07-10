# PlanQ 온보딩 — 새 개발자/AI 단일 진입 문서

> **목적:** 이전 개발자(사람이든 AI든)가 없어도, 이 문서 하나에서 출발해 안전하게 기여할 수 있게 한다.
> **읽는 순서:** 이 문서(10분) → `/opt/planq/CLAUDE.md`(불변식 원본, 필수) → `DEVELOPMENT_PLAN.md` 앞 100줄(최근 흐름).
> 최종 갱신: 2026-07-10 (Fable 아키텍처 감사 사이클). 수치는 그 시점 실측.

---

## 1. 시스템 지도 (30초)

| 구성요소 | 위치 | 포트/식별자 | 스택 |
|---|---|---|---|
| Frontend | `/opt/planq/dev-frontend` (빌드→ `dev-frontend-build`) | dev.planq.kr | React+TS+Vite+styled-components |
| Backend | `/opt/planq/dev-backend` (엔트리 `server.js` 만) | 3003, PM2 `planq-dev-backend` | Express+Sequelize(MySQL 8)+Socket.IO |
| Q Note | `/opt/planq/q-note` | 8000, PM2 `planq-qnote` | Python FastAPI (별도 프로세스, 자체 SQLite 세션) |
| DB | planq_dev_db / planq_admin | MySQL | 테넌트 축 = `business_id` |
| 운영 | 87.106.78.146 (planq.kr, port 3004) | rsync 배포 (`scripts/deploy-planq.sh`) | 운영엔 git 없음 |

**같은 서버에 PurpleHere POS 가 공존한다 (`/var/www/*`, PM2 `dev-backend`, purple_dev_db). 절대 접촉 금지** — `.claude/hooks/safety-guard.sh` 가 차단하지만, 훅이 없는 환경에서도 지켜야 한다.

규모 실측 (2026-07-10): routes 57개(총 3.3만줄) · models 109개 · services 85개 · middleware 11개 · 프론트 Route 99개(lazy 87) · i18n 네임스페이스 28개(ko/en).

## 2. 진실의 원천(SSOT) 지도 — "어디에 뭐가 적혀 있나"

| 질문 | 보는 곳 |
|---|---|
| 지켜야 할 규칙·불변식 전체 | `CLAUDE.md` (운영 안정성 17원칙 포함 — **규칙의 유일한 원본**) |
| 지금까지 뭘 했고 다음이 뭔가 | `DEVELOPMENT_PLAN.md` (매 사이클 상단에 append, /개발완료 가 강제) |
| 이번 세션 이어받기 | `.claude/session-state.md` |
| 기능별 설계 | `docs/*_DESIGN.md` (60+ 문서, 1문서=1주제) |
| 권한 체계 | `docs/PERMISSION_MATRIX.md` (4-Layer: role → 워크스페이스 토글 → 메뉴권한 → 자원 owner) |
| 반복 함정·패턴 (사람 기억 대체) | `/home/irene/.claude/projects/-opt-planq/memory/MEMORY.md` + 링크된 개별 md |
| 검사 하니스 설계·오탐 사례 | `docs/qa/INSPECTION_PLAYBOOK.md`, `docs/qa/FEEDBACK_REGRESSIONS.md` |
| UI 규칙·색상 | `dev-frontend/UI_DESIGN_GUIDE.md`, `COLOR_GUIDE.md` |

> ⚠️ memory 디렉토리는 Irene 계정 홈에 있다. 접근 불가한 실행자는 CLAUDE.md + 이 문서 + docs/ 만으로 작업 가능해야 하며, 핵심 함정은 §7 에 요약돼 있다.

## 3. 자동 가드 3축 — "기억이 아니라 기계가 지킨다"

| 축 | 명령 | 잡는 것 | 게이트 |
|---|---|---|---|
| 런타임 헬스 | `cd dev-backend && node /opt/planq/scripts/health-check.js` | PM2·API·인증·Q Note CRUD·LLM·소켓 room auto-join·raw select/POS색/네이티브팝업 린트 | exit 0 필수 (/검증·/개발완료 0단계) |
| **정적 불변식** | `node scripts/guard-invariants.js` | mock 잔재·i18n 하드코딩(래칫)·ko/en 키 패리티·무스코프 쿼리(래칫)·pagination(래칫)·notify/broadcast/costGuard/재무 owner 가드(잠금)·신규 god-file(래칫) | exit 0 필수 |
| 브라우저/카나리 | `node scripts/e2e/run.js --suite mobile,crosscut,l1,tenant` | 모바일 키보드 가림·표시명 누출·L1 개인파일 누출·**멀티테넌트 403 실증** | exit 0 필수 |
| 프론트 빌드 | `cd dev-frontend && npm run build` (**run_in_background 필수**) | tsc -b 실빌드 (noEmit 통과≠빌드 통과) | EXIT 0 + `error TS` 0 |

**래칫(ratchet) 규약:** `scripts/guards-baseline.json` 이 기존 부채를 동결한다. 신규 위반만 실패. 부채를 줄였으면 `--update-baseline` 으로 조여라(늘리기 위한 재기록은 금지 — diff 리뷰에서 걸러야 한다). 베이스라인 수동 편집 금지.

## 4. 생명선(고위험) 코드 지도 — 임의 수정 금지, Fable 게이트 대상

| 영역 | 파일 | 왜 |
|---|---|---|
| 멀티테넌트 격리 | `dev-backend/middleware/access_scope.js` (596줄, getUserScope/listWhere 계열) | 전 라우트의 격리 단일원천. c57d672 실누출 전례 |
| 결제·구독 | `services/billing.js`, `routes/stripeWebhook*.js`, markPaymentPaid/markInvoicePaid/markInstallmentPaid 단일착지 | SaaS결제↔Q Bill 절대혼동금지 5불변식 (`docs/SAAS_BILLING_VS_QBILL_SEPARATION.md`) |
| 증빙 발행 | receiptsDue 단일원천 (`routes/invoices.js` 계열) | 컴플라이언스 큐 — 세금계산서 익월10일/현금영수증+7일 |
| Task status 전이 | `routes/task_workflow.js` | 전이 라우트는 notify/broadcast/focus sync 를 **직접** 호출해야 함 (side-effect 우회 구조) |
| 인증·보안 경계 | `middleware/auth.js`, `security.js`, `menu_permission.js`, server.js 라우터 마운트 순서 | 공개 라우트 추가/순서 변경 = Fable 게이트 |

기준 원문: CLAUDE.md "Fable 검증 게이트" 섹션. 하나라도 해당하면 개발자 판단으로 머지하지 말고 게이트를 요구하라.

## 5. 아키텍처 결(conventions) — 코드가 따르는 패턴

**백엔드**
- 라우트: `express.Router()` + `authenticateToken` (684개 라우트 정의 중 625회 적용 실측). 비즈니스 데이터는 `+ checkBusinessAccess`(= `attachWorkspaceScope({memberOnly:true})`). 메뉴 단위는 `requireMenu(menu, level)`.
- 인증 없는 파일은 6개뿐(공개: app_download/blog/platform_public, 웹훅: stripe×2, 내부: internal.js=`x-internal-api-key`). **새 공개 라우트 = Fable 게이트.**
- 응답: `successResponse/errorResponse/paginatedResponse` (54/57 파일). 새 코드에서 `res.json({success:...})` 직접 쓰지 말 것.
- 에러: try/catch + `next(err)` 중앙 핸들러 (49/57 파일). 로컬 console.error 패턴은 레거시.
- association 은 **전량 `models/index.js` 집중** (361개). 새 모델도 index.js 에서만 연결.
- 데이터 변경 라우트 = ①`business_id` WHERE ②AuditLog ③`io.to('business:N').emit` broadcast ④상태전이면 notify — 4종 세트 (CLAUDE.md §13·§16).
- list GET = `parsePagination` + `paginatedResponse` (CLAUDE.md 표준 코드블록 복사).

**프론트엔드**
- API 는 `apiFetch`(AuthContext export) 단일 관문 — axios 없음, raw fetch 는 비인증 공개페이지만.
- 페이지 골격은 `PageShell`/`PanelHeader`, 셀렉트는 `PlanQSelect`, 드로어는 `DetailDrawer`+3훅(useBodyScrollLock/useFocusTrap/useEscapeStack), 버튼은 `ActionButton` 3톤. 직접 styled 헤더/셀렉트는 가드가 잡는다.
- 문자열은 처음부터 ko/en JSON + `t()`. 신규 네임스페이스는 `i18n.ts` ns 등록 (가드가 잡는다).
- 실시간: mount 시 socket join → backend broadcast → listener(250ms debounce silentLoad) → `useVisibilityRefresh` 안전망. 4요소 전부 (CLAUDE.md §16 체크리스트).

## 6. 표준 작업 사이클

```
/개발시작  →  (설계: 중규모↑는 승인 필요, 대규모는 /기능설계)
→ 구현 (첫 커밋부터 실 API — mock 절대 금지)
→ /검증   (0단계: health-check + guard-invariants + e2e 스위트 → 10단계)
→ /개발완료 (DEVELOPMENT_PLAN 기록 + 문서/위키 갱신 + 커밋/푸시 + 백업)
→ 운영 반영은 Irene 이 /배포 를 명시했을 때만
```

- 검증 없이 "완료" 보고 금지. 코드 리뷰만으로 완료 금지 — 실 HTTP 호출로 증명.
- 임시 테스트 스크립트는 `dev-backend/test-*.js` → 실행 → **반드시 삭제**, 시드 변경은 try/finally 원복.
- 커밋은 자유(idle 자동커밋도 있음), **push 는 /개발완료·명시 지시에서만, 배포는 /배포 에서만.**

## 7. 상위 함정 목록 (전임자가 밟은 지뢰 — 요약)

1. **sync-database.js 는 컬럼 추가만** — ENUM 변경·일부 JSON 컬럼은 운영 수동 ALTER + idempotent 백필 동반. MySQL 인덱스 64키 한도("Too many keys") 는 사전 ALTER 로 회피.
2. **PM2 는 lua 계정에 있다** — `pm2 jlist` 만 보면 false negative. `sudo -n -u lua pm2 jlist` 합쳐 확인 (health-check 가 이미 그렇게 한다).
3. **빌드 검증은 실 exit code** — `npm run build | tail` 은 실패를 가린다. `${PIPESTATUS[0]}` 또는 파일 리다이렉트 후 `echo $?`.
4. **신규 helper 통과 ≠ 옛 데이터 호환** — 운영 옛 row sample 1건 검증이 통과 요건 (절대 URL 42건 회귀 전례).
5. **nginx sites-enabled 는 복사본** — sites-available 편집은 무효. `nginx -T` 로 실효 설정 확인.
6. **`plan.fileSizeLimit` 는 유령함수** — 업로드 게이트는 `plan.can('upload_file', {size, external})` + BusinessStorageUsage 집계.
7. **Express 라우트 순서** — literal(`/archived`) 을 param(`/:id`) 보다 먼저. 새 라우트 404 면 이것부터 의심.
8. **Sequelize `update({x: x+1})` 후 응답에서 또 +1 금지** (더블 증가), `toJSON` 전역 override 가 created_at 매핑·`*_enc` redact 를 담당 — 응답에서 `_enc` 재계산 금지.
9. **q-note 는 별도 프로세스** — Node socket.io 없음. 프론트 동기화는 window CustomEvent 패턴. 프론트 API base 는 `/qnote/api` (bare `/api` 는 HTML 404). JWT 에 role 없음.
10. **grep 은 ugrep** — 일부 정규식 escape 가 GNU grep 과 다르다. 가드/검사류는 node 스크립트로 작성돼 있는 이유.
11. **모바일 뷰포트** — 전역 100vh/dvh·body 고정 금지. 키보드 업 시 인플로우 배너는 `body[data-keyboard-up='1']` 계약 + `@media(max-width:768px)` 게이트로 억제.
12. **하니스 CDP 함정** — `setDeviceMetricsOverride` 에 screenOrientation 넣지 말고, 판정 후 `clearDeviceMetricsOverride` 쓰지 말 것 (`docs/qa/FEEDBACK_REGRESSIONS.md`).

## 8. 첫 기여 전 30초 체크리스트

- [ ] `CLAUDE.md` 를 읽었다 (특히 mock 금지·검증 필수·운영 안정성 17원칙·Fable 게이트 기준)
- [ ] 3축 가드가 현재 green 인지 확인했다: `health-check` + `guard-invariants` + `e2e --suite l1,tenant`
- [ ] 내 변경이 생명선 영역(§4)을 건드리는지 판단했다 → 건드리면 Fable 게이트/Irene 승인
- [ ] 신규 라우트면: authenticateToken·business_id·pagination·broadcast·notify·AuditLog 체크
- [ ] 신규 UI 면: PageShell/공통 컴포넌트·ko/en JSON·data-testid·실시간 4요소 체크
- [ ] 완료 전: 실 API 호출 증명 + `/검증` + 테스트 스크립트 삭제·시드 원복
