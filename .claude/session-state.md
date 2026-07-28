# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-28 08:40 (Opus 5, 1M)
**작업 상태:** 완료 (Irene 이동). **dev 반영 완료 / 운영 미배포 (누적 5커밋)**

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (전부 Fable 게이트 통과)

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

## 🔖 지금 중단 지점 — 핀 요구 2건 (설계 확정, **구현 미착수**)

Fable 설계 게이트가 **지시서까지 완성**했다. 아래 그대로 구현하면 된다.

### 실측으로 확정된 물리 제약 (puppeteer, 재검증 불필요)
- 팝아웃 창 안의 클릭은 opener 로 transient activation **전이 불가** (클린 headful 3회 반복).
  ⚠️ 첫 스파이크의 "가능" 은 `--disable-popup-blocking` 플래그 + 직전 메인 클릭 잔여 activation 이 만든
  **거짓 양성**이었다 — 판정 기계부터 의심해 뒤집음
- 팝아웃이 자기 PiP 는 열 수 있고, **그 창을 닫으면 PiP 도 죽는다**
- **PiP 소유 창이 SPA 네비게이션해도 PiP 는 생존** ← 홀더 변신의 근거
- PiP 는 브라우저 전역 1개. **축출 시 `pagehide` 미발화** → 500ms `closed` 폴링 필수
- PiP 닫힘 신호는 pagehide 1회뿐, **원인 정보 0** (사용자 X vs 화면공유 kill 구별 불가)

### 결정 1 — 핀 버튼을 도크에서 팝아웃 헤더로 (홀더 창 방식)
핀 클릭 → 팝아웃이 PiP 를 열고 **자신은 360×132 홀더 창으로 변신**. 해제 시 원래 팝아웃으로 복귀
(`window.open` 0회 → 팝업차단·activation 순서 결함 계열 소멸).
- 신규 `utils/pinHost.ts` (`usePinHost(tool)` → mode `normal|holder|pip-content`), **`utils/pinnedWindow.ts` 삭제**
- 신규 `components/Common/PopoutPinButton.tsx` + `PinHolderView.tsx`
- `RightDock.tsx` 에서 핀 전부 제거 (`PinBtn`/`PinNote`/`PinLostCard`/`handlePin`/`pinned`/`pinLost`/`IconPin`/`PIN_SIZE`/`pq_pin_last_tool`)
- 4개 팝아웃 헤더에 핀 버튼: `TaskPopoutView`(Head 우측) · QTalk/NoteCapture/Help standalone(우상단 36×36)
- `data-testid`: `popout-pin-toggle` / `pin-holder` / `pin-holder-unpin`. 홀더에 `aria-modal` 금지
- 축출 프로토콜: `BroadcastChannel('planq:pin')` 로 `pin-intent` 선공지 → ack 또는 250ms 타임아웃 후 `requestWindow`
- NoteCapture 팝아웃은 `body.dataset.recordingActive==='1'` 중 핀 클릭 시 ConfirmDialog 게이트 (핀 전환 = 재로드 = 녹음 사망)
- i18n `common.popoutPin.*` ko/en 신규, `dock.pin`/`unpin`/`pinOnlyOne`/`pinClosed`/`pinReopen` 5키 삭제

### 결정 2 — "닫으면 그냥 닫힌다"
자동 승격 · `dock-pin-lost` 카드 · "다시 열기" **전면 삭제**. PiP 를 X 로 닫으면 홀더도 조용히 자살.
구별 가능한 **축출만** 선공지로 일반 창 복귀.

### 하지 말 것
메인 창에서 `requestWindow`/`markPipActive` 재도입 · 승격/강등용 `window.open` · postMessage 핀 위임(실측 불가)
· 닫힘 안내 카드/토스트 재도입 · `BuildVersionGuard`/`isReloadSafe` 로직 수정 · `MemoStandalonePage`·`utils/popout.ts` 변경

### 구현 검증 시나리오 (Fable 지정 8종, puppeteer)
1 핀 클릭 → PiP iframe + 홀더 ≤400px + `pipActive='1'` / 2 PiP 안 토글 → 복귀 520×780 / 3 PiP 외부 close →
**두 창 소멸 + `dock-pin-lost` 부재** / 4 qtask 핀 중 qtalk 핀 → qtask 홀더가 2초 내 **일반 창 복귀**(닫히면 FAIL)
/ 5 **반증**: 선공지 주석 처리 후 4번 재실행 → qtask 소멸해야 함 → 원복 / 6 핀 중 메인 reload → PiP 생존
/ 7 도크에 `dock-pin-*` testid 0개 + 모바일·미지원 브라우저 미노출 / 8 빌드 exit 0 + i18n·parity PASS + note 녹음 중 핀 → ConfirmDialog

### 남는 리스크 (Fable 기록)
- 화면공유 강제종료 시 도구 전체 소멸 — 이 환경에서 공유-kill 재현 불가. 운영 호소 오면 "무-pagehide 죽음"을
  자살 대신 일반 창 복귀로 바꾸는 1분기 수정으로 대응(절단면 준비됨)
- 홀더 창의 존재 자체가 물리 제약의 대가. Irene 이 홀더를 못 받아들이면 **유일한 대안은 핀 생성 도크 회귀**

---

## 📂 다음 할 일

1. **핀 요구 2건 구현** (위 지시서) → Fable 구현 게이트
2. **`/배포`** — Irene 명시 지시 후에만. 누적 미배포: `fa1766a` 팝아웃 신설 · `4ce3950` 체크박스/우선순위 ·
   `77786b7` Q Note 녹음 가드 · `074cce6` tie-break · my-week 집합 확장. **배포 후 운영 위키 시드 필요**
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
