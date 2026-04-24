# PlanQ - 개발 진행 현황

> **최종 업데이트:** 2026-04-24 (확인 필요 Inbox + 사이드바 재편 + Phase 8/9 로드맵 + UNIFIED_CONTEXT_DESIGN)

---

## ✅ 완료: 전체 코드 감사 · 보안 강화 · 리포트/Q Bill 기획 (2026-04-22)

**설계 문서:** `docs/Q_BILL_SPEC.md` · `docs/FINANCIAL_REPORTS_SPEC.md`

이번 세션은 **초대 플로우 완성 → Q Talk 첨부 → Q Note Drive 동기화 → Drive webhook → 멤버 관리 Phase 2 → 전체 감사 → 보안 수정 → 리포트·Q Bill 기획** 까지 대규모 스프린트. 감사 에이전트 3개 병렬로 Critical/High 문제 전수 발굴·수정.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **초대 플로우 3청크** | 프로젝트 고객(만료·email 검증·email 발송)·워크스페이스 고객(user_id nullable + invite_token)·멤버 초대 + 통합 `/api/invites/:token` | ✅ |
| **업무 삭제 기능** | 우측 드로어 Danger Zone · 권한(owner/admin/본인) · 로즈 칩으로 "{요청자}에게 요청받음" | ✅ |
| **Q Talk 메시지 첨부** | `/api/message-attachments/*` · 이미지 썸네일 + 파일 chip · Socket.IO 이벤트 | ✅ |
| **Q Note → Drive 자동 저장** | Python ingest 후 Node `/api/cloud/qnote/sync` · 내부 API 키 인증 · Q Note 세션 폴더 자동 생성 | ✅ |
| **Drive changes.watch** | `/api/cloud/watch/start/:businessId` · webhook 수신 · Socket.IO 브로드캐스트 · BusinessCloudToken 확장 | ✅ |
| **프로젝트 상태 토글 · 삭제** | 카드 컨텍스트 메뉴 + closed 필터 · owner-only 가드 | ✅ |
| **멤버 관리 Phase 2** | removed_at soft delete · role 변경 API · 마지막 오너 보호 · defaultScope 전역 차단 | ✅ |
| **QNote/QProject i18n 130키** | 하드코딩 제거 (Agent A) — ko/en 양쪽 완비 | ✅ |
| **ProjectClient FK 전환** | email/name 문자열 매칭 → contact_user_id FK (과거 데이터 backfill) | ✅ |
| **운영서버 배포 스크립트** | `deploy-to-production.sh` + `rollback-production.sh` (POS 패턴 기반) | ✅ |
| **리포트 + Q Bill 기획** | 통계·분석 6탭 + Q Bill 5탭 + 자동 해석 + 월간 보고서 설계 완료 | ✅ |
| **좌측메뉴 확장** | Q Bill 활성 · 통계·분석 섹션 6개 + ComingSoon 페이지 · /billing→/bills 통합 | ✅ |

### 🔒 보안 강화 (전체 감사 후속)

| # | 수정 | 심각도 | 파일 |
|---|------|:----:|------|
| 1 | IDOR — users.js refresh_token/reset_token 유출 차단 + 본인/admin 만 조회 | **Critical** | routes/users.js |
| 2 | `req.user.role` → `platform_role` 통일 (tasks·businesses 2곳) | High | routes/tasks.js, businesses.js |
| 3 | 프로젝트 종료/삭제 owner-only | High | routes/projects.js |
| 4 | OAuth state HMAC 서명 + 10분 TTL | High | services/gdrive.js |
| 5 | `JWT_SECRET \|\| 'planq'` 폴백 제거 | High | routes/cloud.js |
| 6 | `/public/attach` 이미지 MIME 만 + nosniff + inline | Med | routes/task_attachments.js |
| 7 | conversations participants business 소속 검증 | Med | routes/conversations.js |
| 8 | plan/invoices owner-only 가드 | Med | routes/plan.js, invoices.js |
| 9 | invites accept 트랜잭션 + FOR UPDATE lock | High | routes/invites.js |
| 10 | businesses role/DELETE 트랜잭션 + 마지막 오너 race 방어 | High | routes/businesses.js |
| 11 | raw fetch + localStorage token → apiFetch | Med | WorkspaceSettingsPage.tsx |
| 12 | refresh_token SHA-256 해시 저장 (login/register/refresh) | Low | routes/auth.js |
| 13 | CSP `script-src 'unsafe-inline'` 제거 (Vite 번들만 허용) | Low | middleware/security.js |
| 14 | BusinessMember `defaultScope: { removed_at: null }` 전역 차단 | - | models/BusinessMember.js |
| 15 | 22개 라우트 `checkBusinessAccess` 누락 지점 보강 (Agent) | High | tasks/calendar/file_folders/projects |

**회귀 테스트**: 10/10 통과 (IDOR·권한·OAuth·테넌트 격리·세금계산서 경로 등).
**헬스체크**: 27/27 유지.

### 기획 결정 (Irene 확정)

- **포트원 V2 Starter (무료, 월 5천만 미만)** — 국내 토스·해외 Stripe 채널 통합
- **팝빌 세금계산서** — 워크스페이스 설정에서 키 등록 시 자동 발행
- **고객 `country`·`is_business` 자동 분기** — 부가세·언어·세금계산서
- **Q Bill** = 최상위 메뉴 (견적·청구·결제·세금계산서 통합) · 프로젝트 상세에도 Bill 탭
- **통계·분석** 6 탭 = 개요·업무시간·수익성·팀생산성·비용재무·보고서 (최하위 메뉴)
- **자동 해석** = 룰(즉시) + Cue LLM(자연어) 하이브리드
- **운영서버** = 실결제 시작 시점 전에만 필요 (개발 중 dev 로 전부 검증)

### 수정된 파일 (주요)

**백엔드 (22개)**
- `routes/auth.js`, `users.js`, `businesses.js`, `projects.js`, `tasks.js`, `calendar.js`,
- `clients.js`, `conversations.js`, `plan.js`, `invoices.js`, `task_attachments.js`,
- `file_folders.js`, `cloud.js`, `invites.js` (신규), `message_attachments.js` (신규)
- `middleware/security.js`, `services/gdrive.js`, `services/emailService.js`
- `models/BusinessMember.js`, `BusinessCloudToken.js`, `Client.js`
- `server.js`

**프론트엔드 (40+개)**
- `pages/Settings/WorkspaceSettingsPage.tsx`, `PlanSettings.tsx`
- `pages/Clients/ClientsPage.tsx`
- `pages/QTalk/ChatPanel.tsx`, `QTalkPage.tsx`, `LeftPanel.tsx`, `RightPanel.tsx`, `NewProjectModal.tsx`
- `pages/QNote/QNotePage.tsx`, `StartMeetingModal.tsx`
- `pages/QProject/*.tsx` (TasksTab, ProjectTaskList, ProcessPartsTab, DocsTab)
- `pages/QTask/QTaskPage.tsx`, `components/QTask/TaskDetailDrawer.tsx`
- `pages/Admin/AdminBusinessesPage.tsx`
- `pages/Login/LoginPage.tsx`, `Register/RegisterPage.tsx`, `Invite/InvitePage.tsx`
- `pages/ComingSoon/ComingSoonPage.tsx` (신규)
- `components/Layout/MainLayout.tsx`, `components/Common/*.tsx`
- `components/ProtectedRoute.tsx`
- `App.tsx` · 16개 i18n json (ko/en)

**설계 문서 (2개 신규)**
- `docs/Q_BILL_SPEC.md`
- `docs/FINANCIAL_REPORTS_SPEC.md`

**운영 스크립트 (2개 신규)**
- `deploy-to-production.sh`
- `rollback-production.sh`

### Phase 순서 (확정, 10주)

1. **Phase 0** — DB 기반 스키마 확장 (1주)
2. **Phase 1** — Q Bill 견적·청구·결제 (3주)
3. **Phase 2** — 세금계산서 자동화 (0.5주)
4. **Phase 3** — 프로젝트 Bill 탭 + 시간기반 자동청구 (1주)
5. **Phase 4** — 통계 대시보드 5개 + 자동해석 (2주)
6. **Phase 5** — 월간 보고서 자동 생성 + PDF (1주)
7. **Phase 6** — PlanQ 자체 구독 청구 (0.5주)
8. **Phase 7** — 운영서버 세팅 + 실배포 (0.5주)
9. **Phase 8** — 반응형 스프린트 (1주) — 전 페이지 모바일/태블릿 일괄 적용

### Phase 8 — 반응형 스프린트 상세 (2026-04-24 신설)

**원칙:** 기능 완성 후 일괄 적용. 기능별 찔끔찔끔 금지 (Q Docs 상단 탭 같은 파편화 방지).

**핵심 패턴:**
- **햄버거 드로어 2뎁스 아코디언** — 통계·분석/설정 1뎁스 탭 시 그 자리 인라인 확장 (Slack/Linear 방식)
- **마스터-디테일 드릴다운** — Q Talk/Q Note/Q Task/Q Calendar/Q Docs 모바일에서 리스트→상세 풀 라우트 + 상단 `<` 뒤로 (iOS Mail 표준)
- **공용 `<ListDetailLayout>` 훅** — 데스크탑 3컬럼 ↔ 모바일 드릴다운 자동 전환. `?task=:id` URL 싱크 규칙을 모바일에서 `/tasks/:id` 풀 라우트로 연결
- **모달/드로어 풀스크린화** ≤640px — `DetailDrawer` 이미 지원 (width: 100vw)
- **터치 타겟 44×44 일괄 상향** — 현재 36 기준을 Phase 8 때 전역 업그레이드
- **Safe-area inset** — iOS 노치 대응

**범위 (1주 / Day 1~7):**
| Day | 작업 |
|---|---|
| 1 | 전역 기반 — breakpoint 토큰 확장, `useIsMobile` 훅, 햄버거 아코디언 구현, 사이드바 Secondary 모바일 해제 |
| 2 | `<ListDetailLayout>` 공용 컴포넌트 — 리스트/상세 자동 라우팅, 뒤로가기 스택 |
| 3 | Q Talk + Q Note 모바일 적용 |
| 4 | Q Task + Q Calendar + Q Docs 모바일 (Docs 상단 탭 → 드릴다운 재작업) |
| 5 | 대시보드 To do + 통계/설정 2차 패널 + 폼·모달·드로어 풀스크린화 |
| 6 | 터치 타겟 44px 상향 · Safe-area · 가로스크롤 제거 · 키보드 대응 |
| 7 | 실기기 QA (iPhone SE/13/14 Pro Max, 갤럭시 S22/S23, iPad) + 최종 보정 |

**그전까지 신규 코드 규칙 (기존 3원칙 유지):**
1. 고정 px 폭 금지 — `max-width`/`flex`/`minmax()`
2. 인라인 `style={{ width }}` 금지 — styled-components 경유
3. 아이콘 버튼 최소 36×36 — Phase 8 때 일괄 44로 상향

**현재 파편화 이슈 (Phase 8 정리 대상):**
- Q Docs 상단 가로 탭 (좌측 폴더 트리 축소) — 드릴다운으로 재작업
- `SecondaryPanel` 모바일 `display: none` — 햄버거 아코디언으로 교체

---

## ✅ 완료: 파일 시스템 Phase 1·1+·2A — 문서 탭 실구현 (2026-04-21)

**설계 문서:** `docs/FILE_SYSTEM_DESIGN.md` · `docs/OPS_ROADMAP.md`

프로젝트 문서 탭을 placeholder 에서 **자체 스토리지 + SHA-256 dedup + 플랜 쿼터 + 폴더 시스템 + 대량 작업** 이 모두 작동하는 실제 파일 허브로 교체. 자동 집계(Q Talk·Q Task 첨부)도 포함. 30년차 UI/UX 감사 반영.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **설계 문서** | `docs/FILE_SYSTEM_DESIGN.md` (스키마/API/UI/롤아웃 전 10섹션) + `docs/OPS_ROADMAP.md` (Stage 0~4 임계치) | ✅ |
| **Phase 1 UI Mock** | `pages/QProject/DocsTab.tsx` + `services/files.ts` (타입·mock) + i18n ko/en | ✅ |
| **Phase 1+ UI 보강** | 좌측 폴더 트리 + 대량 선택 모드 + 플로팅 액션바 + 재귀 폴더 삭제 모달 | ✅ |
| **30년차 UI/UX 감사 8건** | SVG 아이콘(이모지→Lucide), 확장자별 색상 아이콘(PDF빨강/DOC파랑/XLS녹색/PPT주황/ZIP보라/이미지핑크), Progressive drop zone, skeleton shimmer, focus-visible 10건, 조건부 grid-template-columns, 폴더 삭제 파일수 안내, 다운로드 아이콘 헤더 상단 이동 | ✅ |
| **Phase 2A DB 스키마** | `files` 확장 (project_id/folder_id/storage_provider/external_id/external_url/content_hash/ref_count/deleted_at) + 신규 테이블 3: `file_folders`, `business_storage_usage`, `ops_capacity_log` | ✅ |
| **Phase 2A Backend — routes/files.js** | 업로드(쿼터+SHA256 dedup), 이동, 소프트 삭제, 대량 삭제, 다운로드, 스토리지 상태 | ✅ |
| **Phase 2A Backend — routes/file_folders.js** | CRUD + 재귀 삭제 시 내부 파일 parent 로 자동 이동 | ✅ |
| **Phase 2A 집계 API** | `GET /api/projects/:id/files` — direct + chat(MessageAttachment) + task(TaskAttachment) 통합. id 접두어 규칙 (`direct-12`/`chat-45`/`task-7`) | ✅ |
| **Phase 2A OPS 자동화** | `scripts/ops-capacity-check.js` — 주간 스냅샷 + Stage 전환 감지 + provider 비중 트래킹 | ✅ |
| **서비스 실 API 연결** | `services/files.ts` mock 전부 제거 → apiFetch 기반 실 API (upload/download/move/bulk-delete/folders/storage) | ✅ |
| **검증** | 헬스체크 27/27, Phase 2A E2E 22/22, 빌드 tsc 0 error (gzip 433 kB), SPA 9 라우트 전부 200, 멀티테넌트 격리 (타 biz 403) | ✅ |

### 플랜별 쿼터 (운영 기준)

| 플랜 | 파일당 | 총 스토리지 |
|---|---|---|
| Free | 10 MB | **1 GB** |
| Basic | 30 MB | **50 GB** |
| Pro | 50 MB | **500 GB** |

SHA-256 dedup: 같은 파일 여러 폴더/프로젝트 첨부 시 물리 파일 1개만 저장, `ref_count` 로 관리. 삭제 시 `ref_count` 0 도달해야 물리 제거.

### 자동 타이밍 알림 (docs/OPS_ROADMAP.md)

| Stage | 임계치 (biz 또는 용량) | 도입 항목 |
|---|---|---|
| Stage 0 (지금) | — | 쿼터 + dedup + 휴지통 + OPS 체크 스크립트 |
| Stage 1 | 100 biz or 50 GB | 휴지통 자동 정리 cron + 썸네일 자동 생성 |
| Stage 2 | 500 biz or 500 GB | Cold storage (B2/R2) + 서명 URL |
| Stage 3 | 2,000 biz or 5 TB | CDN + Redis 업로드 큐 + 모니터링 스택 |

주 1회 `scripts/ops-capacity-check.js` → Stage 전환 감지 시 로그 (SMTP 구축 후 이메일 전환).

### 신규 파일

**Backend**
- `models/FileFolder.js`, `models/BusinessStorageUsage.js`, `models/OpsCapacityLog.js`
- `routes/file_folders.js`, `scripts/ops-capacity-check.js`

**Frontend**
- `pages/QProject/DocsTab.tsx` (780줄 — 폴더 트리 + 대량 선택 + 드롭존 + 미리보기)
- `services/files.ts` (실 API 래퍼)

**Docs**
- `docs/FILE_SYSTEM_DESIGN.md` · `docs/OPS_ROADMAP.md`

### 수정 파일

- Backend: `models/File.js`, `models/index.js`, `routes/files.js`, `routes/projects.js`, `server.js`
- Frontend: `pages/QProject/QProjectDetailPage.tsx` (문서 탭 placeholder → DocsTab 교체)
- 로케일: `public/locales/{ko,en}/qproject.json` (tab/docs/folder/bulk 키 추가)

### 다음 (외부 클라우드 연동)

| Phase | 내용 | 예상 | 상태 |
|---|---|---|:-:|
| **Phase 2B** | Google Drive App Folder OAuth + Direct upload + Webhook | 4일 | ⏳ 선결: OAuth 앱 등록 |
| **Phase 4** | Q Docs 전역 페이지 (동일 DocsTab scope 재사용) | 1일 | ⏳ |

**OAuth 선결 (Irene 작업 — 15분)**
- Google Cloud Console — OAuth Client ID + redirect URI (dev.planq.kr 먼저) + 동의 화면

### 알려진 범위 외 이슈
- `QProjectDetailPage.tsx` 전반 기존 한글 하드코딩 62건 — 별도 작업으로 분기 (Phase 2A 와 무관)
- express-rate-limit `X-Forwarded-For` warning — nginx proxy trust 설정 이슈

---

---

## ✅ 완료: Calendar Phase A~E 전체 구현 + 드로어 반응형 통일 (2026-04-20)

