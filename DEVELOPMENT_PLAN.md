# PlanQ - 개발 진행 현황

> **최종 업데이트:** 2026-04-11
> **데이터베이스:** planq_dev_db (MySQL) + qnote.db (SQLite, FTS5)
> **프로젝트:** B2B SaaS — 업무 전용 고객 채팅 + 실행 구조 통합 OS
> **로드맵 상세:** `docs/DEVELOPMENT_ROADMAP.md`

---

## ✅ 완료: Q Note Phase A + Phase D + 라이브 UX 전면 안정화 (2026-04-11)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Phase A — 인제스트 파이프라인** | `documents` 테이블 확장 (source_type/source_url/title/error_message/indexed_at) + 파일/URL 공통 파이프라인 | ✅ |
| Phase A | `services/url_fetcher.py` — hop별 SSRF 재검증(DNS rebinding 방어) + HTTPS 강제 + 스트리밍 10MB 캡 + 5s/15s 타임아웃 + 리다이렉트 3회 + Content-Type 화이트리스트 | ✅ |
| Phase A | `services/extractors.py` — HTML(trafilatura) / PDF(pdfplumber) / DOCX(python-docx) / TXT 다중 인코딩 fallback. asyncio.to_thread 래핑 | ✅ |
| Phase A | `services/chunker.py` — 단락+문장 hybrid 청크 (500자/50자 overlap), 약어 예외 문장 경계 | ✅ |
| Phase A | `services/ingest.py` — `ingest_document(doc_id)` 단일 진입점, file/url 공통, `pending→processing→indexed/failed`, `add_done_callback` silent drop 방지 | ✅ |
| Phase A | `sessions.py` 라우터 재배선 — POST/documents·POST/urls가 background 태스크로 ingest 트리거, `sessions.urls` JSON 컬럼 deprecated | ✅ |
| **Phase D-0 캡처 수정** | `WebConferenceCapture` 신규 — 마이크(본인) + 탭 오디오(상대) `getUserMedia + getDisplayMedia` → Web Audio API 믹싱. 탭 단독 `BrowserTabCapture.ts` 삭제 | ✅ |
| Phase D-0 | 탭 오디오 무음 감지 워치독 — 3초간 탭 트랙 신호 없으면 console.warn | ✅ |
| **D-1 언어 필터** | `live.py` enrichment에 `allowed_languages` 주입. `detected_language ∉ meeting_languages` 시 `out_of_scope=True` + 번역/질문감지 폐기. 프론트 opacity 0.45 + 언어 태그 | ✅ |
| **D-2 음성 핑거프린트** | Resemblyzer(CPU, 256-d, L2-normalized) + `services/audio_buffer.py`(RollingAudioBuffer 60s + SpeakerAudioCollector) + `routers/voice.py`(**다국어** CRUD + verify) | ✅ |
| D-2 | `voice_fingerprints` 스키마 다국어 전환 `(user_id, language) UNIQUE` + `speaker_embeddings` 테이블 신규. 기존 데이터 `'unknown'` 태그로 보존 마이그레이션 | ✅ |
| D-2 | live.py 본인 매칭 — 마이크 전용 사이드 채널(web_conference 모드) → `/self-voice-sample` 10초 업로드 → `dg_speaker_hint` + max similarity 언어별 비교 | ✅ |
| **D-3 배치 화자 병합** | `services/speaker_clustering.py` — sklearn AgglomerativeClustering (cosine, sim ≥ 0.65), PUT status='completed' 트리거, `is_self` 상속 | ✅ |
| **D-4 화자 네이밍 UI** | 발화 블록 `[화자 N ▾]` 버튼 → `SpeakerPopover` 인라인 팝오버 (나/참여자/직접 입력). 같은 이름·is_self 자동 병합. `block.id` 기반 스코프로 중복 팝오버 버그 수정 | ✅ |
| **D-5 개인정보** | 회의 종료 시 PCM 버퍼 즉시 drop. 프로필 개인정보 처리 안내 4항목. 다국어 핑거프린트 삭제 API | ✅ |
| **프로필 페이지** | `/profile` 신규 — 기본 언어 + 다국어 음성 등록/재등록/삭제 + 매칭 확인하기(verify) + `WavRecorder` (AudioContext → WAV Blob, ffmpeg 무의존). 언어 드롭다운 선택 즉시 녹음 시작 UX. 하드 상한 30초만 자동 종료, 사용자 수동 종료 권장 | ✅ |
| **본인 인식 실패 버그 수정** | `speakerLabel` 동적 계산 — 블록 렌더마다 `speakerLabelFor()` 실시간 호출. `self_matched` WS 이벤트 후 label 즉시 "나"로 전환. 실패 시 `self_match_failed` 이벤트 + 유저 친화 안내 | ✅ |
| **텍스트 중복 버그 수정** | Deepgram `is_final=true` 모든 이벤트 commit (speech_final 필터 제거 — 문장 앞부분 손실 방지) + **2중 dedup** (시간 오버랩 + 직전 3개 정규화 텍스트 비교) | ✅ |
| **한국어 띄어쓰기 복구** | GPT-5-mini(reasoning, empty response) → **gpt-4o-mini** 교체. `translate_and_detect_question failed` 에러 근절. `formatted_original` 필드로 실시간 보정 | ✅ |
| **리프레시 시 회의 종료 버그** | `openReview`에서 session.status 기반 phase 결정 (`recording→paused`, `completed→review`). `buildBlocksFromSession` 공용 헬퍼로 paused 진입 시 서버 utterances 하이드레이트 | ✅ |
| **연속 발화 merge** | `commitPendingAsBlock` + `reviewBlocks`에 `MERGE_GAP_SEC=2.0` 규칙 — 같은 화자 + 2초 이내면 speech/question 구분 없이 병합. 질문 포함 시 question 카드로 | ✅ |
| **녹음 이어하기 멈춤 대응** | `startRecording` 실패 시 `NotAllowedError`/탭 공유 취소/WS 실패를 **유저 친화 메시지**로 변환. `pendingConfig=null` 시 마이크 모드 폴백. `console.error`로 원본 에러 기록 | ✅ |
| **사이드바 언어 저장 버그** | `/api/users/language` (존재 안 함) → `/api/users/:id` 경로 수정. LanguageSelector `try/catch`로 가려져 있던 무증상 버그 | ✅ |
| **ConfirmDialog 이식** | ProfilePage의 `window.confirm` 2곳 → `ConfirmDialog` React 컴포넌트. `alert()` 금지 규칙 준수 | ✅ |
| **검증 스크립트 v2 이식** | POS `/var/www/dev-backend/scripts/health-check.js` v2 구조 차용 (CLI 옵션, 카테고리 시스템). 19 → **27 체크** 확장 (infra/auth/security/qnote/voice/external/frontend). `--category`, `--quiet`, `--verbose`, `--host` 지원 | ✅ |

