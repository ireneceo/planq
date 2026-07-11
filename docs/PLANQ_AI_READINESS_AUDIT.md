# PlanQ AI-네이티브 준비도 감사 (AI Readiness Audit)

> 2026-07-11. 시니어 아키텍트 관점 코드 실측 감사. 코드 수정 없음 — 읽기·grep·정독만.
> 모든 주장에 `파일:라인` 근거. 근거 없는 칭찬 없음. 기존 `docs/AI_FEATURE_AUDIT.md`(기능 동작 체크리스트)와 별개 — 본 문서는 **구조가 AI-네이티브 OS 로 갈 수 있는가**를 판정한다.

---

## ① 13축 점수표

| # | 축 | 점수 | 한 줄 근거 |
|---|-----|------|-----------|
| 1 | Architecture | **5**/10 | 서비스 레이어 실존(86개, 16.9k줄)·권한 단일모듈은 정석이나, god-file 3종(projects 3,071줄·tasks 2,305·invoices 2,253 — 자체 기준 500줄의 4~6배) |
| 2 | Scalability | **4**/10 | pagination 표준 채택 11/57 라우트 파일뿐. KB 검색이 "최근 200청크"만 인메모리 코사인. PM2 fork 1 인스턴스 + Redis/큐 0 + 인메모리 타이머 → 수평확장 불가 |
| 3 | AI readiness | **3**/10 | raw `fetch(api.openai.com)` 13개 파일 산재, `gpt-4o-mini` 하드코딩 8곳, 모델 추상화 0, function calling 0, 에이전트 루프 0, AI 회귀테스트 0. 비용가드만 A급 |
| 4 | Data model | **7**/10 | append-only 이력 4종(updatedAt:false) + 대화→업무→청구→증빙 단일 FK 그래프는 진짜 자산. 감점: 임베딩 BLOB(질의 불가), 죽은 컬럼 119건 표류 |
| 5 | Workflow engine | **4**/10 | 선언적 상태기계 없음 — 12개 라우트 핸들러에 전이 규칙 인라인. stage 엔진은 멱등 재계산(양호)이나 템플릿 4종 하드코딩. durable execution·재시도 큐 0 |
| 6 | Permissions | **7**/10 | 4-Layer 실구현 + access_scope 단일모듈 603줄은 견고. Cue 는 실존 User row(is_ai)로 감사에 잡히나, **서비스 코드가 권한계층을 우회해 직접 write** — on-behalf-of 위임 개념 부재 |
| 7 | Context management | **6**/10 | buildCueContext 는 권한 스코프 내 8소스 병렬 조립(실질적 자산). 감점: 토큰 예산이 주석 수준(chars/4), 검색이 LIKE+최근200청크, 압축/캐시 없음 |
| 8 | Automation | **5**/10 | cron 9개 + 자정 체인 10개 + 30초 tick + 디바운스 추출기 — 양은 많으나 100% 하드코딩. 사용자 정의 규칙 엔진 0 (설정 가능한 건 알림 토글뿐) |
| 9 | Agent collaboration | **4**/10 | Cue↔사람 양방향 루프(배정→실행→reviewing→반려시 revisionNote 재실행)는 제품화됨. 그러나 단일 에이전트·4 kind 정규식 라우팅·멀티에이전트/플래닝 0 |
| 10 | API design | **5**/10 | 응답표준·JWT·헬퍼 채택률 높음(raw res.json 11건뿐). 그러나 공개 API 키 0, outbound webhook 0, OpenAPI 스펙 0 — 외부에서 프로그래밍 불가 |
| 11 | MCP compatibility | **1**/10 | MCP 서버/클라이언트 코드 0 (grep 실측 0건). 단, access_scope+서비스 레이어 덕에 최단 경로는 존재 (⑥ 참조) |
| 12 | Knowledge management | **6**/10 | 청킹→임베딩→하이브리드→scope 가중→지식카드 채굴 cron 까지 파이프라인 완결. 감점: 최근 200청크 윈도우가 recall 을 구조적으로 파괴, ANN 인덱스 0 |
| 13 | Human-AI collaboration | **7**/10 | AI 가 워크플로 안에 있음: draft 승인/거절 버튼, 후보카드 인박스, Cue 산출물 reviewing 게이트, 추정 confirm 이력. 승인 루프 3개 이상 제품화 |

**종합: 4.9/10 — "AI 기능이 많은 SaaS"이지 아직 "AI-네이티브 OS"는 아니다.** 데이터 모델(7)과 휴먼루프 UX(7)는 준비됐고, LLM 인프라(3)·워크플로 엔진(4)·외부 개방성(1~5)이 발목이다.

---

## ② 축별 상세 (실측 근거)

### 1. Architecture — 5/10

