# PlanQ AI-네이티브 전환 구현 설계서

> 작성: 2026-07-11 (Fable 설계 게이트). 코드 무수정 — 검증 스크립트는 dev 에서만 실행 후 데이터 원복·스크립트 삭제 완료.
> 입력: `docs/FEEDBACK_BACKLOG_PLAN.md`(운영 피드백 19건) + `docs/PLANQ_AI_READINESS_AUDIT.md`(13축 4.9/10) + `docs/AI_NATIVE_TRENDS_2026.md`(H1~H5 반증 가설).
> 목적: 진단 3건을 **Irene 이 표 하나 보고 다음 할 일을 고를 수 있는** 단일 실행 설계로 수렴. 각 단계는 1~3일 사이클.

---

## A. 전략 결론 3줄

1. **지킨다** — ①대화→업무→청구→증빙 **단일 관계 그래프**와 그것을 걷는 권한 스코프 컨텍스트 빌더(`cue_context.js` + `access_scope.js`), ②한국 증빙 컴플라이언스 데이터 모델(receiptsDue·receipt_corrections), ③AI 산출물 1급 태깅 + `cue_usage` 비용 원장, ④"고객에게 나가는 것은 사람이 누른 뒤에만"(overdue_handler 로 처음 코드화된 원칙) — 이 4개가 해자의 전부다. LLM 호출부 자체는 해자가 아니다.
2. **버린다** — ①워크스페이스 KB 의 **상시 임베딩 RAG 경로**(운영 실측 코퍼스 527 bytes — 200K 토큰 기준의 0.07%. H3 압도적 참), ②Cue 쓰기의 "서비스 코드에 우연히 구현된 권한"(H1 참 — 검사 커버리지 결손), ③동시 실행에 뚫리는 청구 멱등성(H2 실증 — 2장 발행 재현됨), ④죽은 컬럼 119건 중 확정분(§H).
3. **새로 짓는다** — **사람과 Cue 와 외부 에이전트가 같은 문을 지나는 행동 계층(Action Layer)** 을 중심으로: LLM 게이트웨이 단일화 → 행동 계층 추출 → Cue 를 그 위에 태움(#81 과 동일 작업) → 얇은 MCP 읽기 서버. 워크플로 엔진·이벤트 스트림은 **최소안**(멱등키 + 통합 읽기 뷰)만 — Temporal/Redis/벡터DB 도입은 지금 규모에서 전부 과잉이다.

---

## B. 검증된 사실표 (H1~H5 — 2026-07-11 dev/운영 실측)

### H1. 에이전트 책임·권한 — **참 (권한 검사 커버리지 결손)**

**(1) Cue 는 `tasks.assignee_id` 에 실존한다.** dev DB 실측: `is_ai=1` User 에게 배정된 task **3건** (reviewing 2, not_started 1). 트리거 코드 `routes/tasks.js:514-517`(생성 시), `:1225-1228`(수정 시), 실행 검증 `cue_task_executor.js:156-159`(assignee===cue_user_id). Linear 가 명시적으로 피한 설계("delegate 이지 assignee 가 아니다 — human assignee 가 여전히 책임진다")를 정면으로 밟고 있다. **책임 주체가 AI 인 row 가 실존.**

**(2) 감사 로그만으로 "누구 지시로·누구 권한으로"를 재구성할 수 없다.** dev 실측 row:

```
audit_logs #900: user_id=13(Cue), action='cue.task_executed', target=Task 696,
  new_value={kind:'research', body_len:210, input_tokens:71, output_tokens:87}
audit_logs #657: user_id=11(Cue), action='cue.message', target=Message 514,
  new_value={mode:'draft', model:'gpt-4o-mini', confidence:0.31}
```

- 지시자: `cue.task_executed` 는 Task.created_by JOIN 으로 **간접** 복원 가능. `cue.message` 는 트리거한 고객 메시지 참조가 **없어 복원 불가**. revision 재실행(`task_workflow.js:429` revisionNote)의 반려자도 audit 에 안 남는다.
- 권한 근거: audit_logs 컬럼 실측 = `id, user_id, business_id, action, target_type, target_id, old_value, new_value, ip_address, created_at` — **on-behalf-of / acting_for / permission-basis 컬럼 자체가 없다.**
- 긍정 사실: Cue 행동과 사람 행동이 **같은 audit_logs 스키마**에 actor=cue_user_id 로 남는다(H5 의 3번 하위가설은 반증) — 원장 소급 구축이 불가능하지 않은 상태.

**(3) 권한 검사 커버리지 대조표** (공격 시나리오가 아니라 "사람 라우트에 있는 검사가 Cue 경로에 있는가"):

| 행동 | 사람 라우트 검사 | Cue 경로 검사 | 판정 |
|---|---|---|---|
| 메시지 발송 | authenticateToken + attachWorkspaceScope + canAccessConversation (`conversations.js:619,631`) | **0건** — `Message.create` 직접 (`cue_orchestrator.js:261`) | 결손 |
| task body 수정 | canEditBody(담당자/admin) + requireMenu (`tasks.js` PUT) | assignee===cue 검사만 (`cue_task_executor.js:156-159`) — §5.7 "body=담당자"와 **우연히** 정합 | 우연 정합 (구조 아님) |
| status → reviewing | reviewer 0명이면 400 `no_reviewers_assigned` (`tasks.js:1084`, `task_workflow.js:498`) | **우회** — 무조건 `status:'reviewing'` (`cue_task_executor.js:212-216`) | **문서화된 불변식 우회 실존** |
| cue_kind 지정 | 대응 라우트 권한 없음 | `task.update({cue_kind})` 직접 (`cue_task_executor.js:152`) | — |
| invoice 발행/결제마킹/삭제 | `assertInvoiceMutationOwner` owner_only (`routes/invoices.js`) | Cue 호출 코드 없음 — **"우연히 없음"이지 구조적 금지선 아님** | 금지선 부재 |
| 읽기 (컨텍스트) | 각 라우트 scope | **질문자 scope 로 격리** (`cue_context.js:192,232`) — 모범 | 양호 (비대칭의 좋은 쪽) |

**(4) 확정 실측 재확인**: `cue_task_executor.js`·`cue_orchestrator.js` 에 `access_scope`/`requireMenu` 호출 0건. `menu_permission.js:82` 는 role='ai' 의 API 진입을 차단 — 즉 Cue 는 **HTTP 로는 못 들어오고 서비스 코드로는 무제한**이라는 정확히 뒤집힌 구조.

**(5) cue_context 가시성 누락 (확정 사실 재확인 + 추가 발견)**: `getProjectSnapshot` 의 CalendarEvent 조회(`cue_context.js:84-93`)가 business_id+project_id 만 — vlevel(L1 개인) 필터 없음. **추가**: `getUserSnapshot` 의 events(`:117-122`)도 business_id 만으로 전 일정 로드 — 동일 무방비. 현재 노출 실데이터 0건이나 코드 경로 무방비.

### H2. durable execution / 멱등성 — **조건부 참 (순차=멱등, 동시=파괴, 크래시 창 실존)**

dev 실증 (테스트 데이터 전량 원복·스크립트 삭제 확인, 잔존 invoice 0):

| 시나리오 | 결과 | 근거 |
|---|---|---|
| `runClientSubscriptionBilling()` **순차 2회** | 청구서 **1장** (2회차 due=0) | next_billing_at 전진(`clientSubscriptionBilling.js:164`) |
| 같은 함수 **동시 2회** (`Promise.all`) | 청구서 **2장** (invoice 200, 198 — 번호 다름) | 두 실행 모두 전진 前 due 목록 로드 |
| `billOneSubscription` 같은 row 두 인스턴스 동시 | 청구서 **2장** (201, 203) | 상동 |
| `billOneProject` **순차 2회** (reload) | **1장** (2회차 `already_billed_this_month`) | `recurring_invoice.js:57` 가드 |
| `billOneProject` **동시 2회** | **1장 + 1건 crash** (`Validation error` = invoice_number unique 충돌) | 우연한 반쪽 방어 |

- **핵심 발견**: `clientSubscriptionBilling.js:134-140` 의 invoice_number 충돌 재시도 루프가 recurring_invoice 에서 우연히 작동하던 unique 방어를 **무력화**한다 — 안전망이 중복을 완성시킴.
- **크래시 창 (코드 판정)**: `Invoice.create`(`recurring_invoice.js:107` / `clientSubscriptionBilling.js:135`) 와 상태 전진(`:207` / `:164`) 사이에서 죽으면 다음 실행이 재발행. 멱등키가 DB 가 아니라 "실행 순서"에 있다.
- **동시 실행이 실제로 일어나는 경로**: 자정 setTimeout 체인(`server.js:450-507`) + 재배포 직후 재실행 겹침 / 향후 PM2 instances>1 / 수동 트리거 병행.
- **fire-and-forget 유실 (코드 판정)**: `executeForTask(task.id).then(...)`(`routes/tasks.js:517`) — PM2 재시작 시 실행 중이던 Cue 작업은 재시도 큐 없이 소실, task 는 이전 status 에 잔류. 이메일 fan-out 도 setImmediate 저널 없음(`recurring_invoice.js:146-181`) — "발송됐는지 알 수 없는 상태" 가능.
- **부분 반증**: `taskExtractorScheduler.js:120-150` 은 인메모리 타이머를 **1분 cron fallback + DB 상태(last_extracted_at)** 로 복구 — 추출 작업은 재시작에도 유실 안 됨. 이 패턴(DB 상태 기반 복구)이 durable 최소안의 사내 선례다.
- **처방은 Temporal 이 아니다**: §D-7 최소안(멱등키 UNIQUE + 트랜잭션 행잠금) 으로 충분.

### H3. KB 임베딩 RAG 과잉 — **압도적 참**

| 환경 | 워크스페이스 KB (business_id 있는 것) | 위키(공통, business_id NULL) |
|---|---|---|
| **운영** | biz1: **3청크 527 bytes** (전부) | 38청크 30KB |
| dev | biz3 21청크 7KB / biz6 8청크 212B / biz5 1청크 1B | 40청크 30KB |

- Anthropic 권고 기준 200K 토큰(≈800KB) 대비 운영 최대 워크스페이스 **0.07%**. "임베딩 파이프라인 + BLOB 코사인 + stale index" 전체가 현 규모에서 순수 유지비.
- "최근 200청크 윈도우"(`kb_service.js:224-227`)의 recall 파괴는 **현재는 미발동**(최대 21청크 < 200) — 지금의 문제는 recall 이 아니라 **과잉 복잡도**다. 단, 성장 시 201번째 청크부터 조용히 깨지는 시한폭탄인 것은 코드 사실.
- 판정: **워크스페이스 KB 는 코퍼스가 작을 때 전량 컨텍스트 주입이 정답** (§D-5 조건부 설계). 위키(30KB)도 동일 — FULLTEXT 는 유지(비용 0), 임베딩 재계산 루프가 제거 대상.

### H4. 외부 표면 0 — **참 (유통 채널 상실 맞음)**

재확인 grep (2026-07-11): MCP 관련 0파일 · x-api-key(비 Stripe) 0 · function calling(`tools:`) 0 · outbound webhook 0. raw `api.openai.com` fetch **12파일**(services+routes), `gpt-4o-mini` 하드코딩 **16파일**.
- 유통 채널 상실인가? **그렇다.** 2026 년 기준 외부 에이전트(Claude/ChatGPT/Copilot)가 고객 워크스페이스 데이터에 접근할 표준 통로가 MCP 로 수렴했고(Linux Foundation 이관, 전 벤더 클라이언트), Linear 사례처럼 **에이전트용 표면 = 에이전트들이 알아서 붙는 유통망**이다. PlanQ 는 JWT 브라우저 세션 외 진입로가 없어 해자(업무 그래프)가 고립 자산으로 작동 중.
- 단서: 2026-07-28 MCP stateless 개정 임박 → **얇게, 읽기 먼저** (§D-4).

### H5. 감사 파편화 — **참 (단, 절반은 이미 갖춰짐)**

- "지난 30일 워크스페이스의 모든 일" 단일 스트림 = **최소 6개 테이블 UNION** 실측 (dev 에서 쿼리 실행 성공): audit_logs + task_status_history + invoice_status_history + project_status_history + bill_events + messages.
- UNION 을 어렵게 만드는 실측 이질성: actor 컬럼명 **3종**(`user_id` / `actor_user_id` / `changed_by` / 메시지는 `sender_id`), task_status_history·bill_events 에 **business_id 없음**(JOIN 강제), bill_events 는 **polymorphic**(entity_type/entity_id) — 정적 FK JOIN 불가.
- 30일 row 실측(dev): audit 323 / invoice_status 11 / task_status 7 / bill_events 3 / 나머지 0 — **볼륨은 장난감 수준**이라 뷰 하나로 충분.
- **반증된 하위가설**: "Cue 와 사람이 다른 스키마로 기록된다" — 아니다. 같은 audit_logs 에 같은 형식으로 남는다(H1-(2)). 따라서 처방은 이벤트소싱 전환이 아니라 **통합 읽기 뷰** (§D-6).

---

## C. 2트랙 구조

**트랙1 = 운영 피드백 소진** (FEEDBACK_BACKLOG_PLAN ④⑤ 그대로 — 본 문서가 대체하지 않음):
배치0 Quick Win(status 5건+#85 SCR 버튼+문서정정) → 배치1 K1 첨부 provider(#134·#112b, Fable 게이트) → 배치2 소형버그 6건 → 배치3 레이아웃 4건 → 배치4 #138 리액션(Fable 게이트) → 배치5 설계 선행(#126 캘린더 양방향 · **#81 Cue 대화형 실행**).

**트랙2 = AI-네이티브 전환** (§D 의 7단계).

**겹침 (같은 작업, 두 번 하지 말 것):**

| 겹침 항목 | 트랙1 | 트랙2 | 판정 |
|---|---|---|---|
| **#81 Cue 대화형 실행** | 배치5 (신규 tool-use 아키텍처로 표기) | **= D-3(행동 계층) + D-1(게이트웨이) 완료 후 D-2.5 로 자연 구현** | #81 을 단독 개발하지 말 것. 트랙2 순서대로 가면 #81 은 "행동 계층에 툴 시그니처 씌우기"로 축소됨 |
| cue_context 가시성 | (없음) | D-0 | 트랙2 소속, 즉시 |
| 청구 멱등 | (없음 — 백로그는 "돈/보안 해당 건 없음"으로 판단했으나 H2 실증으로 승격) | D-7 | 트랙2 소속, 조기 |

---

## D. AI-네이티브 전환 단계 설계

> 순서 근거: **(0) 보안 구멍 즉봉 → (7) 돈 무결성 → (1) 모든 후속의 단일 지점 → (3) 가장 되돌리기 어려운 것 → (2) 그 위에 Cue → (4) 그 위에 MCP → (5)(6) 독립 저비용**. 각 단계 1~3일. Fable 게이트는 CLAUDE.md 5기준 대조 결과 명기.

### D-0. cue_context 가시성 필터 (0.5일) — 즉시

- **목적**: Cue 컨텍스트에 L1(개인) 일정이 흘러들 수 있는 무방비 경로 차단.
- **절단면**: `services/cue_context.js` 의 CalendarEvent 2개 조회(`:84-93` getProjectSnapshot, `:117-122` getUserSnapshot)에만 visibility 조건 추가. 다른 소스(taskListWhere/invoiceListWhere 경유)는 이미 격리 — 무수정.
- **신규/변경**: `cue_context.js` 1파일. 캘린더 라우트가 쓰는 기존 가시성 헬퍼(`middleware/visibility.js` 또는 calendar.js 의 listWhere 패턴)를 재사용 — 새 로직 금지.
- **마이그레이션**: 없음.
- **검증**: 실 HTTP — L1 일정 생성 후 다른 멤버로 Cue 질문 → 컨텍스트/응답에 미노출. `node scripts/e2e/run.js --suite l1` 카나리.
- **Fable 게이트**: 불필요 (필터 **추가** = 보안 강화 단방향, 소규모). 단 l1 스위트 필수.
- **되돌리기**: 커밋 revert 만.

### D-7. 청구 멱등키 + 잠금 (1일) — 조기 (H2 참 확정이므로)

- **목적**: 동시/겹침/크래시 재실행에서도 "한 구독 × 한 청구기간 = 최대 1장"을 DB 가 보증.
- **절단면**: `services/recurring_invoice.js` + `services/clientSubscriptionBilling.js` 2파일 + invoices 테이블 컬럼 1개. **발행 로직·금액 공식·이메일 흐름은 무변경** — 가드만 삽입.
- **설계 (최소안 — Temporal/큐 도입 금지)**:
  1. `invoices.recurring_key VARCHAR(64) NULL UNIQUE` — 값 = `sub:{id}:{YYYY-MM-DD(next_billing_at)}` / `proj:{id}:{YYYY-MM}`. Invoice.create 에 포함 → 중복 실행은 unique 위반으로 **결정적** 실패(재시도 루프는 recurring_key 충돌이면 재생성 없이 skip 처리).
  2. 트랜잭션 + `SELECT ... FOR UPDATE` 로 sub/project 행 잠금 후 재검사(taskExtractorScheduler 의 DB-상태 복구 패턴과 동일 철학). Invoice.create + 상태 전진을 **같은 트랜잭션**으로 — 크래시 창 소멸.
  3. 이메일은 지금처럼 best-effort 유지(멱등 대상 아님 — EmailLog 로 추적, 기존 원칙).
- **마이그레이션**: 컬럼 1개 ALTER (운영 수동 선행 — `feedback_sync_alter_too_many_keys` 주의). 백필 불필요(NULL 허용, 신규 발행부터).
- **검증**: 본 문서 H2 테스트 시나리오 재실행 — 동시 2회가 **1장+1 skip** 이 되면 통과. 순차 회귀 1장 유지. 옛 데이터 sample(기존 정기청구 프로젝트 1건) 정상 발행.
- **Fable 게이트**: **필요** (기준2 돈·주문 무결성 + 기준3 마이그레이션).
- **되돌리기**: 컬럼은 무해(NULL) — 코드만 revert 하면 옛 동작.

### D-1. LLM 게이트웨이 단일화 (2~3일)

- **목적**: raw fetch 12파일 → `services/llm_gateway.js` 단일 모듈. 툴 호출·모델 라우팅·프롬프트 레지스트리·재시도·비용계량·평가훅을 넣을 **단일 지점** 확보. 이후 모든 단계의 선행.
- **절단면**: 신규 `services/llm_gateway.js` + 호출부 12파일의 fetch 블록을 `gateway.complete({ task:'cue_answer', messages, tools?, businessId, actionType })` 호출로 치환. **프롬프트 내용·모델 선택 결과·응답 파싱은 1:1 보존** (동작 무변경 리팩터). `costGuard`·`plan.can('use_cue')`·`recordUsage` 는 **흡수가 아니라 게이트웨이가 호출** — costGuard/cue_usage 코드 자체는 무수정.
- **설계**:
  - 모델은 태스크별 env/설정 매핑(`LLM_MODEL_DEFAULT`, 태스크 override) — q-note `llm_service.py:24` 의 사내 선례 패턴.
  - `tools` 파라미터 지원(OpenAI function calling 형식) — D-2.5 의 전제. 첫 단계에선 아무도 안 씀.
  - 모든 호출 결과를 (task, model, tokens, latency, ok) 로 로깅 — 기존 `recordUsage` 경유 + console 구조화. 신규 테이블 만들지 않음.
  - AbortSignal timeout 45s 표준(`cue_orchestrator.js:115` 계승), 폴백 문자열 동작 보존.
- **마이그레이션**: 없음.
- **검증**: 태스크별 회귀 — Cue 채팅 응답/task 실행/문서 초안/번역/추정 각 1건 실 HTTP, 응답 형식 동일. `cue_usage` 집계 증가 확인. guard-invariants + health-check green.
- **Fable 게이트**: **필요** (기준4 — 구조적 결정. 12파일 동시 수술이라 diff 범위 대조 가치 큼).
- **되돌리기**: 파일별 커밋 분할(3~4파일씩) — 부분 revert 가능.

### D-3. 행동 계층(Action Layer) 추출 (3일 × 2사이클) — **가장 되돌리기 어려움, 절단면 정밀**

- **목적**: 12개 라우트에 인라인인 task 상태 전이를 열거 가능한 **actor 기반 서비스 함수**로. (a) Cue 툴 호출 (b) MCP 쓰기 (c) 권한 검사 단일화의 공통 전제. H1 커버리지 결손의 근본 해법.
- **절단면 (엄격)**:
  - **1사이클 (task 도메인만)**: 신규 `services/actions/task_actions.js` — `submitReview(taskId, actor)`, `approve(...)`, `requestRevision(...)`, `ack(...)`, `complete(...)`, `cancelReview(...)`, `assignReviewer(...)`. `routes/task_workflow.js` 의 12개 핸들러는 **파싱+actor 구성+함수 호출+응답만** 남김. 전이 규칙·reviewer 가드(`:498`)·recalcStatusFromReviewers·notify/broadcast side-effect(박제 `feedback_workflow_routes_bypass_side_effects` — 함수 안으로 이동해 호출 강제)를 함수 내부로.
  - **actor 인터페이스**: `{ kind: 'user'|'cue', userId, scope, onBehalfOfUserId? }` — 사람은 기존 `req.scope`, Cue 는 D-2 의 CueActor. **권한 검사는 함수 진입부에서 actor.scope 로 1회** — 라우트와 Cue 가 같은 문.
  - **건드리지 않는 것**: invoice 전이(생명선 — 2사이클 이후 별도 게이트), projectStageEngine(이미 멱등 엔진), HTTP 응답 형식, 프론트엔드 전부.
  - **2사이클**: `task_create` / `comment_create` / `event_create` / `document_draft` — #81 이 필요로 하는 생성 계열. invoice 는 **의도적으로 카탈로그에서 제외**(§D-2 금지선).
- **마이그레이션**: 없음 (코드 이동).
- **검증**: task_workflow 12라우트 실 HTTP 전수(200 + 403 권한별 + 400 가드) — 기존 대비 diff 0. reviewer 0명 reviewing 차단이 **Cue 경로에서도** 발동하는지(신규 검증 — 기존 우회의 폐쇄). 2브라우저 socket broadcast 회귀(CLAUDE.md 16번). 운영 옛 task 1건 전이.
- **Fable 게이트**: **필요** (기준1 보호영역 — task_workflow status 전이 명시 생명선).
- **되돌리기**: 라우트가 함수를 호출하는 구조라 함수 인라인으로 기계적 복원 가능. 단 2사이클 진행 후엔 Cue/MCP 가 의존하므로 사실상 불가역 — **그래서 1사이클 완료 시점에 Fable 재검증 후 진행.**

### D-2. 에이전트 권한·책임 모델 (2일) — P0, D-3 1사이클과 병행 가능

- **목적**: Cue 를 사람과 같은 권한 계층에. ①on-behalf-of ②delegate vs assignee ③감사 3요소(지시자·대행자·권한근거) ④재무 금지선.
- **설계**:
  1. **CueActor scope**: `getUserScope(cueUserId, businessId)` 를 그대로 쓰되(`role:'ai'` 는 이미 scope 에 잡힘 — `access_scope.js:33,55`), **쓰기 시 위임자 scope 와 교집합**: `effectiveScope = min(cueScope, delegatorScope)` — "에이전트 권한 ≤ 위임자 권한". 위임자 = task.created_by(업무 실행) / 트리거 메시지 sender 의 conversation 접근권(자동응답).
  2. **delegate 판정 (Linear 모델, Q Bill 재무 책임 때문에 필수)**: `tasks.delegated_by_user_id INT NULL` 컬럼 추가. Cue 를 assignee 로 지정하는 순간 지정자를 delegated_by 로 기록 — **책임자(사람)가 데이터에 남는다.** UI 라벨/주간보고 귀속은 후속(지금은 데이터 확보만). 기존 assignee_id=cue 3건은 created_by 로 백필.
  3. **감사 3요소**: `createAuditLog` 호출부에 `newValue.acting_for = {instructed_by, permission_basis: 'delegated_scope'|'auto_reply', trigger: {type, id}}` — **컬럼 추가 없이 new_value JSON 확장**(H1-(2) 재구성 불가 해소. audit_logs 스키마 무변경 = 마이그레이션 회피).
  4. **재무 금지선 (코드 불변식)**: 행동 카탈로그(D-3)에 invoice 계열 부재 + `assertInvoiceMutationOwner` 에 `if (scope.isAi) return 403 'ai_forbidden'` 명시 1줄 + `scripts/guard-invariants.js` 에 "cue 서비스 파일에서 Invoice/Installment mutation 호출 0" 정적 검사 추가. "우연히 없음" → "기계가 감시하는 금지선".
- **절단면**: cue_task_executor.js·cue_orchestrator.js 의 write 직전에 effectiveScope 검사 삽입 / tasks 컬럼 1개 / guard-invariants 1검사. **cue_context(읽기)는 이미 정답이라 무수정.**
- **마이그레이션**: `tasks.delegated_by_user_id` ALTER 1개 (운영 수동 선행).
- **검증**: 실 HTTP — ①권한 없는 member 가 Cue 에게 owner_only 범위 작업을 시키는 경로가 403/skip ②reviewer 0명 task 를 Cue 가 reviewing 으로 못 올림(D-3 와 합동) ③audit row 에 acting_for 존재 ④invoice mutation 정적 가드 red 테스트.
- **Fable 게이트**: **필요** (기준5 보안 경계 + 기준3 마이그레이션).
- **되돌리기**: 컬럼 무해(NULL). 검사 삽입부 revert.

### D-2.5. #81 Cue 대화형 실행 = 툴 호출 (2~3일, D-1+D-3+D-2 완료 후)

- **목적**: Q helper/Cue 채팅에서 "다음주 화요일까지 제안서 초안 업무 만들어줘" → 행동 계층 호출. **트랙1 배치5 #81 과 동일 작업 — 별도 개발 금지.**
- **설계**: llm_gateway `tools` 로 D-3 카탈로그 노출(`create_task`/`create_event`/`create_document_draft`/`submit_review` — 읽기 툴은 cue_context 함수 재포장). **모든 쓰기 툴은 confirm 게이트**: LLM 이 tool call 제안 → 사용자에게 결정론적 확인 카드(파라미터 표시) → 클릭 시 actor=사용자 본인으로 실행 — "고객에게 나가는 것/데이터가 바뀌는 것은 사람이 누른 뒤에만" 원칙 그대로. 에이전트 루프는 1턴 tool-call → confirm — **멀티스텝 자율 루프 금지** (지금 단계 과잉).
- **비용**: costGuard perUserLimiter + `plan.can('use_cue')` + 입력 캡 3종 세트(CLAUDE.md 운영 안정성 1번), cue_usage action_type='tool_call'.
- **검증**: 실 HTTP tool call → confirm → task 생성 → 재조회 값 일치. 권한 없는 메뉴(requireMenu none) 사용자의 tool 제안이 실행 단계에서 403. 2브라우저 broadcast.
- **Fable 게이트**: **필요** (기준4 — 백로그 문서도 명시).
- **되돌리기**: tools 파라미터 미전달로 즉시 옛 동작(답변만).

### D-4. MCP 읽기 서버 (2일, D-2.5 이후 아무 때나)

- **목적**: 외부 에이전트 유통 채널 개통 (H4 해소). 감사문서 ⑥절 최단경로 채택.
- **설계 (얇게 — 2026-07-28 stateless 개정 대응)**:
  - 별도 프로세스 `planq-mcp` (PM2 신규, 포트 분리 — POS 공존 서버) — dev-backend services 를 라이브러리 require.
  - 인증: `api_tokens` 테이블 신설(refresh_tokens 패턴: user_id, business_id, scopes, hash) → 토큰 → `getUserScope` 교환. **토큰 소유자 scope 로 전 격리** — 별도 권한 체계 금지.
  - 툴 4개 (전부 읽기, cue_context 재포장): `workspace_overview`(`cue_context.js:255`), `search_workspace`(`:181`+hybridSearch), `get_client_360`(`:141`), `get_project_status`(`:54`+stage next_action). Streamable HTTP + stateless 전제(세션 의존 코드 금지).
  - 감사: 전 호출 `createAuditLog({ action:'mcp.<tool>', acting_for })` — D-2 형식 재사용.
  - **쓰기 툴은 이 단계에서 절대 금지** — D-3 카탈로그가 안정된 뒤 별도 사이클(순서 엄수 — 아니면 Cue 의 "권한 우회 직접 write"를 외부에 복제).
- **마이그레이션**: api_tokens CREATE TABLE 1개.
- **검증**: Claude Code 에 붙여 "이번 주 미수금 목록" 실호출(H4 검증법 3 그대로). 타 워크스페이스 토큰 403. 감사 row.
- **Fable 게이트**: **필요** (기준5 보안 경계 — 신규 공개 표면).
- **되돌리기**: PM2 프로세스 중지 = 표면 소멸. 본체 무영향.

### D-5. 컨텍스트·지식 계층 — RAG 조건부 단순화 (1일)

- **H3 참 확정에 따른 설계**: 코퍼스가 작으므로 **"작으면 전량 주입, 크면 기존 하이브리드"** 이중 경로.
  - `kb_service.hybridSearch` 진입부: 워크스페이스 청크 총 bytes < 100KB(≈25K 토큰)면 임베딩 검색 skip → 전 청크를 scope 순으로 정렬해 상위 N 반환(사실상 전량). 임계 초과 워크스페이스만 기존 경로.
  - 신규 문서 임베딩 생성은 **유지**(향후 성장 대비 — 지금 끊으면 나중에 백필 비용. 비용은 text-embedding-3-small 이라 무시 가능 수준).
  - "최근 200청크" 윈도우(`kb_service.js:224-227`)는 임계 초과 경로에만 남으므로 사실상 봉인 — 성장 시 ANN 검토는 그때(Stage 임계치 원칙 `feedback_staged_infra_rollout`).
- **검증**: Cue 동일 질문 10개 A/B — 전량 주입 경로가 같거나 나은 답 + 토큰 예산 내(운영 527B 는 논쟁 여지 없음). cue_usage 비용 변화 기록.
- **Fable 게이트**: 불필요. **되돌리기**: 분기 플래그 제거.

### D-6. 이벤트 스트림 통합 읽기 뷰 (1일) — H5 참이므로 진행, 단 최소안

- **목적**: "이 워크스페이스에서 일어난 모든 일" 단일 소비 지점 — ①Cue/보고서 컨텍스트 ②향후 "에이전트 액션 원장" 제품화(Agent 365 카테고리)의 씨앗.
- **설계**: 이벤트소싱 전환 **금지**. 신규 `services/event_stream.js` 의 `getWorkspaceStream(businessId, {since, actor, kinds})` 하나 — 본 문서 H5-2 에서 실증한 6테이블 UNION 을 서비스 함수로 박제(actor 정규화: user_id/actor_user_id/changed_by/sender_id → actor_user_id + is_ai 파생). 쓰기 경로 무변경. 소비처 1호 = 주간보고 생성기 or Cue overview.
- **검증**: dev 실측 쿼리 결과와 함수 출력 일치. 30일 스트림에 Cue/사람 액션 혼재 확인.
- **Fable 게이트**: 불필요 (읽기 전용). **되돌리기**: 파일 삭제.

---

## E. 임팩트 × 노력 순위표 (트랙1+트랙2 통합, 임팩트÷노력 내림차순)

임팩트: 사용자 고통 해소 + 수익/전략 + 리스크 제거 종합 (상5~하1). 노력: 사람-일.

| # | 항목 | 임팩트 | 노력(일) | 리스크 | 선행조건 | Fable |
|---|---|---|---|---|---|---|
| 1 | **트랙1 배치0 Quick Win** — status 5건+#85 SCR 버튼+문서 정정 | 3 | 0.2 | 없음 | 없음 | 불필요 |
| 2 | **D-0 cue_context 가시성 필터** | 4 (L1 누출 경로 봉쇄) | 0.5 | 낮음 | 없음 | 불필요(+l1 스위트) |
| 3 | **D-7 청구 멱등키+잠금** | 5 (돈 무결성 — H2 실증 구멍) | 1 | 중 (생명선 접촉) | 없음 | **필요** |
| 4 | **트랙1 배치1 K1 첨부 provider** | 5 (#134 최고 빈도 고통, 잠복 4건 동시) | 2 | 중 (공개 서빙+ENUM) | 없음 | **필요** |
| 5 | **트랙1 배치2 소형버그 6건** | 4 | 1 | 낮음 | 없음 | 불필요 |
| 6 | **D-1 LLM 게이트웨이** | 4 (전 AI 로드맵 선행+비용 관측) | 2~3 | 중 (12파일) | 없음 | **필요** |
| 7 | **D-6 이벤트 스트림 뷰** | 3 | 1 | 낮음 | 없음 | 불필요 |
| 8 | **D-5 RAG 단순화** | 3 (복잡도 제거+답변 품질) | 1 | 낮음 | 없음 | 불필요 |
| 9 | **D-3 행동 계층 (1사이클 task)** | 5 (Cue·MCP·권한 단일화 전제) | 3 | 높음 (생명선) | D-1 권장 | **필요** |
| 10 | **D-2 에이전트 권한·책임** | 5 (H1 해소, 규제 진입 자격) | 2 | 중 | D-3 1사이클 | **필요** |
| 11 | **트랙1 배치3 레이아웃 4건** | 3 | 2~3 | 낮음 | #128 은 Irene 와이어 합의 | 불필요 |
| 12 | **D-3 행동 계층 (2사이클 생성계)** | 4 | 2 | 중 | D-3 1사이클 | **필요** |
| 13 | **D-2.5 = #81 Cue 툴 호출** | 4 (사용자 요청 실존+차별화) | 2~3 | 중 | D-1·D-2·D-3 + **Irene 승인** | **필요** |
| 14 | **트랙1 배치4 #138 리액션** | 3 | 2 | 중 (마이그레이션) | 없음 | **필요** |
| 15 | **D-4 MCP 읽기 서버** | 4 (유통 채널 개통) | 2 | 중 (신규 표면) | D-2 (감사 형식) + **Irene 전략 승인** | **필요** |
| 16 | **§H 제거 목록 실행 (안전분)** | 2 (스키마 신뢰 회복) | 1 | 낮음 | 개별 grep 재확인 | 마이그레이션 포함 시 필요 |
| 17 | **트랙1 배치5 #126 캘린더 양방향** | 4 | 3+ | 중 | **Irene OAuth 검증 제출** | 불필요 |

> 읽는 법: 1~8 은 선행조건 없이 지금 바로 가능. 9~13 이 AI-네이티브 본체(순서 고정). 14~17 은 독립 — 사이클 사이에 끼워넣기.

---

## F. 즉시 착수 (다음 1사이클, 3~5개)

1. **배치0 Quick Win** — 30분에 미해결 19건 중 5건 소멸 + 백로그 수치 정정. 근거: 노력 최소·사용자 신뢰 회복 즉효.
2. **D-0 cue_context 가시성 필터** — 반나절. 근거: 실데이터 노출 0건인 지금이 무비용 봉쇄 적기.
3. **D-7 청구 멱등키** — 1일. 근거: H2 로 "청구서 2장" 이 실증된 이상 알고도 두는 것은 돈 사고 예약.
4. **배치1 K1 첨부 provider** — 2일. 근거: 두 사용자 반복 제보(#112→#134) = 현존 최고 고통, 잠복 4건 동시 제거.
5. **D-1 LLM 게이트웨이 착수** — 근거: 트랙2 의 모든 후속(#81 포함)이 이 단일 지점을 요구. 여기까지가 약 1주.

## G. 하지 말아야 할 것

| 유혹 | 왜 지금 아닌가 |
|---|---|
| **Temporal/BullMQ+Redis 도입** | H2 처방은 멱등키+행잠금 1일이면 끝. 30일 이벤트 323건 볼륨에 워크플로 런타임은 인프라 유지비만 산다. taskExtractor 의 "DB 상태 기반 cron 복구" 선례로 충분. Stage 임계치 원칙(`feedback_staged_infra_rollout`). |
| **벡터 DB (pgvector/qdrant) 도입** | H3 실측 527 bytes. 임베딩 자체가 과잉인 규모에 인덱스 추가는 반대 방향. |
| **멀티에이전트/자율 루프** | 단일 Cue + confirm 게이트가 현 단계 정답. 쓰기 중심 워크로드는 단일 스레드 우위(트렌드 문서 F5), 그리고 토큰 ~15배. |
| **MCP 쓰기 툴 선(先)개방** | D-3 행동 계층 전에 열면 "권한 우회 직접 write" 를 외부에 복제 — 감사문서 ⑥-3 순서 엄수. |
| **MCP 두껍게 (세션 의존·툴 수십 개 선로딩)** | 2026-07-28 stateless 개정으로 재작업 확정. 읽기 4툴 얇게. |
| **이벤트소싱 전면 전환** ("현재 상태 = 이벤트 파생") | H5 처방은 읽기 뷰로 충분. 34테이블 SaaS 를 이벤트소싱으로 뒤집는 것은 1~2인 팀 수 개월 — 되돌리기 불가 최상급. |
| **프롬프트 A/B·평가 플랫폼 구축** | 게이트웨이에 훅 자리만. 평가는 "통과한 수동 체크리스트를 스크립트로 승격" 수준부터. |
| **outcome-based 과금 선제 전환** | 하이브리드가 최다(38%)이고 outcome 은 소수파. 현행 좌석+cue_actions 한도가 이미 하이브리드. |
| **Generative UI** | 읽기 전용 보고서에조차 아직 이르다 — 트랙1 고통 해소가 우선. 돈·권한·증빙 화면은 영구히 결정론적 UI(원칙 박제). |
| **#81 을 단독 기능으로 급조** | D-1/D-3 없이 만들면 13번째 raw fetch + 권한 우회 쓰기 하나가 더 생길 뿐. |

## H. 제거 목록 (감사문서 ④ 재정리 — drop 전 개별 grep 재확인 필수)

**안전 삭제 (참조 0 재확인 후 1사이클):**
- PortOne 잔재: `Payment.portone_*` 4컬럼, `Business.portone_*` 3컬럼 (Stripe 확정)
- Popbill: `Business.popbill_link_id/popbill_secret_key` (CLAUDE.md "팝빌 자동발행 X" 명시)
- `EmailThreadParticipant` presence 5컬럼 / `EmailMessage.ai_intent/ai_processed_at/delivery_error` / `Message.cue_draft_processing_by/_at`
- `Business.storage_used_bytes/storage_limit_bytes` (BusinessStorageUsage 로 이관 완료) / `BusinessMember.monthly_salary` (민감정보 잠복) / `Conversation.last_ai_summary_at`, `Document.ai_prompt/search_text/pdf_generated_at`

**보류 (결정/추가 확인 필요):**
- `Project.paused_at` — **`recurring_invoice.js:233` WHERE 절이 아직 참조** (audit 표의 "참조 0" 은 부정확). 제거하려면 해당 조건 정리 동반 — D-7 사이클에 합류 권장.
- `Quote` 모델 — Post(category=quote) 와 이중 표현. **Irene 결정** (견적 기능의 정본이 어느 쪽인가).
- `InvoicePayment.pg_*` 8컬럼 — Stripe 워크스페이스 결제와 통합 검토 후.
- 나머지 119건 중 미분류분 — 자동 스캔은 heuristic. 사이클당 10~20개씩 개별 grep 후 처리 (일괄 금지).

---

### 부록 — 검증 방법 기록 (재현용)
- H1: dev DB SELECT (is_ai users → tasks.assignee_id 3건, audit_logs #900/#657, SHOW COLUMNS) + 코드 대조 (§B 표의 파일:라인).
- H2: dev 에서 테스트 구독/프로젝트 생성 → `runClientSubscriptionBilling` 순차/동시, `billOneProject` 순차/동시 실행 → invoice 200·198·201·203 중복 실증 → InvoiceItem/Invoice/구독/프로젝트 전량 삭제 원복(잔존 0 확인), 테스트 스크립트 삭제.
- H3: dev + 운영(87.106.78.146 read-only SELECT) `kb_chunks GROUP BY business_id`.
- H5: dev 에서 6테이블 UNION 쿼리 실제 실행 성공 (SHOW COLUMNS 로 actor 컬럼 이질성 확정).
- H4: grep 재실행 (MCP 0 / x-api-key 0 / tools: 0 / api.openai.com 12파일 / gpt-4o-mini 16파일).
