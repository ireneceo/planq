# 접수 양식 응답 → 사건(프로젝트)·업무 자동 생성 — 설계 초안 (2026-11-26)

> 근거: `docs/CUSTOM_WORKSPACE_ONPREM_REVIEW_2026-11-26.md` Fable 판정 «만드는 순서 ①» · Irene «진행은 해»(방 1bd7dfcd).
> 상태: **v2 — Fable 설계 판정 DESIGN: CHANGE(2026-11-26) 9건 반영. 구현 전(§6 이 정본, §2 와 다르면 §6 이 이긴다).**
> 목표 한 줄: 노무법인 같은 회사가 «상담 접수 양식» 을 공개하면, 응답 1건이 «그 회사 방식의 사건 + 처음 할 업무 묶음» 이 된다.

## 1. 지금 있는 것 (코드 사실)
- 공개 설문 = Q docs 표(`QRecord`) + `survey_token`. 응답 = `QRecordRow`(`values`) — `routes/survey_public.js:78-124` 무인증 저장. 막는 것: 토큰·IP 한도(분 60/20 · 일 2000 · 시간 300) · 64KB · 꿀단지 · 응답 상한.
- 저장 뒤 하는 일은 셋뿐: `QRecordAudit row.survey` · 소켓 `record:row` · `notifyOwner`(설정 owner_id → 글쓴이, 10분 1건, 앱 알림).
- 설정 키는 `services/survey.js sanitizeSettings` 허용 목록(:178-202).
- 업무 묶음 = `services/templateApply.applyTemplate({templateId, businessId, projectId, startDate, assigneeMap, actorUserId})` — 업무만 만든다(방송·감사는 라우트 몫 `routes/task_templates.js:167-246`).
- 프로젝트 = `services/actions/project_actions.createProject(actor, params)` — 멤버 확인·`plan.can('create_project')`·`clientIds` 연결.
- 고객 = 공용 find-or-create 없음. `saleCommon.findExistingByContact` + `Client.create`(sale_save·booking 각자) · `plan.can('add_prospect')` · `salesStage.setStage(..., 'inquiry', {origin:'auto'})`. 가장 가까운 자동 예: 공개 예약 `services/booking.js:529-640`.
- 공개 문의(`workspaceInquiry.submit`)는 자동 전환 안 함 — 사람이 «고객으로 저장». 보류 판정(3초·이메일당 하루 3건·링크·중복·폭주 → `held`)이 설문보다 엄격.

## 2. 제안
### 2.1 설문 설정에 «접수 처리» (꺼짐이 기본)
`survey_settings.intake` (sanitizeSettings 허용 목록에 추가):
```
intake: {
  mode: 'off' | 'review' | 'auto',      // 기본 off
  template_id,                           // 이 회사의 프로젝트 템플릿(같은 business_id 만)
  project_name: '{이름} — {상담 종류}',   // 응답 칸 끼워 넣기(칸 id 로 저장)
  map: { name: colId, email: colId, phone: colId, company: colId },   // 고객 연결 칸
  owner_id,                              // 사건 담당자 = 실행 주체(멤버 재확인, 아니면 멈춤)
  link_client: true                      // 이메일/전화로 기존 고객 찾고 없으면 잠재 고객 생성
}
```
- **review(권장 기본값으로 켤 때)** — 응답이 오면 담당자에게 «접수 1건 — [사건 만들기]» 카드. 누르면 아래 2.2 를 그 사람 권한으로 실행. 무인증 표면이 직접 만드는 것은 없다.
- **auto** — 응답 저장 직후 2.2 를 owner_id 주체로 실행. 조건: 보류 판정 통과(2.3) · 하루 상한(기본 20건/설문) 안. 넘거나 걸리면 review 로 떨어진다(응답은 늘 저장).