### 설계 결정 (시니어 관점)

- **DB 실측 기반 디버깅**: "두 번씩 나온다" / "띄어쓰기 안 된다" / "본인 인식 못 한다" — 각 증상을 SQL로 직접 확인해 근본 원인 파악. 코드 레벨 추측 대신 데이터 검증.
- **Deepgram multi 모드의 한계 수용**: Nova-3 multi는 한국어 정확도 크게 떨어지고 같은 구간을 여러 번 재해석. 사용자에게 1개 언어 선택 권장 UX.
- **다국어 핑거프린트**: Resemblyzer는 영어 편향이 있어 cross-language 매칭 시 유사도 하락. 사용자가 언어별 등록 → max similarity로 대응.
- **reasoning LLM 금지**: gpt-5-mini (reasoning)는 max_completion_tokens 700에서 reasoning 토큰만 소진 → empty response → json.loads 실패. gpt-4o-mini (non-reasoning)로 교체.
- **dedup 2중 방어**: 시간 오버랩(start < last_end - 0.1) + 텍스트 정규화(직전 3개 공백 제거 비교). 어느 하나만으론 다양한 Deepgram 이벤트 패턴 전부 못 잡음.
- **UI-First + ConfirmDialog**: CLAUDE.md의 alert 금지 규칙 일관 적용. window.confirm까지 동일 범주로 간주.
- **speakerLabel 동적 계산**: 블록 데이터 구조에 문자열 스냅샷 저장은 state 업데이트 시 stale. 렌더 시 `activeSession.speakers`에서 실시간 lookup.

### 검증 결과

- **헬스체크 27/27** (7 카테고리: infra·auth·security·qnote·voice·external·frontend)
- **Ingest E2E 12/12** (Phase A)
- **Voice Fingerprint E2E 10/10**
- **Speaker Merge E2E 5/5**
- **턴 검증 E2E 12/12** — 한국어 띄어쓰기 실 LLM 4건 전부 복구 확인
- 빌드: tsc 0 error, 151 modules, 536KB, `iQIgwuc5`
- 백엔드 에러로그 clean (gpt-4o-mini 전환 후)

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `services/voice_fingerprint.py`, `services/audio_buffer.py`, `services/speaker_clustering.py`, `services/url_fetcher.py`, `services/extractors.py`, `services/chunker.py`, `services/ingest.py`, `routers/voice.py`
- 수정: `services/database.py`, `services/llm_service.py`, `services/deepgram_service.py`, `routers/sessions.py`, `routers/live.py`, `main.py`, `requirements.txt`, `.env` (LLM_MODEL=gpt-4o-mini)

**Q Note 프론트엔드 (TS)**
- 신규: `pages/Profile/ProfilePage.tsx`, `services/audio/WebConferenceCapture.ts`, `services/audio/recordToWav.ts`
- 수정: `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx`, `services/qnote.ts`, `services/qnoteLive.ts`, `services/audio/index.ts`, `services/audio/AudioCaptureSource.ts`, `services/audio/PCMStreamer.ts`, `components/Layout/MainLayout.tsx`, `components/Common/Icons.tsx`, `components/Common/LanguageSelector.tsx`, `contexts/AuthContext.tsx`, `App.tsx`
- 삭제: `services/audio/BrowserTabCapture.ts`, `pages/QNote/mockData.ts`

**기타**
- `scripts/health-check.js` (v2 구조 이식)

### 미완 / 다음 세션

