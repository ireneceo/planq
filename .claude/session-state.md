## 현재 작업 상태
**마지막 업데이트:** 2026-04-22 06:40 UTC
**작업 상태:** 중단 (이어서 재개 예정)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

특정 번호 지정:
```
session-state.md 읽고 "3번 할 일" 진행해줘.
```

프로젝트 구조·규칙은 이미 아니까 재스캔 스킵.

---

## 🔖 지금 중단 지점

**마지막 작업:** `/임시저장` 스킬 생성 + 커밋 `ee04846` 푸시. 세션 clear 준비 완료.

**바로 다음 작업:** "다음 할 일 1번" — StorageSettings 공식 Dropbox/Google 브랜드 아이콘 교체 (15분). 그 후 Irene 의 Dropbox/Google Console Production 작업 지원.

**맥락 유지할 것:**
- 구독 플랜 엔진 완성 (config/plans.js + services/plan.js + 30년차 검증 8건 반영)
- 설정 > 플랜 페이지 완성 (KRW/USD · 월/연 토글, 사용량 바 80/95% 색환, 이력)
- /privacy · /terms 페이지 완성 (Dropbox/Google Production 심사용)
- Dropbox env 세팅 완료 (l8yeiu6nu4zwvcx) — 설정 페이지에서 연결 버튼 활성화됨
- 세션 관리 체계: `/임시저장` (30초) / `/저장` (2~3분) / `/개발완료` (5~10분)

---

## 이번 세션 (2026-04-22) 완료 작업

### 🗂 파일 시스템 완주
- **Phase 2A 자체 스토리지** (쿼터·dedup·폴더·대량)
- **Phase 2B Google Drive OAuth** 연동 + 실연결 성공 (irene@irenewp.com 4TB)
- **Phase 2C Dropbox** 코드 + env 세팅 완료 (l8yeiu6nu4zwvcx)
- 폴더 트리 재구성 ("내 업로드"→프로젝트명) + 카운트 우측 정렬 + ↑/↓ 순서 이동
- task 첨부 / 파일 삭제·이름변경 Drive 동기화
- SearchBox 공용 컴포넌트 (5곳 통일)
- **Phase 4 Q Docs 전역 페이지** (/docs)
- 설정 > 파일 저장소 UI (연동/해제)

### 💳 구독 플랜 시스템
- `config/plans.js` 5단 매트릭스 (free/starter/basic/pro/enterprise)
- `services/plan.js` 엔진 (getBusinessPlan/can/getUsage/getLimit/changePlan)
- **30년차 검증 Critical 8건 수정**:
  - D1 Race condition (FOR UPDATE lock)
  - D2 30s 메모리 캐시
  - D3 CueUsage 쿼리 수정 (year_month + action_count)
  - D4 QnoteUsage 테이블 연결
  - D5 Cue 하드코딩 PLAN_LIMITS 제거 → plan engine 통합
  - D6 `business_plan_history` 이력 테이블
  - D7 `scripts/plan-expiry-check.js` 일 배치
  - D8 Infinity JSON 직렬화 일관 처리
- 에러 응답 표준화 (code/message/upgrade_url/alternatives)
- **설정 > 구독 플랜 페이지** — 현재 플랜 카드 + 사용량 바 (80/95% 색환) + 비교표 (KRW/USD · 월/연) + 이력
- 정책: 14일 체험 / 오버리지 + 업그레이드 제안 / 다운그레이드 30일 grace / 환불 7일·일할 / 결제실패 7일 grace

### ⚖️ Legal 페이지 (실사용자 오픈 필수)
- `/privacy` — 개인정보처리방침 (ko/en) — 제3자 제공·GDPR·개보법 커버
- `/terms` — 이용약관 (ko/en) — 구독/환불/다운그레이드/분쟁/면책

### 수정 주요 파일
- Backend: `config/plans.js`, `services/plan.js`, `services/gdrive.js`, `services/dropbox.js`, `services/cue_orchestrator.js`
- Backend models: `Business.js`, `BusinessPlanHistory.js`, `BusinessCloudToken.js`, `QnoteUsage.js`, `Project.js`, `FileFolder.js`, `BusinessStorageUsage.js`, `OpsCapacityLog.js`
- Backend routes: `plan.js`, `cloud.js`, `files.js`, `file_folders.js`, `projects.js`, `task_attachments.js`, `clients.js`, `conversations.js`
- Backend scripts: `plan-expiry-check.js`, `ops-capacity-check.js`
- Frontend: `pages/Settings/PlanSettings.tsx`, `StorageSettings.tsx`, `pages/QProject/DocsTab.tsx`, `pages/QDocs/QDocsPage.tsx`, `pages/Legal/{LegalPage,PrivacyPolicy,TermsOfService}.tsx`
- Frontend services: `plan.ts`, `files.ts`
- Frontend common: `components/Common/SearchBox.tsx`
- Locales: `plan.json`, `legal.json`, `qdocs.json`, `qproject.json`, `settings.json`

### 커밋 히스토리 (이번 세션)
```
c1c5766 Dropbox 활성화 + /privacy + /terms + Production 준비
1de9b57 설정 > 구독 플랜 페이지 (Phase 2)
107a799 Critical 8건 + 정책 반영 + 에러 표준화 (30년차 검증)
1e68d65 구독 플랜 엔진 (config/plans.js + services/plan.js)
661e467 Phase 2C Dropbox App Folder 연동 코드 선행
3a2d19d Drive 삭제/리네임 동기화 + 설정 UI
c391c6b Drive task 첨부 동기화 + 폴더 트리 재구성
096b0bd Phase 2B Google Drive OAuth + 업로드 분기
3343c88 Phase 4 Q docs 전역 페이지
491a00e 폴더 순서 이동 ↑/↓
75d1c10 공용 SearchBox + "루트" → "내 업로드"
a4cadbb fix: 집계 API uploaded_at undefined
9812941 파일 시스템 Phase 1·1+·2A
```