### 2.2 만들기 한 번 (`services/intakeCase.createFromResponse(row, settings, actor)`)
1. 멱등: `QRecordRow` 에 `case_project_id` 열(신규, NULL) — 이미 있으면 그 프로젝트를 돌려준다(중복 클릭·재시도).
2. 고객: map 의 email/phone 으로 `findExistingByContact` → 없으면 공용 `findOrCreateProspect`(booking·sale_save 에서 뽑음, `add_prospect` 한도) → `setStage('inquiry', {origin:'auto', reason:'intake_survey', sourceRef:row})`.
3. 프로젝트: `createProject({kind:'user', userId: owner_id}, {businessId, name, clientIds, startDate: today})` — 한도 실패면 멈추고 행에 `intake_error` 표시 + 담당자 알림.
4. 업무: `applyTemplate({templateId, businessId, projectId, startDate: today, actorUserId: owner_id})` + 라우트가 하던 방송(`taskRoom.emitTask`)·감사(`createAuditLog intake.case_create`, userId=owner_id, newValue {row_id, client_id, project_id, task_count, mode})를 이 함수가 한다.
5. 응답 내용은 프로젝트 첫 메모(상담 기록 `createInteraction kind:'memo'`)로 붙인다 — 고객 화면에는 안 보이는 내부 메모.
6. 한 트랜잭션은 아님(템플릿 적용이 길다) — 실패 단계를 `intake_error` 에 남기고 다시 누르면 멱등 키로 이어서.

### 2.3 auto 의 보류 판정
- workspaceInquiry 의 판정 재사용(최소 작성 시간 · 같은 이메일 하루 3건 · 링크 수 · 같은 본문 반복 · 폭주) — 한 곳으로 뽑아 문의·설문이 같이 쓴다.
- 이메일 칸이 있으면 형식 확인. 걸리면 review 로.

### 2.4 화면
- 설문 편집 «발행» 탭 아래 «접수 처리» 칸: 꺼짐/확인 후 만들기/바로 만들기 · 템플릿 고르기(`TemplateSelectModal`) · 이름 칸 연결 · 담당자 · 미리보기(«이 응답이면 ○○ 사건 + 업무 7개»).
- 응답 목록 행: «사건 만들기» / «사건 보기 →» / «만들지 못함: 이유».
- ko/en 모두.

## 3. 하지 않는 것
- 업무 상태·전이 규칙 변경 없음 · 처리 단계 층(②)은 별도 설계 · 고객 화면·외부 메일 발송 없음(응답자 자동 회신은 기존 «thanks» 화면만) · 공개 문의 폼(WorkspaceInquiry) 열 바꾸기는 이번 범위 밖.

## 4. 검증 계획
- 실HTTP: 설문 응답(무인증) → review 카드 → [사건 만들기] → 프로젝트·업무 N개·고객 연결·감사 1행 · 두 번 눌러도 1개 · auto 상한 초과 → review 로 · 다른 워크스페이스 템플릿 id 거절 · owner 가 멤버 아님 → 멈춤 · 한도 초과 → intake_error.
- 양성 대조군: 멱등 키 끄면 2개 생김 · 보류 판정 끄면 스팸 응답이 auto 로 생성.
- 화면 3폭 · build · guard · e2e tenant.

## 5. Fable 에 묻는 것
1. 무인증 응답이 프로젝트·고객을 «바로» 만드는 auto 를 넣을지(넣으면 상한·보류 판정으로 충분한지), review 만으로 출시할지.
2. 실행 주체 = 설문 설정의 owner_id 로 충분한지(나간 멤버·권한 줄어든 멤버).
3. 응답 행에 `case_project_id`·`intake_error` 열 추가(운영 마이그레이션) vs 별도 연결 표.
4. 고객 find-or-create 를 booking·sale_save 에서 뽑아 공용화하는 범위.

## 6. Fable 설계 판정 반영 (DESIGN: CHANGE 9건 · 2026-11-26) — 정본

1. **auto 없음.** `intake.mode = 'off' | 'review'` 만. auto 의 설정 값·코드 길을 만들지 않는다(다음 단계 별도 판정). §2.3 보류 판정 공용화도 뺀다.
   이유: 검증 안 된 이메일로 **실제 고객과 자동 연결**되면 그 고객 대화방·화면에 사건이 뜬다(`createProject` clientIds → ProjectClient → `joinProjectCustomerChannels`) · 외부인이 `add_prospect`·`create_project` 한도를 채울 수 있다.
