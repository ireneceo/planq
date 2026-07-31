# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-31 14:00 (Opus 5, 1M)
**작업 상태:** **운영 배포 완료** (commit `cbee3ac`, 20260731_134458). 후속 백필·시드까지 끝.
다음: 운영 피드백 #242(Meet 자동생성 실패) 수정 — Fable 설계 게이트 진행 중.

### 🚀 2026-07-31 운영 배포 (9커밋)
`Deployment Complete (208s)` · 백업 `/opt/planq/backups/20260731_134458` · health ok · PM2 3개 online ·
청크 13:48:16 · nginx reload 완료. (exit 1 은 알려진 부수 신호, "에러 1건"은 ENUM 값 `'failed'` 문자열 오탐)
- **actual_hours 백필 적용** — dry-run 이 Fable 예측 6건과 정확히 일치 → apply → **재실행 0건(멱등)**.
  task 24 **153.6h→0.0h** · 115 6.0→6.1 · 141 0→0.5 · **user 42건 전부 보존** · 24h 초과 잔존 0.
  백업 `backend/backups/actual-hours-backfill-1785505742798.json`
- **운영 위키 시드** — 카테고리 14 · 문서 41 · 임베딩 인덱싱 완료
- **운영 smoke** — KB project_id bigint + FK 2개 · `has_access_token` 이 운영 실데이터 2건에서 **true**
  (dev 는 연결 0건이라 못 보던 케이스) · 토큰 원문 미노출 · history 515행 보존

### 📋 운영 피드백 점검 (2026-07-31, 미처리 54건 = pending 52 + reviewing 2 / 총 243건)
분류: **버그 18 · UX 개선 7 · 신규 기능 19 · 콘텐츠·정책 10**. 영역별로는 **Q Mail 19건**이 최다, Q Task 8, 캘린더 5.
- **#242 (최우선, 원인 규명 완료)** — Meet 자동생성 시 일정 자체가 안 만들어짐. **3중 결함**:
  ①운영 워크스페이스 1 토큰이 `userinfo.email openid` 뿐이라 `hasWriteScope()=false`
  ②`/video/status` 의 `gcal_connected` 가 **토큰 존재만** 보고 true → 프론트가 Meet 체크박스 노출
  ③`event_actions.js:107-129` 가 Meet 실패 시 **트랜잭션 통째 롤백**.
  ★같은 파일 213-221 의 일반 push 는 best-effort 라 **한 파일 안에서 실패 정책이 정반대**
- 나머지 53건은 `/tmp` 점검 목록 참조 — 다음 사이클에서 우선순위대로

### 이번 세션 추가분 (2026-07-31 오후)
- **`44b05c4` 이월 결함 5건** — sanitize() 의 has_* 3필드가 delete 뒤에 계산돼 **항상 false**(계약 위반) ·
  EventDrawer 가 **연결 안 된 구글 캘린더 목적지 토글**을 항상 노출(NewEventModal 은 이미 게이트 중이었음) ·
  `t('button.share')` 키 부재로 **영어 사용자에게 한국어 '공유'** 노출 · PWA 배너 role="dialog"→complementary(§17) ·
  죽은 `needsGcalSync` 제거(기능은 calendarSync.reconcile 이 담당, 살아 있음).
  ※ 이월 목록의 "PUT /mail owner 미강제" 는 **오기록** — 코드가 이미 403 을 낸다.
- **`c4c5fb3` 시간 엔진 재설계 (Irene 승인)** — status 경과시간 자동 누적 **폐기**.
  actual_hours 자동값 = **포커스 실측만**. 사용자 직접 입력은 불변.
  Fable 설계 게이트가 내 초안(D1: to_status IS NOT NULL 로 경계 수정)을 **기각**했다 —
  경계를 고쳐도 task 53 이 0h→67.7h(밤 2번 포함 경과시간)로 **새 거짓을 쓴다**.
  또 훅 조건을 넓히면 **락 지뢰**를 밟는다(tasks X-lock 트랜잭션 밖에서 같은 행 UPDATE → 최대 50초 정지).
  → afterCreate 훅 통째 삭제로 지뢰 근본 소멸. hold 28ms/resume 15ms 실측.
  백필 `scripts/backfill-actual-hours-drop-status-fallback.js` (dry-run 기본/--apply/--restore).
  **운영 백필 미실행** — 코드 배포가 먼저다(옛 훅 생존 시 재오염). 예측 6건: task 5·6·13·24·115·141.

