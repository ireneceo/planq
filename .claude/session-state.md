## 현재 작업 상태
**마지막 업데이트:** 2026-04-22
**작업 상태:** Dropbox 연동 전체 제거 완료 → 다음 개발 착수

---

## ⚡ 빠른 재개

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** Dropbox 연동 전체 제거 — 자체 스토리지(planq) + Google Drive(gdrive) 2-way 구조로 정리. 27개 파일 수정 + dropbox npm 패키지 제거 + DB ENUM/필드 정리.

**바로 다음 작업:** "다음 할 일 1번" — Platform Admin 플랜 수동 조정 UI.

**맥락 유지할 것:**
- 구독 플랜 엔진 완성 (config/plans.js + services/plan.js + 30년차 검증 8건 반영)
- 설정 > 플랜 페이지 완성 (KRW/USD · 월/연 토글, 사용량 바 80/95% 색환, 이력)
- /privacy · /terms 페이지 완성
- Google Drive OAuth 연동 + 실연결 성공 (irene@irenewp.com 4TB)
- 세션 관리 체계: `/임시저장` (30초) / `/저장` (2~3분) / `/개발완료` (5~10분)

---

## 🗑 이번 세션 (2026-04-22 후반) — Dropbox 제거

### 배경
Irene 결정: Dropbox 는 빼고 Google Drive + PlanQ 자체 스토리지만 유지.

### 수정한 파일 (27개)
**Backend**
- 삭제: `services/dropbox.js`
- routes: `cloud.js` (connect/callback 블록 · providers 응답), `files.js` (useDropbox 분기 · 삭제 분기), `projects.js` (dropbox_folder_id rename), `task_attachments.js`
- models: `File.js`, `MessageAttachment.js`, `TaskAttachment.js`, `BusinessStorageUsage.js` ENUM에서 dropbox 제거, `BusinessCloudToken.js` provider ENUM, `Project.js` dropbox_folder_id 삭제, `OpsCapacityLog.js` dropbox_share 삭제
- config/scripts: `plans.js`, `services/plan.js`, `ops-capacity-check.js`
- package.json: `dropbox` npm 의존성 제거 (`npm uninstall dropbox`)

**Frontend**
- `services/files.ts` StorageProvider type
- `pages/Settings/StorageSettings.tsx` Dropbox 카드·상태·핸들러 전체 삭제
- `public/locales/{ko,en}/{settings,legal}.json` Dropbox 관련 문자열 삭제

**Docs**
- `CLAUDE.md`, `DEVELOPMENT_PLAN.md`, `docs/FILE_SYSTEM_DESIGN.md` — Dropbox 언급 제거, 다이어그램·테이블·롤아웃 플랜 갱신

### Irene 수작업 필요
- `.env` 에서 `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_REDIRECT_URI` 줄 삭제
- Dropbox App Console (l8yeiu6nu4zwvcx) 는 사용 안 하므로 App 삭제 또는 방치

---

## 🎯 다음 할 일 (우선순위 순)

### 1. Platform Admin 플랜 수동 조정 UI (1일, Claude)
- `/admin` 라우트 + `platform_admin` 권한 전용
- 비즈니스 목록 + 플랜 수동 변경 (결제 연동 전 임시 조정)
- 플랜 변경 이력 조회
- 체험 기간 수동 연장
- 사용량 overrides (enterprise 맞춤용)

### 2. 결제 시스템 Phase (3~4일, Claude)
- **Stripe 연동** (글로벌 카드) — 사업자 등록 정보 필요
- **포트원 연동** (한국 결제 — 카카오페이, 네이버페이, 토스, 계좌이체)
- `business_subscriptions` 테이블 (provider/currency/external_subscription_id/billing_cycle)
- 결제 성공 webhook → `plan.changePlan` 자동 호출
- 결제 실패 webhook → `subscription_status = past_due` + grace_ends_at 설정
- 환불 로직 (7일 전액, 이후 일할)
- 오버리지 청구 (Cue 건당 ₩50 / Note 분당 ₩20)
- 사업자 등록 후 가능 (Irene 작업 선행)

### 3. Q Note 회의자료 Drive 분기 (0.5일, Claude)
- Python q-note 서비스 → Node backend 로 웹훅 (`POST /api/qnote/usage`)
- 세션 종료 시 `QnoteUsage.minutes_used` 누적
- 회의 자료 업로드 시 Drive 프로젝트 폴더에 자동 저장

### 4. Webhook — Drive 외부 변경 감지 (0.5일, Claude)
- Drive: `files.watch` Push Notifications
- 외부 앱에서 파일 삭제·이름변경 시 PlanQ DB 동기화

### 5. Google Cloud Console Publish (Irene 30분)
- OAuth consent screen → **PUBLISH APP** (Testing → Production)
- Privacy URL: `https://dev.planq.kr/privacy`
- Terms URL: `https://dev.planq.kr/terms`
- drive.file scope = verification 불필요 — Publish 즉시 모든 Google 계정 OAuth 가능

### 6. 백로그
- 프로젝트 상태 토글 UI (active/paused/closed)
- 프로젝트 삭제 UI (cascade 확인 모달)
- F5-2b `/invite/:token` 초대 랜딩 페이지
- QProjectDetailPage 한글 하드코딩 62건 i18n 전환
- Q Talk 메시지 첨부 기능 신규
- Calendar 폴리시 (RRULE 단일 인스턴스 수정/삭제, UNTIL/COUNT UI, 알림)
- 반응형 Phase 1~5 (기능 95% 이후)
- Capacitor 하이브리드앱 래핑

---

## 🔑 환경변수 / 인증 현황

```
GOOGLE_CLIENT_ID        = 765630237305-rm9g0emg...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET    = 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 (.env 저장)
GOOGLE_REDIRECT_URI     = https://dev.planq.kr/api/cloud/callback/gdrive

- Google OAuth 상태: Testing → Publish 필요 (Irene 작업)
- drive.file scope = verification 불필요

워프로랩 (biz=3) 현재 연동:
- Google Drive: irene@irenewp.com · root folder "PlanQ - 워프로랩" 생성됨

개발 DB 비즈니스 플랜:
- Test Company / E2E Corp / 워프로랩 / QNote Test Biz / Health Check Biz / 브랜드 파트너스 → basic
- PlanQ 테스트 워크스페이스 → pro
```

---

## 📂 주요 문서 위치

- 플랜 정의: `dev-backend/config/plans.js`
- 플랜 엔진: `dev-backend/services/plan.js`
- 파일 시스템 설계: `docs/FILE_SYSTEM_DESIGN.md`
- OPS 로드맵: `docs/OPS_ROADMAP.md`
- 개발 로드맵: `DEVELOPMENT_PLAN.md`
- 프로젝트 규칙: `CLAUDE.md` (세션 자동 주입됨)
- Q Project 감사: `docs/QPROJECT_AUDIT.md`
- 브랜드 컨셉: `docs/BRAND_CONCEPT.md`
