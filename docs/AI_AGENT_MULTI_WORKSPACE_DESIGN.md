# AI 앱 연결 — 여러 워크스페이스 (2026-10-15 · 초안 [Opus] → Fable 설계 판정 대기)

> 피드백(ChatGPT 연결 사용자, 상황판 경유): 회사 워크스페이스와 아이와 쓰는 워크스페이스를 나눠 쓴다.
> «아이와 쓰는 워크스페이스에서 업무를 확인해줘» 가 되려면 ①허용된 워크스페이스 목록·이름·ID 조회 ②모든 조회·생성 도구에
> workspace_id 지정 ③불명확하면 사용자에게 확인 ④서버가 매 요청 접근권·소속을 검증하고 결과에 실제 워크스페이스 이름·ID 반환.
> 요청마다 지정(계정 공통 설정 변경 아님) · 접근 못 하면 다른 곳으로 자동 대체 금지 · 생략하면 지금처럼 연결된 워크스페이스.

## 0. 지금
- grant = 사람 × **워크스페이스 하나**(`agent_grants.business_id`) × scopes. 토큰 JWT `bid` = grant.business_id.
- 모든 도구는 `p.businessId` 로 묶인다(가드 agentsurface 가 줄 단위로 강제). 도구 입력에 범위 칸은 없다(`.strict()`).
- 다른 워크스페이스를 쓰려면 커넥터를 하나 더 연결해야 한다 — ChatGPT 는 커넥터당 토큰 하나라 대화 중 전환이 불가능.

## 1. 결정 (권고안)
1. **grant 는 «기본 워크스페이스 + 함께 허용한 워크스페이스 목록»** — 새 컬럼 `agent_grants.extra_business_ids JSON NULL`.
   `business_id` 는 기본(생략 시 대상)으로 그대로 — 토큰 `bid` 묶음·형제 연결 정리(supersedeSiblings)·감사 키 불변.
   NULL = 기존 연결 = 기본 하나만. **옛 연결을 조용히 넓히지 않는다** — 더 쓰려면 다시 연결(지금까지의 scope 원칙과 같다).
2. **동의 화면**: 기본 워크스페이스 고르기(지금 그대로) + «다른 워크스페이스도 함께 허용» 체크박스(연결 가능한 나머지 — canConnect 와 같은 목록).
   기본값은 **체크 없음**(넓히는 것은 사람이 고른다). 서버는 고른 것마다 canConnect 를 다시 본다(하나라도 안 되면 403 — 조용히 빼지 않는다).
   읽기만/읽기+쓰기 묶음은 연결 전체에 하나.
3. **메일(opt-in)은 기본 워크스페이스에만** — 동의 화면이 보여 주는 «보이는 계정» 이 기본 워크스페이스 것이다. 다른 워크스페이스로 가면
   `mail:read`·`mail_drafts:write` 는 그 호출의 scopes 에서 빠진다(→ 메일 도구 PERMISSION_DENIED scope + 안내 «메일은 기본 워크스페이스만»).
   search_all 의 메일 그룹도 같은 판정(그룹별 scope 판정이 이미 p.scopes 를 본다).
4. **해석은 한 곳** — `services/agent_oauth/grants.resolveWorkspace(p, workspaceId)` 를 `execute.runTool` 이 scope 판정 **앞에서** 한 번 부른다.
   - 생략·기본과 같음 → 기본 principal 그대로.
   - 허용 목록 밖 → `PERMISSION_DENIED workspace_not_allowed` + `allowed_workspaces[{workspace_id,name}]` + 안내(다시 연결해서 허용). **기본으로 대체하지 않는다.**
   - 목록 안인데 지금 canConnect 실패(내보내짐·정지·워크스페이스 삭제) → `PERMISSION_DENIED workspace_unavailable:<code>`. grant 는 닫지 않는다
     (기본이 끊기면 지금처럼 principalFromAccess 가 grant 를 닫는다).
   - 통과 → `{...p, businessId: ws, role: can.role, scopes: 메일 opt-in 뺀 것, defaultBusinessId}`. 이후 모든 도구·메뉴 Layer·계량(`plan.can(p.businessId,'use_cue')`)·
     감사(businessId = 실제 워크스페이스)가 그 값을 쓴다 — 도구 코드는 안 바뀐다(`p.businessId` 묶음이 그대로 격리를 만든다).
5. **입력 칸** — `workspace_id`(정수, 선택)는 **MCP 표면에서만** 모든 도구 입력에 붙인다(buildAgentServer). runTool 이 떼어 낸 뒤 도구의 `.strict()` 검증을 한다.
   앱 안 Cue(provider 'cue')는 이 칸이 없다 — 보내면 지금처럼 strict 가 거절(Cue 는 로그인 세션의 워크스페이스뿐).