- **실라이브 본인 인식 튜닝**: Resemblyzer 매칭 임계값(0.68) 실 회의 데이터 기반 조정 필요
- **모달 participants 재사용 UX**: localStorage 캐시 → 다음 회의 모달에 기본값 제안
- **Deepgram 세션 split (4시간 한계)**: 재연결 로직과 묶어서 구현
- **Phase B 답변 찾기 API**: utterance_id + 컨텍스트 5개 → BM25 top-K → GPT-4o-mini 답변
- **Phase C 답변 찾기 UI**: 답변 표시 패널 mock → Irene 승인 → 실 API 연결

---

## ✅ 완료: Q Note B-3 Step 8 — 프론트 실 API 연결 + 라이브 UX 재설계 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **API 클라이언트** | `services/qnote.ts` 신규 — 세션 CRUD / 문서 / URL / 화자 매칭 + `buildLiveSocketUrl` (JWT query) | ✅ |
| **WebSocket 라이브** | `services/qnoteLive.ts` 신규 — `LiveSession` (캡처 + WS + PCM 파이프 + 이벤트 라우팅) | ✅ |
| **PCM 스트리머** | `services/audio/PCMStreamer.ts` 신규 — MediaStream → 16kHz mono PCM16 (ScriptProcessorNode + muted gain) | ✅ |
| **QNotePage 재설계** | mock 완전 제거 + 실 API 연결 + WebSocket 통신 | ✅ |
| **상태 머신** | `empty → prepared → recording ⇄ paused → review` — 자동 녹음 방지, 일시중지/재개/종료 분리 | ✅ |
| **터미네이터 기반 커밋** | Deepgram finals를 pending 버퍼에 누적, `? . !` 도착 시 한 번에 커밋 → 한 문장이 여러 카드로 쪼개지는 문제 해결 | ✅ |
| **Pending 유령 블록** | 미완성 문장을 opacity 0.55 이탤릭 + `…` 로 라이브 표시 | ✅ |
| **카드 패러다임 전환** | 일반 발화 → flat transcript 블록 (보더 없음). **질문만 카드** — 공간 밀도 4-5배 | ✅ |
| **질문 카드 수평 레이아웃** | 좌측 본문 + 우측 답변 찾기 버튼 → 높이 ~120px → ~70px (42% 감소) | ✅ |
| **플리커 내성 병합** | 같은 dg_speaker 또는 갭 < 1.5초 → 병합 (Deepgram diarize 플리커 무시). 20초 침묵 → 강제 flush | ✅ |
| **낙관 질문 감지** | 문장 끝 `?` + wh-word + 한국어 의문 어미 즉시 감지 → GPT enrichment 기다리지 않음 | ✅ |
| **번역 부분 표시** | 일부 segment만 번역 도착해도 있는 부분 렌더 + 끝에 `…`. 전체 없음 시 "번역 중…" placeholder | ✅ |
| **자동 하단 스크롤** | 라이브 모드에서 블록/interim 업데이트 시 transcript 영역 하단으로 smooth scroll | ✅ |
| **모달 state 리셋** | `StartMeetingModal` 열릴 때마다 모든 입력 초기화 (이전 회의 데이터 잔존 방지) | ✅ |
| **live.py `finalized` 이벤트** | DB insert 후 utterance_id 즉시 클라이언트 통지 → enrichment와 정확 상관관계 | ✅ |
| **live.py WS 종료 정리** | WS close 시 자동 status=completed 제거 → pause/resume 가능, 명시적 PUT으로만 종료 | ✅ |
| **Deepgram `smart_format=true`** | 구두점 + 숫자/날짜/시간 자동 포맷 → 터미네이터 감지 정확도 향상 | ✅ |
| **speaker 라벨 fallback** | DB 매칭 실패해도 dg_speaker_id로 "화자 1", "화자 2" 즉시 라벨링 | ✅ |
| **mockData.ts 삭제** | — | ✅ |

### 설계 결정 (시니어 UX 관점)

- **카드 → Flat transcript + 질문 카드**: Otter/Fireflies 패턴 차용. 모든 발화 카드화는 공간 낭비 + scanning 방해
- **터미네이터 기반 커밋**: Deepgram final은 문장 단위가 아니라 VAD 단위. 문장 경계(`.!?`)에서만 커밋해야 한 질문이 여러 카드로 찢어지지 않음
- **플리커 1.5초 내성**: Deepgram 실시간 diarize의 speaker_id는 말 중간에도 튐. 1.5초 미만 갭 내 speaker 변경은 무조건 플리커로 간주
- **시간/길이 캡 제거**: 인위적 카드 분할은 맥락 단절. 유일한 분할 기준은 침묵(20초), 질문, 진짜 화자 교체
- **답변 찾기 수평 배치**: 풀스크린 사용 가능성 고려, 카드 높이 최소화

### 검증

- 빌드: tsc 0 error, vite 147 modules, 497KB 번들
- 헬스체크: **19/19 통과**
- Step 8 E2E: **14/14 통과** (CRUD + round-trip + PUT 부분 업데이트 + 문서 업로드 + 확장자 블랙리스트 + SSRF 3종 + 인증 + pagination + CASCADE)
- 유저 플로 E2E: **6/6 통과**
- 페이지 서빙 200, 번들 내 실 API 경로 + 신규 UI 문자열 검증

