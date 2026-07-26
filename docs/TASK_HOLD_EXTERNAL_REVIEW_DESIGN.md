# Q Task 보류(on_hold) + 외부컨펌중(external_review) 설계 — 운영 피드백 #206

- 작성: Fable 설계 게이트 (2026-07-26)
- 상태: **설계 확정안** — Irene 승인 후 Opus 구현, 구현 후 Fable 구현 게이트 필수
- 실측 기반: dev DB `tasks.status` ENUM 8값 (Null YES, Default 'not_started'), 분포 not_started 99 / in_progress 45 / completed 46 / reviewing 12 / waiting 6 / revision_requested 2 / canceled 1 / done_feedback 0. `hold_*` 컬럼 미존재.

---

## 0. Irene 질문 → 확정 답 (요약)

| 질문 | 확정 답 | 근거 (상세는 본문) |
|------|---------|------|
| 액션버튼으로 나오게? | **상태 드롭다운 옵션 + 드로어 Secondary 버튼 둘 다.** 보류는 전진 워크플로가 아니므로 Primary 금지 — Secondary 톤 | UI 3톤 규칙. 전진 액션(확인요청/완료)과 시각적 구분 |
| 어떻게 표시? | **독립 상태 뱃지 2개.** "진행중(외부컨펌중)" 같은 괄호 합성 라벨 **기각** | 4차원 i18n `status.{code}.{role}` 구조를 깨고, 시간·필터 semantics가 다른 상태를 같은 상태처럼 보이게 함 |
| 진행중 하위구분 vs 별도 상태? | **별도 ENUM 상태.** in_progress 하위 플래그 기각 | 플래그면 `taskActualHours.js`가 보류/외부대기 중에도 시간을 계속 누적 (§3). ENUM이면 해당 파일 무변경으로 자동 정지 |
| 보류는 모든 단계에서? | **활성 5+1 상태 전부 가능** (not_started·waiting·in_progress·reviewing·revision_requested·external_review). completed/canceled 불가 | 복귀는 `hold_prev_status` 컬럼으로 명시 저장 → "모든 단계 보류 ↔ ENUM" 충돌 해소 |
| 보류하면 전체업무에만? | **YES.** "이번 주 내 업무"·주간 통계에서 제외, 전체 탭 + 전용 칸반 컬럼/필터에만. 외부컨펌중은 **이번 주에 남긴다** (마감 책임 = 담당자 끝까지) | §4 |

---

## 1. 상태 모델 결정

### 결정: ENUM 2값 추가 + 보조 컬럼 2개 (혼합 아님, 순수 상태 확장)

```
tasks.status ENUM 에 'on_hold', 'external_review' 를 **끝에 append**
tasks.hold_prev_status VARCHAR(30) NULL   — 보류 직전 상태 (해제 시 복귀 목적지)
tasks.hold_reason      VARCHAR(500) NULL  — 보류 사유 (선택). 해제 시 NULL 초기화 (이력은 TaskStatusHistory.note 에 영구)
```

### 왜 ENUM인가 (플래그 기각 근거 — 코드 실측)

1. **시간 누적이 자동으로 옳아진다.** `services/taskActualHours.js:58-70` — status_history 기반 누적은 "to_status가 in_progress면 라운드 시작, 그 외로 이탈하면 라운드 마감"이고, **L68은 `task.status === 'in_progress'`일 때 지금 이 순간까지를 임시 합산**한다. `is_on_hold` 플래그로 status를 in_progress에 둔 채 보류하면 **보류한 일주일이 통째로 actual_hours에 누적**된다(포커스 미사용 task). ENUM 전이는 이 파일 **무변경**으로 누적을 멈춘다.
2. **Focus 세션 정리도 자동.** `services/focusSync.js:24-26` — `leavingProgress = prev==='in_progress' && new!=='in_progress'`. on_hold/external_review 진입 = in_progress 이탈 → active/paused 세션 자동 stop. 플래그면 좌측 "포커스 중" 배너가 보류 중에도 남는 N+32 회귀 재발.
3. **필터·통계·칸반이 화이트리스트 수정만으로 정합.** 플래그면 status 화이트리스트 전 지점(§8 목록)에 `AND is_on_hold=0` 조건을 병렬 추가해야 함 — 절단면이 더 크고 누락 회귀(권위 컬럼 이원화, memory `feedback_dual_column_authority_write_side`)의 온상.
4. **"모든 단계에서 보류" 충돌의 정면 해소**: 보류 해제 시 복귀 목적지를 `hold_prev_status`에 **쓰기 시점에 명시 저장**한다. TaskStatusHistory에서 파생하지 않는 이유 — `routes/tasks.js:1026-1028`의 PUT history 기록은 silent-fail(try/catch 삼킴)이라 권위 소스로 부적합. 전용 컬럼이 단일 진실 원천.

