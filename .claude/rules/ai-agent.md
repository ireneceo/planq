---
paths:
  - "dev-backend/mcp/**"
  - "dev-backend/services/agent/**"
  - "dev-backend/services/agent_oauth/**"
  - "dev-backend/routes/agent_oauth.js"
  - "dev-backend/services/actions/**"
  - "dev-frontend/src/pages/Connect/**"
  - "docs/AI_AGENT_INTEGRATION_DESIGN.md"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# AI 에이전트(ChatGPT·Claude) 연동

## AI 에이전트(ChatGPT·Claude) 연동은 **토큰이 범위다** (2026-10-02 박제 — #439 milestone 1)

> Irene #439·#440: *"ChatGPT 가 PlanQ 의 데이터를 조회하거나 실제 데이터를 생성·수정할 수 있도록 … 기존 권한 그대로."*
> 설계 정본: `docs/AI_AGENT_INTEGRATION_DESIGN.md`

- **표면**: MCP 프로세스(`mcp/server.js`, :3005)의 `/agent/*` — `/agent/mcp`(도구) · `/agent/{authorize,token,register,revoke}`(OAuth 2.1, SDK 핸들러를 직접 마운트 — SDK 라우터는 최상위 `/register` 를 쓰는데 그건 회원가입 화면이다) · `/.well-known/oauth-*`(디스커버리). 동의 화면 `/connect/agent`(메인 백엔드 `routes/agent_oauth.js`).
- **신원·범위는 토큰에서만** — grant = 사람 × **워크스페이스 하나** × scopes. 도구 입력에 workspace/user 칸이 없다(`.strict()` 로 거절). 업무는 `business_id: p.businessId` 로 묶어 찾는다 — 이 한 줄을 빼면 `canAccessTask` 가 «내 워크스페이스 scope» 로 남의 업무를 통과시킨다(양성 대조군 실측).
- **누가 연결할 수 있나는 `services/agent_oauth/grants.canConnect` 한 곳** — 동의할 때와 **매 호출** 같은 판정(멤버 이상, 고객·AI·정지 불가). 멤버십이 끊기면 grant 를 지우지 않아도 닫힌다.
- **도구는 `services/agent/registry.js` 한 벌, 실행은 `execute.runTool` 하나** — scope → 계량(`use_cue` 1회) → 멱등(키 또는 파라미터 지문 10분) → 행동 계층 → 감사(`agent.<tool>` + 행동 계층 행에 `via: agent:<provider>`).
- **MEDIUM(마감 변경·완료 — 2026-10-02 M2-a)은 확인 2단계** — 첫 호출은 실행하지 않고 `CONFIRMATION_REQUIRED{preview, confirmation_token}`
  (5분·1회·연결×도구×인자 지문에 묶임), 사용자가 동의하면 같은 인자+토큰으로 다시 부른다. 같은 토큰 재시도는 `replayed`.
  도구 45개(2026-10-08 기준 — 정본은 `services/agent/registry.js`, 설계서 §6.3 표). 업무 프로젝트 옮기기(`move_task_to_project`, #463)는
  화면 PUT 과 **같은 행동 계층 함수**(`task_actions.prepareMove`·`afterMove`)를 쓴다 — 옮기면 그 프로젝트 고객이 업무를 보게 되므로 미리보기가 명단을 말한다. 업무 «삭제» 요청은 **`cancel_task`(MEDIUM, 2026-10-29 #463 Fable 설계)** 로 «취소» 상태만 — 권한은 화면 상태 변경과 같은 `canChangeStatus`, 실행 `task_actions.cancel`, 알림 `notifyCanceled`(화면 PUT 취소도 같은 함수). 삭제 도구는 여전히 없다. 고객·프로젝트 응답에 **금액 없음**(HIGH).
- **업무 필드 권한 표(`FIELD_RULES`)·담당자 이력·담당자 후속(Cue 자동 실행·알림)은 행동 계층에 있다**(2026-10-02 M2-b 에서
  `PUT /tasks/:id` 인라인을 옮겼다). 사람(PUT)과 AI(`reassign`·`updateFields`)가 같은 함수를 쓴다 — 규칙을 바꾸면 한 곳만 고친다.
  미리보기(MEDIUM 1단계)도 실행과 같은 판정을 먼저 본다(거절될 요청에 확인 토큰을 내주지 않는다).
- **문서·파일 쓰기(2026-10-05)** — `create_document`·`append_to_document`·`link_documents`(LOW) · `update_document`·`move_document_to_project`(MEDIUM 확인 2단계) ·
  `upload_file`(ChatGPT `openai/fileParams` — 받는 주소는 OpenAI 파일 도메인 https 만 · 리다이렉트 안 따라감 · 받는 중 100MB 바닥 + 요금제 한도) ·
  메일 답장 초안에 `file_ids`(보내지 않는다). 문서 쓰기는 **`services/actions/post_actions` 한 곳**(화면 `POST /api/posts`·첨부 라우트도 같은 함수),
  파일 저장은 `driveImport.ingestDownloadedFile`(Drive 가져오기와 같은 함수), 업무 첨부는 `services/taskAttachmentLink`.
  scope `docs:write`·`files:write` 는 **새로 생겼다 — 이미 연결된 앱은 다시 연결해야** 생긴다(옛 동의를 조용히 넓히지 않는다).
  ★ 2026-10-21 — 낡은 연결은 **AI 가 대화 안에서 한 번 먼저 말한다**(`get_context.connection` · 판정 `grants.missingBundleScopes`·안내 `reconnectAdvice` 한 벌). 묶음에 scope 를 더하면 `config.SCOPE_ABILITIES` + i18n `profile.aiApps.ability.*` 에 한 줄(설계서 부록).
- **쓰기 보강(2026-10-07, Fable B 판정 2·3)** — `create_project`(MEDIUM · scope **`projects:write` 신설 → 재연결 필요** · 이미 있는 고객·멤버만,
  미리보기에 이름 · 초대 메일 없음 · 계정 고객은 그 고객 채널에 들인다) · `add_task_reviewers`(MEDIUM, 컨펌자에게 알림) · `create_memo`(Q note 텍스트 메모, L1 고정,
  q-note `internal/create-memo`) · `create_knowledge_item`(Q info, 비밀 칸 거절, 기본 나만 보기) · `create_task` 에 `tag_names`(**있는 태그만** — AI 가 태그를 만들지 않는다)·
  `estimated_hours`(담당자=본인일 때만). 프로젝트 생성은 **`services/actions/project_actions` 한 곳**(화면 `POST /api/projects` 도), Q info 생성은
  **`services/actions/kb_actions` 한 곳**(화면 라우트도 — 입력 정규화 헬퍼는 `services/kbFields`). MEDIUM 의 멱등 키는 확인 토큰 **+ 인자 지문**이다
  (쓴 토큰을 다른 인자로 보내면 앞 결과를 «replayed» 로 돌려주던 구멍을 막았다).
- **추진과제(그룹)(2026-10-27, Fable 설계 PASS — `docs/AGENT_WORKSTREAM_DESIGN.md`)** — `create_workstream`(LOW · `projects:write` · 같은 이름이면 있는 그룹 반환) · `create_task`/`update_task` 의 `workstream_id`(같은 프로젝트만, null=빼기) · `get_project.workstreams`(업무 수는 `taskListWhere`). 만들기는 **`services/actions/workstream_actions` 한 곳**(화면 POST 도) — `loadProjectOrForbidden` 은 findByPk 라 **토큰 워크스페이스 묶음(`businessId`)을 꼭 준다**(같은 사람이 두 워크스페이스 멤버일 때 실측). 이름 키는 `normalizeWorkstreamTitle` 한 벌(AI 업무추가·루틴 확정도).
- **HIGH(삭제·청구·발송·권한·대량)는 도구로 두지 않는다** — 가드 `--category=agentsurface` 가 막는다(도메인 모델 직접 쓰기 0 · 재무 참조 0 · 고위험 이름 0 · 쓰기 도구 scope·멱등 선언 · 워크스페이스 묶음).
- **켜는 스위치**: `.env` `AGENT_ENABLED=1` + `AGENT_TOKEN_SECRET`(JWT_SECRET 과 **다른 값**, 32자 이상). 없으면 `/agent/*` 404. **쓰기 도구는 `AGENT_WRITE_ENABLED=1` 이 있어야 켜진다**(기본 꺼짐 — `config.writeEnabled`). 2026-10-04 운영에 셋 다 넣었다.
- **nginx**: `location /agent/` · `location /.well-known/oauth-` → `127.0.0.1:3005`. 운영 스키마 `scripts/migrate-agent-oauth.js`(멱등, 배포 슬롯).
- 회귀: `--suite agentconsent`(동의 화면 3폭) · 왕복 검사는 dev 전용 스크립트(OAuth 26검사 — 커밋하지 않는다).

