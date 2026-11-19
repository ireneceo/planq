# 업무 «요청» 은 만든 사람의 뜻으로 정한다 — 설계 (초안 · 2026-11-18)

> Irene 2026-11-17: *"프로젝트 일정을 짜느라 업무를 다 추가하면 내가 작성자가 되어서 다 요청으로 들어가. 작성자가 누구든 요청하기가 아니면 요청이 아니고 업무로 저장될 수 없을까? 작성자에게 다 업무 전달을 하게 하고 컨펌받게 되는 거 아니야?"*
> 2026-11-18 Irene «권고대로» = **B + 구멍 막기** (Fable 설계 1회 뒤 구현, 이미 들어간 45건 처리도 그때 같이 정함).
> 상태: Fable DESIGN-READY(§4) → [Opus] 구현·자체 검증 완료(2026-11-18, §5). 운영 45건 변환은 배포 뒤 Irene 승인.

## 1. 지금 사실 (코드·실측)

### 1.1 «요청» 판정 — 서버가 담당자만 보고 정한다
- `services/actions/task_actions.js createTask` 802: `isInternalRequest = !!finalAssignee && finalAssignee !== subjectId`.
  → `source='internal_request'` · `request_by_user_id = 만든 사람` · **만든 사람을 컨펌자로 자동 등록**(937, `opts.autoReviewer !== false` 일 때) ·
  예측시간 버림(817) · 받는 사람에게 «task_assigned» 알림 / 긴급이면 긴급 알림(1016~).
- 화면 업무 추가 폼(`components/QTask/TaskCreateForm.tsx`)의 «내 업무 / 요청하기» 토글은 **서버에 실리지 않는다**. 폼이 담당자 칸만 바꾼다.
  - Q task «내 업무» 탭(오늘·이번 주·전체): 토글 있음, «내 업무» 면 담당자 = 나 고정.
  - **프로젝트 업무 탭(`pages/QProject/TasksTab.tsx`)·Q task 전체 범위: 토글 없음(mode 'task'), 담당자 자유 선택 → 남을 고르면 요청.**
  - 담당자를 비우면 서버 체인(프로젝트 기본 담당자 → PM → 만든 사람, `pickProjectAssignee`)이 남을 고를 수 있고 그것도 요청.
- 다른 생성 길(모두 같은 `createTask` 를 지난다 — 같은 판정):
  `POST /api/tasks`(폼·`ProjectTaskList` 인라인·팝아웃 빠른 추가·메일/대화/노트 화면) · `POST /api/tasks/ai-create/confirm`(routes/tasks.js 890, AI 업무추가·Cue 배치) ·
  후보 등록(`task_extractor` 804 · projects/email_threads `/task-candidates/:id/register`) · 외부 AI 앱·Cue `create_task`(services/agent/tools/tasks.js 348 — 담당자 생략=본인) ·
  메일 답변 업무(`mailReplyTask`, autoReviewer:false) · 급여 송금 업무(`payrollTransition`).
- **갈라진 길 하나**: 템플릿 적용(`services/templateApply.js` 154·188)은 직접 `Task.create` — 요청으로 저장하지만 **자동 컨펌자를 붙이지 않는다**.

### 1.2 «요청» 값을 읽는 곳 (request_by_user_id · source · request_ack_at)
확인필요 ①(받은 요청 미확인, `urgentTaskNotify.UNACKED_STATUSES`·`weekTaskSet.unackedRequestWhere`·프론트 `todayTaskSet.isUnackedRequestToMe`) ·
이번 주 목록 · «요청하기» 탭(request_by OR created_by) · 대시보드(routes/dashboard.js 98·118·225) · 요청자 알림(taskTransition 258, task_actions 1191·1277·1450·1564) ·
화면 라벨 `taskLabel` «요청 신규(task_requested)» · 담당자 «요청 확인»(`/ack` → waiting) · 인계(memberHandover) · 내보내기 · Cue 문맥 · adoptionStages.
※ 여러 곳이 `request_by_user_id || created_by` 로 «의뢰자» 를 잡는다 — 요청이 아니어도 만든 사람은 의뢰자로 남는다.

### 1.3 실측 (dev ws 6, 2026-11-17, 시험 업무 6건 만들고 지움)
| 경우 | 결과 |
|---|---|
| 대표가 프로젝트 업무를 멤버에게 배정 | 요청 · 대표 컨펌자 pending |
| 멤버 체크박스 완료(`POST /:id/complete`) | 400 `not_ready_for_complete` |
| **멤버 상태 드롭다운 «완료»(`PUT /by-business/:b/:id` status=completed)** | **200 — 닫힘. 컨펌자 pending 그대로** (구멍) |
| 멤버 진행률 100 | 컨펌자 있으면 안 닫힘(정상) |
| 컨펌자 빼면 멤버 완료 | 200 |

