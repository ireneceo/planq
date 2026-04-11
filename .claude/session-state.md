## 현재 작업 상태
**마지막 업데이트:** 2026-04-11
**작업 상태:** 완료 — Q Note Phase A + Phase D + 라이브 UX 전면 안정화

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Phase A — 인제스트 파이프라인 (문서/URL 통합)**
- `documents` 테이블 확장: `source_type`, `source_url`, `title`, `error_message`, `indexed_at`
- `services/url_fetcher.py` — hop별 SSRF 재검증(DNS rebinding 방어), HTTPS 강제, 10MB 스트리밍 캡, 타임아웃, 리다이렉트 3회, Content-Type 화이트리스트
- `services/extractors.py` — HTML(trafilatura)/PDF(pdfplumber)/DOCX(python-docx)/TXT 다중 인코딩. asyncio.to_thread 래핑
- `services/chunker.py` — 단락+문장 hybrid 청크 (500자/50자 overlap)
- `services/ingest.py` — file/url 공통 진입점, `pending→processing→indexed/failed`, `add_done_callback` silent drop 방지
- `sessions.py` 라우터 재배선: POST /documents·POST /urls가 background ingest 트리거, `sessions.urls` JSON 컬럼 deprecated

**Phase D — 화자 인식 + 언어 + 프라이버시**
- **D-0 캡처**: `WebConferenceCapture` 신규 (mic+tab mix via Web Audio API). 탭 단독 `BrowserTabCapture.ts` 삭제. 무음 감지 워치독
- **D-1 언어 필터**: `detected_language ∉ meeting_languages` → `out_of_scope=True` + 프론트 opacity 0.45 + 언어 태그
- **D-2 음성 핑거프린트**: Resemblyzer (CPU, 256-d) + `services/voice_fingerprint.py` + `services/audio_buffer.py` (RollingAudioBuffer 60s + SpeakerAudioCollector)
- **D-2 다국어 핑거프린트**: `voice_fingerprints (user_id, language) UNIQUE` + `speaker_embeddings` 테이블 신규. 마이그레이션으로 기존 데이터 `'unknown'` 보존
- **D-2 마이크 사이드 채널**: web_conference 모드에서 10초 마이크 전용 샘플 → `/self-voice-sample` → `dg_speaker_hint` + max similarity 매칭
- **D-3 배치 화자 병합**: sklearn AgglomerativeClustering (cosine, sim ≥ 0.65), PUT status='completed' 트리거
- **D-4 화자 네이밍**: 발화 블록 `[화자 N ▾]` 클릭 → `SpeakerPopover` (나/참여자/직접 입력). `block.id` 기반 스코프로 중복 팝오버 버그 수정. 같은 이름/is_self 자동 병합
- **D-5 개인정보**: 회의 종료 시 PCM 버퍼 즉시 drop, 프로필 안내 4항, 다국어 삭제 API

**프로필 페이지 신규 (`/profile`)**
- `pages/Profile/ProfilePage.tsx` + `services/audio/recordToWav.ts` (AudioContext → WAV Blob, ffmpeg 무의존)
- 다국어 음성 등록/재등록/삭제 + **매칭 확인하기** (verify) 언어별 유사도 분해 표시
- 언어 드롭다운 선택 즉시 녹음 시작 (버튼 2개 → 드롭다운 1개 단순화)
- 하드 상한 30초만 자동 종료, 사용자 수동 종료 권장 UI (문장 잘림 방지)
- `window.confirm` → `ConfirmDialog` 컴포넌트 전환

**버그 수정 — 이번 세션 주요**
- **본인 인식 UI 반영 실패**: `speakerLabel` 동적 계산 — 블록 렌더마다 `speakerLabelFor()` 실시간 호출. `self_matched` WS 이벤트 즉시 "나"로 전환
- **텍스트 중복**: Deepgram `is_final=true` 모든 이벤트 commit (speech_final 필터 함정 제거). **2중 dedup** (시간 오버랩 + 직전 3개 정규화 텍스트 비교)
- **한국어 띄어쓰기 실패**: GPT-5-mini(reasoning, empty response) → **gpt-4o-mini** 교체. `translate_and_detect_question failed` 근절
- **리프레시 시 회의 종료**: `openReview`에서 session.status 기반 phase 결정 (`recording→paused`). `buildBlocksFromSession` 공용 헬퍼로 paused 진입 시 하이드레이트
- **연속 발화 쪼개짐**: `MERGE_GAP_SEC=2.0` — 같은 화자 + 2초 이내 발화는 speech/question 구분 없이 병합
- **녹음 이어하기 멈춤**: 실패 원인을 NotAllowedError/탭 공유 취소/WS 실패 카테고리로 분류해 **유저 친화 메시지** 노출. `pendingConfig=null` 시 마이크 모드 폴백
- **사이드바 언어 저장 403**: `/api/users/language`(존재 안 함) → `/api/users/:id` 경로 수정

**검증 스크립트 v2 이식**
- `scripts/health-check.js` — POS `/var/www/dev-backend/scripts/health-check.js` v2 구조 차용
- CLI 옵션 시스템 (`--category`, `--verbose`, `--quiet`, `--host`)
- 카테고리 기반 테스트 등록 + 그룹 출력
- 19 → **27 체크** 확장 (infra/auth/security/qnote/voice/external/frontend)

### 검증 결과
- **헬스체크 27/27 통과**
- **Ingest E2E 12/12** (파일 + URL 인제스트 + SSRF 4종 차단)
- **Voice Fingerprint E2E 10/10**
- **Speaker Merge E2E 5/5**
- **턴 검증 E2E 12/12** — 한국어 띄어쓰기 실 LLM 4건 전부 복구 확인
- 빌드: tsc 0 error · 151 modules · 536KB · `iQIgwuc5`
- 백엔드 에러로그 clean (gpt-4o-mini 전환 후)

### 메모리 추가
- `feedback_qnote_stt_llm_quirks.md` — Deepgram multi 모드 금지, speech_final 필터 금지, reasoning LLM 금지

### 다음 할 일

**즉시 우선순위**
1. **실라이브 본인 인식 임계값 튜닝** — 실제 회의 녹음 로그 기반 Resemblyzer threshold 0.68 재조정
2. **모달 참여자 재사용 UX** — localStorage 캐시로 직전 세션 participants를 다음 모달 기본값으로 제안
3. **Deepgram 세션 split (4시간 한계)** — 재연결 로직과 묶어서 구현. 사용자 당 최대 3시간 리밋

**Phase B — 답변 찾기 API (백엔드)**
- `POST /api/sessions/:id/answer` — body: `{utterance_id}`
- 서버: 직전 5개 발화 컨텍스트 조합 → GPT 쿼리 확장 → FTS5 BM25 top-5 (문서당 max 2) → GPT-4o-mini 답변 + `sources[]`
- 메모리 규칙 적용: 업로드 자료 우선, 없으면 "일반 지식 기반" 명시

**Phase C — 답변 찾기 UI (프론트)**
- 질문 카드의 `답변 찾기` 버튼 활성화 (현재 disabled)
- 답변 표시 패널 mock → **Irene 승인** → 실 API 연결 (UI-First 원칙 준수)
- 자료 인덱싱 진행 상태 배지 (pending/processing/indexed/failed)

**나머지 로드맵**
- 프로필 페이지 음성 핑거프린트 **실라이브 매칭 정확도 개선**
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