2. **멱등 = 먼저 잡기.** 새 표 `intake_cases`(business_id, q_record_id, **q_record_row_id UNIQUE**, status, step, client_id, project_id, error, actor_user_id, mode, created_at/updated_at). INSERT 로 선점한 쪽만 진행. 고객 연결 + 프로젝트 생성 + project_id 기록은 한 트랜잭션(`createProject` opts.transaction). 템플릿 적용은 그 뒤 `step`.
3. **템플릿 재시도 중복 방지.** `step='tasks_done'` 기록 · 재시도는 그 프로젝트에 이 템플릿 업무가 0개일 때만. 검증 «템플릿 중간 실패 → 다시 눌러도 업무 N개».
4. **기존 고객 자동 연결 금지.** 이메일이 일치하면 카드에 «기존 고객 ○○ 과 일치(본인 확인 안 됨)» → 누르는 사람이 [연결]/[새 잠재 고객]/[연결 안 함]. 전화만 일치 = 후보로만. 응답 메모에 «공개 양식 · 미확인».
5. **[사건 만들기] 권한.** `authenticateToken + checkBusinessAccess` · 행→표→business_id 서버 재확인 · 그 표를 볼 수 있는 멤버만(프로젝트 소속 표면 프로젝트 접근 술어) · Client 역할·다른 워크스페이스 403. `template_id` 는 저장·실행 때 모두 business_id 확인(시스템 템플릿 허용 여부를 구현 때 여기 적는다).
   **실행 주체 = 버튼 누른 사람.** `owner_id` 는 알림·기본 담당자 용도만. 담당자를 화면에서 받으면 저장·실행 때 모두 현재 멤버(removed_at null · role≠ai) 확인.
6. **익명 설문과 같이 못 켬** — `anonymous:true` 면 서버가 intake 저장 거절. 개인 열쇠(recipient) 응답은 받는 사람이 고객이면 그 고객. `map`·`project_name` 칸 id 는 `pickIds` 방식으로 거르기 · 이름 200자 절단 · 빈 값 폴백.
7. **감사** `intake.case_create` — via:'intake_review' · row_id · 고객 새로 만듦/기존 고름. 응답 값은 싣지 않는다. `project.create` 와 이중 기록(의도).
8. **응답 행이 지워져도 사건은 남는다** — 연결 표는 행 id 를 보존(SET NULL 아님), 화면 «원 응답 삭제됨».
9. **알림은 기존 `notifyOwner` 10분 1건 묶음 그대로**(응답마다 새 알림 금지). 정본 진입점 = 응답 목록의 [사건 만들기].
- 공용화: `findOrCreateProspect(businessId, {...}, {transaction})` 신설 → intake 가 쓰고 booking 만 동작 불변으로 옮김(슬롯 잠금 트랜잭션 안 · 필드 동일). sale_save 는 범위 밖.
- 운영: `migrate-intake-cases.js`(배포 슬롯, PM2 reload 전) · 되돌리기 어려움 → 구현 뒤 Fable 완료 검증 1회.

## 7. 구현 메모 (2026-11-26 · Fable 완료 검증 1차 FAIL 반영)
- **시스템 템플릿(is_system) 허용** — `templateApply` 와 같은 선(시스템 preset 또는 같은 워크스페이스 것). 저장·실행 때 둘 다 `loadTemplate` 이 본다.
- **멈춘 «만드는 중»(B1)** — running 으로 5분(`STALE_MS`) 넘게 바뀌지 않은 행은 «멈춤» 으로 보고 다시 잡는다. 조건부 UPDATE(`status='running' ∧ updated_at = 본 값`)라 살아 있는 요청과 겹치지 않는다. 화면은 [다시 만들기].
- **업무 일부만(B2)** — `applyTemplate` 은 한 건씩 만들어 중간에 끊기면 일부가 남는다. 업무 수 < 템플릿 항목 수면 «완료» 로 닫지 않고 `error='tasks_partial'` — 다시 눌러도 채우지 않는다(겹침 방지). 화면 «업무가 일부만 만들어졌어요(N개) — 프로젝트에서 확인» + [사건 보기]. 원자 적용(템플릿 함수에 트랜잭션)은 공용 함수 변경이라 이번 범위 밖.
- **원 응답 삭제** — 접수함 아래 «원 응답이 지워진 사건» 줄(사건·프로젝트는 남음).
- **Q sale 쓰기 없음** — 연결·새 고객은 403, «연결 안 함» 은 받는 사람 고객이 있어도 고객 없이 만든다(미리보기 문구와 같다).
- 이름·회사 없는 응답의 프로젝트 이름 = «설문 제목 #응답 번호».
