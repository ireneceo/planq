---
paths:
  - "dev-backend/routes/org.js"
  - "dev-backend/routes/feedback.js"
  - "dev-backend/routes/inquiries.js"
  - "dev-backend/services/feedback*"
  - "dev-backend/scripts/*feedback*"
  - "dev-frontend/src/pages/MyFeedback/**"
  - "dev-frontend/src/pages/Admin/**"
  - "dev-frontend/src/pages/Settings/OrgPage.tsx"
  - ".claude/commands/개발시작.md"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 조직(팀장)·문의·피드백 승인

**조직·문의 (2026-09-21 컬럼 추가):** `teams.lead_user_id`(팀장 — 부서의 `lead_user_id` 와 같은 계약: 지정하면 그 멤버가
그 팀과 팀의 부서로 옮겨진다, `routes/org.js resolveLead`·`placeLead*` 한 벌, 이 워크스페이스 멤버만) ·
`feedback_items.kind` ENUM('feedback','inquiry')(로그인 사용자의 «문의» 도 이 원장 — 개인 > 문의·피드백에서 답을 본다.
손님 문의만 `contact_inquiries` 이메일 창구). 둘 다 멱등 스크립트(`migrate-team-lead`·`migrate-feedback-kind`), 롤백은 코드만.
- **피드백·문의는 플랫폼관리자 승인을 거쳐야 개발에 들어간다** (2026-10-22, Irene *"검토중을 무조건 거쳐야 해 … 진행대기 단계"* · Fable 설계) —
  접수(pending) → 검토중(reviewing) → **진행대기(queued, 승인)** → 반영중(in_progress) → 완료/보류. 승인 정본 = `approved_at IS NOT NULL`.
  전이는 `services/feedbackStatus` 한 곳(관리자 화면·`feedback-reply.js`·배포 닫기 `close-deployed-feedback.js`). 플랫폼관리자 최상위 제출만 즉시 진행대기.
  상황판 «문의 가져오기» 는 개발시작.md 1-B 조회(대기열은 진행대기만 · 칸에는 열린 건 전부)를 읽는다. 운영 `migrate-feedback-approval.js`(배포 슬롯). 설계 `docs/FEEDBACK_APPROVAL_DESIGN.md`.
- **접수되면 AI 가 원인·고칠 방법만 조사해 관리자 상세에 붙인다** (2026-10-29, Irene «권고대로» · Fable 설계 `docs/FEEDBACK_AI_TRIAGE_DESIGN.md`) —
  `feedback_items.ai_triage`(JSON)·`ai_triage_verdict`·`ai_triage_at`(«조사됨» 정본). 조사는 개발 착수가 아니다 — 승인 규칙(진행대기만 개발) 그대로.
  쓰는 문은 `scripts/feedback-triage.js` 하나(검증 정본 `services/feedbackTriage`, 조사 칸만 · 알림 0 · 감사 `feedback.triage`) — Irene 10-29 지시 = **이 칸에 한한 운영 쓰기 상시 승인**.
  일으키는 것은 상황판(서버 방, `projects.json feedbackTriage` → 개발시작.md 1-D 정찰 지시문). `kind='feedback'` 최상위만.
  ★ 관리자 전용 — 보고자 `/mine` 은 **남길 칸 목록(MINE_FIELDS)** 이고 계정 내보내기(data-export)도 뺀다. 회귀 health-check secrets «피드백 AI 조사 칸». 화면은 텍스트로만 그린다.
- **관리자 답변 AI 초안 — 저장·알림·발송 없음** (2026-10-29, Irene «피드백이랑 문의 다») — 서비스 `services/adminReplyDraft` 한 벌(한도 `admin-reply-draft` 분 5·일 100 공유, LLM 용도 `admin_reply`, 비용 플랫폼 몫).
  `POST /api/feedback/:id/ai-draft`(근거 = 같은 스레드 앞 대화 + 위키 + 피드백 AI 조사 요약) · `POST /api/inquiries/admin/:id/ai-draft`(손님 문의, 언어 = `locale`).
  화면은 칸을 채우기만 한다(`pages/Admin/AdminReplyDraftButton`) — 피드백은 [답글 저장]·단계 버튼, 손님 문의는 «회신 초안» 칸(내부 노트와 별개, 초안 kind `admin-inquiry-reply` 범위 `'platform'`)을 [메일로 회신] 이 본문으로 싣는다.
  근거에 없는 사실은 있다·없다 단정 금지(실측: «무료 체험 없음» 이라고 지어냈다 → 프롬프트로 막음). 자동 답변·PlanQ 직접 발송은 새 외부 발송 경로라 별도 설계(Fable).
- **접수 확인(고정 문구)만 자동 — AI 답 자동 발송은 만들지 않는다** (2026-11-15, Irene «문의랑 피드백을 고객에게 자동으로 먼저 답변» · PurpleHere 같은 글 «권고대로» ① · Fable 설계 `docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md`) —
  `services/feedbackAck.sendFeedbackAck` 한 곳(POST /api/feedback 의 setImmediate). 기존 `notify()` 한 번(eventKind feedback — 종 알림 + 그 사람 설정대로 메일·푸시) · 문구 ko/en 고정 · 원문 인용 없음.
  안 보냄: 후속 글 · 플랫폼관리자 제출 · 이미 보냄(`feedback_items.ack_sent_at`, 조건부 UPDATE 로 먼저 잡고 안 나가면 되돌림) · 같은 사람 24시간 5건 넘음.
  `admin_response`·`responded_*`·`reply_seen_at`·상태·감사는 건드리지 않는다(respondToFeedback 을 거치지 않는다) · `ack_sent_at` 은 MINE_FIELDS 밖. 운영 `migrate-feedback-ack.js`(배포 슬롯). 회귀 health-check external «접수 확인».
  2단계(상황판에서 초안 눌러 보내기)는 상황판 보내기 버튼 계약이 생긴 뒤 별도 설계 1회 + 검증 1회.
- **상황판 «들어온 문의» 칸 = 열린 건 전부** (2026-11-15, 같은 설계 §2) — 개발시작.md 1-B ② · 조회 `scripts/feedback-board.sql`(개인정보 칸 없음) → `scripts/feedback-board.js --build/--post/--fail` · 판정 `services/feedbackBoard`(needsIrene 은 방이 못 고친다) · 시험 `scripts/feedback-board.selftest.js`. 보여 주기만 — 개발 대상 규칙(진행대기만)은 그대로.