### 다음 접촉 시 정리 (Fable 이 비차단으로 남긴 것)
- `task_actions.js` resume() 주석의 "라운드 재개 경계가 시간 엔진에 보여야 한다" 문구가 이제 옛 근거
- `TaskDetailDrawer.tsx:455` 주석에 옛 함수명 `recomputeActualHoursFromHistory` 잔존(프론트 무변경 원칙으로 미수정)
- **KbDocument FK** — 운영은 이미 정상(bigint + FK + 고아 0). **dev DB 만 int 드리프트** + 없는 프로젝트 13 을
  참조하는 고아 2건(조회 구조상 이미 안 보임). 모델도 INTEGER 라 운영 실제와 어긋남 → 모델 BIGINT + dev ALTER 필요

---

## ✅ 이번 세션 (2026-07-31) — 핀 요구 2건 구현

전 세션 Fable 설계 게이트의 지시서대로 **홀더 창 방식**을 구현했다.

- **신규 `utils/pinHost.ts`** — `usePinHost(tool)` → mode `normal|holder|pip-content`. 핀 클릭 시 그 팝아웃 창이
  자기 PiP 를 열고 자신은 360×132 홀더로 변신(`window.open` 0회). `BroadcastChannel('planq:pin')` 로
  `pin-intent` 선공지 → ack/250ms → `requestWindow`. 축출은 pagehide 가 없어 500ms `closed` 폴링.
  `POPOUT_SIZE`/`popoutFeatures()` 를 **창 크기 단일 원천**으로 두고 RightDock 이 그걸 쓴다.
- **신규 `PopoutPinButton.tsx`**(32×32, `popout-pin-toggle`) + **`PinHolderView.tsx`**(`pin-holder`/`pin-holder-unpin`)
- **`utils/pinnedWindow.ts` 삭제** · RightDock 핀 전부 제거(`dock-pin-*` 0건) · `dock.pin*` 5키 → `popoutPin.*` 6키
- **핀 버튼 배치는 지시서와 다르게** 갔다 — "우상단 fixed 36×36" 자리에 이미 각 도구 헤더 버튼이 있어 겹친다.
  각 헤더 액션 영역에 `pinSlot` prop 주입 + 이웃과 같은 32×32. 건드린 공유 컴포넌트는
  `LeftPanel`·`MemoPopup`·`CueHelpDrawer` (전부 optional prop, 기존 사용처 무변경). **Fable 승인됨**

### 검증 중 발견해 같이 고친 실결함 3건
1. **`supportsPin()` 이 팝아웃에서 항상 false** — 모바일 판정에 `max-width:768px` 를 쓰는데 팝아웃 창 자체가
   520px 라 데스크탑에서도 참. `(hover: none),(pointer: coarse)` 로 교체 (핀 버튼이 영영 안 뜰 뻔)
2. **ConfirmDialog 가 MemoPopup 뒤에 깔림** — z-index 2100 vs 2301. Q Note 팝아웃에서 녹음 중 핀 누르면
   확인창이 안 보여 **무반응처럼 보였다**. ConfirmDialog 에 `zIndex` prop 신설(기본 2100 유지, 호출부만 2400)
3. **QTalk 팝아웃에서 대화 바꾼 뒤 핀하면 옛 대화가 열림** — embedded 는 URL 싱크를 끄므로 iframe.src 가 stale.
   `onEmbeddedContextChange` prop → 호스트가 `history.replaceState` 로 자기 URL 만 갱신(navigate 금지 유지)
4. **(Fable FAIL 지적)** close 거부 환경 홀더 고착 — 주소창에 `/task-popout` 직접 친 탭은 `window.close()` 가
   거부돼 홀더가 거짓 안내로 남고 해제 버튼도 무반응(`releasePip` 이 pipRef null 로 조기 return) → F5 외 탈출 불가.
   `onPipGone` 에 200ms 후 `window.closed` 확인 → 미닫힘이면 일반 창 복귀 분기 추가

### 검증 결과 (xvfb + headful puppeteer, Document PiP 는 headless 불가)
- `verify-pin.js` **16/16** · `verify-pin-2.js` 3/3(녹음 게이트·모바일 미노출) · `verify-pin-3.js` 3/3(대화 싱크)
- **반증 2종** — ①선공지(BroadcastChannel) 무력화 시 홀더가 축출과 함께 소멸(4c PASS 의 근거가 선공지임을 증명)
  ②홀더 자살 무력화 시 창 잔존(3b 판정이 실상태를 본다는 증명)
