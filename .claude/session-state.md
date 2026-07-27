# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-27 (Opus 5, 1M) — `/개발완료`
**작업 상태:** ✅ **운영 배포 완료** (`ee03839`, 210s, 3점 실측 통과)

---

## ⚠️ Irene 조치 대기 (코드로 못 하는 것)

1. **구글 캘린더 재연동** — planq.kr → 설정 → 파일·외부 연동 → Google Calendar 해제 후 재연결.
   **동의 화면에서 "Google 캘린더의 캘린더를 사용하여 이벤트 보기 및 수정" 체크박스 반드시 체크.**
   지금은 미체크 시 **저장 자체가 거부**되므로 같은 사고는 재발하지 않는다.
2. **별칭 등록 시 Gmail 설정 동반** — PlanQ 에 별칭을 넣을 때 Gmail 웹 → 설정 → **"다른 주소에서 메일 보내기"** 에도 같은 주소 등록 필수.
   안 하면 Gmail 이 거부하지 않고 **조용히 From 을 본계정으로 치환**한다(PlanQ 는 별칭으로 보냈다고 표시).
   운영 별칭 현재 **0건**.
3. **약관·처리방침 개정 공지 — 마감 `2026-08-03`** (시행 `2026-08-10` 의 7일 전).
   절차 `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md` §2·§3. **현행 문안 그대로, 읽음 추적 조항 없이.**
   또 넘기면 시행일을 공지일+7일 이후로 재연기(tsx 2줄). `terms_version`/`privacy_version` 은 올리지 않는다.
4. **Google OAuth 앱 검증 제출** — 1·2 의 근본 원인. 미검증(Testing) 상태라 원클릭 재연결이 숨겨져 있고,
   OAuth refresh token 7일 만료 위험이 남는다.

---

## 🔖 이번 세션 결과 (운영 반영 완료)