캘린더 시스템을 DB→API→UI→반복→화상→Q Task 통합까지 한 사이클 완주. 동시에 모든 우측 드로어를 햄버거 패턴(왼쪽 strip 남김) + 엣지 핸들 + 접근성 훅으로 통일.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Phase A (DB+API)** | `calendar_events` + `calendar_event_attendees` 테이블, CRUD 6개 엔드포인트, visibility personal/business, attendee 응답, AuditLog 4종 | ✅ |
| **Phase A 검증** | API 24/24 PASS (역할별 owner/member, 엣지 케이스, 멀티테넌트 격리) | ✅ |
| **Phase B (UI)** | `pages/QCalendar/*` 신규 8파일. 월/주/일 3뷰, NewEventModal, EventDrawer, MonthView, TimeGridView, URL 싱크, i18n ko/en | ✅ |
| **Phase B API 연결** | Mock 제거 → `services/calendar.ts` 실 API. 낙관적 업데이트, 로딩/에러 UI | ✅ |
| **Phase C (반복)** | `rrule.js` 설치, 백엔드 range 쿼리 RRULE expansion, 프리셋 6종(없음/매일/매주/2주마다/매월/매년), 드로어 배지 | ✅ |
| **Phase C 검증** | DAILY 7 인스턴스, WEEKLY 4, BIWEEKLY 2, MONTHLY 6 — 10/10 PASS | ✅ |
| **Phase D (화상미팅)** | `services/daily.js` Daily.co 래퍼, `auto_create_meeting` 옵션, 기존 이벤트 지연 방 생성, iframe 임베드, `video/status` 엔드포인트 | ✅ |
| **Phase D 실연결** | `DAILY_API_KEY` 설정 → `planq.daily.co` 실 방 생성 확인 | ✅ |
| **Phase E (Q Task 통합)** | `taskToEvent.ts` 변환기, due_date 있는 업무 종일 이벤트로 표시, 4필터(전체/나/업무/일정), 업무 클릭 시 캘린더에서 TaskDetailDrawer 오버레이 | ✅ |
| **Phase E 버그픽스** | `due_date` 풀 ISO 파싱 수정, 업무 단일 날짜 표시(기간 중복 제거), 월 뷰 팝오버(+N 더보기) | ✅ |
| **CalendarPicker 재사용** | NewEventModal 의 native datetime-local → 기존 `CalendarPicker` + `PlanQSelect` 시간 드롭다운 | ✅ |
| **PlanQSelect 개선** | `density='compact'` prop 추가 (옵션 many 리스트용, 패딩 절반) | ✅ |
| **DetailDrawer 프리미티브** | 공용 `components/Common/DetailDrawer.tsx` + Header/Body/Footer 서브. 반응형 3-구간 내장 | ✅ |
| **반응형 드로어 통일** | 5개 드로어 모두 `min(desktopW, 100vw - 56px)` 폭 — 좌측 56px strip 남김 (햄버거 패턴) | ✅ |
| **엣지 핸들 + 팝아웃 패널** | `FloatingPanelToggle.tsx` — 얇은 우측 세로 핸들(8px), 화살표 회전, 열면 right:0 → panel-width 이동. pulse 최초 1회(localStorage) | ✅ |
| **접근성 훅 2종** | `useFocusTrap` (Tab 순회 + 복귀), `useEscapeStack` (중첩 모달 안전) — DetailDrawer·TaskDetailDrawer 에 적용 | ✅ |
| **body scroll lock** | `useBodyScrollLock` — 5곳 (드로어·RightPanel) 통합 | ✅ |
| **키보드 단축키** | `⌘/` · `Ctrl+\` 우측 패널 토글 — QTask, QTalk | ✅ |
| **뒷배경 blur 제거** | Irene 피드백 — 모든 드로어 `backdrop-filter: blur` 제거, dim 0.32→0.08 | ✅ |
| **필터 네이밍** | "내 것" → "나", "업무만/일정만" → "업무/일정" (중복어 제거) | ✅ |
| **레거시 `/raw` URL 호환** | 구 task body 의 `/api/tasks/attachments/:id/raw` 자동 302 → `/public/attach/:storedName` | ✅ |

### 신규 파일
**Backend**
- `models/CalendarEvent.js`, `models/CalendarEventAttendee.js`
- `routes/calendar.js`, `services/daily.js`

**Frontend**
- `pages/QCalendar/` 9파일 (QCalendarPage, MonthView, TimeGridView, EventDrawer, NewEventModal, types, dateUtils, categoryColors, taskToEvent)
- `components/Common/DetailDrawer.tsx`, `components/Common/FloatingPanelToggle.tsx`
- `hooks/useBodyScrollLock.ts`, `useFocusTrap.ts`, `useEscapeStack.ts`, `useMediaQuery.ts`
- `services/calendar.ts`
- `public/locales/ko/qcalendar.json`, `public/locales/en/qcalendar.json`

### 수정 파일
- Backend: `routes/task_attachments.js` (레거시 raw 호환), `models/index.js` (associations), `server.js` (라우트 마운트)
- Frontend: `App.tsx`, `i18n.ts`, `components/QTask/TaskDetailDrawer.tsx`, `components/Common/PlanQSelect.tsx`, `pages/Clients/ClientsPage.tsx`, `pages/QTask/QTaskPage.tsx`, `pages/QTalk/RightPanel.tsx`, `pages/QProject/TasksTab.tsx`
- 원칙: `CLAUDE.md` (드로어 접근성 3훅, 반응형 드로어 3-구간 정책), 메모리 1건 추가 (`feedback_responsive_drawer.md`)

### 검증 결과
- 헬스체크 27/27 (반복)
- Phase A+B+C+D+E E2E 20/20 PASS
- Phase A 단독 24/24, Phase C 단독 10/10
- 라우트 12/12 전부 200
- 빌드 tsc 0 error, gzip ~422 kB

### 알려진 제약
- RRULE 단일 인스턴스 수정/삭제 미구현 (parent 건드리면 모든 인스턴스 영향)
- RRULE UNTIL/COUNT 미지원 (프리셋은 무한 반복)
- Daily.co API 키는 dev 키 (Irene 대시보드 발급). 프로덕션 배포 전 rotate 필요

---

## ✅ 완료: 대규모 세션 — 드로어·재클릭 토글·샘플 데이터·고객 관리 완성 (2026-04-20)

하루 세션에서 1) Task 드로어 추출·Gantt 공용화, 2) 브랜드 컨셉 최종화, 3) 반응형 Phase 0 토큰, 4) 공용 `<EmptyState>` + Q Talk 재설계, 5) Q Project 감사·샘플 시드 + `project_id` 이관 버그 수정, 6) Irene 3-역할 실데이터(owner/member/client), 7) 우측 패널 일반대화 섹션, 8) 고객 페이지 마스터-디테일 드로어 + 인라인 편집 + 활성 토글 + 히스토리, 9) 이메일 초대 API 준비 + 메일 시스템 출시 스프린트 보류 결정, 10) 캘린더 설계 확정.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **공용 컴포넌트** | `components/QTask/TaskDetailDrawer.tsx` 신규 (QTask/QProject 공용) | ✅ |
| **공용 컴포넌트** | `components/Common/GanttTrack.tsx` 공용 간트(스크롤 동기화·눈금·파스텔 바·today 마커). 3곳 재사용 | ✅ |
| **공용 컴포넌트** | `components/Common/EmptyState.tsx` 통일 (Q Note/Talk/Task 동일 스타일) | ✅ |
| **반응형 Phase 0** | `theme/breakpoints.ts` 토큰 + CLAUDE.md 3원칙 | ✅ |
| **재클릭 토글 원칙** | Q Talk/Note/Task/Project 리스트·드로어 전역 적용 + CLAUDE.md/메모리 명문화 | ✅ |
| **Q Talk 재설계** | `POST /api/conversations` 독립 대화 생성. 프로젝트 선택적 연결. NewChatModal 신규. 프로젝트 자동 채널 제거 | ✅ |
| **Q Talk UX** | 좌측 필터 탭 제거 (미동작 코드). 채팅방 단위 `?project=X&conv=Y` URL 싱크. 재진입 복원 | ✅ |
| **Q Talk 우측패널** | 프로젝트 미선택 시 패널 숨김. 중앙 empty state 공용 EmptyState 적용 | ✅ |
| **Q Note** | 좌측 헤더·검색 border 통일. main 배경 #FFFFFF. Layout height 100vh (바닥 회색 제거). 세션 상태 pill Q Task 통일 | ✅ |
| **Q Task** | 리스트 빈 상태 Q Note 스타일 EmptyState + CTA. 뷰 모드 `?view=` URL 싱크. scope 별 인사이트 영역 (전체업무/요청하기/workspace) | ✅ |
| **Q Project 감사** | `docs/QPROJECT_AUDIT.md` 신규 — 미구현 목록 3단계 우선순위. 샘플 6 시나리오 시드 (A~F) | ✅ |
| **Q Project 연동** | `PUT /tasks/by-business/:bizId/:id` 에 `project_id` 이관 허용 (버그 수정). 검증 13/13 PASS | ✅ |
| **프로젝트 완료 처리** | 상세정보 탭 상태 3-segment (active/paused/closed). closed 모달 + 고객 체크박스 내보내기. 대화 자동 archived cascade | ✅ |
| **Irene 3-역할** | 워프로랩(owner) 실데이터, PlanQ 테스트(member) 6 프로젝트+21 업무, 브랜드 파트너스(client) 2 프로젝트+8 업무+4 대화 시드 | ✅ |
| **고객 페이지** | 마스터-디테일 드로어 (Linear/Pipedrive 패턴). 헤더 아바타+인라인 편집+활성 Switch, 연락처·메모·프로젝트·대화·히스토리 섹션 | ✅ |
| **고객 hard delete** | `DELETE /api/clients/:id` + ProjectClient 자동 정리 + removal-impact API + 경고 모달 | ✅ |
| **고객 초대** | `POST /api/clients/:bizId/invite` 이메일 기반 신규 초대 + 모달 UI + 프로젝트 고객 탭 "초대 대기/참여 중" pill | ✅ |
| **AuditLog** | client.invited/activated/archived/updated/deleted + project.client_added/removed 훅. 미들웨어 camelCase/snake_case 호환 | ✅ |
| **사이드바** | Business→**워크스페이스**, Features→**기능**, Admin→**관리**. Main 섹션 라벨 제거 | ✅ |
| **브랜드 컨셉** | `docs/BRAND_CONCEPT.md` 신규 10섹션. 슬로건 "일을 일답게 하다" / "일이 일이되지 않게". Q 이중의미 확장 | ✅ |
| **로그인 슬로건** | auth.json tagline "요청은 Queue로…" → "일이 일이되지 않게, PlanQ" 교체 | ✅ |
| **빈 상태 텍스트** | Q Note "기록을 시작해 보세요" / Q Talk "대화를 시작해 보세요" (중앙+우측 분리) | ✅ |
| **URL 싱크 확장** | Q Task `?view=list/kanban`. Q Project TasksTab `?view=split/list/timeline/calendar`. 모든 드로어 `?task=:id` 싱크 | ✅ |
| **파스텔 간트** | Gantt 바 `fg 진함` → `bg 파스텔 + border-left 3px fg + fg text` 로 정돈 | ✅ |
| **로드맵** | 메일 시스템 3일 출시 스프린트 보류, 타임라인 드래그 3단계 백로그 유지, 캘린더 Phase A~E 설계 확정 | ✅ |

### 신규 파일
- `dev-frontend/src/components/Common/EmptyState.tsx`
- `dev-frontend/src/components/Common/GanttTrack.tsx`
- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx`
- `dev-frontend/src/theme/breakpoints.ts`
- `dev-frontend/src/pages/QTalk/NewChatModal.tsx`
- `docs/BRAND_CONCEPT.md` · `docs/QPROJECT_AUDIT.md`
- 시드 6종: `seed-project-samples.js`, `seed-client-samples.js`, `seed-client-samples-biz3.js`, `seed-conversations-biz3.js`, `seed-conversations-biz6.js`, `seed-irene-client-biz7.js`

### 주요 수정 파일
- Backend: `middleware/audit.js` (양쪽 호환), `routes/clients.js` (drawer detail + invite + history + hard delete), `routes/projects.js` (cascade·project_id 이관·client audit hooks), `routes/conversations.js` (독립 생성), `routes/tasks.js` (project_id 이관 버그 수정)
- Frontend: `pages/Clients/ClientsPage.tsx` (마스터-디테일 전면 재작성), `pages/QTalk/*` (재설계), `pages/QTask/QTaskPage.tsx` (드로어 추출), `pages/QProject/QProjectDetailPage.tsx` (상태 토글·멤버·고객 관리), `pages/QProject/TasksTab.tsx` + `ProjectTaskList.tsx` (Gantt 공용 적용), `pages/QNote/QNotePage.tsx` (레이아웃 통일), `components/Layout/MainLayout.tsx` (사이드바 라벨)
- 로케일: ko/en 7 파일 갱신
- 원칙: `CLAUDE.md` 3건 (반응형·재클릭 토글·UI 규칙), 메모리 2건 추가

### 검증 결과
- 헬스체크 27/27 통과 (반복)
- API 18건 PASS (client drawer/history + archive toggle + invite + cascade + project_id 이관 + removal-impact)
- 빌드 성공 · tsc 0 error · gzip ~414 kB

### 알려진 미구현 (다음 세션 후보)
- **캘린더 Phase A~E (약 5일)** — DB/API/월주일 뷰/반복/**Daily.co 임베드 + 수동 링크**/Q Task 통합 + 4필터 (전체/내/업무만/일정만). 색상은 프로젝트 색 자동 상속 + 카테고리 팔레트(개인일정). Daily.co 선택 이유: 스타트업 트렌드·임베드 API·Q Note 탭 캡처 호환
- 문서 탭 실파일 업로드 · 프로젝트 삭제 UI · F5-2b `/invite/:token` 랜딩
- 메일 발송 시스템 (출시 직전 스프린트로 보류)
- 반응형 Phase 1~5 (기능 완성 후 일괄)

---

## 🗺️ 개발 로드맵 (2026-04-20 확정)

### 현재 방침
- **기능 우선**. 반응형·하이브리드앱 대응은 기능 95% 완료 후 스프린트로 몰아서 수행.
- i18n (ko/en) 은 신규 코드마다 즉시 적용 (기존 규칙 유지, 별도 스프린트 불요).
- **신규 코드부터는 반응형 3원칙** (고정 px 금지 / 아이콘 36+ / 인라인 style 금지) 준수 — `CLAUDE.md`·`theme/breakpoints.ts` 참조.

### 남은 기능 (우선순위)
1. ✅ **멤버 관리** — 프로젝트 상세정보 탭 (2026-04-20 완료)
2. **프로젝트 문서 탭 실구현** — 업로드·리스트·다운로드. 기존 files API 재사용. `docs/QPROJECT_AUDIT.md` 참조 🔴
3. **프로젝트 상태 토글 UI** — active/paused/closed 전환. 헤더 또는 상세정보 🔴
4. **프로젝트 삭제 UI** — 파괴적이므로 확인 모달 + cascade 정책 정리 🔴
5. **F5-2b 초대 랜딩 페이지** `/invite/:token`
6. **Q Talk NewChatModal** — 프로젝트 연결 + 참여자 선택 간소 모달
7. **lua 팀원 계정 세팅** — 실제 협업 테스트 환경
8. **NewProjectModal 채팅 채널 유연화** (0~N개)
9. **Q Talk Cue 자동 추출 트리거** (청크 5)
10. **Dashboard** (위젯 범위 합의 선행)

### 유보된 UX 개선 (후일)
- 프로젝트 아카이브/복제, 멤버 역할 프리셋, 색상 커스텀 입력
- 멤버 제거 시 담당 업무 재할당 UX
- 프로세스/문서 탭 빈 상태 CTA

### 반응형·하이브리드앱 스프린트 (기능 95% 이후)

| Phase | 내용 | 예상 |
|---|---|---|
| **Phase 0** ✅ | 브레이크포인트 토큰 + 3원칙 명문화 (2026-04-20 완료) | 완료 |
| Phase 1 | MainLayout 사이드바 햄버거화 + 하단 탭바 | 1일 |
| Phase 2 | Q Talk / Q Task 마스터-디테일 패턴 | 2일 |
| Phase 3 | Q Project 상세 + TasksTab 모바일 | 1일 |
| Phase 4 | Q Note 모바일 (회의 모드 세로 2단) | 1일 |
| Phase 5 | 터치 타겟(44×44) + 폰트 16+ 일괄 상향 | 0.5일 |
| 출시 직전 | Capacitor 하이브리드앱 래핑 (아이콘/스플래시/푸시) | 0.5일 |
| **소계** | Phase 1~5 + 래핑 | **약 6일** |

브레이크포인트: `phone ≤640 / tablet ≤1024 / desktop ≥1025`. 모바일 웹이 곧 하이브리드앱 UI.

### 유보 (후일 업데이트)
- **타임라인 바 드래그 수정** — 3단계 로드맵. 1단계(반나절) 바 전체 드래그+1일 스냅, 2단계(하루) 왼/오 핸들 분리, 3단계(하루+) 행간 이동·충돌 해결. 실수 방지 위해 Ctrl 드래그·Undo 토스트 권장.
- **메일 발송 시스템 — 출시 직전 스프린트 (2026-04-20 결정)**. 약 3일:
  1. `business_mail_configs` 테이블 (SMTP + from_address, 비밀번호 암호화) — 0.5일
  2. `/business/settings/mail` 페이지 (Nodemailer SMTP 설정 + 테스트 발송) — 0.5일
  3. 초대 이메일 템플릿 (ko/en) + 발송 라우트 — 0.5일
  4. `/invite/:token` 수락 랜딩 + 메시지 연결 (F5-2b) — 1일
  5. 실패 재시도 + AuditLog — 0.5일
  - **추천 스택:** Resend API (SPF/DKIM 자동, 무료 3,000통/월) + SMTP 병행 옵션
  - **이유:** 현재 사용자가 Irene+lua 뿐이라 수동 링크 복사로 충분. 반응형 스프린트와 같은 출시 직전 타이밍에 묶어서 처리가 효율적.

---

## ✅ 완료: 프로젝트 상세 업무 드로어 + 공용 Gantt + 반응형 로드맵 (2026-04-20)

- **TaskDetailDrawer 공용 컴포넌트** — QTaskPage 2200줄에서 드로어 전부 `components/QTask/TaskDetailDrawer.tsx` 로 추출. QProjectDetailPage TasksTab 에서 재사용 → 같은 페이지 오버레이로 상세 열기 (URL `?task=:id` 싱크).
- **GanttTrack 공용 프리미티브** — `useGanttScrollSync` / `<GanttHeader>` / `<GanttRowTrack>` / `<GanttBar>` 를 `components/Common/GanttTrack.tsx` 로 추출. ProjectTaskList 스플릿 뷰 + TasksTab TimelineView 양쪽 재사용. 스크롤바는 헤더 하나만, 모든 행 숨김 + 동기화. 파스텔 bg + fg border+text 로 톤 통일.
- **TasksTab 뷰 URL 싱크** — `?view=split/list/timeline/calendar`. 기본 split 생략.
- **리스트 뷰 개선** — 컬럼 폭 확장 + 우측 설명 컬럼 추가 (업무 설명 2줄 클램프). 제목이 전폭 먹던 "우측 쏠림" 해결.
- **타임라인/캘린더 뷰 정보 강화** — 상태 pill, 담당자, 진행률 표시. Q Task 관점별 i18n 라벨 `getStatusLabel()` 사용.
- **상태 라벨 통일** — ProjectTaskList 로컬 STATUS_LABEL 제거, `utils/taskLabel.ts` + `utils/taskRoles.ts` 사용. 관점(담당자/요청자/컨펌자/관찰자)별 라벨 자동 적용. 드롭다운도 `statusOptionsFor` (요청업무 vs 일반업무 분기).
- **드로어 UX** — Backdrop 추가 (rgba(15,23,42,0.12)). 바깥 클릭 시 닫힘. Q Task 상세/추가 드로어 + 프로젝트 업무 추가 드로어 공통.
- **업무 추가 패턴** — 상단 버튼 → 우측 오버레이 드로어 (Q Task 패턴). 하단 링크 → 표 아래 인라인 폼 (margin-top:16px 간격). QTaskPage 도 동일.
- **로그인 슬로건 교체** — "요청은 Queue로, 실행은 Cue로" → "일이 일이되지 않게, PlanQ". 브랜드 컨셉 최종화에 맞춤.
- **브랜드 컨셉 문서** — `docs/BRAND_CONCEPT.md` 신규 (10섹션). 메인 슬로건 "일을 일답게 하다, PlanQ" / 서브 "일이 일이되지 않게, PlanQ". Q 이중의미(Cue 메인 + Queue 서브) 확장. 컬러 Deep Teal 풀 팔레트.
- **반응형 Phase 0** — `theme/breakpoints.ts` (phone ≤640 / tablet ≤1024) + CLAUDE.md 3원칙 명문화.
- **백엔드** — `GET /projects/:id/tasks` 응답에 `assignee/requester/reviewers` include 추가 (상태 라벨 계산에 필요).

### 수정 파일
- `components/QTask/TaskDetailDrawer.tsx` (신규), `components/Common/GanttTrack.tsx` (신규), `theme/breakpoints.ts` (신규)
- `pages/QTask/QTaskPage.tsx` (드로어 추출·Add 드로어 backdrop·리스트 하단 add link), `pages/QProject/TasksTab.tsx` (뷰 URL 싱크·Add 드로어·Timeline/Calendar 정보강화), `pages/QProject/ProjectTaskList.tsx` (공용 Gantt 적용·상태 라벨 i18n·설명 컬럼)
- `public/locales/{ko,en}/auth.json` (슬로건 교체)
- `routes/projects.js` (tasks include)
- `CLAUDE.md` (반응형 3원칙), `docs/BRAND_CONCEPT.md` (신규)

---

## ✅ 완료: Q Task 결과물 편집기 + Q Project 상세 허브 + Q Talk 정비 (2026-04-19)

하루 세션에서 Q Task 드로어(리치 에디터/첨부/오버레이), Q Project 상세 페이지 전체(5탭), Q Talk 일부 정비를 동시 추진. Q Task 는 상세 드로어가 Notion 스타일 편집·첨부·실시간 저장 상태 뱃지까지 완성, Q Project 는 신규 라우트 `/projects/p/:id` 에 대시보드/업무/프로세스 파트/고객/문서/상세정보 6탭 구현, Q Talk 은 첫 방문 시 모든 프로젝트의 채팅방 로드 및 새 프로젝트 모달에 채팅 채널 설정(이름+참여자) UI 추가.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Q Task 드로어** | Linear 패턴 오버레이 드로어 (position:fixed, 420~1000px 드래그 리사이즈). 기본 우측 패널 유지 + 드로어가 오버레이 | ✅ |
| **Q Task 드로어 섹션 순서** | 액션 → 설명 → 댓글 → 결과물 → 첨부 → 접기(컨펌자/히스토리/일일기록) | ✅ |
| **Q Task description/body 분리** | description = 짧은 설명(plain), body = 결과물(리치 HTML). DB `tasks.body LONGTEXT` 추가 | ✅ |
| **TipTap 리치 에디터** | `/` 슬래시 커맨드(9종 블록) + BubbleMenu + 이미지 붙여넣기/드래그. 설치: `@tiptap/react @tiptap/starter-kit @tiptap/extension-link/image/placeholder/task-list/task-item @tiptap/suggestion @tiptap/extension-bubble-menu` | ✅ |
| **Task/Comment 첨부** | `task_attachments` 테이블(context ENUM description/task/comment) + multer + 공개 UUID 경로(`/public/attach/:storedName`) | ✅ |
| **저장 상태 pill** | saveTaskField 에 saving/saved/error 상태 + 드로어 헤더 배지. description·body 2초 debounce 자동저장 | ✅ |
| **드로어 닫기 3종** | X 버튼 / Esc / 좌측 빈 영역 클릭 | ✅ |
| **상세 URL 싱크** | `?task=:id` 쿼리로 싱크, 새로고침 시 자동 복원 | ✅ |
| **제목 인라인 편집** | 드로어 제목 클릭 → 인라인 input, Enter/blur 저장 | ✅ |
| **기간 CalendarPicker** | 드로어 + 업무 추가 폼 + 새 프로젝트 모달 모두 공용 CalendarPicker 사용 | ✅ |
| **Q Task 로딩 최적화** | 첫 페인트는 allTasks + members만, 탭 전환 시 lazy load (week/requested/all 각 1회) | ✅ |
| **Q Project `/projects/p/:id`** | 6 탭: 대시보드 · 업무 · 테이블(프로세스 파트, 이름 편집) · 고객 · 문서 · 상세정보 | ✅ |
| **projects 테이블 확장** | `project_type` ENUM(fixed/ongoing) + `process_tab_label` VARCHAR 추가 | ✅ |
| **createProject 고도화** | 오너 자동 project_members + customer/internal 2채널 자동 생성 + participants 커스텀 지원 + 기본 상태 옵션 4종 seed | ✅ |
| **프로세스 파트 테이블** | `project_process_parts` (depth1~3/description/status_key/link/notes/extra JSON/order_index) + CRUD + 드래그 순서 변경 | ✅ |
| **프로세스 파트 확장** | `project_status_options` (커스텀 상태) + `project_process_columns` (사용자 정의 컬럼) + 관리 모달 | ✅ |
| **대시보드 구성** | 기본정보 → 고객정보 → 연결된 채팅방 → 진척 → 주요 이슈 → 프로젝트 메모 → 업무 타임라인(최하단) | ✅ |
| **프로젝트 업무 탭** | Q Task 테이블 디자인 복제(ColRow/TRow/TCell/StatusPill/SliderWrap/DateTrigger/NameChip/DelayBadge/DetailBtn). 기본 뷰 = 리스트 + 타임라인 바 통합. 리스트/타임라인/캘린더 4뷰 | ✅ |
| **상세정보 탭** | 2열 그리드 풀폭. 기본정보(이름/고객사/타입/기간/색상/설명) 편집 + 채팅방 + 이슈 + 메모 | ✅ |
| **NewProjectModal 확장** | 프로젝트 타입 카드(fixed/ongoing) + CalendarPicker 기간 + 색상 팔레트 + **채팅 채널 섹션(이름·참여 멤버)** | ✅ |
| **고객 탭 CRUD** | 프로젝트 고객 추가/삭제 (invite_token 생성) | ✅ |
| **대시보드 이슈/메모** | 프로젝트 레벨 이슈·메모 Enter 저장 (IME + submittingRef 가드, 중복 저장 버그 수정) | ✅ |
| **Q Talk 전체 프로젝트 채팅** | 첫 로드 시 모든 프로젝트의 conversations 병렬 로드 — 직접 /talk 진입해도 채팅 리스트 표시 | ✅ |
| **프로세스 파트 url 필드 리네임** | SSRF 미들웨어 `url` 파라미터 충돌 → `link` 로 변경 | ✅ |
| **PlanQSelect 기본 placeholder** | "선택하세요" → "선택하기" | ✅ |
| **/projects 리스트** | `+ 새 프로젝트` 버튼 + 클릭 시 `/projects/p/:id` 이동 | ✅ |
| **App 라우팅** | `/projects/p/:id` → `QProjectDetailPage` | ✅ |
| **문서화** | `UI_DESIGN_GUIDE` 1.7~1.9(액션 버튼 3톤·중복 제출·URL 싱크), `FEATURE_SPEC` F5-24/24-a/25(프로세스 파트) + F6 Q Task 재작성, `CLAUDE.md` UI 규칙 3건 추가 | ✅ |
| **메모리** | 액션 버튼 3톤 원칙, 상세 패널 URL 싱크 — 2건 추가 | ✅ |

### 신규 파일

**백엔드**
- `models/TaskAttachment.js` / `ProjectStatusOption.js` / `ProjectProcessColumn.js` / `ProjectProcessPart.js`
- `routes/task_attachments.js` / `project_process.js`

**프론트엔드**
- `components/Common/RichEditor.tsx` / `SlashCommand.ts` / `SlashCommandList.tsx`
- `components/QTask/TaskAttachments.tsx`
- `pages/QProject/QProjectDetailPage.tsx` / `TasksTab.tsx` / `ProjectTaskList.tsx` / `ProcessPartsTab.tsx`

### 수정 파일

- `models/Project.js` (project_type + process_tab_label), `models/Task.js` (body LONGTEXT), `models/index.js` (어소시에이션)
- `routes/projects.js` (createProject 채널·참여자·상태seed + 고객 추가 API + put project_type/process_tab_label)
- `routes/tasks.js` (body/start_date 허용, detail에 comment.attachments include)
- `server.js` (신규 라우트 마운트)
- `App.tsx` (`/projects/p/:id` 라우트)
- `pages/QTask/QTaskPage.tsx` (드로어 재설계, 로딩 최적화, 자동저장 pill, 제목 인라인 편집 등)
- `pages/QProject/QProjectPage.tsx` (새 프로젝트 버튼 + 네비게이션)
- `pages/QTalk/QTalkPage.tsx` (전체 프로젝트 conversations 병렬 로드)
- `pages/QTalk/NewProjectModal.tsx` (타입·색상·채널 섹션)
- `components/Common/PlanQSelect.tsx` (placeholder 기본값)
- `public/locales/{ko,en}/qtask.json` (신규 키 다수)

