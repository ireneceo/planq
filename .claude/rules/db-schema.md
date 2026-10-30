---
paths:
  - "dev-backend/models/**"
  - "dev-backend/scripts/migrate-*"
  - "dev-backend/sync-database.js"
  - "dev-backend/setup-*.js"
  - "docs/DATABASE_ERD.md"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# DB 테이블 목록·스키마 이력

## DB 테이블 (34개)

**기본 (13):** users, businesses, business_members, clients, conversations, conversation_participants, messages, message_attachments, tasks, files, invoices, invoice_items, audit_logs

**Q Talk / 프로젝트 (6):** projects, project_members, project_clients, project_notes, project_issues, task_candidates

**Q Task 워크플로우 (4):** task_comments, task_daily_progress, **task_reviewers**, **task_status_history**

**파일 시스템 (3):** **file_folders**, **business_storage_usage**, **ops_capacity_log**

**Q docs (4):** document_templates, documents, document_revisions, document_shares, posts, post_attachments, post_categories

**Q docs 댓글 (1):** **post_comments** (2026-10-15 — 문서에 시간순으로 쌓이는 댓글. visibility internal(팀만)/shared(고객도 봄). 읽기 = 문서와 같은 `canReadPost`, 고객은 shared 만·쓰면 shared 강제, 공개 링크·PDF·검색엔 안 나간다. 쓰는 문 `post_actions.createComment/deleteComment` 한 곳, 실시간 `post:comment` 신호만, 알림 `doc_comment`(ENUM append)·`comment_mention`, 메일 없음. 운영 `migrate-post-comments.js`(배포 슬롯). 설계 docs/DOC_COMMENTS_DESIGN.md)

**프로젝트 연결 (1):** **project_refs** (2026-10-27 — 문서·파일을 소속 말고 다른 프로젝트에도 «연결». 소속(project_id)은 그대로 공개 범위 열쇠 · 연결은 보여 주는 자리만(원본 목록 술어로 거름) · entity_type 'post'|'file'(문자열, 다음 단계 'task') · 쓰는 문 `services/projectRefs.js` 한 곳 · 운영 `migrate-project-refs.js`(배포 슬롯). 설계 docs/PROJECT_REFS_DESIGN.md)

**Q docs 청구 조건 (1):** **post_billing_terms** (2026-10-23 — 문서당 1행, 서명이 모두 끝나면 이대로 청구서 초안. invoice_id UNIQUE = 만든 청구서. 운영 `migrate-post-billing-terms.js`(배포 슬롯). 설계 docs/CONTRACT_AUTO_INVOICE_DESIGN.md)

**Q docs 서명 (1):** **signature_requests** (2026-04-26 신규 — Phase A 서명 받기, polymorphic entity_type='post'|'document', OTP hash, 만료, audit)

**Q Bill 분할 (1):** **invoice_installments** (2026-04-26 신규 — Phase B 분할 청구, 회차별 status·결제마킹·세금계산서마킹·milestone_ref). **2026-06-13: cash_receipt_no/cash_receipt_at/cash_receipt_marked_by 3컬럼 추가 — 회차별 현금영수증 발급(세금계산서 회차 필드 미러).**

**Q Bill 증빙 정정 (1):** **receipt_corrections** (2026-06-13 신규 — 수정세금계산서·증빙 취소 이력. 원 발행은 invoices/installments에 보존, 정정을 참조 이벤트로 기록. kind(tax/cash)·reason(부가세법 §70 6사유: clerical/amount_change/return/cancel/duplicate/other)·corrected_no·written_at·amount_delta. 유효상태(corrected/amended/canceled/correction_pending)는 receiptsDue에서 파생. 설계 docs/RECEIPT_CORRECTION_DESIGN.md. PlanQ는 홈택스/팝빌 자동발행 X — 외부 발행 후 마킹 추적)