- 가드 22/22 · health-check 33/33 · 빌드 exit 0 / `error TS` 0 / dist mtime 갱신 확인
- 하니스 자체의 거짓 PASS 를 2번 잡았다 — ①`[role="dialog"]` 로 확인창을 찾다 MemoPopup 을 잡음(공용 Modal 은
  `role`/`aria-modal` 이 없다) ②도크 FAB 클릭 빗나가도 "dock-pin 0건" 으로 통과

### 남는 리스크
- 프로토콜 밖 축출(화면공유 강제종료)은 여전히 구별 불가 — 다만 위 4번 복구 분기가 이 경로도 구제한다
- 공용 `Modal` 에 `aria-modal="true"` 가 없다 (CLAUDE.md §17 위반, **이번 범위 밖** — 하니스 모달 스코핑이 안 된다)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 지난 세션 완료 (2026-07-28, 전부 Fable 게이트 통과)

1. **Q Task 팝아웃 체크박스 완료처리** — `4ce3950`. Fable 설계 게이트가 3분기 초안을 **5분기로 교정**
   (그대로 만들면 `canceled → completed` 뒤집힘 · 컨펌 라운드 파괴 2건 실사고 경로). 실HTTP 36 PASS.
   `task_actions.complete()` closed 가드 1줄 추가(여태 on_hold 만 막았음)
2. **팝아웃 우선순위 번호 tie-break 동기화** — `074cce6`. 메인 `displayPriorityMap` 의 실효 사슬
   (priority → 완료 뒤로 → due null-last → title) 복제. 재게이트 번호 매핑 13/13 + 수정 전 불일치 반증
3. **Q Note 녹음 보호 가드** — `77786b7`. Fable 1차 **FAIL**(삭제 경로·PWA reload) → 수정 → PASS.
   녹음 끊는 5경로 ConfirmDialog + **심박 세션 락 획득 시점 고정**(`recordingSessionIdRef`) +
   **`body.dataset.recordingActive`** 로 새 빌드 자동 reload 차단(배포마다 녹음 사망하던 경로) +
   락 반납 3경로 ref 통일 + StartMeetingModal 사용언어 프리필/유령 초안 제거
4. **my-week 집합을 메인 weekSet 과 동기화** — `d35e530`(wip, 정리 필요). Fable 설계 게이트 결정:
   번호 차이 원인은 tie-break 이 아니라 **집합 차이**. reviewer pending 분기 + involved-completed 분기 +
   `reviewers` include 추가, **집계(번다운·요약)는 담당자-only `mine` 고정**, 팝아웃 `quickActionFor` 에
   `isAssignee` 게이트. 구현 검증 e2e 7종 PASS
5. **★ 실버그 수정 (Fable 이 조사 중 발견)** — 메인의 우선순위 번호·DB 자동 재인덱스·토글이
   **search/statusFilter/완료가리기가 적용된 `filtered`** 를 입력으로 써서, week 탭에서 검색어만 입력해도
   매칭 부분집합 기준으로 `priority_order` 를 silent PUT 재작성 → 검색 밖 업무와 충돌하는 데이터 오염.
   번호 정본을 canonical `weekSet` 으로 분리 + tie-break 을 `byPriorityChain` 명시 함수로 고정
6. **위키 갱신** — `record-meeting`(녹음 중 확인 창) · `focus-weekly`(팝아웃 체크박스·우선순위) ko/en. 시드 반영 완료

---

## 🔖 구현 완료 — 핀 요구 2건 (설계·구현 모두 종료)

설계 지시서 전문은 커밋 이력과 `utils/pinHost.ts` 상단 주석에 박제돼 있다. 실측으로 확정된 물리 제약:
팝아웃→opener transient activation 전이 불가 · 팝아웃은 자기 PiP 를 열 수 있고 그 창을 닫으면 PiP 도 죽음 ·
PiP 소유 창이 SPA 네비게이션해도 PiP 생존 · PiP 는 브라우저 전역 1개이고 **축출 시 pagehide 미발화**(500ms 폴링) ·
닫힘 신호는 pagehide 1회뿐 원인 정보 0.

## 📂 다음 할 일