**양호:**
- 서비스 레이어가 명목이 아니라 실질: `services/` 86개 파일 16,894줄 vs `routes/` 57개 33,645줄 (wc 실측). LLM·billing·stage 엔진·스냅샷이 라우트 밖에 존재.
- 권한이 단일 모듈로 수렴: `middleware/access_scope.js` (603줄) — "PERMISSION_MATRIX §7+§5 단일 구현" 선언과 코드 일치.
- 회귀 래칫: `scripts/guard-invariants.js` (457줄), `scripts/health-check.js` (761줄), `scripts/e2e/run.js` — 아키텍처 부패를 기계로 감시.

**부채:**
- God-file: `routes/projects.js` 3,071줄 / `routes/tasks.js` 2,305줄 / `routes/invoices.js` 2,253줄 / `routes/kb.js` 1,554줄. CLAUDE.md 자체 기준("라우트 500줄 이상 분리 검토")의 4~6배. projects.js 는 대화 생성·메시지 발송·Cue 트리거까지 품음 (`routes/projects.js:210`, `:785`, `:831-916` — AI draft 승인 로직이 projects 와 conversations 양쪽에 중복 존재. `routes/conversations.js:1010-1047` 동일 로직).
- 인라인 `require()` 산재 (핸들러 내부 lazy require — `routes/tasks.js:516`, `routes/task_workflow.js:427`, `services/cue_orchestrator.js:184` 등) — 순환의존 회피용 관행이 모듈 경계 부재의 증상.
- 도메인 모듈 경계 없음: 109개 모델이 평면 `models/` 하나. Q Talk/Q Task/Q Bill 이 물리적으로 분리 안 됨 — 결합은 낮지 않으나 마이크로서비스가 필요한 규모도 아직 아님 (모놀리스 자체는 감점 사유 아님).

### 2. Scalability — 4/10

- **Pagination**: 표준(`parsePagination`+`paginatedResponse`)은 존재하나 채택 11/57 라우트 파일 (grep -l 실측). GET 라우트 총 272개 대비 소수.
- **KB 검색이 구조적으로 스케일 불가**: `services/kb_service.js:224-227` — `KbChunk.findAll({ where, limit: 200, order: [['id','DESC']] })` 후 JS 루프 코사인. 워크스페이스 청크가 200개를 넘는 순간 **옛 문서는 검색에서 영구 탈락** (recall 파괴). 벡터 인덱스(ANN) 없음, 임베딩은 MySQL BLOB (`kb_service.js:46-51` floatsToBlob).
- **인덱싱 직렬 처리**: `kb_service.js:113-137` — 청크마다 `await embedText` + 매 청크 `findByPk` 재확인. 100청크 문서 = 100회 왕복 직렬.
- **Cue 질문 1건당 무거운 스캔**: `services/cue_context.js:277` — `Task.findAll({ attributes:['status','due_date'], limit: 800 })` + `:297` Invoice 500건. 매 질문마다 집계 쿼리 대신 row 800개 로드 후 JS 집계.
- **단일 프로세스 한계**: `scripts/prod-ecosystem.config.js:26-27` `instances: 1, exec_mode: 'fork'`. `package.json` 에 redis/bull/queue 의존성 0 (grep 실측). Socket.IO adapter 없음(`server.js` grep 0) → cluster 전환 시 room broadcast 즉시 깨짐. `services/taskExtractorScheduler.js:29-31` 인메모리 `Map` 타이머 — 프로세스 2개면 중복 추출.
- **cron 이 웹 프로세스 안**: `server.js:450-507` 자정 setTimeout 체인에 billing·trial·recurring invoice 등 10개 잡 직렬 실행 + cron.schedule 9개 (`services/*.js` grep 실측). 재배포 타이밍과 자정이 겹치면 유실 (멱등 설계로 다음날 복구되는 잡만 안전).
- **양호**: 멀티테넌트 격리는 access_scope + `taskListWhere`/`invoiceListWhere` 가 컨텍스트 빌더까지 관통 (`cue_context.js:192`, `:232`) — AI 컨텍스트에도 테넌트 격리가 적용되는 SaaS 는 드묾.

### 3. AI readiness — 3/10

