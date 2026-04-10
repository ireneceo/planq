## 현재 작업 상태
**마지막 업데이트:** 2026-04-10
**작업 상태:** 완료 — Q Note B-3 Step 8 프론트 실 API 연결 + 라이브 UX 재설계 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Q Note B-3 Step 8 — 프론트 실 API 연결**
- `services/qnote.ts` 신규 — API 클라이언트 (세션 CRUD / 문서 / URL / 화자 매칭 + WebSocket URL 빌더)
- `services/qnoteLive.ts` 신규 — `LiveSession` (캡처 + WebSocket + PCM 파이프 + 이벤트 라우팅)
- `services/audio/PCMStreamer.ts` 신규 — MediaStream → 16kHz mono PCM16 (ScriptProcessorNode)
- `QNotePage.tsx` 대폭 재설계 (mock 제거 + 실 API + 상태 머신 + 트랜스크립트 블록)
- `StartMeetingModal.tsx` — 모달 open 시 state 리셋
- `mockData.ts` 삭제

**라이브 UX 재설계 (Irene 피드백 반영)**
- **상태 머신**: empty → prepared → recording ⇄ paused → review (자동 녹음 방지)
- **터미네이터 기반 커밋**: Deepgram final 들을 pending 버퍼에 누적, `? . !` 도착 시에만 커밋 → 한 질문이 여러 카드로 쪼개지는 문제 해결
- **Pending 유령 블록**: 미완성 문장을 opacity 0.55 이탤릭 + `…` 실시간 표시
- **카드 패러다임 전환**: 일반 발화 = flat transcript 블록 (보더 없음), **질문만 카드** — 공간 밀도 4-5배
- **질문 카드 수평 레이아웃**: 좌측 본문 + 우측 답변 찾기 → 높이 42% 감소
- **플리커 내성 병합**: 같은 dg_speaker 또는 갭 < 1.5초 → 병합. 20초 침묵 → 강제 flush
- **낙관 질문 감지**: `?`, wh-word, 한국어 의문 어미 → GPT 기다리지 않음
- **번역 부분 표시**: 일부만 도착해도 렌더, 끝에 `…`
- **자동 하단 스크롤**: 라이브 모드에서 블록/interim 업데이트 시 smooth scroll
- **Speaker 라벨 fallback**: DB 매칭 실패해도 dg_speaker_id로 "화자 1", "화자 2"

**백엔드 보강**
- `live.py`: `finalized` 이벤트 추가 (DB insert 후 utterance_id 즉시 통지 → enrichment 상관관계)
- `live.py`: WS 종료 시 자동 status=completed 제거 → pause/resume 가능, 명시적 PUT으로만 종료
- `deepgram_service.py`: `smart_format=true` — 구두점 + 숫자/날짜 자동 포맷

### 검증 결과
- 헬스체크: **19/19 통과**
- Step 8 API E2E: **14/14 통과** (CRUD + round-trip + SSRF 3종 + 확장자 블랙리스트 + pagination + CASCADE)
- 유저 플로 E2E: **6/6 통과**
- 빌드: tsc 0 error, vite 147 modules, 497KB 번들
- 페이지 서빙 /q-note 200

### 메모리 추가
- `feedback_qnote_transcript_design.md` — Q Note 트랜스크립트 설계 원칙 (flat + 질문만 카드, 터미네이터 기반 커밋, 플리커 내성, 시간/길이 캡 금지)

### 다음 할 일 — Q Note B-3 Step 6, 7

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
- 프론트엔드 답변 찾기 버튼 활성화 (현재 disabled)

**실제 회의 테스트 필요**
- 라이브 녹음 시 pending 유령 블록 자연스러움
- 터미네이터 기반 커밋이 실제 문장 단위로 동작하는지
- 낙관 질문 감지 정확도
- 화자 플리커 내성 동작

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