6. **확인 2단계·멱등** — 인자 지문(fp)과 멱등 키에 **해석된 워크스페이스 id** 를 넣는다. A 에서 받은 확인 토큰으로 B 를 실행할 수 없고,
   같은 인자라도 워크스페이스가 다르면 다른 요청이다.
7. **결과에 실제 워크스페이스** — 외부 앱(provider ≠ cue) 응답 봉투에 `workspace: { workspace_id, name }` 를 성공·실패 모두 싣는다.
8. **새 도구 `list_workspaces`**(LOW·읽기·scope 없음·외부 앱 전용 — Cue 허용 목록에 넣지 않는다): 이 연결이 허용한 워크스페이스
   `[{workspace_id, name, role, is_default, mail, available, unavailable_reason}]`. 연결 밖 워크스페이스는 **이름도 안 보인다**(사람이 허용한 것만).
   `get_context` 에 `workspaces: { count, default_workspace_id }` 한 줄 추가.
9. **모델 안내**(서버 instructions + list_workspaces·get_context 설명): «워크스페이스가 여럿이면 list_workspaces 로 보고, 사용자가 말한 곳이
   둘 이상과 맞거나 불분명하면 **먼저 묻는다**. 다른 워크스페이스에서 작업할 때는 그 대화 동안 매 호출에 workspace_id 를 넣는다.
   거절되면 다른 워크스페이스로 바꾸지 말고 이유를 말한다.» — ③은 모델 행동이라 서버가 강제할 수 없다. 서버는 «틀린 곳에 쓰지 않는다»(목록 검증)와
   «어디서 했는지 말한다»(결과의 workspace)로 받친다.
10. **연결 목록(프로필 › AI 앱 연결)** — `GET /api/agent/grants?business_id=` 가 기본이 그 워크스페이스인 것 + 함께 허용된 것(JSON_CONTAINS)을 보여 준다.
    항목에 `workspaces:[{id,name,is_default}]`. 해제는 연결 통째(지금 그대로). 감사 `agent_grant.create` 에 extra 목록.

## 2. 안 하는 것
- 워크스페이스마다 다른 읽기/쓰기 묶음 · 다른 워크스페이스 메일 · 연결 «편집»(허용 목록 수정은 다시 연결로) · 사람 이름으로 워크스페이스 찾기(모델 몫).

## 3. 운영
- `scripts/migrate-agent-multi-ws.js` — 컬럼 1(멱등), 배포 슬롯 PM2 reload 전(모델이 SELECT). 롤백 = 코드만(컬럼은 NULL 이면 무해).

## 4. 검증(자체 — 실HTTP·실MCP)
- 옛 연결(extra NULL): workspace_id 없이 = 지금과 같음 · 다른 ws id → workspace_not_allowed(기본 결과 0건 · 대체 없음).
- 새 연결(기본 A + B): list_workspaces 2 · B 의 search_tasks 가 B 업무만 · B 에 create_task → B 에 생김(A 0) · 결과 workspace=B ·
  A 업무 id 를 workspace_id=B 로 get_task → NOT_FOUND · B 에서 메일 도구 → scope 거절 · B 확인 토큰을 A 로 재사용 → confirmation_invalid ·
  B 에서 내보낸 뒤 → workspace_unavailable(grant 는 살아 A 는 됨) · 비소속 C 를 동의 POST 에 넣기 → 403 · Cue 에 workspace_id → 거절.
- 가드 agentsurface: runTool 이 resolveWorkspace 를 거치는지 · fp 에 businessId · MCP 표면만 칸 추가 — 양성 대조군으로 뒤집기.

## 5. Fable 설계 판정 (2026-10-15) — PASS-WITH-CHANGES, 10개 전부 반영
① 확인 토큰 지문·멱등 키 세 분기에 해석된 워크스페이스 ② resolveWorkspace 는 새 객체(요청당 principal 공유) · Cue 는 workspace_id 를 떼지 않아 strict 거절
③ «메일은 기본만» 별도 사유 `mail_default_workspace_only`(grants.mailDeniedReason 한 술어 — execute·sources·search_all) ④ supersedeSiblings = 워크스페이스 집합 겹침
⑤ 연결 감사(create·revoke)를 닿는 워크스페이스마다 ⑥ grantsTouchingWorkspaceWhere 한 벌(연결 목록·온보딩) ⑦ 동의 POST 검증(정수·중복·기본 제거·하나라도 불가면 403)
⑧ 기본 워크스페이스 상실 = 연결 전체 종료(의도) ⑨ 해석 거절 봉투는 workspace:null + requested + allowed ⑩ 가드 agentsurface 6줄(양성 대조군 6/6 뒤집힘).
비차단: 워크스페이스 단위 «AI 앱 연결 막기» 스위치는 다음 사이클 후보.