- **LLM 게이트웨이 부재**: `https://api.openai.com/v1/chat/completions` raw fetch 가 최소 13개 파일에 각자 구현 — `services/cue_orchestrator.js:102`, `cue_task_executor.js:20`, `kb_service.js:305`, `task_extractor.js:29`, `aiTaskPlanner.js:150`, `brief_service.js:157`, `translation_service.js:68`, `reportNarrative.js:44`, `wikiQuestionCluster.js:34`, `routes/cue.js:182,325`, `routes/task_estimations.js:70`, `routes/tasks.js:762`, `routes/docs.js` 등. 각자 timeout·fallback·에러처리 복제.
- **모델 하드코딩**: `model: 'gpt-4o-mini'` 리터럴 8곳 (grep 실측). 모델 교체 = 13개 파일 수정. 유일한 예외가 Q Note — `q-note/services/llm_service.py:24-25` 는 `LLM_MODEL` 환경변수 ("모델 교체 시 LLM_MODEL 변경" 주석). Node 백엔드에는 이 수준의 추상화조차 없음.
- **Function calling 0**: `tools:`/`tool_calls`/`function_call` grep 전체 0건. 모든 AI 가 "텍스트 in → 텍스트 out" 단발 completion. AI 가 시스템에 **행동**할 수 없고 사람이 결과를 복사-실행.
- **에이전트 루프 0**: `cue_task_executor.js:178-184` — switch 4분기 각 1회 LLM 호출 후 종료. 관찰→행동→재관찰 루프 없음. `inferCueKind`(`:131-140`)는 정규식 라우팅.
- **프롬프트 관리 0**: 전 프롬프트가 코드 내 문자열 리터럴 (`cue_orchestrator.js:155-163`, `routes/cue.js:16-52` 등). 버전관리·A/B·평가 없음.
- **평가/회귀 테스트 0**: `package.json:6-10` scripts 에 test 없음, `*.test.js` 0건 (find 실측). `docs/AI_FEATURE_AUDIT.md` 는 수동 체크리스트. e2e 하니스는 UI 회귀용 — AI 출력 품질 회귀는 무방비.
- **양호 (이 축의 유일한 A급)**: 비용 거버넌스 — `cue_usage` 워크스페이스×월×action_type rollup + 단가표 (`cue_orchestrator.js:25-29` PRICING, `:65-88` recordUsage), plan engine 한도 게이트 (`:55-62`), per-user 이중윈도우 rate-limit (`routes/task_estimations.js:16`, `middleware/costGuard.js`), 외부 API AbortSignal timeout 표준 (`cue_orchestrator.js:115`). 대부분의 스타트업보다 앞섬.

### 4. Data model — 7/10

- **Append-only 이력 실증**: `models/AuditLog.js` `updatedAt: false`, `models/TaskStatusHistory.js:58`, `models/InvoiceStatusHistory.js:19`, `models/ProjectStatusHistory.js:19`, `models/BillEvent.js:27` 모두 `updatedAt: false` — 이벤트 소싱은 아니지만 AI 가 시계열 추론할 수 있는 불변 사실 레이어가 존재.
- **그래프 걷기 좋음**: conversation→project(`project_id`)→task→invoice(`source_post_id`, `project_id`)→installment→receipt_correction 이 전부 FK. Cue 컨텍스트 빌더가 이 그래프를 실제로 걸음 (`cue_context.js:54-165` — 한 대화에서 프로젝트 stage·업무·고객 청구잔액까지 5쿼리로 도달).
- **AI 소비 흔적이 스키마에 1급으로**: `messages.is_ai/ai_confidence/ai_source/ai_sources/ai_model/ai_mode_used/ai_draft_approved` (`cue_orchestrator.js:261-275`), `tasks.cue_kind/cue_context_ref`, `TaskEstimation.source('ai'|'user')` — AI 산출물이 별도 테이블이 아니라 본류 데이터에 출처 태깅으로 박힘. AI-네이티브 방향의 올바른 선택.
- **감점**:
  - 임베딩이 MySQL BLOB — SQL 로 유사도 질의 불가, 전량 로드 후 JS 계산 강제 (`kb_service.js:54-59`).
  - 자연어 질의 접근성: 스냅샷류가 JSON 블롭 (`business_weekly_reports.snapshot`, `cue_context_ref`) — 스키마 자기서술성 낮음.
  - **죽은 컬럼 119건** (모델 attribute → routes/services/frontend 참조 스캔 실측, ⑤ 참조) — 스키마 신뢰도를 갉아먹음.

### 5. Workflow engine — 4/10

- **판정: 엔진이 아니라 "규율 있는 하드코딩"**. `routes/task_workflow.js` 는 12개 POST/PATCH 라우트 (`:179-734`) 각각에 상태 검사 인라인 (`:275` `if (task.status !== 'reviewing') return 400`, `:324`, `:388`, `:496`). 전이 테이블·상태기계 선언 없음 (`TRANSITIONS`/`ALLOWED` grep 0). 유일한 파생 로직 `recalcStatusFromReviewers`(`:149-165`)도 if 체인.
- `services/projectStageEngine.js` 가 가장 엔진다움: 멱등 재계산(`:66-120` progressProject — entity 상태→stage 상태 전량 재평가), manual_locked 존중(`:113-118`), best-effort 원칙 주석 명시(`:10-13`). 그러나 템플릿 4종 코드 상수(`:21-40`), 사용자 정의 단계 조건 불가.
- **Durable execution 0**: Cue 실행은 fire-and-forget — `routes/tasks.js:517` `executeForTask(task.id).then(...)`. 실패 시 AuditLog 1행 남기고 끝 (`cue_task_executor.js:186-197`) — 재시도 큐·백오프·DLQ 없음. 프로세스 재시작이면 실행 중이던 건 소실.
- **보상 트랜잭션 없음 / 멱등으로 대체**: 청구 계열은 멱등 착지점 패턴 (`ensureRenewalPayment`, `markPaymentPaid` 단일착지 — memory·`routes/stripeWebhook.js:2`)으로 이중생성을 막는 실용 설계. saga 는 아니고 필요 규모도 아직 아님.

