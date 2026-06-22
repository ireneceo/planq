# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-22 (운영 피드백 큐 전부 해소 + 2회 배포)
**작업 상태:** 완료 — **운영 피드백 6건 모두 운영 라이브.** 미배포 0. 추가 actionable 피드백 없음.

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션) — 2회 배포

**1차 배포 (`20260622_171505`, commit `4edacd9`, 141초):**
- **#72/#88 구글 로그인·Gmail 안 됨** — 진짜 원인 = 운영 `.env`에 `APP_BASE_URL`/`GOOGLE_LOGIN_REDIRECT_URI` 부재 → 로그인·Gmail OAuth redirect가 코드 폴백값 `https://dev.planq.kr`로 고정 → planq.kr에서 로그인하면 콜백이 dev로 가 세션 끊김(#88 에러 = `400 redirect_uri_mismatch`). **콘솔 문제 아니었음**(In production·URI 등록 OK). **수정:** `services/google_oauth_login.js`·`gmail_oauth.js` getRedirectUri가 gcal/gdrive처럼 `GOOGLE_REDIRECT_URI` origin 재사용(운영/dev 자동 정합, env 추가 불필요). 운영 검증: 로그인 initiate redirect_uri = `https://planq.kr/api/auth/google/callback` 라이브.
- 동봉 배포분: 그동안 검증해둔 미배포 묶음(#87 표시명·#71 공지배너·#79 모바일focus·#85 SCR요약·#89 푸터·#90 AI업무담당자·#63 export Phase1) + **B4 AI 템플릿 추천**.

**2차 배포 (`20260622_184224`, commit `b5d2786`, 197초):**
- **#92 구독 청구서 정기 발송 기준 표시** — `services/invoiceRecurring.js`(meta.recurring 스냅샷 + resolveRecurringInfo 라이브 다음발행일 해석, business_id 격리) + 두 정기 엔진(clientSubscriptionBilling·recurring_invoice) 생성 시 기록 + invoices.js 인증/공개 응답에 recurring 주입 + 공통 `RecurringBillingNote`(드로어+공개 재사용) + qbill i18n. 백필 `scripts/backfill-invoice-recurring.js`(멱등, 운영 0건=정기엔진 청구서 아직 없음).
- **#86 우측 하단 퀵메뉴 모바일 잘림** — `RightDock.tsx` z-index 45→120(모바일 상단바 99 위)·메뉴 max-height+스크롤·FAB safe-area-inset-bottom. (생성 모달 3개는 이미 반응형이라 메뉴 자체가 원인)
- **#81 Cue에게 맡긴 업무 실제 진행** — `cue_task_executor.inferCueKind()`로 cue_kind 없으면 제목/내용/연결자료에서 추론(기본 research). `executeForTask`가 추론·persist 후 진행. tasks.js POST(`&& cue_kind` 제거)+PUT(담당자 Cue 변경 시 트리거 신규). E2E PASS(cue_kind 없이 배정→research 추론→reviewing+결과물 210자).

**확인만 남음(코드 정상):** #84 Q위키 팝아웃 FAB(이미 배포·markPopoutWindow 창단위 마커 정상).

### 다음 할 일
- **Irene 직접 확인:** planq.kr 구글 로그인(#72) + 아이폰 모바일 퀵메뉴(#86)
- 새 운영 피드백 들어오면 처리. 현재 큐 비어있음.
- (선택) #92 정기표시는 정기엔진(고객구독·프로젝트월정액) 생성 청구서에만 노출 — 수동발행 INV는 안 뜸. 사용자가 ClientSubscription으로 설정해야 진짜 정기.

### 박제
- **OAuth redirect는 `GOOGLE_REDIRECT_URI` origin 재사용** — APP_BASE_URL/전용 env 없으면 dev 폴백되어 운영 로그인 깨짐. login·gmail·gcal·gdrive·personalOauth 전부 같은 패턴 유지.
- **Google OAuth 단일 CLIENT_ID 공유** — 로그인(openid/email/profile 비민감, 검증 불필요) vs Gmail(`mail.google.com` restricted, CASA 검증 필요 or IMAP 앱비밀번호 우회).
- 헬스 1건 실패는 socket/MySQL async race flaky — 재실행 시 29/29.
- 빌드 `✓ built in 1초대`는 tsc 증분 캐시 + vite 캐시 정상. EXIT 0 + error TS 0이 게이트.

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
