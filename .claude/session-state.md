## 현재 작업 상태
**마지막 업데이트:** 2026-09-23 21:10 UTC
**작업 상태:** 완료 (운영 배포 2회 — v1.58.0 `f321b950` · v1.58.1 `8b16eef7`)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **선불 2개월 체험 선택지** — 「무료 14일 / 지금 결제하고 1개월 추가」. **자동 정기청구 없이** 첫 기간만 2개월.
  정책 정본 `config/plans.js TRIAL_OPTIONS`(라우트는 선택지 «코드» 만 받는다 — 개월 수를 본문으로 받으면 위조된다) ·
  기간 공식 `billing.js computePeriodEnd()` 하나 · 보너스는 `markPaymentPaid` 의 `wasFirst` 에만 ·
  자격 `isFirstPlanPayment()` · `subscriptions.bonus_months`(멱등 마이그레이션 + **deploy 슬롯 등록**)
- **#425 메일 제목 `[PlanQ]` 중복 제거** — 발신자가 이미 PlanQ. `subjectPrefix` 빈문자열 + 하드코딩 8곳 +
  `providerCredit` 2곳. 앞 공백은 `sendEmail` 한 곳(호출부 14곳 무변경). `[워크스페이스명]` 은 유지.
  **장부 done + 답글 완료**(알림 #1879)
- **#424 휴가 알림 딥링크** — `?leave=<id>` 를 읽는 곳이 0곳이었다. 관리자·신청자 양쪽 + 처리된 건 안내 +
  옛 링크(`?tab=team&leave=`) 착지 확인
- **#417 재확인** — 6항목 중 5개가 **9/20 에 이미 고쳐져 있었다**(10/10 실측). 다시 만들지 않았다
- **파일 카드 메타 3줄 → 1줄** — 카드 198 → 169px. Q file·프로젝트>파일 픽셀 일치
- **검사 하니스 보강** — `scripts/e2e/lib/measure.js` 신설 + 카나리 잔여 일괄 청소 러너 배선
- 카나리 2종(`prepay` 15 · `leavelink` 14) · Q위키 `trial-options` · dev 잔여 정리(프로젝트 10 · 문서 48)

### 수정한 주요 파일
- 백엔드 `config/plans.js` · `services/{billing,emailService,providerCredit,trial}.js` · `routes/plan.js` ·
  `models/Subscription.js` · `scripts/migrate-subscription-bonus-months.js`(신규) · `seed-wiki-content.js`
- 프론트 `pages/Settings/{PlanSettings,CheckoutModal,AttendanceAdminSettings}.tsx` ·
  `pages/Attendance/{AttendancePage,TeamTab,shared}.tsx` · `pages/QProject/DocsTab.tsx` · `services/plan.ts` · locales 4
- 검사 `scripts/e2e/lib/{measure,cleanup}.js` · `canary-{prepay-bonus,leave-deeplink}.js` · `run.js` · `deploy-planq.sh`

### ★ 이번 세션에서 내가 틀린 것 (반복 금지)
1. **범위를 부풀렸다** — 「자동구독」 전제로 R=1 판정하고 Fable 을 부르려 했다.
   Irene: *"카드 결제 자동구독이 중요한게 아니라 결제를 시키는 것이 중요한건데."* 선불이면 필요 없다
2. **"정기구독이 없다"를 크게 말해** Stripe 결제 자체가 안 되는 것처럼 들리게 했다.
   카드 1회 결제는 완성·운영 활성이고 2026-07-08 완료 보고는 거짓이 아니었다
3. **이미 고쳐진 것을 다시 만들 뻔했다** — #417. 실측으로 먼저 확인한 것이 맞았다
4. **검사기가 일곱 번 거짓말했다** — 고정 sleep · 숨은 keep-alive 사본(3회) · 감싸는 상자 · 빈 픽스처(2회) ·
   주석을 코드로 · 다른 화면 testid · **빌드 실패 상태로 옛 번들 측정** · 반증 INSERT 실패를 성공으로 읽을 뻔.
   → `measure.js` 로 구조화, 빌드 성공 확인 뒤에만 측정하도록 묶었다

### 다음 할 일
- **운영 신고 #418 · #419 (Google Drive 동기화·공유)** ← 다음 작업
- **Fable 대기열 6건** — 오늘 **429 일곱 번**. 한도 회복 시 2026-09-23 항목을 **한 번에**:
  A 선불 · B 메일제목 · C 딥링크 · D 배포배선 · E 카드한줄+하니스 · F 위키
  ★ 가장 걸리는 것: **청소기가 이름 규약(`[카나리]` 접두어)에만 기댄다** — 사용자가 그 접두어로
    진짜 프로젝트를 만들면 러너가 지운다. 표지(생성자 계정·전용 컬럼)로 가려야 하는지 판단 필요
  ★ `isFirstPlanPayment` 동시 요청 경합 · 플랜변경/애드온 경로 보너스 누출 여부 · 환불 문구 법적 타당성
- **약관·개인정보·결제 안내** 에 선불 2개월·환불 기준 반영(Irene 지시, 기능 자리 잡은 뒤).
  ★ 이때 운영 `terms_version` 을 같이 올린다 — 지금 `1.0` 이라 2026-09-14 개정 약관도 재동의 모달이 안 뜬다
- **#424 본체 미착수** — 휴가·휴일의 Q task 근무일수 반영 · 국가별 휴일 관리 · 기본 근무일수 통합.
  Irene 이 Fable 설계를 지시한 부분(S=1 · F=0). 현재 휴일은 Q task 손입력 숫자 하나뿐
- **위키 운영 반영** — 다음 배포 때 `ssh prod "cd /opt/planq/backend && node seed-wiki-content.js"`
- iOS 심사 — 9/22 제출, 승인·반려 메일 없음(연결 메일함 동기화 정상). 승인되면 Irene 이 [출시] →
  운영 `platform_settings.app_ios_url` 교체는 내가

### Git 상태 (2026-09-23 21:10 UTC)
- 작업 트리 **깨끗**(미커밋 0) · `main` 이 `origin/main` 과 동기
- 최근 커밋: `3fcee72b` ← `67492bd3` ← `8b16eef7` ← `8a7d7740` ← `f321b950`
- 운영 버전 **1.58.1** · health 200 · 롤백 `/opt/planq/backups/20260923_204936`
- 백업 `/opt/planq/backups/dev-daily/20260923/`

### 주요 변경사항
- **DB**: `subscriptions.bonus_months INT NOT NULL DEFAULT 0` (운영 반영 완료, 기존 12행 전부 0)
- **동작 변경**: 플랫폼 메일 제목에서 `[PlanQ]` 접두어 사라짐(워크스페이스 접두어는 유지) ·
  파일 카드 높이 198 → 169px · 플랜 설정에 첫 결제 전 한정 「1개월 추가」 카드
- **해결한 신고**: #425(done+답글) · #424 일부(딥링크) · #417 확인만(이미 해결돼 있었음)
- **Fable 미검증(자체 검증)** — 자체 수치: API 21/21 · cron 9/9 · 메일 호출부 14곳 24/24 ·
  딥링크 14/14 · #417 10/10 · 카드 4폭 8/8 · UI/UX 24/24 · 위키 문구 11/11 · 반증 10종 ·
  health 45/45 · guard 58/59 · build EXIT 0 · error TS 0

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
