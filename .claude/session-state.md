# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-12
**작업 상태:** 완료 — v1.7.0 운영 라이브 (사이클 N+10)
**버전:** v1.7.0 (commits `5807d2f` 181s + `da62196` 49s hotfix)

---

## 사이클 N+10 운영 라이브 (2026-05-12)

### 메인 (commit 5807d2f, 181s)
- 활성 conv unread 차단 — LeftPanel 시각 차단 + socket message:new 시 자동 markRead
- refresh_tokens.client_kind ENUM('pwa','web') 컬럼 + PWA 365일 / web 30일 sliding renewal
- X-Client-Kind 헤더 자동 전달 (login/register/refresh)
- 핀 토글 socket emit (io.to user:N) + 다중 디바이스 즉시 동기화. server.js user 별 room 자동 join
- 보관함 시스템 — GET archived / POST unarchive / DELETE 라우트 + ArchivedChatsModal + LeftPanel 풋터 진입점
- LoginPage 100dvh 모바일 풀스크린 + safe-area-inset-bottom
- CalendarPicker createPortal Wrapper stopPropagation — 캘린더 날짜 클릭 시 React tree bubble 로 detail drawer 열리던 버그 fix (10 호출처 일괄 해결)
- 로그인 라벨 "(7일)" 제거
- Conversation.archivedBy User association + i18n key ko/en 양쪽 풀세트

### Hotfix (commit da62196, 49s)
- 보관함 라우트 순서 충돌 fix — `/:businessId/archived` 를 `/:businessId/:id` 앞으로 (Express 정의 순서 매칭 함정)

### 직전 사이클 (lua 모바일 반응형 — commit 2b64012)
이전에 진행되던 모바일 반응형 QA (모달 GNB 오버랩, 로그아웃 버튼, i18n, 모달 디자인 통일) 가 lua 의 commit 2b64012 로 정리됨.

---

## 이전 진행 기록

### 모바일 반응형 QA (2026-05-12)
모달 GNB 오버랩 fix + 로그아웃 버튼 visibility + i18n + 모달 디자인 통일

| 항목 | 상태 | 설명 |
|---|---|---|
| 모달 GNB 오버랩 | ✅ | 17+ 파일에 `margin-top: 60px; height: calc(100dvh - 60px)` 적용 |
| 모바일 로그아웃 버튼 | ✅ | Sidebar `100dvh` + SidebarFooter `safe-area-inset-bottom` |
| PageShell 헤더 래핑 | ✅ | `flex-wrap: wrap` — 버튼 잘림 방지 |
| Q Info i18n | ✅ | knowledge.json (en/ko) `csvUpload`, `aiIngest` 키 추가 |
| 모달 디자인 통일 | ✅ | KnowledgePage + NewInvoiceModal → Q Calendar 패턴 |
| PostsPage.tsx | ✅ | EmptyList 미사용 컴포넌트 제거 (TS6133) |

### 수정 파일 (39개)
```
MainLayout.tsx, PageShell.tsx, PanelHeader.tsx
KnowledgePage.tsx, KbAiIngestModal.tsx, KbCsvIngestModal.tsx
NewInvoiceModal.tsx, CheckoutModal.tsx
QCalendarPage.tsx, NewEventModal.tsx, CalendarPicker.tsx
QProjectPage.tsx, DocsTab.tsx, ProcessPartsTab.tsx
QTaskPage.tsx, TaskDetailDrawer.tsx, AiTaskCreateModal.tsx
TemplateSaveModal.tsx, TemplateSelectModal.tsx, WeeklyReviewModal.tsx
PostsPage.tsx, PostAiModal.tsx, PostSignatureModal.tsx, SlotFormModal.tsx
NewDocumentModal.tsx, StartMeetingModal.tsx
ChatSettingsModal.tsx, NewChatModal.tsx, NewProjectModal.tsx
GlobalSearchModal.tsx, PlanSettings.tsx, StorageSettings.tsx
AdminBusinessesPage.tsx
knowledge.json (en/ko), qcalendar.json (en/ko), qproject.json (en/ko)
```

### 검증
- 헬스체크 27/27 PASS
- 빌드 성공, TS 에러 0
- PM2 planq-dev-backend + planq-qnote online

---

## 완료된 작업 (이전 세션 — 사이클 N+9)

### 청크 1-4 + 라이트박스 + editor-image + 인박스 fix
- v1.6.0 + v1.6.1 운영 라이브
- 자세한 내역: commit log 및 DEVELOPMENT_PLAN.md 참조

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)

### 청크 5 (남은 — 사이클 N+10)
- VisibilityBadge 카드/행 적용 (Q file, Q docs, Q info)
- VisibilityChangeModal 진입점 (배지 클릭)
- 5중 시각 시그널 (헤더 sub-line, dismiss 박스, popup 자물쇠, FirstVisitTour)
- DocsTab 카드 hover share 아이콘
- 동적 OG — backend SSR + 운영 nginx proxy

### 차순위
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- 설문 기능 MVP (4 사이클)

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- JWT_SECRET dev/prod 분리
- platform_admin: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한 640

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 4단계 visibility: `/opt/planq/docs/VISIBILITY_VOCABULARY.md`
- 개인 보관함 설계: `/opt/planq/docs/PERSONAL_VAULT_DESIGN.md`
- 공유 미리보기 정책: `/opt/planq/docs/SHARE_PREVIEW_POLICY.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
