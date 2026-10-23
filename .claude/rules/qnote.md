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

