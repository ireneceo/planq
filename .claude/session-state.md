# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-28 06:40 (Opus 5, 1M)
**작업 상태:** 진행 중 (SSH 2회 끊김 후 재개). **dev 반영 완료 / 운영 미배포**

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점 (06:40 갱신)

**완료 (전부 Fable 게이트 PASS · dev 반영 · 운영 미배포):**
- **Q Task 팝아웃 체크박스 완료처리 + 우선순위 표시** — 커밋 `4ce3950` + tie-break 수정 `074cce6`.
  Fable 게이트: 실HTTP 36 PASS(반증 시나리오 4·5·7 포함) → 우선순위 tie-break 1건 조건부 → 수정 후 재게이트 PASS(번호 매핑 13/13)
  - 남은 판단거리(Irene): 메인은 컨펌대기 남의 업무도 우선순위 번호에 세지만 my-week API 는 제외 → 그런 업무 있으면 팝아웃 번호가 밀림(실측 5건). API 절단면이라 별도 사이클
- **Q Note 녹음 보호 가드** — 커밋 `77786b7`.
  **Fable 게이트 1차 FAIL → 수정 → 재게이트 PASS.** health-check 33/33 · guard-invariants 22/22 · 실HTTP 락 11/11 · 빌드 error TS 0
  - 내용: 녹음 끊는 경로(재클릭 토글·openReview·새 메모·음성 모달·**세션 삭제**)에 ConfirmDialog 게이트,
    방향키 nav 녹음 중 차단, **heartbeat 대상 세션을 락 획득 시점에 고정**(`recordingSessionIdRef` — 녹음 중 새 메모 생성만으로
    409 나 녹음이 죽던 실버그, 실HTTP 로 재현 입증), release 3경로 ref 통일, **PWA 새 빌드 자동 reload 차단**
    (`body.dataset.recordingActive` + `BuildVersionGuard.isReloadSafe`), StartMeetingModal 사용언어 프리필 + 유령 초안 제거

**바로 다음 작업 (순서대로):**
1. **Irene 신규 요구 2건** (아래 ⚠️ 섹션) — 핀 아이콘 위치 변경 + 핀 창 닫힘 안내 오작동 (Fable 재설계 필요)
2. `/배포` 는 Irene 명시 지시 후에만 (누적 미배포: `fa1766a` 팝아웃 + `4ce3950` 체크박스/우선순위 + `77786b7` Q Note 녹음 가드 + `074cce6` tie-break)

---

## ⚠️ Irene 신규 요구 2건 (미착수 — 재개 시 먼저 판단)

1. **핀 아이콘을 도크 메뉴에서 빼고, 팝아웃 창에 들어가면 상단에 나오게**
   - 현재: 도크 "열기" 각 항목 우측 핀 버튼(`dock-pin-<tool>`)
   - 요구: 도크에서 제거 → 팝아웃 창 헤더 상단에 핀 버튼
   - **기술 제약(Fable 설계 판정)**: Document PiP `requestWindow` 는 **그 문서 안의 사용자 제스처**가 필요.
     팝아웃(별도 창) 안에서 누른 클릭은 opener 로 전이되지 않아 postMessage 위임 불가.
     팝아웃이 스스로 PiP 를 열면 자기가 owner 인데 **자신을 닫으면 PiP 도 죽는다**.
     → 그래서 최초 설계가 "메뉴에서 핀으로 열기" 였다. **이 요구는 절단면 재설계가 필요 —
     Fable 에 다시 올릴 것.** (후보: 팝아웃 창 상단 핀 버튼 → 그 창이 자신을 PiP 로 "승격"하되
     자기 창을 닫는 대신 유지/전환하는 방식이 실제로 가능한지 스파이크 필요)
