# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-14
**작업 상태:** 사이클 N+14 dev fix 완료 + 검증 13/13 PASS — 운영 배포 대기
**버전:** v1.8.0 (dev) — 다음 운영 배포 시 v1.9.0

## 사이클 N+14 — Visibility 통합 + Q Note 공유 정책 + Q info 프로젝트 스코프

### 4 자산 visibility 통합

L1-L4 vocabulary 통일 (Q file / Q docs / Q info / Q note):

| 자산 | visibility 컬럼 | 매핑 |
|---|---|---|
| Q file | `files.visibility` ENUM L1-L4 | 직접 |
| Q docs | `posts.visibility` ENUM internal/public | 헬퍼 변환 (마이그레이션 다음 사이클) |
| Q info | `kb_documents.scope` ENUM private/workspace/project/client | 헬퍼 매핑 |
| Q note | `sessions.visibility` TEXT L1-L4 (신규 컬럼) | 직접 |

### Q Note 정책 변경 (핵심)

기존: "Q Note 진짜 사적 공간, 공유 절대 안 함"
**변경**: 기본 L1 사적 + 사용자 명시 활성화 시 L2/L3/L4 공유 가능

- `sessions` 테이블 6 컬럼 추가 (visibility, project_id, share_token, shared_at, share_expires_at, shared_consent)
- `status='recording'` 일 때 visibility 변경 / share_token 발급 차단
- L2 선택 시 project_id 필수 + Node `/api/internal/project-membership` 으로 멤버십 검증
- L3 + 외부 참석자 있으면 `shared_consent=1` 필수

### Q info 프로젝트 스코프 활성화

- `KbDocument.scope='project'` 이미 backend 지원
- 신규 `pages/QProject/ProjectKnowledgeTab.tsx` — 프로젝트 상세의 `info` 탭. KnowledgePage 와 동일 컴포넌트 (AttachmentField/ShareModal/DetailDrawer/PlanQSelect/EmptyState/ConfirmDialog 공통)
- 프로젝트 탭 순서: `dashboard / tasks / clients / files / docs / **info(Q info)** / transactions / details(메타)`
- 옛 `info` 탭 (프로젝트 메타) → `details` 로 키 변경

### 개인 보관함 5탭

`dashboard / posts / files / kb / **notes(Q note)**` — Single Source of Truth, Multiple Views

- `routes/personal_vault.js` 의 `/sessions` endpoint 신규 — Q Note Python `/api/sessions?scope=mine&visibility=L1` proxy
- "지식" → "정보" 라벨 통일

### 공통 컴포넌트 활용 (UI 통일)

- `VisibilityBadge` — 4단계 배지, owner 클릭 시 변경 모달 트리거
- `VisibilityChangeModal` — L1/L2/L3 변경 통합 모달
- `ShareModal` — L4 (share_token) 발급. entityType 9종
- `AttachmentField` — 자료 첨부 통합 컴포넌트 (이미 11곳 사용 중)
- `DetailDrawer` — 상세 패널 통합 프리미티브

### 라벨 통일

- `qdocs.json sendToKnowledge*`, `knowledge.json cuePrefill` 의 "Q knowledge" → "Q info" (ko/en 양쪽)

### 검증 13/13 PASS

1. KB 등록 scope=project ✓
2. KB project_id 필터 조회 ✓
3. PersonalVault sessions endpoint ✓
4. Q Note session 생성 ✓
5. Q Note visibility L1 → L3 ✓
6. recording 중 차단 (400 cannot_change_while_recording) ✓
7. L2 project_id 검증 (400 project_id_required_for_L2) ✓
8. L2 with project_id 정상 ✓
9. share_token 발급 ✓
10. share_token 폐기 ✓
11. Internal API project-membership ✓
12. Internal API user-project-ids ✓
13. 데이터 원복 ✓

### 변경 파일

| 영역 | 파일 |
|---|---|
| DB schema | `q-note/services/database.py` (sessions 6 컬럼 + 2 인덱스) |
| Q Note Python | `q-note/routers/sessions.py` (visibility 검사 + 3 endpoint + Node internal call) |
| Node backend | `dev-backend/routes/internal.js` (신규), `dev-backend/routes/personal_vault.js` (sessions proxy), `dev-backend/services/visibility.js` (신규), `dev-backend/server.js` (internal mount) |
| Frontend | `dev-frontend/src/services/qnote.ts` (changeSessionVisibility + share*), `dev-frontend/src/pages/QNote/QNotePage.tsx` (visibility 배지 + 변경 모달), `dev-frontend/src/pages/PersonalVault/PersonalVaultPage.tsx` (notes 탭), `dev-frontend/src/pages/QProject/QProjectDetailPage.tsx` (탭 재구성), `dev-frontend/src/pages/QProject/ProjectKnowledgeTab.tsx` (신규) |
| i18n | qdocs.json / knowledge.json (Q knowledge → Q info) |
| 메모리 | `feedback_qnote_personal_tool.md` (정책 변경 갱신), `project_visibility_unified_arch.md` (신규) |

---

## 진행 중인 작업
- 없음 (사이클 N+14 dev 완료, 검증 PASS)

## 다음 진입 ★ 운영 배포

사용자 `/배포` 명령 받으면:
1. version bump v1.8.0 → v1.9.0
2. commit + push
3. `dev/scripts/deploy-planq.sh` 실행
4. 운영 Q Note SQLite 도 자동 마이그레이션 (PM2 restart 시 `_run_migrations` 실행)
5. 운영 검증 — health 200 + 실 Q Note session 1건 visibility 변경

## 차순위 (다음 사이클)

- Q Note frontend — AI utterance "🤖 AI 보조" 라벨 표시
- Post.visibility 마이그레이션 (internal/public → L1-L4)
- Q note share_token UI (L4 ShareModal 통합 — 현재는 backend 만)
- "녹화 중" 외 외부 참석자 동의 체크박스 UI (현재는 backend gate 만)

## 환경변수 / 인증 현황

- INTERNAL_API_KEY dev/prod 동일 시크릿
- PLANQ_BACKEND_URL — Q Note 기본 http://localhost:3003 (운영도 같음, port 3004 는 backend, Q Note 가 host 같음)
- GOOGLE_CLIENT_ID/SECRET — 운영 정상화 완료 (사이클 N+13)
- VAPID — dev/prod 둘 다 configured

## 복구 가이드

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
