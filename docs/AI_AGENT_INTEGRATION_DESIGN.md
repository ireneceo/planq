# AI 에이전트 연동 설계 — ChatGPT 첫 클라이언트 (#439 · #440 · #412)

> 작성: 2026-10-02 (Fable, PHASE 1 조사 + PHASE 2 설계). **코드 변경 없음.**
> 범위: ChatGPT 에서 자연어로 PlanQ 데이터를 조회·생성·수정하는 **공식 연동**의 production 아키텍처.
> 전제: 기존 구조 유지 · 외부 AI 의 DB 직접 접근 금지 · 기존 권한·테넌트 격리 그대로 · provider-independent.
>
> 이 문서의 결론 한 줄 — **새 시스템을 짓지 않는다.** 이미 운영에 떠 있는 MCP 읽기 서버(`mcp/server.js`)와
> 행동 계층(`services/actions/*`) 위에 ①OAuth 2.1 인증 서버 ②provider 중립 툴 레지스트리(정책·멱등·오류 봉투)
> 두 층만 얹는다. 첫 milestone(업무 검색·생성·메모 조회·추가)은 **이 두 층 + 툴 4개**면 끝난다.

---

## 0. 요약

| 항목 | 결론 |
|---|---|
| 연동 방식 | **MCP(Streamable HTTP) + OAuth 2.1** — OpenAI·Anthropic 양쪽 공식 요구와 일치. 2023 Plugin(OpenAPI manifest)·GPT Actions 는 쓰지 않는다 |
| 인증 | PlanQ 가 **자체 OAuth 2.1 인증 서버**가 된다(DCR·PKCE S256·refresh 회전·revoke). 사용자가 ChatGPT 에서 «연결» → PlanQ 로그인 → 워크스페이스·권한 동의 → 토큰 |
| 권한 | 토큰 = (user × **하나의** workspace × scopes). 서버는 토큰에서만 신원을 읽고, 모델이 보낸 id 는 **대상 식별**에만 쓴다(테넌트 판단 ✕). 권한은 기존 `getUserScope`·`canAccessTask`·`assertMenuWrite` 그대로 |
| 쓰기 | 전부 **행동 계층**(`task_actions` 등)을 지난다 — Cue·사람과 **같은 문**. 이력·알림·broadcast·감사 자동 |
| 감사 | `audit_logs.new_value.acting_for = { permission_basis:'oauth_grant', provider:'openai', client_id, grant_id }` + `tasks.created_via='agent'` |
| 위험도 | LOW(읽기·메모·단건 생성) 즉시 / MEDIUM(담당자·마감·상태·다건) **서버측 2단계 확인** / HIGH(삭제·금액·계약·외부발송·권한) **툴 자체를 두지 않는다** |
| 오류 | `{ ok:false, error:{ code, message, candidates?, fields? } }` — NOT_FOUND · MULTIPLE_MATCHES · PERMISSION_DENIED · VALIDATION_ERROR · AUTH_REQUIRED · CONFIRMATION_REQUIRED · CONFLICT · RATE_LIMITED · QUOTA_EXCEEDED |
| 멱등 | 쓰기 툴은 `idempotency_key`(선택) 또는 **파라미터 지문** 으로 10분 창 안 재호출을 같은 결과로 되돌린다 |
| 첫 milestone | `search_tasks` · `create_task` · `get_task_notes` · `add_task_note` (+ 보조 `get_context`) — 약 **6~7 작업일** |
| Fable 게이트 | **R=1** (무인증 공개 표면 신설 · 인증 미들웨어 · 멀티테넌트) → 구현 단계에서 게이트 필수 |

---

## 1. 공식 문서 조사 (2026-10-02 확인)

### 1.1 OpenAI — ChatGPT 에 외부 SaaS 를 붙이는 2026 공식 방식

| 확인 사항 | 내용 | 출처 (2026-10-02 fetch) |
|---|---|---|
| 제품명 | **«Plugins»** — MCP 서버(+선택적 UI 컴포넌트)로 만든다. 옛 «Apps SDK» 주소는 `/plugins/` 로 **301 리다이렉트** 된다(`/apps-sdk/build/auth` → `/plugins/build/auth`, 실측) | https://developers.openai.com/plugins · https://developers.openai.com/plugins/build/mcp-server |
| 전송 | «Expose a **streamable HTTP** endpoint, typically at `/mcp`» | 위 mcp-server 페이지 |
| 인증 | **OAuth 2.1 필수**. «ChatGPT does **not** support machine-to-machine OAuth grants such as client credentials, service accounts, or JWT bearer assertions.» 정적 bearer/API key 불가. 서버는 «assume the token is untrusted and perform the full set of resource-server checks yourself» | https://developers.openai.com/plugins/build/auth |
| 클라이언트 등록 | 우선순위 **CIMD(Client ID Metadata Document) → DCR(RFC 7591) → 사전등록 클라이언트**. «ChatGPT prioritizes CIMD when it is available, but the plugin builder can choose DCR» | 〃 |
| 디스커버리 | RFC 9728 `/.well-known/oauth-protected-resource`(`resource`, `authorization_servers`, `scopes_supported`) + RFC 8414 `/.well-known/oauth-authorization-server`. `code_challenge_methods_supported: ["S256"]` **없으면 미지원** | 〃 |
| 인증 요구 신호 | 미인증 → `WWW-Authenticate: Bearer resource_metadata=…`; 툴 수준에서는 결과 `_meta["mcp/www_authenticate"]` 로 재인증 UI 유도. 툴 정의에 `securitySchemes`(필요 scope) 선언 | 〃 |
| resource 파라미터 | authorize·token 요청에 `resource=https://…/mcp` 를 붙여 온다 → 토큰 `aud` 에 복사해 검증 | 〃 |
| 리다이렉트 URI | `https://chatgpt.com/connector/oauth/{callback_id}`(기본) 또는 `https://chatgpt.com/connector_platform_oauth_redirect`(RFC 9207 iss 필요) | 〃 |
| 툴 주석 | `readOnlyHint`(상태 불변일 때만) · `destructiveHint`(되돌리기 어려울 때) · `openWorldHint`. «Require confirmation for consequential write actions» — 이름·설명·스키마·주석이 **사용자 노출 동작의 일부** | mcp-server 페이지 |
| 배포 경로 | ① **Developer mode**(Plus·Pro·Business·Enterprise·Edu, 베타)에서 **커스텀 커넥터**로 URL 직접 연결 — 읽기·쓰기 모두 가능. 워크스페이스 관리자가 끄거나 allowlist 할 수 있다 ② **디렉터리 제출** — 신원 확인, 웹사이트·지원·개인정보·약관 4개 URL, 양성 5·음성 3 테스트 케이스, 영상, 테스트 계정, 승인 후 **일일 자동 스캔** | https://developers.openai.com/plugins/deploy/submission · 커뮤니티 https://community.openai.com/t/mcp-server-tools-now-in-chatgpt-developer-mode/1357233 |
| 쓰기 차단 사례 | 2026-06~08 커뮤니티: Plus·Business 에서 쓰기 툴이 ChatGPT 안전 검사에 막히는 사례. OpenAI 직원 «write actions are available to everyone». **툴 설명에 비파괴성(초안·추가만, 삭제·발송 없음)을 명시**하니 통과했다는 보고 | https://community.openai.com/t/write-actions-blocked-on-custom-mcp-server-business-plan-workspace-developer-mode-unavailable-at-workspace-level/1384381 |
| 2023 Plugin 폐기 | OpenAI 공식 폐기 공지 페이지는 이번에 **직접 확인하지 못함(미확인)**. 현재 문서 트리에 OpenAPI manifest 방식이 없고 «Plugins = MCP 서버» 로만 정의돼 있어 옛 방식을 쓸 길 자체가 없다 | — |
| help.openai.com 문서 | fetch 가 403 — 플랜별 Developer mode 가용 범위는 **2차 출처**(검색 요약) 기준. 디렉터리 외 «링크로 비공개 배포» 가 있는지도 **미확인** | https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt (403) |

### 1.2 Anthropic(Claude) — 비교