### 외부컨펌중이 기존 컨펌자(is_client reviewer) 체계와 다른 이유

기존 reviewing은 **PlanQ 안의 컨펌자(task_reviewers)** 가 승인/반려하는 라운드다. #206의 외부컨펌은 **PlanQ 밖**(이메일·카톡·외주업체)에서 회신을 기다리는 상태 — reviewer row도, 승인 액션도 없다. reviewing에 욱여넣으면 `recalcStatusFromReviewers`(task_actions.js:99-126)가 reviewer state 기준으로 상태를 되돌려버린다. 별도 상태가 정합.

### done_feedback

이번 사이클에서 **건드리지 않는다** (제거는 별도 건). ENUM 순서 유지 + 끝에 append만.

---

## 2. 전이 규칙표

### 진입/해제 매트릭스

| 전이 | 허용 from | to | 트리거 | 권한 |
|------|-----------|-----|--------|------|
| 보류 | not_started · waiting · in_progress · reviewing · revision_requested · external_review | on_hold | 드롭다운 or 드로어 [보류] 버튼 | 담당자 / 작성자 / owner / admin (= 기존 `FIELD_RULES.status`, tasks.js:938 — 신규 권한 기계 없음) |
| 보류 해제 | on_hold | **hold_prev_status 복귀** | 드로어 배너 [보류 해제] or 드롭다운에서 임의 상태 직접 선택 | 위와 동일 |
| 외부컨펌 진입 | **in_progress만** | external_review | 드롭다운 or 드로어 버튼 | 위와 동일 |
| 외부컨펌 해제 | external_review | **in_progress 고정 복귀** (prev 저장 불필요) | 드롭다운 or [작업 재개] | 위와 동일 |
| 외부컨펌 → 내부 컨펌 | external_review | reviewing | 기존 submit-review 액션 그대로 허용 | 담당자 |

- completed / canceled 에서 on_hold·external_review 진입 **불가**.
- **보류 해제 fallback**: `hold_prev_status`가 reviewing/revision_requested인데 `canEnterStatus` 실패(그 사이 reviewer 0명이 됨) 또는 prev NULL(revert-status 경유 등 예외 경로) → **in_progress로 복귀**. 해제 시 `hold_prev_status`·`hold_reason` NULL 초기화.
- 진입 매트릭스의 단일 원천: `services/taskTransition.js`의 `canEnterStatus(taskId, toStatus, { fromStatus })`를 확장해 on_hold/external_review from-검사를 여기에 둔다. PUT·액션 계층·revert-status가 전부 이 함수를 지난다 (사람·Cue 공통 — 기존 패턴 유지).

### 보류 중 워크플로 액션 가드 (task_actions.js)

| 액션 | on_hold 중 | 근거 |
|------|-----------|------|
| submitReview / complete | **차단** — `fail('task_on_hold')` | 보류는 "일이 멈춤"의 선언. 우회 전진 금지. 해제 후 진행 |
| approve / requestRevision / revertReviewerState | 기존 `inReviewRound()` 가드(task_actions.js:668-670)가 자동 차단 (`not_reviewing`) — **코드 추가 불필요, 검증 항목** | status가 on_hold라 reviewing/revision_requested 아님 |
| ack | 허용 | ack의 status 변경은 not_started일 때만(task_actions.js:584) — 무해 |
| addReviewer / removeReviewer / setPolicy | 허용 | 보류 중 컨펌 체계 정비는 정상 업무. `inReviewRound` false라 라운드 리셋/recalc 미발동 |
| external_review 중 submitReview | **허용** | 외부 컨펌 끝나고 내부 컨펌 직행은 자연스러운 전진 |

