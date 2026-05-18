# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-18
**작업 상태:** 완료
**운영 라이브 버전:** v1.14.0 (commit `bfb5835`, 배포 `20260518_061702`, 103초)
**직전 라이브:** v1.13.0 (commit `5317eca`, 배포 `20260517_183327`)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 N+22 누적 패키지 + 운영 데이터 cleanup)

**N+22 — 채팅 sender 워크스페이스명 + 한글 파일명 + dock badge race + Q Task/프로필 UX**
- `services/displayName.js` 신규 — BusinessMember.name 우선 fallback User.name. conversations.js + projects.js 11지점 적용. 채팅 이력 전체 워크스페이스명 즉시 반영.
- `services/filename.js` 신규 — multer latin1 mojibake 복구 + RFC 5987 Content-Disposition. 6 라우트 (posts/files/task_attachments/message_attachments/kb) 일괄.
- 운영 cleanup: 한글 파일명 17 row 복구 (File 11 + MessageAttachment 5 + TaskAttachment 1), 본문 이미지 3 row L1→L3 promote.
- SW push handler — visible client 있으면 setAppBadge skip (race 차단). useGlobalBadge — visibility/focus 시 강제 재호출.
- Q Task statusOptionsFor 3 파일 waiting 일관, TaskRowActionMenu 6점→3점, EdgeHandle 통일 (Q Talk/Q docs).
- Profile Container 2열 grid + nicknameUsage 사용처 hint. WorkspaceSettings/Profile 에 refreshUser 추가.
- Q Talk ChatRow align center + 별/⋮ 간격 조정, canManageConversation admin role 포함.
- PostEditor read-only 모드 selectednode outline 제거 (공개 페이지 이미지 위/아래 녹색선 차단).
- q-note services/database.py — text 메모 5 컬럼 idempotent migration (input_type/translate_enabled/linked_voice_session_id/summarized_at/body).

### 완료된 작업 (이전 세션 N+18~N+21 + hotfix 3건)

**N+18 — 워크스페이스 통합 주간보고서**
- `business_weekly_reports` 테이블 신규 (UNIQUE biz+week_start)
- snapshot_data JSON 스키마 v1: kpi(delta) · highlights · risks(overdue/stalled/due-soon) · blockers · issues · next_week · portfolio(health) · member_utilization · team_highlights · decisions_required
- `WeeklyReviewWorkspaceView` 신규 — Hero + KPI band + 3x2 grid + Portfolio + Heatmap + Team Highlights + Retro
- cron 일 23:59 ws_tz 자동 박제 (manual 보존) + 수동 박제 (owner/admin)
- Q Project 검색·필터 + 메모 분리 창 (MemoPopup standalone) + Q Note 빈 상태 멘트

**N+19 — 디자인 시스템 + 요청 정책**
- `components/Common/ActionButton.tsx` (3톤 × sm 36/md 40/lg 44 + Spinner + focus ring)
- `components/Common/DrawerFooter.tsx` (sticky bottom + safe-area + 좌/우 슬롯)
- TaskDetailDrawer Action* alias 마이그레이션 (17 사용처 무변경)
- WeeklyReviewModal footer 교체
- 요청 탭 estimated_hours/recurrence_rule UI 숨김 + 백엔드 sanitize (책임선 분리)
- DetailDrawer z-index 60 (RightPanel overlay 위)

**N+19 hotfix — GDrive 옛 폴더 재사용**
- cloud.js callback 에서 createRootFolder 전 Drive 같은 이름 폴더 search → 재사용

**N+20 — 사용량 시각화 + AI 학습 + 결제 유도**
- `TaskEstimation.business_id` 컬럼 + backfill + idx + FK
- `/api/plan/:id/status.cue_actions_by_type` JSON breakdown
- `POST /api/plan/:id/qnote/estimate` endpoint
- `UsageWarningCard` 초과 시 "지금 업그레이드" Primary CTA (Danger red)
- `PlanSettings` Cue 기능별 누적 막대
- `PostAiModal` cue 잔여 hint + 한도 임박 확인 모달
- `callAiEstimate` 워크스페이스 최근 12 사용자 추정 few-shot

**N+21 — 멤버 메뉴 권한 + admin role + 청구 담당 + 히스토리**
- `BusinessMember.role` ENUM `admin` 추가
- `business_member_permissions` 신규 (UNIQUE biz+user+menu_key, ENUM level)
- `businesses.default_billing_owner_id` 컬럼
- `project_status_history` + `invoice_status_history` 신규 + 4 전이 지점 박제
- `middleware/menu_permission.js` (requireMenu + getMemberMenuLevels)
- 권한 라우트 5종 + Invoice 8 mutation `requireMenu('qbill','write')` 가드
- AuditLog 5 영역 누락 채움 (members invite/remove · file.delete · cloud.disconnect)
- `MemberPermissionMatrix` + `DefaultBillingOwnerSection` 컴포넌트
- ConfirmDialog 사용 (window.confirm 금지)

**N+21 hotfix — 메뉴 정렬·라벨 통일·반응형**
- MENU_LIST 사이드바 순서 1:1 정합 (11종)
- qmail · qinfo 추가 (9 → 11 menu_key)
- insights write 코어스 → read (READ_ONLY_MENUS)
- "오너 / 관리자" 라벨 통일
- 한글 white-space:nowrap, sticky 컬럼 min-width 160px

**N+21 hotfix2 — 설정 페이지 정리**
- StorageSettings 내부 `<SectionTitle>` 제거 + PermissionsSettings `<Title>` 제거 (외부 헤더 중복 차단)
- "파일 저장소" → "파일·외부 연동" / "Storage & Integrations"
- 자체 스토리지 카드 항상 "사용 중" (Drive 연결돼도 개인 보관함은 자체)
- 개인 보관함 정책 명시 (Drive 무관 / 워크스페이스 quota 합산 X / 개인 quota 분리 없음)

**운영 배포** — commit `5317eca` 운영 라이브 (105초, 백업 `20260517_183327`). 버전 bump `858b18c` v1.13.0.

### 다음 할 일

- **PERMISSION_MATRIX.md §5 풀 보강** — admin role + Layer 3 멤버 메뉴 권한 표 추가 (이번엔 메모리만 박제)
- **UI_DESIGN_GUIDE.md 섹션 신규** — ActionButton + DrawerFooter 사용법 박제
- **Phase 2: 나머지 8 메뉴 가드 적용** — qtask/qnote/qdocs/qcalendar/qfile/clients/insights/qmail/qinfo (이번엔 qbill 만)
- **Phase 2: archive 정책 명시** — Task soft-archive, Conversation hard delete 검토
- **노션 import** — 사용자 "나중에" 보류. 필요 시 ZIP import Wizard Phase 1 진행

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