| 확인 사항 | 내용 | 출처 |
|---|---|---|
| 인증 유형 | `oauth_dcr` · `oauth_cimd`(기본 지원) · `oauth_anthropic_creds` · `custom_connection` · `static_headers`(베타) · `none`. M2M `client_credentials` 미지원 | https://claude.com/docs/connectors/building/authentication |
| Claude 만의 엄격 조건 | **401 이어야 로그인이 시작**(200 의 WWW-Authenticate 무시) · `authorization_servers` **첫 항목만** 사용 · CIMD 는 `client_id_metadata_document_supported:true` + `token_endpoint_auth_methods_supported` 에 `none` 둘 다 있을 때만, 아니면 DCR 폴백 · 디스커버리·등록·토큰 **10초**, refresh **30초** 안에 응답 | 〃 |
| 콜백 | `https://claude.ai/api/mcp/auth_callback` · Claude Code 는 loopback `http://localhost:*/callback` / `127.0.0.1` 포트 무시 매칭 | 〃 |
| 토큰 | 401 에 reactive refresh + 만료 5분 전 proactive. refresh 무효 시 `invalid_grant`. 공개 클라이언트는 **refresh 회전**. `/token` 은 `application/x-www-form-urlencoded`, `/register` 는 JSON | 〃 |
| 트래픽 | DCR 은 연결마다 클라이언트를 등록해 **대량 등록**이 쌓인다 → 디렉터리 규모면 CIMD/Anthropic-held 권장 | 〃 |
| 발신 IP | `160.79.104.0/21` | 〃 |

**결론.** 두 회사가 요구하는 것은 **같은 한 벌**이다 — Streamable HTTP MCP + RFC 9728/8414 디스커버리 + OAuth 2.1(PKCE S256, DCR 또는 CIMD, refresh 회전, 401 챌린지). 서버 하나로 ChatGPT·Claude·Claude Code 가 다 붙는다. 차이는 ①401 응답 모양 ②툴 메타(`securitySchemes`·`_meta`) ③리다이렉트 URI 허용 목록뿐이고, 그것이 곧 **provider adapter 의 크기**다(§4.3).

> SDK 확인: dev-backend 의 `@modelcontextprotocol/sdk` **1.29.0** 에 `server/auth`(mcpAuthRouter · `/authorize` `/token` `/register` `/revoke` 핸들러 · RFC 9728 메타 · `bearerAuth` 미들웨어 · `OAuthServerProvider` 인터페이스)가 들어 있다. **CIMD 는 1.29 에 없다**(grep 0건) → 1차는 DCR, CIMD 는 SDK 업그레이드 뒤.

---

## 2. 현재 PlanQ 구조 분석 (#439 가 요구한 항목 전수)

| 영역 | 현재 모습 | 연동에 미치는 뜻 |
|---|---|---|
| **Backend/API** | Express + Sequelize(MySQL) 단일 프로세스(`server.js`, :3003). 라우트 ~90개, 표준 응답 `{success,data}`. 라우트는 파싱·응답만, **상태 전이·생성은 `services/actions/*`**(task 1,589줄 · event · document · `_subject.js`) | 툴 핸들러가 부를 **서비스 함수가 이미 있다**. 라우트를 HTTP 로 재호출하지 않는다 |
| **인증** | JWT Access 15분 + Refresh 7~365일(`refresh_tokens`: sha256 해시·회전·reuse 감지·`client_kind`). `authenticateToken` 이 `kind` 가 박힌 용도별 토큰을 거부(2차 방어) | 에이전트 토큰은 **별도 서명 비밀**(`AGENT_TOKEN_SECRET`)로 만들어 브라우저 세션 표면에 **절대 못 들어오게** 한다(기존 열쇠 분리 원칙 그대로) |
| **사용자/회사/워크스페이스** | `users` ↔ `business_members`(role owner/admin/member/ai, `removed_at`) ↔ `businesses`(`deleted_at`, `timezone`, `cue_user_id`). `users.active_business_id` 가 창의 정본, 창은 `X-Workspace-Id` 를 싣고 서버는 추측하지 않는다(400/403·409 `workspace_stale`) | 토큰에 **workspace 를 박는다**(ApiToken 과 같은 모양). 모델이 보내는 `workspace_id` 는 받지 않는다 |
| **권한/role** | `middleware/access_scope.getUserScope(userId, businessId, platformRole)` → `{isOwner,isAdmin,isMember,isClient,isAi,…}`; 목록 `taskListWhere`·`calendarListWhere`·`postListWhereByLevel` / 단건 `canAccessTask`·`canAccessProject`…; 메뉴 Layer `getMemberMenuLevels`/`assertMenuWrite(qtask/qcalendar/…)`; 배정 `assertAssignable` | **그대로 재사용.** 새 술어를 쓰지 않는다. 고객(Client) 계정은 §6.4 결정 |
| **Task** | `tasks`: title/description(의뢰, 작성자만)/body(결과물, 담당자만)/assignee_id/client_id/project_id/status ENUM 10종/priority_level/start·due(DATEONLY)/estimated·actual/created_via(STRING20, 'cue' 사용 중)/request_by_user_id… + `task_comments`(visibility personal/internal/shared) · `task_reviewers` · `task_status_history` | 쓰기: `createTask`·`createComment`·`updateSchedule`·`complete`·`addReviewer`… 전부 행동 계층에 있다. **담당자 변경만 행동 계층 함수가 없다**(PUT 라우트 인라인) → §8.3 |
| **고객/프로젝트** | `clients`(display_name/company_name/phone/invite_email/sales_stage/assigned_member_id/summary…) 검색 `GET /api/sale/:biz/clients?q=`(권한 체인 `saleCommon`). `projects`(name/status/kind/default_assignee/…) 목록 `GET /api/projects?business_id=`(멤버 전체·고객 참여분) | 검색 LIKE 로직 재사용(공백 무시·NFC 는 `utils/searchMatch`). 고객 상세 요약은 `cue_context.getClientSnapshot` 이 이미 만든다(MCP 읽기 서버가 쓰는 것) |
| **메모/댓글/커뮤니케이션** | 업무 댓글 `task_comments`(행동 계층 `createComment`, 고객은 shared 만) · 프로젝트 메모 `project_notes` · 고객 상담 `client_interactions`(`POST /api/sale/:biz/clients/:id/interactions`) · 채팅 `messages` · 메일 | 1차 «메모» = **업무 댓글**. 프로젝트 메모·상담 기록은 v1-full 에서 각각 툴 1개 |
| **일정** | `calendar_events`(start_at/end_at UTC, rrule, vlevel, booking_status) 목록 `GET /api/calendar/by-business/:biz?start&end`(400일 캡, `calendarListWhere`) 생성 `event_actions.createEvent` | 읽기·생성 모두 재사용 가능. 수정은 행동 계층 함수 없음(v1 범위 밖) |
| **기존 외부 연동 API** | ✅ **MCP 읽기 서버 `mcp/server.js`** — 별도 프로세스(운영 `planq-prod-mcp`, 127.0.0.1:3005, stateless Streamable HTTP, 툴 4개 전부 읽기: `workspace_overview`·`search_workspace`·`get_client_360`·`get_project_status`). 인증 = `api_tokens`(sha256, user×business, scopes `['read']` 고정) → `getUserScope` 교환. 감사 `mcp.<tool>` + `acting_for{permission_basis:'api_token'}` | **운영 실측: nginx 에 `/mcp` 라우트 없음 → 외부에서 닿지 않는다. `api_tokens` 1건, `mcp.*` 감사 0건 = 한 번도 쓰인 적 없음.** 이 서버가 **에이전트 표면의 몸통**이 된다 |
| **OAuth/외부앱 인증** | PlanQ 는 **OAuth 클라이언트**로서만 존재(구글·애플 로그인 `routes/oauth/*`, Google Drive/Calendar `external_connections` 암호화 저장). **인증 서버(AS) 역할·DCR·동의 화면은 없다.** `EphemeralToken`(kind ENUM, 해시, attempts 원자 증가, 재시작 생존)이 OAuth 단기 상태 저장소 | AS 를 **새로 만든다**(SDK 라우터 + 우리 provider). 단기 상태(인가 요청·코드·멱등·확인)는 `EphemeralToken` kind 를 늘려 쓴다 |
| **Google 연동 방식** | `external_connections`(provider/auth_type/access·refresh 암호화/scope/expires_at) + `services/driveImport.js` 단일 진입. drive.file scope | 참고만 — 방향이 반대다(우리가 토큰을 **발급**한다). 암호화 유틸은 재사용 |
| **Rate limit / logging / audit** | security.js 일반 600/분·IP, `costGuard.perUserLimiter/perUserDaily/capText`; LLM 라우트 = rate + `plan.can('use_cue')` + 입력 캡 3종. `auditService.logAudit/createAuditLog/writeAudit`(마스킹·보존스탬프, 가드 `auditentry`), `audit_logs.acting_for_user_id` 컬럼 | 에이전트 호출은 **grant 단위 rate-limit** + 쓰기는 `cue_actions_monthly` 계량(§9.3). 감사는 기존 헬퍼만 |
| **테넌트 격리** | 모든 where 에 `business_id`, 생성 시 project/client 소속 검증(`invalid_project`/`invalid_client`), 일괄 처리는 id 필터 단계에서 범위(`resolveBulkTargetIds`), 카나리 `--suite tenant/tenantwrite`, 가드 `tenant` | 격리 축은 **토큰의 business_id** 하나. 툴 핸들러는 그 값으로만 조회한다 |
| **Cue(자체 AI)** | `services/cue_tools.js` — 쓰기 툴 6종(create_task/create_event/create_document_draft/submit_review/complete_task/add_task_comment) `validateNormalize`→행동 계층 dispatch, 제안→확인카드→`POST /api/cue/execute-action`, 킬스위치 `CUE_TOOLS_ENABLED`, 가드 `cuetools`·`cuefinance`·`cueauth`. 운영 실측 `cue.tool_execute` 0건·`created_via='cue'` 0건 | **같은 카탈로그가 두 벌이 되면 안 된다** → §8.5: 레지스트리를 만들고 cue_tools 는 2단계에서 그 위로 옮긴다 |
| **가드** | `scripts/guard-invariants.js` 58 카테고리 중 관련: `mcpreadonly`(MCP 서버에서 행동 계층 require·모델 쓰기·재무 참조·쓰기 동사 툴명 금지) · `actionlayer`/`createlayer`(라우트 직접 전이 금지) · `cuetools` · `auditentry` · `tenant` · `wsscope` | **`mcpreadonly` 는 쓰기를 여는 순간 빨간불이 맞다.** 지우지 말고 «에이전트 표면 불변식»으로 바꾼다(§11.3). 이것이 Irene 의 2026-07-11 결정(«MCP 외부 개방 보류 — 권한·행동 계층·멱등성 정비 후 재검토»)을 푸는 지점이다 |

