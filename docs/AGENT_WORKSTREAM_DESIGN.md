# AI 앱(ChatGPT·Claude) — 추진과제(그룹) 만들기·업무 배정 (2026-10-27 · Fable 설계 PASS · 구현됨)

## 요청
Irene 이 ChatGPT 답변을 붙임: «업무 등록은 가능한데, 현재 PlanQ 연결에는 추진과제 생성·그룹 배정 기능이 없어. 우선 49개 업무에 … 소속 그룹명을 넣어 등록할게. 실제 추진과제 구성은 브라우저 작업이 필요해.» → «이거 되어야 해».

## 지금 (사실)
- 추진과제 = `project_workstreams`(프로젝트 안 그룹). 화면 문 `routes/projects.js` POST/PATCH/DELETE `/:id/workstreams` — 게이트 `loadProjectOrForbidden` + 고객 403, 감사 `project.workstream_create`, 실시간 `broadcastCanvas`.
- 업무 소속 = `tasks.workstream_id`. 행동 계층 `task_actions.createTask` 는 이미 `params.workstreamId` 를 받는다(그 프로젝트 것만). `updateFields` 는 이 칸을 안 받는다 — 화면 PUT `/tasks/:id` 인라인(1219~1228)만 바꾼다. FIELD_RULES `workstream_id` = 담당·작성·owner/admin 이미 있음.
- AI 도구(`services/agent/registry.js`): `create_task`·`update_task` 에 그룹 칸 없음, `get_project` 응답에 그룹 목록 없음, 그룹 만들기 도구 없음.

## 안
1. **행동 계층 한 곳** `services/actions/workstream_actions.js` `createWorkstream(actor, {projectId, title, description})`
   — 게이트 = 화면과 같은 `loadProjectOrForbidden` + 고객 거절 · 같은 프로젝트에 **같은 이름(공백·대소문자 무시, AI 루틴 확정과 같은 정규화)** 이 있으면 새로 만들지 않고 그것을 돌려준다(`matched:true`) · 감사 `project.workstream_create`(via) · 실시간 `project:updated`+`inbox:refresh`(broadcastCanvas 와 같은 사건 — 함수를 서비스로 옮겨 라우트도 같이 쓴다). 화면 POST 라우트도 이 함수를 부른다(이름 중복 재사용은 AI 경로에만 — 화면은 종전처럼 항상 새로).
2. **`task_actions.updateFields` 에 `workstream_id`** — 숫자면 이 업무 프로젝트의 그룹이어야 함(아니면 `invalid_workstream`), null 이면 빼기. FIELD_RULES 그대로. 화면 PUT 인라인은 손대지 않음(범위 밖).
3. **도구**
   - 새 `create_workstream` — risk LOW(추가만·알림 없음·보는 사람 안 바뀜) · scope `projects:write`(이미 있음. 10-07 이전 연결은 재연결 안내가 이미 돈다) · 입력 `project_id, title(≤200), description?` · 멱등 키. 출력 `{workstream:{id,title}, created|matched}`.
   - `create_task` 에 `workstream_id?`(project_id 필요) · `update_task` 에 `workstream_id?`(number|null). 둘 다 LOW 유지(그룹은 같은 프로젝트 안 정리 — 공개 범위 불변).
   - `get_project` 응답에 `workstreams:[{id,title,status,task_count}]`(task_count 는 볼 수 있는 업무만 셈 — `taskListWhere`).
4. 삭제·이름 바꾸기·순서는 도구로 두지 않음(삭제 HIGH, 나머지는 요청 밖).
5. 문서: `docs/AI_AGENT_INTEGRATION_DESIGN.md` §6.3 표 · `.claude/rules/ai-agent.md` 한 줄.

## 검증 계획
dev MCP 실호출(OAuth 토큰) — 그룹 만들기 → 같은 이름 재호출 matched → create_task 그룹 지정 → update_task 그룹 옮김/null → get_project 목록·수 → 남의 프로젝트 그룹 id 거절 · 다른 워크스페이스 project_id 거절 · 고객/안 보이는 프로젝트 멤버 거절 · 화면 POST 라우트 회귀 · 가드 agentsurface · health · build.

## Fable 판정 (2026-10-27) — PASS, 필수 수정 반영
1. 위험도 LOW 전부 · 2. scope `projects:write`(그룹) / `tasks:write`(배정) · 3. 이름 재사용 AI 경로만 + 정규화 한 함수(`routes/tasks.js`·`aiTaskPlanner` 도) · done/dropped 그룹과 같으면 그 그룹 + `status`
4. broadcastCanvas → `workstream_actions.signalCanvas`(io·actorUserId), 화면 POST 응답·color 그대로
5. 필수: 토큰 워크스페이스 묶음 · `assertMenu(qtask, write)` · updateFields 감사 before 에 workstream_id · task:updated 에 workstream_id(serializeTaskForBroadcast 는 행 전체)
- 비차단(범위 밖, 기록만): 화면 GET `/workstreams` rollup 은 권한 조건 없이 센다.

## 자체 검증 (2026-10-27)
도구 실호출 19/19(만들기·같은 이름 재사용·DB 1개·create_task/update_task 배정·빼기·감사·남의 프로젝트 그룹 거절 2·get_project 수·**대조군: 묶음 없으면 ws3 통과 / 토큰 ws6 → ws3 거절**·안 보이는 프로젝트 거절·scope 없음 거절·참여 멤버 가능) · 화면 POST HTTP 7/7(모양·color·같은 이름 새로·빈 이름 400·안 보이는 멤버 403·고객 403).
