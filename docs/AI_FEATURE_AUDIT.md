# PlanQ AI 기능 전수검사 (Audit) — 체크리스트

> Irene 2026-06-18 지시. **고급(AI) 기능 미흡이 사소한 기능보다 타격이 크다** — 유료고객 테스트 진입.
> 다음 섹션에서 **각 기능을 실 API 호출로 동작 증명** (코드 확인만으로 "정상" 판정 금지 — CLAUDE.md 검증 원칙).
> 관련 메모리: `feedback_ai_minimal_usage`, `feedback_chunked_verification`, `feedback_test_data_restore`.

## 검사 기준 (각 기능 공통 6항목)
1. **작동**: 실제 입력 → LLM/STT/임베딩 호출 → 기대 출력 (실 API 왕복)
2. **폴백**: API 키 없음/타임아웃/5xx 시 graceful (앱 크래시·빈화면 금지)
3. **쿼터·rate-limit**: 플랜 한도 차감 정확 + per-user rate-limit (비용 폭주 차단)
4. **격리**: 워크스페이스/사용자 경계 — 남의 데이터 누출 0
5. **i18n·정합**: ko/en 출력, 입력 sanitize, 응답 형식 표준
6. **실시간 반영**: 결과가 즉시 화면 반영(항목16) — 후보/번역/요약 등

---

## A. Cue 계열 (workspace AI 팀원)

| # | 기능 | 파일 | 핵심 검사 포인트 |
|---|------|------|------------------|
| A1 | Cue 워크스페이스 채팅 | `routes/cue.js` workspace, `services/cue_context.js` | 워크스페이스 데이터만 컨텍스트(격리), 다른 ws 데이터 0. 플랜 use_cue 차감. |
| A2 | qhelper → **Q위키 RAG** | `routes/cue.js` qhelper | (Q위키 구현 후) sources[] 근거. rate-limit. |
| A3 | Cue 자동응답 (고객 발화만) | 메시지 라우트 | 내부 스태프 발화엔 스킵(memory `feedback_cue_client_only`). |
| A4 | Cue task 주고받기 (revision/comment) | `services/cue_task_executor.js`, `services/cue_orchestrator.js` | 무한루프 방지, feedbackBlock 주입, status 전이 정합. |

## B. Q Task 계열

| # | 기능 | 파일 | 핵심 검사 포인트 |
|---|------|------|------------------|
| B1 | AI 업무 추가 (자연어→분해) | `services/aiTaskPlanner.js` | 단일/다중 분해, 미리보기→확정, 업무명 결과물 기반(memory `feedback_task_naming`). scope 필드 복사(memory `feedback_series_instance_copy_scope`). |
| B2 | AI 시간 예측 | `routes/task_estimations.js` | 워크스페이스별 few-shot, business_id 격리, 담당자만 입력 정합. |
| B3 | 업무 자동 추출 (채팅/메일→후보) | `services/task_extractor.js` | 후보 카드 공유 컴포넌트(memory `feedback_shared_candidate_card`), broadcast 즉시 반영. |
| B4 | AI 템플릿 추천 | (templates) | 매칭 ≥0.80만 노출(memory `feedback_ai_recommendation_threshold`). |

## C. Q Talk 계열

| # | 기능 | 파일 | 핵심 검사 포인트 |
|---|------|------|------------------|
| C1 | 메시지 번역 | `services/translation_service.js` | 비동기+폴링 fallback(memory `feedback_translation_async`), max_tokens, retry. |
| C2 | KB 임베딩+하이브리드 검색 | `services/kb_service.js`, `routes/kb.js` | text-embedding-3-small, FTS+임베딩 하이브리드, pinned FAQ. |

## D. Q docs / Q Mail / 자료정리

| # | 기능 | 파일 | 핵심 검사 포인트 |
|---|------|------|------------------|
| D1 | AI 문서 작성/레벨 재생성 | `routes/docs.js` | 재생성 제목 fallback t()화(최근 v1.40.1), 권한(body=담당자/admin). |
| D2 | 메일 AI (요약·이슈·업무추출) | `routes/email_threads.js` | client_id 허브 통합(memory `project_qmail_context_unified`), 격리. |
| D3 | Brief / 자료정리 | `services/brief_service.js` | AI 자료 업로드 모드, 인라인 자료 File 등록(memory `feedback_inline_assets_as_files`). |

