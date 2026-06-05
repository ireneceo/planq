# Q Note 종료 후(review) 재설계 + Q Note↔Q Task 브릿지 (QNOTE_POSTSESSION_REDESIGN)

> 작성: 2026-06-05 (사이클 N+88 기획·진단). 상태: **설계 확정 → 구현 대기**
> 한 줄: 종료 후 버튼 수프를 **[요약→문서] · [업무→등록] · [공유 단일]** 3블록으로. "기록→실행" 고리 완성.
> 진단 근거: 3 Explore 에이전트 파일:라인 실측 (추측 0).

---

## 0. 전제 (절대 원칙)
- **Q Note = 사적 공간** (`feedback_qnote_personal_tool` — owner·admin 백도어 없음). 모든 출력(문서·업무) 기본 개인, 공유만 명시.
- **별도 FastAPI + SQLite(`qnote.db`)** — tasks/clients/docs(MySQL, Node)와 분리. 연결은 **단방향 브릿지**.
- **이미 AI-rich** — 요약·Q&A·RAG·화자식별 존재. "요약" 추가가 아니라 **영속·표시·메모 패리티**가 빈틈.

---

## 1. 검증된 진단 (파일:라인)

### A. 슬로우 종료 (진짜 버그)
- `endMeeting()` [QNotePage.tsx L1002-1021]: `liveRef.stop()` → `flushPending()` → `await releaseLockIfHeld()` → **`await updateSession(status='completed')` [L1010]** → **`await getSession()` [L1011]** → `setPhase('review')` [L1018].
- 화면 전환을 **getSession await에 묶음**. 백엔드 `get_session` [sessions.py L810-857]는 utterances·documents·speakers·detected_questions **4개 SELECT 순차** [L815-843].
- `cluster_and_merge_speakers`는 이미 `asyncio.create_task` 비동기 [sessions.py L889]. `persist_speaker_embeddings`는 WS finally [live.py L883-885] 비동기 — 프론트 무관.
- **fix:** ① 프론트: `updateSession` 직후 **즉시 `setPhase('review')`** + `getSession`은 백그라운드(스켈레톤). ② 백엔드: 4 SELECT를 **`asyncio.gather` 병렬화**. → 합 ~200-500ms 단축.

### B. 메모(text) 요약 안 보임
- 요약은 **on-demand**만 (review 헤더 "요약" 버튼 [QNotePage L2447-2470]). 자동 X.
- 요약 입력 = voice utterance(`renderBlocks` speech/question) [L2454-2457]. **메모 body 제외**.
- 메모(input_type='text')는 review 헤더 자체 미노출 [L2129/2385/2419] (MemoView 별도).
- 백엔드 `generate_summary(transcript, ...)` [llm_service.py L937]가 **body 미수용**.
- **fix:** 요약 입력 `text = voice ? transcript : body`로 통일 + 메모 review에도 요약 섹션 노출.

### C. 요약 휘발
- 요약은 `summaryModal.data` state에만. **DB 영속 X**. `mark_summarized`는 `summarized_at` 타임스탬프만 [sessions.py L481-482].
- **fix:** 세션에 `summary_key_points`(JSON)·`summary_full`(TEXT) 컬럼 추가, 종료 시 백그라운드 생성·저장, review에 인라인 상시 표시.

### D. "정리하기" = 원문 prefill 떠넘기기
- "정리하기" 4갈래 [QNoteSummaryModal.tsx]: 업무→`/tasks?prefill=` / 지식→`/info?prefill=` / 문서→`/docs?prefill_brief=` / 외부공유→onShare. **전부 요약 아닌 원문 transcript** [SummaryModal L54-79, QNotePage L2587-2590].
- prefill 핸들러는 대상 페이지에 실재(QTaskPage L326-351 / KnowledgePage L184-200 / PostsPage L99-115) — Share Target 패턴이라 **유지**(다른 데서 쓸 수 있음), 단 Q Note는 이 raw-prefill 경로를 **그만 씀**.

### E. 공유 이원화 + "결정 정리하기"
- 공유 **2경로**: 정리모달 내 "외부공유" [SummaryModal L118] + 헤더 공유버튼 [QNotePage L2430] — **둘 다 같은 QNoteShareModal**. → 공유 **버튼 1개**로.
- QNoteShareModal vs 통합 ShareModal: **별도 FastAPI라 자체 API**(`/api/sessions/:id/share`) — 분리 **정당**. 단 룩/탭은 통일.
- **"결정 정리하기" 버튼은 실재하지 않음** [L2605는 제목 텍스트]. 착오 — 제거 대상 없음.

### review 버튼 인벤토리 (현재)
정리하기 [L2420] · 공유 [L2430] · 설정 보기 [L2440] · 요약 [L2448] · 질문 보기 [L2472].

---

## 2. 재설계 — review 3블록
```
[회의/메모 종료]  ← 즉시 전환 (DB 백그라운드 로드)
 📄 요약   (자동 생성·영속·편집)           → [문서로 저장]  (Q docs post)
 ✅ 업무   (transcript/body 추출 → 후보)     → [업무로 등록]  (공유 TaskCandidateCard)
 ─────────────────────────────
 [공유]  (단일 · 노트+요약 공유 · QNoteShareModal 룩 통일)
 (보조) 질문 보기 · 설정 보기
```
- 제거: "정리하기" 4갈래 모달, 중복 공유. info·"결정"은 보류/없음.
- **TaskCandidateCard 재사용** (N+88 통일 — Q Talk·Q Mail과 동일 카드).

---

## 3. 엔지니어링 — Q Note↔Q Task 브릿지 (cross-DB)
- `task_candidates`에 **`qnote_session_id` 스코프** 추가 (conversation_id·email_thread_id에 이은 다음).
- Node **`POST /api/qnote-bridge/:businessId/extract-tasks` { text, title, qnote_session_id }** → `extractNoteTaskCandidates`(task_extractor 분기, 입력만 text) → 후보 반환. register → Task(개인 default, `qnote_session_id` 역참조).
- 요약→문서: Node로 **요약 내용**(full+key_points)을 Q docs post 생성 → post_id를 세션 `linked_doc_id` 저장.
- 프론트(QNotePage)는 FastAPI(요약·세션) + Node(브릿지) 둘 다 호출. 기존 window CustomEvent sync 유지.

---

## 4. 메모 역할
- 메모(body) = **공유 + 업무 추출** 기본. 요약→문서는 **길 때만**. 음성보다 가볍게.

---

## 5. 단계 (우선순위)
1. **버그 fix** — 슬로우 종료(A) + 메모/자동 요약(B) + 요약 영속(C). 체감 즉시·위험 낮음.
2. **공유 일원화(E)** + 요약→문서(D 대체).
3. **업무 추출 브릿지(C-eng)** + review 재설계(2) — TaskCandidateCard 재사용.
4. (보류) 질문+답변 → info.

---

## 6. 참조
- 프론트: `pages/QNote/QNotePage.tsx` · `components/QNote/QNoteSummaryModal.tsx` · `QNoteShareModal.tsx`
- 백엔드: `q-note/routers/sessions.py`·`live.py`·`llm.py` · `q-note/services/llm_service.py`·`speaker_clustering.py`
- 통일: `components/Common/TaskCandidateCard.tsx` (N+88)
- memory: `feedback_qnote_personal_tool` · `project_qnote_capture_design` · `project_qmail_context_unified`