### 수정/생성된 파일

**생성:**
- `dev-frontend/src/services/qnote.ts`
- `dev-frontend/src/services/qnoteLive.ts`
- `dev-frontend/src/services/audio/PCMStreamer.ts`

**수정:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` (대폭 재설계 — 1063줄)
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` (open 시 state reset)
- `q-note/routers/live.py` (finalized 이벤트 + WS 종료 로직)
- `q-note/services/deepgram_service.py` (smart_format=true)

**삭제:**
- `dev-frontend/src/pages/QNote/mockData.ts`

### 미완 / 다음 세션

- **Step 6**: URL Fetcher (trafilatura + https 강제 + SSRF 재사용 + 10MB/15s + sessions.urls status 갱신)
- **Step 7**: B-5 RAG 기초 (PDF/DOCX/TXT 추출 + 500자 청크 + SQLite FTS5 + 답변 찾기 API)
- **실제 회의 테스트**: 라이브 녹음 UX 추가 튜닝 (pending 동작, 질문 감지 정확도 관찰)
- **프로필 페이지**: language 변경 UI, 음성 핑거프린트
- **연결 끊김 처리**: WebSocket 재연결 + 오디오 버퍼
- **4시간 한계 처리**: Deepgram 세션 split
- **법적 동의 모달**: 녹음 동의, AI 데이터 처리 안내

---

## 완료: Q Note B-3 Backend Wiring Step 1–5 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Step 1 DB 스키마** | sessions 컬럼 6종 추가 (brief, participants, urls, meeting_languages, translation_language, answer_language) | 완료 |
| **Step 1 DB 스키마** | sessions.pasted_context 컬럼 추가 | 완료 |
| **Step 1 DB 스키마** | speakers 신규 테이블 (session_id, deepgram_speaker_id, participant_name, is_self) | 완료 |
| **Step 1 DB 스키마** | utterances.speaker_id FK 추가 | 완료 |
| **Step 1 DB 스키마** | documents.session_id FK + 인덱스 추가 | 완료 |
| **Step 1 DB 스키마** | 기존 데이터 보존 마이그레이션 (PRAGMA table_info 체크 → ALTER) | 완료 |
| **Step 2 세션 API** | POST /api/sessions — brief/participants/언어3종/pasted_context 수신 | 완료 |
| **Step 2 세션 API** | PUT /api/sessions/:id — 모든 필드 부분 업데이트 + JSON 역직렬화 | 완료 |
| **Step 2 세션 API** | GET /api/sessions/:id — utterances + documents + speakers 포함 | 완료 |
| **Step 2 문서** | POST /api/sessions/:id/documents — multipart 업로드 (10MB, 확장자 화이트리스트) | 완료 |
| **Step 2 문서** | DELETE /api/sessions/:id/documents/:doc_id — DB + 디스크 파일 정리 | 완료 |
| **Step 2 URL** | POST /api/sessions/:id/urls — https + SSRF 방어 (내부 IP/loopback/link-local 차단) | 완료 |
| **Step 2 URL** | DELETE /api/sessions/:id/urls/:url_id | 완료 |
| **Step 3 Deepgram** | deepgram_service.py `diarize=true` 추가 | 완료 |
| **Step 3 Deepgram** | 단어 리스트 다수결로 deepgram_speaker_id 추출 | 완료 |
| **Step 3 Deepgram** | meeting_languages → language 파라미터 매핑 (1개=단일, 여러개=multi) | 완료 |
| **Step 4 화자 매칭** | POST /api/sessions/:id/speakers/:speaker_id/match | 완료 |
| **Step 4 화자 매칭** | is_self=true 소급 적용 — 해당 화자의 is_question 플래그 해제 + detected_questions 삭제 | 완료 |
| **Step 4 화자 매칭** | live.py speaker upsert (WebSocket utterance 수신 시 자동) | 완료 |
| **Step 5 LLM 컨텍스트** | `_build_context_prefix()` — brief/participants/pasted_context → system prompt 접두 | 완료 |
| **Step 5 LLM 컨텍스트** | translate/summary/answer 모두 meeting_context 파라미터 지원 | 완료 |
| **Step 5 LLM 컨텍스트** | live.py 세션 시작 시 컨텍스트 로드 → 모든 enrichment 호출에 주입 | 완료 |
| **Step 5 LLM 컨텍스트** | /api/llm/translate, /summary 에 session_id 옵션 추가 (소유 검증 후 컨텍스트 로드) | 완료 |
| **부수 수정** | SQLite FK 활성화 — services/database.py `connect()` 헬퍼, 모든 커넥션에 PRAGMA foreign_keys=ON | 완료 |
| **부수 수정** | aiosqlite.connect(DB_PATH) → db_connect() 일괄 교체 (sessions/live/llm 라우터) | 완료 |
| **부수 수정** | python-multipart 의존성 추가 | 완료 |
| **프론트 UX** | 모달 "녹음 시작" → "회의 진행" 변경, 회의 준비 / 녹음 분리 | 완료 |
| **프론트 UX** | 메인 헤더 녹음 시작/중지 버튼 state 분기 | 완료 |