2. **핀 창을 닫으면 "닫혔다"는 안내가 뜬다**
   - 증상 보고: 사용자가 직접 닫아도 `dock-pin-lost` 카드("… 핀 창이 닫혔습니다 / 다시 열기")가 노출
   - 원인 추정: `utils/pinnedWindow.ts` 의 `intentional` 플래그는 **우리 UI 의 핀 해제**만 표시한다.
     브라우저 PiP 창의 **네이티브 X 버튼**으로 닫으면 `intentional=false` → "예기치 않은 닫힘" 으로
     오판 → 자동 승격(일반 창) + 안내 카드. **사용자 의도 닫힘을 구별할 신호가 없다**는 게 근본 문제.
   - 재개 시: 자동 승격 자체를 없애고 "닫으면 그냥 닫힌다"로 갈지, 화면공유 케이스만 구제할지 결정 필요 → Fable

---

## 📐 체크박스 완료처리 — Fable 설계 확정본 (그대로 구현할 것)

**판정: 조건부 승인.** Opus 초안의 3분기를 **5분기로 수정**해야 통과. 그대로 만들면
`canceled → completed 뒤집힘` · `컨펌 라운드 파괴` 2건의 실사고 경로가 열린다.

### 백엔드 (승인)
- `routes/tasks.js` my-week 에 `reviewer_count` 추가.
  **`attributes: { include: [[literal('(SELECT COUNT(*) FROM task_reviewers WHERE task_id = \`Task\`.\`id\`)'), 'reviewer_count']] }`**
  형태 필수 — my-week `findAll` 은 attributes 옵션이 없어(전 컬럼) 배열 나열로 쓰면 기존 컬럼이 날아간다.
- 소비자 영향 0 (`QTaskPage.tsx:521` 은 capacity/burndown 만 읽음). 프론트 `Number()` 방어 캐스팅.
- **★ 같은 커밋에 1줄 가드**: `task_actions.js complete()` 에
  `if (['completed','canceled'].includes(task.status)) return fail('task_closed')`.
  현재 `complete()` 는 on_hold 만 막고 **closed 가드가 없다**(`:637`). my-week 는 canceled 를 포함한다(`tasks.js:106`).

### 프론트 분기표 (my-week 실제 등장 상태 기준)
| 행 상태 | reviewer 0 | reviewer ≥1 |
|---|---|---|
| not_started/waiting/in_progress/external_review | ☐ → `/complete` | **in_progress·revision_requested 만** ↻ → `/submit-review`, 그 외 퀵액션 없음 |
| reviewing | (발생 불가) | "확인 중" 표시만 — **액션 금지** |
| revision_requested | ☐ → `/complete` | ↻ 재요청 |
| completed | ☑ → `/revert-status` | **☑ 고정(disabled)** + 툴팁 "컨펌으로 완료됨 — 되돌리기는 상세에서" |
| canceled | 인터랙션 없음 | 인터랙션 없음 |

**왜 이렇게:**
- `reviewing` 에서 submit-review 재호출 = **새 라운드 시작 + 전 컨펌자 pending 리셋**(`taskTransition.js:123-127`) → 받은 승인 증발
- 컨펌 승인 완료 업무에 `revert-status` 하면 마지막 from_status 보유 row 가 `review_submit` 이라
  **reviewing 이 아니라 in_progress 로 떨어진다**(`:822-829`). `canEnterStatus` 는 비리뷰 상태라 통과 → 게이트가 안 막는다.
  reviewer state 는 'approved' 로 남아 이력과 모순, 재체크하면 라운드 파괴. → 언체크는 **reviewer_count===0 만**
- **`on_hold` 분기는 죽은 코드** — my-week 가 on_hold 를 의도적으로 제외(`tasks.js:118`). 대신 **`external_review` 가 포함**됨(`:119`)
- **구조 함정**: 현재 `Row` 가 `styled.button`(`TaskPopoutView.tsx:291`) → 체크박스 넣으면 button-in-button.
  **Row 를 div 로 바꾸고** 체크박스 버튼 + 본문 클릭영역을 형제로 분리해야 한다 (stopPropagation 만으론 부족)
