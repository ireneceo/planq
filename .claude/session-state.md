## 현재 작업 상태
**마지막 업데이트:** 2026-04-10
**작업 상태:** 완료 — Q Note B-3 Backend Wiring Step 1–5 통과. Step 6–8 대기 중.

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Q Note B-3 Backend Wiring Step 1–5:**
- Step 1: SQLite 스키마 확장 (sessions 7컬럼, speakers 신규, utterances/documents FK) + 자동 마이그레이션
- Step 2: 세션 CRUD 확장 + 문서 업로드/삭제 + URL 등록/삭제 (SSRF 방어: http 차단, 내부 IP/loopback/link-local 차단)
- Step 3: Deepgram diarize=true + meeting_languages 매핑 + 다수결 speaker_id 추출
- Step 4: 화자 매칭 API + is_self 소급 적용 (본인 질문 제거, 타인 질문 보존)
- Step 5: LLM 컨텍스트 주입 — brief/participants/pasted_context 를 모든 LLM 호출에 접두
- 부수: SQLite FK 활성화 (`connect()` 헬퍼 + 전 라우터 일괄 교체) — CASCADE 삭제 버그 근본 수정
- 부수: python-multipart 의존성 추가
- 프론트: 모달 "녹음 시작" → "회의 진행" 변경, 녹음 시작/중지 버튼 분기

**워크플로우 피드백 (메모리 저장):**
- 이모지 체크마크 금지 — ✅/❌/✔/✘ 전부 금지, 텍스트 ✓/✗ 만 사용
- git diff 색상 hex 설정 (#6A9955 / #D16969) — 눈 피로 감소
- Claude Code 테마 dark-ansi 확인

### 검증 결과
- 헬스체크 19/19 전체 통과
- Step 2 세션 API E2E 13/13 통과
- Step 3–5 E2E 10/10 통과 (CASCADE 검증 포함)

### 다음 할 일 — Q Note B-3 Backend Wiring Step 6–8

**Step 6: URL Fetcher (B-5 RAG 선행)**
- trafilatura 또는 readability 추가
- https 강제 + SSRF 방어 재사용
- 응답 크기 10MB / 타임아웃 15초
- sessions.urls JSON 배열의 status 갱신 (pending → fetched / failed)
- 추출 텍스트 저장

**Step 7: B-5 RAG 기초**
- 문서 텍스트 추출 (PDF: pdfplumber, DOCX: python-docx, TXT/MD: 직접)
- 청크 분할 (500자 / overlap 50자)
- SQLite FTS5 인덱싱 (document_chunks_fts 이미 존재)
- 답변 찾기 — session_id 필터 검색 → GPT 컨텍스트 주입 + 출처 표시

**Step 8: 프론트 mock → 실 API 연결** (가장 먼저 해도 됨 — Irene 화면 검증 목적)
- QNotePage useEffect 로 실제 세션 목록 fetch
- 회의 시작 시 POST /api/sessions 호출 + 반환 세션으로 이어감
- WebSocket /ws/live 연결 (PCM16 16kHz mono 스트림)
- 문서 업로드 실 API 호출
- URL 등록 실 API 호출
- mockData.ts 제거

**추천 순서**: Step 8 먼저 (Irene이 화면에서 확인 가능) → Step 6 → Step 7

### 나머지 로드맵 (B-3 완료 후)
- 프로필 페이지 (language 변경 UI, 음성 핑거프린트)
- 연결 끊김 처리 (WebSocket 재연결 + 오디오 버퍼)
- 4시간 회의 한계 처리 (Deepgram 세션 split)
- 법적 동의 1회 모달

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