> **Q Bill 청구서 ↔ 출처 연결 (2026-04-27):** `invoices.source_post_id INT FK posts(id)` — 계약/견적/SOW/제안 post 참조 (1:N, 한 출처로 여러 회차 청구 가능). `Invoice.belongsTo(Post, as: 'sourcePost')` association.
>
> **Q Bill 워크스페이스 청구 설정 (2026-04-27):** `businesses.default_due_days INT default 14`, `businesses.default_currency VARCHAR(3) default 'KRW'` — 청구서 발행 모달에서 자동 prefill. PUT `/api/businesses/:id/billing` 으로 인라인 편집 (`/business/settings/billing` 통합 설정).
>
> **Phase D+1 거래 시퀀스 (2026-04-27 신규):** `project_stages` 테이블 — project_id, order_index, kind ('quote'|'proposal'|'contract'|'invoice'|'tax_invoice'|'custom'), label, status ('pending'|'active'|'completed'|'skipped'), linked_entity_type/id, metadata, is_template_seeded. 자동 진행 엔진 (`services/projectStageEngine.js`) 이 entity 상태 기반 멱등 재계산. 4 템플릿 (fixed/subscription/consulting/custom) 자동 시드. GET `/api/projects/:id/transactions` 응답에 stages + next_action 포함.
>
> **Phase E 외화 결제 (2026-04-27 신규):** `businesses.swift_code VARCHAR(20)`, `bank_name_en VARCHAR(200)`, `bank_account_name_en VARCHAR(200)` — 외화 청구서 공개 결제 페이지에 자동 노출. 통화는 청구서별 (KRW/USD/EUR/JPY/CNY 5종), 입금 정보는 단일 (한국+SWIFT/영문 같이). 세금계산서 단계는 한국 사업자(`Client.is_business=true && country='KR'`)만 자동 활성.
>
> **Phase E 메일 (2026-04-27 신규):** `businesses.mail_from_name VARCHAR(100)`, `mail_reply_to VARCHAR(200)` — `"표시이름" <noreply@planq.kr>` 형식 자동. GET/PUT `/api/businesses/:id/mail` (`/business/settings/email`).
>
> **Phase E 알림 매트릭스 (2026-04-27 신규):** `notification_prefs` 테이블 — user × business × event_kind × channel × enabled. event_kind 7종 × channel 3종 = 21 토글. row 없으면 기본 ON (열린 문화), 명시적 OFF row 만 차단. `routes/notifications.isAllowed()` helper 발송 시점 검사.
>
> **Q-H 사이클 — 계정 vs 워크스페이스 프로필 분리 (2026-05-01):**
> - `users` 7 컬럼 추가 — `email_verified_at`, `secondary_email`, `secondary_email_verified_at`, `pending_secondary_email`, `secondary_email_otp_hash`, `secondary_email_otp_expires_at`, `secondary_email_otp_attempts`, `secondary_email_locked_until` (보조 이메일 OTP 인증 흐름)
> - `business_members` 10 컬럼 추가 — `name`, `name_localized` (워크스페이스별 표시명) + Q Note 답변 생성용 8 필드 (`bio`, `expertise`, `organization`, `job_title`, `expertise_level`, `language_levels`, `answer_style_default`, `answer_length_default`). null 이면 User fallback.
> - `clients.display_name_localized` JSON
> - 신규 라우트 12: `GET/PUT /api/businesses/:id/me/profile`, `POST /api/users/:id/email-verify-request`+confirm, `POST /api/users/:id/secondary-email-{verify,change}-{request,verify,confirm}`, `DELETE /api/users/:id/secondary-email`
> - `users.username` 한 번 정해지면 변경 차단 (안전핀, `routes/users.js:128-143`)
>
> **사이클 N+18~N+21 (2026-05-17~18, v1.13.0):**
> - **워크스페이스 통합 주간보고서** — `business_weekly_reports` 신규 (UNIQUE biz+week_start, JSON snapshot v1: kpi/highlights/risks/blockers/issues/next_week/portfolio/heatmap/decisions/team_highlights). 일 23:59 cron 자동 + 수동 박제 (owner/admin). 개인본 `weekly_reviews` 와 독립.
> - **멤버 메뉴 권한 (PERMISSION_MATRIX 4-Layer 중 Layer 3)** — `BusinessMember.role` ENUM `admin` 추가. `business_member_permissions` 신규 (UNIQUE biz+user+menu_key, level ENUM none/read/write). 11 메뉴 (qtalk/qmail/qtask/qcalendar/qnote/qdocs/qinfo/qfile/qbill/clients/insights) × 3 레벨. 기본값 write (열린 문화) — row 없음 = 전권. `middleware/menu_permission.js requireMenu(menu,level)`. insights READ_ONLY (write 입력 시 read 코어스). admin = owner_only 외 자동 전권.
> - **청구 담당 통합** — `businesses.default_billing_owner_id`. Invoice 발행 owner_user_id selector 는 Q Bill write 권한자만 (owner/admin 자동 포함). PERMISSION_MATRIX §5.10 + §5.11 정렬.
> - **TaskEstimation.business_id 컬럼 추가** — 워크스페이스별 시간 예측 패턴 학습. `callAiEstimate(title,desc,businessId)` 가 같은 워크스페이스 최근 12 사용자 추정 few-shot 사용 (같은 task 제목이어도 워크스페이스마다 다르게 추정).
> - **상태 히스토리 박제** — `project_status_history` + `invoice_status_history` 신규. 상태 전이 시 자동 row insert (changed_by 포함). AuditLog 와 별개 (전용 history).
> - **AuditLog 누락 5 영역 채움** — business_members invite/remove · cloud.disconnect · file.delete · clients.* (이미 호출 중)
> - **사용량 시각화** — `/api/plan/:id/status.cue_actions_by_type` JSON breakdown. PlanSettings #usage 에 기능별 누적 막대 (brief/docs_generate/kb_embed 등). UsageWarningCard 초과 시 Primary CTA "지금 업그레이드" (Danger red). PostAiModal cue 잔여 hint + 임박 시 확인 모달.
> - **Q Note 토큰 예상 endpoint** — `POST /api/plan/:id/qnote/estimate { file_size_bytes }` → `{ estimated_minutes, current_minutes, limit_minutes, will_exceed }`. 향후 음성 업로드 STT 기능에 즉시 적용.
> - **요청 탭 책임선 분리** — `tab='requested'` 시 예측시간/AI UI 숨김 + 백엔드 POST 라우트 sanitize (담당자 ≠ 작성자면 NULL 강제). PERMISSION_MATRIX §5.7 일관.
>   ★ **반복은 예외다(2026-10-12)** — Irene *"왜 내가 담당자가 아니면 반복하기 기능을 못 써? 쓸 수 있어야 해"*. 반복 주기는 의뢰 명세(작성자 영역, FIELD_RULES 와 같은 축)라 남에게 요청하는 업무에도 추가 폼에 칸을 내고 서버도 살린다(`task_actions.createTask`). 옛 sanitize 는 담당자도 FIELD_RULES 상 못 고쳐 «아무도 못 정하는» 상태였다.
> - **디자인 시스템** — `components/Common/ActionButton.tsx` (3톤 × sm 36/md 40/lg 44 + Spinner + focus ring) + `DrawerFooter.tsx` (sticky bottom + safe-area + 좌/우 슬롯). TaskDetailDrawer Action* alias 마이그레이션 (사용처 17곳 무변경).
> - **개인 보관함 정책 재정의** — Drive 연동과 무관, 항상 자체 스토리지. 워크스페이스 공용 quota 안 합산. 개인별 quota 분리 X. 설정 페이지 "파일 저장소" → **"파일·외부 연동"** (캘린더 포함 의도).
> - **GDrive reconnect 옛 폴더 재사용** — drive.file scope 안에서 같은 이름 폴더 search → 가장 오래된 createdTime 재사용. 중복 폴더 자동 차단.