### 6. Permissions — 7/10

- **4-Layer 실구현 확인**: ① platform_role (`middleware/auth.js` requireRole) ② BusinessMember.role ENUM owner/admin/member/ai (`access_scope.js:50-55`) ③ 메뉴권한 11메뉴×3레벨 (`middleware/menu_permission.js`) ④ visibility L1~L4 (`middleware/visibility.js`). 단일 스코프 객체(`getUserScope`, `access_scope.js:24-113`)로 수렴.
- **Cue 의 권한 실체**:
  - 워크스페이스 생성 시 실존 User row 생성: `routes/businesses.js:107-116` — `is_ai: true`, email `cue+{bizId}@system.planq.kr`, BusinessMember `role: 'ai'` (`routes/auth.js:386-406` 동일). scope 에 `isAi` 플래그 존재 (`access_scope.js:33,55`).
  - **API 진입은 차단**: `menu_permission.js:82` — `role === 'ai'` 면 requireMenu 에서 거부 ("시스템 멤버, API 진입 X"). Cue 계정으로 로그인해 라우트를 때릴 수 없음.
  - **감사에는 잡힘**: 모든 Cue 행동이 `createAuditLog({ userId: business.cue_user_id, ... })` (`cue_orchestrator.js:280-294`, `cue_task_executor.js:225-232`) — actor 가 Cue 로 남음. `Message.sender_id = cue_user_id` (`cue_orchestrator.js:263`).
  - **그러나 위임(on-behalf-of) 개념 없음**: Cue 의 실제 write 는 서비스 코드가 `Message.create`/`task.update` 를 **권한 검사 없이 직접 호출** (`cue_orchestrator.js:261`, `cue_task_executor.js:212-216`). Cue 가 무엇을 할 수 있는지는 access_scope 가 아니라 "서비스 코드에 우연히 구현된 범위". 읽기 쪽은 반대로 **질문자의 scope** 로 격리 (`cue_context.js:192,232` — 훌륭) — 즉 읽기는 사용자 위임, 쓰기는 무제한 시스템 권한이라는 비대칭. 에이전트에 툴을 쥐여주는 순간 이 비대칭이 보안 구멍이 됨.

### 7. Context management — 6/10

- `services/cue_context.js` (481줄) 는 실질적 컨텍스트 엔진: 8개 소스 병렬 조립 (`:449-478` Promise.all) — ① 대화 10턴 ② 프로젝트 stage/업무/일정 ③ 고객 360°(청구잔액·서명수) ④ 본인 업무 스냅샷 ⑤ KB RAG ⑥ 질문 키워드 전방위 검색 ⑦ 워크스페이스 현황 집계 ⑧ 확정 지식카드(cueKnowledge). 개별 실패 격리 (`.catch(() => null)` — 실사고 박제 주석 `:145-146`).
- **권한이 컨텍스트를 관통** — `taskListWhere`/`invoiceListWhere` 재사용 (`:27`, `:192`, `:232`), 재무는 owner/admin/본인 client 만 (`:229`). "AI 에게 보여주는 것 = 질문자가 볼 수 있는 것" 원칙이 코드로 강제됨. 이 축 최대 강점.
- **감점**:
  - 토큰 예산이 주석 수준: `:4` "~6K 안에 들어가도록", `:29` "chars/4 ≈ tokens. 안전 margin" — 실제 카운팅·초과 시 트리밍 로직 없음. 소스 8개가 다 차면 예산 초과 그대로 발사.
  - 검색 품질: 전방위 검색이 `LIKE %term%` 6단어 (`:170-179`) — 오타·유의어 무방비. KB 는 앞서 본 최근 200청크 한계.
  - 압축 없음: 대화 200자 스니펫 절단(`:405`)뿐, 장기 대화 요약·계층 메모리 없음. 캐시 없음 — 같은 질문도 매번 7쿼리+임베딩.

### 8. Automation — 5/10

- **전수 (실측)**: node-cron 9개 — candidateCleanup 03:00 / weeklyReview 매시 / reportUnit 매시 7분 / taskExtractor 매분 fallback / emailImap 5분 / emailFaqCluster 04:10 / calendarReminder 5분 / cueKnowledge 월 05:20 / wikiQuestionCluster 월 05:00 (`services/*.js` grep). 자정 setTimeout 체인 10잡 — snapshot·billing·trial·monthlyReport·recurringInvoice·clientSubscription·recurringTask·uploadCleanup·overdue·shareCleanup·shareExpiry (`server.js:450-507`). setInterval 2개 — exportJob 30초/6시간 (`server.js:535-536`). unreadEscalation (`server.js:539-540`).
- 이벤트 자동화: 메시지→60초 디바운스→업무후보 추출 (`taskExtractorScheduler.js:36-60` burst 5건 즉시), 고객 발화→Cue 자동응답, entity 상태→stage 자동진행, socket broadcast 표준(CLAUDE.md 16번 관철).
- **사용자 정의 가능성 = 사실상 0**: no-code 규칙 엔진 없음 (automation/rule 계열 테이블·라우트 부재). 사용자가 만질 수 있는 자동화 스위치는 `notification_prefs` 토글, `conversation.auto_extract_enabled`, `cue_mode`(auto/draft/smart), 정기업무 RRULE 정도 — 전부 미리 만들어진 자동화의 on/off 이지 새 규칙 조합이 아님. "X 가 일어나면 Y 해라"를 고객이 정의할 수 없다.