### DB 마이그레이션
- `projects.project_type` ENUM('fixed','ongoing')
- `projects.process_tab_label` VARCHAR(80)
- `tasks.body` LONGTEXT
- 신규 테이블: `task_attachments`, `project_status_options`, `project_process_columns`, `project_process_parts`

### 검증 결과
- 헬스체크 27/27 통과
- 최신 빌드: tsc 0 error, gzip ~400 kB
- E2E:
  - 프로젝트 플로우 17/17 (fixed/ongoing 생성, 오너 자동 참여, 2채널 자동 생성, 프로세스 파트 CRUD, 커스텀 상태/컬럼, 타 biz 403)
  - 첨부 15/15 (description/body HTML 왕복, 3개 context 업로드, 공개 이미지 경로, .sh 거부, 401/403)
  - 채널 커스텀 7/7 (기본/커스텀 이름 + 참여자)

### 알려진 미구현 (다음 세션)
- **타임라인 바 드래그 — 후일 업데이트 개발로 유보 (2026-04-20 결정)**. 3단계 로드맵:
  - 1단계 (반나절) — 바 전체 드래그 양쪽 동시 이동, 1일 스냅, 드래그 중 로컬 state, 드롭 시 API 저장
  - 2단계 (하루) — 왼쪽/오른쪽 핸들 분리 드래그, 드래그 중 날짜 툴팁, 제약 검증
  - 3단계 (하루+) — 행간 드래그로 담당자/상태 변경, 충돌 해결 UX, 키보드 네비, 스냅 단위 선택
- **프로젝트 생성 시 채팅 채널 추가/제거** (현재 customer+internal 2개 고정)
- **문서 탭** 실제 파일 리스트 + 업로드
- **멤버 관리** (상세정보 탭에서 추가/제거/역할)
- **Q Talk NewChatModal** (프로젝트 연결 + 참여자 지정 간소 모달)
- **F5-2b 초대 랜딩 페이지** `/invite/:token`
- **Q Talk 청크 5** — Cue 자동 추출 트리거
- **Dashboard** 페이지 구현
- **lua 팀원 계정 세팅**

---

## ✅ 완료: Q Task UI 재정비 + 문서화 (2026-04-19)
> **데이터베이스:** planq_dev_db (MySQL) + qnote.db (SQLite, FTS5)
> **프로젝트:** B2B SaaS — 업무 전용 고객 채팅 + 실행 구조 통합 OS
> **로드맵 상세:** `docs/DEVELOPMENT_ROADMAP.md`

---

## ✅ 완료: Q Task UI 재정비 + 문서화 (2026-04-19)