### §5.7 책임선 정합

보류는 description(의뢰)도 body(결과물)도 아닌 **일정/실행 계획의 변경** — 기존 status 권한 집합(담당자·작성자·owner·admin)과 동일 집합이 정확하다. 고객(Client)이 작성자인 요청 업무는 고객도 자기 요청을 보류 가능(isCreator 경유) — 의도된 동작으로 확정.

---

## 3. 시간 누적 판정 — `taskActualHours.js` **무변경** (코드 근거)

| 상황 | 판정 | 근거 |
|------|------|------|
| in_progress → on_hold | **누적 정지** | history에 `to_status='on_hold'` row → L61-65에서 라운드 마감. L68 임시합산도 `task.status !== 'in_progress'`라 미발동 |
| in_progress → external_review | **누적 정지** | 동일. **외부 대기 시간은 작업시간이 아니다** — 이것이 별도 상태의 핵심 효용 |
| 해제 → in_progress 재진입 | 새 라운드 누적 재개 | L58-60 |
| 포커스 세션 사용 task | 전이 시 세션 auto-stop (focusSync leavingProgress) → `computeActualSeconds` 정지 | focusSync.js:24-41. 신규 전이 경로도 반드시 `syncFocusOnTaskStatus(task, from, to)` 호출 (기존 액션 계층 패턴) |
| actual_source='user' | 영향 없음 (자동 누적 이미 정지) | taskActualHours.js:27 |

구현 게이트 검증: in_progress 30초 → on_hold → 60초 대기 → resume 후 actual_hours가 보류 구간을 포함하지 않는지 **실호출 실측**.

---

## 4. 노출/필터 정책

원칙: **on_hold = 이번 주 무대에서 퇴장, 전체 무대에 주차. external_review = 이번 주 무대에 잔류** (담당자가 외부를 채근할 책임이 남는다 — "마감 책임 = 담당자 끝까지").

| 지점 | 파일:라인 | 변경 |
|------|-----------|------|
| 이번 주 내 업무 (server) | `routes/tasks.js:117` `Op.in ['in_progress','reviewing','revision_requested','waiting']` | + `'external_review'`. on_hold 미추가(제외) |
| 이번 주 필터 (client) | `QTaskPage.tsx:992-1008` (마지막 `return true`) + 이월 판정 `:1247` | on_hold 명시 제외, external_review 활성 집합에 추가 — **server와 미러 필수** |
| 대시보드 미확인 요청 카드 | `routes/dashboard.js:112` `Op.notIn ['completed','canceled']` | + `'on_hold'` (보류된 요청으로 담당자 채근 금지) |
| 대시보드 컨펌 대기 카드 | `dashboard.js:172` | 무변경 (reviewing/revision만 — on_hold가 자동으로 빠짐, 검증 항목) |
| 주간보고 스냅샷 | `reportUnitSnapshot.js:68,174` in_progress 버킷 / `:70,176` blockers | in_progress 버킷 += external_review · blockers += on_hold (보류 목록이 주간보고에 보이게) |
| 워크스페이스 주간보고 | `weeklyReviewSnapshot.js` blockers(waiting·revision_requested) | += on_hold. stalled(:467 `status:'in_progress'`)는 무변경 (보류는 별도 blockers로 감) |
| 통계 funnel | `services/stats.js:207-211` (else-if 체인 — 무매핑 상태는 **조용히 누락**됨) | funnel에 `on_hold` 키 신설 + external_review → in_progress 버킷 매핑. `Insights/tabs/TasksTab.tsx` funnel 표시에 보류 추가 |
| in_progress_watch (초과 경보) | `stats.js:269` | 무변경 — `status==='in_progress'` 조건이라 외부대기/보류 자동 제외 (의도 정합) |
| Cue 컨텍스트 | `cue_context.js:78,110,261` ACTIVE_TASK | 두 상태 모두 추가 (Cue가 "보류 업무 뭐 있어?"에 답할 수 있어야 함) |
| 지연(overdue) 뱃지·risks | 각 지점 `notIn ['completed','canceled']` | **무변경 = 보류여도 마감 지나면 지연 표시 유지.** 보류가 마감 연장이 아니다 — 연장은 명시적 due 변경으로 |
| 정기업무 generator | `recurringTaskGenerator.js` | **무변경 (스코프 밖).** parent 보류로 시리즈를 멈추고 싶으면 recurrence 해제가 정도 — 이번 건에서 다루지 않음 |
| 전체/워크스페이스 탭 | QTaskPage | on_hold 항상 표시 + 칸반 '보류' 컬럼 + 상태 필터 칩 (필터엔 "전체" 유지) |

