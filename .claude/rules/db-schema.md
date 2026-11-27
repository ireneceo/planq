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

**프로젝트 연결 (1):** **project_refs** (2026-10-27 — 문서·파일을 소속 말고 다른 프로젝트에도 «연결». 소속(project_id)은 그대로 공개 범위 열쇠 · 연결은 보여 주는 자리만(원본 목록 술어로 거름) · entity_type 'post'|'file'|'kb'(문자열 — kb = Q info 2026-11-10, 다음 단계 'task') · 쓰는 문 `services/projectRefs.js` 한 곳 · 운영 `migrate-project-refs.js`(배포 슬롯). 설계 docs/PROJECT_REFS_DESIGN.md)

**Q docs 청구 조건 (1):** **post_billing_terms** (2026-10-23 — 문서당 1행, 서명이 모두 끝나면 이대로 청구서 초안. invoice_id UNIQUE = 만든 청구서. 운영 `migrate-post-billing-terms.js`(배포 슬롯). 설계 docs/CONTRACT_AUTO_INVOICE_DESIGN.md)

**Q docs 서명 (1):** **signature_requests** (2026-04-26 신규 — Phase A 서명 받기, polymorphic entity_type='post'|'document', OTP hash, 만료, audit)

**Q Bill 분할 (1):** **invoice_installments** (2026-04-26 신규 — Phase B 분할 청구, 회차별 status·결제마킹·세금계산서마킹·milestone_ref). **2026-06-13: cash_receipt_no/cash_receipt_at/cash_receipt_marked_by 3컬럼 추가 — 회차별 현금영수증 발급(세금계산서 회차 필드 미러).**

**Q Bill 첨부 (1):** **invoice_attachments** (2026-11-25 신규 — 청구서 첨부 파일·문서. file_id XOR post_id 가리키기만(CASCADE) · client_visible 기본 0 · 청구서당 20개 · UNIQUE(invoice_id,file_id)/(invoice_id,post_id). 판정 `services/invoiceAttachments` 한 곳 · 설계 `docs/INVOICE_ATTACHMENTS_DESIGN.md`).

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