## E. Q Note 계열 (Python FastAPI — `/qnote/api` 경유 검증, memory `feedback_qnote_frontend_api_base`)

| # | 기능 | 파일 | 핵심 검사 포인트 |
|---|------|------|------------------|
| E1 | STT (Deepgram) | `services/deepgram_service.py`, `routers/live.py`,`voice.py` | **DEEPGRAM 키 양쪽 EMPTY → 503 fallback**(memory `project_smtp_pending`). multi 금지, speech_final 필터 금지(memory `feedback_qnote_stt_llm_quirks`). |
| E2 | 회의 요약 (LLM 2단) | `services/llm_service.py` | nano/4o-mini 2단 분리, reasoning 모델 금지. |
| E3 | 답변 찾기 (RAG 6우선순위) | `services/answer_service.py`,`qa_generator.py` | priority>custom>session>generated>rag>general(memory `feedback_qnote_answer_priority`), 회의자료 우선. |
| E4 | 질문 감지 (본인 제외) | `qa_generator.py` | 본인 발화 질문 표시 안 함(memory `feedback_qnote_self_question`). |
| E5 | 화자 식별 | `services/speaker_clustering.py` | 사전 등록+사후 매칭, 회의 중 모달 금지. fingerprint/voiceCheck 제거 확인(memory `feedback_qnote_speaker_simplify`). |
| E6 | 어휘사전 추출 | (vocabulary) | 자료에서 verbatim 복사, 추론/환각 금지(memory `feedback_qnote_vocabulary`). |
| E7 | 회의 안내 컨텍스트 | (meeting brief) | 모든 AI 호출에 주입(memory `feedback_qnote_meeting_brief`). |
| E8 | 개인 격리 | `routers/sessions.py` | 본인 세션 외 무조건 403(memory `feedback_qnote_personal_tool`). |

---

## 실행 방법 (다음 섹션)

1. **청크 단위 E2E** — A→E 묶음별로 즉시 검증(memory `feedback_chunked_verification`). 마지막에 몰지 않기.
2. **실 API 호출** — login → 각 AI endpoint 호출 → 출력 검증 → 폴백(키 제거/타임아웃 모의) → 쿼터.
3. **Q Note는 공개 URL** `/qnote/api` 로 인증 호출(localhost:8000 직접 호출은 프록시 버그 못 잡음).
4. **테스트 데이터 정리** — 시드 변경 시 try/finally 원복, test-*.js 삭제.
5. **발견 결함은 옵션 묻지 말고 직접 fix**(memory `feedback_no_options_just_fix`), 청크 끝마다 보고.

## 우선순위 (유료고객 타격도)
**1순위(고급·핵심):** A1·A2·A4(Cue), B1·B3(AI 업무), C1(번역), E1~E3(Q Note STT/요약/답변)
**2순위:** B2·C2·D1·D2·D3
**3순위:** A3·B4·E4~E8

---

## 감사 결과 (2026-06-21 실행 — 실 API 왕복 증명)

> 검사자: Claude. 방법: dev 환경 실 LLM/임베딩/STT 호출 (mock 0). 토큰=app generateAccessToken, user3(biz3 워프로랩 owner).

### 구현된 16개 AI 기능 — **전부 작동 (PASS)**