### 2.1 #440 — 이미 적합한 것 vs 개선할 것

| 이미 적합 (그대로 쓴다) | 왜 |
|---|---|
| 행동 계층 `services/actions/*` + `_subject.resolveSubject` | «사람도 Cue 도 외부 에이전트도 같은 문» — 주석에 이미 외부 에이전트가 적혀 있다. 권한·이력·알림·broadcast·감사가 한 곳 |
| `access_scope.js` 술어 한 벌 | 목록·단건·메뉴·배정 전부. 새 술어 0 |
| MCP 읽기 서버(stateless Streamable HTTP, 요청마다 `buildServer(principal)`) | OpenAI·Anthropic 요구 전송과 일치. 프로세스·PM2·배포 슬롯까지 이미 있다 |
| `audit_logs.acting_for_user_id` + `acting_for{permission_basis}` 관례 | «누구 권한으로» 가 감사만으로 재구성된다는 설계가 이미 박혀 있다 |
| `EphemeralToken`(재시작 생존 단기 상태) | 인가 요청·코드·멱등 창·확인 토큰에 그대로 |
| 재무 영구 봉쇄(가드 `cuefinance`·`finance`) | HIGH 를 «열지 않는다» 가 이미 코드로 강제돼 있다 |
| `plan.can('use_cue')`·`cue_usage` 계량 · `costGuard` | 에이전트 쓰기 계량·속도 제한을 새로 짓지 않는다 |
| 상담=고객 축(`client_interactions`), 고객 허브(`clientTimeline`), `cue_context` 스냅샷 | «이 고객 최근 상담·업무 요약» 이 이미 함수 하나다 |