**기타 (2):** kb_chunks, kb_documents, kb_pinned_faqs, cue_usage

> **2026-10-30 — `email_messages.signature_read` JSON NULL** — 메일 서명 AI 읽기 결과 `{ values, found }`(Q sale 고객 추가 창, `routes/sale_contacts.js` 한 곳). 같은 마이그레이션 스크립트.
> **2026-10-30 — `email_messages.translations` JSON NULL** — 메일 본문 번역 저장 `{ <lang>: { text, detected_language, at } }`. 읽고 쓰는 곳은 `services/mailTranslate` 하나(JSON_SET 으로 그 언어만). 운영 `migrate-mail-translations.js`(배포 슬롯, PM2 reload 전).
>   ★ attributes 로 고른 `created_at` 은 인스턴스 속성으로 안 붙는다(`m.created_at === undefined`, `m.get('created_at')` 은 값) — 비교에 쓰면 «언제나 옛것» 으로 거짓 판정(메일 요약 재사용 대조군이 잡음).

> **운영 라이브 풀세트 (2026-05-05):**
> - `users` 6 컬럼 추가 — `password_reset_token`, `password_reset_expires`, `email_verify_token`, `email_verify_expires`, `terms_accepted_at`, `terms_version`, `privacy_accepted_at`, `privacy_version` (비밀번호 재설정 / signup 이메일 인증 / 약관 동의 시점·버전)
> - `platform_settings` 7 컬럼 추가 — `terms_version`, `privacy_version` (현재 약관 버전 — 사용자가 다른 버전이면 재동의 모달), `maintenance_mode` BOOLEAN, `maintenance_message`, `announcement_text`, `announcement_dismissible`, `announcement_severity` ENUM('info','warn','critical')
> - `kb_documents` 5 컬럼 추가 — `source_language` ENUM('ko','en'), `auto_translate` BOOLEAN, `translation_visibility` ENUM('translate','show_original','hide_other'), `translations` JSON, `parent_doc_id` (다중 포스트 분리)
> - `contact_inquiries.from_user_timezone` (admin 페이지 양쪽 시간 동시 표시)
> - `notification_prefs.event_kind` ENUM 6종 추가 — `signup`, `payment`, `subscription`, `trial`, `feedback`, `inquiry` (총 13종, business_id NULL = platform-wide)
> - `payments` 7 컬럼 추가 (Q-R) — `kind` ENUM('plan','addon'), `addon_code`, `addon_quantity`, `tax_invoice_requested`, `tax_invoice_status`, `tax_invoice_data` JSON, `tax_invoice_issued_at`
> - `services/platformNotify.js` 헬퍼 — platform_admin role 사용자 fan-out 발송 (notification_prefs business_id NULL 검사)
> - `middleware/maintenance.js` — 점검 모드 미들웨어 (platform_admin 통과 + ALLOW_PATHS)
> - `services/shareTokenCleanup.js` — Post/Document/Invoice share_token 30일 비사용 NULL cron
> - 운영자 도구 라우트: `POST /admin/users/:id/impersonate` (30분 토큰 + AuditLog 강제), `GET /admin/audit-logs` (필터), `GET /admin/users/:id/data-export` (GDPR JSON)
> - 인증 라우트: `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email-confirm`, `POST /auth/resend-verify-email`
> - emailService 신규 표준 함수 — `sendPasswordResetEmail`, `sendSignupVerifyEmail`, `sendInquiryReceivedEmail`, `sendBillingInstructionEmail` (모두 emailWrap layout 통일)
> - placeholder 가드 — `<예: 토스뱅크>` 같은 .env example 복사 사고 차단 (`getPlanqBankInfo()` 헬퍼)
> - `Sequelize.Model.prototype.toJSON` 글로벌 override — `createdAt → created_at` 자동 매핑 (Invalid Date 근본 fix)

---