Phase D(탭 뱃지)·E(세그먼트) 1차 구현 후 Irene 피드백 반영 대폭 재설계. 세그먼트는 과잉 분할이라 제거, 뱃지 의미는 "받은/보낸 업무요청에서 내 할 일"로 재정의, 우측 패널에 상응 섹션 신설. 액션 버튼은 상태별 색칠에서 Primary/Secondary/Danger 3톤으로 통일. 업무 추가 폼 확장 + 중복 제출 가드 + 상세 패널 URL 싱크 추가. 히스토리 라벨은 "컨펌" 접두어로 의미 명확화. 관련 설계 규칙은 `UI_DESIGN_GUIDE` 와 `FEATURE_SPECIFICATION` F6 에 명문화.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **세그먼트 제거** | `내 전체업무` 안의 담당/컨펌 서브탭 제거 — 통합 리스트 복원. 역할은 이름 칩으로 구분 | ✅ |
| **미배정(백로그) 섹션 제거** | 전체업무 탭 하단 중복 섹션 + backlog API 로드 제거 | ✅ |
| **탭 뱃지 재정의** | 이번 주=받은+보낸 합산 / 전체업무=From Q Talk / 요청하기=보낸. 정의는 F6-1 명기 | ✅ |
| **우측 패널 신설** | 이번 주: `받은 업무요청 (N)` + `보낸 업무요청 (N)` 카드 섹션 / 요청하기: 같은 `보낸 (N)` 섹션 + 피드백 | ✅ |
| **From Q Talk 추가 플로우** | `+ 업무로 추가` 클릭 → 등록 성공 즉시 `openDetail()` 호출, 상세 패널에서 담당자/기간/설명 바로 수정 | ✅ |
| **액션 버튼 3톤** | $fill prop(상태색) 제거. Primary(teal #14B8A6)/Secondary(회색 outline)/Danger(에러 outline) 3종만 사용. `requestRevision`/`submitRevision` 은 Danger | ✅ |
| **업무 추가 폼 확장** | 프로젝트/담당자/시작일/마감일/예측(h)/설명 선택 입력. 전부 비우면 제목만으로 저장. 중복 방지: `addingSubmitting` 가드 + disabled. Enter 단독 저장 금지, Ctrl+Enter | ✅ |
| **백엔드 start_date 허용** | `POST /api/tasks` 에 start_date 파라미터 허용 | ✅ |
| **상세 패널 URL 싱크** | `?task=:id` 쿼리로 싱크. 새로고침/URL 공유 시 상세 자동 재오픈, 닫기 시 제거 | ✅ |
| **컨펌자 정책 토글 UX** | "승인 기준" 라벨 제거, 버튼 문구만으로 전달. 컨펌자 2명 이상일 때만 표시 (1명이면 무의미) | ✅ |
| **히스토리 이벤트 라벨** | 컨펌 접두어로 의미 명확화. "확인/승인/결정" 같은 모호한 단어 교정. 예: `policy_change` = "컨펌 정책 변경" | ✅ |
| **액션 버튼 라벨** | `resubmitReview` "수정 반영 후 재요청" → "수정 반영 후 **재확인요청**" (재요청은 요청자 측 어휘여서 담당자 버튼에 부적합) | ✅ |
| **문서화** | `UI_DESIGN_GUIDE` 1.7 액션 버튼 3톤 + 1.8 중복 제출 가드 + 1.9 URL 싱크 / `FEATURE_SPECIFICATION` Phase 6 재작성 (F6-1 ~ F6-10) | ✅ |

### 수정된 파일

**프론트엔드**
- `pages/QTask/QTaskPage.tsx` — 세그먼트 제거/뱃지 재정의/우측 패널 신설/업무 추가 폼 확장/URL 싱크/액션 버튼 3톤
- `public/locales/{ko,en}/qtask.json` — right/add/detail.actions/detail.reviewers/detail.history.event 키 정리

**백엔드**
- `routes/tasks.js` — POST /api/tasks start_date 허용

**문서**
- `dev-frontend/UI_DESIGN_GUIDE.md` — 1.7 ~ 1.9 신규 섹션
- `docs/FEATURE_SPECIFICATION.md` — Phase 6 (Q Task) 재작성
- `DEVELOPMENT_PLAN.md` — 이 세션 기록
- `CLAUDE.md` — 자동저장 섹션에 중복 제출 가드 원칙 1줄 추가

### 검증
- 빌드 성공 (gzip 253 kB, tsc 0 error)
- DB 기준 뱃지 기대값 계산 검증 (biz=3 irene: week=3, all=n/a, requested=1)
- 컨펌자 1명/2명 토글 분기 확인

### 다음 할 일 (다음 세션 시작점)

1. **Clients 초대/편집 UI** (F5-2b 포함)
2. **Q Talk 청크 5** — Cue 자동 추출 트리거 (post-insert hook)
3. **Q Project 상세 페이지** `/projects/:id` (대시보드/업무/문서/고객/AI 5탭)
4. **Dashboard** (위젯 범위 합의 필요)
5. **lua 팀원 계정 세팅**

---

## ✅ 완료: Q Task Phase C — 상세 패널 액션 매트릭스 + 컨펌자/히스토리 UI + 종류별 스테이지 (2026-04-19)

워크플로우 Phase 1~B 에서 쌓은 백엔드를 실제 조작 가능한 UI 로 연결. 상세 패널에 역할별 액션 카드 (담당자/컨펌자), 컨펌자 섹션(정책 토글·추가/제거·경고), 히스토리 타임라인, 상태 드롭다운(자유 전환), 라운드 뱃지 추가. 리스트/카드 뷰 선택 표시 통일, 상태 드롭다운 오버플로우 이슈 해결, 버튼 색 = 도착 상태 색 매핑. 일반 업무 vs 요청 업무 스테이지 분기 — `waiting` 은 요청 업무에만 노출, `not_started` 는 요청+미ack일 때 "업무요청 받음" 라벨. "이번 주 내 업무" 필터 확장 — 담당자 외에 컨펌자(pending)인 업무도 포함. irene 계정 biz=3 에 시나리오 시드 19건 배치.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **상세 패널 액션 카드** | 역할별(담당자/컨펌자) 블록 분리. 상태별 노출: ack / start / submit / cancel-review / resubmit / complete / approve / revision(인라인 폼) / revert. 버튼 색 = 도착 상태 색. Disabled 버튼 은닉 (전제 미충족 시 버튼 자체 숨김) | ✅ |
| **컨펌자 섹션** | 리스트(이름+state 뱃지+제거), 정책 토글(all/any), 추가 드롭다운(멤버 후보), 진행 중 라운드에 추가 시 경고 다이얼로그 ("이미 승인 N명 다시 검토 필요") | ✅ |
| **히스토리 타임라인** | event_type 별 컬러 도트(approve/revision/ack/completed 등), actor→target 표기, round 뱃지, note, 시간. 기본 최근 5개 + 모두 보기 토글 | ✅ |
| **상태 드롭다운 (자유 전환)** | 상태 뱃지 클릭 → 원하는 단계로 자유 전환. 리스트/상세 dropdown 상태 분리 (동시 열림 버그 수정). 업무 종류별 옵션 다름: 요청 업무 = 8단계(waiting 포함), 일반 업무 = 7단계(waiting 제외) | ✅ |
| **종류별 라벨** | not_started + 요청업무 + 미ack → "업무요청 받음" 라벨. 그 외는 기본 상태 라벨. 관점(담당자/요청자/컨펌자/관찰자) 별 라벨 자동 적용 | ✅ |
| **선택/지연 시각 UX** | 카드/리스트 모두 선택 시 로즈 좌측 3px 라인, 리스트 선택 시 옅은 배경. 지연 행: 배경 없이 빨간 좌측 라인만. 카드 지연: 우상단 "지연" 뱃지로 분리 | ✅ |
| **상세 버튼 확대/토글** | 리스트의 `>` 버튼 20×20 → 28×28, 활성 시 로즈 배경 (열림 표시). 다시 누르면 닫힘 | ✅ |
| **라운드 뱃지** | reviewing/revision_requested/done_feedback 상태에서 `R1/R2…` 뱃지 상태 뱃지 옆 노출 | ✅ |
| **인라인 이름 칩 (요청자/담당자)** | 요청자/담당자 별도 컬럼 제거. 업무명 옆 3색 이름 칩: 🌹 내가 받은 요청의 요청자 / 🟢 내가 보낸 요청의 담당자 / ⚪ 워크스페이스 타인 담당 | ✅ |
| **정렬 null 처리** | due_date 정렬에서 null 을 `Infinity` 숫자로 치환하여 string localeCompare 에서 NaN 나던 버그 수정 → nulls-last 원칙 | ✅ |
| **상태 드롭다운 오버플로우** | TCell `overflow:hidden` 에 dropdown 잘리던 문제 — 해당 셀만 `overflow:visible` | ✅ |
| **"이번 주" 필터 확장** | 담당자(행동 필요 상태) + 컨펌자(pending + reviewing/revision_requested) 조합. 단순 요청자 대기는 제외 (내가 행동할 게 없으므로) | ✅ |
| **완료 상태 색상** | 진녹 → 슬레이트 그레이 (#E2E8F0 / #475569). 완료 뱃지/컬럼/버튼 전부 통일 | ✅ |
| **백엔드 API 확장** | `/api/projects/workspace/:bizId/all-tasks` 응답에 `reviewers` 포함 → 프론트 "내가 컨펌자" 판정 가능 | ✅ |
| **i18n 키 추가** | `detail.actions.*` (ack/start/submit/resubmit/cancelReview/complete/completeSimple/approve/requestRevision/revision*/revert*/roundTip 등 20+), `detail.reviewers.*` (policy/state/warn/add/remove), `detail.history.event.*` (10개), `detail.back/description/dailyLog/comments 등` (ko/en 동시) | ✅ |
| **시드 스크립트** | `scripts/seed-qtask-workflow-test.js` — irene 활성 biz(워프로랩 3) + `워크플로우 테스트` 프로젝트에 19건 (M1~M8 일반, R1~R6 받은 요청, S1~S3 보낸 요청, C1~C2 컨펌자). idempotent (`[WF]` 접두사 기반) | ✅ |

### 수정된 파일

**백엔드**
- `routes/projects.js` — all-tasks 응답에 reviewers include
- `scripts/seed-qtask-workflow-test.js` (신규)

**프론트엔드**
- `pages/QTask/QTaskPage.tsx` — 상세 패널 확장, 액션 카드, 컨펌자/히스토리 섹션, 상태 드롭다운 분리, 드롭다운 종류별 분기, 선택 UX, 인라인 이름 칩, week 필터 확장
- `utils/taskLabel.ts` — completed 색상 그레이 전환
- `public/locales/{ko,en}/qtask.json` — detail.* 20여 개 키 추가, common.cancel 추가

### 검증 결과
- 헬스체크 27/27 통과
- 빌드 성공 (gzip ≈ 250 kB)
- 시드 idempotent — 재실행 시 기존 [WF] 전체 삭제 후 재생성
- 백엔드 재시작 후 reviewers 필드 정상 응답 확인

### 다음 할 일 (다음 세션 시작점)

**Phase D — 탭 뱃지 카운트**
- 이번 주 탭: 미확인 요청(task_requested) + 내가 리뷰어 pending 수
- 요청하기 탭: 결과 대기 중(reviewing) 수
- 전체업무 탭: 수정요청 받은(revision_requested) 수

**Phase E — "내 전체업무" 의미 정리**
- 현재 assignee=me OR reviewer=me 합쳐놓음. UX 리뷰 필요
- 필터 명확화 (역할별 탭 vs 합산)

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`)
- Q Talk 청크 5 — Cue 자동 추출 트리거
- Clients 초대/편집 UI (F5-2b)
- Dashboard 구현
- lua 팀원 계정 세팅

---

## ✅ 완료: 타임존 백엔드 연결 + Q Talk 청크3 + Q Project 신규 + Q Task 워크플로우 재설계 (2026-04-19)

한 세션에서 대형 개선 다수 수행. 타임존 실데이터 연결 + 전역 tz 표시 통일, Q Talk 업무 추출 실동작, Q Project 메뉴/페이지 신규 (리스트/타임라인/일정 3뷰 + 프로젝트 색상), Q Task 상태 머신 재설계 (멀티 컨펌자 + 관점별 라벨 + 탭별 카드 칸반).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **타임존 백엔드 연결** | `users.timezone`/`reference_timezones`, `businesses.reference_timezones` JSON 필드 추가. `PUT /api/users/:id`/`/businesses/:id/settings` 확장. `useTimezones` 훅을 localStorage → API 기반으로 교체. `/api/auth/me`에 workspace_timezone 노출 | ✅ |
| **전역 tz 표시 통일** | `utils/dateFormat.ts` + `hooks/useTimeFormat.ts` 신규 (워크스페이스 tz 바인딩 포맷터). Q Talk·Q Note·Q Task·Clients·Profile 모든 시각 표시 통일. `utils/datetime.js` (백엔드 유틸). Q Task my-week/month/year + task_snapshot per-business tz 적용 | ✅ |
| **Q Talk 청크 3 — 업무 후보 추출 실동작** | task_extractor OpenAI 키 연결 (Q Note 에서 복사), 청크 3 E2E 13/13 통과, 배너/Cue 드래프트 UX 재정의, 업무명 규칙 정정 ("완료" 접미사 금지) | ✅ |
| **Q Task ↔ Q Talk 실시간 연동** | `business:{id}` Socket room 추가. task:new/updated/deleted 양방향 전파. QTaskPage Socket 리스너 | ✅ |
| **Q Project 신규 페이지** | `/projects` + `/projects/:view` 라우트, 리스트/타임라인/일정 3뷰, 프로젝트 색상 팔레트 (10색), 드릴다운 링크, 반응형 @media | ✅ |
| **Q Task 워크플로우 재설계 (Phase 1)** | 8 상태 ENUM (not_started/waiting/in_progress/reviewing/revision_requested/done_feedback/completed/canceled) + `task_reviewers` 멀티 컨펌자 테이블 + `task_status_history`. 워크플로우 API 13개 (ack/submit/cancel/approve/revision/revert/complete/reviewers CRUD/policy). 정책 all/any. FK CASCADE | ✅ |
| **Q Task 탭 재구성** | `/tasks` (내 업무) / `/tasks/workspace` URL 분리, 세그먼트 토글, 탭 이름 재정의 (이번 주/내 전체업무/요청하기), 담당자 컬럼 조건부, 업무 추가 UX (제목+담당자 인라인) | ✅ |
| **Q Task 관점별 라벨 (Phase A+B)** | `utils/taskRoles.ts`(getRoles/primaryPerspective) + `utils/taskLabel.ts`(displayStatus/getStatusLabel). i18n `status.{code}.{role}` 4차원 구조. 탭별 카드 칸반 카테고리 컬럼. 빈 컬럼 자동 숨김 | ✅ |
| **보기 모드 토글** | `/tasks` 에 리스트/카드 뷰 토글 (localStorage 유지). 리스트 뷰 컬럼 정렬 (flex-shrink 0, min-width 0). 반응형 breakpoint 기반 컬럼 숨김 | ✅ |
| **버그 픽스** | FK task_comments/task_daily_progress CASCADE, 보안 필터 hex 차단 완화, 업무 추가 중복(Socket+POST 경합), 상태 드롭다운 한 번 클릭 UX, 지연 업무 정렬 어긋남(box-shadow inset), i18n 캐시 무효화(BUILD_ID 쿼리), SQL regex pattern 과차단 | ✅ |
| **스킬 업데이트** | `.claude/commands/검증.md` 에 8단계 UI/UX 상세 템플릿 추가 (8-A~8-G) | ✅ |

### 수정된 파일 (주요, 총 60개)

**백엔드 (Node)**
- 신규: `models/TaskReviewer.js`, `TaskStatusHistory.js`, `routes/task_workflow.js`, `utils/datetime.js`
- 수정: `models/Task.js`(status ENUM 재정의 + 8 컬럼 확장), `TaskComment.js`(visibility/kind), `ProjectNote.js`(shared), `User.js`/`Business.js`(tz 필드), `Project.js`(color), `TaskDailyProgress.js`(CASCADE)
- 수정: `routes/tasks.js`(source 자동판정 + tz 경계 계산 + FK CASCADE), `projects.js`(color + candidate register socket), `users.js`/`businesses.js`/`auth.js`(tz API), `server.js`(business room + task_workflow mount)
- 수정: `services/task_extractor.js`(업무명 규칙 + 프롬프트), `task_snapshot.js`(per-biz tz), `middleware/security.js`(hex 허용)

**프론트엔드 (TS/TSX)**
- 신규: `utils/dateFormat.ts`, `projectColors.ts`, `taskLabel.ts`, `taskRoles.ts`, `hooks/useTimeFormat.ts`, `global.d.ts`, `pages/QProject/QProjectPage.tsx`, `public/locales/{ko,en}/qproject.json`
- 수정: `pages/QTask/QTaskPage.tsx` 전면 재작성 (스코프/탭/보기모드/필터/칸반/관점별 라벨)
- 수정: `pages/QTalk/QTalkPage.tsx`(query param project 파싱, 업무추출 안내), `ChatPanel.tsx`/`RightPanel.tsx`(배너/Cue 재정의), `NewProjectModal.tsx`(색상 swatch), `mock.ts`(legacy 제거)
- 수정: `pages/Settings/WorkspaceSettingsPage.tsx`(타임존 callout + useEffect 제거), `Profile/ProfilePage.tsx`, `Clients/ClientsPage.tsx`, `QNote/QNotePage.tsx`(시각 표시 훅)
- 수정: `App.tsx`(/tasks/:scope 라우트 + /projects 라우트), `MainLayout.tsx`(Q project 메뉴), `i18n.ts`(BUILD_ID 쿼리)
- 수정: `vite.config.ts`(BUILD_ID define), 모든 `locales/*.json`(status/scope/view/roleBadge/columnGroup 키)

**설계 문서**
- `docs/FEATURE_SPECIFICATION.md`(업무명 예시)
- `.claude/commands/검증.md`(8단계 UI/UX 상세 템플릿)

### 검증 결과
- 헬스체크 27/27 (매 Phase 통과)
- 워크플로우 API E2E 18/18 (ack·submit·approve·revision·revert·complete·정책 전환·FK CASCADE)
- 타임존 E2E 11/11 + per-biz snapshot 7/7
- 청크3 E2E 13/13 (extract/register/merge/reject)
- SPA 15/15 라우트 200
- 빌드 성공 (gzip 249.18 kB, tsc 0 error)

### 다음 할 일
**Phase C — Q Task 상세 패널 액션 버튼 매트릭스 (역할별)**
- 담당자: [요청 확인] / [확인 요청 보내기] / [확인 요청 취소] / [최종 완료]
- 컨펌자: [승인] / [수정 요청] (댓글 필수) / [내 결정 취소] (1회)
- 컨펌자 추가/제거 시 라운드 리셋 UI 경고
- 히스토리 타임라인 (task_status_history 렌더)

**Phase D — 탭 뱃지 카운트**
- 이번 주: 미확인 요청 개수
- 요청하기: 내가 컨펌해야 할 개수
- 전체업무: 수정요청 받은 개수

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`) — 프로젝트 허브 (대시보드/업무/문서/고객정보/AI 탭)
- Q Talk 청크 5 — Cue 자동 추출 트리거
- Clients 초대/편집 UI (F5-2b 설계)
- Dashboard 구현 (placeholder)
- lua 팀원 계정 세팅

---

## ✅ 완료: 타임존 기능 + 페이지 레이아웃 표준화 (2026-04-17)

워크스페이스/개인 타임존 + 사이드바 시계, 3컬럼 페이지(Q Talk/Note/Task) + 단일 컬럼 페이지(Settings/Profile/Clients) 헤더 통일. 레이아웃 공통 컴포넌트 `PageShell`/`PanelHeader` 추가해 앞으로의 일관성 강제. 비즈니스 메뉴 분리(/settings, /members, /clients 3개 URL). Q Task 선커밋.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **타임존 UI 기반** | `utils/timezones.ts` (preset 30개 + Intl 지원) / `TimezoneSelector` 공통 컴포넌트 / `useTimezones` 훅 (localStorage mock) | ✅ |
| **사이드바 시계** | `SidebarClock` — 워크스페이스 기본 + 내 시간 + 참조 타임존 펼침, 도시·시간 1행, 가로선 풀폭, row 클릭 시 설정 페이지로 이동, 관리자만 워크스페이스 편집 | ✅ |
| **워크스페이스 타임존 탭** | Settings `timezone` 탭 신규 (프리뷰 카드 + 기본 select + 참조 칩) | ✅ |
| **개인 타임존 섹션** | Profile 페이지에 "내 타임존" 섹션 추가 (rose 톤 프리뷰 + 브라우저 기준 자동 감지 버튼) | ✅ |
| **레이아웃 공통 컴포넌트** | `PageShell` (단일 컬럼) + `PanelHeader`/`PanelTitle` (3컬럼) 신규 — 60px 헤더 / 18px-700 제목 / 14x20 padding 표준 잠금 | ✅ |
| **페이지 헤더 통일** | /profile, /business/settings, /business/members, /business/clients → PageShell 마이그레이션. 모든 헤더 동일 스타일 | ✅ |
| **패널 헤더 통일** | Q Talk 좌/중/우, Q Note 사이드바+메인, Q Task 메인+우측 모두 min-height 60px. 가로 border-bottom 수평 연결 | ✅ |
| **Q Note 사이드바 통일** | SearchBox/SessionList/SessionItem/EmptyMsg 를 Q Talk 기준으로 동일 스타일화 (active inset box-shadow, teal 포인트) | ✅ |
| **Business 메뉴 분리** | /business/settings (브랜드/법인/언어/타임존 4탭) + /business/members (멤버/Cue 2탭) + /business/clients 신규 ClientsPage | ✅ |
| **고객 페이지 신규** | `pages/Clients/ClientsPage.tsx` + `clients.json` i18n — 테이블 리스트, 검색, 초대 버튼 stub, `/api/clients/:businessId` 연결 | ✅ |
| **Q Talk ChatPanel 소속 인라인화** | 프로젝트 표시를 제목 아래 stack → 제목 우측 인라인 (세로선 구분) 으로 변경, 헤더 60px 유지 | ✅ |
| **Q Task 선커밋** | 이전 세션 미커밋 코드(QTask/Invite/CalendarPicker/task_extractor/task_snapshot/TaskComment/TaskDailyProgress) 커밋 65f5c2a | ✅ |
| **문서화** | `CLAUDE.md`에 "페이지 레이아웃 표준 (필수)" 섹션 추가 — PageShell/PanelHeader 강제 사용 명시 | ✅ |

### 수정된 파일 (주요)

**신규**
- `dev-frontend/src/utils/timezones.ts`
- `dev-frontend/src/hooks/useTimezones.ts`
- `dev-frontend/src/components/Common/TimezoneSelector.tsx`
- `dev-frontend/src/components/Layout/SidebarClock.tsx`
- `dev-frontend/src/components/Layout/PageShell.tsx`
- `dev-frontend/src/components/Layout/PanelHeader.tsx`
- `dev-frontend/src/pages/Clients/ClientsPage.tsx`
- `dev-frontend/public/locales/{ko,en}/clients.json`

**수정**
- `dev-frontend/src/App.tsx` — /business/* 라우팅 정비 (settings/members/clients)
- `dev-frontend/src/i18n.ts` — clients 네임스페이스
- `dev-frontend/src/components/Layout/MainLayout.tsx` — SidebarClock 통합, Business 메뉴 Features 아래로 이동
- `dev-frontend/src/pages/Settings/WorkspaceSettingsPage.tsx` — tab 분리 로직, timezone 탭, PageShell 사용
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — UserTimezoneSection, PageShell 사용
- `dev-frontend/src/pages/QTalk/{LeftPanel,ChatPanel,RightPanel}.tsx` — 헤더 60px, Search 분리, 프로젝트 인라인
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — SidebarHeader/MainHeader 60px, 사이드바 스타일 통일, 새세션 버튼 아이콘화
- `dev-frontend/src/pages/QTask/QTaskPage.tsx` — Header/RightHeader 60px, RightTitle 복원
- `dev-frontend/public/locales/{ko,en}/{layout,profile,settings}.json` — timezone/clock/membersPage 키
- `CLAUDE.md` — 레이아웃 표준 섹션 추가

### 다음 할 일 (다음 세션 시작점)

**타임존 백엔드 연결** (UI mock 단계 완료, 실 데이터 연결 필요)
- DB 마이그레이션: `businesses.reference_timezones` JSON, `users.timezone` + `users.reference_timezones` JSON
- API: `PATCH /api/users/:id`에 timezone 필드 허용 + `PATCH /api/businesses/:id/settings`에 reference_timezones 확장
- 백엔드 유틸: `dev-backend/utils/datetime.js` (UTC ↔ tz 변환)
- 프론트: `useTimezones` 훅을 localStorage → API 기반으로 교체
- 기존 시간 표시 화면(Q Task 마감, Q Note 일시 등) UTC 기준으로 정규화

**기타**
- lua 팀원 계정 세팅 (Irene 지시 시 실행)
- Q Talk 청크 3 — 업무 후보 자동 추출

---

## ✅ 완료: 팀원 협업 환경 설계 + 서버 보안 점검 (2026-04-16)

서버 SSH/워크트리 구조 파악, 팀원(lua) 계정 추가를 위한 9개 영역 25개 항목 세팅 계획 수립. 코드 변경 없음 (계획 수립 세션).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **서버 보안 점검** | SSH 유휴 타임아웃 설정 확인 (ClientAliveInterval 0 = 기본값, 서버 측 타임아웃 없음). 개발서버는 키 인증이라 현 상태 유지, 운영서버 시 설정 예정 | ✅ |
| **워크트리 구조 이해** | Claude Code 워크트리 동작 확인: Primary working directory 기준 생성, 변경 없으면 세션 종료 시 자동 정리 | ✅ |
| **팀원 협업 계획** | lua 계정 세팅 계획 수립 — 리눅스 계정/SSH 키/PlanQ 디렉토리 권한/POS 차단/DB 분리/PM2 제한/Git 설정/Claude Code 환경/보안 (9개 영역 25개 항목) | ✅ |

### 다음 할 일 (다음 세션 시작점)

**lua 팀원 계정 세팅 (Irene 지시 시 실행)**
- 리눅스 `lua` 계정 + `planq` 그룹 생성
- SSH 키페어 생성 + 비밀키 전달
- `/opt/planq/` 그룹 권한, `/var/www/` 차단
- MySQL `lua@localhost` (planq_dev_db만)
- PM2 sudoers 제한 (planq 프로세스만 restart)
- Git + Claude Code 환경 설정

**Q Talk 청크 3 — 업무 후보 자동 추출 (개발 작업)**
- Cue 오케스트레이터 확장, 커서 기반 LLM 호출
- task_candidates extract/register/merge/reject API
- 프론트 RightPanel candidates 실 API 연결
- E2E 검증

---

## ✅ 완료: Q Note 동시 녹음 방지 + Q Talk 프로젝트 중심 재설계 + 실데이터 연결 Chunk 1~2 (2026-04-15)

하루 동안 Q Note recorder lock, 테스트 계정 + 워크스페이스 스위처 (멀티 역할), Q Talk 전면 재설계 (프로젝트 중심, 채팅-first UI), 설계 문서 5개 갱신, 청크 1 프로젝트 CRUD 실데이터 + 시드, 청크 2 메시지 전송·채널 설정 실 API 완료.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Q Note recorder lock** | 2탭 동시 녹음 차단: `sessions.active_recorder_token` + `recorder_heartbeat_at` 컬럼, acquire/heartbeat/release 엔드포인트, stale 12s, 프론트 fetch keepalive unload 핸들러, 5초 heartbeat, 다른 탭 4초 폴링. i18n ko/en. | ✅ |
| **테스트 계정 5종** | admin/owner/member1/member2/client @test.planq.kr — 비밀번호 Test1234!, idempotent 스크립트, 로그인 rate limit 화이트리스트. | ✅ |
| **로그인 퀵로그인 패널** | dev.planq.kr/localhost 에서만 노출, 5개 계정 클릭 로그인, full page nav 로 세션 충돌 방지. | ✅ |
| **워크스페이스 스위처** | `users.active_business_id` 컬럼, `/api/auth/me` 에 workspaces[] 배열 반환, `/api/auth/switch-workspace` 엔드포인트, 사이드바 상단 dark-teal 드롭다운 (WorkspaceSwitcher.tsx). irene 계정에 3 역할 × 3 워크스페이스 세팅 (워프로랩 owner / 테스트 member / 파트너스 client). E2E 14/14. | ✅ |
| **LanguageSelector 리디자인** | 사이드바 variant 풀폭 hit area + 다크 드롭다운, 흰 카드 제거, 두 컨트롤 시각 통일. | ✅ |
| **LetterAvatar 공용 컴포넌트** | 중성 회색 그라데이션 + active/cue variant, 프로젝트·멤버·고객 모두 동일 스타일. | ✅ |
| **Q Talk UI Mock (승인 전)** | 3단 레이아웃 + 좌/우 접기 + 5 섹션 아코디언 (이슈/내 할일/프로젝트업무/메모/정보) + 프로젝트 생성 모달 + 업무 후보 카드 + 채팅 flat 리스트 + 채팅 이름 인라인 편집 (mock.ts/LeftPanel/ChatPanel/RightPanel/NewProjectModal). | ✅ |
| **설계 문서 5개 갱신** | FEATURE_SPECIFICATION.md Phase 5 F5-0 ~ F5-24 재작성 + F5-2b 초대 링크 미가입/기가입 분기 명시 / INFORMATION_ARCHITECTURE.md 사이트맵/3단 레이아웃/고객 권한 필터 / DATABASE_ERD.md 섹션 6 신규 6 테이블 + 확장 DDL / API_DESIGN.md 섹션 11.5 Q Talk API / SECURITY_DESIGN.md 섹션 3.7 권한 매트릭스. | ✅ |
| **DB 마이그레이션 (청크 1~5 기반)** | 신규: `projects`/`project_members`/`project_clients`/`project_notes`/`project_issues`/`task_candidates`. 확장: `conversations`(project_id/channel_type/auto_extract/cursor), `messages`(reply_to/cue_draft_processing_*), `tasks`(project_id/from_candidate/recurrence/status ENUM), `business_members.default_role`. | ✅ |
| **Sequelize 모델** | Project, ProjectMember, ProjectClient, ProjectNote, ProjectIssue, TaskCandidate 신규 + Conversation/Message 필드 보강 + associations 14개 추가. | ✅ |
| **청크 1 프로젝트 CRUD API** | POST/GET(list)/GET(detail)/PUT/DELETE + PUT /members. 권한 검증 (owner/member/client), 생성자 자동 project_members 등록, 초대 토큰 자동 생성 (crypto.randomBytes 24). | ✅ |
| **청크 1 시드 스크립트** | `scripts/seed-qtalk-demo.js` idempotent — 테스트 워크스페이스 3 프로젝트 (브랜드 리뉴얼/패키지 디자인/내부 툴 개선) + 워프로랩 2 프로젝트 (온보딩 자동화/AI 리서치). 각 프로젝트마다 채널 2개 + 메시지 9개 + 업무 5개 + 메모 4개 + 이슈 4개 + 후보 2개. client@test 를 contact_user_id 로 연결. | ✅ |
| **청크 1 읽기 API** | GET /api/projects/:id/conversations/tasks/notes/issues/task-candidates + /api/projects/conversations/:id/messages. 권한 필터 자동 주입 (고객 internal 차단, 개인 메모는 본인만). | ✅ |
| **청크 1 프론트엔드** | `services/qtalk.ts` 전 API 래퍼. QTalkPage 전면 재작성 — 실 API 기반 로드, 프로젝트 선택 시 채널+메시지+업무+메모+이슈+후보 병렬 fetch. NewProjectModal 에서 `listBusinessMembers` 로 실 워크스페이스 멤버 fetch. | ✅ |
| **청크 2 쓰기 API** | POST /api/projects/conversations/:id/messages (reply_to 지원, Socket.IO broadcast), PATCH /api/projects/conversations/:id (rename + auto_extract 토글). 권한 필터 엄격. | ✅ |
| **청크 2 프론트엔드** | `sendMessage`/`updateConversation` 서비스, ChatPanel → QTalkPage 핸들러로 실 API 호출. | ✅ |
| **검증** | 헬스체크 27/27 통과 (매 단계), 청크 1 CRUD E2E 16/16, 청크 1 읽기 API 13/13, 청크 1 전수 회귀 29/29 (owner/member1/client 3 역할 × 13 케이스), 청크 2 E2E 16/16, recorder lock E2E 8/8, 워크스페이스 스위처 E2E 14/14. SPA 라우트 /talk /notes /settings /dashboard /login 전부 200. | ✅ |

### 수정된 파일 (주요)

**백엔드 (Node)**
- 수정: `routes/auth.js` (workspaces[] + switch-workspace), `routes/projects.js` (청크 1+2 전체), `server.js` (projects router 등록 + body parser 순서 교정), `middleware/security.js` (dev 테스트 이메일 rate-limit skip), `models/User.js` (active_business_id), `models/Conversation.js` (project_id/channel_type 등), `models/Message.js` (reply_to/cue_draft_processing_*), `models/index.js` (14개 associations)
- 신규: `models/Project.js`, `ProjectMember.js`, `ProjectClient.js`, `ProjectNote.js`, `ProjectIssue.js`, `TaskCandidate.js`, `routes/projects.js`, `scripts/create-test-accounts.js`, `scripts/seed-qtalk-demo.js`

**Q Note (Python)**
- 수정: `q-note/services/database.py` (active_recorder_token + recorder_heartbeat_at 마이그레이션), `q-note/routers/sessions.py` (recorder acquire/heartbeat/release + GET 응답에 recorder_lock 필드)

**프론트엔드 (TS)**
- 수정: `contexts/AuthContext.tsx` (WorkspaceMembership 타입 + switchWorkspace), `components/Layout/MainLayout.tsx` (WorkspaceSwitcher 통합), `components/Common/LanguageSelector.tsx` (사이드바 다크 변형), `pages/Login/LoginPage.tsx` (dev 퀵로그인 패널 + full page nav), `pages/QNote/QNotePage.tsx` (recorder lock 로직 + keepalive fetch unload), `pages/QTalk/QTalkPage.tsx` (실 API 기반 재작성), `services/qnote.ts` (recorder lock API)
- 신규: `components/Common/LetterAvatar.tsx`, `components/Layout/WorkspaceSwitcher.tsx`, `pages/QTalk/LeftPanel.tsx`, `pages/QTalk/ChatPanel.tsx`, `pages/QTalk/RightPanel.tsx`, `pages/QTalk/NewProjectModal.tsx`, `pages/QTalk/mock.ts`, `pages/QTalk/QDataContext.tsx` (Mock 시절 유물, 향후 제거 예정), `services/qtalk.ts`

**Locales (ko/en)**
- 수정: `auth.json` (devPanel 키), `layout.json` (switcher 키), `qnote.json` (recorderLocked/recorderLost/recorderLockedBanner), `qtalk.json` 신규 재작성 (left/chat/right/modal)

**설계 문서 (5)**
- `docs/FEATURE_SPECIFICATION.md` (Phase 5 전면 재작성, 778→959 줄)
- `docs/INFORMATION_ARCHITECTURE.md` (사이트맵/3단 레이아웃, 340→446 줄)
- `docs/DATABASE_ERD.md` (섹션 6 신규, 677→911 줄)
- `docs/API_DESIGN.md` (섹션 11.5 Q Talk, 496→696 줄)
- `docs/SECURITY_DESIGN.md` (섹션 3.7 권한 매트릭스, 287→456 줄)

### 설계 결정 (시니어 관점)

- **Q Talk UI 주인은 채팅, 프로젝트는 메타데이터**: 초기 "project-centric" 해석을 "data-model centric, chat-first UI" 로 정정. 채팅 헤더에서 프로젝트 breadcrumb 제거, 소속 서브라벨로 격하. 프로젝트 없는 채팅 지원 준비. Slack/Discord 패턴.
- **멤버 역할은 팀 설정에 저장, 프로젝트에 이어받음**: `business_members.default_role` 컬럼 추가. 프로젝트 모달은 팀 레벨 default 를 불러와 표시, 프로젝트별 override 가능. "직접 넣은 내용이 나와야 한다" Irene 피드백 반영.
- **역할 자유 입력**: 하드코딩 ROLE_OPTIONS 드롭다운 제거 검토. 팀설정 UI 는 추후 구현.
- **초대 링크 2분기 설계**: 미가입(가입폼 → clients insert) / 기가입(검증 → contact_user_id 연결). 7일 TTL, 1회성 토큰, 피싱 방어 이메일 일치 검증. Phase 2 에 랜딩 페이지 구현 예정.
- **AI 최소 사용**: 기존 데이터로 가능한 건 DB 쿼리로 해결. 업무 후보 히스토리 재조회, 주요 이슈 CRUD, 메모 조회 전부 AI 없음. 메모리 `feedback_ai_minimal_usage.md` 로 저장.
- **청크 단위 검증**: 청크 7 에 몰아두지 않고 각 청크 끝날 때마다 E2E + 헬스체크 돌리도록 절차 교정 (Irene "검증하면서 하고 있어?" 피드백 반영).
- **시드에 client@test 연결 실수 즉시 수정**: 첫 시드에 contact_user_id 누락 → client 로그인 시 빈 화면. 재검증 중 발견하여 재시드 + 29/29 재검증.
- **Rate limit body parser 순서**: express-rate-limit skip 함수에서 req.body 를 보려면 body-parser 가 security 미들웨어보다 먼저 실행되어야 함. server.js 미들웨어 순서 교정.

### 검증 결과

- **헬스체크 27/27** (매 단계마다 통과)
- **빌드**: tsc 0 error, vite 566~661ms, 649~703 KB (`index-BsrszKEA.js` 최종)
- **Recorder Lock E2E 8/8**: acquire/heartbeat/release 정상 + 409 충돌 처리
- **워크스페이스 스위처 E2E 14/14**: 3 역할 × 워크스페이스 전환, 권한 403
- **청크 1 CRUD E2E 16/16**: POST/GET/PUT/DELETE + 권한 (owner/member1 양쪽)
- **청크 1 읽기 API 13/13**: 채널/메시지/업무/메모/이슈/후보 + 권한 필터
- **청크 1 전수 회귀 29/29**: owner/member1/client × 13 케이스 + 권한 위반 3
- **청크 2 E2E 16/16**: 메시지 전송/reply/rename/auto_extract 토글 + 권한 필터
- **SPA 라우트**: `/talk`, `/notes`, `/settings`, `/dashboard`, `/login` 전부 200

### 미완 / 다음 세션 (Irene 화면 확인 후)

- **청크 3**: 업무 후보 자동 추출 (Cue 오케스트레이터 확장, 커서 기반 LLM 호출, task_candidates 저장)
- **청크 4**: 프로젝트 메모/이슈/업무 쓰기 API + 프론트 연결
- **청크 5**: Q Task 페이지 실데이터 + tasks 상태 전환 API
- **청크 6**: Socket.IO 이벤트 broadcast (message:new, cue:draft_* 등) + 실시간 UI 반영
- **청크 7**: 9단계 전수 검증 + UI/UX 최종 확인
- **Team Settings**: `/settings/workspace` Members 탭에서 default_role 편집 UI
- **Q Task page**: 전체 업무 조회 화면
- **채팅 검색**: 좌측 리스트 인라인 검색 결과 전환

### Irene 에게 요청 (UI/UX 8단계 확인)
1. owner@test.planq.kr → /talk → 3 프로젝트 실데이터 표시, 메시지/업무/메모/이슈/후보 확인
2. client@test.planq.kr → /talk → 브랜드 리뉴얼 + 패키지 디자인 2개만, internal 채널 숨김
3. irene 계정 → 워크스페이스 스위처로 워프로랩/테스트/파트너스 3 개 전환, 각 워크스페이스별 프로젝트 로드
4. 메시지 전송 실제 작동 (청크 2), 채널 이름 변경 인라인, 자동 추출 토글 작동 확인

---

## 완료: Phase 0 기초 정비 + Phase 5 Q Talk 백엔드 + UI 목업 (2026-04-14)

설계 7 문서 전면 정비 후, Q Talk 의 기초(워크스페이스 · Cue AI 팀원 · 가시성)와
대화 자료(KB) + Cue 오케스트레이터 백엔드까지 자율 구현. Q Talk 메인 UI 는
UI-First 원칙에 따라 목업까지만 제작 (Irene 아침 승인 대기).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **설계 문서** | 7 개 전면 정비 — SYSTEM_ARCHITECTURE (네이밍·가시성·Cue·사용량) / DATABASE_ERD (신규 4 테이블 + 마이그레이션 DDL) / API_DESIGN / SECURITY_DESIGN (Cue 안전장치) / INFORMATION_ARCHITECTURE / FEATURE_SPECIFICATION (Phase 0 + Phase 5 재작성) / DEVELOPMENT_ROADMAP (Phase 0 + Phase 5 13 단계) | ✅ |
| **DB 마이그레이션** | users.is_ai / businesses 확장 (brand/legal/default_language/cue_*) / business_members.role 에 'ai' / conversations Cue 필드 / messages AI·internal 필드 / clients.summary / 신규 테이블 4 개 (kb_documents · kb_chunks · kb_pinned_faqs · cue_usage) | ✅ |
| **Phase 0 마이그레이션 스크립트** | 기존 5 워크스페이스에 brand_name 백필 + Cue 계정 자동 생성 | ✅ |
| **Auth 확장** | register 트랜잭션에 Cue 계정 자동 생성 / login·refresh 에서 is_ai=true 차단 / 예약 이메일 패턴 차단 | ✅ |
| **Workspace API** | GET detail (Cue 포함 멤버) / PUT brand / PUT legal / PUT settings / GET members (Cue 포함) / GET cue (사용량 포함) / PUT cue (모드·pause) / 감사 로그 | ✅ |
| **i18n 네이밍** | locales ko/en 에서 business_owner → 관리자/Admin, 워크스페이스 label 추가, businessName → workspaceName 병행 | ✅ |
| **가시성 미들웨어** | `middleware/visibility.js` — canAccess·loadResource·checkVisibility 스켈레톤 (리소스별 적용은 각 메뉴 Phase 에서) | ✅ |
| **워크스페이스 설정 페이지** | `WorkspaceSettingsPage.tsx` — 5 탭 통합 (Brand/Legal/Language/Members/Cue), 모든 입력 AutoSaveField, default_language='en' 일 때 영문 필드 자동 숨김, Cue 모드 카드 라디오, 사용량 바 + 종류별 집계 | ✅ |
| **KB 서비스** | `services/kb_service.js` — OpenAI text-embedding-3-small 래퍼, sliding-window 청킹, Float32 BLOB 직렬화, 코사인 유사도, 하이브리드 검색 (임베딩 + LIKE 폴백) | ✅ |
| **Cue 오케스트레이터** | `services/cue_orchestrator.js` — 4-tier 매칭, 민감 키워드 감지, Auto/Draft/Smart 모드, CueUsage UPSERT, 비용 계산, generateClientSummary, OpenAI 키 없을 때 graceful fallback | ✅ |
| **KB 라우터** | `routes/kb.js` — 문서 CRUD + 비동기 인덱싱 + Pinned FAQ CRUD + CSV 템플릿 + 하이브리드 검색 테스트 엔드포인트 | ✅ |
| **Conversations 라우터 확장** | Cue 자동 참여자 등록, Cue trigger, 대화별 pause/resume, suggestions, Draft approve/reject, 고객 요약 갱신, Client 역할 is_internal/Draft 필터링 | ✅ |
| **Q Talk UI 목업** | `QTalkPage.tsx` — 3 단 반응형 레이아웃 (좌: 필터·대화 리스트 / 중: 메시지·Cue 뱃지·출처 인라인·컴포저 / 우: 고객 프로필·자동 요약·진행 업무·Cue 답변 후보·내부 메모), i18n ko/en, 목업 데이터로 화면 확인 가능 | ✅ |

### 수정된 파일

**설계 문서 (7)**
- 전 문서 업데이트 — `docs/{SYSTEM_ARCHITECTURE,DATABASE_ERD,API_DESIGN,SECURITY_DESIGN,INFORMATION_ARCHITECTURE,FEATURE_SPECIFICATION,DEVELOPMENT_ROADMAP}.md`

**백엔드 (Node)**
- 모델: `User.js`, `BusinessMember.js`, `Conversation.js`, `Message.js`, `Client.js`, `index.js` 수정 / `Business.js` 전체 재작성 / `KbDocument.js`, `KbChunk.js`, `KbPinnedFaq.js`, `CueUsage.js` 신규
- 미들웨어: `auth.js` (businessRole 세팅) / `visibility.js` 신규
- 라우트: `auth.js` (Cue 계정 생성 + AI 차단), `businesses.js` 전체 재작성, `conversations.js` 전체 재작성 / `kb.js` 신규
- 서비스: `kb_service.js`, `cue_orchestrator.js` 신규
- 스크립트: `scripts/phase0-migrate.js` 신규

**프론트엔드 (TS)**
- `src/i18n.ts`, `src/App.tsx` 수정
- `src/pages/Settings/WorkspaceSettingsPage.tsx`, `src/pages/QTalk/QTalkPage.tsx`, `src/services/workspace.ts` 신규

**Locales**
- `{ko,en}/common.json`, `{ko,en}/layout.json`, `{ko,en}/auth.json` 수정
- `{ko,en}/settings.json`, `{ko,en}/qtalk.json` 신규

### 설계 결정 (시니어 관점)

- **"사업자 / Owner" 라벨만 교체**: 스키마 rename (10+ 테이블 FK) 은 비용 대비 가치 0. i18n 레이어에서만 "워크스페이스 / 관리자"로 표기하고, DB·코드는 `businesses`, `business_owner` 내부 이름 유지. Slack/Linear/Notion 모두 동일 패턴.
- **Cue = 팀원 한 명**: 핸드오프 개념 제거. `users(is_ai=true)` + `business_members(role='ai')` 로 모델링. 사람 멤버와 동일한 할당·참여 시스템을 그대로 타면서 로그인만 불가. 실제 팀원이 업무 바통 터치하는 것처럼, 명시적 pause 외엔 자동 퇴장 없음.
- **플랜별 기능 차등 금지**: Cue 는 전 플랜 동일 기능. 월 **액션 수** 한도만 차등 (Free 500 / Basic 5K / Pro 25K). 한도 초과 시 Cue 조용해지고 다음 달 복귀. Q Note 에서 이미 검증된 비용 모델 (액션당 ~$0.0005) 기준 Basic 마진 91%.
- **KB 엔진은 Q Note 재사용**: `text-embedding-3-small` + 하이브리드 검색 + LLM 2차 매칭 파이프라인을 복사하지 않고 Node 서비스로 래핑 (OpenAI API 직접 호출). Q Note Python 과는 독립적으로 동작하되 동일 모델·동일 임베딩 차원.
- **민감 키워드 강제 Draft**: Auto 모드라도 환불·계약해지·법적·금액 100만원 이상 감지 시 Draft 전환. 사람이 먼저 검토 후 발송. 오작동 리스크 차단.
- **OpenAI 키 없을 때 graceful fallback**: Cue 오케스트레이터는 API 키 없어도 예외 던지지 않고 "확인 후 답변드리겠습니다" 폴백 + LLM 0 토큰 기록. 테스트/개발 환경에서 크래시 없이 전체 플로우 검증 가능.
- **Q Talk UI 는 목업까지만**: UI-First 원칙 + 저장된 `feedback_ui_first.md` 메모리 준수. Irene 승인 전 실 API 연결 금지. 대신 현실적인 목업 데이터로 화면 방향성 확인 가능하게 만듦.
- **통합 설정 페이지 (5 탭)**: 별도 5 페이지 대신 `/settings` 단일 라우트 + 내부 탭. 유지비 낮고 네비 단순.

### 검증 결과

- **헬스체크**: 27/27 ✓
- **빌드**: tsc 0 error, vite 562ms, 637.58 KB (`index-DbkEa0cN.js`)
- **Phase 0 API E2E** (test-phase0.js — 검증 후 삭제):
  - Cue 계정 로그인 차단 ✓ / 기존 유저 로그인 ✓
  - PUT brand/legal/cue ✓ / invalid value 거부 ✓
  - GET members (Cue 포함) ✓ / GET cue (사용량) ✓
- **Phase 5 백엔드 E2E** (test-phase5-backend.js — 검증 후 삭제): 13/13 ✓
  - Pinned FAQ CRUD ✓ / KB document 업로드 + 비동기 인덱싱 `ready` ✓
  - 하이브리드 검색 ✓ / Cue usage 집계 ✓
- **SPA 라우트**: `/settings` `/talk` `/notes` `/profile` 전부 200

### 미반영 / 다음 세션 (Irene 승인 후)
- **Q Talk 실 UI 바인딩**: 3 단 레이아웃에 실제 API 연결, Socket.IO 이벤트 (new_message, cue_thinking, cue_draft_ready), Draft 승인/거절 UI
- **고객 포털 뷰**: Client 역할용 간소 화면
- **KB 관리 페이지**: `/talk/kb` 문서 업로드 드래그앤드롭 + Pinned FAQ CRUD UI
- **파일 업로드 파싱**: 현재는 body 텍스트만. pdf/docx/xlsx multer 연결 + 파서 필요
- **Cue task 실행**: Phase 6 Q Task 기획과 연계
- **민감 키워드 다국어 확장**

---

## 완료: Q note 품질 전면 개선 + i18n + 편집 UX + 준비 상태 가시화 (2026-04-13)

하루 동안 i18n 기반 구축, Q note 답변 품질·속도·데이터 정합성 전면 개선,
편집 모드 신설, 준비 상태 실시간 가시화까지 대규모 리팩터링.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **i18n** | `i18next` + `react-i18next` 전 페이지 적용 (Login/Register/MainLayout/Profile/QNotePage/StartMeetingModal). 네임스페이스 5개 (common/auth/layout/profile/qnote) × ko·en. 총 304 key 동수. 한국어 하드코딩 533 → 309 (잔여는 코드 주석). CLAUDE.md 에 "다국어 i18n — 필수" 규칙 섹션 + 감지 grep. | ✅ |
| **브랜드 네이밍** | "Q Talk/Task/Note" → **"Q talk/task/note"** 소문자 통일. locales/페이지/뱃지 전수 교체 | ✅ |
| **모달 z-index** | 공통 Modal 1000 → 2000, ConfirmDialog 1100 → 2100, StartMeetingModal 200 → 2000. 모바일 헤더(999)/사이드바(1000) 위에 덮이는 문제 해결 | ✅ |
| **번역 정렬** | SpeechBlockWrap 재구조화. 번역문이 원문과 동일한 왼쪽 위치에서 시작 (`[speaker][col: original+translation]`) | ✅ |
| **Q note 답변 tier 6단계** | `answer_service.py` 재구성: priority > custom > session_reuse > generated > rag > general. 각 tier 에 시맨틱 임베딩(OpenAI text-embedding-3-small) 재랭킹 + LLM 2차 매칭 (gpt-4.1-nano) hybrid. Priority tier 는 FTS5 우회 전수 탐색 + LLM 매칭으로 paraphrase 대응 | ✅ |
| **임베딩 서비스** | `embedding_service.py` 신규 (1536차원, cosine sim, BLOB 변환). `qa_pairs.embedding` BLOB 컬럼 + `is_priority` flag. Priority Q&A 생성 시 동기 임베딩 (race 방지) | ✅ |
| **Priority Q&A 전용 업로드** | UI 에서 "일반 자료" 와 **완전히 분리**. 단건 폼 (질문/답변/short_answer/keywords) + CSV 업로드 (BOM UTF-8, 5 컬럼). CSV 템플릿 다운로드 (apiFetch blob). 편집 모드에서 **드래그앤드롭 + 즉시 업로드** (파일 선택 = 바로 서버 반영) | ✅ |
| **short_answer + keywords 필드** | qa_pairs 컬럼 추가. `meeting_answer_length='short'` 일 때 `short_answer` 우선 반환. `keywords` 는 FTS5 인덱스에 합쳐 검색 정확도·속도 향상 + 임베딩 input 에도 포함 | ✅ |
| **답변 길이·난이도 제어** | `meeting_answer_length` (short/medium/long) → 1-2/2-3/3-4 문장, 27/55/85 단어 하드캡 (서버 `_enforce_length_cap` 후처리). 프롬프트 맨 끝 재강조. `user_language_levels` (언어별 4-skill) + `user_expertise_level` (layman/practitioner/expert). "말하기 좋은 단어" 규칙 언어별 (영어 Anglo-Saxon 우선, 한국어 순우리말/구어체 등) | ✅ |
| **회의별 스타일 프롬프트** | StartMeetingModal 에 `meetingAnswerStyle` textarea + `meetingAnswerLength` 3버튼. 세션에 저장, generate_answer 프롬프트 style prefix 주입 | ✅ |
| **빠른 질문 판정 병렬화** | `detect_question_fast` (gpt-4.1-nano, ~300ms) 신규. finalized 즉시 fast-path 로 질문 판정 + `quick_question` WS 이벤트 → 카드 즉시 승격 + prefetch answer 시작. enrichment 는 병렬로 돌며 나중에 덮어씀. 본인 발화 스킵 | ✅ |
| **어휘사전 (STT 교정)** | `generate_vocabulary_list` 프롬프트 재작성: **"TERM EXTRACTOR, NOT brainstormer"** 복사 전용. `document_excerpts` 파라미터 (인덱싱된 문서 청크가 최우선 소스). `meeting_languages` 강제 — 자료 원어로 복사, 번역 금지. 검증: brief 만 있으면 0개, 자료 있으면 verbatim 용어만 (환각 0/4, 매칭 5/5) | ✅ |
| **문서 인덱싱 후 자동 어휘 재추출** | `ingest.py` 에 post-index hook: `refresh_session_vocabulary` 자동 트리거. 기존 사용자 수동 키워드 보존하고 새 키워드 병합 | ✅ |
| **어휘 수동 재추출 API** | `POST /sessions/:id/refresh-vocabulary` 신규. 편집 모달 "📄 문서 기반 재추출" 버튼 | ✅ |
| **STT 실시간 교정** | `translate_and_detect_question` 에 `vocabulary` + `recent_utterances` 파라미터. 프롬프트 prefix 로 주입. SYSTEM_KO/EN 규칙 "원본 보존 우선, 명백한 오인식만 교체" 재강화 (과잉 교정 방지) | ✅ |
| **Deepgram 키워드 부스팅 확장** | 사용자 검토한 `session.keywords` 우선 + auto_extracted 보강. Deepgram 50개 한계 | ✅ |
| **편집 모드 (설정 버튼)** | StartMeetingModal `editMode` + `initialConfig` + `editingSessionId`. 편집 배너, 기존 Priority Q&A/문서 로드 + 삭제 버튼, 기존 어휘사전 chip 편집, "📄 재추출" 버튼. 저장 시 PUT session + 신규 items POST | ✅ |
| **초안 자동저장** | StartMeetingModal localStorage `qnote_meeting_draft_v1`. debounce 500ms, 모달 재오픈 시 복원, "초안 복원됨" 뱃지 + "초안 지우기" 버튼. 파일/CSV 는 제외 (재첨부 필요) | ✅ |
| **준비 상태 패널** | QNotePage 헤더 하단에 `prepared`/`paused` phase 에서 실시간 표시. 3초 폴링으로 문서 인덱싱 N/M, Priority Q&A 임베딩 N/M, 어휘사전 개수 + 전체 준비 완료 초록 뱃지. `qa_pairs.has_embedding` 필드 신규 | ✅ |
| **화자 라벨 수정** | 참여자 0명 또는 다수면 "화자 1/2/3" 대신 "상대"로 통일 (Deepgram ID 신뢰도 낮음) | ✅ |
| **내 발화 처리 모드 3단계** | 참여자 바에 `skip`(기본, finalized 드롭)/`hide`(렌더 필터)/`show` 토글. 답변 읽기에 집중 가능. localStorage 저장 | ✅ |
| **탭 오디오 품질 개선** | WebConferenceCapture 에 `DynamicsCompressor` + `HighShelfBiquad` (+3dB @3kHz) + `Gain` ×2. 상대 목소리 STT 정확도 향상. 48kHz sampleRate 명시 | ✅ |
| **탭 재공유 이중 표시 버그 fix** | WebConferenceCapture `stop()` async 전환: 노드 명시적 disconnect → 트랙 stop → `await audioContext.close()`. tab track 'ended' listener 제거. Chrome "공유 중" 배너가 다시 공유 시 2개 겹치는 문제 해결 | ✅ |
| **녹음 critical 버그 fix** | `live.py` Deepgram 재시도 블록 들여쓰기 실수 수정. `close + return` 이 except 블록 밖에 있어 재시도 성공 후에도 WS 닫고 종료되던 문제 | ✅ |
| **회의 생성 후 화면 사라지는 버그 fix** | URL 핸들러 경합 제거: navigate 전에 `urlSessionIdHandled.current = true` + `activeSessionRef.current = detail`. DB 기본 `status='recording'` → **'prepared'** 변경. openReview 에 prepared 케이스 추가. 사이드바 뱃지 "준비됨" 추가 | ✅ |
| **PlanQ 사용자 프로필 확장** | User 모델에 `language_levels` JSON, `expertise_level`, `answer_style_default`, `answer_length_default` 컬럼 추가. PUT /api/users/:id 검증 (언어별 4-skill 1-6, 범위 초과 거부). ProfilePage 에 "내 언어 레벨 (답변 난이도 조절용)" 카드 신규 — 7개 언어 × R/S/L/W PlanQSelect + 전문지식 4 버튼 | ✅ |
| **auto_keywords 추출** | create_session 시점에 brief/pasted/participants/profile 기반 초안 30~80개 추출 (비동기 문서 인덱싱 완료 후 refresh_session_vocabulary 로 교체·병합) | ✅ |

### 수정된 파일

**Q note 백엔드 (Python)**
- 신규: `services/embedding_service.py` (OpenAI embedding wrapper)
- 수정: `services/database.py` (qa_pairs.embedding/is_priority/short_answer/keywords, sessions.language_levels/expertise_level/meeting_answer_style/meeting_answer_length/keywords, FTS5 트리거 rebuild)
- 수정: `services/llm_service.py` (style prefix, vocab extract 복사 전용, detect_question_fast, llm_match_question, RAG/GENERAL 프롬프트 재설계, 길이 캡)
- 수정: `services/answer_service.py` (6단계 tier + hybrid semantic/LLM, refresh_session_vocabulary, short_answer 우선 반환)
- 수정: `services/ingest.py` (post-index vocab refresh hook)
- 수정: `services/qa_generator.py` (임베딩 포함)
- 수정: `routers/live.py` (fast-path 병렬, session keywords, recent utterances, Deepgram 재시도 들여쓰기 fix)
- 수정: `routers/sessions.py` (priority-qa CRUD + CSV 템플릿/업로드 + refresh-vocabulary, 편집 가능한 모든 필드, has_embedding 노출)

**PlanQ 백엔드 (Node)**
- 수정: `models/User.js` (language_levels, expertise_level, answer_style_default, answer_length_default)
- 수정: `routes/users.js` (신규 필드 검증 + 저장)

**프론트엔드 (TS)**
- 수정: `contexts/AuthContext.tsx` (User interface 확장)
- 수정: `i18n.ts` (5 네임스페이스)
- 수정: `pages/Login/LoginPage.tsx`, `pages/Register/RegisterPage.tsx`, `components/Layout/MainLayout.tsx`, `pages/Profile/ProfilePage.tsx`, `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx` (i18n 리트로핏 + 신규 기능)
- 수정: `pages/QNote/QNotePage.tsx` (편집 모드 버튼, readiness panel, self-mode 토글, 화자 라벨, URL race fix)
- 수정: `pages/QNote/StartMeetingModal.tsx` (편집 모드, CSV 드롭존, 초안 자동저장, 어휘사전 카드)
- 수정: `services/qnote.ts` (priority-qa + refresh-vocabulary + QAPair 확장)
- 수정: `services/qnoteLive.ts` (quick_question 이벤트)
- 수정: `services/audio/WebConferenceCapture.ts` (compressor/highshelf/gain + async stop)
- 수정: `services/audio/AudioCaptureSource.ts` (stop 시그니처 void|Promise<void>)
- 수정: `components/UI/Modal.tsx`, `components/Common/ConfirmDialog.tsx` (z-index 2000/2100)
- 수정: `App.tsx` (브랜드 네이밍 소문자)

**Locales**
- 신규: `public/locales/{ko,en}/{layout,profile,qnote}.json`
- 수정: `public/locales/{ko,en}/{common,auth}.json`

**문서**
- `CLAUDE.md` — "다국어 i18n — 필수" 섹션 신규, 감지 grep, 금지 사항 추가
- `dev-frontend/UI_DESIGN_GUIDE.md` — 2026-04-12 업데이트 유지

### 설계 결정 (시니어 관점)

- **i18n 먼저**: 기획·UI 작업 진행 전에 i18n 기반을 제대로 까는 것이 이후 모든 기능 개발의 부채를 덜어준다. 하드코딩된 상태에서 기능을 추가하면 나중에 갈아엎을 때 범위가 폭발한다. 사용자가 명시적으로 "i18n 제대로 구현해줘. 지금 개발한 Q note 지장없게" 를 최우선순위로 지정한 것도 이 이유.
- **Answer tier 6단계 + hybrid 매칭**: 단순 FTS5 로는 paraphrase 매칭이 불가능하고 (한국어 조사, 영어 "research" vs "researching" 접미사, 동의어), 단순 임베딩은 short 질문에 정확도가 낮다 (실측 0.27~0.5). FTS5 → 임베딩 rerank → LLM 2차 검증 → (선택) 재순위 의 3단 파이프라인이 정확도·비용 균형점. LLM 2차는 gpt-4.1-nano (~200ms, 저비용) 로 수용 가능.
- **어휘사전은 자료에서 복사만**: LLM 에게 "extract"만 시키고 "brainstorm" 을 금지하는 프롬프트 기법. "If source provides nothing, return empty list" 명시로 환각 제거. 검증 결과 자료 0건 → 0개, 자료 있음 → verbatim 5/5 매칭, 일반 용어 환각 0/4.
- **문서 인덱싱 후 vocab 재추출 hook**: 세션 생성 시점엔 문서가 없으므로 brief 만으로 초안. 실제 유용한 어휘는 문서 인덱싱이 끝나야 뽑을 수 있으므로 ingest post-hook 으로 재추출 + 기존 사용자 수동 키워드 병합. 사용자가 회의 시작 전 준비 패널에서 변화를 실시간 확인 가능.
- **길이 캡 이중 방어**: LLM 은 길이 규칙을 자주 어긴다. 프롬프트 맨 끝에 "FINAL REMINDER" 로 재강조 + 서버 후처리 `_enforce_length_cap` (문장 수·단어 수 기준 자름). "If you write N+1 words, you have failed the task" 처럼 강한 표현이 효과 있음.
- **편집 모드 데이터 정합성**: 편집 모달에서 기존 DB 자료를 보여주지 않으면 사용자가 "사라졌다" 고 오해하고 중복 업로드한다. 편집 모달 열릴 때 getSession + listQAPairs priority 호출해서 기존 목록 표시 + 개별 삭제 버튼.
- **회의 생성 후 화면 사라지는 버그 원인**: React 18 의 navigate + setState 경합. `urlSessionIdHandled.current = true` 를 navigate 전에 세팅하고 `activeSessionRef.current = detail` 동기 반영. DB 기본 status='recording' 이 "이 세션은 이미 녹음 중" 처럼 오판을 유발했던 것도 'prepared' 로 바꿔 해결.
- **탭 공유 이중 표시**: Chrome 의 "공유 중" 배너는 tab track 을 참조하는 모든 AudioNode 가 명시적으로 disconnect 될 때까지 유지된다. stop() 을 async 로 전환해 `audioContext.close()` 를 await 하고 모든 노드를 순서대로 disconnect → 트랙 stop → context close 순으로 정리.

### 검증 결과

- **헬스체크**: 27/27 ✓ (모든 개발완료 시점에서 통과)
- **빌드**: tsc 0 error, vite 500~600ms, 572~582 KB
- **i18n**: ko/en 5 네임스페이스 × 304 key 동수 매칭 ✓
- **API E2E** (여러 세션에 걸쳐 검증):
  - Priority Q&A CSV 업로드 → 동기 임베딩 ✓
  - Paraphrase 매칭 (임베딩 + LLM hybrid): 다수 케이스에서 priority tier 반환
  - 무관 질문 false positive 방지 ✓
  - short_answer 우선 반환 (length=short) vs full answer (length=medium/long) ✓
  - 길이 캡: short 18w/1s, medium 48w/4s, long 84w/8s 모두 cap 이내
  - 어휘 추출: 자료에 있는 5/5 verbatim 매칭, 자료에 없는 4/4 환각 제거, 언어별 강제 (ko→한국어, en→영어)
  - 편집 모드: PUT session + POST priority-qa + DELETE priority-qa 전부 작동
  - 보안: 익명 401, 잘못된 세션 404, IDOR 403
- **프론트 SPA**: 11개 라우트 전부 200

### 미완 / 다음 세션
- **Q Calendar 실 구현** (현재 placeholder)
- **Q Docs 실 구현** (현재 placeholder)
- **프로필 다중 페르소나** ("영업용 나" / "기획용 나" 전환)
- **Q note 세션 목록 검색** (현재 placeholder input)
- **메뉴별 기획 심화** — user feedback "메뉴 순서대로 기획설계 자세히 할게" 지시에 따라 Q talk → Q task → Q calendar → Q docs → Q file → Q bill 순으로 설계서 작성
- **운영 배포 스크립트** (지금은 dev 서버에서만 테스트)

---

## 완료: Q Note 답변 찾기 시스템 + 프로필 페르소나 + 사이드바 확장 (2026-04-12 #3)

Q Note의 "답변 찾기" 기능을 완전히 구현. 고객 등록 Q&A / AI 사전 생성 Q&A / 문서 RAG / 일반 AI
4단계 우선순위로 답변 탐색. 답변은 "AI 어시스턴트"가 아닌 "사용자 본인"으로서 생성되며,
프로필 정보(bio/expertise/organization/job_title)를 반영해 자연스러운 1인칭 답변.
사이드바에 Q Calendar/Q Docs 메뉴 추가.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **DB 스키마** | `qa_pairs` 테이블 + FTS5 + 트리거. `detected_questions` 확장(matched_qa_id, answer_tier). `sessions`에 user 프로필 스냅샷 5개 컬럼 | 완료 |
| **answer_service.py** | `find_answer` — 4단계 우선순위 매칭 (custom > generated > RAG > general). 한국어 2자 prefix 매칭으로 조사/어미 변형 대응 | 완료 |
| **llm_service.py 재설계** | `ANSWER_SYSTEM_RAG` / `ANSWER_SYSTEM_GENERAL` 분리. "You are NOT an AI, you ARE this person" — 1인칭 관점 강제. `translate_text` 별도 함수 (답변/번역 분리) | 완료 |
| **프롬프트 프로필 주입** | `_build_context_prefix`에 `## Your Profile (You are this person)` 블록 — Name/Job/Org/Expertise/Background | 완료 |
| **qa_generator.py** | 문서 인제스트 완료 시 자동으로 예상 Q&A 생성 → `qa_pairs` 저장 | 완료 |
| **find-answer 엔드포인트** | 답변 즉시 반환 + 번역은 백그라운드. utterance_id 제공 시 detected_questions 저장 (새로고침 후 복원) | 완료 |
| **Q&A CRUD API** | `GET/POST/PUT/DELETE /qa-pairs`. 소스 필터, 부분 수정, 꼬리질문 함께 삭제 | 완료 |
| **CSV 템플릿/업로드** | BOM UTF-8 템플릿 다운로드 (실질적 긴 답변 예시). 업로드 시 중복 question 자동 UPDATE. 길이 검증 | 완료 |
| **답변 캐시/prefetch** | 라이브 질문 감지 즉시 `_prefetch_answer` 백그라운드 실행 → WS `answer_ready` 이벤트 | 완료 |
| **Korean FTS5 매칭** | SQLite unicode61 tokenizer의 조사 분리 한계 → 2자 prefix(`회의*`) + stopwords 필터링 | 완료 |
| **PlanQ 프로필 필드** | users 테이블에 `bio`(TEXT), `expertise`, `organization`, `job_title` 추가. User 모델 sync | 완료 |
| **PUT /api/users/:id 확장** | 프로필 필드 업데이트 + 길이 검증(2000/500/200/100) + IDOR 방어 | 완료 |
| **ProfilePage "내 프로필 (Q Note 답변 생성용)"** | 4개 `AutoSaveField` 입력 필드. 2초 debounce 자동저장 + 녹색 체크 뱃지 | 완료 |
| **AuthContext 확장** | User interface + normalizeUser에 프로필 필드 매핑. Q Note 세션 생성 시 user 객체에서 자동 전달 | 완료 |
| **답변 UI — 질문 카드 재설계** | 답변 생성(빨강) / 답변 보기·접기(흰) 버튼 분리. 우측 상단 고정. 아이콘 제거. 답변 영역 full-width | 완료 |
| **질문 수정 + 합치기** | 질문 클릭→인라인 수정, Enter 확정. `+`버튼→다음 문장 합쳐서 숨김, `분리`로 복원. localStorage로 새로고침 후 복원 | 완료 |
| **번역 좌측 정렬** | 원문과 번역 padding-left 통일 | 완료 |
| **세션 목록 개선** | 상태 뱃지(녹음중/일시중지/종료), 참여자 이름 표시. "발화" → "문장" 용어 교체 | 완료 |
| **회의 제목 인라인 수정** | 헤더 제목 클릭→편집→Enter 자동저장 | 완료 |
| **세션 상세 detected_questions** | 리뷰 모드 새로고침 시 답변 있는 질문 → "답변 보기" 버튼으로 시작 | 완료 |
| **사이드바 메뉴 재배열 + 신규** | Q Talk → Task → **Q Calendar**(신규) → Note → **Q Docs**(신규) → File → Bill. 업무 흐름 순 | 완료 |
| **답변 품질 수정** | "As an AI..." 자기부정 완전 제거. 자료 없어도 프로필 기반 1인칭 자연 답변 ("Can you help me?" → "Of course!...") | 완료 |
| **후속 질문 제거** | 불필요한 토큰 낭비 — 질문 나오면 그때 답하면 됨. 프롬프트/응답/UI 전부 제거 | 완료 |

### 설계 결정 (시니어 관점)

- **4단계 우선순위 (custom > generated > RAG > general)**: 고객이 직접 등록한 Q&A가 최우선 — 회사 방침/톤이 반영된 "정답"이기 때문. AI 생성은 자료 기반 자동이지만 2순위. 둘 다 없으면 문서 청크 RAG, 그것도 없으면 일반 AI. 매 단계에서 FTS5 매칭 실패 시 다음 단계로 fallback.
- **"You are this person" 프롬프트**: Q Note가 "나만의 메모, 내 능력 향상 도구"라는 정체성을 프롬프트에 반영. 공유 안 하는 사적 공간이므로, AI가 제3자 도우미가 아닌 사용자 본인의 분신이 되어야 함. "As an AI" 자기부정을 프롬프트에서 명시적으로 금지.
- **한국어 FTS5 prefix 매칭**: SQLite unicode61 tokenizer는 한국어 조사를 별개 단어로 인식 — "회의"와 "회의는"이 매칭 안 됨. 2자 prefix(`회의*`)로 해결. 영어는 stem이 길어 prefix 대신 원형 사용.
- **답변/번역 분리**: 단일 LLM 호출로 답변+번역+꼬리질문을 한 번에 생성하면 6초. 답변만 1초 → 번역 0.6초(백그라운드). 사용자 체감 1초. 번역은 "번역 중..." placeholder로 표시 후 도착 시 교체.
- **합치기 + 숨김 (+ localStorage)**: STT가 긴 질문을 문장으로 쪼갠 경우 대비. DB 삭제 대신 화면에서만 숨겨 데이터 안전성 확보. localStorage 저장으로 새로고침 후 상태 유지. 공식 기록(트랜스크립트)은 원본 보존.
- **프로필 스냅샷**: 세션 생성 시 PlanQ users → Q Note sessions에 복사. 이후 프로필 변경에 영향 받지 않음(세션마다 당시 프로필로 답변 고정). 회의 후 프로필이 바뀌어도 과거 답변은 일관성 유지.
- **검증 중 발견한 critical 버그**:
  - `_build_field_updates`/INSERT에 신규 user 프로필 필드 누락 → 저장되지 않음 → 수정
  - FTS5 매칭 임계값이 `<= -0.5`로 너무 엄격 → `<= 0`으로 완화
  - 자료 없는 general tier에서 RAG 프롬프트가 재사용되어 "자료에서 답을 찾지 못했습니다" 강제 → 프롬프트 2개로 분리

### 검증 결과

- **헬스체크 27/27** 통과
- **Q&A CRUD E2E 26/26** (길이 검증, IDOR, 401, CSV, 답변 생성, 프로필 반영, Warplo Lab 언급 확인)
- **프로필 필드 E2E**: 전체 저장 / 부분 수정 / null 설정 / 길이 초과 400 / 다른 사용자 403 / 미인증 401 / Q Note 세션 통합
- **1인칭 답변 검증**: "As an AI" 자기부정 0건. "At Warplo Lab, we focus on...", "advancing our research in NLP..." 등 프로필 정확 반영
- **빌드**: tsc 0 error, 540KB (`index-BGw3OmKv.js`)
- **SPA 라우트**: /calendar /docs 포함 11개 전체 200
- **속도**: Tier 1 custom ~860ms, Tier 4 general ~2.3초, 번역 별도 ~640ms

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `q-note/services/answer_service.py` — 4단계 우선순위 답변 탐색
- 신규: `q-note/services/qa_generator.py` — 문서 기반 사전 Q&A 자동 생성
- 수정: `q-note/services/database.py` — qa_pairs 테이블 + FTS5, sessions 프로필 필드
- 수정: `q-note/services/llm_service.py` — RAG/GENERAL 프롬프트 분리, translate_text, user_profile prefix
- 수정: `q-note/services/ingest.py` — 인제스트 완료 후 Q&A 생성 트리거
- 수정: `q-note/routers/sessions.py` — Q&A CRUD, CSV 템플릿/업로드, find-answer, translate-answer, cached-answer, 프로필 저장, detected_questions 응답 포함
- 수정: `q-note/routers/live.py` — _prefetch_answer 백그라운드, answer_ready WS 이벤트
- 수정: `q-note/routers/voice.py` — min_sec 파라미터 (기존 유지)
- 수정: `q-note/services/deepgram_service.py` (기존 유지)

**PlanQ 백엔드 (Node)**
- `dev-backend/models/User.js` — bio, expertise, organization, job_title 컬럼
- `dev-backend/routes/users.js` — PUT /api/users/:id 프로필 필드 처리 + 검증

**프론트엔드 (TS)**
- `dev-frontend/src/App.tsx` — /calendar /docs 라우트 추가
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 사이드바 재배열 + Q Calendar / Q Docs 메뉴
- `dev-frontend/src/contexts/AuthContext.tsx` — User interface + normalizeUser 프로필 필드
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — "내 프로필 (Q Note 답변 생성용)" 카드 + AutoSaveField × 4
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 답변 UI 재설계, 질문 수정/합치기, localStorage, 세션 목록 상태 뱃지, 제목 인라인 수정, 프로필 전달
- `dev-frontend/src/services/qnote.ts` — Q&A API 함수 + 타입, translate-answer, cached-answer, 프로필 필드
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` (기존 유지)
- 기타 오디오 관련 파일 (기존 유지)

### 미완 / 다음 세션

- **Q Calendar 실 구현**: 현재 placeholder 페이지. 일정 CRUD, 반복 이벤트, Q Task 연동
- **Q Docs 실 구현**: 현재 placeholder 페이지. 문서 에디터, 버전 관리, Q Note 답변 찾기와의 연동
- **프로필 확장 2단계**: "영업용 나" / "기획용 나" 같은 다중 페르소나
- **회의별 추가 컨텍스트**: 세션별로 `brief`를 넘는 세밀한 문맥 주입

---

## 완료: Q Note 라이브 전사 전면 개선 — LLM 재설계 + 질문 판정 + 채널 화자 + UX 재구조 (2026-04-12)

실 테스트 피드백 기반 전면 개선. LLM 프롬프트 언어별 분리, 질문 오판 대폭 감소, 채널 기반 화자 식별,
트랜스크립트 렌더링 재설계, 회의 시작 모달 단순화.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **LLM 모델 분리** | 실시간 정제: gpt-4.1-nano (속도), 요약/답변: gpt-4o-mini (품질). `LLM_MODEL_ANSWER` env 추가 | 완료 |
| **언어별 전용 프롬프트** | `TRANSLATE_SYSTEM` 단일 → `SYSTEM_KO` / `SYSTEM_EN` / `SYSTEM_DEFAULT` 자기완결 프롬프트 | 완료 |
| **질문 판정 전면 재설계** | 한국어: ~지?/~잖아?/~할까? 등 false. 영어: tag/rhetorical/request false. "의심되면 false" 원칙 | 완료 |
| **max_completion_tokens** | 700 → 300 (속도 개선) | 완료 |
| **프론트 낙관 질문 판정 제거** | `textEndsWithQuestion` 삭제 → 서버 `is_question`만으로 판정 | 완료 |
| **enrichment → block.kind 교정** | enrichment `is_question`으로 block `kind` 실시간 전환 (speech ↔ question) | 완료 |
| **2초 merge 완전 제거** | 라이브 `commitPendingAsBlock` + 리뷰 `buildBlocksFromSession` 모두. 각 utterance 독립 블록 | 완료 |
| **블록 렌더 수평 레이아웃** | `SpeechRow`/`QuestionRow` 인라인 — 화자 + 본문 + 시간 한 줄 | 완료 |
| **"번역 중..." 제거** | 번역 미도착 시 표시 없음 | 완료 |
| **WebConferenceCapture 스테레오** | ChannelMerger — mic=Left(나), tab=Right(상대) | 완료 |
| **window.focus()** | 탭 공유 후 PlanQ 탭 자동 복귀 | 완료 |
| **PCMStreamer 스테레오** | 2채널 인터리브 모드 | 완료 |
| **Deepgram multichannel** | web_conference → channels=2, multichannel=true. diarize는 mono만 | 완료 |
| **채널별 독립 버퍼** | `pending_buffers` dict — multichannel에서 두 화자 텍스트 혼합 방지 | 완료 |
| **채널 기반 화자** | channel 0=mic=나(is_self 자동), channel 1=tab=상대 | 완료 |
| **finalized에 is_self/channel_index** | 세션 새로고침 없이 즉시 "나"/"상대" 라벨 반영 | 완료 |
| **문장 단위 화자 변경 API** | `POST /{session_id}/utterances/{utterance_id}/reassign-speaker` 신규 | 완료 |
| **speakerLabelFor 참여자 기반** | 참여자 1명→이름, 다수→"상대". 미할당 기본값 "상대" | 완료 |
| **마이크 모드 라벨 분기** | 수동 지정(participant_name/is_self)만 표시. 자동 라벨 안 붙음 | 완료 |
| **_auto_match_self 병합** | 중복 is_self → utterances 기존 speaker로 이동, 중복 speaker 삭제 | 완료 |
| **SpeakerPopover 필터링** | 이미 지정된 화자 숨김, "나" 지정됐으면 "나" 버튼 숨김, 빈 팝오버 힌트 | 완료 |
| **voiceCheck/핑거프린트 제거** | self-voice 업로드, LiveSelfMatched 이벤트, VoiceWarnBanner 전부 삭제 | 완료 |
| **/notes/:sessionId 라우트** | URL 기반 세션 접근 + 자동 열기 | 완료 |
| **ParticipantBar UI** | 헤더 아래 참여자 목록 바 (나 + 참여자 이름/역할) | 완료 |
| **StartMeetingModal 단순화** | 회의 언어 다중→단일 선택. 번역/답변 언어는 "고급 설정" 접기 | 완료 |
| **Deepgram 파라미터** | utterance_end_ms 1000→2000, endpointing=500. 연결 실패 시 키워드 없이 재시도 | 완료 |

### 설계 결정 (시니어 관점)

- **LLM 모델 2단 분리**: 실시간 정제(gpt-4.1-nano)는 속도가 관건 — 사용자가 말하는 즉시 띄어쓰기/구두점이 교정되어야 한다. 요약/답변(gpt-4o-mini)은 사용자 클릭 후 대기 가능하므로 품질 우선. 한 모델로 통일하면 속도/품질 중 하나를 포기해야.
- **언어별 자기완결 프롬프트**: 기존 단일 프롬프트는 한국어/영어 규칙이 뒤섞여 LLM이 혼동. 한국어 조사 규칙("나는", "회의를")과 영어 capitalization 규칙을 동시에 넣으면 어느 쪽도 제대로 적용 안 됨. 언어별로 해당 언어에만 집중하는 프롬프트가 정확도 훨씬 높음.
- **질문 판정 strict false**: false positive(평서문이 질문 카드로 표시)가 누락(질문 놓침)보다 훨씬 나쁨. 사용자가 보는 화면에서 "질문이 아닌 게 질문으로 뜸" = 신뢰도 하락. 반면 질문 놓침은 트랜스크립트 스크롤로 보완 가능. 따라서 의심되면 무조건 false. 한국어 ~지?/~잖아?/~할까? 같은 확인/제안/가정 어미를 명시적으로 false 패턴에 열거.
- **2초 merge 제거**: merge 로직은 "같은 화자 연속 발화를 합치면 깔끔" 이란 가정이었으나, Deepgram이 문장을 쪼개는 방식과 충돌 — 다른 사람의 발화가 같은 블록에 합쳐지거나, 질문이 이전 speech에 흡수되는 부작용. 각 utterance를 독립 블록으로 두면 서버 is_question이 block.kind를 정확히 제어 가능.
- **채널 = 화자 (web_conference)**: ML 기반 화자 식별(Resemblyzer, Deepgram diarize)은 실제로 불안정. 웹 화상회의에서는 mic=나, tab=상대가 물리적으로 보장됨. 채널 분리가 100% 정확한 유일한 방법.
- **문장 단위 화자 변경(reassign-speaker)**: 기존 speaker-merge 방식은 "화자 A의 모든 발화를 화자 B로" 이동 — 이건 Deepgram이 화자를 잘 분리했을 때만 유효. 실제로는 한 speaker 안에 여러 사람 발화가 섞여 있으므로, 문장 단위로 "이 발화는 누구 것" 지정이 더 정확.

### 검증 결과

- 실 테스트 (Irene 직접 수행)

### 수정된 파일

**Q Note 백엔드 (Python)**
- `q-note/services/llm_service.py` — LLM 모델 분리, 언어별 프롬프트, 질문 판정 재설계
- `q-note/services/deepgram_service.py` — multichannel, utterance_end_ms/endpointing, channel_index 파싱
- `q-note/routers/live.py` — 채널별 버퍼, multichannel 화자, _auto_match_self 병합, finalized is_self, 키워드 재시도
- `q-note/routers/sessions.py` — reassign_utterance_speaker API 신규
- `q-note/routers/voice.py` — min_sec 파라미터

**프론트엔드 (TS)**
- `dev-frontend/src/App.tsx` — /notes/:sessionId 라우트
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 질문 판정/merge/렌더/화자/URL 전면 재설계
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — 단일 언어 선택, 고급 설정, VoiceWarn 삭제
- `dev-frontend/src/services/qnote.ts` — reassignUtteranceSpeaker API
- `dev-frontend/src/services/qnoteLive.ts` — self-voice 제거, stereo 파라미터
- `dev-frontend/src/services/audio/PCMStreamer.ts` — stereo 모드
- `dev-frontend/src/services/audio/WebConferenceCapture.ts` — ChannelMerger 스테레오, window.focus()

### 미완 / 다음 세션

- **Phase B 답변 찾기 API**: 질문 카드의 "답변 찾기" 실 API 연결
- **Phase C 답변 찾기 UI**: 답변 패널 mock → Irene 승인 → 실 연결

---

## 완료: Q Note 품질 전면 개선 — 7 Phase 리팩터링 (2026-04-11 #2)

라이브 STT 품질에 대한 사용자 피드백 ("텍스트 속도 느림, 한국어 띄어쓰기 버벅임, LLM 교정 안 됨,
본인 인식 실패, 참여자 선택 안 됨") 을 7 개 근본 원인으로 해부하고 Phase 단위로 전면 재구현.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Phase 0 실측** | DB 실측으로 참여자 NULL 저장/capture_mode 컬럼 부재/LLM 프롬프트 제약 확정 | 완료 |
| **Phase 5 참여자** | `StartMeetingModal.handleStart` — 미반영 pName/pRole 자동 포함 (엔터/추가 버튼 없이 "회의 시작" 눌러도 저장) | 완료 |
| **Phase 1 라이브 렌더** | `live.py` 누적 버퍼 설계 — Deepgram 의 여러 `is_final=true` 청크를 `pending_utterance` 에 누적, `speech_final=true` 또는 `UtteranceEnd` 도착 시 **하나의 row 로 단일 commit**. "한 문장 = 한 row" 원칙 + 앞부분 loss 없음 (메모리 `feedback_qnote_stt_llm_quirks.md` 2번 규칙 준수) | 완료 |
| Phase 1 | Enrichment singleton — utterance_id 당 최신 태스크만 유지 (중복 리렌더 차단) | 완료 |
| Phase 1 | WS close finally 에서 누적 버퍼 강제 flush — 일시중지/종료 시 문장 중간 drop 방지 | 완료 |
| Phase 1 | `QNotePage.tsx` 터미네이터 (`?.!`) 대기 로직 전면 폐기, `finalized` 이벤트 즉시 블록 승격, 2초 gap merge 에 위임 | 완료 |
| Phase 1 | `buildBlocksFromSession` 단순화 — 각 utterance 단일 buffer flush. 데드코드 (FLICKER_TOLERANCE_SEC, SILENCE_HARD_CAP_SEC, textEndsWithTerminator) 제거 | 완료 |
| **Phase 2 LLM 교정** | `TRANSLATE_SYSTEM` 재설계 — "Do NOT change word choice" 삭제, 회의 컨텍스트 기반 phonetic mis-recognition 교정 지시 추가 | 완료 |
| Phase 2 | `deepgram_service.py` — `keywords` 파라미터 추가. nova-3 는 `keyterm`, nova-2 이하는 `keywords:2` 자동 분기. 언어별 모델 env 오버라이드 (`DEEPGRAM_MODEL`, `DEEPGRAM_MODEL_KO`) | 완료 |
| Phase 2 | `live.py._extract_keywords` — brief/participants/pasted_context 에서 고유명사 추출 (영문 대문자 연속, 한글 따옴표, 참여자 이름) → Deepgram keyword boosting | 완료 |
| **Phase 3 한국어 모델** | `_resolve_model_for_language()` — `DEEPGRAM_MODEL_<LANG>` 환경변수 오버라이드 경로 (실환경 A/B 후 `nova-2-general` 전환 가능) | 완료 |
| **Phase 4 본인 인식** | `SELF_MATCH_THRESHOLD` 0.68 → 0.62 (환경변수 `QNOTE_SELF_MATCH_THRESHOLD` 오버라이드). CLUSTER_MERGE 0.65 → 0.60 | 완료 |
| Phase 4 | `SpeakerAudioCollector.live_trigger_sec` 5.0 → 3.0 (첫 발화 빠른 매칭) | 완료 |
| Phase 4 | **이중 방어**: `_auto_match_self` — 세션 내 이미 `is_self=1` speaker 존재 시 스킵 (과거 mixed stream 에서 모든 speaker 에 is_self 찍혀 "나만 보임" 유발한 버그 재발 방지) | 완료 |
| Phase 4 | **경로 분기**: web_conference 모드는 `_auto_match_self` 스킵 → 프론트 마이크 전용 `/self-voice-sample` 만 사용 (mixed stream 매칭 품질 저하 회피). microphone 모드만 live 매칭 | 완료 |
| Phase 4 | `StartMeetingModal` — 음성 미등록 시 Rose 팔레트 경고 배너 + 프로필 링크 | 완료 |
| **Phase 6 capture_mode** | `sessions.capture_mode` 컬럼 마이그레이션 (default 'microphone') | 완료 |
| Phase 6 | `routers/sessions.py` CreateSessionRequest/UpdateSessionRequest 에 `capture_mode` 추가 + `_validate_capture_mode` (잘못된 값 400) | 완료 |
| Phase 6 | `services/qnote.ts` — `QNoteCaptureMode` 타입 + `CreateSessionPayload.capture_mode` | 완료 |
| Phase 6 | `QNotePage.openReview` — DB `capture_mode` 로 pendingConfig 복원 (하드코딩 `'microphone'` 제거) | 완료 |
| Phase 6 | `QNotePage.startRecording` — paused→web_conference 재개 시 "탭 공유 다시 선택" 안내 notice + pendingConfig 없을 때 DB 기반 fallback | 완료 |
| **이모지 클린업** | `StartMeetingModal` "스캔본 ❌" → "스캔본 불가" (메모리 규칙 `feedback_no_emoji_check.md` 준수) | 완료 |

### 설계 결정 (시니어 관점)

- **"한 문장 = 한 utterance row" — 누적 버퍼 설계**: 기존은 Deepgram `is_final=true` 이벤트를 전부 DB insert 해서 한 문장이 N 개 row 로 쪼개지고 enrichment 가 N 번 돌아 프론트 리렌더 N 번 → "버벅거림". 단순히 `speech_final=true` 만 commit 하면 Deepgram 이 한 문장을 여러 `is_final` 청크로 쪼개 보내고 **마지막 청크에만** speech_final 이 붙는 경우 앞부분이 drop (이전 세션에서 실측 확인, 메모리 `feedback_qnote_stt_llm_quirks.md` 2번에 기록). 해결: 모든 `is_final=true` 조각을 `pending_utterance` 버퍼에 누적 → `speech_final=true` 또는 `UtteranceEnd` 도착 시 전체 텍스트를 하나의 row 로 commit. 양쪽 요구 모두 충족 — 한 row = 한 문장 + 앞부분 loss 없음. 추가 안전장치로 WS close finally 에서 강제 flush.
- **LLM 프롬프트 철학 전환**: 기존은 "띄어쓰기만 고쳐라, 단어 바꾸지 마라" 로 교정을 원천 차단. 하지만 STT 고유명사 오탐은 **맥락으로만 교정 가능** 한 문제다. 회의 브리프/참여자/자료를 system prompt 앞에 붙이고 "phonetically similar but contextually wrong 이면 교체하라 (확신 없으면 원본 유지)" 로 바꾸니 gpt-4o-mini 가 회의 컨텍스트를 적극 활용. Deepgram `keyterm` 은 저수준 부스팅, LLM 은 고수준 교정 — 이중 레이어.
- **본인 인식 이중 방어**: web_conference 의 mixed stream (mic + tab) 에서 Resemblyzer 임베딩을 계산하면 발화 구간마다 user voice 가 섞여 있어 **모든 speaker 가 is_self 로 찍히는** 심각한 버그 발생. 경로를 분리해 mixed 는 live 매칭을 아예 끊고, 프론트가 별도 마이크 전용 채널 10 초 를 `/self-voice-sample` 로 업로드. microphone 모드는 audio_buf 자체가 깨끗해서 기존 경로 유지. 추가로 "세션당 is_self 1 명" 가드를 live.py 에 넣어 어떤 경로에서도 중복 마킹 불가.
- **capture_mode 영속화**: 새로고침 시 브라우저 권한 소실 + 사용자가 원래 모드를 기억하지 못하는 두 문제를 컬럼 하나로 동시 해결. Frontend 는 `openReview` 에서 DB 값으로 복원하고 `startRecording` 에서 web_conference 재개 시 명시적으로 "탭 공유 다시 선택" notice 를 띄워 사용자가 의도적으로 재선택하게 유도.

### 검증 결과

- **헬스체크 27/27** (infra / auth / security / qnote / voice / external / frontend 전 카테고리)
- **Q Note E2E 30/30** (참여자 3 명 round-trip, 빈 배열, role null, capture_mode web_conference/microphone 전환, 잘못된 값 400, LLM 한국어 띄어쓰기 복원 + 영어 번역, 영어 질문 감지 + 한국어 번역, IDOR 방어, 미인증 401, 세션 CUD + 목록 + 삭제 후 404)
- **실 LLM 검증**:
  - 입력: `안녕하세요저는루아입니다오늘회의는큐노트에대해논의하는자리입니다`
  - formatted_original: `안녕하세요, 저는 루아입니다. 오늘 회의는 큐 노트에 대해 논의하는 자리입니다.`
  - translation: `Hello, I am Lua. Today's meeting is to discuss Q Note.`
  - 영어 질문 `Could you tell me more about the Q Note feature?` → is_question=true, 한국어 번역 생성
- **빌드**: tsc 0 error, 151 modules, 537 KB, `Cq6XLQAT.js`
- **SPA 라우트**: /notes · /profile · /talk · /tasks · /files · /billing · /dashboard · /login 전부 200
- **PM2**: planq-dev-backend · planq-qnote online, 에러로그 clean
- **번들 포함 확인**: `capture_mode`, `VoiceWarnBanner`, `finalized`, "탭 오디오/재선택" 문자열 4/4
- **UI/UX**: `window.alert`/`window.confirm`/`toast.success` 0건, 이모지 0건 (❌ 1건 제거)

### 수정된 파일

**Q Note 백엔드 (Python)**
- `q-note/services/database.py` — sessions.capture_mode 컬럼 마이그레이션
- `q-note/services/voice_fingerprint.py` — threshold 환경변수화 (SELF_MATCH_THRESHOLD 0.62, CLUSTER_MERGE_THRESHOLD 0.60)
- `q-note/services/deepgram_service.py` — `keywords` 파라미터, 모델 env var 오버라이드 (DEEPGRAM_MODEL, DEEPGRAM_MODEL_<LANG>)
- `q-note/services/llm_service.py` — TRANSLATE_SYSTEM 재설계 (contextual correction)
- `q-note/routers/sessions.py` — capture_mode CRUD + `_validate_capture_mode`
- `q-note/routers/live.py` — speech_final 기반 commit, enrichment singleton, `_extract_keywords`, `_auto_match_self` 세션당 1명 가드 + web_conference 경로 분리

**프론트엔드 (TS)**
- `dev-frontend/src/services/qnote.ts` — QNoteCaptureMode 타입, CreateSessionPayload.capture_mode
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — participants flush, 음성 미등록 경고 배너, 이모지 정리
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 라이브 렌더 전면 재설계, openReview capture_mode 복원, startRecording web_conference resume 안내

### 미완 / 다음 세션

- **실라이브 테스트**: 실제 회의 녹음으로 띄어쓰기 1회 렌더 / 본인 1명 인식 / 참여자 popover 노출 / 고유명사 교정 확인
- **한국어 모델 A/B**: nova-3 vs nova-2-general 30초 녹음 비교 후 `DEEPGRAM_MODEL_KO` 고정
- **Threshold 튜닝**: 실 매칭 시 self-match 로그 유사도 기반 `QNOTE_SELF_MATCH_THRESHOLD` 재조정
- **Phase B 답변 찾기 API**: 질문 카드의 `답변 찾기` 버튼 실 API 연결
- **Phase C 답변 찾기 UI**: 답변 패널 mock → Irene 승인 → 실 연결

---

## ✅ 완료: Q Note Phase A + Phase D + 라이브 UX 전면 안정화 (2026-04-11)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Phase A — 인제스트 파이프라인** | `documents` 테이블 확장 (source_type/source_url/title/error_message/indexed_at) + 파일/URL 공통 파이프라인 | ✅ |
| Phase A | `services/url_fetcher.py` — hop별 SSRF 재검증(DNS rebinding 방어) + HTTPS 강제 + 스트리밍 10MB 캡 + 5s/15s 타임아웃 + 리다이렉트 3회 + Content-Type 화이트리스트 | ✅ |
| Phase A | `services/extractors.py` — HTML(trafilatura) / PDF(pdfplumber) / DOCX(python-docx) / TXT 다중 인코딩 fallback. asyncio.to_thread 래핑 | ✅ |
| Phase A | `services/chunker.py` — 단락+문장 hybrid 청크 (500자/50자 overlap), 약어 예외 문장 경계 | ✅ |
| Phase A | `services/ingest.py` — `ingest_document(doc_id)` 단일 진입점, file/url 공통, `pending→processing→indexed/failed`, `add_done_callback` silent drop 방지 | ✅ |
| Phase A | `sessions.py` 라우터 재배선 — POST/documents·POST/urls가 background 태스크로 ingest 트리거, `sessions.urls` JSON 컬럼 deprecated | ✅ |
| **Phase D-0 캡처 수정** | `WebConferenceCapture` 신규 — 마이크(본인) + 탭 오디오(상대) `getUserMedia + getDisplayMedia` → Web Audio API 믹싱. 탭 단독 `BrowserTabCapture.ts` 삭제 | ✅ |
| Phase D-0 | 탭 오디오 무음 감지 워치독 — 3초간 탭 트랙 신호 없으면 console.warn | ✅ |
| **D-1 언어 필터** | `live.py` enrichment에 `allowed_languages` 주입. `detected_language ∉ meeting_languages` 시 `out_of_scope=True` + 번역/질문감지 폐기. 프론트 opacity 0.45 + 언어 태그 | ✅ |
| **D-2 음성 핑거프린트** | Resemblyzer(CPU, 256-d, L2-normalized) + `services/audio_buffer.py`(RollingAudioBuffer 60s + SpeakerAudioCollector) + `routers/voice.py`(**다국어** CRUD + verify) | ✅ |
| D-2 | `voice_fingerprints` 스키마 다국어 전환 `(user_id, language) UNIQUE` + `speaker_embeddings` 테이블 신규. 기존 데이터 `'unknown'` 태그로 보존 마이그레이션 | ✅ |
| D-2 | live.py 본인 매칭 — 마이크 전용 사이드 채널(web_conference 모드) → `/self-voice-sample` 10초 업로드 → `dg_speaker_hint` + max similarity 언어별 비교 | ✅ |
| **D-3 배치 화자 병합** | `services/speaker_clustering.py` — sklearn AgglomerativeClustering (cosine, sim ≥ 0.65), PUT status='completed' 트리거, `is_self` 상속 | ✅ |
| **D-4 화자 네이밍 UI** | 발화 블록 `[화자 N ▾]` 버튼 → `SpeakerPopover` 인라인 팝오버 (나/참여자/직접 입력). 같은 이름·is_self 자동 병합. `block.id` 기반 스코프로 중복 팝오버 버그 수정 | ✅ |
| **D-5 개인정보** | 회의 종료 시 PCM 버퍼 즉시 drop. 프로필 개인정보 처리 안내 4항목. 다국어 핑거프린트 삭제 API | ✅ |
| **프로필 페이지** | `/profile` 신규 — 기본 언어 + 다국어 음성 등록/재등록/삭제 + 매칭 확인하기(verify) + `WavRecorder` (AudioContext → WAV Blob, ffmpeg 무의존). 언어 드롭다운 선택 즉시 녹음 시작 UX. 하드 상한 30초만 자동 종료, 사용자 수동 종료 권장 | ✅ |
| **본인 인식 실패 버그 수정** | `speakerLabel` 동적 계산 — 블록 렌더마다 `speakerLabelFor()` 실시간 호출. `self_matched` WS 이벤트 후 label 즉시 "나"로 전환. 실패 시 `self_match_failed` 이벤트 + 유저 친화 안내 | ✅ |
| **텍스트 중복 버그 수정** | Deepgram `is_final=true` 모든 이벤트 commit (speech_final 필터 제거 — 문장 앞부분 손실 방지) + **2중 dedup** (시간 오버랩 + 직전 3개 정규화 텍스트 비교) | ✅ |
| **한국어 띄어쓰기 복구** | GPT-5-mini(reasoning, empty response) → **gpt-4o-mini** 교체. `translate_and_detect_question failed` 에러 근절. `formatted_original` 필드로 실시간 보정 | ✅ |
| **리프레시 시 회의 종료 버그** | `openReview`에서 session.status 기반 phase 결정 (`recording→paused`, `completed→review`). `buildBlocksFromSession` 공용 헬퍼로 paused 진입 시 서버 utterances 하이드레이트 | ✅ |
| **연속 발화 merge** | `commitPendingAsBlock` + `reviewBlocks`에 `MERGE_GAP_SEC=2.0` 규칙 — 같은 화자 + 2초 이내면 speech/question 구분 없이 병합. 질문 포함 시 question 카드로 | ✅ |
| **녹음 이어하기 멈춤 대응** | `startRecording` 실패 시 `NotAllowedError`/탭 공유 취소/WS 실패를 **유저 친화 메시지**로 변환. `pendingConfig=null` 시 마이크 모드 폴백. `console.error`로 원본 에러 기록 | ✅ |
| **사이드바 언어 저장 버그** | `/api/users/language` (존재 안 함) → `/api/users/:id` 경로 수정. LanguageSelector `try/catch`로 가려져 있던 무증상 버그 | ✅ |
| **ConfirmDialog 이식** | ProfilePage의 `window.confirm` 2곳 → `ConfirmDialog` React 컴포넌트. `alert()` 금지 규칙 준수 | ✅ |
| **검증 스크립트 v2 이식** | POS `/var/www/dev-backend/scripts/health-check.js` v2 구조 차용 (CLI 옵션, 카테고리 시스템). 19 → **27 체크** 확장 (infra/auth/security/qnote/voice/external/frontend). `--category`, `--quiet`, `--verbose`, `--host` 지원 | ✅ |

### 설계 결정 (시니어 관점)

- **DB 실측 기반 디버깅**: "두 번씩 나온다" / "띄어쓰기 안 된다" / "본인 인식 못 한다" — 각 증상을 SQL로 직접 확인해 근본 원인 파악. 코드 레벨 추측 대신 데이터 검증.
- **Deepgram multi 모드의 한계 수용**: Nova-3 multi는 한국어 정확도 크게 떨어지고 같은 구간을 여러 번 재해석. 사용자에게 1개 언어 선택 권장 UX.
- **다국어 핑거프린트**: Resemblyzer는 영어 편향이 있어 cross-language 매칭 시 유사도 하락. 사용자가 언어별 등록 → max similarity로 대응.
- **reasoning LLM 금지**: gpt-5-mini (reasoning)는 max_completion_tokens 700에서 reasoning 토큰만 소진 → empty response → json.loads 실패. gpt-4o-mini (non-reasoning)로 교체.
- **dedup 2중 방어**: 시간 오버랩(start < last_end - 0.1) + 텍스트 정규화(직전 3개 공백 제거 비교). 어느 하나만으론 다양한 Deepgram 이벤트 패턴 전부 못 잡음.
- **UI-First + ConfirmDialog**: CLAUDE.md의 alert 금지 규칙 일관 적용. window.confirm까지 동일 범주로 간주.
- **speakerLabel 동적 계산**: 블록 데이터 구조에 문자열 스냅샷 저장은 state 업데이트 시 stale. 렌더 시 `activeSession.speakers`에서 실시간 lookup.

### 검증 결과

- **헬스체크 27/27** (7 카테고리: infra·auth·security·qnote·voice·external·frontend)
- **Ingest E2E 12/12** (Phase A)
- **Voice Fingerprint E2E 10/10**
- **Speaker Merge E2E 5/5**
- **턴 검증 E2E 12/12** — 한국어 띄어쓰기 실 LLM 4건 전부 복구 확인
- 빌드: tsc 0 error, 151 modules, 536KB, `iQIgwuc5`
- 백엔드 에러로그 clean (gpt-4o-mini 전환 후)

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `services/voice_fingerprint.py`, `services/audio_buffer.py`, `services/speaker_clustering.py`, `services/url_fetcher.py`, `services/extractors.py`, `services/chunker.py`, `services/ingest.py`, `routers/voice.py`
- 수정: `services/database.py`, `services/llm_service.py`, `services/deepgram_service.py`, `routers/sessions.py`, `routers/live.py`, `main.py`, `requirements.txt`, `.env` (LLM_MODEL=gpt-4o-mini)

**Q Note 프론트엔드 (TS)**
- 신규: `pages/Profile/ProfilePage.tsx`, `services/audio/WebConferenceCapture.ts`, `services/audio/recordToWav.ts`
- 수정: `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx`, `services/qnote.ts`, `services/qnoteLive.ts`, `services/audio/index.ts`, `services/audio/AudioCaptureSource.ts`, `services/audio/PCMStreamer.ts`, `components/Layout/MainLayout.tsx`, `components/Common/Icons.tsx`, `components/Common/LanguageSelector.tsx`, `contexts/AuthContext.tsx`, `App.tsx`
- 삭제: `services/audio/BrowserTabCapture.ts`, `pages/QNote/mockData.ts`

**기타**
- `scripts/health-check.js` (v2 구조 이식)

### 미완 / 다음 세션

- **실라이브 본인 인식 튜닝**: Resemblyzer 매칭 임계값(0.68) 실 회의 데이터 기반 조정 필요
- **모달 participants 재사용 UX**: localStorage 캐시 → 다음 회의 모달에 기본값 제안
- **Deepgram 세션 split (4시간 한계)**: 재연결 로직과 묶어서 구현
- **Phase B 답변 찾기 API**: utterance_id + 컨텍스트 5개 → BM25 top-K → GPT-4o-mini 답변
- **Phase C 답변 찾기 UI**: 답변 표시 패널 mock → Irene 승인 → 실 API 연결

---

## ✅ 완료: Q Note B-3 Step 8 — 프론트 실 API 연결 + 라이브 UX 재설계 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **API 클라이언트** | `services/qnote.ts` 신규 — 세션 CRUD / 문서 / URL / 화자 매칭 + `buildLiveSocketUrl` (JWT query) | ✅ |
| **WebSocket 라이브** | `services/qnoteLive.ts` 신규 — `LiveSession` (캡처 + WS + PCM 파이프 + 이벤트 라우팅) | ✅ |
| **PCM 스트리머** | `services/audio/PCMStreamer.ts` 신규 — MediaStream → 16kHz mono PCM16 (ScriptProcessorNode + muted gain) | ✅ |
| **QNotePage 재설계** | mock 완전 제거 + 실 API 연결 + WebSocket 통신 | ✅ |
| **상태 머신** | `empty → prepared → recording ⇄ paused → review` — 자동 녹음 방지, 일시중지/재개/종료 분리 | ✅ |
| **터미네이터 기반 커밋** | Deepgram finals를 pending 버퍼에 누적, `? . !` 도착 시 한 번에 커밋 → 한 문장이 여러 카드로 쪼개지는 문제 해결 | ✅ |
| **Pending 유령 블록** | 미완성 문장을 opacity 0.55 이탤릭 + `…` 로 라이브 표시 | ✅ |
| **카드 패러다임 전환** | 일반 발화 → flat transcript 블록 (보더 없음). **질문만 카드** — 공간 밀도 4-5배 | ✅ |
| **질문 카드 수평 레이아웃** | 좌측 본문 + 우측 답변 찾기 버튼 → 높이 ~120px → ~70px (42% 감소) | ✅ |
| **플리커 내성 병합** | 같은 dg_speaker 또는 갭 < 1.5초 → 병합 (Deepgram diarize 플리커 무시). 20초 침묵 → 강제 flush | ✅ |
| **낙관 질문 감지** | 문장 끝 `?` + wh-word + 한국어 의문 어미 즉시 감지 → GPT enrichment 기다리지 않음 | ✅ |
| **번역 부분 표시** | 일부 segment만 번역 도착해도 있는 부분 렌더 + 끝에 `…`. 전체 없음 시 "번역 중…" placeholder | ✅ |
| **자동 하단 스크롤** | 라이브 모드에서 블록/interim 업데이트 시 transcript 영역 하단으로 smooth scroll | ✅ |
| **모달 state 리셋** | `StartMeetingModal` 열릴 때마다 모든 입력 초기화 (이전 회의 데이터 잔존 방지) | ✅ |
| **live.py `finalized` 이벤트** | DB insert 후 utterance_id 즉시 클라이언트 통지 → enrichment와 정확 상관관계 | ✅ |
| **live.py WS 종료 정리** | WS close 시 자동 status=completed 제거 → pause/resume 가능, 명시적 PUT으로만 종료 | ✅ |
| **Deepgram `smart_format=true`** | 구두점 + 숫자/날짜/시간 자동 포맷 → 터미네이터 감지 정확도 향상 | ✅ |
| **speaker 라벨 fallback** | DB 매칭 실패해도 dg_speaker_id로 "화자 1", "화자 2" 즉시 라벨링 | ✅ |
| **mockData.ts 삭제** | — | ✅ |

### 설계 결정 (시니어 UX 관점)

- **카드 → Flat transcript + 질문 카드**: Otter/Fireflies 패턴 차용. 모든 발화 카드화는 공간 낭비 + scanning 방해
- **터미네이터 기반 커밋**: Deepgram final은 문장 단위가 아니라 VAD 단위. 문장 경계(`.!?`)에서만 커밋해야 한 질문이 여러 카드로 찢어지지 않음
- **플리커 1.5초 내성**: Deepgram 실시간 diarize의 speaker_id는 말 중간에도 튐. 1.5초 미만 갭 내 speaker 변경은 무조건 플리커로 간주
- **시간/길이 캡 제거**: 인위적 카드 분할은 맥락 단절. 유일한 분할 기준은 침묵(20초), 질문, 진짜 화자 교체
- **답변 찾기 수평 배치**: 풀스크린 사용 가능성 고려, 카드 높이 최소화

### 검증

- 빌드: tsc 0 error, vite 147 modules, 497KB 번들
- 헬스체크: **19/19 통과**
- Step 8 E2E: **14/14 통과** (CRUD + round-trip + PUT 부분 업데이트 + 문서 업로드 + 확장자 블랙리스트 + SSRF 3종 + 인증 + pagination + CASCADE)
- 유저 플로 E2E: **6/6 통과**
- 페이지 서빙 200, 번들 내 실 API 경로 + 신규 UI 문자열 검증

### 수정/생성된 파일

**생성:**
- `dev-frontend/src/services/qnote.ts`
- `dev-frontend/src/services/qnoteLive.ts`
- `dev-frontend/src/services/audio/PCMStreamer.ts`

**수정:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` (대폭 재설계 — 1063줄)
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` (open 시 state reset)
- `q-note/routers/live.py` (finalized 이벤트 + WS 종료 로직)
- `q-note/services/deepgram_service.py` (smart_format=true)

**삭제:**
- `dev-frontend/src/pages/QNote/mockData.ts`

### 미완 / 다음 세션

- **Step 6**: URL Fetcher (trafilatura + https 강제 + SSRF 재사용 + 10MB/15s + sessions.urls status 갱신)
- **Step 7**: B-5 RAG 기초 (PDF/DOCX/TXT 추출 + 500자 청크 + SQLite FTS5 + 답변 찾기 API)
- **실제 회의 테스트**: 라이브 녹음 UX 추가 튜닝 (pending 동작, 질문 감지 정확도 관찰)
- **프로필 페이지**: language 변경 UI, 음성 핑거프린트
- **연결 끊김 처리**: WebSocket 재연결 + 오디오 버퍼
- **4시간 한계 처리**: Deepgram 세션 split
- **법적 동의 모달**: 녹음 동의, AI 데이터 처리 안내

---

## 완료: Q Note B-3 Backend Wiring Step 1–5 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Step 1 DB 스키마** | sessions 컬럼 6종 추가 (brief, participants, urls, meeting_languages, translation_language, answer_language) | 완료 |
| **Step 1 DB 스키마** | sessions.pasted_context 컬럼 추가 | 완료 |
| **Step 1 DB 스키마** | speakers 신규 테이블 (session_id, deepgram_speaker_id, participant_name, is_self) | 완료 |
| **Step 1 DB 스키마** | utterances.speaker_id FK 추가 | 완료 |
| **Step 1 DB 스키마** | documents.session_id FK + 인덱스 추가 | 완료 |
| **Step 1 DB 스키마** | 기존 데이터 보존 마이그레이션 (PRAGMA table_info 체크 → ALTER) | 완료 |
| **Step 2 세션 API** | POST /api/sessions — brief/participants/언어3종/pasted_context 수신 | 완료 |
| **Step 2 세션 API** | PUT /api/sessions/:id — 모든 필드 부분 업데이트 + JSON 역직렬화 | 완료 |
| **Step 2 세션 API** | GET /api/sessions/:id — utterances + documents + speakers 포함 | 완료 |
| **Step 2 문서** | POST /api/sessions/:id/documents — multipart 업로드 (10MB, 확장자 화이트리스트) | 완료 |
| **Step 2 문서** | DELETE /api/sessions/:id/documents/:doc_id — DB + 디스크 파일 정리 | 완료 |
| **Step 2 URL** | POST /api/sessions/:id/urls — https + SSRF 방어 (내부 IP/loopback/link-local 차단) | 완료 |
| **Step 2 URL** | DELETE /api/sessions/:id/urls/:url_id | 완료 |
| **Step 3 Deepgram** | deepgram_service.py `diarize=true` 추가 | 완료 |
| **Step 3 Deepgram** | 단어 리스트 다수결로 deepgram_speaker_id 추출 | 완료 |
| **Step 3 Deepgram** | meeting_languages → language 파라미터 매핑 (1개=단일, 여러개=multi) | 완료 |
| **Step 4 화자 매칭** | POST /api/sessions/:id/speakers/:speaker_id/match | 완료 |
| **Step 4 화자 매칭** | is_self=true 소급 적용 — 해당 화자의 is_question 플래그 해제 + detected_questions 삭제 | 완료 |
| **Step 4 화자 매칭** | live.py speaker upsert (WebSocket utterance 수신 시 자동) | 완료 |
| **Step 5 LLM 컨텍스트** | `_build_context_prefix()` — brief/participants/pasted_context → system prompt 접두 | 완료 |
| **Step 5 LLM 컨텍스트** | translate/summary/answer 모두 meeting_context 파라미터 지원 | 완료 |
| **Step 5 LLM 컨텍스트** | live.py 세션 시작 시 컨텍스트 로드 → 모든 enrichment 호출에 주입 | 완료 |
| **Step 5 LLM 컨텍스트** | /api/llm/translate, /summary 에 session_id 옵션 추가 (소유 검증 후 컨텍스트 로드) | 완료 |
| **부수 수정** | SQLite FK 활성화 — services/database.py `connect()` 헬퍼, 모든 커넥션에 PRAGMA foreign_keys=ON | 완료 |
| **부수 수정** | aiosqlite.connect(DB_PATH) → db_connect() 일괄 교체 (sessions/live/llm 라우터) | 완료 |
| **부수 수정** | python-multipart 의존성 추가 | 완료 |
| **프론트 UX** | 모달 "녹음 시작" → "회의 진행" 변경, 회의 준비 / 녹음 분리 | 완료 |
| **프론트 UX** | 메인 헤더 녹음 시작/중지 버튼 state 분기 | 완료 |

### 검증 결과

- **Step 1 DB 마이그레이션**: PRAGMA table_info 로 모든 컬럼/테이블/인덱스 존재 확인
- **Step 2 세션 API E2E (13/13)**: 생성/조회/업데이트 round-trip, 파일 업로드/삭제 + 디스크 검증, 확장자 블랙리스트, URL 4종 SSRF 차단(http/loopback/private/link-local), 인증 미적용 401
- **Step 3-5 E2E (10/10)**: 화자 seed/매칭, is_self 소급 (본인 질문 제거, 타인 질문 보존), GET 에 speakers 포함, 404 처리, LLM 컨텍스트 주입, CASCADE 삭제 검증
- **헬스체크 19/19 전체 통과** (변경 전후 유지)

### 수정된 파일

**백엔드 (Q Note):**
- `q-note/services/database.py` — 마이그레이션 로직 + speakers 테이블 + connect() 헬퍼 (FK 활성화)
- `q-note/services/deepgram_service.py` — diarize + speaker_id 추출
- `q-note/services/llm_service.py` — `_build_context_prefix` + meeting_context 파라미터
- `q-note/routers/sessions.py` — 전면 재작성 (세션 CRUD 확장 + 문서/URL/화자 매칭)
- `q-note/routers/live.py` — 컨텍스트 로드 + 화자 upsert + is_self 필터링
- `q-note/routers/llm.py` — session_id 옵션 + _load_meeting_context
- `q-note/requirements.txt` — python-multipart==0.0.12 추가

**프론트엔드:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 녹음 시작/중지 분리
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — 버튼 "회의 진행"

---

## ✅ 완료: Q Note Phase 8 — B-1, B-2 + B-3 mock UI + 인프라 정비 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **B-1 백엔드** | Q Note FastAPI 구조 (routers/services/middleware/data) | ✅ |
| **B-1 백엔드** | SQLite 6 테이블 + FTS5 (sessions, utterances, documents, document_chunks, summaries, detected_questions) | ✅ |
| **B-1 백엔드** | JWT 인증 미들웨어 (PlanQ 백엔드 SECRET_KEY 공유) | ✅ |
| **B-1 백엔드** | Deepgram WebSocket 프록시 (Nova-3, language=multi) | ✅ |
| **B-1 백엔드** | 세션 CRUD API (POST/GET/PUT/DELETE /api/sessions) | ✅ |
| **B-1 백엔드** | WebSocket /ws/live 엔드포인트 | ✅ |
| **B-1 인프라** | Nginx WebSocket 프록시 헤더 추가 | ✅ |
| **B-2 백엔드** | OpenAI GPT-5-mini 연동 (translate, summary, answer) | ✅ |
| **B-2 백엔드** | LLM 서비스 (translate_and_detect_question, generate_summary, generate_answer) | ✅ |
| **B-2 백엔드** | /api/llm/translate, /api/llm/summary 엔드포인트 | ✅ |
| **B-2 백엔드** | live.py에 background enrichment 통합 (utterance → 번역+질문감지) | ✅ |
| **B-2 검증** | 실제 한→영 / 영→한 번역 + is_question 감지 동작 확인 (19/19 헬스체크) | ✅ |
| **헬스체크** | scripts/health-check.js — 19개 체크 (Infra/Auth/B-1/External/B-2/Frontend Lint) | ✅ |
| **헬스체크** | /검증 + /개발완료 명령어에 0단계 헬스체크 통과 강제 추가 | ✅ |
| **헬스체크** | 토큰 캐시 (rate limit 회피) | ✅ |
| **린트** | Frontend 린트 3종 (POS 컬러 잔재 / raw <select> / react-select 직접 import) | ✅ |
| **컴포넌트** | PlanQSelect (react-select 기반 검색 가능 통합 셀렉트, 사이즈/multi/icon 지원) | ✅ |
| **컴포넌트** | Icons.tsx (Feather-style stroke SVG, MicIcon/MonitorIcon/StopIcon 등 11개) | ✅ |
| **POS 정리** | POS 보라색 잔재 17개 파일 약 30곳 일괄 정리 (#6C5CE7→#14B8A6 등) | ✅ |
| **POS 정리** | theme.ts brand 컬러 PlanQ 딥틸로 교체 + Point 컬러 추가 | ✅ |
| **POS 정리** | legacy SelectComponents.tsx 삭제, ThemedSelect/FormSelect 제거 | ✅ |
| **컬러 시스템** | Point 컬러 Coral/Rose #F43F5E 정의 (CTA + AI 감지 강조용) | ✅ |
| **컬러 시스템** | COLOR_GUIDE.md §2.5 Point 컬러 섹션 신규 추가 | ✅ |
| **DB** | users.language 컬럼 추가 (사용자 모국어, ISO 639-1) | ✅ |
| **DB** | PUT /api/users/:id에 language 업데이트 + 검증 추가 | ✅ |
| **B-3 mock UI** | Q Note 페이지 (사이드바 + 라이브/리뷰 모드 + 트랜스크립트) | ✅ |
| **B-3 mock UI** | StartMeetingModal — 회의 시작 입력 폼 | ✅ |
| **B-3 mock UI** | 회의 시작 모달 — 제목, 회의 안내(brief), 참여자, 메인/답변/번역 언어, 자료(파일/텍스트/URL), 캡처 방식 | ✅ |
| **B-3 mock UI** | 메인 언어 멀티 셀렉트 (pill + "+ 언어 추가") — 빈 상태 시작 | ✅ |
| **B-3 mock UI** | 답변 언어 (메인 언어 중 선택), 번역 언어 (모든 언어, 디폴트 사용자 모국어) | ✅ |
| **B-3 mock UI** | 참여자 입력 (이름 + 역할/메모, 그룹 표현 가능) | ✅ |
| **B-3 mock UI** | 자료 — 파일 업로드 (10MB 검증) + 텍스트 붙여넣기 (10만자) + URL (http/https 검증) | ✅ |
| **B-3 mock UI** | 본인 발화 질문 제외 (isSelf 필드, 좌측 코랄 보더 + "질문" 라벨 + "답변 찾기" 버튼 제외) | ✅ |
| **B-3 mock UI** | 질문 발화 텍스트 굵게 + 코랄 좌측 보더 강조 | ✅ |
| **B-3 mock UI** | 사이드바 접기 토글 (미팅 풀스크린) | ✅ |
| **B-3 mock UI** | AudioCapture 추상화 인터페이스 (마이크/탭, 미래 데스크톱 앱 대응) | ✅ |
| **B-3 mock UI** | LANGUAGES.ts 상수 (23개 언어, ISO 639-1 + Deepgram 지원 정보) | ✅ |
| **워크플로우** | UI-First 개발 원칙 영구 규칙화 (CLAUDE.md + 메모리) | ✅ |

### 미완료 / 다음 단계 (B-3 backend wiring + B-4~B-6)

| 작업 | 상태 |
|------|:----:|
| Deepgram WebSocket에 `diarize=true` 옵션 추가 (화자 분리) | ⏳ |
| sessions 테이블에 brief, participants(JSON), urls 컬럼 추가 | ⏳ |
| speakers 테이블 신규 (session_id, speaker_id, participant_name, is_self) | ⏳ |
| 화자 매칭 API (POST /api/sessions/:id/speakers/:speaker_id/match) | ⏳ |
| LLM 호출 시 brief + participants를 system prompt에 prefix 주입 | ⏳ |
| isSelf 자동 마킹 (사용자가 "나"로 매칭한 speaker_id 발화 모두) | ⏳ |
| 본인 발화는 detected_questions 테이블에 INSERT 안 함 | ⏳ |
| URL fetcher (trafilatura/readability) + SSRF 방어 (내부 IP 차단, HTTPS 강제) | ⏳ |
| 문서 업로드 + 텍스트 추출 + 청크 분할 + FTS5 인덱싱 (B-5 RAG) | ⏳ |
| 회의 음성 캡처 → WebSocket 전송 (PCM16 16kHz mono) | ⏳ |
| 라이브 모드 mock 데이터 → 실 WebSocket 연결로 교체 | ⏳ |
| 리뷰 모드 → 실 세션 데이터로 교체 | ⏳ |
| 사용자 프로필 페이지 (language 필드 변경 UI) | ⏳ |
| 회의 도중 연결 끊김 처리 (재연결 + 버퍼 + 이어쓰기) | ⏳ |
| 4시간 회의 한계 처리 (Deepgram 세션 split) | ⏳ |
| 음성 핑거프린트 등록/매칭 (선택 기능) | ⏳ |
| 법적 동의 1회 모달 (녹음 동의, AI 데이터 처리 안내) | ⏳ |

### 수정/생성된 파일 (이번 세션)

**생성:**
- `dev-frontend/src/components/Common/PlanQSelect.tsx`
- `dev-frontend/src/components/Common/Icons.tsx`
- `dev-frontend/src/constants/languages.ts`
- `dev-frontend/src/services/audio/AudioCaptureSource.ts`
- `dev-frontend/src/services/audio/MicrophoneCapture.ts`
- `dev-frontend/src/services/audio/BrowserTabCapture.ts`
- `dev-frontend/src/services/audio/index.ts`
- `dev-frontend/src/pages/QNote/QNotePage.tsx`
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx`
- `dev-frontend/src/pages/QNote/mockData.ts`
- `q-note/middleware/auth.py`
- `q-note/services/database.py`
- `q-note/services/deepgram_service.py`
- `q-note/services/llm_service.py`
- `q-note/routers/live.py`
- `q-note/routers/sessions.py`
- `q-note/routers/llm.py`
- `q-note/.env` (개인 키 — git 제외)
- `scripts/health-check.js`

**수정:**
- `q-note/main.py`, `q-note/requirements.txt`
- `dev-backend/models/User.js` (language 컬럼 추가)
- `dev-backend/routes/users.js` (language 업데이트 검증)
- `dev-frontend/src/styles/theme.ts` (PlanQ 컬러 + Point 컬러)
- `dev-frontend/COLOR_GUIDE.md` (Point 컬러 §2.5 추가)
- `dev-frontend/src/App.tsx` (Q Note 라우트 활성화)
- `CLAUDE.md` (UI-First 워크플로우 명시)
- `.claude/commands/검증.md`, `.claude/commands/개발완료.md` (헬스체크 0단계 추가)
- POS 컬러 잔재 17개 파일 (보라색 → 딥틸)

**삭제:**
- `dev-frontend/src/components/UI/SelectComponents.tsx` (가짜 SearchableSelect)

---

## Phase 1: 서버 분리 + PlanQ 초기 세팅 ✅

**완료: 2026-04-08**

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 디렉토리 구조 (`/opt/planq/`) | ✅ |
| 2 | MySQL DB + 유저 (planq_dev_db / planq_admin) | ✅ |
| 3 | 백엔드 (Express + Sequelize + 13 모델 + 8 라우트) | ✅ |
| 4 | 프론트엔드 (Vite + React + TypeScript) | ✅ |
| 5 | Nginx + SSL (dev.planq.kr) | ✅ |
| 6 | Q Note (FastAPI, port 8000) | ✅ |
| 7 | Git (github-planq:ireneceo/planq) | ✅ |
| 8 | CLAUDE.md + DEVELOPMENT_PLAN.md | ✅ |
| 9 | 개발 인프라 명령어 (/개발시작, /개발완료, /저장, /검증, /배포, /복원) | ✅ |
| 10 | 보안 미들웨어 POS 수준 업그레이드 (SSRF, CSP, SQL Injection, Socket.IO 인증) | ✅ |
| 11 | 설계 문서 정리 (docs/ — 아키텍처, ERD, IA, API, 기능정의서, 보안, 로드맵) | ✅ |

---

## ✅ 완료: Phase 2 최소 세트 — 인증 시스템 (2026-04-08)

### 완료된 작업

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | POST /api/auth/register (User+Business+Member 트랜잭션 생성, JWT 발급) | ✅ |
| 2 | POST /api/auth/login (이메일/username 둘 다 지원, Access 15분 + Refresh 7일) | ✅ |
| 3 | POST /api/auth/refresh (HttpOnly Cookie, Refresh Token rotation) | ✅ |
| 4 | POST /api/auth/logout (Refresh Token DB 무효화 + cookie 삭제) | ✅ |
| 5 | POST /api/auth/forgot-password + reset-password | 미구현 (나중에) |
| 6 | AuthContext (메모리 토큰 + 14분 자동갱신) + ProtectedRoute | ✅ |
| 7 | LoginPage + RegisterPage (PlanQ 컬러, pill shape, placeholder only) | ✅ |
| 8 | MainLayout (딥틸 사이드바 + LanguageSelector + PlanQ 브랜딩) | ✅ |

### 추가 구현
- User 모델: username, refresh_token, reset_token 필드 추가
- COLOR_GUIDE.md 전면 재작성 (딥 틸 컬러 시스템, 11개 섹션)
- cookie-parser 추가, CORS credentials 설정

### 수정된 파일
- `dev-backend/models/User.js` — username, refresh_token 등 필드 추가
- `dev-backend/routes/auth.js` — register/login/refresh/logout 전면 재작성
- `dev-backend/server.js` — cookie-parser 추가
- `dev-backend/.env` — JWT_REFRESH_SECRET, JWT_EXPIRES_IN=15m
- `dev-frontend/src/pages/Login/LoginPage.tsx` — 신규
- `dev-frontend/src/pages/Register/RegisterPage.tsx` — 신규
- `dev-frontend/src/contexts/AuthContext.tsx` — 전면 재작성
- `dev-frontend/src/components/ProtectedRoute.tsx` — PlanQ 컬러
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 딥틸 사이드바
- `dev-frontend/src/components/Common/LanguageSelector.tsx` — 다크 사이드바 대응
- `dev-frontend/src/App.tsx` — 실제 라우팅 연결
- `dev-frontend/COLOR_GUIDE.md` — 전면 재작성

---

## ✅ 완료: Q Note 설계 문서화 (2026-04-09)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Note 구조 변경 확정 | 배치(Whisper) → 실시간(Deepgram) 전환, 라이브+리뷰 2모드 | ✅ |
| FEATURE_SPECIFICATION.md | Phase 8 전면 재작성 — F8-1~F8-5, 아키텍처, 비용 예측 | ✅ |
| DEVELOPMENT_ROADMAP.md | Phase 8 프롬프트 재작성 — B-1~B-6 단계, 프로젝트 구조 | ✅ |
| DEVELOPMENT_PLAN.md | Phase 8 작업 목록 B-1~B-6으로 교체 | ✅ |

### 수정된 파일
- `DEVELOPMENT_PLAN.md` — Phase 8 작업 목록 변경
- `docs/FEATURE_SPECIFICATION.md` — Phase 8 전면 재작성
- `docs/DEVELOPMENT_ROADMAP.md` — Phase 8 프롬프트 재작성

---

## Phase 3: 사업자 + 고객 관리

> 사업자 프로필 + 멤버 초대 + 고객 초대 (초대 링크로 간편 가입) + 대화방 자동 생성

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 사업자 정보 조회/수정 API | |
| 2 | 멤버 초대/목록/제거 API + 이메일 발송 | |
| 3 | 고객 초대 API (Client 생성 + Conversation 자동 생성 + 초대 이메일) | |
| 4 | 초대 수락 페이지 (/invite/:token → 간편 가입) | |
| 5 | 고객 목록/상세 페이지 | |
| 6 | 팀 관리 페이지 (Owner만) | |
| 7 | 사업자 설정 페이지 (프로필, 구독, 알림) | |

---

## Phase 4: Q Bill (청구서)

> 청구서 작성 + 이메일 발송 + 입금 확인 + 상태 관리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 청구서 CRUD API (자동 번호생성, 부가세 자동계산) | |
| 2 | 청구서 이메일 발송 (Nodemailer + HTML 템플릿) | |
| 3 | 입금 확인/취소 API | |
| 4 | 청구서 목록 페이지 (전체/미결/완료 탭) | |
| 5 | 청구서 작성 폼 (항목 동적 추가/삭제) | |
| 6 | 청구서 상세 페이지 (발송/입금확인 버튼) | |

---

## Phase 5: Q Talk (대화)

> Socket.IO 실시간 채팅 + 메시지 수정/삭제 + 파일 첨부 + 할일 연결

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 대화 목록 API + 메시지 목록 (페이징) | |
| 2 | 메시지 전송 + Socket.IO 실시간 | |
| 3 | 메시지 수정 (is_edited) + 삭제 (is_deleted 마스킹) | |
| 4 | 첨부파일 업로드 (MessageAttachment) | |
| 5 | 3단 레이아웃: 대화목록 / 채팅 / Q Task 패널 | |
| 6 | MessageInput (텍스트 + 📎 첨부 + Enter 전송) | |
| 7 | typing 표시, 스크롤 자동 하단 | |
| 8 | 메시지에서 할일 만들기 버튼 (Phase 6과 연결) | |

---

## Phase 6: Q Task (할일)

> 할일 CRUD + 메시지↔할일 양방향 링크 + 필터/정렬 + 마감 지연 표시

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 할일 CRUD API (필터: status, assignee, client, due) | |
| 2 | 메시지 → 할일 생성 (source_message_id 양방향 링크) | |
| 3 | 상태 변경 API + Socket.IO emit | |
| 4 | 할일 목록 페이지 (오늘/이번주/전체 탭, 필터) | |
| 5 | 마감 지연 🔴 / 오늘 마감 🟠 / 임박 🟡 표시 | |
| 6 | Q Talk 우측 패널 (해당 고객 할일) | |
| 7 | 원문 메시지 ↔ 할일 상호 이동 | |

---

## Phase 7: Q File (자료함)

> 고객별 파일 관리 + 업로드/다운로드 + 용량 제한

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 파일 업로드 API (Multer, UUID 파일명, 확장자 검증) | |
| 2 | 파일 목록/다운로드/삭제 API | |
| 3 | 자료함 페이지 (고객별 폴더/탭) | |
| 4 | 드래그 앤 드롭 업로드 UI | |
| 5 | 스토리지 사용량 표시 (요금제별 제한) | |

---

## Phase 8: Q Note (실시간 회의 전사 + AI 분석)

> 실시간 STT (Deepgram Nova-3) + 번역/질문감지 (GPT-5-mini) + 문서 기반 답변 (RAG)
> 상세 설계: `docs/FEATURE_SPECIFICATION.md` Phase 8

| # | 작업 | 상태 |
|---|------|:----:|
| B-1 | FastAPI 구조 + Deepgram WebSocket 프록시 + 실시간 STT | ✅ |
| B-2 | GPT-5-mini 연동 (번역 + 질문 감지) | ✅ |
| B-3 | 프론트엔드 라이브 모드 UI (mock + 실 백엔드 연결) | 🔄 mock UI 완료, 백엔드 연결 대기 |
| B-4 | 세션 저장 + 리뷰 모드 (기록 열람, 요약 생성) | |
| B-5 | 문서 업로드 + 답변 찾기 (RAG, SQLite FTS5) | |
| B-6 | 결과 연동 — Q Task 할일 전환 + Q Talk 공유 (2차) | |

---

## Phase 9: 알림 시스템

> 인앱 알림 + 이메일 알림

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 알림 모델 + API | |
| 2 | 인앱 알림 (헤더 벨 + 드롭다운) | |
| 3 | 이메일 알림 (새 메시지, 할일 배정, 마감 임박, 청구서) | |
| 4 | 알림 설정 (카테고리별 on/off) | |

---

## Phase 10: 구독 관리

> 요금제(Free/Basic/Pro) + 결제 + 미납 처리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 플랜 페이지 (비교 테이블) | |
| 2 | 결제 연동 | |
| 3 | 구독 관리 (업그레이드/다운그레이드/취소) | |
| 4 | 사용량 기반 제한 (스토리지, 멤버 수, Q Note 횟수) | |
| 5 | 미납 처리 흐름 (유예 → 읽기전용 → 차단 → 삭제) | |

---

## Phase 11: 운영 배포 + Landing

> 배포 스크립트 + 랜딩 페이지 + SEO

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 운영서버 배포 스크립트 | |
| 2 | 랜딩 페이지 (Hero, Features, Pricing, CTA) | |
| 3 | SEO 메타태그 + OG 이미지 | |
| 4 | Platform Admin 대시보드 | |