구멍의 원인: `canEnterStatus` 는 reviewing/revision_requested 만 컨펌자 수를 본다. `completed` 는 검사 없음. 프론트 `statusOptionsFor` 도 컨펌자가 있어도 «완료» 를 보인다.

### 1.4 운영 지메이트(ws 21) 2026-11-18 (Irene 실행, 읽기 전용)
남에게 배정된 프로젝트 업무 46건 · 작성자 전부 김미정 계정 · 열린 45건(시작 전 34 · 진행대기 9 · 진행 중 2) 전부 «요청 + 컨펌자 있음» ·
컨펌 대기인데 완료된 것 0 · 요청인데 컨펌자 없는 것 0.

## 2. 제안 ([Opus] — Fable 이 정한다)

### 2.1 판정을 «뜻» 으로 — `request` 플래그
- `createTask` 가 `params.asRequest`(boolean)를 받는다. **요청 = asRequest === true ∧ 담당자 ≠ 만든 사람.**
  담당자 ≠ 만든 사람이지만 asRequest 가 아니면 = **배정 업무**: `source='manual'`, `request_by_user_id=NULL`, 자동 컨펌자 없음, 확인 단계 없음.
- 길별 기본값(제안):
  | 길 | asRequest |
  |---|---|
  | 폼 «요청하기» 모드 | true |
  | 폼 «내 업무» 모드·토글 없는 폼(프로젝트 탭 등)·인라인 추가 | false |
  | 외부 AI 앱·Cue `create_task` | 새 인자 `as_request`(기본 false?) — 또는 남 배정이면 지금처럼 true? **결정 필요** |
  | AI 업무추가 confirm·후보 등록(대화·메일에서 뽑은 일) | **결정 필요** — 고객·동료 말에서 나온 일이라 지금은 요청 |
  | 템플릿 적용 | false(일정 짜기와 같은 성격) |
  | 메일 답변·급여 송금 | 지금 동작 유지(각자 이유가 있음) |
- 배정 업무에도 받는 사람에게 «task_assigned» 알림은 보낸다(모르면 안 됨). 확인필요 ①·«요청 확인» 단계에는 안 들어간다(날짜대로 이번 주 목록).
- 예측시간: 배정 업무도 지금처럼 버릴지(«담당자의 캐파» §5.7) — **결정 필요**. 폼은 지금 «남에게 지정» 이면 칸을 숨긴다.

### 2.2 구멍 막기 — 컨펌자 대기 중 «완료» 금지
- `canEnterStatus(…, 'completed')`: 컨펌자 ≥1 ∧ status ≠ done_feedback 이면 거절(`not_ready_for_complete`, `task_actions.complete` 와 같은 술어 한 벌).
  누가 막히나: 담당자·작성자·관리자의 드롭다운 완료 전부? 관리자·요청자(컨펌자 본인)는 «승인» 으로 닫을 수 있다. **범위 결정 필요.**
- 프론트 `statusOptionsFor`: 컨펌자 있고 done_feedback 아니면 «완료» 숨김(서버와 같은 술어).
- 취소(canceled)는 그대로 허용.

### 2.3 이미 들어간 요청 (운영 지메이트 45건 등)
- 그대로 둔다 / 일괄 «배정 업무» 로 바꾸는 스크립트(dry-run 기본 · 대상 = 아직 확인 안 한 요청 ∧ 컨펌 라운드 시작 전 ∧ 작성자 본인만 자동 컨펌자) — 운영 쓰기라 Irene 승인 따로.
- 사람이 업무 상세에서 «요청 → 일반 업무» 로 바꾸는 손잡이를 둘지.

## 3. 검증 계획(초안)
- 실 HTTP: 폼 두 모드 × 담당자(나/남/비움→체인) · AI 앱 create_task · ai-create confirm · 템플릿 → source·request_by·컨펌자 수·알림 행.
- 구멍: 컨펌자 pending 상태에서 PUT completed = 400(고치기 전 200 = 양성 대조군) · done_feedback → completed 200 · 컨펌자 없는 배정 업무 담당자 완료 200.
- 화면 3폭: 프로젝트 탭에서 남에게 넣은 업무가 받는 사람 «확인 필요» 에 안 뜸 · 이번 주 목록엔 날짜대로 · 드롭다운에 «완료» 없음(컨펌 대기).
- 가드: build · guard-invariants · health-check · e2e tenant.