> **2026-11-27 — `files.source_key` VARCHAR(100) NULL + 색인 (business_id, source_key)** — 서버가 만든 사본의 출처 열쇠. 지금 쓰는 곳은 서명 완료 문서 «파일로 저장» 하나(`signed-post:<post_id>:<회차 지문 16자>` — 같은 회차를 다시 누르면 살아 있는 행을 돌려준다 · 유니크 아님 · 휴지통 뒤 다시 저장 가능). 열쇠·판정은 `services/signedPdfSave` 한 곳 · 쓰는 문은 `driveImport.ingestDownloadedFile` opts.sourceKey · Drive 고침은 이 사본을 덮지 않는다(`gdriveMirrorSync.isEvidenceBound`). 운영 `migrate-file-source-key.js`(배포 슬롯 · PM2 reload 전).
> **2026-11-24 — `conversations.project_auto_join` TINYINT(1) NOT NULL DEFAULT 0** — 프로젝트 방 «프로젝트 멤버 자동 참여»(1 = 프로젝트 멤버가 되는 순간·켜는 순간 이 방에 들어온다). 프로젝트 없는 방은 늘 0 · 고객방 기본 0 · 고객 응답엔 안 싣는다. 넣는 문 `services/project_channel` 한 곳 · 켜기/끄기 `PUT /api/conversations/:biz/:id/auto-join`. 운영 `migrate-project-auto-join.js --apply`(배포 슬롯 · 코드보다 먼저 · 한 번만 백필, 표시 audit_logs). 설계 docs/PROJECT_ROOM_MEMBERSHIP_DESIGN.md.
> **2026-11-24 — `business_members.attendance_tracked` TINYINT(1) NOT NULL DEFAULT 1 · `attendance_tracked_since` DATE NULL** — 멤버별 «출퇴근 안 함»(Irene «출퇴근 안하는 그냥 일만 봐주거나 연결되어 있는 경우»). 0 = 그 워크스페이스에서만 출근·휴게 시작 403 · 자동 출근·자정 분할·출근 묻기·활동 흔적 없음 · 위젯 숨김 · 동료 점 대신 tracked:false · 지각/미출근 판정 제외(휴가·지난 기록 그대로). 바로 적용(이력 없음) · 다시 켠 날 = since(판정은 다음 날부터). 읽기·쓰기 `services/attendanceTracking` 한 곳 · 바꾸기 `PUT /api/attendance/members/:userId/tracking`(대표·관리자, 자기 것은 대표만 · 끄면 열린 하루를 측정 안 끊고 닫음). 운영 `migrate-attendance-tracked.js`(배포 슬롯). 설계 docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md.
> **2026-11-24 — `attendance_schedules` · `attendance_exceptions` 표** — 근태 고정 근무 일정·지각 관리. 일정은 «적용 시작일» 이력(user_id NULL = 워크스페이스 기본 · 값 = 사람별 inherit/flex/fixed · schedule JSON 은 work_hours 와 같은 모양이지만 **다른 뜻**(예약 시간과 섞지 않는다) · 저장은 내일 이후만 · 쓰는 문 `services/attendanceSchedule.save` 한 곳(user_id NULL unique 를 잠금으로)). 행 없음 = 유연 = 종전 그대로. 지각·조퇴·미출근은 **저장하지 않고 조회 때** `services/attendancePunctuality.judgeDays` 한 벌(미출근은 계속 «행 없음») · 사유/인정은 사람이 남길 때만 `attendance_exceptions` 하루 한 행. 판정은 본인·관리자 응답에만(소켓 방송에 싣지 않는다). 운영 `migrate-attendance-fixed-schedule.js`(배포 슬롯). 설계 docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md.
> **2026-11-20 — `attendance_fix_requests` · `attendance_activity` 표 + `attendance_days.close_confirmed_at` · `businesses.attendance_fix_approval` · `users.attendance_prompt_on`** — 근태 «출근하셨어요?» 묻기·본인 수정 표시·관리자 확인/승인. 요청(origin prompt_in/prompt_out/manual · status 문자열 applied/pending/confirmed/approved/rejected/withdrawn · before 스냅샷 · events) 쓰는 문 `services/attendanceFix` 한 곳(하루를 바꾸는 길은 계속 applyAdminFix) · 활동(그날 첫 진입·마지막 활동·묻기 답, **본인 전용** — 팀·통계·presence 응답에 없음, 90일 정리) `services/attendancePrompt` · 활동 기록은 `middleware/attendanceTouch` 목록(사람이 직접 한 쓰기, 성공 때만). 승인 설정 기본 끔 = #392 그대로. 운영 `migrate-attendance-checkin.js`(배포 슬롯). 설계 docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md.
> **2026-11-19 — `task_output_kinds` · `task_output_kind_links` 표 + `task_template_items.output_names` JSON** — 업무 «산출물»(만들어야 하는 것의 종류). 사전(UNIQUE biz+name · UNIQUE biz+preset_key, `preset_key` NULL = 직접 입력) + M:N 연결(CASCADE). 기본 목록 22개는 **코드**(`services/taskOutputKindPresets.js`) — 고를 때 행이 생긴다(백필 없음). 코드 이름 `output_kind`(결과물 `deliverable` 과 섞지 않음). 읽고 쓰는 곳 `services/taskOutputKinds` · 바꾸기 `services/actions/task_output_actions` · 라우트 `routes/task_output_kinds.js`. 상세에만 싣는다(고객에게도 보임 · 목록·공개 링크·게스트엔 없음). 운영 `migrate-task-output-kinds.js`(배포 슬롯). 회귀 `dev-backend/scripts/check-task-output-kinds.js`. 설계 docs/TASK_DELIVERABLES_DESIGN.md.
> **2026-11-18 — `files.deleted_via` VARCHAR(20) NULL · `files.drive_sync_issue` VARCHAR(40) NULL** — Drive(파인더) 지우기·고치기 반영. deleted_via: NULL=PlanQ · `gdrive`=Drive 에서 지움 · `gdrive_edit`=Drive 고침 전 «이전 판» 휴지통 행(복구가 NULL 로). drive_sync_issue: 반영 못 한 이유(edit_too_large·edit_quota·edit_ext·edit_download_failed·edit_not_applied·trash_held). 쓰는 곳 `services/gdriveMirrorSync` 한 곳. 운영 `migrate-file-drive-sync.js`(배포 슬롯). 설계 docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md.
> **2026-11-16 — `businesses.team_conversation_id` INT NULL** — 워크스페이스 «전체» 대화방(멤버 전원 · 공지). 공지 = 그 방 text 메시지 + `meta.announcement={title}` + 자동 핀(새 표 없음). 참여자 = 활성 멤버(owner·admin·member) — 맞추는 문 `services/team_channel.syncTeamMembers` 한 곳(가입 afterPromote · 내보내기 · 열 때·공지 때). 방은 처음 열 때 만든다(백필 없음). 나가기·내보내기·참여자 추가·보관·삭제·Cue 켜기 409 `team_channel_locked`. 공지 = 대표·관리자, 알림은 방 알림 꺼도 감(ignoreMute). API `/api/team-channel/:biz`. 운영 `migrate-team-channel.js`(배포 슬롯). Fable 설계 B + 완료 검증 PASS.
> **2026-11-13 — `email_thread_participants.marked_unread` TINYINT(1) NOT NULL DEFAULT 0** — Q mail «안 읽음으로 표시»(나만). 판정·쓰기는 `services/mailRead` 한 곳(가드 mailread). 운영 `migrate-mail-mark-unread.js`(배포 슬롯 · 코드보다 먼저). 설계 `docs/QMAIL_MARK_UNREAD_DESIGN.md`.
> **2026-11-13 — `conversation_participants.muted_at` DATETIME NULL** — Q talk 대화방 알림 끄기(사람별, NULL = 켜짐). 참여자 아닌 대표·관리자는 «보는 중» 행에 담는다(핀과 같다). 보통 메시지 알림만 막고 @멘션·담당 배정은 통과 — 판정은 `routes/notifications.js notify()` 한 곳. 안읽음 합계 3곳(`/me/unread-total-all`·`/:biz/unread-total` total·`chatBadge`)에서 뺀다. 운영 `migrate-conv-mute.js`(배포 슬롯). 설계 `docs/QTALK_MUTE_DESIGN.md`.
> **2026-11-12 — `conversation_care` 표** — Q talk 고객 문의 «응대 상태(open/hold/resolved) · 담당자 한 명», 방당 0~1행(PK conversation_id, FK cascade). `conversations` 에 칸을 더하지 않는다(통째 toJSON 이 고객에게 샌다). 읽고 쓰는 곳은 `services/convCare` 하나 · 직원 응답에만 `care` · 실시간 `conversation:care` 는 emitConvWide. 운영 `migrate-conversation-care.js`(배포 슬롯 · 한 번 백필). 설계 `docs/QTALK_CARE_DESIGN.md`.
> **2026-11-06 — `workspace_join_requests` 표 + `businesses.join_by_domain·join_domain·join_code(UNIQUE)·join_code_rotated_at`** — 워크스페이스 참여 신청(사람×워크스페이스 한 행 · pending/approved/rejected/canceled · 만료는 읽을 때 `services/joinRequests.isLive`). 열림 판정 `services/joinPolicy.domainJoinOpen` 한 곳(대표의 인증된 회사 메일 도메인과 다시 맞춘다). `join_code` 는 응답 비밀값(models/index SECRET_HASH_KEYS — `GET …/join-settings` 만). 운영 `migrate-join-requests.js`(배포 슬롯). 설계 `docs/SIGNUP_START_JOIN_DESIGN.md`.
> **2026-11-06 — `business_members.invited_role` ENUM(member,admin) NULL** — 멤버 초대 때 고른 권한(Irene «초대할 때부터 권한»). 수락 전 행의 `role` 은 늘 member(user_id NULL 행이 owner/admin 목록 13곳에 끼지 않게) · `services/invites.acceptInvite` 가 role 로 옮긴다 · NULL = 옛 초대 = member. 운영 `migrate-invited-role.js`(배포 슬롯).
> **2026-11-06 — `email_accounts.responsible_user_id` INT NULL FK users SET NULL** — 회사 공용 메일함 «책임자» 한 사람(Fable 설계). 보는 권한은 그대로, 표시(설정 카드·계정 고르기·목록·상세)와 확인필요 귀속만(`services/mailTodoWhere` — 스레드 답변 담당 > 책임자(활성 멤버) > 전원). 판정 `services/mailResponsible`. 개인 메일함엔 없음. 운영 `migrate-mail-responsible.js`(배포 슬롯).
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