1. **`/배포`** — Irene 명시 지시 후에만. 누적 미배포: `fa1766a` 팝아웃 신설 · `4ce3950` 체크박스/우선순위 ·
   `77786b7` Q Note 녹음 가드 · `074cce6` tie-break · `dd760cf` my-week 집합 확장 · **핀 홀더 창(이번 세션)**.
   **배포 후 운영 위키 시드 필요**
   (`ssh prod "cd /opt/planq/backend && node seed-wiki-content.js"`)
3. **★ 시간 엔진 라운드 경계 결함** (미해결, 운영 데이터 오염) — `services/taskActualHours.js:46` 이
   `event_type='status_change'` 만 집계. 액션 계층의 `review_submit`·`review_cancel`·`approve`·`revision`·
   `revert`·`completed` 는 고유 타입이라 탈락 → 라운드 미마감. 운영 실측: task 24 저장 153.6h vs 실제 2.2h ·
   task 53 0h vs 67.7h. **수정 방향: `to_status IS NOT NULL` 술어로 교체 + 멱등 백필**(dry-run 기본)
4. **이월 결함 6건** — EventDrawer 죽은 i18n 키 폴백 · EventDrawer 가 연결 안 된 목적지도 항상 표시 ·
   PUT `/mail` owner 미강제 · PWA 설치 배너 `role="dialog"`(§17 위반) · `routes/calendar.js:604` 죽은
   `needsGcalSync` · serializer `has_access_token` 3필드 항상 false
5. **KbDocument sync 실패** — `kb_documents.project_id INT` vs `projects.id BIGINT` FK 타입 불일치
6. **#208** 출퇴근·휴가(신규, Fable 기획설계부터) · **#211** B2B 타깃 · **#192** AiRefineBar · **#193** 캘린더 뒤로가기

### 기록만 (사용자 영향 0, 다음 접촉 시)
- 제목·마감·priority 가 **전부 같은** 행끼리는 메인/팝아웃 번호가 바뀔 수 있다(시각적으로 구별 불가능한 행).
  총순서가 필요해지면 **양쪽에 id tie-break 을 동시에** 넣어야 한다 — 한쪽만 넣으면 도로 갈린다

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

## 🔑 환경 / 인증

- 운영 = `irene@87.106.78.146` (planq.kr, port 3004, `/opt/planq/backend`, DB `planq_prod_db`). SSH passwordless.
  **배포 외의 운영 접근은 조회만.**
- **배포 정본: `./scripts/deploy-planq.sh --auto`** — **반드시 `nohup` 분리 실행**(타임아웃 걸면 부분 배포).
  완주 표시는 `Deployment Complete (NNNs)`. 백업 `backups/{TIMESTAMP}` + 롤백 명령을 끝에 출력.
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. **가드/e2e/위키체크는 각자 정해진 cwd** —
  `wiki-coverage-check.js`·`seed-wiki-content.js` 는 **`cd dev-backend` 필수**(.env 로드), 가드는 `/opt/planq` 루트.
- dev 테스트 계정: `health-check@planq.kr` / `HealthCheck2026!` (business 5·73 owner). 토큰 = `data.token`. **rate-limit 15분 8회**.
- 업무 라우트: PUT/DELETE 는 `/api/tasks/by-business/:businessId/:id` — `/api/tasks/:id` 는 404.
  워크플로 전이는 `/api/tasks/:id/{complete,submit-review,revert-status,...}` (task_workflow.js).
- 프론트 타입체크는 `npm run build` 로만(heap 4096). `npx tsc` 는 OOM. **동시 빌드 금지**(같은 출력 디렉터리 덮어씀).
- **i18n 검사는 `node scripts/guard-invariants.js --category=i18n` 으로만** (역참조 grep 은 ugrep 에서 거짓 통과).
- Q Note 녹음 락 stale 판정은 문서의 30초가 아니라 **실측 12초** (`q-note/routers/sessions.py:328`).
- dev 는 `EMAIL_SENDING_ENABLED=false` — Q Mail 발송도 이 게이트를 지나며 `suppressed` 로 기록된다.
- **idle 자동저장 훅이 30분마다 wip 커밋을 만든다** — 작업 끝에 정식 커밋으로 정리할 것.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · memory `feedback_fable_all_design_verification`
- 설계 문서: `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md` · `docs/TASK_HOLD_UI_UX_DESIGN.md` ·
  `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md` · `docs/Q_WIKI_MAINTENANCE.md`
