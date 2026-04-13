## 현재 작업 상태
**마지막 업데이트:** 2026-04-13
**작업 상태:** 완료 — i18n 전면 적용 + Q note 품질·속도·데이터 정합성 대규모 개선 + 편집 UX + 준비 상태 가시화

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**i18n 전면 적용**
1. i18next + react-i18next 전 페이지 리트로핏 (Login/Register/MainLayout/Profile/QNotePage/StartMeetingModal)
2. 네임스페이스 5개 (common/auth/layout/profile/qnote) × ko·en 304 key 동수
3. CLAUDE.md 에 "다국어 i18n — 필수" 섹션 + "금지사항 — 프론트엔드 하드코딩" 추가
4. 브랜드 네이밍 "Q Talk/Task/Note" → "Q talk/task/note" 소문자 통일

**Q note 답변 품질·정합성**
5. Answer tier 4단계 → 6단계 확장 (priority > custom > session_reuse > generated > rag > general)
6. 임베딩 서비스 신규 (`embedding_service.py`, OpenAI text-embedding-3-small, 1536차원)
7. Priority Q&A 전용 업로드 + FTS5 우회 전수 semantic rerank + LLM 2차 매칭 (gpt-4.1-nano)
8. `short_answer` + `keywords` 컬럼 추가. `meeting_answer_length='short'` 일 때 short_answer 우선 반환. keywords 는 FTS5 인덱스 + 임베딩 input 에 포함
9. CSV 업로드 5 컬럼 (question, answer, short_answer, keywords, category), 동기 임베딩 (race 제거), UPDATE + INSERT 혼합 지원, 드래그앤드롭 + 편집 모드 즉시 업로드

**답변 스타일·길이 제어**
10. 답변 길이: 1-2/2-3/3-4 문장 + 27/55/85 단어 하드캡 (서버 후처리 + 프롬프트 재강조)
11. User 모델 확장: `language_levels` (언어별 R/S/L/W 1-6), `expertise_level` (layman/practitioner/expert), `answer_style_default`, `answer_length_default`
12. ProfilePage 에 "내 언어 레벨" 카드 (7언어 × 4skill PlanQSelect)
13. 회의별 스타일 textarea + 길이 3버튼 (StartMeetingModal)
14. 말하기 좋은 단어 규칙 언어별 프롬프트 주입 (영어 Anglo-Saxon, 한국어 순우리말/구어체 등)

**어휘사전 (STT 교정)**
15. `generate_vocabulary_list` 프롬프트 "TERM EXTRACTOR, NOT brainstormer" 복사 전용 모드
16. `document_excerpts` 최우선 소스 + `meeting_languages` 강제 (자료 원어 그대로, 번역 금지)
17. 문서 인덱싱 완료 시 `refresh_session_vocabulary` 자동 트리거 (`ingest.py` post-hook)
18. 수동 재추출 엔드포인트 `POST /sessions/:id/refresh-vocabulary` + 편집 모달 "📄 재추출" 버튼
19. 기존 사용자 수동 키워드 보존 병합 로직
20. 검증: brief 만 → 0개, 영어 논문 → 5/5 verbatim 매칭, 환각 0/4, 한국어 자료 → 한국어

**속도**
21. Fast-path 질문 판정 병렬화 (`detect_question_fast`, gpt-4.1-nano ~300ms)
22. `quick_question` WS 이벤트 → 프론트 카드 즉시 승격 + prefetch answer 시작
23. 본인 발화 fast-path 스킵

**UX**
24. 편집 모드 (`StartMeetingModal editMode` + `initialConfig` + `editingSessionId`)
25. 편집 모달 배너, 기존 Priority Q&A/문서/어휘사전 로드 + 삭제 버튼
26. 초안 자동저장 (localStorage `qnote_meeting_draft_v1`, debounce 500ms)
27. 준비 상태 패널 (prepared/paused phase, 3초 폴링, 문서 N/M · Q&A N/M · 어휘 N개)
28. 내 발화 처리 3단계 (skip/hide/show) + localStorage
29. 화자 라벨: 참여자 0명 또는 다수면 "상대" (Deepgram ID 기반 번호 제거)
30. 번역문 원문과 왼쪽 정렬 (SpeechBlockWrap 재구조화)
31. 모달 z-index 2000/2100 (헤더·사이드바 위 덮기)