### 9. Agent collaboration — 4/10

- **양방향 루프는 실제 제품화됨** (이 축이 0이 아닌 이유):
  - 배정 트리거: task 생성/수정 시 `assignee_id === cue_user_id` → `executeForTask` (`routes/tasks.js:514-517`, `:1225-1228`).
  - 산출물은 `status='reviewing'` 으로 사람 컨펌 대기 (`cue_task_executor.js:212-216`).
  - 반려 시 피드백 재주입: `routes/task_workflow.js:422-434` — revision 시 `executeForTask(task.id, { revisionNote })`, 프롬프트에 feedbackBlock 삽입 (`cue_task_executor.js:58-64`).
  - 댓글 재트리거: `routes/tasks.js:1739-1751` (`commentNote`).
  - 채팅 draft 승인/거절: `routes/conversations.js:1010-1047`, `routes/projects.js:831-916`.
- **한계**: 에이전트 1종(Cue)뿐. 능력 4 kind + 정규식 추론(`inferCueKind`) — "research" 라 해도 KB 5청크 검색+1회 completion (`cue_task_executor.js:113-126`). 서브에이전트·에이전트간 협업·플래닝·다단계 실행 개념 없음. Cue 가 승인·검토 루프에 **검토자로** 들어가는 경우도 없음 (산출자로만).

### 10. API design — 5/10

- **일관성 양호**: `successResponse/errorResponse/paginatedResponse` 헬퍼가 지배적 (raw `res.json({ success` 11건뿐 — grep 실측). JWT Bearer + refresh rotation, 표준 에러 코드 문자열.
- **감점**:
  - 마운트 비일관: `/api` 루트에 3개 라우터가 prefix 없이 마운트 (`server.js:349,389,391` — external_connections/signatures/kb), kb 는 `/api/businesses/:id/kb/...` 를 `/api` 마운트로 구현. calendar 가 2개 경로에 이중 마운트 (`:372-374`).
  - **외부 프로그래밍 불가**: API key 인증 0 (x-api-key grep 0건 — Stripe/VAPID 제외), 사용자 정의 outbound webhook 0 (webhook grep = Stripe **inbound** 2개뿐, `server.js:258-259`), OpenAPI/Swagger 스펙 0. `docs/API_DESIGN.md` 는 수기 문서. 서드파티·고객 개발자·외부 에이전트가 PlanQ 를 호출할 공식 통로가 없음.

### 11. MCP compatibility — 1/10

- **실측**: `modelcontextprotocol|mcp-server|mcp_server` grep — 백엔드·프론트·q-note 전체 0건. package.json 의존성에도 없음. MCP 서버도 클라이언트도 존재하지 않음 (1점은 "붙일 자리가 이미 준비된 구조"에 대한 점수).
- 최단 경로 설계는 ⑥ 참조.

### 12. Knowledge management — 6/10

- **파이프라인 완결**: 문서→`splitIntoChunks`(180단어/20오버랩, `kb_service.js:74-92`)→text-embedding-3-small 1536d(`:14-15`)→BLOB. Pinned FAQ 별도 임베딩(`:151-162`). 하이브리드 = 코사인 + LIKE 폴백(`:194,244`) + scope 가중 client 1.20 > project 1.10 > workspace(`:249-254`). 자동 태그 LLM+빈도 폴백(`:287-365`). 위키는 FULLTEXT ngram + kb_chunks 재사용(source_type ENUM).
- **지식 순환 루프 실존**: cueKnowledge 주간 채굴 cron(`services/cueKnowledge.js:122`), 지식카드가 Cue 컨텍스트 최상단 주입(`cue_context.js:472-477`), 위키 미답변 질문 클러스터→초안 제안(사람 승인 게이트, `wikiQuestionCluster.js:5`). AI 답변→사람 확정→다시 AI 근거가 되는 사이클이 설계돼 있음.
- **AI 답변 결합도**: Cue 채팅·자동응답·이메일 FAQ 초안(`cue_orchestrator.js:402-404`)·research task·Q helper 위키 RAG — 5개 소비처 실연결.
- **감점**: ①최근 200청크 recency 윈도우(`:226`)가 규모에서 recall 파괴 ②threshold 산재(0.3 `:274-275`, 0.4 `cue_orchestrator.js:210-211`, 주석의 0.78 `:172` 은 코드에 없음 — 문서-코드 불일치) ③re-ranking·질의 확장 없음 ④FTS 인덱스는 위키만, KB 본류는 LIKE.

