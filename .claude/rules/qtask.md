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
