# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-11
**작업 상태:** 완료 — v1.5.3 운영 라이브
**버전:** v1.5.3 운영 라이브 (commit `1031409`, deploy 108s)

---

## 진행 중인 작업
- 없음 (lua 의 모바일 반응형 7 파일은 미커밋 working tree 에 있음 — lua 마무리 대기)

---

## 완료된 작업 (이번 세션 — 사이클 N+6/N+7)

### Backend
1. **refresh_token chain 격리 fix** (`routes/auth.js`)
   - reuse_detected 가 같은 user 의 모든 active row 일괄 revoke 하던 회귀 → chain (replaced_by_id 사슬) 만 revoke
   - rotation grace 30s → 5min (모바일 PWA wake-up 흡수)
   - 다중 디바이스 정책 본질 회복

2. **관련 업무 링크** (`models/TaskLink.js` + `routes/tasks.js`)
   - task_links 테이블 (양방향 단일 row, a < b 강제)
   - GET/POST/DELETE links + GET search (workspace 격리)
   - 자기 자신·중복·cross-workspace 차단

3. **description_attach context** (`models/TaskAttachment.js` ENUM + `routes/task_attachments.js`)
   - ENUM ('description', 'description_attach', 'task', 'comment')
   - description 영역 댓글식 첨부 (의뢰자 영역, 결과물과 분리)
   - 권한 가드: 작성자/owner/admin (담당자 빠짐 — 책임선)

4. **reviewer 가드** (`routes/tasks.js` PUT + Frontend statusOptionsFor 3곳)
   - reviewer 0명이면 reviewing/revision_requested 단계 차단 (400 no_reviewers_assigned)
   - 100% 자동 completed 도 reviewer ≥ 1 시 차단 (in_progress 유지)

5. **진행률 ↔ status 양방향 sync** (PATCH + PUT 단일 진실 원천)
   - PATCH /time, PUT /by-business 모두 동일 로직 (양방향)
   - PUT 의 progress → status 자동 전환 분기 신규 추가 (이전 결함 fix)
   - completed → 다른 status 전환 시 progress 100 → 90 자동
   - completed 진입 시 progress < 100 이면 자동 100

6. **실제 시간 자동 누적** (`services/taskActualHours.js` + TaskStatusHistory afterCreate hook)
   - status_history 의 in_progress 진입 ~ 이탈 라운드 합산 (다중 라운드 지원)
   - Task.actual_source ENUM('auto','user') — 사용자 직접 입력 시 자동 누적 정지
   - 현재 in_progress 면 실시간 누적 표시

7. **auto-ai-estimate FK 가드** (`routes/tasks.js`)
   - setImmediate AI 예측 전에 task 존재 확인 → test cleanup 후 FK 위반 회귀 방지

### Frontend
8. **이번 주 내 업무 필터** (`QTaskPage.tsx:870`)
   - 담당자=나 분기에서 status 화이트리스트 제거 → 활성 status 모두 표시 (reviewing 포함)
   - 마감 책임 = 담당자 끝까지

9. **TaskDetailDrawer 통합 변경**
   - RelatedTasksSection (description 섹션 안)
   - DescriptionAttachments (FilePicker 패턴 — 업로드 + 기존 파일/문서 연결)
   - latest_estimation_source / actual_source 회색 분기 (`MetaNumInput $ai`)
   - InProgressDot (라벨 옆 라이브 dot, Apple Watch 패턴)
   - TimeAutoHint (시간 자동 누적 상시 안내, MetaGrid 아래)
   - ReviewReminderHint (100% reviewer 있을 때 동적 노출)
   - MetaCell layout fix (진행률 cell 안으로 + range slider vertical center)

10. **FilePicker 모바일 bottom sheet** (`components/Common/FilePicker.tsx`)
    - 풀스크린 → 75vh bottom sheet (Slack/Apple 패턴)
    - slide-up 애니메이션 + safe-area 보정

11. **QTalk LeftPanel 모바일** (`pages/QTalk/LeftPanel.tsx`)
    - PinBtn `@media (hover: none), (max-width: 1024px)` opacity 1 → unpinned outline 별표 항상 노출
    - Unread `margin-left: auto` 로 행 우측 끝 + 모바일 살짝 키움 (가시성)

### 검증
- API E2E 17/17 PASS (cycle verification 통합)
- 헬스체크 27/27
- 빌드 1.5s 안팎, TS 에러 0
- 운영 health 200, planq-prod-backend v1.5.3

### 운영 배포
- commit `1031409` deploy-planq.sh, 108s
- 백업: `/opt/planq/backups/20260511_090303`
- 외부 https://planq.kr/api/health 200

### 보안 처리
- `.env` 권한 600 → **640** (planq 그룹 read 허용)
- lua (PM, planq 그룹 멤버) PM2 환경변수 정상 로드 가능
- q-note/.env 도 664 → 640 강화

---

## 메모리 박제
- `feedback_no_options_just_fix.md` — 검증 중 발견된 에러 옵션 묻지 말고 직접 fix
- `project_multi_device_session.md` 업데이트 — chain 격리 + grace 5분 박제
- `feedback_no_mvp.md` 강화 — "MVP" 단어 자체 금지

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)
DEVELOPMENT_PLAN.md "다음 진입 ★" — Irene 선택:
- 권한 옵션 A + 개인 보관함
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- ShareModal 채팅방 발송 후 PostShareModal 흡수

이번 사이클 follow-up:
- lua 의 모바일 반응형 (PageShell, QCalendarPage, QProjectPage, qcalendar/qproject locales) 7 파일 미커밋 — lua 마무리 후 통합
- Message 편집/삭제 라우트 신규 구현 (PERMISSION_MATRIX §5.9 박제만 됨)

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated. 메일 발송 정상
- DEEPGRAM 양쪽 EMPTY (Q Note STT 503 fallback)
- JWT_SECRET dev/prod 분리 운영
- platform_admin 계정: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한: 640 (planq 그룹 read)

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`
- UI 가이드: `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md`
- 프로젝트 규칙: `/opt/planq/CLAUDE.md`

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
