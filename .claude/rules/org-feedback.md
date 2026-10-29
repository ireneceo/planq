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
  상황판 «문의 가져오기» 는 개발시작.md 1-B 조회(진행대기만)를 읽는다. 운영 `migrate-feedback-approval.js`(배포 슬롯). 설계 `docs/FEEDBACK_APPROVAL_DESIGN.md`.
- **접수되면 AI 가 원인·고칠 방법만 조사해 관리자 상세에 붙인다** (2026-10-29, Irene «권고대로» · Fable 설계 `docs/FEEDBACK_AI_TRIAGE_DESIGN.md`) —
  `feedback_items.ai_triage`(JSON)·`ai_triage_verdict`·`ai_triage_at`(«조사됨» 정본). 조사는 개발 착수가 아니다 — 승인 규칙(진행대기만 개발) 그대로.
  쓰는 문은 `scripts/feedback-triage.js` 하나(검증 정본 `services/feedbackTriage`, 조사 칸만 · 알림 0 · 감사 `feedback.triage`) — Irene 10-29 지시 = **이 칸에 한한 운영 쓰기 상시 승인**.
  일으키는 것은 상황판(서버 방, `projects.json feedbackTriage` → 개발시작.md 1-D 정찰 지시문). `kind='feedback'` 최상위만.
  ★ 관리자 전용 — 보고자 `/mine` 은 **남길 칸 목록(MINE_FIELDS)** 이고 계정 내보내기(data-export)도 뺀다. 회귀 health-check secrets «피드백 AI 조사 칸». 화면은 텍스트로만 그린다.
- **관리자 답변 AI 초안 — 저장·알림·발송 없음** (2026-10-29, Irene «피드백이랑 문의 다») — 서비스 `services/adminReplyDraft` 한 벌(한도 `admin-reply-draft` 분 5·일 100 공유, LLM 용도 `admin_reply`, 비용 플랫폼 몫).
  `POST /api/feedback/:id/ai-draft`(근거 = 같은 스레드 앞 대화 + 위키 + 피드백 AI 조사 요약) · `POST /api/inquiries/admin/:id/ai-draft`(손님 문의, 언어 = `locale`).
  화면은 칸을 채우기만 한다(`pages/Admin/AdminReplyDraftButton`) — 피드백은 [답글 저장]·단계 버튼, 손님 문의는 «회신 초안» 칸(내부 노트와 별개, 초안 kind `admin-inquiry-reply` 범위 `'platform'`)을 [메일로 회신] 이 본문으로 싣는다.
  근거에 없는 사실은 있다·없다 단정 금지(실측: «무료 체험 없음» 이라고 지어냈다 → 프롬프트로 막음). 자동 답변·PlanQ 직접 발송은 새 외부 발송 경로라 별도 설계(Fable).
