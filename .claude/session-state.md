# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-05 (사이클 N+89 — **v1.33.0 운영 라이브**)
**작업 상태:** 완료·배포 (deploy `20260605_183432`, commit 다음 개발완료 커밋)

---

## ✅ N+89 완료·배포 — Q Note 종료후 재설계 + 상단 통일 + 공개뷰 fix

### Q Note 재설계 (Phase 1~3, 전부 운영 반영)
- **슬로우 종료:** `QNotePage.endMeeting` getSession 백그라운드 → review 즉시 전환.
- **요약 영속(C):** qnote `sessions` +`summary_key_points`(JSON)/`summary_full`. `routers/llm.py /summary` 가 생성 후 본인 세션 영속(`summarized_at`). `JSON_COLUMNS` 에 등록. get_session 노출.
- **메모 요약(B):** `MemoView.docToPlainText(body)` → 같은 엔드포인트. 메모 요약 밴드.
- **요약→문서(D):** `utils/qnoteSummaryDoc.ts` saveSummaryAsDoc → createPost vlevel **L1**. 음성·메모 둘 다 "문서로 저장" + "보기".
- **업무 브릿지(C-eng):** `routes/qnote_bridge.js`(extract-tasks/list/register/reject, mount `/api/businesses`). `task_extractor.extractNoteTaskCandidates`(빈제목 필터, title dedup). `task_candidates` +`qnote_session_id`/+`business_id`(tenant 격리), `tasks` +`qnote_session_id` 역참조. 공유 훅 `hooks/useNoteTaskExtraction.ts`(음성·메모 1구현). `TaskCandidateCard` 재사용.
- **재요약 instruction:** `generate_summary(instruction)` 시스템프롬프트 최우선 주입. 음성·메모 재요약 버튼 → 요구사항 입력창("어떻게 다시 요약할까요").
- **review 3블록:** 요약 / 업무 / 공유. 참여자·내발화 바를 업무 아래(녹음 transcript 위)로 이동.

### 상단 UI 통일 (Q docs 상세와)
- `components/Common/VisibilityChip.tsx`(공개:팀 칩, 레벨색). Q Note 리뷰·메모 헤더 = VisChip + 공유 PrimaryBtn(아이콘) + IconBtn(설정/질문). "정리하기" 모달 + QNoteSummaryModal 제거. 메모에도 공개칩+공유(QNoteShareModal 재사용).

### 🔴 프록시 경로 회귀 fix (메모리 박제 `feedback_qnote_frontend_api_base`)
- q-note 프론트 호출은 **`/qnote/api` base 필수**(nginx `/qnote/`→FastAPI). bare `/api`→Node HTML 404 = "Unexpected token '<'".
- fix: `qnote.ts` generateSessionSummary/createSessionShareToken/revokeSessionShareToken/changeSessionVisibility + `PublicQNoteSessionPage`(공개 "웹에서 보기").
- **검증 함정:** node test 가 localhost:8000 직접 호출하면 못 잡음 → 공개 URL `/qnote/api`로 인증호출해 content-type=json 확인.

### KB fix
- `middleware/security.js` SQLi 패턴 정밀화(마크다운 `---`·산문 "select from" 오탐 제거, 고신뢰 시그니처만). AI 자동추가/문서저장 복구.
- `KnowledgePage.tsx` 상세패널 카테고리 셀렉트 legacy-only → 모달과 동일 union.

### 공개 "웹에서 보기" 9종 전수 검증(실데이터) + 반응형
- posts/docs/tasks/files/kb/calendar/invoice/qnote/sign 전부 200 json. qnote 공개뷰 경로 fix.
- 반응형: 가로 오버플로우 유발 고정폭 0, 모든 공개페이지 @media 보유. KB 본문 nested-scroll(60vh) 제거.

### N+87~88 동봉 배포
- Q Mail 맥락통합 A·B·C(`clientTimeline.js`, `extractEmailTaskCandidates`, `summarizeThread`) + 우측패널 통일 + `TaskCandidateCard` 통일.

## 환경: dev 3003 / prod planq.kr 3004 (v1.33.0, deploy 20260605_183432)
## 운영 스키마 반영 확인: MySQL task_candidates(+qnote_session_id/+business_id)·tasks(+qnote_session_id) + qnote SQLite(summary_key_points/summary_full) 전부 OK.

## 다음 후보 (미착수)
- §8.5 client-facing serializer(serializeTaskForClient — 예측/실제시간·내부댓글 차단) — Q Mail 맥락은 내부전용이라 급하지 않음.
- 공개뷰 폴리시(터치타겟 44px·로고 크기 통일·PostsPage VisChip→공통 VisibilityChip 마이그레이션) — 선택.

## 복구: `이전 세션 이어서. session-state 읽어줘.`
