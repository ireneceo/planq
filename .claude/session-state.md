## 현재 작업 상태
**마지막 업데이트:** 2026-05-08
**작업 상태:** 사이클 N+1 완료 + v1.2.0 운영 라이브

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**v1.2.0 운영 라이브 (`3aa91d0` + `eab297d` 버전 bump)**

**AI 업무 추가:**
- 자연어 → AI 다중 업무 분해 (LLM gpt-4o-mini, 30년차 컨설턴트 페르소나)
- AiTaskCreateModal — /docs PostAiModal 패턴 1:1, 시작일 picker, progress bar, 카드 압축 (제목+담당자 한 줄 + 라인 아이콘 메타)
- 도메인별 표준 phases, 결과물 기반 명명 강제, 의존성 추론

**AI 자동 예측 (모든 추가 경로):**
- POST /api/tasks 백그라운드 LLM → estimated_hours 자동 채움 + source='ai' + socket task:updated emit
- 사용자 명시 입력 시 호출 X (비용 절약)

**업무 템플릿 시스템 (신규):**
- DB 2 테이블 + 9 시스템 preset 시드
- TemplateSelectModal (검색 + 카테고리 자유 입력 + items 인라인 편집)
- TemplateSaveModal (프로젝트 → 워크스페이스 템플릿)
- 진입점: 프로젝트>업무 only (Q Task 에서는 제거)

**Row 액션 메뉴 (노션 패턴):**
- TaskRowActionMenu — ⋮⋮ 6dots 핸들 (항상 표시) + portal 드롭다운
- 인라인 추가 / 복제 / 삭제 (Danger)
- POST /api/tasks/:id/copy 신규
- ProjectTaskList + QTaskPage 동일 패턴

**컬럼·Drawer 통일:**
- 기간 fixed 100px + 가운데 정렬 + start_date asc 정렬
- responsiveDrawerWidth helper (vw × 0.35 [380, 560])

**알림 토스터 fix:**
- conversations.js POST /messages 에 socket emit 누락 회귀
- 사운드 풍부화 (G5+D6 chord) / 자동 페이드 제거 / "모두 닫기" 컨트롤

**Docs AI 모달 정리:**
- Tabs Body 안 / autoFocus 제거 / 'new' 모드 폼 reorder / 문서 종류 default 제거

### 다음 할 일

**사이클 N+2 (박제 권장):**
1. list API 에 `latest_estimation_source` 필드 추가 → AI 자동 예측 task 의 회색 + ✨ 시각 분기 (ProjectTaskList + QTaskPage)
2. 모달 통일 스프린트 — ~20 outlier 모달을 StandardModal + ModalActionButton 으로 마이그레이션
3. 통합 공유 시스템 (Q task/file/info/calendar share_token + ShareModal) — `docs/SHARE_SYSTEM_UNIFIED.md`
4. Smart Routing (외부 링크 → PWA 자동 redirect, App-First Deep Linking) — `docs/SMART_ROUTING_DESIGN.md`

**차순위:**
- 주간 보고 Phase 2 (자동 박제 + JSON 통계 활용)
- 권한 옵션 A + 개인 보관함
- Q note 텍스트 type + Quick Capture (⌘M FAB)

---

## 환경
- **dev:** dev.planq.kr (port 3003) — chunk `eab297d`
- **운영:** planq.kr (port 3004) — commit `3aa91d0`
- **DB:** dev `planq_dev_db` / prod `planq_prod_db`
- **PM2:** planq-dev-backend / planq-prod-backend / planq-qnote / planq-prod-qnote

## 운영 라이브 (마지막)
- commit: `3aa91d0` + `eab297d` (version bump)
- timestamp: 2026-05-08 20:37:31 (101s deploy)
- backup: `/opt/planq/backups/20260508_203554`
- 외부 health: ✅ 200
- 버전: **v1.2.0** (minor, 1.1.1 → 1.2.0)

## 미해결 이슈
- 데스크탑 (Mac Chrome) push 알림 + 사운드 안 옴 — Irene 환경 의존 (PWA 재설치 권장). 백엔드 + 모바일 정상.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