---

## 5. UI/UX

### 액션 노출 (3톤 규칙)

- **상태 드롭다운** (3곳 공통 `statusOptionsFor`): `on_hold`는 **항상 포함** (hasReviewers 무관 — reviewer 가드는 reviewing/revision 전용). `external_review`는 **현재 status가 in_progress 또는 external_review일 때만** 포함 (진입 매트릭스와 미러 — backend 가드가 최종 방어).
- **TaskDetailDrawer**: status 뱃지 옆 워크플로 영역에 [보류] **Secondary** 버튼(활성 상태일 때). 클릭 → 드로어 안 **인라인** 사유 입력(선택, 500자, placeholder "보류 사유 (선택)") + [보류 확정] — 팝업 위 팝업 금지 준수. in_progress일 때 [외부컨펌] Secondary 버튼 병렬.
- **on_hold 상태의 드로어**: 상단에 보류 배너 — `⏸ 보류 중{사유 있으면 " — {reason}"}` + [보류 해제] Secondary. 해제 = hold_prev_status 복귀.
- 리스트 드롭다운 경로(사유 입력 UI 없음)는 사유 없이 즉시 보류 — 허용.
- 중복 제출 가드(`submitting` state) 적용.

### 뱃지 색 (`utils/taskLabel.ts` STATUS_COLOR 추가)