**Critical 버그 fix**
32. `live.py` Deepgram 재시도 들여쓰기 (`close + return` 이 except 밖에 있어 재시도 성공 후에도 WS 닫혀 마이크·탭 오디오 전송 실패)
33. 회의 생성 후 화면 사라지는 버그 (URL 핸들러 경합 + DB 기본 status='recording' → 'prepared' 변경)
34. 탭 재공유 이중 표시 버그 (WebConferenceCapture stop 을 async 전환: 노드 disconnect → 트랙 stop → audioContext.close await)
35. 탭 오디오 품질 개선 (Compressor + HighShelf + Gain ×2)

### 수정된 파일

**Q note (Python)**
- 신규: `services/embedding_service.py`
- 수정: `services/database.py`, `services/llm_service.py`, `services/answer_service.py`, `services/ingest.py`, `services/qa_generator.py`, `routers/live.py`, `routers/sessions.py`

**PlanQ 백엔드 (Node)**
- 수정: `models/User.js`, `routes/users.js`

**프론트엔드 (TS)**
- 수정: `contexts/AuthContext.tsx`, `i18n.ts`, `App.tsx`
- 수정: `pages/Login/LoginPage.tsx`, `pages/Register/RegisterPage.tsx`, `pages/Profile/ProfilePage.tsx`, `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx`
- 수정: `components/Layout/MainLayout.tsx`, `components/UI/Modal.tsx`, `components/Common/ConfirmDialog.tsx`
- 수정: `services/qnote.ts`, `services/qnoteLive.ts`
- 수정: `services/audio/WebConferenceCapture.ts`, `services/audio/AudioCaptureSource.ts`

**Locales**
- 신규: `public/locales/{ko,en}/{layout,profile,qnote}.json`
- 수정: `public/locales/{ko,en}/{common,auth}.json`

**문서**
- `CLAUDE.md` — i18n 필수 섹션 + 금지 사항
- `DEVELOPMENT_PLAN.md` — 새 섹션
- Memory: `feedback_qnote_answer_priority.md` (6-tier 업데이트), `feedback_qnote_vocabulary.md` (신규)

### 검증 결과
- **헬스체크 27/27** 통과
- **빌드** tsc 0 error, 572~582 KB
- **API E2E** (여러 세션 반복):
  - Priority Q&A CSV 업로드 → 동기 임베딩 ✓
  - Paraphrase 매칭 (임베딩 + LLM hybrid) 다수 케이스 priority tier ✓
  - 무관 질문 false positive 방지 ✓
  - short_answer 우선 반환 / full answer 분기 ✓
  - 길이 캡 전부 준수 (short 18w/1s, medium 48w/4s, long 84w/8s)
  - 어휘 verbatim 매칭 5/5, 환각 0/4, 언어별 강제 통과
  - 편집 모드 PUT + POST + DELETE 전부 동작
  - 보안 익명 401 / 없는 세션 404 / IDOR 403
- **SPA 라우트** 11개 전부 200

### 다음 할 일

**우선순위 1: Q Calendar 실 구현** (placeholder)
- 일정 CRUD, 반복 이벤트, 월/주/일 뷰
- Q Task 연동
- 참조: `docs/FEATURE_SPECIFICATION.md`

**우선순위 2: Q Docs 실 구현** (placeholder)
- 문서 에디터 (마크다운/리치 텍스트), 버전 관리
- Q note RAG 와 연동

**우선순위 3: 메뉴별 기획 심화**
- 사용자 지시: "메뉴 순서대로 기획설계 자세히 할게"
- Q talk → Q task → Q calendar → Q docs → Q file → Q bill 순 설계서 작성

**Q note 확장 (추후)**
- 프로필 다중 페르소나 (영업용/기획용 전환)
- Q note 세션 목록 검색 (현재 placeholder)
- 운영 배포 스크립트

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