| 개선할 것 | 무엇이 없나 | 언제 |
|---|---|---|
| **OAuth 2.1 인증 서버** | AS·DCR·동의 화면·refresh 회전·revoke 전부 없음 | milestone 1 |
| **provider 중립 툴 레지스트리** | `cue_tools` 는 Cue 채팅 전용(제안→카드). 정책(위험도)·멱등·오류 봉투·stable id 반환 규약이 없다 | milestone 1 (뼈대) |
| **담당자 변경이 행동 계층에 없다** | PUT 라우트 인라인(`assignee_id` 직접 쓰기) — Cue 도 에이전트도 못 부른다 | milestone 2 (`task_actions.reassign`) |
| 일정 수정·프로젝트 생성·고객 생성이 행동 계층에 없다 | 라우트 인라인 | v1 범위 밖(#440 장기) |
| MCP 서버 외부 노출 | nginx 라우트 없음, 토큰 발급 UI 는 있는데 쓰인 적 없음 | milestone 1 |
| «AI 가 한 일» 을 보는 화면 | 감사 로그 화면에 경유(provider) 필터 없음 — #440 §4 «Control Center» 의 첫 조각 | milestone 2 |
| 성공 지표 집계 | `created_via`·감사로 셀 수는 있으나 집계 쿼리·화면 없음 | milestone 2 (쿼리) |
| 하나의 자연어 → 여러 액션(#440 §5) | 툴이 작고 composable 이면 **모델이 조합한다** — 서버에 오케스트레이터를 두지 않는다. 다만 «프로젝트 템플릿 조회·프로젝트 생성·다건 업무 생성» 툴이 있어야 가능 | v1 이후, MEDIUM 정책 위에 |

---

## 3. 권장 아키텍처

```
 ChatGPT / Claude / Claude Code / (후속) PlanQ Cue · 자동화 에이전트
        │  MCP (Streamable HTTP)  +  OAuth 2.1 Bearer
        ▼
 ┌──────────────────────────────── planq-mcp 프로세스 (:3005, nginx /agent/*) ─────────────────────────────┐
 │  mcp/server.js              transport + 401 챌린지 + 세션 없음(stateless)                                  │
 │  mcp/providers/{openai,anthropic}.js   ← provider adapter (리다이렉트 허용목록 · 툴 메타 꾸밈 · 챌린지 모양) │
 │  services/agent_oauth/*     OAuth 2.1 AS (SDK mcpAuthRouter + PlanqOAuthProvider) · DCR · 토큰 · revoke    │
 └──────────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                                │ principal = { userId, businessId, scope, grant }
                                                ▼
 ┌───────────────────── services/agent/ (provider-independent · Agent Integration Layer) ─────────────────┐
 │  registry.js   툴 카탈로그(이름·설명·zod 입력·출력 모양·risk·scopes·annotations·handler)                    │
 │  execute.js    단일 진입: 스코프 → 정책(위험도·확인) → 멱등 → handler → 감사 → 계량 → 오류 봉투              │
 │  policy.js     LOW/MEDIUM/HIGH 표 · 킬스위치 · 툴별 on/off   (provider 와 무관, 나중에 DB 설정으로 승격 가능) │
 │  idempotency.js  EphemeralToken('agent_idem')                errors.js  코드 봉투                            │
 │  tools/tasks.js · tools/notes.js · (2단계) clients · projects · calendar · members                          │
 └──────────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                                │ actor = { kind:'user', userId, platformRole, channel:{agent…} }
                                                ▼
 기존 PlanQ 서비스/행동 계층  services/actions/*  ·  access_scope  ·  cue_context  ·  saleCommon …
                                                ▼
                                             MySQL
```

- **DB 에 닿는 것은 기존 서비스뿐**이다. `services/agent/tools/*` 는 모델을 직접 `create/update/destroy` 하지 않는다(가드로 강제, §11.3).
- **세션을 두지 않는다.** 모델이 «두 번째 업무» 를 기억하는 것은 ChatGPT 의 대화 문맥이고, 우리는 매 응답에 **stable id** 를 돌려줄 뿐이다. 서버에 대화 상태가 없으므로 수평 확장·재시작·재시도에 안전하다.
- **자연어 해석은 서버에 없다.** 툴은 결정적 파라미터(`task_id`, `due_date:'2026-10-09'`)만 받는다. 날짜 계산을 위해 `get_context` 가 오늘·요일·시간대를 준다(cue_tools 가 프롬프트에 주입하던 것과 같은 값).

### 3.1 왜 이 방식인가 (대안 대비)

| 대안 | 판정 | 이유 |
|---|---|---|
| **MCP + OAuth 2.1 (채택)** | ✅ | OpenAI·Anthropic 공식 요구와 동일. 서버 하나로 전 클라이언트. 이미 있는 MCP 서버·SDK 재사용 |
| 2023 ChatGPT Plugin (OpenAPI manifest) | ✕ | 현 문서 트리에 존재하지 않음. 선택지가 아니다 |
| Custom GPT + Actions(OpenAPI) | ✕ | GPT 하나에 묶이고 Claude 등 타 클라이언트 재사용 0. 사용자별 OAuth 는 되지만 PlanQ 공식 연동으로 배포·관리 불가 |
| PlanQ 가 OpenAI API 를 호출하는 자체 챗(Cue 확장) | 보류 | #439 의 목표는 **사용자가 쓰는 ChatGPT 안**에서 쓰는 것. Cue 는 PlanQ 안의 다른 입구이고, 2단계에서 같은 레지스트리를 쓰게 한다 |
| 외부 IdP(Auth0 등)로 AS 외주 | ✕ | 월 비용·사용자 데이터 외부 저장·PlanQ 계정 체계와 이중화. SDK 가 AS 핸들러를 주므로 **우리가 provider 만 구현**하면 된다(인가 화면 1장 + 테이블 2개) |
| Apps SDK UI 컴포넌트(ChatGPT 안 위젯) | 나중 | 요구는 데이터 조회·조작. 텍스트 결과면 충분. 디렉터리 등록 때 검토 |

---

## 4. 인증 flow

### 4.1 등장 요소

| 요소 | 값 |
|---|---|
| Resource(MCP) URL | `https://planq.kr/agent/mcp` (dev: `https://dev.planq.kr/agent/mcp`) |
| Issuer(AS) | `https://planq.kr/agent` |
| 디스커버리 | `/.well-known/oauth-protected-resource/agent/mcp` · `/.well-known/oauth-authorization-server/agent` (RFC 8414 경로 삽입형 — SDK 가 둘 다 만든다) |
| AS 엔드포인트 | `/agent/authorize` · `/agent/token` · `/agent/register`(DCR) · `/agent/revoke` |
| 동의 화면 | 프론트 `/connect/agent?request=<id>` (기존 JWT 로그인 세션 사용) |
| nginx | `location /agent/` 와 `location /.well-known/oauth-` → `127.0.0.1:3005` (운영·dev 둘 다 신규) |

### 4.2 흐름

```
① ChatGPT: GET /agent/mcp (토큰 없음)
   ← 401  WWW-Authenticate: Bearer resource_metadata="https://planq.kr/.well-known/oauth-protected-resource/agent/mcp"
② ChatGPT: 디스커버리 2개 읽음 → registration_endpoint 로 DCR (client_name "ChatGPT", redirect_uris [chatgpt.com/connector/oauth/…])
   서버: redirect_uri 호스트가 provider 허용목록(§4.5)에 있을 때만 등록 → agent_clients 행 (client_id = uuid, 공개 클라이언트)
③ ChatGPT: 브라우저로 /agent/authorize?client_id&redirect_uri&code_challenge(S256)&scope&state&resource
   서버: 검증 → EphemeralToken('agent_authreq', request_id, {client_id, redirect_uri, challenge, scope, state, resource}, 10분)
         → 302 /connect/agent?request=<request_id>
④ 사용자(브라우저): PlanQ 로그인(있으면 통과) → 동의 화면
     - 어느 앱이 연결하나(client_name · redirect 호스트)  · 어떤 권한(scope 묶음)  · **어느 워크스페이스**(소속 중 선택)
     - [연결] → POST /api/agent/oauth/consent {request_id, business_id, approve:true}  (authenticateToken, :3003)
   서버(:3003): 요청 로드 → 멤버 이상 확인(getUserScope) → agent_grants 생성(pending) → 코드 발급
                EphemeralToken('agent_code', sha256(code), {grant_id, challenge, redirect_uri, resource}, 2분, attempts 상한)
                → 응답 { redirect: redirect_uri?code=…&state=… }  → 브라우저가 이동
⑤ ChatGPT: POST /agent/token (form-urlencoded) grant_type=authorization_code + code_verifier + resource
   서버: 코드 1회 소비(consume) · PKCE 검증(SDK) · redirect_uri·resource 일치 → grant active
         access = JWT(AGENT_TOKEN_SECRET, { kind:'agent', gid, uid, bid, scp, aud: resource, exp: 1h })
         refresh = 랜덤 43자 → sha256 → agent_grants.refresh_token_hash (회전, 만료 90일 sliding)
⑥ ChatGPT: POST /agent/mcp  Authorization: Bearer <access>
   서버: JWT 검증(별도 비밀·kind·aud) → grant 로드(revoked_at NULL) → user active·멤버십 생존 → principal
⑦ 만료: 401 → ChatGPT 가 refresh → 새 access + 새 refresh(옛 것 즉시 무효). refresh 재사용 감지 시 grant 전체 revoke(refresh_tokens 의 reuse_detected 와 같은 정책)
⑧ 해제: (a) PlanQ 설정 «연결된 AI 앱» [연결 해제] → revoked_at  (b) ChatGPT 쪽 삭제 → /agent/revoke (SDK 핸들러)
        (c) 멤버십 해제·계정 정지·워크스페이스 삭제 → 다음 호출의 ⑥ 에서 자동 거부 (grant 를 지우지 않아도 닫힌다)
```

### 4.3 왜 토큰 모양이 이렇게인가
- **access 는 JWT**(1시간) — 매 호출 DB 1회(grant)로 즉시 revoke 반영. 다른 비밀·`kind:'agent'`·`aud` 셋으로 브라우저 세션 표면과 상호 침투 불가(`authenticateToken` 은 `kind` 가 있으면 거부한다 — 이미 있는 2차 방어).
- **refresh 는 불투명+해시**(`refresh_tokens` 와 같은 방식). 평문은 DB 에 없다.
- **grant 는 한 워크스페이스** — `api_tokens` 와 같은 모양이고, «창 하나 = 워크스페이스 하나» 계약(CLAUDE.md)과 같은 축이다. 다른 워크스페이스는 **연결을 하나 더** 한다(동의 화면에서 다른 것을 고른다). 모델이 보낸 `workspace_id` 로 범위를 바꾸는 문은 두지 않는다.

### 4.4 scope
Irene 이 예시한 8개를 **그대로 쓴다**(세분화 비용이 거의 없다 — 레지스트리의 툴마다 required scope 한 줄):
`tasks:read tasks:write notes:read notes:write clients:read projects:read schedule:read schedule:write`
- 동의 화면은 **묶음 2개**로 보여준다 — «읽기만» / «읽기 + 추가·수정». 8개 체크박스는 사용자가 못 고른다.
- 클라이언트가 요청한 scope 교집합만 발급. 없는 scope 로 툴을 부르면 `PERMISSION_DENIED{reason:'scope'}` + `_meta["mcp/www_authenticate"]`(ChatGPT 재인가 유도).
- `scopes_supported` 에 `offline_access` 를 **싣지 않는다** — refresh 는 항상 발급한다(Claude 는 있으면 붙여 요청할 뿐).

### 4.5 provider adapter (`mcp/providers/*.js`) — 작게
```js
// openai.js
module.exports = {
  id: 'openai',
  redirectHosts: ['chatgpt.com'],                       // DCR 허용 · provider_hint 결정
  decorateTool: (def) => ({ ...def, securitySchemes: [{ type:'oauth2', scopes: def.scopes }] }),
  authChallengeMeta: (desc) => ({ 'mcp/www_authenticate': `Bearer error="insufficient_scope", error_description="${desc}"` }),
};
// anthropic.js — redirectHosts ['claude.ai', 'localhost', '127.0.0.1'(포트 무시)], decorateTool = identity
```
adapter 는 **인증 모양과 메타만** 바꾼다. 툴 목록·스키마·정책은 레지스트리 하나다. 새 provider = 파일 1개.

---

## 5. Authorization · 테넌트 격리

1. **신원과 범위는 토큰에서만.** `principal = { userId, businessId, scope(getUserScope), platformRole, grant }`. 입력 JSON 의 `business_id`·`workspace_id`·`user_id`·`company_id` 는 **스키마에 없다**(zod `strict()` → 보내면 VALIDATION_ERROR).
2. **대상 id 는 범위 안에서만 해석.** `task_id` → `Task.findOne({ id, business_id: principal.businessId })` → 없으면 **NOT_FOUND**(존재 여부를 흘리지 않는다). 그 다음 `canAccessTask` → 안 되면 PERMISSION_DENIED.
3. **쓰기는 행동 계층.** `actor = { kind:'user', userId, platformRole, req:null, channel:{ kind:'agent', provider, grant_id, client_id } }`. 권한은 `resolveSubject`→`assertMenuWrite`→`assertAssignable`→`canAccessTask` 가 **정상 라우트와 똑같이** 건다. 새 권한 상승 경로 0.
   - `kind:'user'` 를 쓰는 이유: 권한의 주체는 토큰을 발급한 **사람 본인**이다(Cue 의 위임 모델과 다르다 — 위임자 해석이 필요 없다). `channel` 은 감사·표시 전용이고 도메인 판단에 쓰지 않는다(`req` 와 같은 지위).
4. **목록은 기존 where 함수.** `taskListWhere`·`calendarListWhere`·sale `readChain` 조건을 그대로. `Op.and` 안에 넣는다(최상위 키 덮어쓰기 사고 재발 방지).
5. **메뉴 권한.** 읽기 툴도 `getMemberMenuLevels` 로 `none` 이면 PERMISSION_DENIED(`forbidden_menu_hidden`) — UI 에서 안 보이는 메뉴를 ChatGPT 로 보면 안 된다.
6. **고객(Client) 계정** — v1 은 **멤버 이상만** 연결 허용(동의 화면에서 거부 문구). 고객 권한 매트릭스를 외부 표면에서 재검증하는 비용 대비 수요가 없다. (Irene 결정 ⑤)
7. **AI 멤버(`role:'ai'`)·게스트·정지 계정** — 동의 단계와 매 호출 ⑥에서 거부.
8. **응답에 자격증명·비밀 금지** — 툴 출력은 **화이트리스트 직렬화**(`serializeTask` 등)만. `invite_token`·`share_token`·해시 컬럼은 애초에 모양에 없다(가드 `secrets` 계열 검사를 에이전트 응답에도 1건 추가).

---

## 6. 툴 카탈로그

### 6.1 공통 규약
- **이름**: `동사_대상` snake_case. 설명은 **비파괴성**을 명시한다(ChatGPT 안전 검사 통과 조건이자 사용자에게 보이는 문장).
- **stable id**: 모든 항목에 `task_id`·`client_id`·`project_id`·`note_id`·`event_id`·`user_id`(정수) + `url`(PlanQ 딥링크 `https://planq.kr/tasks?task=123`). 후속 툴은 이 id 만 받는다.
- **이름 기반 해석은 검색 툴이 한다**: `search_*` 가 후보를 돌려주고 모델이 고른다. 쓰기 툴에 `assignee_name` 같은 이름 입력은 **두지 않는다**(cue_tools 와 다른 점 — 거기서는 로스터를 프롬프트에 넣었지만 여기서는 모델이 `search_members` 를 부른다). 확신이 없으면 모델이 사용자에게 묻는다 — 그 판단 재료가 `MULTIPLE_MATCHES.candidates` 다.
- **날짜**: `YYYY-MM-DD`(DATEONLY) / 일시 ISO8601(워크스페이스 시간대 오프셋 포함). 잘못된 날짜(2월 31일)는 VALIDATION_ERROR(기존 `normDateInput` 재사용).
- **출력은 구조화 JSON**(`structuredContent` + 같은 내용의 text). 목록은 `{ items, total, truncated }`, 상한 50.
- **오류 봉투**(툴 결과, `isError:false` — 모델이 읽고 대응해야 하므로 프로토콜 오류로 던지지 않는다):
  ```json
  { "ok": false, "error": { "code": "MULTIPLE_MATCHES", "message": "…", "candidates": [ {"task_id":12,"title":"…"} ], "fields": null, "retry_after_sec": null } }
  ```
  | code | 언제 | 행동 계층 code 매핑 |
  |---|---|---|
  | `NOT_FOUND` | 범위 안에 없음 | `task_not_found`·`invalid_task`·`invalid_project`·`invalid_client` |
  | `MULTIPLE_MATCHES` | 검색 툴이 «정확 일치 1건» 을 못 고를 때 (후보 ≤10 동봉) | — |
  | `PERMISSION_DENIED` | 권한·scope·메뉴·배정 불가 | `forbidden`·`menu_forbidden:*`·`cannot_assign:*`·`only_assignee`·`forbidden_fields:*`·scope |
  | `VALIDATION_ERROR` | 스키마·날짜·길이 (`fields:{due_date:'invalid'}`) | `title required`·`invalid_date*`·`content_required` |
  | `AUTH_REQUIRED` | 토큰 없음/만료/grant revoke — HTTP 401 + 챌린지(툴 레벨이면 `_meta`) | — |
  | `CONFIRMATION_REQUIRED` | MEDIUM 툴 1차 호출 (`confirmation_token`·`preview` 동봉) | — |
  | `CONFLICT` | 상태가 허용하지 않음 (닫힌 업무·보류·컨펌 대기) | `task_closed`·`task_on_hold`·`not_ready_for_complete`·`no_reviewers_*` |
  | `RATE_LIMITED` / `QUOTA_EXCEEDED` | costGuard / `plan.can` | `cue_quota_exceeded` |
  | `INTERNAL` | 예외 — 상세 없이 request_id 만 | — |

### 6.2 첫 milestone (4 + 보조 1)

| 툴 | risk | scope | 입력 | 출력 | 재사용 |
|---|---|---|---|---|---|
| `get_context` | LOW·read | (없음) | — | `{ user:{user_id,name}, workspace:{business_id,name,timezone}, today:'2026-10-02', weekday:'fri', now_iso, members_count }` | `Business`·`BusinessMember`·`cue_tools.buildToolSystemContext` 의 날짜 계산 |
| `search_tasks` | LOW·read | `tasks:read` | `{ query?:string≤100, assignee?:'me'|'anyone'|user_id(기본 'me'), status?:'open'|'overdue'|'done'|'all'(기본 open), due_from?, due_to?, project_id?, client_id?, limit?≤50 }` | `{ items:[{task_id,title,status,status_label,due_date,start_date,priority,assignee:{user_id,name},requester?,project?,client?,updated_at,url}], total, truncated }` | `taskListWhere` + `by-business/:id/search` 의 LIKE·NFC·escape, `utils/taskLabel` 라벨 키, `applyMemberDisplayName` |
| `create_task` | LOW·write | `tasks:write` | `{ title*:≤300, description?:≤5000, due_date?, start_date?, assignee_user_id?, project_id?, client_id?, priority?:'low'|'normal'|'high'|'urgent', idempotency_key? }` | `{ task:{…search 항목 모양}, created:true | replayed:true }` | **`task_actions.createTask`** (`createdVia:'agent'`, `autoAiEstimate:false`) — 담당자 미지정이면 기존 체인(프로젝트 기본담당자→PM→본인) |
| `get_task_notes` | LOW·read | `notes:read` | `{ task_id*, limit?≤50, before_note_id? }` | `{ task:{task_id,title}, items:[{note_id,author:{user_id,name},visibility,content,created_at}], truncated }` | `canAccessTask` + `TaskComment` 조회(detail 라우트의 고객 필터·`serializeTaskComment`·표시명 그대로) |
| `add_task_note` | LOW·write | `notes:write` | `{ task_id*, content*:≤5000, visibility?:'internal'|'shared'(기본 internal), idempotency_key? }` | `{ note:{…}, created:true | replayed:true }` | **`task_actions.createComment`** (알림·Cue 반응·broadcast 포함) |

`get_task`(상세)는 milestone 1 에 **같이 넣는다**(검색 결과 항목 모양 + description + reviewers + 최근 note 3건 — 비용이 거의 없고 «두 번째 업무 자세히» 가 바로 온다).

### 6.3 v1 전체 (milestone 2) — #439 Read/Write 목록 대응

| #439 요구 | 툴 | risk | 행동 계층/서비스 | 비고 |
|---|---|---|---|---|
| 업무 상세 | `get_task` | LOW | detail 라우트 로직 | m1 포함 |
| 업무 수정(제목·설명) | `update_task` | LOW | `Task.update` 를 **행동 계층 함수로 추출**(`task_actions.updateFields` — title/description/priority/client_id, §5.7 책임선) | 담당자·마감·상태는 별도 툴 |
| 마감일 변경 | `reschedule_task` | **MEDIUM** | `task_actions.updateSchedule` (이미 있음, 이력·알림 포함) | 확인 2단계 |
| 담당자 지정 | `assign_task` | **MEDIUM** | **신설 `task_actions.reassign`**(PUT 인라인 → 추출, `assertAssignable`·이력·알림) | 가드 `actionlayer` 가 추출을 요구한다 |
| 업무 완료 | `complete_task` | **MEDIUM** | `task_actions.complete` (담당자만·컨펌 정책) | 거부 code 를 CONFLICT 로 설명 |
| 고객 검색/상세 | `search_clients` · `get_client` | LOW | sale 목록 LIKE + `cue_context.getClientSnapshot`(이미 MCP 가 쓴다) | «최근 상담·업무 요약» = get_client 의 `recent` |
| 프로젝트 검색/상세 | `search_projects` · `get_project` | LOW | projects 목록 + `cue_context.getProjectSnapshot` | |
| 멤버 찾기 | `search_members` | LOW | `BusinessMember`+표시명(비-AI·비고객) | 담당자 해석용 |
| 메모(프로젝트) | `get_project_notes` · `add_project_note` | LOW | `project_notes` 라우트 로직 → 함수 추출 | |
| 고객 상담 기록 | `add_client_interaction` | LOW | `POST /api/sale/:biz/clients/:id/interactions` 로직 | «오늘 논의 상담으로 저장» |
| 일정 조회 | `list_events` | LOW | `calendarListWhere` + 반복 전개(목록 라우트 함수 추출, 400일 캡) | |
| 일정 생성 | `create_event` | LOW(단건) | `event_actions.createEvent` | 참석자 지정은 MEDIUM(알림 발송) → v1 은 참석자 없이 |
| 프로젝트 만들기 (2026-10-07) | `create_project` | **MEDIUM** | **신설 `project_actions.createProject`**(POST /api/projects 본문 이전 — 화면도 같은 함수) | scope `projects:write`(신설·재연결). 이미 있는 고객(`client_ids`)·멤버(`member_user_ids`)만 · 미리보기에 이름·계정 고객 가시성 · 요금제 한도를 미리보기에서 먼저 · 채널 = 내부(+고객 프로젝트면 고객) · 초대 메일 없음 · 계정 고객은 `joinProjectCustomerChannels` |
| 업무 태그·예상시간 (2026-10-07) | `create_task` `tag_names?`·`estimated_hours?` | LOW | `task_actions.createTask` `tagIds`·`estimatedHours` | 태그는 **있는 것만**(없으면 VALIDATION + 목록, 만들지 않음) · 예상시간은 담당자=본인일 때만(§5.7) |
| 컨펌자 지정 (2026-10-07) | `add_task_reviewers` | **MEDIUM** | `task_actions.addReviewer`(알림·이력·감사) | 미리보기에 이름 · 실행과 같은 판정(권한·배정 게이트·중복) |
| Q note 메모 (2026-10-07) | `create_memo` | LOW | q-note `POST /api/sessions/internal/create-memo`(내부 키, `qnoteContext.createMemo`) | L1(본인만) 고정 · 프로젝트/고객 소속은 q-note `_belongs_to_business` |
| Q info 항목 (2026-10-07) | `create_knowledge_item` | LOW | **신설 `kb_actions.createDocument`**(kb 생성 라우트 본문 이전 — 화면도 같은 함수) | scope `docs:write` · 메뉴 qinfo 쓰기 · 비밀 칸 거절 · 기본 private(L1) |
| 다건 생성 | (없음) | MEDIUM | — | 모델이 `create_task` 를 N번 부른다. **한 대화에서 10분 내 5건 초과**면 6번째부터 CONFIRMATION_REQUIRED(정책 §7) — ★ 2026-10-07 확인: **아직 구현되지 않았다**(execute.js 에 창 없음) |

제외(HIGH 또는 범위 밖): 삭제 전부 · 상태 임의 변경(`status` 직접) · 청구/계약/금액 · 메일·채팅 **발송** · 멤버/권한 변경 · 공유 링크 발급 · 파일 업로드.

### 6.4 입력 스키마 예 (zod — 레지스트리 원본)
```js
create_task: z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional(),
  due_date: dateOnly.optional(), start_date: dateOnly.optional(),
  assignee_user_id: z.number().int().positive().optional(),
  project_id: z.number().int().positive().optional(),
  client_id: z.number().int().positive().optional(),
  priority: z.enum(['low','normal','high','urgent']).optional(),
  idempotency_key: z.string().max(64).optional(),
}).strict()
```
MCP `inputSchema` 는 이 zod 에서 생성(SDK 가 한다). Cue 가 같은 레지스트리를 쓰면 OpenAI function schema 도 같은 원천에서 나온다(§8.5).

---

## 7. 위험도 정책 (provider 와 무관 · `services/agent/policy.js`)

| 등급 | 툴 | 서버 동작 | 클라이언트 쪽 |
|---|---|---|---|
| **LOW** | 검색·조회·메모 추가·단건 업무/일정 생성 | 즉시 실행 | ChatGPT 가 자체적으로 쓰기 확인을 띄울 수 있다(우리가 의존하지 않는다). `readOnlyHint:true` 는 읽기에만 |
| **MEDIUM** | 담당자 변경·마감 변경·완료·(참석자 있는 일정)·10분 내 6건째 생성 | **2단계**: 1차 호출 → 실행하지 않고 `CONFIRMATION_REQUIRED{ preview:{before,after}, confirmation_token }`(EphemeralToken `agent_confirm`, 5분, 1회) → 모델이 사용자에게 보여주고 동의를 받으면 **같은 파라미터 + `confirmation_token`** 으로 재호출 → 실행. 토큰은 (grant, tool, 파라미터 지문)에 묶여 다른 대상에 못 쓴다 | `destructiveHint:false`(되돌릴 수 있다) · 설명에 «확인 후 실행» |
| **HIGH** | 삭제·금액·계약·외부 발송·대량·권한 | **툴이 존재하지 않는다.** 정책 표에 적어 두고 레지스트리가 그 이름을 등록하지 못하게 한다 | — |

- 정책 표는 코드 상수로 시작한다(과설계 금지). 워크스페이스별 조정(예: owner 가 «MEDIUM 도 즉시»)이 필요해지면 `businesses.permissions.agent` JSON 으로 올린다 — 읽는 곳이 `policy.js` 한 곳이라 그때 바꿔도 다른 파일이 안 바뀐다.
- 킬스위치: `AGENT_ENABLED=0`(표면 전체 401) · `AGENT_WRITE_ENABLED=0`(쓰기 툴 목록에서 제거 + 호출 시 PERMISSION_DENIED) — Cue 의 `CUE_TOOLS_ENABLED` 와 같은 모양, 무재배포 롤백.

---

## 8. 멱등성 · 재시도

- **쓰기 툴 공통**: `key = idempotency_key ?? sha256(grant_id + tool + 정규화 파라미터)`. 실행 전 `EphemeralToken.setIfAbsent('agent_idem', key, {status:'pending'}, 10분)` — 이미 있으면 ①`done` 이면 저장된 결과를 `replayed:true` 로 반환 ②`pending` 이면 `CONFLICT{code:'IN_PROGRESS', retry_after_sec:2}`. 실행 후 결과 스냅샷(id·제목 등 작은 것)을 `update`.
- 왜 지문도 받나: 호스트가 같은 인자로 재시도하면 키가 같고, 모델이 다시 부르면 키를 새로 만들 수 있다. 지문은 모델의 협조 없이 «같은 요청» 을 잡는다. 10분 뒤 같은 제목 업무를 **일부러** 두 개 만드는 것은 허용(`title` 외에 설명·마감이 같아야 지문이 같다).
- 확인 토큰(MEDIUM)은 그 자체가 1회용이라 2차 호출의 멱등을 겸한다.
- 트랜잭션 경계는 행동 계층 것을 그대로 쓴다. 멱등 행 쓰기는 **행동 계층 밖**(실패해도 본 작업과 무관, 가드 `auditentry` 와 같은 원칙).

### 8.5 Cue 와의 관계 — 카탈로그는 한 벌
`cue_tools.js` 의 `TOOL_SCHEMAS`·`validateNormalize`·`executeTool` 은 레지스트리와 **같은 일**이다(검증→행동 계층 dispatch). milestone 1 은 cue_tools 를 건드리지 않고(범위·회귀) 레지스트리를 **별도 신설**하되, **milestone 2 에서 cue_tools 가 레지스트리를 require 하도록 접는다**(OpenAI function schema = zod→JSON Schema 변환, 확인 카드 = `CONFIRMATION_REQUIRED` preview). 두 벌이 남는 기간을 한 사이클로 제한한다 — Irene 결정 ⑥.

---

## 9. 감사 · 보안

### 9.1 감사 (기존 구조에 맞춤)
| 어디 | 무엇 |
|---|---|
| 툴 호출 1건 = `audit_logs` 1행 | `action:'agent.<tool>'`, `target_type/target_id`(결과 엔티티), `user_id`=사람, `acting_for_user_id`=NULL(본인 권한), `new_value:{ acting_for:{ instructed_by:userId, permission_basis:'oauth_grant', provider:'openai', client_id, grant_id }, args:<마스킹된 입력>, result:{ok, code} }`, `ip_address`=클라이언트 발신 IP(OpenAI/Anthropic 대역) |
| 도메인 변경 행 | 행동 계층이 이미 쓰는 `task.create`·`task_comment.create`… 에 `channel` 을 보태 **같은 사건이 두 행이 되지 않게** 한다(§11.1 — `task_actions.audit()` 가 `actor.channel` 을 `new_value.via` 로 실음) |
| 표시 | `tasks.created_via='agent'`(STRING(20), ALTER 없음) · 댓글은 `task_comments.kind` 또는 감사로 식별 |
| 인증 사건 | `agent_grant.create/revoke`, `agent_client.register`, `agent_token.refresh_reuse_detected` |
| 화면(m2) | 감사 로그 화면에 «경유: AI(ChatGPT/Claude/Cue)» 필터 1개 + 업무 상세에 «ChatGPT 로 추가됨» 배지(Cue 배지와 같은 자리) |

### 9.2 보안 체크
- 공개 표면은 `/agent/*` 와 `/.well-known/oauth-*` 뿐. MCP 프로세스는 계속 127.0.0.1 바인드, nginx 만 연다. 운영 `location /agent/` 는 **배포 스크립트의 nginx 단계**에 넣는다(루트 `scripts/` 는 운영에 없다 — 배포가 전달한다).
- DCR 남용: 분당 IP 5회·일 50회, `redirect_uris` 호스트 허용목록 밖이면 400 `invalid_redirect_uri`, 미사용 클라이언트 90일 정리.
- `/agent/token`: IP 분당 30, 코드 attempts 5회 상한(EphemeralToken `attempts` 원자 증가 — 2026-09-10 교훈).
- MCP 호출: grant 당 분당 60·일 2,000(`costGuard.perUserLimiter` 키를 grant_id 로), 입력 JSON 64KB, 출력 목록 50건.
- 쓰기 계량: `plan.can('use_cue', {actions:1})` + `recordUsage('agent_tool')` — 플랜 한도 안에서만(Irene 결정 ④).
- 응답 비밀 금지(§5.8), 로그에 토큰 평문 금지(`maskSensitive` 키워드에 `grant`·`code_verifier` 추가).
- CORS: `/agent/*` 는 브라우저 호출이 없다(동의는 `/api/agent/oauth/consent` 로 :3003 에 간다) → 기존 allowlist 유지.
- AS 발신 검증: `resource` 가 우리 MCP URL 과 정확히 같을 때만(ChatGPT 가 붙이고 Claude 도 보낸다), `aud` 불일치 토큰 401.

---

## 10. 재사용 vs 신설

### 10.1 그대로 재사용
`mcp/server.js`(transport·stateless·감사 패턴) · `services/actions/task_actions.{createTask,createComment,updateSchedule,complete}` · `event_actions.createEvent` · `_subject` · `access_scope.{getUserScope,taskListWhere,canAccessTask,calendarListWhere,assertAssignable}` · `menu_permission.getMemberMenuLevels` · `cue_context.{getClientSnapshot,getProjectSnapshot,getWorkspaceOverview,getWorkspaceMatches}` · `auditService` · `costGuard` · `plan.can`·`cue_orchestrator.recordUsage` · `EphemeralToken`/`ephemeralStore` · `utils/searchMatch`·`rowTimestamps.serializeTaskComment`·`displayName` · `routes/tasks.js normDateInput`(함수로 추출) · 프론트 `ApiTokenSection` 패턴(연결 목록·해제 UI) · `@modelcontextprotocol/sdk` 1.29 `server/auth`.

### 10.2 새로 필요한 것

| 구분 | 항목 | 크기 |
|---|---|---|
| 테이블 | `agent_clients`(id, client_id UNIQUE, client_name, redirect_uris JSON, provider_hint, token_endpoint_auth_method 'none', created_at, last_used_at) · `agent_grants`(id, user_id, business_id, client_id FK, scopes JSON, refresh_token_hash, refresh_expires_at, last_used_at, revoked_at, revoked_reason ENUM('user','client','reuse_detected','membership_lost','admin'), created_at) | 2 |
| ENUM append | `ephemeral_tokens.kind` += `agent_authreq`,`agent_code`,`agent_idem`,`agent_confirm` — 멱등 마이그레이션 `scripts/migrate-agent-ephemeral-kinds.js`, **코드 배포 전** 실행(deploy 슬롯) | 1 |
| 서비스 | `services/agent_oauth/{provider.js(OAuthServerProvider 구현), clients_store.js, tokens.js}` · `services/agent/{registry.js, execute.js, policy.js, idempotency.js, errors.js, serialize.js, tools/tasks.js, tools/notes.js, tools/context.js}` | ~900줄 |
| MCP | `mcp/server.js` 확장(bearer → agent_oauth 검증, 401 챌린지, 레지스트리에서 툴 등록, `mcpAuthRouter` 마운트) · `mcp/providers/{openai,anthropic}.js` | ~150줄 |
| 라우트(:3003) | `routes/agent_oauth.js`: `GET /api/agent/oauth/request/:id`(동의 화면 데이터) · `POST /api/agent/oauth/consent` · `GET /api/agent/grants?business_id=` · `DELETE /api/agent/grants/:id` | ~150줄 |
| 프론트 | `/connect/agent` 동의 페이지(App.tsx + appRoutes + PREFIX_KIND 등록, 미로그인 → 로그인 후 복귀) · 설정 «연결된 AI 앱» 섹션(`ApiTokenSection` 복제가 아니라 **공용으로 빼서** 둘이 쓴다) · i18n ko/en | ~400줄 |
| 인프라 | nginx `location /agent/`·`/.well-known/oauth-`(dev + 운영 배포 스크립트) · `.env` `AGENT_TOKEN_SECRET`·`AGENT_ISSUER`·`AGENT_ENABLED`·`AGENT_WRITE_ENABLED` · PM2 `planq-prod-mcp` 그대로 | |
| 가드 | `mcpreadonly` → `agentsurface` 로 재정의(§11.3) · `auditentry`·`createlayer` 통과 | |
| 행동 계층 | `task_actions.audit()` 에 `actor.channel` 반영(3파일 같은 한 줄) · milestone 2: `reassign`·`updateFields` 추출 | |

### 10.3 예상 변경 파일 (milestone 1)
```
dev-backend/mcp/server.js                         (확장)
dev-backend/mcp/providers/openai.js, anthropic.js  (신규)
dev-backend/services/agent_oauth/*.js              (신규 3)
dev-backend/services/agent/*.js, tools/*.js        (신규 ~9)
dev-backend/services/actions/{task,event,document}_actions.js   (audit() 한 줄 — channel)
dev-backend/models/AgentClient.js, AgentGrant.js, EphemeralToken.js(kind), index.js
dev-backend/routes/agent_oauth.js · server.js(mount) · scripts/migrate-agent-ephemeral-kinds.js
dev-backend/utils/dateInput.js                     (normDateInput 추출 — routes/tasks.js 가 같이 쓴다)
dev-frontend/src/pages/Connect/AgentConsentPage.tsx · pages/Settings/ConnectedAppsSection.tsx
dev-frontend/src/App.tsx · appRoutes.tsx · tabStore PREFIX_KIND · locales/{ko,en}/settings.json(+agent)
scripts/guard-invariants.js(agentsurface) · scripts/deploy-planq.sh(nginx 슬롯·마이그레이션 슬롯)
/etc/nginx dev.planq.kr(location 2개)
docs/AI_AGENT_INTEGRATION_DESIGN.md(본 문서) · CLAUDE.md 박제 1절
```

---

## 11. 구현 순서

| 단계 | 내용 | 산출·검증 | 예상 |
|---|---|---|---|
| **M1-a 인증** | 테이블 2 + ENUM 마이그레이션 · `agent_oauth` provider · SDK 라우터 마운트 · 401 챌린지 · nginx dev · 동의 페이지 · 연결 목록/해제 UI | `curl` 디스커버리 2종 · DCR → authorize → 동의 → code → token → refresh 회전 → revoke 를 **스크립트로 왕복**(`test-agent-oauth.js`) | 2.5일 |
| **M1-b 레지스트리** | `services/agent/*` + 툴 5개(`get_context`·`search_tasks`·`get_task`·`create_task`·`get_task_notes`·`add_task_note`) · 정책(LOW 만) · 멱등 · 오류 봉투 · 감사 channel | MCP SDK 클라이언트로 실호출: 생성→조회 일치 · 비멤버 토큰 403 · 다른 워크스페이스 task_id NOT_FOUND · 메뉴 none 403 · 같은 지문 2회 → 1건 · 잘못된 날짜 VALIDATION_ERROR · 감사 행 모양 | 2일 |
| **M1-c 가드·배포** | `agentsurface` 가드(양성 대조군 포함) · 배포 스크립트 nginx/마이그레이션 슬롯 · 킬스위치 · `.env` | `guard-invariants` 전체 EXIT 0 · health-check | 0.5일 |
| **M1-d 실 ChatGPT E2E** | Irene 계정 Developer mode 커스텀 커넥터 연결 → 4 시나리오(«K-DINE 업무 찾아줘» → «두 번째에 메모») → PlanQ 화면 확인 → 연결 해제 | 체크리스트 §12.4 · Fable 게이트 | 1일 |
| **M2** | `reassign`·`updateFields` 행동 계층 추출 · MEDIUM 2단계 확인 · 나머지 v1 툴 12개 · cue_tools 를 레지스트리 위로 · 감사 화면 필터·배지 · 지표 쿼리 | 전수 시나리오 + Fable 게이트(행동 계층 변경 = 생명선) | 5일 |
| **M3** | Claude 커넥터 실연결(adapter 검증) · CIMD(SDK 업그레이드) · ChatGPT 디렉터리 제출 자료(약관·개인정보·테스트 케이스·영상) · 워크스페이스별 정책 설정 | | 별도 |

---

## 12. 테스트 전략

### 12.1 자동 (dev, 실HTTP)
- `dev-backend/test-agent-oauth.js`(검증 후 삭제 규칙) — DCR/PKCE/코드 1회성/refresh 회전/reuse 감지/revoke/멤버십 해제 후 401. **음성 대조군**: 잘못된 `code_verifier`·다른 `resource`·만료 코드 → 전부 400/401.
- `dev-backend/test-agent-tools.js` — MCP SDK `Client` + `StreamableHTTPClientTransport` 로 툴 5개. PHASE 4 항목 매핑:
  정상 연결 · 토큰 만료/갱신(exp 를 10초로 발급해 실제 401→refresh) · 다른 테넌트 차단(B 워크스페이스 task_id → NOT_FOUND, 응답 본문에 제목 0건) · 권한 없는 업무(고객 전용/메뉴 none → PERMISSION_DENIED) · 검색·생성·메모 · 동명 고객/프로젝트(`search_clients` 2건 → 모델 몫, 서버는 후보 반환) · 없는 id · 잘못된 날짜 · timeout(핸들러에 8초 상한, 초과 시 INTERNAL+request_id) · **duplicate request**(같은 인자 2회 → 1행, `replayed:true`) · 감사 행(`agent.create_task` 1 + `task.create` 1, `via` 동일 grant_id) · revoke 후 AUTH_REQUIRED.
- 카나리 확장: `--suite tenant` 에 `/agent/mcp` 표면 추가(비멤버 grant 로 전 툴 403/NOT_FOUND) · `--suite tenantwrite` 에 `add_task_note` 를 남의 task_id 로(판정은 DB).
- 가드 `agentsurface`: `mcp/` 와 `services/agent/` 에서 모델 `create/update/destroy` 0건 · 행동 계층 외 쓰기 0건 · 재무 모델 참조 0건 · 레지스트리의 모든 쓰기 툴에 `risk`·`scopes`·멱등 선언 · HIGH 이름(`delete_*`·`send_*`·`invoice`) 등록 시 실패. **깨뜨려 확인**: `tools/tasks.js` 에 `Task.destroy` 한 줄 심으면 빨간불.

### 12.2 수동 (실 ChatGPT · Claude)
Developer mode 커넥터로 §6.2 시나리오 + «해제 후 재연결» + «워크스페이스 두 개 계정». ChatGPT 가 쓰기 툴을 안전 검사로 막으면 설명 문구를 손본다(커뮤니티 사례 — 비파괴 명시).

### 12.3 측정으로 믿는 것
«연결됨» 표시가 아니라 **DB 행**(agent_grants·audit_logs·tasks)로 판정. 양성 대조군(격리 한 줄 제거 → tenant 카나리가 뒤집히는가) 없이는 초록을 믿지 않는다.

---

## 13. 성공 지표 (#440) — 전부 기존 원장에서 센다

| 지표 | 원천 |
|---|---|
| AI 경유 생성·수정·완료 업무 수 / 전체 대비 비율 (주간) | `audit_logs.action LIKE 'agent.%'`·`tasks.created_via IN ('agent','cue')` |
| 사람 개입 없이 처리된 액션 수 vs 확인(CONFIRMATION_REQUIRED) 건수·동의율 | `agent.*` 결과 `result.code` |
| 거부율(PERMISSION_DENIED·VALIDATION_ERROR·MULTIPLE_MATCHES) — 툴 설계 품질 | 〃 |
| 멱등 replay 수(재시도 흡수) · INTERNAL 수 · p95 응답시간 | 〃 + MCP 프로세스 로그 |
| 활성 연결 수·해제 수·provider 별 | `agent_grants` |
| 지연·누락 업무 감소(장기) | 기존 `task_daily_progress`·주간보고 KPI 와 대조 |
첫 화면은 플랫폼 관리자 «AI 연동» 카드 1장(m2). 쿼리 6개면 된다 — 대시보드를 새로 짓지 않는다.

---

## 14. #412 — 고객의 ChatGPT 히스토리 · 학습형 AI (장기 검토, 짧게)

1. **ChatGPT 대화 히스토리를 PlanQ 가 읽어오는 공식 API 는 확인되지 않았다(미확인·현 시점 없음으로 판단).** ChatGPT 의 내보내기는 사용자가 수동으로 받는 압축 파일이고, 이번 조사한 Plugins/MCP 문서는 전부 «ChatGPT → 서버» 방향이다. 따라서 «고객이 ChatGPT 에서 한 대화를 PlanQ 가 가져온다» 는 길은 지금 없다.
2. **대신 방향을 뒤집으면 요구가 충족된다.** 이번 연동으로 ChatGPT 가 업무와 관련된 대화의 **결과**를 PlanQ 에 쓴다(«방금 이야기한 내용 메모해줘»). PlanQ 가 System of Record 이므로 «AI 가 쪼개져 있다» 는 문제는 **기록이 PlanQ 로 모이면** 사라진다 — ChatGPT 든 Claude 든 Cue 든 같은 원장에 쓴다.
3. **학습형(파인튜닝) AI 는 권하지 않는다(지금 규모·방향에서).** 모델을 학습시키면 provider 에 묶이고(#440 §7 와 충돌), 데이터가 바뀔 때마다 재학습이 필요하며, 테넌트별로 학습하면 격리·비용이 폭증한다. PlanQ 가 «우리 업무 체계에 맞게» 대응하게 하는 것은 **문맥 주입**으로 이미 하고 있고(cue_context·멤버 프로필 `answer_style_default` 등·`cue_knowledge`), 이번 레지스트리의 툴 설명·`get_context` 가 그 연장이다. 운영 데이터가 수만 건 규모가 되고 «같은 질문에 같은 실수» 패턴이 측정되면 그때 **프롬프트/검색 품질 → 소형 적응**(few-shot·선호 메모리) 순으로 올린다. 파인튜닝은 마지막이다.

---

## 15. Irene 이 결정할 것

1. **방식** — MCP + 자체 OAuth 2.1 AS 로 간다 (**추천: 예**. 대안 Auth0 외주·GPT Actions 는 §3.1 사유로 비추천)
2. **첫 배포 경로** — Developer mode 커스텀 커넥터(내부·초기 고객 안내용)로 시작하고 디렉터리 제출은 M3 (**추천: 예**)
3. **grant = 워크스페이스 하나** (다른 워크스페이스는 연결을 하나 더) (**추천: 예** — 범위 전환 문을 두지 않는다)
4. **쓰기 계량** — 에이전트 쓰기 1회 = `cue_actions_monthly` 1회로 센다(읽기 무과금·속도 제한만) (**추천: 예**)
5. **고객(Client) 계정 연결** — v1 불허, 멤버 이상만 (**추천: 불허**)
6. **cue_tools 통합 시점** — M2 에서 레지스트리 위로 접는다(한 사이클만 두 벌 허용) (**추천: M2**)
7. **MEDIUM 확인 방식** — 서버 2단계(`confirmation_token`)로 provider 와 무관하게 강제 (**추천: 예**; «ChatGPT 자체 확인에 맡김» 은 비추천)
8. **scope 동의 UI** — 8개 scope 를 «읽기만 / 읽기+쓰기» 두 묶음으로 보여줌 (**추천: 예**)
9. **`mcpreadonly` 가드 해제** — 2026-07-11 «MCP 외부 개방 보류» 결정을 이 설계로 푼다(쓰기는 행동 계층 경유 + `agentsurface` 가드로 대체) (**추천: 예**)
10. **M1 착수 승인 및 Fable 게이트** — R=1 이므로 M1-d 전 Fable 게이트 1회(묶어서) (**추천: 승인**)
