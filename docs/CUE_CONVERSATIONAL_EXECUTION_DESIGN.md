# Cue 대화형 실행 (Conversational Execution) — #81 설계서

> 작성: 2026-07-15 (Opus). 아키텍처 방향은 `docs/AI_NATIVE_IMPLEMENTATION_PLAN.md` §D-2.5 (Fable 설계 게이트 2026-07-11, Irene 확정) 그대로. 이 문서는 그 위의 구현 상세 + 시니어 설계 검증.
>
> 선행 조건(전부 완료): D-1 LLM 게이트웨이(`services/llm.js` `tools`→`tool_calls` 지원) · D-2 에이전트 권한 모델(위임·감사·재무봉쇄, 2026-07-12 배포) · D-3 행동 계층 생성 카탈로그(task·comment·event·document, 2026-07-15).

---

## 1. 기능 정의

| 항목 | 내용 |
|------|------|
| 기능명 | Cue 대화형 실행 — GitHub #81 |
| 목적 | Q helper **워크스페이스 채팅**에서 자연어로 실행 지시 → Cue가 행동을 **제안(tool call)** → 사용자가 파라미터 표시된 **확인 카드**를 클릭해야 실행. "데이터가 바뀌는 건 사람이 누른 뒤에만." |
| 핵심 사용자 | Business Owner / Member. **고객(Client) 비대상** — 고객 자동응답엔 실행 툴 미부여. |
| 핵심 유스케이스 | "다음주 화요일까지 제안서 초안 업무 만들어줘"(create_task) · "내일 3시 킥오프 일정 넣어줘"(create_event) · "이 회의 회의록 초안 만들어줘"(create_document_draft) · "이번 주 미수금?"(읽기 = 기존 컨텍스트 주입) |
| 성공 기준 | 실 HTTP: 툴 제안→confirm→엔티티 생성→재조회 값 일치. 권한 없는 메뉴(none) 사용자 제안이 실행 단계 403. 2브라우저 broadcast. 되돌리기 = tools 미전달 시 옛 동작. |
| 비범위 | ①재무(invoice/payment) 툴 영구 제외 ②멀티스텝 자율 루프 금지(1턴 제안→confirm) ③쓰기 툴 = 생성 3종(submit_review 등 전이 툴은 후속) ④고객 자동응답 실행 툴 금지 ⑤MCP 외부 표면(D-4) 별도 |
| 규모/게이트 | 대규모 · **Fable 게이트 필요**(보안 경계) |

### 핵심 멘탈 모델 (보안)
`execute-action`은 사용자가 이미 `POST /tasks` 등으로 할 수 있는 **동일한 게이트된 행동 계층**을 부르는 대체 입구다. LLM은 자연어 프런트엔드일 뿐, 권한은 사람 본인의 것. **새 권한 상승 경로 0** → confirm을 서버에 저장할 필요 없음(stateless).

---

## 2. API 구조

코드 위치: 전부 `routes/cue.js` + 신규 `services/cue_tools.js`.

### ① `POST /api/cue/help` — 확장 (workspace 모드만)
- 인증: `authenticateToken` + `helpLimiter` + `plan.can('use_cue')` (기존 그대로, **검사만 — 과금 없음**)
- 변경: workspace 모드 + `CUE_TOOLS_ENABLED` 시 `callLLM`에 `tools`(쓰기 카탈로그) 전달 + 시스템 프롬프트에 **오늘 날짜·요일·워크스페이스 tz·멤버 로스터(비-AI 표시명)** 주입
- 응답(툴 제안 시): `{ success, data: { answer?, mode, proposed_action: { tool, params } } }` — **실행 안 함**. 첫 유효 쓰기 tool_call 1건만.
- 응답(일반): 기존 `{ answer, mode, sources, log_id }` (proposed_action 없음)
- 되돌리기: tools 미전달 = 옛 동작

### ② `POST /api/cue/execute-action` — 신규 (confirm→실행)
- 인증: `authenticateToken` + per-user costGuard + `plan.can('use_cue',{actions:1})`
- Request: `{ tool, params }` (businessId는 **인증 컨텍스트에서 서버가 도출** — 클라 business_id 불신)
- 처리: 1) `tool` ∈ 화이트리스트 2) `params` 스키마 재검증/정규화 3) 담당자 해석(`resolveAssignees` 재사용) 4) **actor = 사용자 본인** `{kind:'user', userId, platformRole, req}` 5) 행동 계층 dispatch 6) `recordUsage('tool_call')` + `cue.tool_execute` 감사
- dispatch: create_task→`task_actions.createTask` · create_event→`event_actions.createEvent` · create_document_draft→`document_actions.createDocument`
- 응답: `{ success:true, data:<엔티티>, tool }` — 행동 계층이 broadcast/알림/감사 자동
- 에러(행동 계층 계약 그대로): `menu_forbidden:*` 403 · `cannot_assign:*` 403 · `invalid_kind`/`title required` 400 · 쿼터 422 · `unknown_tool` 400