## 4. Fable 설계 판정 — VERDICT: DESIGN-READY (2026-11-18) · 이 절이 2절을 대신한다
1. 요청 = `(asRequest === true ∨ 만든 사람이 고객) ∧ 담당자 ≠ 만든 사람`. 고객은 언제나 요청.
2. `createTask` 술어를 둘로: `isRequest`(source·request_by·자동 컨펌자·긴급 알림) / `assignedToOther`(담당자 알림·예측시간).
3. 배정 업무 = source 'manual' · request_by NULL · 자동 컨펌자 없음 · 확인 단계 없음(복사·담당자 변경이 이미 이 모양).
4. 알림: 배정 업무도 `task_assigned`(조건 assignedToOther). 긴급 강조는 요청만. 완료·보류 알림(`request_by || created_by`)은 그대로.
5. 예측시간: 담당자 ≠ 만든 사람이면 요청·배정 모두 버림(Cue 예외 유지). 템플릿 예측시간은 지금처럼 남김.
6. 길별: 기본 false. 폼 «요청하기» = true(`as_request`) · 토글을 프로젝트 탭 등 모든 폼에(기본 «업무») · 외부 AI 앱·Cue `create_task` 새 인자 `as_request`(기본 false, 결과에 `is_request`) ·
   ai-create confirm·후보 등록 = false · 템플릿 = false · 메일 답변·급여 송금 = 명시 true · 반복 회차는 부모 값 승계.
7. «요청하기» 탭·숫자·검색 라벨은 `request_by_user_id === 나` 하나로(QTaskPage 1284·1526·1553 · routes/tasks.js 2368 · TaskQuickSearch 87). 권한용 isRequester·taskRoles 는 그대로.
8. 완료 막기: `컨펌자 ≥1 ∧ 지금 상태 ∉ {done_feedback, completed}` 한 벌을 `complete()`·`canEnterStatus(…,'completed')` 가 같이. 막히는 사람 전원. revert 는 fromStatus 를 넘김. 프론트 statusOptionsFor 같은 술어. 취소 허용.
9. 알려진 길(범위 밖): 담당자가 컨펌자를 빼고 완료 — 이력이 남아 둔다.
10. 이미 들어간 요청: 스크립트만(업무별 손잡이 없음). 변환 한 건 = 행동 계층 함수 한 곳(request_by NULL · source manual · 작성자 컨펌자 행 삭제 · AuditLog 옛 값 · task:updated · 알림 없음).
    대상 = business_id(필수)·created_by(필수) ∧ request_by=created_by ∧ source internal_request ∧ project_id NOT NULL ∧ status ∈ {not_started,waiting,in_progress} ∧ review_round=0 ∧ 컨펌자 정확히 작성자 1명(pending, is_client=0) ∧ 급여 송금 아님. dry-run 기본 · `--apply` 되돌림 JSON · `--revert <파일>`.
    ↳ 2026-11-19 넓힘(Irene «권고대로» A · Fable 완료 검증 PASS): 컨펌자가 작성자 포함 여럿이고 전원 pending·내부인 업무도 대상.
      그때는 컨펌자 행을 그대로 두고 request_by·source 만 바꾼다(장부 `kept_reviewer_ids` · 되돌림은 컨펌자가 같을 때만). 운영 ws 21 45건 실행(유지 11).
11. 옛 번들(as_request 없음) = 배정 업무 — 받아들인다.
Irene 에게 물을 것: 없음(운영 45건 변환은 배포 뒤 dry-run 숫자로 실행 승인만).

