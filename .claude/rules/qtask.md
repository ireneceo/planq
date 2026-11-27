---
paths:
  - "dev-backend/routes/task*.js"
  - "dev-backend/routes/tasks.js"
  - "dev-backend/services/task*"
  - "dev-backend/services/actions/task_actions.js"
  - "dev-backend/services/weekTaskSet.js"
  - "dev-backend/services/reviewStage.js"
  - "dev-backend/services/todo/**"
  - "dev-frontend/src/pages/QTask/**"
  - "dev-frontend/src/components/QTask/**"
  - "dev-frontend/src/utils/taskLabel.ts"
  - "dev-frontend/src/pages/Todo/**"
  - "dev-frontend/src/pages/QProject/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q Task — 상태·승인완료·필드 권한·진행률

> **Q Task 상태 ENUM:** `not_started`, `waiting`, `in_progress`, `reviewing`, `revision_requested`, **`done_feedback`**, `completed`, `canceled`. 관점별 UI 라벨은 `dev-frontend/src/utils/taskLabel.ts` 참조 (i18n `status.{code}.{role}` 4차원 구조).
>
> **★ 승인완료(`done_feedback`) — 완료 **앞** 단계 (2026-09-12 부활).** Irene: *"업무 승인, 컨펌 다 받으면
> 완료 상태가 되는데 그러면 담당자가 확인을 못하잖아. 승인완료함 << 이렇게 단계 하나 완료 앞에 있어야
> 하지 않아? 요청받은 것처럼 확인필요에 뜨고 업무리스트에도 그대로 있게 해서 다음 처리 하게."*
> - 컨펌 정책 충족 시 `completed` 가 아니라 여기로 온다. **`completed_at`·진행률 100 을 찍지 않는다** —
>   찍으면 "오늘 완료"·주간 진척 그래프가 아직 안 끝난 일을 완료로 센다.
> - 담당자가 **"최종 완료"** 를 눌러야 닫힌다. `complete` 액션은 컨펌자가 있으면 막지만
>   `done_feedback` 일 때는 통과시킨다 — 그 예외가 없으면 **아무도 닫을 수 없는 막다른 길**이 된다.
> - **활성 상태다.** 이번 주 목록(`services/weekTaskSet.js`)·정렬(`popoutSort` STAGE_ORDER)·확인필요
>   5번째 버킷(`collectTasks`, verb `finish`)에 모두 들어간다. 하나라도 빠지면 "확인필요엔 뜨는데
>   업무리스트에선 사라진" 상태가 된다(2026-09-11 외부컨펌 신고와 같은 모양).
> - 2026-04-25~09-12 은 폐지 상태였고 그때 결정("자동완료 유지 + 알림만")을 **되돌린 것**이다.
>   같은 신고가 두 번 왔다(#282). **알림은 인지를 보장하지 못한다 — 단계로 만든다.**
> - 폐지값을 되살린 것이라 **운영 ENUM ALTER 가 없다.** ko/en 4관점 라벨도 이미 있었다.
>
> **Q Task 시간/진행율 권한 (2026-04-25):** `estimated_hours / actual_hours / progress_percent` 는 **담당자만 입력 가능**. 비담당자가 PATCH/PUT 시 `only_assignee_can_edit_hours` 403. 프론트는 `assignee_id !== myId` 시 input disabled (회색·점선·spinner 숨김). 다른 역할은 read-only 참고.
>
> **Q Task 본문 필드 책임선 분리 (2026-05-10, 사이클 N+5):** PERMISSION_MATRIX §5.7 정식 박제.
> - **description (의뢰 명세)** → **작성자만.** owner·admin·platform_admin 예외 없음 (2026-09-07 Irene:
>   "owner든 admin이든 누구든 그 기준이 맞는 거 아냐?"). 담당자는 코멘트로 보충
> - **body (결과물)** → **담당자만.** 예외 없음. 결과물을 바꿔야 하면 **컨펌 반려(revision_requested)** 로
>   담당자에게 돌려준다 — 그래야 바뀐 사실이 원장에 남는다. 직급으로 덮어쓰면 남지 않는다
> - ★ 삭제·프로젝트 이관 같은 **운영 권한**은 종전대로 owner/admin — 그건 책임선이 아니라 관리 행위다
> - **title/category** → 작성자/담당자/owner/admin
> - **DELETE task** → owner/admin. 작성자는 댓글·이력·리뷰어 0건 신생 task 만 (실수 정정용)
> - 프론트엔드: `TaskDetailDrawer.tsx` `canEditTitle/canEditDescription/canEditBody` 3분기. 권한 없으면 RichEditor `readOnly` + 섹션 옆 회색 "읽기 전용" 뱃지
> - RichEditor 의 anchor 는 `openOnClick: true` + `target=_blank` — editable/readOnly 무관하게 본문 링크 항상 새 탭

> **사이클 N+6/N+7 — v1.5.3 (2026-05-11):** 진행률 sync + reviewer 분기 + 관련업무·description 첨부 + 시간 자동 누적 + 모바일 UX. commit `1031409`.
>
> - **task_links 테이블 (양방향, a < b 강제)** — 관련 업무 링크. `routes/tasks.js` GET/POST/DELETE links + GET search. workspace 격리, cross-workspace 차단. 자기 자신·중복 차단. UI: `RelatedTasksSection.tsx` (description 섹션 안)
> - **TaskAttachment.context ENUM 'description_attach' 신설** — 의뢰자 영역 댓글식 첨부. 권한 = description 편집 권한 (**작성자만** — 2026-09-07 부터 owner/admin 예외 없음). `DescriptionAttachments.tsx` (FilePicker 패턴, uploads + 기존 파일·문서 link)
> - **Task.actual_source ENUM('auto','user')** — 시간 자동 누적 vs 사용자 입력 구분. `services/taskActualHours.js` recomputeActualHoursFromHistory + TaskStatusHistory afterCreate hook. in_progress 진입~이탈 라운드 합산. 사용자 직접 입력 시 'user' 자동 전환 + 자동 누적 정지
> - **reviewer 가드 (PUT 라우트)** — reviewer 0명이면 status='reviewing'/'revision_requested' 차단 (400 `no_reviewers_assigned`). 100% 자동 completed 도 reviewer ≥ 1 시 차단 (in_progress 유지, "확인 요청 보내기" 명시 클릭 필요)
> - **진행률 ↔ status 양방향 sync (PATCH + PUT 단일 진실 원천)** — `routes/tasks.js` PUT 에 progress → status 자동 전환 분기 추가. completed → active 전환 시 progress 100 → 90 자동 / completed 진입 시 progress < 100 이면 자동 100. frontend QTaskPage.saveField 의 이중 PUT 호출 제거
> - **이번 주 내 업무 필터** — 담당자=나 분기 status 화이트리스트 제거 → 활성 status 모두 표시 (reviewing 포함). "마감 책임 = 담당자 끝까지"
> - **statusOptionsFor 3곳 일관** — QTaskPage / TaskDetailDrawer / ProjectTaskList — reviewer 0명이면 reviewing/revision_requested 옵션 숨김
> - **모바일 UX** — FilePicker 75vh bottom sheet (slide-up, safe-area), QTalk LeftPanel PinBtn `@media (hover: none), (max-width: 1024px)` 항상 노출 + Unread `margin-left: auto` 우측 끝

> **댓글·메모 visibility 통일:** `personal`/`internal`/`shared` — `task_comments` 와 `project_notes` 공통 ENUM.
>

> **반복 설정 변경은 «오늘까지는 건드리지 않는다» (2026-11-10, Irene *"반복설정 바꿨더니 과거 지연된 업무들 다 없어졌어 … 이 회차부터 적용 했는데. «앞으로» 라고 하는 걸랑 헷갈리고"*)**
> - 판정은 `services/taskSeriesRecurrence.applySeriesRuleChange` 한 곳. 지우는 것은 **아직 시작 안 한 + 경계 뒤** 회차뿐 —
>   경계 = 고친 업무가 앞날이면 그 날짜(그 업무 자신은 남김), 오늘·지난 업무면 **내일**. 지연 회차·오늘 회차는 절대 지우지 않는다.
> - **생성 커서(`next_occurrence_at`)는 경계 뒤 새 규칙 첫 날짜**(`firstOnOrAfter`, 기준점은 부모 마감일). 옛 코드는 커서를
>   시리즈 맨 처음으로 되돌려 생성기가 **지난 날짜마다 가짜 지연 업무**를 지어냈다.
> - **바꾸는 즉시 새 회차를 만든다**(`generateOneSeries` + 비우지 않는 알림 버킷 = 알림 없음) — 자정 생성기를 기다리면 바꾼 직후 «고친 업무 1개만 남는» 화면이 된다(Irene 같은 날 2차 신고).
> - 화면(`SeriesScopeDialog` recurrence)은 «이 업무 다음부터»(앞날 업무일 때만) / «내일부터» 두 개 — «이 회차 이후·앞으로 전부» 는 폐기.
> - 회귀 `node scripts/check-recur-change.js`(실 HTTP + dev DB · 옛 코드로 5건 FAIL 확인한 양성 대조군 · ④ 음성 대조군 = 뒤 회차는 실제로 바뀌는가).

> **미확인 받은 요청은 오늘·이번 주 목록에 날짜 무관으로 든다 (2026-11-14, Irene · Fable)** — 술어는 확인필요 ① 하나
> (서버 `weekTaskSet.unackedRequestWhere`·`urgentTaskNotify.UNACKED_STATUSES` / 프론트 `todayTaskSet.isUnackedRequestToMe`).
> `myWeekWhere`(목록·우선순위 정본)에만 넣고 `myAssignedWeekWhere`(보고서·today_review)·summary·그래프에는 넣지 않는다. 기본 정렬 맨 위. 정본 `docs/WORK_FLOW_DESIGN.md §5`.
> ★ **단 «미래 전용»(날짜가 전부 다음 주 이후) 요청은 빼고, 확인 뒤 진행대기(waiting)도 미래 전용이면 뺀다** (2026-11-17, Irene «1월 달건데 리스트에 다 나와» · Fable decision B) —
> 서버 `weekTaskSet.notFutureOnly` · 프론트 `todayTaskSet.isFutureOnly` 한 벌. 확인필요 ① 술어는 그대로.

> **«요청» 은 만든 사람의 뜻으로 정한다 (2026-11-18, Irene «프로젝트 일정 짜느라 업무를 다 추가하면 … 다 요청으로 들어가» → «권고대로» B · Fable 설계 `docs/TASK_REQUEST_INTENT_DESIGN.md` §4)**
> - 요청 = `(as_request === true ∨ 만든 사람이 고객) ∧ 담당자 ≠ 만든 사람` — `task_actions.createTask` 의 `isRequest`. 남을 담당으로 넣었지만 요청이 아니면 **배정 업무**
>   (source manual · request_by NULL · 자동 컨펌자·확인 단계 없음 · 담당자 배정 알림은 감 · 예측시간은 담당자 몫이라 버림 = `assignedToOther`).
> - 길별: 폼 «요청하기» 모드만 `as_request:true`(토글은 모든 업무 추가 폼에, 기본 «업무») · AI 업무추가 확정·후보 등록·템플릿·옛 번들 = 배정 · 외부 AI 앱·Cue `create_task` 는 `as_request`(기본 false, 결과 `is_request`) · 메일 답변·급여 송금 = 명시 true.
> - «요청하기» 탭·숫자·통합 검색 «내가 요청»·작업대 요청 목록 = `request_by_user_id === 나` 하나. 권한용 isRequester(작성자 = 의뢰자)·완료/보류 알림(`request_by || created_by`)은 그대로.
> - **컨펌자 대기 중 «완료» 금지** — `taskTransition.completionBlockedByReview`(컨펌자 ≥1 ∧ 상태 ∉ {done_feedback, completed}) 한 벌을 `complete()`·`canEnterStatus(…,'completed')`(PUT 드롭다운)·revert 가 같이 쓴다. 막히는 사람 전원. 프론트 `statusOptionsFor` 같은 술어. 옛날엔 드롭다운으로 컨펌을 건너뛰고 닫혔다(dev 실측 200).
> - 이미 들어간 요청 → 배정: `node scripts/convert-requests-to-assigned.js --business <id> --creator <user_id>`(읽기만 기본 · `--apply` 장부 · `--revert <장부>`), 판정 `services/taskRequestConvert` 한 곳. 운영은 Irene 승인 뒤.

> **업무 «산출물» — 만들어야 하는 것의 종류 (2026-11-19, Irene «업무설명에 필요한 산출물 선택하게 … 기본 산출물 자동 검색 · 없는 건 입력해 저장» → «권고대로» · Fable 설계 `docs/TASK_DELIVERABLES_DESIGN.md`)**
> - **결과물(`tasks.body`·회차)과 다르다** — 결과물 = 만든 내용, 산출물 = 만들 것의 종류. 코드·표 이름은 `output_kind`, 화면 «산출물»/«만들 산출물»(en Expected outputs / To produce). `deliverable` 을 쓰지 않는다.
> - 기본 목록 22개는 서버 코드 한 곳(`services/taskOutputKindPresets.js` — key 는 바꾸거나 빼지 않는다), 처음 고를 때 사전 행 생성(`preset_key`), 보는 사람 언어로 보인다. 직접 입력은 워크스페이스 사전(상한 100·이름 40자·업무당 10).
> - 고치기 = 태그 축(작성자·담당자·owner·admin, 고객 403) · 반복은 `series_scope` 델타 · 보기 = 상세에만(고객도 읽기 전용) — 목록·공개 링크·게스트엔 싣지 않는다. 드로어가 상세 값으로 교체 PUT 을 보내므로 `attachOutputKindsTo` 를 빼면 데이터가 지워진다.
> - 따라가는 곳: 만들기·요청하기(생성 트랜잭션 안 `output_kind_ids`) · 반복 회차 · 복사 · 템플릿(`output_names`, 적용 때 없는 이름은 만든다) · AI 도구(있는 이름만). 회귀 `node dev-backend/scripts/check-task-output-kinds.js`(51항목 · 양성 대조군 2).

> **Cue 에게 맡긴 업무의 담당자 = 사용자가 한 말로 정한다 (2026-11-27, Irene «큐에게 업무를 요청하면 기본적으로는 요청한 사람에게 … 누구한테 요청 넣어 달라고 하면 그 사람이 담당»)**
> - 이름·직함 해석은 **`services/memberMention` 한 벌** — Cue 대화창(`cue_tools.settleTaskAssignee`)·말로 추가(voice)·Cue 업무 바/AI 업무 추가(`aiTaskPlanner.matchMemberByName`)·채팅 업무 후보(`task_extractor.resolveAssignees` 1-b). 이름 비교를 길마다 새로 쓰지 않는다.
>   단계: 그대로 → 호칭·조사·직함 뗀 이름 → 성 뺀 이름·표시명 앞부분 → 한 글자 오차(3자↑) → 직함·전문 분야(«대표님»·«박 개발자»), **단계마다 한 명일 때만**. 포함 일치(«지원팀» → 김지원)는 하지 않는다.
> - 지목 = «OO에게/한테/께 + 요청·부탁·시켜·맡겨…» · «담당은 OO» (`findTargets`). **언급만**(«OO가 보내준 자료», «OO한테 받은 파일»)은 지목이 아니다 → 요청한 사람.
> - Cue 대화창은 모델 인자를 사용자 말과 맞춘다: 말에 없는 사람·맡기는 말 없는 언급 → 비움(=나) · 지목 하나인데 모델이 비움 → 그 사람 · 못 찾음/여럿 → 비우고 카드 안내(`qhelper.note.assignee_unresolved|ambiguous`) + 설명 «요청 대상: OO» · 담당=나 → 요청 아님. 카드에서 사람이 고친 값(executeTool)은 덮지 않는다.
> - «OO에게 요청해줘» 에 카드 없이 답하면(«메시지는 못 보낸다») 한 번 되돌려 create_task 를 부르게 한다(`looksLikeTaskRequest` — 메일·휴가 결재·질문 제외).
> - 역할 힌트로 동료에게 배정하는 것은 **프로젝트 전체 일정 짜기(planCtx)만** — Cue 업무 바·일반 AI 업무 추가는 이름을 말했을 때만 남에게 간다.
> - 회귀 `node dev-backend/scripts/check-member-mention.js`(LLM 없음 · dev DB 읽기 · 옛 정확 일치 대조군).