### 쓰기 툴 카탈로그 (LLM function schema — snake_case)
```
create_task            { title*, assignee_name?, description?, due_date?(YYYY-MM-DD), project_id?, priority? }
create_event           { title*, start_at*(ISO,workspace tz), end_at*, description?, location? }
create_document_draft  { kind*(enum), title*, client_id?, project_id? }
```
담당자: `assignee_name` → `resolveAssignees`(표시명→계정명→role, **외부 고객·AI 코드 배제**, 미매칭=본인). 로스터 주입으로 LLM이 실제 멤버명 출력 → 정확 일치.

---

## 3. DB 구조 — 신규 0

| 관심사 | 결정 |
|------|------|
| 제안 상태 | 저장 안 함(stateless). 좀비·TTL·크론 불필요 |
| 계량 | `cue_usage` 재사용, `action_type='tool_call'` (varchar(50), ENUM 아님 → 스키마 무변경) |
| 생성물 | 기존 tasks·calendar_events·documents (행동 계층이 씀) |
| 감사 | `audit_logs` 재사용 (create 감사 + `cue.tool_execute` 프로비넌스 1행) |

**마이그레이션 0 · 백필 0.** 배포 리스크가 코드로만 한정.

---

## 4. UI 흐름

신규 페이지 없음. `CueHelpDrawer.tsx`(workspace) 확장 + 신규 `CueActionCard.tsx`(인라인 확인 카드).

- `Turn` 인터페이스에 `proposedAction?`, `actionStatus?('pending'|'executing'|'done'|'error')`, `actionResult?` 추가
- `/help` 응답에 `proposed_action` 있으면 해당 Turn에 저장 → 답변 아래 **인라인 카드** 렌더(팝업 안 팝업 금지)
- 카드: 파라미터 편집(제목·담당자 피커·마감 SingleDateField·설명) + [취소]/[＋추가] (ActionButton 3톤, submitting 중복가드)
- [추가] → `/execute-action` → 성공 시 카드 접힘 + "✓ 추가됨 · 열기↗"(딥링크 `/tasks?task=` 등). 실패 시 인라인 `!`
- 담당자 `⚠ 못 찾음→본인` 명시. done 후 재실행 불가
- i18n: `common`(qhelper) + `errors` ko/en. 반응형 카드 max-width:100%

---

## 5. 시니어 설계 검증 — 발견/해소 + 트레이드오프

| 구멍 | 해소 |
|------|------|
| `/help` 실수 쓰기 → 게이트 무력화 | `services/cue_tools.js` 분리(/help는 스키마만, dispatch는 execute만). guard `cuetools` |
| 담당자 정확 일치 실패("김대리"≠"김수진") | 프롬프트에 멤버 로스터 주입 → LLM이 실제 멤버명 출력 |
| 한 턴 다중 tool_call = 자율 연쇄 | 첫 유효 쓰기 1건만 |
| create_event 시간대 시프트 | 프롬프트 tz/오늘/요일 주입 + 카드 워크스페이스 tz 편집 |
| cross-tenant business_id | 서버가 인증 컨텍스트에서 도출, 행동 계층 재검증 |
| 프로비넌스 소실(actor=user) | `cue.tool_execute` 감사 추가 |
| 운영 오작동 차단 | `CUE_TOOLS_ENABLED` 킬스위치 |

**받아들이는 트레이드오프:** ①서버 멱등 nonce 없음 — UI submitting 가드로 충분(비파괴 생성, nonce는 과잉) ②제안 무과금·실행 1회 과금(이중과금 없음) ③읽기 툴 미구현(기존 컨텍스트 주입이 처리).

---

## 6. 테스트 시나리오 (→ 6단계, `docs/CUE_CONVERSATIONAL_EXECUTION_TESTS.md`)
- 정상: "…업무 만들어줘"→proposed_action→execute→task 재조회 일치 (event·document 각각)
- 담당자: "김수진에게…"→해석 성공 / "없는사람에게…"→본인 fallback
- 권한: qtask/qcalendar/qdocs='none' 멤버 execute → 403
- 경계: 필수 누락·invalid_kind·unknown_tool·다중 tool_call 1건만
- 재무 봉쇄: 카탈로그에 invoice 툴 부재(가드 red)
- 실시간: 2브라우저 broadcast
- 롤백: CUE_TOOLS_ENABLED=0 → 옛 동작
