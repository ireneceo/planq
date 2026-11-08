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
