## 현재 작업 상태
**마지막 업데이트:** 2026-04-29
**작업 상태:** 완료 — Q Task "My week" overdue 버그 수정 + dashboard todo 보안 수정

### 이번 세션 완료 (2026-04-29)
1. **Q Task "My week" overdue 버그 수정** — 마감일 지난 미완료 업무가 "이번 주" 탭에 표시되지 않던 문제 해결
2. **Dashboard todo API 보안 수정** — 단일 business_id 호출 시 removed_at 체크 누락 문제 해결

### 수정 상세
| 파일 | 변경 |
|------|------|
| `QTaskPage.tsx:632` | `isOverdue = e && e < todayStr` 조건 추가 → overdue 업무 항상 표시 |
| `dashboard.js:655-661` | `removed_at: null` 조건 + Client fallback 체크 추가 |

### 빌드
- `index-D6xj1G7z.js` (1.37s, 타입에러 0)
- 헬스체크 25/27 통과 (PM2 상태 체크 2건 제외 — 서버는 정상 작동)

---

## ⚡ 빠른 재개 (다음 세션)

```
session-state.md 읽고 P-3 (Q knowledge) 부터 진입해줘.
```

---

## 📋 다음 세션 시작점 — P-3 Q knowledge (~5-7d)

### 핵심
좌측 메뉴 `Q 지식` (영문 `Q knowledge`) — Cue 가 보는 회사 지식 DB 통합 진입점.

### 기존 인프라
- `KbDocument`, `KbChunk`, `KbPinnedFaq` 모델 이미 존재
- `services/kb_service.js` hybridSearch 구현됨
- 현재는 워크스페이스 단위 (KbDocument.business_id), 카테고리 없음

### 추가 요구사항 (memory: project_kb_engine_reuse)
- `KbDocument.category` ENUM (policy/manual/incident/faq/about/pricing)
- `KbDocument.scope` (workspace/project/client) + `project_id`/`client_id`
- 우선순위: client → project → workspace (threshold 0.78)
- Q talk Cue / Q docs aiGenerate / Q note 회의록 자동 채움 모두 통합 진입점

### 작업 범위
- DB ALTER (category, scope, project_id, client_id 컬럼)
- 라우트 신규: `/api/knowledge/*` + 카테고리 필터·스코프 검색
- 프론트: 신규 페이지 `/knowledge` + 좌측 nav `Q 지식`
- Cue / aiGenerate / Q note 의 hybridSearch 호출에 scope 우선순위 통합

---

## 📋 전체 할일 리스트 (P-3 ~ P-8)

### P-3 Q knowledge — Cue 가 보는 회사 지식 DB (5~7d)
### P-4 Q brief — 자료정리/요약 신규 (5~6d)
### P-5 Phase F — Q docs 슬롯 시스템 (5d)
### P-6 SMTP 운영 연결 (1d) + P-6.5 Web Push 알림 (3d)
### P-7 PortOne V2 + 팝빌 (5~6d)
### P-8 반응형 일괄 스프린트 (5d)

**총 추정: 약 35 영업일 (~7주)**

---

## 환경 / 인증

- 백엔드: port 3003 (정상 작동, PM2 외 방식)
- DB: planq_dev_db / planq_admin
- 도메인: dev.planq.kr
- 마지막 빌드: `index-D6xj1G7z.js`

---

## 복구 가이드 (새 Claude 세션)

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘. P-3 (Q knowledge) 부터 진입.
```