### 캘린더
- **고장 규명**: 07-27 03:41 재연결이 `calendar.events` 없이 저장 → 이후 push 전부 403. 콜백 scope 미검증 + 실패 침묵으로 5일 무증상
- 콜백 **scope 검증**(권한 없으면 저장 거부) · `last_error` 기록 · 설정 화면 "재연결 필요" 배지
- **개인 캘린더 쓰기 신설** (`calendar.readonly` → `calendar.events`). 여태 쓰기 코드 0줄 = 고장이 아니라 기능 부재
- **팀/개인 플래그 분리** `gcal_sync_workspace` / `gcal_sync_personal` (Irene 지적 — 연결 계정이 다르다)
- 프라이버시 불변식: L1·L2·personal 은 **팀 체크 ON 이어도 팀 목적지 0** (#126)
- 종일 일정 2결함(배타 end 미보정 + UTC 기준 날짜) 수정, insert/update 양쪽 + 역방향 왕복

### Q Mail
- 억제 발송을 `sent` 로 거짓 기록하던 것 → **`suppressed`** 분리 + 상태 칩
- **별칭 발신 사고**: `from_alias_id=0` 이 라우트 `|| null` 에서 죽어 기본별칭으로 발신 → `parseFromAliasId` 3경로 통일
- **회사 공통 서명**: 별칭 > 계정 > **워크스페이스**. 계정 서명 비우면 자동 폴백, 기존 서명 무손실
- 새 메일·전달 컴포저 **별칭 선택**, 별칭별 보기(`received_at_email` + `?received_at`)
- **알림 중복 제거**: 같은 Message-ID 가 두 계정으로 와도 사용자당 1회
- **계정 사망 가시화** + **OAuth→앱비밀번호 전환** → `help@irenewp.com` **복구 완료**(fail 2241→0, 수신 재개)
- **"응답 없음 N일"** — 읽음 확인(추적 픽셀) 대신. Fable 판단: B2B 는 거짓양성/음성이 커 "봤나" 에 못 답한다

### #206
- **§2-10 포커스 5차 만에 생존**. 사인 = 보류 직후 **드로어 재마운트**로 인스턴스 state 소멸.
  의도를 **모듈 스코프**로 옮기고 **트랩에 대상을 넘겨** 경쟁 제거. 계측 + 무력화 반증으로 확인

### 운영 데이터
- **유피트(biz6) 업무 25건 투입** — 담당자 user15(민), 매일반복 4건(`FREQ=DAILY`), 마감 1건(#191 08-22).
  다른 워크스페이스 영향 0. 유피트는 **client 가 아니라 워크스페이스**로 등록돼 있다

---

## ★ 이번 사이클에서 박제할 교훈

**Fable 게이트 11라운드, FAIL 6건이 전부 실제 결함이었다.** 그중 4건은 Opus 가 "고쳤다"고 믿었지만
코드가 그 일을 하지 않던 것 — 자체 검증만 했으면 전부 통과시켰을 것이다.

1. **주석은 방어가 아니다** — "sync 가 먼저 돌면 안 된다"고 써놓고 등록 위치는 sync 뒤였다. FK 건도 동일(주석에 위험을 정확히 서술하고 코드는 그대로)
2. **체인의 중간을 빠뜨린다** — 프론트·서비스층을 고치고 **라우트**를 안 봤다(`from_alias_id=0`). insert 만 고치고 **update** 를 안 봤다(종일 일정)
3. **DB 컬럼만 추가하고 모델 필드를 빠뜨림** — 3회 반복. 값이 `undefined` 라 토글이 조용히 무시된다
4. **`sequelize alter:true` 는 모델에 없는 컬럼을 DROP 한다** — rename 마이그레이션은 반드시 `sync-database` **앞**
5. **빌드는 실 exit code 로** — `grep -c "error TS"` 를 뒤에 붙이면 에러 0일 때 exit 1 이라 거꾸로 읽힌다
6. **배포에 타임아웃 걸지 말 것** — `exit 143` 으로 프론트 빌드 단계에서 잘려 부분 배포가 남았다(분리 실행으로 완주)

---

## 📂 다음 할 일

1. **Irene 조치 4건** (위 ⚠️)
2. **이월 결함 6건** — EventDrawer 죽은 i18n 키 폴백 · EventDrawer 가 연결 안 된 목적지도 항상 표시 ·
   PUT `/mail` owner 미강제(UI readOnly 와 비대칭) · PWA 설치 배너 `role="dialog"`(§17 위반, 하니스 오염) ·
   `routes/calendar.js:604` 죽은 `needsGcalSync` · serializer `has_access_token` 3필드 항상 false
3. **KbDocument sync 실패** — `kb_documents.project_id INT` vs `projects.id BIGINT` FK 타입 불일치로
   `sync-database` 가 매 실행 `1 failed` 로그(테이블은 작동). 운영 로그에도 동일
4. **★ 시간 엔진 라운드 경계 결함** (미해결, 운영 데이터 오염) — `taskActualHours.js:46` 이 `event_type='status_change'`
   만 집계하는데 액션 계층의 `review_submit`·`completed`·`revision`·`revert`·`approve` 는 고유 타입 → 라운드 미마감.
   운영 실측: task 24 저장 153.6h vs 실제 2.2h · task 53 0h vs 67.7h. 전부 워크스페이스 1 내부
5. **#208** 출퇴근·휴가(신규, Fable 기획설계부터) · **#211** B2B 타깃 · **#192** AiRefineBar · **#193** 캘린더 뒤로가기
6. **Stripe 키 입력**(Irene) · **회사 영문명 확정**(Irene)

---

## 🔑 환경 / 인증

- 운영 = `irene@87.106.78.146` (planq.kr, port 3004, `/opt/planq/backend`, DB `planq_prod_db`). SSH passwordless.
  **배포 외의 운영 접근은 조회만.**
- **배포 정본: `./scripts/deploy-planq.sh --auto`** — **반드시 `nohup` 분리 실행**(타임아웃 걸면 부분 배포).
  완주 표시는 `Deployment Complete (NNNs)`. 백업 `backups/{TIMESTAMP}` + 롤백 명령을 끝에 출력.
- **마이그레이션 순서**: `sync_database()` 안에서 **pre-sync(rename) → sync-database.js → post-sync 마이그레이션** → PM2 reload.
  rename 류는 반드시 pre-sync.
- dev DB 접근 `cd /opt/planq/dev-backend` 후 node. **가드/e2e 는 `cd /opt/planq` 루트**.
- dev 테스트 계정: `health-check@planq.kr` / `HealthCheck2026!` (business 5·73 owner). 토큰 = `data.token`. rate-limit 15분 8회.
- 업무 PUT 라우트는 `/api/tasks/by-business/:businessId/:id` — `/api/tasks/:id` 는 404.
- 프론트 타입체크는 `npm run build` 로만(heap 4096). `npx tsc` 는 OOM.
- dev 는 `EMAIL_SENDING_ENABLED=false` — Q Mail 발송도 이 게이트를 지나며 `suppressed` 로 기록된다.

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
### 참조
- 정책: CLAUDE.md "Fable 검증 게이트" · memory `feedback_fable_all_design_verification`
- 설계 문서: `docs/TASK_HOLD_EXTERNAL_REVIEW_DESIGN.md` · `docs/TASK_HOLD_UI_UX_DESIGN.md` · `docs/LEGAL_UPDATE_2026-08-01_ROLLOUT.md`
