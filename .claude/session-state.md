## 현재 작업 상태
**마지막 업데이트:** 2026-04-21
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**설계 문서**
- `docs/FILE_SYSTEM_DESIGN.md` 신규 — 파일 시스템 전 10섹션 (원칙/아키텍처/스키마/쿼터/dedup/외부클라우드/API/UI/검증/롤아웃)
- `docs/OPS_ROADMAP.md` 신규 — Stage 0~4 임계치 + 체크리스트 + 자동 경보 스크립트 스펙

**Phase 1 + 1+ — UI 구현 (mock → 실 API)**
- `pages/QProject/DocsTab.tsx` 신규 (780줄) — 드롭존, 그리드/리스트 전환, 미리보기 드로어, 폴더 트리, 대량 선택, 플로팅 액션바
- `services/files.ts` 신규 — 타입 + mock 후 실 API 연결
- i18n `qproject.json` ko/en — tab/docs/folder/bulk 키 세트 추가
- QProjectDetailPage 문서 탭 placeholder → DocsTab 교체

**30년차 UI/UX 감사 8건 반영**
- 이모지 → Lucide 스타일 SVG 아이콘
- 확장자별 색상 아이콘 (PDF 빨강/DOC 파랑/XLS 녹색/PPT 주황/ZIP 보라/이미지 핑크)
- Progressive drop zone (빈 상태 크게 / 파일 있으면 compact 바)
- Skeleton shimmer 로딩
- focus-visible 10건 + `type="button"` 24건
- 리스트 grid-template-columns 조건부 (selectMode)
- 다운로드/삭제 아이콘 드로어 헤더 상단 이동
- 폴더 삭제 안내에 파일 수 포함

**Phase 2A Backend — DB + 라우트 + OPS**
- `files` 컬럼 추가: `project_id`, `folder_id`, `storage_provider`, `external_id/url`, `content_hash`, `ref_count`, `deleted_at`
- 신규 테이블 3: `file_folders`, `business_storage_usage`, `ops_capacity_log`
- `routes/files.js` 전면 확장 — 쿼터 검사, SHA-256 dedup (같은 파일 1회만 저장, ref_count 관리), 업로드/이동/다운로드/소프트삭제/대량삭제/스토리지상태
- `routes/file_folders.js` 신규 — CRUD + 재귀 삭제 (내부 파일 parent 로 자동 이동)
- `routes/projects.js` 확장 — `GET /api/projects/:id/files` 집계 API (direct + chat + task, id 접두어 규칙 `direct-N`/`chat-N`/`task-N`)
- `scripts/ops-capacity-check.js` 신규 — 주간 스냅샷 + Stage 전환 감지 + provider 비중

**CLAUDE.md 업데이트**
- DB 테이블 25 → 28 (+파일 시스템 3)
- 파일 저장 섹션에 플랜별 총 쿼터 + SHA-256 dedup + 설계 문서 링크 추가

**메모리 2건 추가**
- `project_file_storage_hybrid.md` — 자체/GDrive/Dropbox 3-way 저장소 + PlanQ 유일 진입점
- `feedback_staged_infra_rollout.md` — 가입자·용량 임계치 기반 단계적 인프라 도입

### 검증 결과
- 헬스체크 27/27 PASS
- Phase 2A API 실호출 22/22 PASS (스토리지 조회/폴더 CRUD/업로드/dedup/집계/이동/다운로드/대량삭제/소프트삭제/재귀삭제/권한격리/OPS 스크립트)
- 빌드 tsc 0 error, 295 modules, gzip 433 kB
- SPA 9 라우트 전부 200
- 이번 변경 범위 한글 하드코딩 0건, alert/toast.success 0건, focus-visible 10건
- 멀티테넌트 격리 (타 biz 403) 검증

### 플랜별 쿼터 (운영 기준)
| 플랜 | 파일당 | 총 스토리지 |
|---|---|---|
| Free | 10 MB | 1 GB |
| Basic | 30 MB | 50 GB |
| Pro | 50 MB | 500 GB |

### 범위 외 발견 이슈 (이번 세션 밖)
- `QProjectDetailPage.tsx` 기존 한글 하드코딩 62건 — spawn_task 로 별도 분기
- express-rate-limit `X-Forwarded-For` warning — nginx proxy trust 환경 설정 이슈

### 다음 할 일 (우선순위 순)

**1순위 — Phase 2B Google Drive App Folder 연동 (4일)**
- Irene 선결: Google Cloud Console OAuth Client ID 발급 + redirect URI 등록 (dev.planq.kr 먼저) + 동의 화면 구성 (15분)
- 구현: OAuth 시작/콜백 + 루트 폴더 자동 생성 + 프로젝트/업무 하위 폴더 매핑 + Direct upload + 변경 감지 Webhook
- 스키마: `business_cloud_tokens` 테이블 신규 (access/refresh/root_folder_id)

**2순위 — Phase 2C Dropbox App Folder 연동 (2일)**
- Dropbox App Console 앱 등록 (Scoped Access, App Folder 모드)
- 2B 패턴 재사용

**3순위 — Phase 4 Q Docs 전역 페이지 (1일)**
- 사이드바 Q Docs 메뉴 추가
- 동일 `<DocsTab scope={{ type: 'workspace', businessId }} />` 재사용

**백로그**
- 프로젝트 상태 토글 UI (active/paused/closed)
- 프로젝트 삭제 UI (cascade 확인 모달)
- F5-2b `/invite/:token` 수락 랜딩 페이지
- Calendar 폴리시 (RRULE 단일 인스턴스 수정/삭제, UNTIL/COUNT UI, 알림)
- 반응형 Phase 1~5 (기능 95% 이후 스프린트)
- 메일 시스템 (SMTP 설정 + 초대 템플릿, 출시 직전)
- Capacitor 하이브리드앱 래핑

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