> **2026-11-20 — 공개 페이지 P2·P3** — `workspace_inquiries` 표(공개 페이지·창구 문의 건 · status new/handled/held/spam · via public_page/entry_link · ip_hash(하루 비밀 해시, 원문 없음) · message_hash · client_id 등록 시 · 보존 보류/스팸 30일·미등록 1년, 운영 `migrate-workspace-inquiries.js`) ·
> `businesses.public_page_status` ENUM(off,pending,public,blocked) NOT NULL DEFAULT 'off' · `public_category`·`public_region` VARCHAR(32) · `public_published_at` · `public_block_reason` + 색인 · `platform_settings.public_pages_enabled`(전체 끄기, 기본 1) · `contact_inquiries.kind` 끝에 'report'(운영 `migrate-public-page.js`). 둘 다 배포 슬롯 등록(코드보다 먼저). 설계 docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md.

> **2026-11-26 — 접수 양식 → 사건** — `intake_cases` 표(설문 응답 1줄 → 프로젝트·업무 · `q_record_row_id` UNIQUE = 멱등 키 · status running/done/error · step claimed/project_done/tasks_done · client_choice linked/created/recipient/none · 응답 행이 지워져도 남음(외래키 없음)). 운영 `dev-backend/scripts/migrate-intake-cases.js`(배포 슬롯, PM2 reload 전). 설계 `docs/INTAKE_AUTO_CASE_DESIGN.md` §6 · 판정 `services/intakeCase` 한 곳.

> **2026-11-27 — 일정 분류 커스텀** — `calendar_categories` 표(워크스페이스 공용 · code 시스템 5개 meeting/work/deadline/personal/other만, 커스텀 NULL · name 30자(시스템 NULL = i18n 라벨) · color #RRGGBB(시스템 NULL = 기존 팔레트) · is_active · sort_order · UNIQUE(business_id, code)) ·
> `calendar_events.category_id` INT NULL FK RESTRICT + 색인(business_id, category_id) — 정본. 옛 `category` ENUM 은 거울(시스템 = code · 커스텀 = 'other')로 남긴다. 운영 `dev-backend/scripts/migrate-calendar-categories.js`(표·칸·씨앗·백필, 멱등, 배포 슬롯 PM2 reload 전). 설계 `docs/CALENDAR_CATEGORIES_DESIGN.md` · 문 `services/calendarCategories` 한 곳.