### 13. Human-AI collaboration — 7/10

- AI 가 사이드 챗봇이 아니라 **워크플로 내부 지점들**에 배치됨:
  - 채팅: Cue draft 메시지에 승인/거절 (`ai_draft_approved` 3상태 — null/true/false, `conversations.js:597` 미승인 draft 는 unread 집계 제외까지 정합).
  - 업무: 후보카드 인박스(`components/Common/TaskCandidateCard.tsx` 공유 컴포넌트) → 승인 시 Task 승격. Cue 산출물은 reviewing 상태로 기존 컨펌 워크플로에 합류 — **AI 전용 UI 를 새로 만들지 않고 사람용 검토 루프를 재사용** (설계적으로 옳음).
  - 추정: AI 추천 → 사용자 확정 이력이 `TaskEstimation.source('ai'|'user')` 로 분리 저장 → few-shot 재학습 (`routes/task_estimations.js:28-45`).
  - 전역: `CueHelpDrawer` 앱 셸 상주 (`App.tsx:540`, ⌘? 호출), `AiRegenerateBar`·`AiActionButton` 공통 컴포넌트.
  - 출처 투명성: `ai_sources` JSON 으로 근거 스니펫+score 저장 (`cue_orchestrator.js:230-246`) — 사용자가 "왜 이 답인지" 추적 가능.
- **감점**: confidence 가 LLM 판단이 아니라 검색 top score (`cue_orchestrator.js:203-206`) — KB 없는 질문의 smart 모드 분기(`:221` `confidence >= 0.5`)가 사실상 "검색 히트 여부"로 작동. AI 활동 통합 피드(Cue 가 이번 주 한 일) 부재.

---

## ③ 진짜 해자 (moat)

**1. "대화→업무→청구→증빙" 단일 관계 그래프 + 그것을 걷는 권한 스코프 컨텍스트 빌더.**
실측: 한 conversation 에서 `cue_context.js` 5쿼리로 프로젝트 stage·진행 업무·고객 미수금·서명 현황까지 도달 (`:54-165`), 재무는 owner 만 보이게 잘라서 (`:229-241`). Slack(대화만)·Asana(업무만)·토스/자비스(청구만)는 이 조인을 **자기 DB 안에서** 할 수 없다. 경쟁자가 베끼려면 제품 3개를 한 스키마로 다시 짜야 함. AI 관점에서 이것은 "에이전트가 걸을 수 있는 사전 조인된 업무 그래프"이고, PlanQ 의 유일한 구조적 자산이다.

**2. 한국 증빙 컴플라이언스가 데이터 모델에 내장.**
`receipt_corrections`(부가세법 §70 6사유 ENUM)·`receiptsDue` 단일원천·세금계산서/현금영수증 회차별 마킹 — 외산 AI 업무툴이 단기간에 못 따라오는 로컬 도메인 깊이.

**3. AI 산출물의 1급 시민 태깅 + 비용 원장.**
`messages.ai_*` 7컬럼·`TaskEstimation.source`·append-only 이력 4종·`cue_usage` action_type 별 토큰/원가 rollup — "AI 가 무엇을 근거로 뭘 했고 얼마 들었나"가 처음부터 스키마에 있음. 향후 에이전트 신뢰·과금의 기반이며, 나중에 소급 구축하기 매우 비싼 종류의 자산.

**반(反)해자 경고**: LLM 호출부 자체(단발 gpt-4o-mini completion)는 해자가 아니다 — 누구나 2주면 베낌. 해자는 전부 데이터 모델과 권한 계층에 있다.

---

## ④ 제거/정리 후보 (write-only·unused 실측)

모델 attribute → routes/services/middleware/frontend 참조 스캔 (heuristic, 총 119건 플래그). 대표 확정 건:

| 후보 | 근거 | 판정 |
|------|------|------|
| **PortOne 잔재 일체** — `Payment.portone_imp_uid/merchant_uid/status/meta`, `Business.portone_api_secret/channel_domestic/channel_overseas` | 참조 0 (admin 설정 write 경로만, `routes/admin.js:435`). Stripe 로 확정됐고 (memory: 토스 보류·Stripe 완료) 결제 실로직에서 미사용 | 컬럼 drop 또는 "미래 PG" 명시 주석 |
| **Popbill 잔재** — `Business.popbill_link_id/popbill_secret_key` | 참조 0. CLAUDE.md 명시 "PlanQ는 홈택스/팝빌 자동발행 X" | drop |
| `Project.paused_at` | 쓰는 곳 0 — `services/overdue_handler.js:8-10` 주석이 자백: "옛 동작 제거". 남은 건 클리어 로직(`:152,161`)과 recurring 의 null 세팅(`recurring_invoice.js:233`)뿐 | 옛 데이터 정리 후 drop |
| `EmailThreadParticipant.is_viewing/viewing_started_at/is_drafting/drafting_started_at/last_read_message_id` | 5컬럼 전부 참조 0 — presence 기능 설계만 하고 미구현 | drop 또는 backlog 명시 |
| `EmailMessage.ai_intent/ai_processed_at/delivery_error` | 참조 0 — 이메일 AI 분류 미구현 흔적 | drop |
| `Message.cue_draft_processing_by/cue_draft_processing_at` | 참조 0 — draft 잠금 설계 흔적 | drop |
| `InvoicePayment.pg_provider/pg_channel/pg_transaction_id/pg_raw_response/fee_amount/net_amount/refunded_amount/recorded_by` | 8컬럼 참조 0 — PG 연동 대비 선반영. `feedback_staged_infra_rollout`(미리 일반화 금지) 위반 사례 | Stripe 워크스페이스 결제와 통합하거나 drop |
| `Business.storage_used_bytes/storage_limit_bytes` | 참조 0 — 실집계는 `BusinessStorageUsage` 테이블로 이관됨. 이중 표현 잔재 | drop |
| `BusinessMember.monthly_salary` | 참조 0 | 인건비 기능 없으면 drop (민감정보가 스키마에 잠복) |
| `Conversation.last_ai_summary_at`, `Document.ai_prompt/search_text/pdf_generated_at` | 참조 0 | drop |
| `Quote` 모델 대부분 컬럼 (`quote_number/vat_amount/signature_url/converted_invoice_id` 등) | Quote 모델 자체가 `projectStageEngine.js`·`docs.js` 에서 존재 확인 수준. 견적은 Post(category=quote) 로 흡수된 것으로 보임 | Quote 테이블 운명 결정 필요 (이중 견적 표현) |

주의: 스캔은 raw SQL·스크립트 제외 heuristic — `OpsCapacityLog` 계열은 `scripts/ops-capacity-check.js` 가 사용하므로 오탐(제외). drop 전 개별 grep 재확인 필수.

---

## ⑤ AI-네이티브로 가는 병목 5

**병목 1 — LLM 게이트웨이 부재 (function calling 의 구조적 봉쇄).**
근거: raw fetch 13개 파일 (`cue_orchestrator.js:102`, `cue_task_executor.js:20`, `kb_service.js:305`, `task_extractor.js:29`, `aiTaskPlanner.js:150`, `brief_service.js:157`, `translation_service.js:68`, `reportNarrative.js:44`, `routes/cue.js:182,325`, `routes/task_estimations.js:70`, `routes/tasks.js:762`, `wikiQuestionCluster.js:34`), `tools:` 파라미터 사용 0건.
왜 병목인가: 툴 호출·스트리밍·모델 라우팅·프롬프트 버전·평가 로깅을 넣을 **단일 지점이 없다**. "Cue 에게 업무 생성 권한을 주자" 같은 다음 단계가 13곳 동시 수술이 됨. `services/llm_gateway.js` 하나로 수렴이 모든 AI 로드맵의 선행 조건 (q-note 의 `llm_service.py:24` env 패턴이 사내 선례).

**병목 2 — 검색/메모리 레이어가 스케일 불가 (최근 200청크 벽).**
근거: `kb_service.js:224-227` (`limit: 200, order id DESC` + JS 코사인), 임베딩 BLOB(`:46-59`), 전방위 검색은 `LIKE %term%` (`cue_context.js:177-179`), 현황은 row 800개 로드 (`:277`).
왜 병목인가: AI-네이티브 OS 의 핵심은 "워크스페이스 전체를 기억하는 에이전트"인데, 지금 구조는 지식이 쌓일수록 **오히려 잊는다** (201번째 청크부터 옛 문서 탈락). 벡터 인덱스(MySQL 8.0 이면 최소 전량-로드 제거를 위한 외부 인덱스 또는 sqlite-vec/qdrant 사이드카) 없이는 컨텍스트 축 전체가 장난감 규모에 갇힘.

**병목 3 — durable execution 부재 (에이전트를 믿고 맡길 수 없는 런타임).**
근거: fire-and-forget `executeForTask(task.id).then(...)` (`routes/tasks.js:517`), 실패 = AuditLog 1행 (`cue_task_executor.js:186-197`), 인메모리 타이머 `Map` (`taskExtractorScheduler.js:29-31`), 웹 프로세스 내 자정 체인 (`server.js:450-507`), 큐/Redis 의존성 0, PM2 `instances: 1` (`prod-ecosystem.config.js:26`).
왜 병목인가: 다단계 에이전트 작업(조사→초안→검토요청→수정)은 분 단위로 걸리고 실패·재시도가 기본인데, 재시작 한 번에 실행 중이던 모든 AI 작업이 증발하는 런타임 위에는 올릴 수 없다. job 테이블 기반 워커(이미 `exportJobWorker` 30초 tick 패턴 존재 — `server.js:535` — 이걸 일반화)가 최소 요건.