### 검증 결과

- **Step 1 DB 마이그레이션**: PRAGMA table_info 로 모든 컬럼/테이블/인덱스 존재 확인
- **Step 2 세션 API E2E (13/13)**: 생성/조회/업데이트 round-trip, 파일 업로드/삭제 + 디스크 검증, 확장자 블랙리스트, URL 4종 SSRF 차단(http/loopback/private/link-local), 인증 미적용 401
- **Step 3-5 E2E (10/10)**: 화자 seed/매칭, is_self 소급 (본인 질문 제거, 타인 질문 보존), GET 에 speakers 포함, 404 처리, LLM 컨텍스트 주입, CASCADE 삭제 검증
- **헬스체크 19/19 전체 통과** (변경 전후 유지)

### 수정된 파일

**백엔드 (Q Note):**
- `q-note/services/database.py` — 마이그레이션 로직 + speakers 테이블 + connect() 헬퍼 (FK 활성화)
- `q-note/services/deepgram_service.py` — diarize + speaker_id 추출
- `q-note/services/llm_service.py` — `_build_context_prefix` + meeting_context 파라미터
- `q-note/routers/sessions.py` — 전면 재작성 (세션 CRUD 확장 + 문서/URL/화자 매칭)
- `q-note/routers/live.py` — 컨텍스트 로드 + 화자 upsert + is_self 필터링
- `q-note/routers/llm.py` — session_id 옵션 + _load_meeting_context
- `q-note/requirements.txt` — python-multipart==0.0.12 추가

**프론트엔드:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 녹음 시작/중지 분리
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — 버튼 "회의 진행"

---

