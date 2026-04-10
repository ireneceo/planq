## 현재 작업 상태
**마지막 업데이트:** 2026-04-10
**작업 상태:** Q Note B-3 mock UI 완료. 백엔드 연결 대기 중.

### 진행 중인 작업
- 없음 (B-3 mock UI까지 끝, Irene 화면 검토 후 백엔드 연결 단계 대기)

### 완료된 작업 (이번 세션)

**인프라:**
- 헬스체크 시스템 (scripts/health-check.js, 19개 체크) + /검증·/개발완료 0단계 통합
- 토큰 캐시로 rate limit 회피
- Frontend 린트 3종 (POS 컬러 / raw <select> / react-select 직접 import)

**Q Note B-1 (백엔드):**
- FastAPI 구조 (routers/services/middleware/data)
- SQLite 6 테이블 + FTS5
- JWT 인증 (PlanQ 백엔드 SECRET_KEY 공유)
- Deepgram Nova-3 WebSocket 프록시
- 세션 CRUD API + WebSocket /ws/live
- Nginx WebSocket 헤더 추가

**Q Note B-2 (백엔드):**
- LLM 서비스 (OpenAI GPT-5-mini)
- /api/llm/translate, /summary 엔드포인트
- live.py background enrichment (번역 + 질문 감지 → DB 저장)
- 실 동작 확인 (한↔영 번역 19/19 통과)

**컴포넌트 시스템 정비:**
- PlanQSelect (react-select 기반 검색 가능 통합 셀렉트)
- Icons.tsx (Feather-style stroke SVG 11개)
- POS 보라색 잔재 17개 파일 일괄 정리
- legacy SelectComponents.tsx 삭제
- theme.ts brand 컬러 PlanQ 딥틸로 교체

**컬러 시스템:**
- Point 컬러 Coral/Rose #F43F5E 정의 (CTA + AI 감지 강조)
- COLOR_GUIDE.md §2.5 추가
- theme.ts에 point* 토큰 추가

**DB:**
- users.language 컬럼 추가
- PUT /api/users/:id에 language 업데이트 + 검증

**Q Note B-3 mock UI:**
- QNotePage (사이드바 + 라이브/리뷰 모드 + 트랜스크립트)
- StartMeetingModal (제목/안내/참여자/언어3종/자료/캡처)
- 메인 언어 멀티 셀렉트 (pill + 추가)
- 답변 언어 (메인 언어 중) + 번역 언어 (모든 언어, 디폴트 사용자 모국어)
- 참여자 입력 (개별/그룹 자유 입력)
- 자료 업로드 (파일 10MB / 텍스트 10만자 / URL 검증)
- 본인 발화 질문 제외 (isSelf)
- 질문 발화 굵게 + 코랄 좌측 보더
- 사이드바 접기 토글
- AudioCapture 추상화 (마이크 + 탭, 미래 데스크톱 앱 대응)
- LANGUAGES.ts (23개 언어)

**워크플로우:**
- UI-First 개발 원칙 영구 규칙화 (CLAUDE.md + 메모리)
- 9개 새 메모리 규칙 추가

### 현재 헬스체크 상태
- **19/19 ALL PASSED** ✅
- Infra 4/4, Auth 1/1, Q Note B-1 7/7, External 1/1, Q Note B-2 3/3, Frontend Lint 3/3

### 다음 할 일 — Q Note B-3 백엔드 연결 (Backend Wiring)

**우선순위 순:**

1. **DB 스키마 확장**
   - sessions 테이블에 brief, participants(JSON), urls(JSON) 컬럼 추가
   - speakers 테이블 신규 (id, session_id, deepgram_speaker_id, participant_name, is_self)
   - utterances 테이블에 speaker_id FK 추가
   - documents 테이블에 session_id FK 추가 (현재 business_id만 있음)

2. **회의 생성 API 확장**
   - POST /api/sessions 에 brief, participants, meeting_languages, translation_language, answer_language 받기
   - 파일 업로드 엔드포인트 신규 (POST /api/sessions/:id/documents)
   - URL 추가 엔드포인트 신규 (POST /api/sessions/:id/urls) — SSRF 방어 필수

3. **Deepgram WebSocket 옵션 확장**
   - `diarize=true` 추가 (화자 분리)
   - 메인 언어 배열 → Deepgram language 파라미터 매핑 (1개면 단일, 2개+면 multi)

4. **화자 매칭 API**
   - POST /api/sessions/:id/speakers/:speaker_id/match body: {participant_name, is_self}
   - 매칭 시 해당 speaker_id의 모든 utterance 응답에 자동 매핑

5. **본인 발화 질문 제외 (소급)**
   - is_self 매칭 시 detected_questions에서 그 화자 발화 모두 삭제
   - 새 발화 시 is_self이면 INSERT 안 함

6. **LLM 컨텍스트 주입**
   - translate/summary/answer 호출 시 system prompt에 brief + participants prefix 삽입
   - 사용자가 참여자 정보 안 줬으면 prefix 생략

7. **URL fetcher**
   - Q Note 백엔드에 trafilatura 또는 readability 추가
   - SSRF 방어: 내부 IP 차단 (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x), HTTPS 강제, 응답 크기 10MB, 타임아웃 15초
   - 추출 성공/실패 상태 UI 표시

8. **B-5 RAG 기초**
   - 문서 텍스트 추출 (PDF: pdfplumber, DOCX: python-docx, TXT/MD: 직접 읽기)
   - 청크 분할 (500자, overlap 50자)
   - SQLite FTS5 인덱싱 (이미 스키마 있음)
   - 답변 찾기 시 session_id 필터로 검색 → 상위 5-10 청크 → GPT 컨텍스트
   - 답변에 출처 표시 (document_name, chunk 위치)

9. **프론트엔드 mock → 실 연결**
   - QNotePage useEffect로 실 세션 fetch
   - WebSocket 연결 (PCM16 16kHz mono 스트림)
   - mock 데이터 제거

10. **사용자 프로필 페이지**
    - language 필드 변경 UI
    - 음성 핑거프린트 등록 (선택)

11. **연결 끊김 처리**
    - WebSocket 자동 재연결 (exponential backoff)
    - 끊긴 동안 오디오 버퍼링 + 재연결 시 이어쓰기

12. **법적 동의 1회 모달**
    - "Q Note 사용 시 음성이 외부 AI로 전송됩니다. 회의 참여자 녹음 동의는 사용자 책임."
    - DB에 동의 시점 저장

### 영구 메모리 (다음 세션 자동 적용)
- POS 컬러 잔재 방지 (헬스체크 강제)
- UI-First 개발 (mock 먼저, Irene 승인 후 백엔드)
- 자동저장 강제 (AutoSaveField)
- POS 컴포넌트 재사용 원칙
- Q Note 본인 발화 질문 제외
- Q Note 답변 RAG 우선 (자료 > AI 일반 지식)
- Q Note 회의 안내 (brief) AI 컨텍스트 주입
- Q Note 화자 식별 (사전 등록 + 사후 매칭, 회의 도중 모달 금지)
- PlanQ 포인트 컬러 Coral/Rose

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
