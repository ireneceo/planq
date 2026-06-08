# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-08 (사이클 N+91)
**작업 상태:** 완료 (dev 검증 · 운영 미배포)

---

## ✅ N+91-B 완료 — 공개뷰 폴리시 (로고·터치타겟 통일)

> **계기:** session-state "다음 할 일" — 공개 페이지 일관성. 30년차 UI/UX 기준(memory `feedback_uiux_unified_master`).

### 완료된 작업
- **로고 크기 통일** — 문서뷰어형 공개 5종(`/planQ-slogan_color.svg`)이 120px/88px 혼재 → **120px 통일**. Post/QNote 88→120 (Doc/Invoice/Sign 은 이미 120).
- **터치타겟 44px 통일** — 모든 공개 주요 CTA/버튼 `min-height:44px`:
  - 카드형 4종 CTA/CTASecondary(`padding:10px 20px`→+44px): Task/File/Kb/Calendar
  - 문서뷰어 PrintBtn/SignBtn(`7px 14px`→44px), Invoice NotifyBtn/Modal 버튼, Sign Primary/Secondary/Reject(40→44px)
  - 인라인 마이크로 버튼(복사·Sm·X닫기·캔버스지우기)은 프로젝트 아이콘 기준 36px (CLAUDE.md 반응형 #2)
  - SharePasswordPrompt 입력행(Input/Toggle/Submit) 44px 정렬
- 카드형 4종(Task/File/Kb/Calendar)은 로고 이미지 없는 프리뷰 디자인 — 로고 통일 비대상(버튼만 적용).

### 검증
- 빌드 **EXIT 0** (tsc -b 타입 통과 + vite emit) · dev 공개 라우트 200 · i18n 신규 문자열 0(styled CSS만 변경, 하드코딩 무)
- 수정 10 파일: `Public/{PublicTaskPage,PublicFilePage,PublicKbDocumentPage,PublicCalendarEventPage,SharePasswordPrompt}` + `QBill/PublicInvoicePage` + `QDocs/{PublicDocPage,PublicPostPage,PublicSignPage}` + `QNote/PublicQNoteSessionPage`

## 다음 할 일
- (공개뷰 폴리시 완료) — 다음 사이클 신규 기능 또는 운영 배포 대기

---

## ✅ N+91 완료 — §8.5 고객용 task 직렬화 (내부 운영 데이터 격리)

> **계기:** session-state "다음 할 일" §8.5. 고객(Client)이 업무 조회 시 내부 운영 데이터(공수 예측/실제 시간·AI 예측 출처·일별 진행 스냅샷·내부 댓글)가 그대로 노출되던 멀티테넌트 정보 누수 차단.

### 완료된 작업
- **`utils/taskClientView.js` 신규** — `serializeTaskForClient(json)` 단일 헬퍼. 차단: `estimated_hours`/`actual_hours`/`actual_source`/`latest_estimation_source`/`daily_progress`/`cue_*` 메타 + internal·personal 댓글. 유지: progress_percent(진행률 — Irene 결정: 고객 신뢰·투명성), title/description/body/status/shared 댓글.
- **`routes/tasks.js`** — `GET /:id/detail` + `GET /by-business` list 에 client 분기 적용 (기존 댓글 필터 흡수)
- **`routes/task_workflow.js`** — client(요청자) 도달 가능한 3 라우트 sanitize: `POST /:id/reviewers`, `PATCH /:id/policy`, `GET /:id/workflow` (`isClientUser` 헬퍼)

### 검증
- 실 API E2E **23/23 PASS** (business 3, owner=3 / client=27, 통제 task 생성→검증→원복)
  - owner 무회귀: 시간·양쪽 댓글 보임
  - client: 시간/예측출처/daily_progress 제거, progress_percent(40)·shared 댓글(1)·title 유지
  - list/workflow 동일 검증
- 공개 share 뷰(`routes/share.js`)는 extraMeta 로 status/due_date 만 노출 — 누수 없음(이미 안전)
- DB 스키마 변경 0, 프론트 변경 0 (drawer 가 `|| []` null-safe — 무회귀)

### 수정/생성 파일
- `dev-backend/utils/taskClientView.js` (신규)
- `dev-backend/routes/tasks.js`, `dev-backend/routes/task_workflow.js`

## 다음 할 일
- 공개뷰 폴리시 (공개 페이지 터치타겟 44px 통일, 로고 크기 통일)

---

## ✅ N+90 완료 — 모바일 UI/UX 개선

### 완료된 작업 (이번 세션)
- **Q Talk 채널 빠른 전환 모바일 배치** — 데스크탑은 헤더 우측, 모바일은 채팅방 이름 아래 별도 줄 (MobileChannelRow)
- **채널 버튼 이름 잘림 수정** — max-width 제거 → 채널명 전체 표시
- **모바일 소속 구분자 제거** — border-left 제거로 간결하게
- **결제 유예 배너 헤더 아래 배치** — MainContent padding-top: 56px 추가
- **결제 유예 배너 1단 레이아웃** — 모바일에서 아이콘 숨김 + 텍스트 세로 흐름 + CTA 인라인

### 수정된 파일
- `dev-frontend/src/pages/QTalk/ChatPanel.tsx`
- `dev-frontend/src/components/Layout/MainLayout.tsx`
- `dev-frontend/src/components/Layout/WorkspaceBillingBanner.tsx`

## 다음 할 일
- §8.5 client-facing serializer (`serializeTaskForClient` — 예측/실제시간·내부댓글 차단)
- 공개뷰 폴리시 (터치타겟 44px 통일, 로고 크기 통일)

## 환경
- dev: 3003 (dev.planq.kr)
- prod: planq.kr 3004 (v1.33.0)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