- notify/socket broadcast 는 **액션 계층이 이미 전부 처리** — 신규 백엔드 작업 0
- 팝아웃은 별도 창이라 `window.dispatchEvent('inbox:refresh')` 는 메인 창에 안 닿는다(창 간 동기화는 socket 담당)
- 중간 상태 건너뛰기(not_started → 바로 완료)는 **허용**이 정책 (`canEnterStatus` 는 completed 진입 무제한)

### e2e 검증 시나리오 13종 (Fable 지정 — 구현 후 전부 실 HTTP)
1 reviewer0·in_progress→체크→completed+completed_at+history+의뢰자 push / 2 not_started→체크→completed(from='not_started')
/ 3 reviewer≥1·in_progress→↻→reviewing·전원 pending·컨펌자 push·**completed 아님** / 4 reviewing→액션 없음(반증: 직접
호출 시 round 증가 입증) / 5 컨펌완료→체크 고정·클릭 무반응(반증: 직접 revert 하면 in_progress 로 떨어짐 실측)
/ 6 reviewer0·completed→언체크→직전 복귀+history 'revert' / 7 canceled→무반응(반증: 직접 POST → 400 task_closed)
/ 8 타 사용자 토큰 → 403 only_assignee / 9 더블클릭 → 요청 1회 / 10 타 창 hold 후 체크 → 400 인라인+행 소멸
/ 11 체크박스 클릭이 드로어 안 열림 + button 중첩 0 / 12 2창 동기화 ≤1초 / 13 빌드 exit 0 + reviewer_count 실측

---

## 📦 이번 세션 작업 요약

- **Q Task 팝아웃 신설** — 도크 순서 Q Talk→**Q Task**→Q Note→Q helper. `/task-popout` 전용 경량 뷰
  (`TaskPopoutView.tsx`, 기존 my-week API 재사용, 백엔드 변경 0) + §16 실시간 4요소 + 드로어 연동
- **핀(항상 위) 신설** — Document PiP. 기본은 일반 창, 핀은 opt-in **동시 1개**(전환 시 이전 핀 일반 창 강등).
  **#44 커서 포커스 스파이크 통과가 착수 조건**이었고 현재 Chrome 재현 0(한글 IME 포함, headless+headful)
- **★ Fable 이 잡은 결함** — 강등 `window.open` 이 transient activation 을 소모해 직후 `requestWindow` 가
  `NotAllowedError`. **순서를 뒤집어**(requestWindow 먼저) 수정. 되돌리면 다시 깨짐까지 반증
- **메모 팝아웃 PiP 잔재 제거** — 2026-06-16 전환 때 `MemoPopup.detachToWindow` 만 누락돼 홀로 PiP 였던 것
  (회의 중 화면공유 시작하면 메모 창 소멸). `MemoStandalonePage` 마커 누락도 보완
- **★ i18n 검사 명령 거짓 통과 수정** — CLAUDE.md·/검증 의 역참조 grep 은 **ugrep 에서 항상 0건**.
  정본을 `node scripts/guard-invariants.js --category=i18n` 으로 교체. 반증 완료(옛 grep 0건 / 가드 FAIL / 대안 grep 1건)

**커밋:** `fa1766a` feat(dock): Q Task 팝아웃 신설 + 팝아웃 핀(항상 위) + 메모 PiP 잔재 정리 (**push 안 함 — 로컬**)

---

## ⚠️ Irene 조치 대기 (코드로 못 하는 것)

1. **약관·처리방침 개정 공지 — 마감 `2026-08-03`** (시행 `2026-08-10` 의 7일 전). 절차
   `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md` §2·§3. 현행 문안 그대로, 읽음 추적 조항 없이.
   또 넘기면 시행일을 공지일+7일 이후로 재연기(tsx 2줄). `terms_version`/`privacy_version` 은 올리지 않는다.
2. **구글 캘린더 재연동** — planq.kr → 설정 → 파일·외부 연동 → Google Calendar 해제 후 재연결.
   동의 화면에서 캘린더 체크박스 필수(미체크 시 저장 거부되도록 이미 수정됨).