---

## 🎯 다음 할 일 (우선순위 순)

### 1. 공식 브랜드 아이콘 교체 (15분, Claude)
- `StorageSettings.tsx` 의 Dropbox/Google 아이콘을 공식 brand asset 으로 교체
- Dropbox: https://www.dropbox.com/branding
- Google Drive: Google Identity Platform 공식 SVG
- 이유: Dropbox Production 심사에서 브랜드 가이드 준수 확인

### 2. Irene 이 Dropbox/Google Console 에서 할 일 (30분)
**Dropbox App Console** (`l8yeiu6nu4zwvcx`):
- Settings → Users → **Enable additional users** 클릭
- Branding 탭 입력 (App description/Privacy URL/Terms URL/Icon)
- App description 영문 문구는 `c1c5766` 커밋 메시지 또는 직전 세션 보고 참조
- **Apply for production** 신청 (심사 2~5일)

**Google Cloud Console**:
- OAuth consent screen → **PUBLISH APP** 버튼 (Testing → Production)
- Privacy URL: `https://dev.planq.kr/privacy`
- Terms URL: `https://dev.planq.kr/terms`
- drive.file scope 는 verification 심사 불필요 — Publish 즉시 모든 Google 계정 OAuth 가능

### 3. Platform Admin 플랜 수동 조정 UI (1일, Claude)
- `/admin` 라우트 + `platform_admin` 권한 전용
- 비즈니스 목록 + 플랜 수동 변경 (결제 연동 전 임시 조정)
- 플랜 변경 이력 조회
- 체험 기간 수동 연장
- 사용량 overrides (enterprise 맞춤용)

### 4. 결제 시스템 Phase (3~4일, Claude)
- **Stripe 연동** (글로벌 카드) — 사업자 등록 정보 필요
- **포트원 연동** (한국 결제 — 카카오페이, 네이버페이, 토스, 계좌이체)
- `business_subscriptions` 테이블 (provider/currency/external_subscription_id/billing_cycle)
- 결제 성공 webhook → `plan.changePlan` 자동 호출
- 결제 실패 webhook → `subscription_status = past_due` + grace_ends_at 설정
- 환불 로직 (7일 전액, 이후 일할)
- 오버리지 청구 (Cue 건당 ₩50 / Note 분당 ₩20)
- 사업자 등록 후 가능 (Irene 작업 선행)

### 5. Q Note 회의자료 Drive 분기 (0.5일, Claude)
- Python q-note 서비스 → Node backend 로 웹훅 (`POST /api/qnote/usage`)
- 세션 종료 시 `QnoteUsage.minutes_used` 누적
- 회의 자료 업로드 시 Drive 프로젝트 폴더에 자동 저장

### 6. Webhook — Drive/Dropbox 외부 변경 감지 (0.5~1일, Claude)
- Drive: `files.watch` Push Notifications
- Dropbox: `/files/list_folder/longpoll`
- 외부 앱에서 파일 삭제·이름변경 시 PlanQ DB 동기화

### 7. 백로그
- 프로젝트 상태 토글 UI (active/paused/closed)
- 프로젝트 삭제 UI (cascade 확인 모달)
- F5-2b `/invite/:token` 초대 랜딩 페이지
- QProjectDetailPage 한글 하드코딩 62건 i18n 전환
- Q Talk 메시지 첨부 기능 신규 (기존 기능 미구현, 구현 시 task 패턴 복제)
- Calendar 폴리시 (RRULE 단일 인스턴스 수정/삭제, UNTIL/COUNT UI, 알림)
- 반응형 Phase 1~5 (기능 95% 이후)
- Capacitor 하이브리드앱 래핑

---

## 🔑 환경변수 / 인증 현황 (세션 간 유지)

```
GOOGLE_CLIENT_ID        = 765630237305-rm9g0emg...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET    = 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 (.env 저장)
GOOGLE_REDIRECT_URI     = https://dev.planq.kr/api/cloud/callback/gdrive

DROPBOX_CLIENT_ID       = l8yeiu6nu4zwvcx
DROPBOX_CLIENT_SECRET   = 557j4gpcxagli9x (.env 저장)
DROPBOX_REDIRECT_URI    = https://dev.planq.kr/api/cloud/callback/dropbox

- Google OAuth 상태: Testing → **Publish 필요** (Irene 작업)
- Dropbox App 상태: Development → **Apply for production 필요** (Irene 작업)
- drive.file scope = verification 불필요
- Dropbox scope = Production 심사 필요 (50명 도달 시 2주 내)

워프로랩 (biz=3) 현재 연동:
- Google Drive: irene@irenewp.com · root folder "PlanQ - 워프로랩" 생성됨
- Dropbox: 미연결 (연결 시 /Apps/PlanQ/워프로랩/ 자동 생성 예정)

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

---

## 🔄 복구 가이드

새 Claude 세션 시작 시 아래 중 하나:

**빠른 재개** (추천):
```
session-state.md 읽고 "1번 할 일"부터 바로 착수해줘.
```

**자세한 시작**:
```
/개발시작
```

**특정 작업 지정**:
```
session-state.md 읽고 "결제 시스템 Phase" 진행해줘.
```