| 코드 | bg | fg | 근거 |
|------|----|----|------|
| on_hold | `#FFEDD5` | `#9A3412` | orange — 프로젝트 레벨 기존 'hold' `#F59E0B`(projects.js:177)와 같은 계열, reviewing amber(#FEF3C7)와 구분 |
| external_review | `#E0F2FE` | `#075985` | sky — "밖에 나가 있음". waiting indigo·in_progress teal과 구분 |

### i18n (ko/en 확정 — `locales/{ko,en}/qtask.json`)

`status.{code}.{role}` 4차원 — 두 상태 모두 관점 간 책임 차가 없어 4관점 동일 문구(키는 4개 모두 생성, 구조 유지):

```jsonc
// ko
"status": {
  "on_hold":         { "assignee": "보류중", "reviewer": "보류중", "requester": "보류중", "observer": "보류중" },
  "external_review": { "assignee": "외부컨펌중", "reviewer": "외부컨펌중", "requester": "외부컨펌중", "observer": "외부컨펌중" }
},
"hold": {
  "action": "보류", "resume": "보류 해제", "externalAction": "외부컨펌",
  "externalResume": "작업 재개",
  "reasonPlaceholder": "보류 사유 (선택)", "confirm": "보류 확정",
  "banner": "보류 중", "bannerWithReason": "보류 중 — {{reason}}"
},
"columnGroup": { "on_hold": "보류", "external_review": "외부컨펌중" }
```
```jsonc
// en
"status": {
  "on_hold":         { "assignee": "On hold", "reviewer": "On hold", "requester": "On hold", "observer": "On hold" },
  "external_review": { "assignee": "External confirm", "reviewer": "External confirm", "requester": "External confirm", "observer": "External confirm" }
},
"hold": {
  "action": "Hold", "resume": "Resume", "externalAction": "External confirm",
  "externalResume": "Resume work",
  "reasonPlaceholder": "Reason (optional)", "confirm": "Confirm hold",
  "banner": "On hold", "bannerWithReason": "On hold — {{reason}}"
},
"columnGroup": { "on_hold": "On hold", "external_review": "External confirm" }
```
(en의 internal reviewing 계열 기존 라벨과 겹치지 않도록 "External review" 대신 **"External confirm"** 채택.)

### displayStatus / 칸반

- `taskLabel.ts:28-47 displayStatus`: **on_hold·external_review를 completed/canceled처럼 조기 반환** — 보류된 미ack 요청 업무가 `task_requested` 가상 상태로 둔갑하는 회귀 차단(L33 분기보다 앞).
- `STATUS_CODES`·`QTalk/types.ts TaskStatus`에 2코드 추가.
- 칸반(all/workspace 뷰): '외부컨펌중' 컬럼(진행중 뒤), '보류' 컬럼(완료 앞). mine/week 뷰는 on_hold 제외 원칙이라 컬럼 미추가, external_review 컬럼만 추가. 빈 컬럼 자동 숨김(기존 `visibleCols`) 활용.

### 사유 저장

`tasks.hold_reason`(현재값) + `TaskStatusHistory.note`(영구 이력 — 타임라인에 "보류 — {사유}" 표시). 해제 시 컬럼만 초기화.

---

## 6. 마이그레이션 절차 (CLAUDE.md 고위험 3번 — 운영 배포 시 Fable 배포 게이트 필수)

### 신규 스크립트 `dev-backend/scripts/migrate-task-hold-status.js` (멱등)

```sql
-- ① ENUM 확장 — 기존 8값 순서 보존 + 끝에 append (MySQL 8: 끝 추가는 INPLACE 메타데이터 변경, 무중단)
ALTER TABLE tasks MODIFY COLUMN status
  ENUM('not_started','waiting','in_progress','reviewing','revision_requested',
       'done_feedback','completed','canceled','on_hold','external_review')
  NULL DEFAULT 'not_started',
  ALGORITHM=INPLACE, LOCK=NONE;
-- ② 보조 컬럼 (information_schema 존재 검사 후)
ALTER TABLE tasks ADD COLUMN hold_prev_status VARCHAR(30) NULL;
ALTER TABLE tasks ADD COLUMN hold_reason VARCHAR(500) NULL;
```

- 멱등 조건: 실행 전 `SHOW COLUMNS FROM tasks LIKE 'status'`로 이미 10값이면 skip, `hold_*` 존재하면 skip. **apply → 재실행 → 변경 0 실측** (memory `feedback_mysql_json_key_reorder` 패턴).
- Null 정책: 현 DDL이 `Null: YES`이므로 그대로 보존 (NOT NULL 승격은 이번 건 스코프 밖).
- ENUM 값 **중간 삽입·순서 변경 절대 금지** — 테이블 리빌드 + 기존 행 인덱스 재매핑 리스크.

### 배포 순서 (무중단 판정)

1. **DB ALTER 먼저** — 옛 백엔드는 새 ENUM 값을 절대 쓰지 않으므로 안전.
2. 백엔드 배포 + `pm2 restart planq-dev-backend`.
3. 프론트엔드 빌드 (`run_in_background: true`, heap 4096).

역순 금지: 새 백엔드/프론트가 옛 ENUM에 `on_hold`를 쓰면 MySQL truncation 에러(strict) → 저장 실패.
sync-database.js: dev에서는 model.sync alter가 ENUM을 맞출 수 있으나 **운영은 수동 스크립트가 정식 경로** (64키 한도 memory `feedback_sync_alter_too_many_keys`).

### 롤백

1. 코드 revert (backups/{TIMESTAMP}).
2. 잔존 행 정리: `UPDATE tasks SET status = COALESCE(NULLIF(hold_prev_status,''),'in_progress'), hold_prev_status=NULL, hold_reason=NULL WHERE status IN ('on_hold','external_review');`
3. ENUM 원복 ALTER는 선택 (새 값 잔존 무해 — done_feedback 전례).

---

## 7. 절단면 (Opus 구현 범위 — 이 밖을 수정하면 구현 게이트 FAIL)

### 수정 대상 (백엔드 10)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `models/Task.js` | ENUM 2값 append + `hold_prev_status`·`hold_reason` 컬럼 + 주석 |
| 2 | `services/taskTransition.js` | `canEnterStatus(taskId, toStatus, { fromStatus })` 확장 — on_hold/external_review 진입 매트릭스 단일 원천. `HOLD_FROM`·`EXTERNAL_FROM` 상수 export |
| 3 | `services/actions/task_actions.js` | ① `recalcStatusFromReviewers` L102 조기반환 목록 += on_hold·external_review (방어) ② 신규 액션 `hold(task,actor,{reason})`·`resume(task,actor)` — hold_prev_status 세팅/복귀·logHistory(신규 event_type `hold`/`resume`)·syncFocusOnTaskStatus·broadcastTask·notify·audit ③ submitReview/complete에 `task_on_hold` 가드 ④ revertStatus가 on_hold로 되돌릴 땐 hold_prev_status=현재 status 세팅 |
| 4 | `routes/task_workflow.js` | `POST /:id/hold`·`POST /:id/resume` 라우트 (파싱→actor→액션 호출만, 기존 패턴) |
| 5 | `routes/tasks.js` | ① PUT: status='on_hold' 진입 시 hold_prev_status/hold_reason 세팅, on_hold 이탈 시 초기화 ② canEnterStatus에 fromStatus 전달 ③ L877-886 progress↔status 자동 sync를 on_hold·external_review에서 정지 (진행률 100 입력이 보류를 소리없이 completed로 만드는 회귀 차단) ④ L1083- notify 브랜치에 on_hold/external_review 추가 (§13) ⑤ L117 이번주 whitelist += external_review |
| 6 | `routes/dashboard.js` | L112 notIn += 'on_hold' |
| 7 | `services/stats.js` | funnel on_hold 키 + external_review→in_progress 매핑 |
| 8 | `services/reportUnitSnapshot.js` | in_progress 버킷 += external_review · blockers += on_hold (2곳씩) |
| 9 | `services/weeklyReviewSnapshot.js` | blockers += on_hold |
| 10 | `services/cue_context.js` | L78·110·261 상태 목록 += 2값 |
| 11 | `scripts/migrate-task-hold-status.js` | 신규 (멱등, §6) |

### 수정 대상 (프론트엔드 7)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 12 | `utils/taskLabel.ts` | STATUS_CODES·STATUS_COLOR·displayStatus 조기 반환 |
| 13 | `pages/QTask/QTaskPage.tsx` | statusOptionsFor 조건부 노출·주간 필터(992-1008)·이월(1247)·progress→status 로컬 sync(660-665) 가드·칸반 컬럼·필터 칩 |
| 14 | `components/QTask/TaskDetailDrawer.tsx` | statusOptionsFor·보류 배너·[보류]/[외부컨펌]/[해제] Secondary 버튼·인라인 사유 입력·타임라인 hold/resume 이벤트 라벨 |
| 15 | `pages/QProject/ProjectTaskList.tsx` | statusOptionsFor 동일 규칙 |
| 16 | `pages/QTalk/types.ts` | TaskStatus 타입 += 2값 |
| 17 | `locales/ko/qtask.json`·`locales/en/qtask.json` | §5 키 전량 |
| 18 | `pages/Insights/tabs/TasksTab.tsx` | funnel 보류 표시 (소규모) |

### 건드리지 않는다 (수정 시 FAIL)

- `services/taskActualHours.js` — **무변경이 설계다** (§3). 수정 diff 발견 시 즉시 FAIL
- `services/focusSync.js` — 무변경 (기존 enter/leave 로직이 자동 커버)
- `recurringTaskGenerator.js` · Cue executor(`cue_task_executor.js`) · 승인/반려 라운드 로직(approve/requestRevision/recalc 본체) · done_feedback 제거 · invoices/결제/증빙 일체 · 인증/권한 미들웨어 · FIELD_RULES 권한 집합 변경

---

## 8. 리스크 · 회귀 후보 (구현 게이트 검증 항목)

| # | 리스크 | 위치 | 방어 |
|---|--------|------|------|
| R1 | 보류 중 progress 100 입력 → reviewer 0이면 **자동 completed** (보류가 소리없이 완료됨) | `routes/tasks.js:877-886` + `QTaskPage.tsx:660-665` (양쪽) | 두 곳 모두 on_hold·external_review에서 auto-sync 정지. 반증 테스트 필수 |
| R2 | 보류된 미ack 요청이 `task_requested` 가상 상태로 표시 | `taskLabel.ts:33` | displayStatus 조기 반환 (§5) |
| R3 | funnel else-if 체인이 신규 상태를 **조용히 누락** → 통계 합계 ≠ 전체 | `services/stats.js:208-211` | 매핑 명시 + 합계=전체 검증 |
| R4 | recalcStatusFromReviewers가 on_hold를 리뷰 라운드로 오판 | `task_actions.js:102` | 조기반환 목록 추가. 실위험은 낮음(호출부가 전부 `inReviewRound` 가드 뒤) — 방어적 추가 + 검증 |
| R5 | revert-status(#10)로 on_hold 재진입 시 hold_prev_status 미설정 → resume이 fallback(in_progress)으로만 감 | `task_actions.js:814-834` | revert가 on_hold로 갈 때 prev 세팅 (절단면 #3-④) |
| R6 | client-server 주간 필터 불일치 (서버는 제외했는데 클라 필터 `return true`가 보류를 살림) | `tasks.js:117` vs `QTaskPage.tsx:1008` | 양쪽 동시 수정 + 2탭 실측 |
| R7 | notify 누락 (§13 박제) — 보류/해제/외부컨펌 전이가 PushLog 0 | PUT notify 브랜치 + 신규 액션 | 전이 → sleep 3s → push_logs row ≥1 실측 |
| R8 | broadcast 누락 (§16) — 다른 탭에서 보류가 안 보임 | 신규 액션이 액션 계층 경유하면 broadcastTask 자동 | 2탭 실측 (A 보류 → B 즉시 뱃지 변경) |
| R9 | 배포 순서 역전 → PUT 'on_hold' 저장 실패 (truncation) | §6 | DB ALTER 선행 강제 |
| R10 | 옛 데이터 | — | 영향 0 (기존 행 무변경, 신규 값만 추가). 운영 배포 후 옛 task 1건 sample 조회 검증 |
| R11 | 보류 중 컨펌자 액션 — approve가 상태를 되살리는가 | `task_actions.js:676,726` | 기존 `not_reviewing` 가드로 차단됨 — **반증 테스트로 확인** (403/400 응답 실측) |
| R12 | e2e/가드 스크립트 — 신규 버튼 `data-testid` 누락 | §17 하니스 | `task-hold`, `task-resume`, `task-external` testid 부여 |

### 구현 게이트 PASS 조건 (실HTTP)

1. 로그인 → in_progress task 보류(사유 포함) → 재조회: status=on_hold, hold_prev_status=in_progress, hold_reason 일치, history row(event hold)
2. resume → status가 정확히 prev로 복귀 + hold 필드 NULL
3. reviewing task 보류 → resume → reviewing 복귀 / reviewer 전원 제거 후 resume → in_progress fallback
4. 보류 중 submit-review·complete → 4xx `task_on_hold` / 컨펌자 approve → `not_reviewing`
5. actual_hours 보류 구간 미누적 실측 (§3)
6. 이번 주 목록에서 on_hold 소실·external_review 잔존 (서버 응답 기준)
7. member(비담당·비작성자)의 보류 시도 → `forbidden_fields:status` 403
8. 마이그레이션 스크립트 2회 실행 → 2회째 변경 0
9. `npm run build` EXIT 0 + i18n 하드코딩 grep 0 + health-check 통과

---
*설계 근거 실측 파일: models/Task.js · services/taskActualHours.js:58-70 · services/focusSync.js:24-41 · services/taskTransition.js:44-54 · services/actions/task_actions.js:99-126,574-659,805-849 · routes/tasks.js:97-117,780-1121 · routes/dashboard.js:110-176 · services/stats.js:205-289 · reportUnitSnapshot.js:67-190 · weeklyReviewSnapshot.js:466 · cue_context.js:78,110,261 · taskLabel.ts 전체 · QTaskPage.tsx:660-665,921-1008,1247,2160-2210 · TaskDetailDrawer.tsx:145-152 · ProjectTaskList.tsx:36-43 · projects.js:174-178 · dev DB DDL/분포 실측 2026-07-26*
