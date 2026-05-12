# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-12
**작업 상태:** 진행 — 모바일 반응형 QA (커밋 대기)
**버전:** v1.6.1 운영 (dev 빌드 완료, 39 파일 수정)

---

## 진행 중인 작업

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