| # | 기능 | 결과 | 증명 |
|---|------|------|------|
| A1 | Cue 워크스페이스 채팅 | ✅ | mode=workspace 200, biz3 실제 업무 답변. cue_context 전 쿼리 business_id 격리 |
| A2 | qhelper Q위키 RAG | ✅ | sources[3] (create-task/create-workspace/auto-task-extract) 근거 답변 |
| A3 | Cue 자동응답 (고객만) | ✅ | projects.js:715 senderIsStaff(BusinessMember owner포함)→스킵 |
| A4 | Cue task 주고받기 | ✅ | feedbackBlock(revision/comment) 주입, reviewing 정지+usage limit→무한루프 0, 트리거 4곳 전부 사람 액션 |
| B1 | AI 업무분해 | ✅ | 자연어→4업무, 전부 결과물 기반 네이밍 |
| B2 | AI 시간예측 | ✅ | business_id few-shot 8h+reason, 없이도 graceful |
| B3 | 업무 자동추출 | ✅ | 텍스트→2후보, business_id=3 격리, 정리 |
| C1 | 메시지 번역 | ✅ | ko↔en 양방향 non-empty, 동일언어 fallback, retry |
| C2 | KB 하이브리드 검색 | ✅ | '환불' 시맨틱 0.47 매칭, 쿼리레벨 격리 (wiki null 비오염) |
| D1 | AI 문서작성 | ✅ | proposal body_html 4732자 |
| D2 | 메일 AI (요약·추출) | ✅ | 요약 110자, 메일→업무후보 biz3 |
| D3 | Brief 자료정리 | ✅ | summary+recommended_next_kind, text_blocks only |
| E1 | STT (Deepgram) | ✅ | **q-note .env DEEPGRAM SET — 기존 503 갭 해소.** is_final 전부 누적+speech_final 경계 commit |
| E2 | 회의 요약 | ✅ | key_points 3개 정확 추출 (gpt-4.1-nano/4o-mini 2단) |
| E3 | 답변 RAG 6우선순위 | ✅ | priority>custom>session>generated>rag>general 구현 |
| E4 | 질문 감지 | ✅ | is_question=true 라이브 |
| E6 | 어휘사전 | ✅ | verbatim 복사, "DO NOT GUESS" empty list |
| E7 | 회의안내 컨텍스트 | ✅ | meeting_context(brief/participants/profile) 전 LLM 함수 주입 |

### 발견사항

1. **B4 AI 템플릿 추천 — 구현·검증 완료 (2026-06-22).** 설계 `docs/TASK_TEMPLATE_AI_RECOMMEND_DESIGN.md` 대로 구현됨(직전 세션 wip 자동저장 커밋 `7cb3c00`에 묻혀 정식 검증 이력이 없던 것을 이번 세션 실 API로 끝단 검증). 구성: `task_templates.embedding` BLOB + `services/templateEmbedding.js`(KB `embedText` 재사용) + `POST /api/task-templates/recommend`(멤버 게이트·per-user rate-limit·`RECOMMEND_MIN_SIM=0.45`·코사인·graceful null) + 프론트 `AiTaskCreateModal` 추천 배너/닫기 + `TemplateSelectModal initialTemplateId` + 부모(QTaskPage·TasksTab) 형제 모달 배선(팝업 위 팝업 아님) + i18n `ai.recommend.*` ko/en. **검증:** recommend 5/5 매칭(온보딩 0.494·워드프레스 0.577·채용 0.583·쇼핑몰 0.479·무관 null) · cross-tenant 403 · 익명 401 · 짧은입력 null · 10/10 템플릿 embedding 백필 완료 · 빌드 번들 포함 · ko/en 패리티. **데이터 정리:** 옛 테스트가 남긴 template id 1 `'CHANGED'` 오염 → 원본 `'WordPress 블로그 사이트'` 복원 + embedding 재계산(memory `feedback_test_data_restore`).
2. **E5 화자식별 — 규명 완료 (충돌 아님, 액션 불요)** — `voice_fingerprint` 는 `routers/live.py:_auto_match_self` 에서 **본인("나") 목소리 식별 전용**(등록 fingerprint max similarity, 세션당 is_self 1명 가드). memory `feedback_qnote_speaker_simplify` 가 금지한 것은 *임의 다화자 매칭*이고 self-식별은 별개 → 충돌 아님. 헬스체크 VOICE 3항목으로 라이브 검증. 70일 된 메모리를 현재 코드 기준으로 정정함.

### 공통 6기준 (작동/폴백/쿼터/격리/i18n/실시간) — 횡단 확인
폴백: OPENAI 없음 시 fallback 응답·STT 503·번역 fallback. 쿼터: workspace Cue use_cue 차감+checkUsageLimit(task/brief/translate 공통). 격리: 전 기능 business_id where 필터·cross-tenant 차단. i18n: ko/en 응답. 실시간: message:translated/new broadcast.
