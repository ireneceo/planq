## 현재 작업 상태
**마지막 업데이트:** 2026-04-12
**작업 상태:** 완료 — Q Note 답변 찾기 시스템 + 프로필 페르소나 + 사이드바 확장

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**답변 찾기 시스템 (Q Note Phase B+C)**
1. **DB 스키마** — qa_pairs 테이블 + FTS5 + 트리거. detected_questions 확장. sessions에 user 프로필 스냅샷 5개 컬럼
2. **answer_service.py** — 4단계 우선순위 탐색 (custom → generated → RAG → general)
3. **한국어 FTS5 매칭** — 2자 prefix(`회의*`) + stopwords 필터로 조사 변형 대응
4. **qa_generator.py** — 문서 인제스트 완료 후 자동 사전 Q&A 생성
5. **LLM 프롬프트 분리** — ANSWER_SYSTEM_RAG / ANSWER_SYSTEM_GENERAL (자료 유무별)
6. **Q&A CRUD API** — 생성/조회/수정/삭제, 소스 필터
7. **CSV 템플릿/업로드** — BOM UTF-8, 중복 UPDATE, 긴 답변 예시
8. **답변 prefetch** — 라이브 질문 감지 즉시 백그라운드 답변 탐색 + WS answer_ready 이벤트
9. **find-answer 저장** — utterance_id 제공 시 detected_questions에 저장 (새로고침 후 복원)
10. **답변/번역 분리** — translate_text 함수 별도. 답변 먼저 표시, 번역 백그라운드

**프로필 기반 답변 (사용자 페르소나)**
11. **PlanQ users 테이블 확장** — bio, expertise, organization, job_title 필드 + sync
12. **PUT /api/users/:id** — 프로필 필드 업데이트 + 길이 검증 + IDOR 방어
13. **프롬프트 재작성** — "You are NOT an AI, you ARE this person". 1인칭 관점 강제
14. **user_profile 블록 주입** — `_build_context_prefix`에 Name/Job/Org/Expertise/Background
15. **ProfilePage "내 프로필 (Q Note 답변 생성용)" 카드** — 4개 AutoSaveField, 2초 debounce
16. **AuthContext 확장** — User interface + normalizeUser 프로필 매핑
17. **Q Note 세션 생성 시 프로필 자동 전달** — user.bio/expertise/organization/job_title

**답변 UI 재설계**
18. **버튼 3단계 분리** — 답변 생성(빨강) / 답변 보기·접기(흰) 같은 크기, 우측 상단 고정
19. **질문 인라인 수정** — 클릭→편집→Enter 자동 검색. editingQuestionId state 분리
20. **+ 합치기 + 분리** — 다음 블록 숨김 (localStorage 저장, 새로고침 후 복원)
21. **번역 좌측 정렬** — 원문과 padding-left 통일
22. **답변 영역 full-width** — QuestionCardHeader/QuestionContentArea 세로 구조
23. **리뷰 모드 답변 버튼 상태 복원** — 세션 상세 detected_questions 로드 → "답변 보기"로 시작

**세션 UX 개선**
24. **회의 제목 인라인 수정** — 헤더 제목 클릭→편집→자동저장
25. **세션 목록 개선** — 상태 뱃지(녹음중/일시중지/종료), 참여자 이름 표시
26. **"발화" → "문장"** 용어 교체

**사이드바 메뉴 확장**
27. **Q Calendar 메뉴 추가** (/calendar) — Task 다음, placeholder 페이지
28. **Q Docs 메뉴 추가** (/docs) — Note 다음, placeholder 페이지
29. **메뉴 재배열** — 업무 흐름 순: Talk → Task → Calendar → Note → Docs → File → Bill

**검증 중 발견 + 수정한 버그**
- FTS5 매칭 임계값 너무 엄격 (`<= -0.5`) → `<= 0`으로 완화
- 자료 없는 general tier에서 RAG 프롬프트 재사용 → "자료에서 답을 찾지 못했습니다" 강제. 프롬프트 2개로 분리
- `_build_field_updates`/INSERT에 user 프로필 필드 누락 → 저장 안 됨
- `_load_session_or_403` sqlite3.Row에 .get() 호출 에러
- 후속 질문 제거 (불필요한 토큰 낭비) — Irene 판단: "질문 나오면 그때 답하면 됨"
- "Can you help me?" 같은 대화형 질문에 "자료에서 답 못 찾음" 반환 → 프로필 기반 1인칭 답변으로 수정

### 검증 결과
- **헬스체크 27/27** 통과
- **Q&A 시스템 E2E 26/26** 통과 (CRUD, CSV, 3단계 탐색, 보안, Q Note 통합)
- **프로필 기능 E2E** 전체 통과 (저장/조회/부분수정/null/길이제한/IDOR/미인증)
- **1인칭 답변 검증**: AI 자기부정 0건, 프로필(Warplo/KAIST/NLP) 완벽 반영
- **빌드**: tsc 0 error, 540KB
- **SPA 라우트**: /calendar /docs 포함 11개 전체 200
- **속도**: Tier 1 ~860ms / Tier 4 ~2.3초 / 번역 ~640ms

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `q-note/services/answer_service.py`
- 신규: `q-note/services/qa_generator.py`
- 수정: `q-note/services/database.py` — qa_pairs + sessions 프로필 필드
- 수정: `q-note/services/llm_service.py` — 프롬프트 재설계, translate_text
- 수정: `q-note/services/ingest.py` — Q&A 생성 트리거
- 수정: `q-note/routers/sessions.py` — Q&A CRUD, CSV, find-answer, translate-answer, cached-answer
- 수정: `q-note/routers/live.py` — _prefetch_answer, answer_ready 이벤트

**PlanQ 백엔드 (Node)**
- `dev-backend/models/User.js` — 프로필 필드 4개
- `dev-backend/routes/users.js` — 프로필 업데이트 + 검증

**프론트엔드 (TS)**
- `dev-frontend/src/App.tsx` — /calendar /docs 라우트
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 사이드바 재배열
- `dev-frontend/src/contexts/AuthContext.tsx` — User interface 확장
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — Q Note 프로필 카드
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 답변 UI 전면 재설계
- `dev-frontend/src/services/qnote.ts` — Q&A API 함수 + 타입

**문서**
- `DEVELOPMENT_PLAN.md` — 새 섹션 추가
- `dev-frontend/UI_DESIGN_GUIDE.md` — Profile 자동저장 항목에 Q Note 프로필 추가
- 신규 메모리: `feedback_qnote_personal_tool.md`, `feedback_qnote_answer_priority.md`

### 다음 할 일

**우선순위 1: Q Calendar 실 구현**
- 일정 CRUD, 반복 이벤트
- Q Task와 연동 (할일 → 일정 자동 배치)
- 월/주/일 뷰
- 관련 설계: `docs/FEATURE_SPECIFICATION.md` 확인 필요

**우선순위 2: Q Docs 실 구현**
- 문서 에디터 (마크다운/리치 텍스트)
- 버전 관리
- Q Note 답변 찾기와의 연동 (문서가 Q Docs에 있으면 자동 참조)

**Q Note 확장 (추후)**
- 프로필 다중 페르소나 ("영업용 나" / "기획용 나")
- 회의별 세밀한 컨텍스트 주입
- 답변 신뢰도 향상 (사용자 피드백 기반 리랭킹)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