## ✅ 완료: Q Note Phase 8 — B-1, B-2 + B-3 mock UI + 인프라 정비 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **B-1 백엔드** | Q Note FastAPI 구조 (routers/services/middleware/data) | ✅ |
| **B-1 백엔드** | SQLite 6 테이블 + FTS5 (sessions, utterances, documents, document_chunks, summaries, detected_questions) | ✅ |
| **B-1 백엔드** | JWT 인증 미들웨어 (PlanQ 백엔드 SECRET_KEY 공유) | ✅ |
| **B-1 백엔드** | Deepgram WebSocket 프록시 (Nova-3, language=multi) | ✅ |
| **B-1 백엔드** | 세션 CRUD API (POST/GET/PUT/DELETE /api/sessions) | ✅ |
| **B-1 백엔드** | WebSocket /ws/live 엔드포인트 | ✅ |
| **B-1 인프라** | Nginx WebSocket 프록시 헤더 추가 | ✅ |
| **B-2 백엔드** | OpenAI GPT-5-mini 연동 (translate, summary, answer) | ✅ |
| **B-2 백엔드** | LLM 서비스 (translate_and_detect_question, generate_summary, generate_answer) | ✅ |
| **B-2 백엔드** | /api/llm/translate, /api/llm/summary 엔드포인트 | ✅ |
| **B-2 백엔드** | live.py에 background enrichment 통합 (utterance → 번역+질문감지) | ✅ |
| **B-2 검증** | 실제 한→영 / 영→한 번역 + is_question 감지 동작 확인 (19/19 헬스체크) | ✅ |
| **헬스체크** | scripts/health-check.js — 19개 체크 (Infra/Auth/B-1/External/B-2/Frontend Lint) | ✅ |
| **헬스체크** | /검증 + /개발완료 명령어에 0단계 헬스체크 통과 강제 추가 | ✅ |
| **헬스체크** | 토큰 캐시 (rate limit 회피) | ✅ |
| **린트** | Frontend 린트 3종 (POS 컬러 잔재 / raw <select> / react-select 직접 import) | ✅ |
| **컴포넌트** | PlanQSelect (react-select 기반 검색 가능 통합 셀렉트, 사이즈/multi/icon 지원) | ✅ |
| **컴포넌트** | Icons.tsx (Feather-style stroke SVG, MicIcon/MonitorIcon/StopIcon 등 11개) | ✅ |
| **POS 정리** | POS 보라색 잔재 17개 파일 약 30곳 일괄 정리 (#6C5CE7→#14B8A6 등) | ✅ |
| **POS 정리** | theme.ts brand 컬러 PlanQ 딥틸로 교체 + Point 컬러 추가 | ✅ |
| **POS 정리** | legacy SelectComponents.tsx 삭제, ThemedSelect/FormSelect 제거 | ✅ |
| **컬러 시스템** | Point 컬러 Coral/Rose #F43F5E 정의 (CTA + AI 감지 강조용) | ✅ |
| **컬러 시스템** | COLOR_GUIDE.md §2.5 Point 컬러 섹션 신규 추가 | ✅ |
| **DB** | users.language 컬럼 추가 (사용자 모국어, ISO 639-1) | ✅ |
| **DB** | PUT /api/users/:id에 language 업데이트 + 검증 추가 | ✅ |
| **B-3 mock UI** | Q Note 페이지 (사이드바 + 라이브/리뷰 모드 + 트랜스크립트) | ✅ |
| **B-3 mock UI** | StartMeetingModal — 회의 시작 입력 폼 | ✅ |
| **B-3 mock UI** | 회의 시작 모달 — 제목, 회의 안내(brief), 참여자, 메인/답변/번역 언어, 자료(파일/텍스트/URL), 캡처 방식 | ✅ |
| **B-3 mock UI** | 메인 언어 멀티 셀렉트 (pill + "+ 언어 추가") — 빈 상태 시작 | ✅ |
| **B-3 mock UI** | 답변 언어 (메인 언어 중 선택), 번역 언어 (모든 언어, 디폴트 사용자 모국어) | ✅ |
| **B-3 mock UI** | 참여자 입력 (이름 + 역할/메모, 그룹 표현 가능) | ✅ |
| **B-3 mock UI** | 자료 — 파일 업로드 (10MB 검증) + 텍스트 붙여넣기 (10만자) + URL (http/https 검증) | ✅ |
| **B-3 mock UI** | 본인 발화 질문 제외 (isSelf 필드, 좌측 코랄 보더 + "질문" 라벨 + "답변 찾기" 버튼 제외) | ✅ |
| **B-3 mock UI** | 질문 발화 텍스트 굵게 + 코랄 좌측 보더 강조 | ✅ |
| **B-3 mock UI** | 사이드바 접기 토글 (미팅 풀스크린) | ✅ |
| **B-3 mock UI** | AudioCapture 추상화 인터페이스 (마이크/탭, 미래 데스크톱 앱 대응) | ✅ |
| **B-3 mock UI** | LANGUAGES.ts 상수 (23개 언어, ISO 639-1 + Deepgram 지원 정보) | ✅ |
| **워크플로우** | UI-First 개발 원칙 영구 규칙화 (CLAUDE.md + 메모리) | ✅ |

### 미완료 / 다음 단계 (B-3 backend wiring + B-4~B-6)

| 작업 | 상태 |
|------|:----:|
| Deepgram WebSocket에 `diarize=true` 옵션 추가 (화자 분리) | ⏳ |
| sessions 테이블에 brief, participants(JSON), urls 컬럼 추가 | ⏳ |
| speakers 테이블 신규 (session_id, speaker_id, participant_name, is_self) | ⏳ |
| 화자 매칭 API (POST /api/sessions/:id/speakers/:speaker_id/match) | ⏳ |
| LLM 호출 시 brief + participants를 system prompt에 prefix 주입 | ⏳ |
| isSelf 자동 마킹 (사용자가 "나"로 매칭한 speaker_id 발화 모두) | ⏳ |
| 본인 발화는 detected_questions 테이블에 INSERT 안 함 | ⏳ |
| URL fetcher (trafilatura/readability) + SSRF 방어 (내부 IP 차단, HTTPS 강제) | ⏳ |
| 문서 업로드 + 텍스트 추출 + 청크 분할 + FTS5 인덱싱 (B-5 RAG) | ⏳ |
| 회의 음성 캡처 → WebSocket 전송 (PCM16 16kHz mono) | ⏳ |
| 라이브 모드 mock 데이터 → 실 WebSocket 연결로 교체 | ⏳ |
| 리뷰 모드 → 실 세션 데이터로 교체 | ⏳ |
| 사용자 프로필 페이지 (language 필드 변경 UI) | ⏳ |
| 회의 도중 연결 끊김 처리 (재연결 + 버퍼 + 이어쓰기) | ⏳ |
| 4시간 회의 한계 처리 (Deepgram 세션 split) | ⏳ |
| 음성 핑거프린트 등록/매칭 (선택 기능) | ⏳ |
| 법적 동의 1회 모달 (녹음 동의, AI 데이터 처리 안내) | ⏳ |

### 수정/생성된 파일 (이번 세션)

**생성:**
- `dev-frontend/src/components/Common/PlanQSelect.tsx`
- `dev-frontend/src/components/Common/Icons.tsx`
- `dev-frontend/src/constants/languages.ts`
- `dev-frontend/src/services/audio/AudioCaptureSource.ts`
- `dev-frontend/src/services/audio/MicrophoneCapture.ts`
- `dev-frontend/src/services/audio/BrowserTabCapture.ts`
- `dev-frontend/src/services/audio/index.ts`
- `dev-frontend/src/pages/QNote/QNotePage.tsx`
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx`
- `dev-frontend/src/pages/QNote/mockData.ts`
- `q-note/middleware/auth.py`
- `q-note/services/database.py`
- `q-note/services/deepgram_service.py`
- `q-note/services/llm_service.py`
- `q-note/routers/live.py`
- `q-note/routers/sessions.py`
- `q-note/routers/llm.py`
- `q-note/.env` (개인 키 — git 제외)
- `scripts/health-check.js`

**수정:**
- `q-note/main.py`, `q-note/requirements.txt`
- `dev-backend/models/User.js` (language 컬럼 추가)
- `dev-backend/routes/users.js` (language 업데이트 검증)
- `dev-frontend/src/styles/theme.ts` (PlanQ 컬러 + Point 컬러)
- `dev-frontend/COLOR_GUIDE.md` (Point 컬러 §2.5 추가)
- `dev-frontend/src/App.tsx` (Q Note 라우트 활성화)
- `CLAUDE.md` (UI-First 워크플로우 명시)
- `.claude/commands/검증.md`, `.claude/commands/개발완료.md` (헬스체크 0단계 추가)
- POS 컬러 잔재 17개 파일 (보라색 → 딥틸)

**삭제:**
- `dev-frontend/src/components/UI/SelectComponents.tsx` (가짜 SearchableSelect)

---

## Phase 1: 서버 분리 + PlanQ 초기 세팅 ✅

**완료: 2026-04-08**

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 디렉토리 구조 (`/opt/planq/`) | ✅ |
| 2 | MySQL DB + 유저 (planq_dev_db / planq_admin) | ✅ |
| 3 | 백엔드 (Express + Sequelize + 13 모델 + 8 라우트) | ✅ |
| 4 | 프론트엔드 (Vite + React + TypeScript) | ✅ |
| 5 | Nginx + SSL (dev.planq.kr) | ✅ |
| 6 | Q Note (FastAPI, port 8000) | ✅ |
| 7 | Git (github-planq:ireneceo/planq) | ✅ |
| 8 | CLAUDE.md + DEVELOPMENT_PLAN.md | ✅ |
| 9 | 개발 인프라 명령어 (/개발시작, /개발완료, /저장, /검증, /배포, /복원) | ✅ |
| 10 | 보안 미들웨어 POS 수준 업그레이드 (SSRF, CSP, SQL Injection, Socket.IO 인증) | ✅ |
| 11 | 설계 문서 정리 (docs/ — 아키텍처, ERD, IA, API, 기능정의서, 보안, 로드맵) | ✅ |

---

## ✅ 완료: Phase 2 최소 세트 — 인증 시스템 (2026-04-08)

### 완료된 작업

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | POST /api/auth/register (User+Business+Member 트랜잭션 생성, JWT 발급) | ✅ |
| 2 | POST /api/auth/login (이메일/username 둘 다 지원, Access 15분 + Refresh 7일) | ✅ |
| 3 | POST /api/auth/refresh (HttpOnly Cookie, Refresh Token rotation) | ✅ |
| 4 | POST /api/auth/logout (Refresh Token DB 무효화 + cookie 삭제) | ✅ |
| 5 | POST /api/auth/forgot-password + reset-password | 미구현 (나중에) |
| 6 | AuthContext (메모리 토큰 + 14분 자동갱신) + ProtectedRoute | ✅ |
| 7 | LoginPage + RegisterPage (PlanQ 컬러, pill shape, placeholder only) | ✅ |
| 8 | MainLayout (딥틸 사이드바 + LanguageSelector + PlanQ 브랜딩) | ✅ |

### 추가 구현
- User 모델: username, refresh_token, reset_token 필드 추가
- COLOR_GUIDE.md 전면 재작성 (딥 틸 컬러 시스템, 11개 섹션)
- cookie-parser 추가, CORS credentials 설정

### 수정된 파일
- `dev-backend/models/User.js` — username, refresh_token 등 필드 추가
- `dev-backend/routes/auth.js` — register/login/refresh/logout 전면 재작성
- `dev-backend/server.js` — cookie-parser 추가
- `dev-backend/.env` — JWT_REFRESH_SECRET, JWT_EXPIRES_IN=15m
- `dev-frontend/src/pages/Login/LoginPage.tsx` — 신규
- `dev-frontend/src/pages/Register/RegisterPage.tsx` — 신규
- `dev-frontend/src/contexts/AuthContext.tsx` — 전면 재작성
- `dev-frontend/src/components/ProtectedRoute.tsx` — PlanQ 컬러
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 딥틸 사이드바
- `dev-frontend/src/components/Common/LanguageSelector.tsx` — 다크 사이드바 대응
- `dev-frontend/src/App.tsx` — 실제 라우팅 연결
- `dev-frontend/COLOR_GUIDE.md` — 전면 재작성

---

## ✅ 완료: Q Note 설계 문서화 (2026-04-09)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Note 구조 변경 확정 | 배치(Whisper) → 실시간(Deepgram) 전환, 라이브+리뷰 2모드 | ✅ |
| FEATURE_SPECIFICATION.md | Phase 8 전면 재작성 — F8-1~F8-5, 아키텍처, 비용 예측 | ✅ |
| DEVELOPMENT_ROADMAP.md | Phase 8 프롬프트 재작성 — B-1~B-6 단계, 프로젝트 구조 | ✅ |
| DEVELOPMENT_PLAN.md | Phase 8 작업 목록 B-1~B-6으로 교체 | ✅ |

### 수정된 파일
- `DEVELOPMENT_PLAN.md` — Phase 8 작업 목록 변경
- `docs/FEATURE_SPECIFICATION.md` — Phase 8 전면 재작성
- `docs/DEVELOPMENT_ROADMAP.md` — Phase 8 프롬프트 재작성

---

## Phase 3: 사업자 + 고객 관리

> 사업자 프로필 + 멤버 초대 + 고객 초대 (초대 링크로 간편 가입) + 대화방 자동 생성

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 사업자 정보 조회/수정 API | |
| 2 | 멤버 초대/목록/제거 API + 이메일 발송 | |
| 3 | 고객 초대 API (Client 생성 + Conversation 자동 생성 + 초대 이메일) | |
| 4 | 초대 수락 페이지 (/invite/:token → 간편 가입) | |
| 5 | 고객 목록/상세 페이지 | |
| 6 | 팀 관리 페이지 (Owner만) | |
| 7 | 사업자 설정 페이지 (프로필, 구독, 알림) | |

---

## Phase 4: Q Bill (청구서)

> 청구서 작성 + 이메일 발송 + 입금 확인 + 상태 관리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 청구서 CRUD API (자동 번호생성, 부가세 자동계산) | |
| 2 | 청구서 이메일 발송 (Nodemailer + HTML 템플릿) | |
| 3 | 입금 확인/취소 API | |
| 4 | 청구서 목록 페이지 (전체/미결/완료 탭) | |
| 5 | 청구서 작성 폼 (항목 동적 추가/삭제) | |
| 6 | 청구서 상세 페이지 (발송/입금확인 버튼) | |

---

## Phase 5: Q Talk (대화)

> Socket.IO 실시간 채팅 + 메시지 수정/삭제 + 파일 첨부 + 할일 연결

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 대화 목록 API + 메시지 목록 (페이징) | |
| 2 | 메시지 전송 + Socket.IO 실시간 | |
| 3 | 메시지 수정 (is_edited) + 삭제 (is_deleted 마스킹) | |
| 4 | 첨부파일 업로드 (MessageAttachment) | |
| 5 | 3단 레이아웃: 대화목록 / 채팅 / Q Task 패널 | |
| 6 | MessageInput (텍스트 + 📎 첨부 + Enter 전송) | |
| 7 | typing 표시, 스크롤 자동 하단 | |
| 8 | 메시지에서 할일 만들기 버튼 (Phase 6과 연결) | |

---

## Phase 6: Q Task (할일)

> 할일 CRUD + 메시지↔할일 양방향 링크 + 필터/정렬 + 마감 지연 표시

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 할일 CRUD API (필터: status, assignee, client, due) | |
| 2 | 메시지 → 할일 생성 (source_message_id 양방향 링크) | |
| 3 | 상태 변경 API + Socket.IO emit | |
| 4 | 할일 목록 페이지 (오늘/이번주/전체 탭, 필터) | |
| 5 | 마감 지연 🔴 / 오늘 마감 🟠 / 임박 🟡 표시 | |
| 6 | Q Talk 우측 패널 (해당 고객 할일) | |
| 7 | 원문 메시지 ↔ 할일 상호 이동 | |

---

## Phase 7: Q File (자료함)

> 고객별 파일 관리 + 업로드/다운로드 + 용량 제한

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 파일 업로드 API (Multer, UUID 파일명, 확장자 검증) | |
| 2 | 파일 목록/다운로드/삭제 API | |
| 3 | 자료함 페이지 (고객별 폴더/탭) | |
| 4 | 드래그 앤 드롭 업로드 UI | |
| 5 | 스토리지 사용량 표시 (요금제별 제한) | |

---

## Phase 8: Q Note (실시간 회의 전사 + AI 분석)

> 실시간 STT (Deepgram Nova-3) + 번역/질문감지 (GPT-5-mini) + 문서 기반 답변 (RAG)
> 상세 설계: `docs/FEATURE_SPECIFICATION.md` Phase 8

| # | 작업 | 상태 |
|---|------|:----:|
| B-1 | FastAPI 구조 + Deepgram WebSocket 프록시 + 실시간 STT | ✅ |
| B-2 | GPT-5-mini 연동 (번역 + 질문 감지) | ✅ |
| B-3 | 프론트엔드 라이브 모드 UI (mock + 실 백엔드 연결) | 🔄 mock UI 완료, 백엔드 연결 대기 |
| B-4 | 세션 저장 + 리뷰 모드 (기록 열람, 요약 생성) | |
| B-5 | 문서 업로드 + 답변 찾기 (RAG, SQLite FTS5) | |
| B-6 | 결과 연동 — Q Task 할일 전환 + Q Talk 공유 (2차) | |

---

## Phase 9: 알림 시스템

> 인앱 알림 + 이메일 알림

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 알림 모델 + API | |
| 2 | 인앱 알림 (헤더 벨 + 드롭다운) | |
| 3 | 이메일 알림 (새 메시지, 할일 배정, 마감 임박, 청구서) | |
| 4 | 알림 설정 (카테고리별 on/off) | |

---

## Phase 10: 구독 관리

> 요금제(Free/Basic/Pro) + 결제 + 미납 처리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 플랜 페이지 (비교 테이블) | |
| 2 | 결제 연동 | |
| 3 | 구독 관리 (업그레이드/다운그레이드/취소) | |
| 4 | 사용량 기반 제한 (스토리지, 멤버 수, Q Note 횟수) | |
| 5 | 미납 처리 흐름 (유예 → 읽기전용 → 차단 → 삭제) | |

---

## Phase 11: 운영 배포 + Landing

> 배포 스크립트 + 랜딩 페이지 + SEO

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 운영서버 배포 스크립트 | |
| 2 | 랜딩 페이지 (Hero, Features, Pricing, CTA) | |
| 3 | SEO 메타태그 + OG 이미지 | |
| 4 | Platform Admin 대시보드 | |