## 5. 구현·자체 검증 (2026-11-18 · [Opus] · Fable 완료 검증 전)
- 서버: `task_actions.createTask`(isRequest/assignedToOther) · `routes/tasks.js` POST `as_request`·context 요청 목록 · `taskTransition.completionBlockedByReview` · revert fromStatus · `templateApply` · `agent/registry`·`agent/tools/tasks`(as_request·is_request) · `mailReplyTask`·`payrollTransition`(명시 true) · `services/taskRequestConvert` + `scripts/convert-requests-to-assigned.js`
- 화면: `TaskCreateForm`(토글 기본 노출·«업무» 라벨·as_request) · `QTaskPage`(요청하기 탭·숫자) · `TaskQuickSearch` · `taskLabel.statusOptionsFor`
- 실 HTTP 26/26: 폼 두 모드 · 본인 as_request 무시 · 담당 비움 체인 · 고객 = 요청 · AI 업무추가 = 배정 · 드롭다운 완료 담당자·대표 400(고치기 전 200) · 체크박스 400 · 확인요청→승인→승인완료→완료 200 · 완료 재저장 200 · 배정 업무 스스로 완료 200 + 작성자 알림 · 취소 200 · 컨펌자 붙은 업무 완료로 되돌리기 400 · 확인필요: 배정 0·요청 1 · 이번 주 목록에 배정 있음 · 작업대 요청 목록 배정 0·요청 1
- 외부 AI 앱 create_task: 기본 = 배정(is_request false) · as_request = 요청(컨펌자 1)
- 변환 스크립트 12/12: 읽기만 대상 +2(심은 것만) · 비대상 4종 그대로(컨펌자 2명·프로젝트 없음·남의 요청·컨펌 라운드 진행) · 감사 2행 · 변환 뒤 스스로 완료 200 · 되돌림 = 변환 전과 같음(다른 줄 0)
- 화면 3폭(1440·820·390): 프로젝트 업무 추가 폼 «업무 | 요청하기» 보임·기본 «업무» · 가로 넘침 0 · 컨펌 대기 업무 목록 상태 메뉴에 «완료» 없음 / 배정 업무엔 있음(1440·820 — 폰은 카드형이라 목록 상태 메뉴 없음, 해당 없음) · 배정 업무에 «요청 신규·요청 확인» 없음
- build EXIT 0 · error TS 0 · guard 85/86 · health 100/100
- 남은 것: 템플릿 적용 실측 못 함(시험 템플릿에 역할 칸이 없어 남에게 안 감 — 코드는 고정값 두 칸) · 메일 답변·급여 송금은 코드로만 확인 · 알려진 길: 담당자가 컨펌자를 빼고 완료(이력 남음, §4-9)

## 6. Fable 완료 검증 1차 FAIL → 고침 (2026-11-18)
- 차단 1: Q talk 우측 패널 체크박스 `PATCH /api/projects/tasks/:id` 가 `canEnterStatus` 를 안 지나 컨펌 대기 중에도 완료됐다(Fable 실측 200) →
  같은 술어를 건다(`routes/projects.js`). 거절 문구 `not_ready_for_complete` → errors `task_needs_review`(ko/en, `utils/apiError` 매핑).
  실측: 담당자·대표 400 · 다른 단계 200 · 배정 업무 완료 200 · 완료 재저장 200 · 승인완료 뒤 완료 200.
- 차단 2: 변환 되돌림이 «완료 + 컨펌자 pending» 을 만들었다 → `revertOne` 은 변환 때와 같은 상태에서만(같은 워크스페이스·작성자 ∧ 배정 업무 ∧ 시작 전·진행대기·진행 중 ∧ 컨펌자 0 ∧ 라운드 0),
  나머지는 «건너뜀(이유)». 장부에 business_id·creator_id · 되돌림 감사 행(`task.assigned_to_request_revert`). 실측: 완료된 것 건너뜀(상태 그대로) · 컨펌자 붙은 것 건너뜀 · 다른 워크스페이스 장부 거절 · 컨펌자≠작성자 장부 거절 · 열린 것 되돌림 · 감사 1행.
- 비차단: 대시보드 «보낸 업무요청» 버킷·QTaskPage panelCounts.sent 는 created_by 도 의뢰자로 센다 — 컨펌 진행을 의뢰자에게 알리는 자리라 의도(주석). 배정 업무의 AI 자동 예측시간(autoAiEstimate)은 이전부터의 동작 — 그대로.
- 남은 길(이번 범위 밖): Q talk 체크박스 길은 completed_at·상태 이력·완료 알림을 쓰지 않는다(이번 변경 전부터).
- **재검증 VERDICT: PASS** (e0b3be80). 비차단 «장부 컨펌자 줄 task_id 를 안 본다» 는 운영 `--revert` 전에 고침(이 뒤 커밋, 자체 검증):
  장부의 request_by·source·컨펌자 줄 task_id 가 변환 모양과 다르면 bad_entry · 컨펌자 행은 칸 화이트리스트(업무·사람·상태는 장부가 아니라 코드가 정함) · 다른 워크스페이스 이유 `other_workspace`.
  실측 7/7(바꾼 장부 3종 거절 · 정상 되돌림 · 컨펌자 행 = 변환 전과 같음 · 두 번째 거절) + 앞 14/14 · 스크립트 12/12 다시 통과.
