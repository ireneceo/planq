---
paths:
  - "q-note/**"
  - "dev-frontend/src/pages/QNote/**"
  - "dev-frontend/src/components/QNote/**"
  - "dev-backend/routes/qnote_bridge.js"
  - "dev-backend/routes/internal.js"
  - "dev-backend/services/qnote*"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q Note — STT 과금·사적 공간

**Q Note STT 과금 (2026-07-03 신규):** `qnote_usage` (월 rollup — `seconds_used` source of truth, `minutes_used`=FLOOR(초/60) 표시용), **`qnote_usage_events`** (멱등 원장 — UNIQUE(stream_id, segment_seq). stream_id=WS 연결마다 UUID → 재연결 quota 우회 차단. session_id는 q-note SQLite 소재라 FK 없음). q-note `live.py`가 5분마다 `POST /api/internal/qnote/usage`로 billed 초(stereo ×2) 기록, 트랜잭션 멱등 insert + `FOR UPDATE` rollup(정확히 한 번). 진입 hard-block: `/ws/live` accept 후 Deepgram 연결 前 internal `qnote/can`(4030) + `business-membership`(4031). 설계 docs/QNOTE_STT_BILLING_DESIGN.md

> **Q Note 진짜 사적 공간 (코드 정합):** `q-note/routers/sessions.py` 의 모든 라우트가 `_load_session_or_403(db, session_id, user['user_id'])` 강제. 기본(L1)은 본인 세션 외 무조건 403 — owner 도 admin 도 백도어 없음. **생성자가 개방한 범위만** 열린다(L2 같은 프로젝트 멤버 · L3/L4 같은 워크스페이스 멤버 — 둘 다 Node internal API 로 **지금** 멤버인지 확인, 실패=거부, 고객 제외). ★ 2026-09-11 전까지 L3/L4 는 토큰에 없는 `businessId` 클레임과 비교해 **한 번도 열리지 않았다**. PERMISSION_MATRIX §5.8 박제. memory `feedback_qnote_personal_tool.md` 와 일치.


**새 노트 메뉴·회의 설정 창 (2026-11-08 · Irene «권고대로» · Fable 설계 DESIGN-FIX → 완성 PASS):** 녹음 방식은 **+ 메뉴에서 정한다** — 온라인 회의(`voice_online`=web_conference) · 대면 회의(`voice_offline`=microphone) · 바로 녹음(quick). 메뉴 목록·순서는 `components/QNote/newNoteMenu.tsx` 한 곳(Q note·Q sale·일정 공용), 온라인 가능 판정은 `webConferenceCapability.isAvailable()` 하나(데스크탑 앱·폰·화면 공유 없는 브라우저 = 비활성+이유). 옛 `?new=voice` 는 `resolveVoiceKind`.
설정 창(`StartMeetingModal`)은 녹음 방식 줄 + 필수(제목·목적·언어) + «더 정확하게» 접힌 카드(`startMeetingCards.tsx` — 여러 장 동시 열림·요약은 실제 값). 메뉴의 `presetCaptureMode` 가 초안의 captureMode 를 이긴다. **편집 때 녹음 방식은 잠금** — `handleSaveSessionEdit` 이 capture_mode 를 보내지 않고, 녹음 뒤 바꾸면 화자 구분이 섞인다. 새 칸은 «캡처 방식» 같은 맨 아래 칸으로 되살리지 말고 카드로. 회귀 `--suite qnotenewnote`(3폭 · 양성 대조군 getDisplayMedia 제거).

**질문 AI 정리 (2026-11-11 · Irene «질문 맥락에 맞게 보완·수정» · Fable 설계 DESIGN-FIX → 완료 2차 PASS · 기록 `docs/FABLE_GATE_QUEUE.md`):** 녹취(`utterances.original_text`)는 **들린 그대로**, 질문 답 찾기만 정리문으로 한다. 정리는 따로 부르지 않고 정제 호출(`translate_and_detect_question`)의 `core_question`/`clarity` 두 필드 → 기계 가드 `guard_core_question`(길이 ≤1.2× · 원문·최근 6발화·용어집에 없는 숫자/영문 고유어 = unclear · 짧음+지시어 = unclear, 단 풀린 ok 는 살림).
`detected_questions` 는 **발화당 1행**(UNIQUE session_id+utterance_id — 새 INSERT 는 UPSERT/OR IGNORE) · `question_interpreted`(정리문) · `question_edited`(사용자가 고친 문장, 되돌리기 `POST …/utterances/:uid/question-reset`) · `interpret_status` ok/unclear/same · `answer_basis` raw/interpreted/edited — **raw 답은 interpreted·edited 답을 덮지 않는다**(늦게 끝난 쪽이 이기던 경합). 답 찾기 시작은 정제 끝(p50 ≈1.6s) · 2.5초 안에 안 끝나면 원문 안전망.
**등록 Q&A 제목을 정리 힌트로 넣지 않는다**(등록 질문 쪽으로 끌려가 «확신 있게 틀린» 답). 대신 등록 답(priority·custom)은 정리문으로 못 찾으면 들린 그대로로 한 번 더(`heard_text`) — 서두에 주제어가 있다. **정리 절은 is_question 을 바꾸지 않는다** — 프롬프트에 dev 실데이터 문장을 예시로 넣었더니 그 문장의 질문 판정이 뒤집혔다. 정리 프롬프트를 고치면 80발화 옛·새 ×3 흔들림(잡음+1 이내)과 등록 답 재생 비교(priority 나빠짐 0)를 다시 잰다.
불완전(unclear + 영 3단어/한 2어절 이하) = 카드는 남기고 자동 답만 보류(카드 거부권 없음). 짧은 지시어 후속 질문(«Is it ready?»)은 nano 가 못 풀어 이 칸으로 간다 — «직전 발화 붙여 찾기» 는 별도 설계 대상.
