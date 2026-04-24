## 현재 작업 상태
**마지막 업데이트:** 2026-04-24 저녁
**작업 상태:** 완료 — Q Talk 독립 대화 전체 스코프 전환

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 2026-04-24 저녁)

**Q Talk 런타임 에러 해소 + 독립 대화 1급 엔티티 전환**

1. `/talk` 신규 대화 CTA 수정 — EmptyState "+" → NewChatModal (heavy NewProjectModal 대체)
2. NewProjectModal/NewChatModal `m.user.name` null crash 방어 (삭제/비활성 유저 대응)
3. `/api/projects/-1/*` 404 누수 해소 — LeftPanel standalone 가짜 project.id=-1 이 activeProjectId 로 유출되던 문제
4. `TASK_STATUS_COLOR[status].bg` undefined crash — mock.ts TaskStatus ENUM 백엔드 8종 동기 + fallback 헬퍼
5. 독립 대화 메시지 지속성 — `listBusinessConversations` 초기 로드 + `activeConversationId` 변경 시 lazy fetch
6. **우측 패널 독립 대화 전체 스코프** (Phase 핵심):
   - DB: `project_notes/project_issues/task_candidates` → project_id nullable + conversation_id 추가
   - 백엔드 4 신규 라우트: `/api/projects/conversations/:convId/{notes,issues,task-candidates,tasks}`
   - task_extractor standalone 모드 (project 없으면 담당자 매칭·유사 업무 스킵)
   - registerCandidate 가 business_id 를 conversation 에서 조회
   - RightPanel `matchScope` helper (project OR conversation_id)
7. 프로젝트 메모·이슈에 `conversation_id` 기록 → 프로젝트 패널에서 `#{채팅명}` SourceTag 로 출처 추적
8. 프로젝트 업무 섹션 preview (최신 5개 + "전체 보기 (N개 더)" 링크 → 프로젝트 필터된 Q Task)
9. 섹션 자동 펼침 — scope-aware + async data-aware (deps 에 issues/tasks/notes length 포함)
10. 좌측 리스트 최신순 + 새 메시지 bump — Q Talk `last_message_at` DESC, Q Note `created_at` DESC
11. 독립 대화 타이틀 프로젝트 접두어 제거 (`titleStandalone` i18n)

**E2E 검증:** 21/21 pass (standalone CRUD + extract LLM 실호출 + register + 스코프 불일치 방지)
**헬스체크:** 27/27 pass
**프론트 빌드:** index-blLPTtQM.js (TS 에러 0)

### 다음 할 일

DEVELOPMENT_PLAN.md 기준 다음 미완료 스프린트:

1. **Q Bill Phase 1.1 본 구현 시작** — 견적서·청구서 UI + 백엔드 (2~3주 예상)
   - 설계문서: `docs/Q_BILL_SPEC.md`, `docs/INTEGRATED_ARCHITECTURE.md`
   - 의존성: Phase 0 DB backfill 완료됨
2. **React Query 도입** — Q Bill 신규 페이지부터 점진 적용 (옵션 C 합의)
3. **반응형 Phase 8 준비** — 신규 코드 3원칙(고정 px 지양·아이콘 버튼 36+px·인라인 style 금지)

즉시 이어가기 좋은 소규모 작업:
- Q Docs/Q Board 좌측 리스트 최신순 확인 (이번 세션엔 Q Talk + Q Note 만)
- 독립 대화 tasks 의 Q Task 페이지 노출 확인 (project_id null 리스트 포함 여부)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