3. **별칭 등록 시 Gmail Send-as 동반** — 안 하면 Gmail 이 조용히 From 을 본계정으로 치환. 운영 별칭 현재 0건.
4. **Google OAuth 앱 검증 제출** — 1·2 의 근본 원인(미검증 Testing 상태).
5. **Stripe 키 입력** · **회사 영문명 확정**

---

## 📂 다음 할 일

1. **체크박스 완료처리 구현** (위 설계 확정본) → Fable 구현·테스트 게이트
2. **Irene 신규 요구 2건** (핀 아이콘 위치 / 핀 닫힘 안내) — Fable 재설계 필요
3. `/배포` (누적 미배포: `fa1766a` 팝아웃 사이클 + 이후 체크박스)
4. **★ 시간 엔진 라운드 경계 결함** (미해결, 운영 데이터 오염) — `services/taskActualHours.js:46` 이
   `event_type='status_change'` 만 집계. 액션 계층의 `review_submit`·`review_cancel`·`approve`·`revision`·
   `revert`·`completed` 는 고유 타입이라 탈락 → 라운드 미마감. 운영 실측: task 24 저장 153.6h vs 실제 2.2h ·
   task 53 0h vs 67.7h. **수정 방향: `to_status IS NOT NULL` 술어로 교체 + 멱등 백필**(dry-run 기본)
5. **이월 결함 6건** — EventDrawer 죽은 i18n 키 폴백 · EventDrawer 가 연결 안 된 목적지도 항상 표시 ·
   PUT `/mail` owner 미강제 · PWA 설치 배너 `role="dialog"`(§17 위반) · `routes/calendar.js:604` 죽은
   `needsGcalSync` · serializer `has_access_token` 3필드 항상 false
6. **KbDocument sync 실패** — `kb_documents.project_id INT` vs `projects.id BIGINT` FK 타입 불일치
7. **#208** 출퇴근·휴가(신규, Fable 기획설계부터) · **#211** B2B 타깃 · **#192** AiRefineBar · **#193** 캘린더 뒤로가기

---

## 🔑 환경 / 인증

- 운영 = `irene@87.106.78.146` (planq.kr, port 3004, `/opt/planq/backend`, DB `planq_prod_db`). SSH passwordless.
  **배포 외의 운영 접근은 조회만.**
- **배포 정본: `./scripts/deploy-planq.sh --auto`** — **반드시 `nohup` 분리 실행**(타임아웃 걸면 부분 배포).
  완주 표시는 `Deployment Complete (NNNs)`. 백업 `backups/{TIMESTAMP}` + 롤백 명령을 끝에 출력.
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. **가드/e2e 는 `cd /opt/planq` 루트**.
- dev 테스트 계정: `health-check@planq.kr` / `HealthCheck2026!` (business 5·73 owner). 토큰 = `data.token`. rate-limit 15분 8회.
- 업무 라우트: PUT/DELETE 는 `/api/tasks/by-business/:businessId/:id` — `/api/tasks/:id` 는 404.
  워크플로 전이는 `/api/tasks/:id/{complete,submit-review,revert-status,...}` (task_workflow.js).
- 프론트 타입체크는 `npm run build` 로만(heap 4096). `npx tsc` 는 OOM.
- **i18n 검사는 `node scripts/guard-invariants.js --category=i18n` 으로만** (역참조 grep 은 거짓 통과).
- dev 는 `EMAIL_SENDING_ENABLED=false` — Q Mail 발송도 이 게이트를 지나며 `suppressed` 로 기록된다.
- 스파이크/검증 스크립트: 세션 scratchpad `/tmp/claude-1000/-opt-planq/f6ca33a1-*/scratchpad/`
  (`spike-pip-focus.js`, `verify-task-popout.js`) — **세션 종료 시 소멸**. 필요하면 재작성.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · memory `feedback_fable_all_design_verification`
- 설계 문서: `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md` · `docs/TASK_HOLD_UI_UX_DESIGN.md` · `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md`