**병목 4 — 행동 계층(action layer) 부재: 상태 전이가 라우트에 갇혀 에이전트가 호출할 수 없다.**
근거: task 전이 규칙이 12개 HTTP 핸들러에 인라인 (`task_workflow.js:275,324,388,496`), 워크플로 라우트는 side-effect 직접 호출 강제(memory `feedback_workflow_routes_bypass_side_effects` — 즉 라우트 밖에서 안전하게 전이할 공식 함수가 없음), Cue 쓰기는 권한 검사 우회 직접 write (`cue_orchestrator.js:261`, `cue_task_executor.js:212`).
왜 병목인가: 에이전트에게 "업무 완료 처리해줘"를 시키려면 ①유효 전이 목록을 기계가 열거할 수 있어야 하고 ②사람과 같은 권한 검사를 통과해야 하는데, 둘 다 불가능. `submitReview(taskId, actor)` 류의 **서비스 함수 + actor(사람|Cue) 공통 권한 검사**로 추출해야 UI·에이전트·MCP 가 같은 문을 쓴다. 이것이 §6 의 읽기/쓰기 권한 비대칭의 해법이기도 함.

**병목 5 — 외부 개방성 0: API key·webhook·MCP 부재로 AI 생태계 진입 불가.**
근거: x-api-key 계열 grep 0, outbound webhook 0 (inbound Stripe 뿐 — `server.js:258-259`), OpenAPI 0, MCP 0 (전 코드베이스 grep).
왜 병목인가: 2026년의 AI-네이티브 OS 는 고객의 Claude/ChatGPT/자체 에이전트가 **밖에서** 접속하는 플랫폼이다. 지금은 JWT 세션 브라우저만 진입 가능 — PlanQ 의 해자(업무 그래프)를 외부 AI 가 소비할 통로가 전무해, 해자가 자산이 아니라 고립으로 작동할 위험.

---

## ⑥ MCP 를 붙인다면 — 기존 구조상 최단 경로

현 구조에서 MCP 서버는 **신규 시스템이 아니라 어댑터**다. 필요한 부품이 이미 있음:

1. **인증**: `refresh_tokens` 테이블 패턴 재사용해 `api_tokens` (user_id, business_id, scopes, hash) 신설 → MCP 서버가 토큰을 `getUserScope(userId, businessId)` (`access_scope.js:24`) 로 교환. **Cue user 와 동일한 원칙: 토큰 소유자의 scope 로 모든 읽기/쓰기 격리.** 별도 권한 체계를 만들지 않는 것이 핵심.
2. **읽기 툴 = cue_context 재포장** (공수 최소, 가치 최대):
   - `workspace_overview` → `getWorkspaceOverview` (`cue_context.js:255`)
   - `search_workspace` → `getWorkspaceMatches` (`:181`) + `kbService.hybridSearch` (`kb_service.js:168`)
   - `get_client_360` → `getClientSnapshot` (`:141`)
   - `get_project_status` → `getProjectSnapshot` + `projectStageEngine` next_action
   전부 이미 권한 스코프를 받는 함수 — MCP tool 시그니처만 씌우면 됨.
3. **쓰기 툴 = 병목 4 의 action layer 선행 필요**: `create_task`/`submit_review`/`draft_invoice` 는 라우트에서 서비스 함수로 추출한 뒤 노출. 추출 전에 쓰기 툴을 열면 Cue 와 같은 "권한 우회 직접 write" 를 복제하게 됨 — 순서 엄수.
4. **배치 위치**: 별도 프로세스 (`planq-mcp`, PM2 신규 앱) 로 `dev-backend/services` 를 라이브러리로 require — POS 공존 서버 특성상 포트 분리. Express 에 끼워넣지 않는 이유: MCP 는 stdio/SSE 수명주기가 다르고, 병목 3 의 단일 프로세스에 부하를 더하지 않기 위함.
5. **감사**: 모든 MCP 툴 호출을 `createAuditLog({ userId: token.user_id, action: 'mcp.<tool>' })` — Cue 감사 패턴 (`cue_orchestrator.js:280`) 그대로.

예상 절단면: 신규 파일 3~4개 (mcp server, api_tokens 모델+라우트, tool 정의) + access_scope 무수정. 보안 경계 변경이므로 **Fable 게이트 대상** (CLAUDE.md §5).

---

## 부록 — 측정 원자료 요약

- 라우트 57파일 33,645줄 / 서비스 86파일 16,894줄 / 모델 109개 / GET 라우트 272개 / parsePagination 채택 11파일
- LLM 호출 파일 13+ (전부 OpenAI raw fetch, function calling 0, 스트리밍 0)
- cron: node-cron 9 + 자정체인 10잡 + setInterval 2 + 디바운스 1 (전부 웹 프로세스 내)
- 테스트: 백엔드 unit/API 테스트 프레임워크 0 (`package.json` scripts: start/dev/sync-db 뿐). e2e 하니스는 UI 회귀 전용
- MCP·API key·outbound webhook·OpenAPI: 0 (grep 실측)
- 죽은/write-only 컬럼 플래그: 119건 (heuristic 스캔, 스크립트: 세션 스크래치패드 `scan-writeonly.js`)
