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
  화면은 칸을 채우기만 한다(`pages/Admin/AdminReplyDraftButton`) — 피드백은 [답글 저장]·단계 버튼, 손님 문의는 «회신» 칸(내부 노트와 별개, 초안 kind `admin-inquiry-reply` 범위 `'platform'`)을 [PlanQ 에서 보내기] 가 보낸다(아래 «문의 직접 회신»).
  근거에 없는 사실은 있다·없다 단정 금지(실측: «무료 체험 없음» 이라고 지어냈다 → 프롬프트로 막음). 자동 답변·PlanQ 직접 발송은 새 외부 발송 경로라 별도 설계(Fable).
- **접수 확인(고정 문구)만 자동 — AI 답 자동 발송은 만들지 않는다** (2026-11-15, Irene «문의랑 피드백을 고객에게 자동으로 먼저 답변» · PurpleHere 같은 글 «권고대로» ① · Fable 설계 `docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md`) —
  `services/feedbackAck.sendFeedbackAck` 한 곳(POST /api/feedback 의 setImmediate). 기존 `notify()` 한 번(eventKind feedback — 종 알림 + 그 사람 설정대로 메일·푸시) · 문구 ko/en 고정 · 원문 인용 없음.
  안 보냄: 후속 글 · 플랫폼관리자 제출 · 이미 보냄(`feedback_items.ack_sent_at`, 조건부 UPDATE 로 먼저 잡고 안 나가면 되돌림) · 같은 사람 24시간 5건 넘음.
  `admin_response`·`responded_*`·`reply_seen_at`·상태·감사는 건드리지 않는다(respondToFeedback 을 거치지 않는다) · `ack_sent_at` 은 MINE_FIELDS 밖. 운영 `migrate-feedback-ack.js`(배포 슬롯). 회귀 health-check external «접수 확인».
  2단계(상황판에서 초안 눌러 보내기)는 상황판 보내기 버튼 계약이 생긴 뒤 별도 설계 1회 + 검증 1회.
- **상황판 «들어온 문의» 칸 = 열린 건 전부** (2026-11-15, 같은 설계 §2) — 개발시작.md 1-B ② · 조회 `scripts/feedback-board.sql`(개인정보 칸 없음) → `scripts/feedback-board.js --build/--post/--fail` · 판정 `services/feedbackBoard`(needsIrene 은 방이 못 고친다) · 시험 `scripts/feedback-board.selftest.js`. 보여 주기만 — 개발 대상 규칙(진행대기만)은 그대로.
- **손님 문의 직접 회신 — PlanQ 가 보내고 문의에 남긴다** (2026-11-15, Irene «개발에 제대로 되게 할거야» · Fable 설계 FIX 반영 → 완료 3차 PASS · `docs/INQUIRY_DIRECT_REPLY_DESIGN.md`) —
  표 `contact_inquiry_replies`(문의당 여러 줄 · sending/sent/failed/skipped) · 쓰는 문 `services/inquiryReply.sendInquiryReply` 하나(`POST /api/inquiries/admin/:id/replies`, 관리자당 분 5·일 50 · 문의당 하루 10통 · 같은 본문 60초 409 · 스팸 409).
  문의 행 FOR UPDATE 안에서 검사 + `sending` 행 → 커밋 → 발송은 밖. 받는 주소는 문의 행 `from_email` 고정(화면이 못 바꾼다) · 5분 넘은 sending = «결과 확인 안 됨»(실패로 보이면 두 통 나간다).
  `replied_at` 은 내부 노트 저장 칸이라 건드리지 않는다 — 목록 «회신 n» 은 이 표(sent)에서. 성공이면 new→in_progress 만 조건부.
  메일은 `emailService.sendInquiryReplyEmail` — 사람이 쓴 답이라 자동발송 헤더 셋을 빼는 길(`deliverEmail` 내부 인자)은 **이 함수만** 쓴다(공용 `sendEmail` 은 bool·헤더 그대로) · Reply-To = 플랫폼 문의 주소 · 본문·인용 escape.
  화면은 보내기 전 ConfirmDialog(이름·주소) · 보낸 뒤 상세 유지·초안 비움 · 실패면 이유와 글 유지. 운영 `migrate-inquiry-replies.js`(배포 슬롯).
