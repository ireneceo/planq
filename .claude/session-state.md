## 현재 작업 상태
**마지막 업데이트:** 2026-04-11
**작업 상태:** 완료 — Q Note 품질 전면 개선 (7 Phase 리팩터링)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Phase 0 — 실측**
- DB 실측: 최근 세션 3건 participants=NULL 확정
- voice_fingerprints DB 등록 상태 확인
- sessions.capture_mode 컬럼 없음 확인
- LLM TRANSLATE_SYSTEM 의 "Do NOT change word choice" 제약 확인

**Phase 5 — 참여자 flush 버그**
- StartMeetingModal.handleStart — 미반영 pName/pRole 을 submit 직전 자동 포함

**Phase 1 — 라이브 렌더 재설계 (누적 버퍼 설계)**
- live.py `pending_utterance` 버퍼:
  - 모든 `is_final=true` 조각을 버퍼에 누적 (메모리 feedback_qnote_stt_llm_quirks 2번 규칙 준수 — speech_final 만 쓰면 앞부분 drop)
  - `speech_final=true` 또는 `UtteranceEnd` 도착 시 전체를 단일 row 로 commit
  - WS close finally 에서 강제 flush (문장 중간 drop 방지)
- `enrichment_tasks` singleton — utterance_id 당 최신 태스크만 유지
- 조각 중복 정규화 dedup (Deepgram retransmit 방어)
- 화자 다수결 결정 (per-commit)
- 프론트 `QNotePage.tsx`:
  - finalized 이벤트는 즉시 블록 승격 (터미네이터 대기 폐기)
  - 같은 화자 2초 이내 → commitPendingAsBlock 내부 merge
  - buildBlocksFromSession 단순화
- 데드코드 정리: FLICKER_TOLERANCE_SEC, SILENCE_HARD_CAP_SEC, textEndsWithTerminator, ENDS_WITH_TERMINATOR

**Phase 2 — LLM 교정 + Deepgram keyword boosting**
- llm_service.py TRANSLATE_SYSTEM 재설계:
  - "Do NOT change word choice" 삭제
  - "Contextual correction: phonetically similar mis-recognitions → correct term using meeting brief/participants/reference notes" 추가
  - 보수적 교정 (의심스러우면 원본 유지)
- deepgram_service.py:
  - `keywords` 파라미터 추가 + `_resolve_model_for_language()`
  - nova-3 는 `keyterm`, nova-2 이하는 `keywords:2` 자동 분기
- live.py `_extract_keywords()`:
  - 참여자 이름, 영문 대문자 연속 단어, 따옴표 내부 고유명사
  - 상한 50개

**Phase 3 — 한국어 모델 경로**
- `DEEPGRAM_MODEL` 기본 nova-3
- `DEEPGRAM_MODEL_KO` 등 언어별 env 오버라이드 경로

**Phase 4 — 본인 인식 정상화**
- SELF_MATCH_THRESHOLD 0.68 → 0.62 (env override)
- CLUSTER_MERGE_THRESHOLD 0.65 → 0.60
- SpeakerAudioCollector.live_trigger_sec 5.0 → 3.0
- **이중 방어**: `_auto_match_self` 세션당 is_self 1명 가드 (과거 "나만 보임" 버그 방지)
- **경로 분기**: web_conference 모드는 `_auto_match_self` 스킵, 프론트 `/self-voice-sample` 마이크 전용 채널만 사용
- StartMeetingModal Rose 팔레트 미등록 경고 배너

**Phase 6 — capture_mode 영속 + resume 재모달**
- sessions.capture_mode 컬럼 마이그레이션 (default 'microphone')
- routers/sessions.py CreateSessionRequest/UpdateSessionRequest + _validate_capture_mode
- services/qnote.ts QNoteCaptureMode 타입
- QNotePage.openReview DB 값으로 복원 (하드코딩 제거)
- QNotePage.startRecording paused→web_conference 재개 시 "탭 재선택" notice

**이모지 클린업**
- StartMeetingModal "❌" → "불가"

### 검증 결과
- **헬스체크 27/27** (수정 후 재검증 포함)
- **Q Note E2E 30/30** (participants round-trip, capture_mode CRUD, LLM, IDOR, 세션 CUD)
- **실 LLM**:
  - "안녕하세요저는루아입니다오늘회의는큐노트에대해논의하는자리입니다" → "안녕하세요, 저는 루아입니다. 오늘 회의는 큐 노트에 대해 논의하는 자리입니다."
  - Translation: "Hello, I am Lua. Today's meeting is to discuss Q Note."
- **빌드**: tsc 0 error, 151 modules, 537KB, `Cq6XLQAT.js`
- **SPA 라우트**: /notes /profile /talk /tasks /files /billing /dashboard /login 전부 200
- **PM2**: 에러로그 clean

### 수정된 파일

**Q Note 백엔드**
- q-note/services/database.py
- q-note/services/voice_fingerprint.py
- q-note/services/deepgram_service.py
- q-note/services/llm_service.py
- q-note/routers/sessions.py
- q-note/routers/live.py

**프론트엔드**
- dev-frontend/src/services/qnote.ts
- dev-frontend/src/pages/QNote/StartMeetingModal.tsx
- dev-frontend/src/pages/QNote/QNotePage.tsx

### 다음 할 일

**즉시 우선순위**
1. **실라이브 회의 테스트** — 한국어 띄어쓰기, 본인 1명 인식, 참여자 popover 노출, 고유명사 교정 체감 확인
2. **한국어 모델 A/B** — nova-3 vs nova-2-general 30초 녹음 비교 후 `DEEPGRAM_MODEL_KO` 고정
3. **Threshold 튜닝** — self-match 로그 유사도 기반 `QNOTE_SELF_MATCH_THRESHOLD` 재조정

**Phase B — 답변 찾기 API (백엔드)**
- POST /api/sessions/:id/answer
- 직전 5개 발화 컨텍스트 → GPT 쿼리 확장 → FTS5 BM25 top-5 → gpt-4o-mini 답변 + sources[]

**Phase C — 답변 찾기 UI (프론트)**
- 질문 카드 `답변 찾기` 버튼 활성화
- mock → Irene 승인 → 실 API 연결

**나머지**
- WebSocket 재연결
- Deepgram 세션 split (4시간 한계)
- 법적 동의 모달

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
