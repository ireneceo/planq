# Q Mail 상세 설계 (Phase 9 — 2026-05-25, v2 재설계)

> Phase 9 메인 `docs/UNIFIED_CONTEXT_DESIGN.md` 의 하위 spec. v2 — 30년차 3 전문가 (개발/업무효율/UI-UX) 관점 통합 + 사용자 호소 6 기능 + 다른 페이지 통일.
>
> 관련: `docs/EMAIL_DELIVERY_POLICY.md` · `docs/PERMISSION_MATRIX.md` · `docs/VISIBILITY_VOCABULARY.md` · `docs/INSIGHTS_DESIGN.md`

---

## 0. 비전 (3 관점 통합)

### 개발자 관점
**기존 인프라 최대 재사용 + 신규 6 테이블 + 1 cron + AES-256-GCM 만 추가.** 스키마 대수술 X.
- task_extractor 재사용 (`source_type='email_thread'` 분기)
- ContextPanel 재사용 (Phase 9 공통)
- ShareModal · VisibilityField · AttachmentField · PlanQSelect · DetailDrawer · PanelHeader 재사용
- File 모델 재사용 (첨부 자동 저장)
- KbDocument 재사용 (FAQ 마이닝 destination)
- KbChunk 임베딩 재사용 (FAQ 클러스터링 source)

### 업무효율 컨설턴트 관점
**메일 처리 시간 50% 절감 목표.** 사용자가 "이 메일 어떻게 처리하지?" 결정 시간 = critical bottleneck.
- **답변 필요 자동 분류** — LLM 이 "답변 needed" 판별 → 사용자는 그 폴더만 처리
- **할일 자동 추출** — 메일 내용에서 task 후보 → 1클릭 등록
- **FAQ 자동 축적** — 같은 질문 3건 누적 → Cue 가 Q info 등록 제안 → 4번째 질문은 자동 답변
- **Uncertain 분리** — 스팸 의심 + 검토 권장 메일 → 별도 폴더 (놓치지 않게)
- **인사이트** — 평균 응답 시간 / 미답변 누적 / 자주 묻는 카테고리 → /insights 'team' 탭 연동

### UI/UX 디자이너 관점
**다른 페이지와 완전 통일.** 사용자가 한 번 학습한 패턴 그대로 재사용.
- 레이아웃: Q Talk 3컬럼 정합 (좌 폴더트리 / 중 리스트 / 우 상세+ContextPanel)
- 컴포넌트: PageShell / PanelHeader / DetailDrawer / VisibilityField / ShareModal / PlanQSelect / AutoSaveField / AttachmentField / RichEditor (Tiptap)
- 색상: COLOR_GUIDE teal palette 만
- 상태: 빈 인박스 = Icons.tsx + 1줄 + CTA / 로딩 = skeleton (CLS 0)
- 모바일: 마스터-디테일 드릴다운 (Q Talk 패턴) — 리스트 → 상세 풀스크린 push, 상단 `<` 뒤로
- 마이크로 인터랙션: hover 0.15s + focus ring teal-500 opacity 0.3

---

## 1. 사용자 시나리오 (8건)

### 1.1 받은 메일 자동 처리
```
고객 메일 도착 (5분 cron IMAP fetch)
  → email_messages 신규 row
  → 같은 In-Reply-To 또는 Subject+참여자 → 기존 thread 매칭 또는 신규 thread
  → From email → clients.email or clients.email_aliases → client_id 자동
  → AI 분석 (백그라운드):
      • reply_needed 판정 (LLM intent + 키워드)
      • task_candidates 추출 (task_extractor 재사용)
      • FAQ 후보 (유사도 cluster ≥ 3 → Cue 제안)
  → socket emit 'mail:new' → /mail 열고 있으면 즉시 표시
  → unread badge 갱신 (사이드바 + 좌측 폴더트리)
```

### 1.2 답변 필요 폴더 (★ 신규 — 사용자 호소 #3)
```
/mail 의 좌측 폴더트리 첫 번째 = "답변 필요 (N)" 강조 빨간 배지
  ↳ reply_needed=true AND status='open' AND inbound 마지막 메시지 후 본인 답장 없음
  사용자가 이 폴더만 처리해도 OK — "오늘 할 일" 명확

LLM 판정 로직 (services/mailReplyClassifier.js — 신규):
  1. 키워드: ? / 확인 / 검토 / 회신 / 언제까지 / 가능한지 / 답변 / 답글 / 문의
  2. LLM (gpt-4o-mini, 500 토큰): "이 메일이 답변을 요구하는가? YES/NO + 이유 한줄"
  3. 마지막 메시지 direction='inbound' + 그 후 outbound 없음
  세 조건 모두 매칭 시 reply_needed=true
```

### 1.3 할일 자동 추출 (사용자 호소 #2)
```
inbound 메시지 도착 → task_extractor (이미 존재)
  → source_type='email_thread' 분기
  → 추출된 후보 → task_candidates (source_ref_id=thread.id)
  → ContextPanel "후보" 섹션에 표시 (Q Talk 와 동일 UI)
  → 사용자 승인 → tasks 신규 + assignee 본인 default
  → 같은 client 의 다른 메일/대화에서 같은 task 후보면 dedup
```

### 1.4 FAQ 자동 축적 (★★ 가장 차별화 — 사용자 호소 #4)
```
inbound 메시지 도착 → text-embedding-3-small (이미 사용)
  → 워크스페이스 최근 90일 inbound 메시지 + KbDocument FAQ 와 유사도 검사
  → 유사도 ≥ 0.85 인 메시지 ≥ 3건 클러스터 → "FAQ 후보" 마킹
  → Cue 카드 노출 (Dashboard + Q info "AI 제안" 탭):
      "지난 30일간 '환불 정책' 관련 질문 5건 들어왔어요. Q info 등록할까요?"
      [표준 답변 미리보기]  [등록]  [무시]
  → 등록 시 → KbDocument 신규 (category='faq', vlevel='L3')
  → 다음 같은 질문 도착 → Cue 자동 답변 제안 (Q info FAQ 활용)
  → 통계 — /insights 'team' 탭 "이번 달 FAQ 신규 N개 / 응대 시간 절감 NN분"
```

### 1.5 스팸 + Uncertain (사용자 호소 #5,#6)
```
IMAP fetch 시 spam_score 받음 (외부 mail server 가 제공 또는 자체 룰)
  → spam_score > 5.0 → status='spam', 인박스에서 hide (별도 "스팸" 폴더)
  → spam_score 2.5~5.0 → status='uncertain', 별도 "확인 권장 (N)" 폴더 + 노란 배지
      ↳ LLM 1차 패스로 uncertain_reason 판정:
         - "신규 고객 가능성 (회사 도메인 일치)"
         - "견적/계약 키워드 포함"
         - "청구/결제 관련"
         - "확실히 스팸"
      ↳ 사용자가 빠르게 훑어 진짜 스팸은 1클릭 archive, 중요한 건 인박스로
  → spam_score < 2.5 → 정상 인박스
```

### 1.6 답장 / 포워드 / 새 메일
```
"답장" → Tiptap (Q docs editor 재사용) + AttachmentField (File 인박스 통합)
  → 발송 → SMTP (PlanQ default 또는 워크스페이스 custom 또는 account 단위)
  → email_messages 신규 row (direction='outbound', sent_by_user_id=me)
  → 같은 스레드 안에 시간순 추가
  → reply_needed=false 자동 변경 (본인 답장 → 답변 완료)
  → socket emit 'mail:updated' (다른 멤버 화면 갱신)

"포워드" → 본문 + 첨부 그대로, To 새로 입력
"새 메일" → 신규 thread + 새 message
```

### 1.7 동시 작업 (Front 패턴)
```
같은 스레드 여러 멤버 동시 진입 시:
  - email_thread_participants 에 "현재 보고 있음" 마킹 (timestamp)
  - 다른 멤버가 답변 작성 중이면 "○○ 답변 작성 중" 인디케이터
  - 실제 lock 은 안 함 (단순화) — 발송 시 충돌 안내만
  - 발송 후 다른 답장이 동시 도착했다면 → 스레드에 둘 다 표시 (시간순)
```

### 1.8 라벨/필터/검색 (사용자 호소 #1)
```
좌측 폴더트리:
  ▾ 답변 필요 (N) ← 빨간 배지
  ▾ 인박스
      미할당 / 내 담당 / 팔로우
  ▾ 라벨 (사용자 자유 추가 — KbCategory 패턴)
      고객문의 / 내부 / 처리중 / VIP
  ▾ 확인 권장 (N) ← 노란 배지
  ▾ 스팸 / 보관함
  + 새 라벨

태그별 다중 선택:
  중앙 리스트 위 칩 "고객문의 ✕ + 처리중 ✕" → AND 필터
  키워드 검색 + 라벨 칩 동시 적용

검색:
  본문 + 제목 + From email 풀텍스트 (MySQL FULLTEXT 또는 추후 OpenSearch)
```

---

## 2. 데이터 모델 (6 신규 + 2 확장)

### 2.1 신규 테이블

```sql
-- 1. email_accounts (워크스페이스 단위 IMAP/SMTP 계정)
CREATE TABLE email_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL REFERENCES businesses(id),
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  -- IMAP
  imap_host VARCHAR(200) NOT NULL,
  imap_port INT NOT NULL DEFAULT 993,
  imap_username VARCHAR(255) NOT NULL,
  imap_password_encrypted TEXT NOT NULL,    -- AES-256-GCM
  imap_tls BOOLEAN NOT NULL DEFAULT TRUE,
  imap_folder VARCHAR(50) NOT NULL DEFAULT 'INBOX',
  imap_last_uid INT NOT NULL DEFAULT 0,
  -- SMTP (account 단위 발송 — 워크스페이스 기본과 별도 가능)
  smtp_host VARCHAR(200),
  smtp_port INT DEFAULT 587,
  smtp_username VARCHAR(255),
  smtp_password_encrypted TEXT,
  smtp_tls BOOLEAN DEFAULT TRUE,
  -- 상태
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,   -- 워크스페이스 첫 계정 자동 default
  last_sync_at DATETIME,
  last_sync_error TEXT,
  fail_count INT NOT NULL DEFAULT 0,           -- 연속 실패 → 3회 시 알림
  created_at DATETIME, updated_at DATETIME,
  INDEX (business_id, is_active),
  UNIQUE (business_id, email)
);

-- 2. email_threads
CREATE TABLE email_threads (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL REFERENCES businesses(id),
  account_id INT NOT NULL REFERENCES email_accounts(id),
  subject VARCHAR(500),
  -- 자동 매칭
  client_id INT REFERENCES clients(id),
  project_id BIGINT REFERENCES projects(id),
  -- 상태
  status ENUM('open','spam','uncertain','archived') NOT NULL DEFAULT 'open',
  -- 답변 필요 (★ 사용자 호소 #3)
  reply_needed BOOLEAN NOT NULL DEFAULT FALSE,
  reply_needed_reason VARCHAR(200),         -- LLM 판정 이유
  reply_needed_at DATETIME,                  -- 최초 reply_needed 마킹 시각
  -- Uncertain (★ 사용자 호소 #6)
  uncertain_reason VARCHAR(200),             -- "신규 고객 가능성" 등
  spam_score FLOAT,                          -- 0.0 ~ 10.0
  -- 핀/팔로우
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  -- 라벨
  labels JSON,                               -- ["고객문의", "처리중"]
  -- 메타
  message_count INT NOT NULL DEFAULT 0,
  unread_count INT NOT NULL DEFAULT 0,
  last_message_at DATETIME,
  last_message_direction ENUM('inbound','outbound'),
  last_message_preview VARCHAR(500),
  participants JSON,                         -- [{name, email, is_internal}]
  -- visibility (4단계 통일)
  vlevel ENUM('L1','L2','L3','L4') DEFAULT 'L3',
  target_member_ids JSON,
  -- 공유
  share_token VARCHAR(64),
  shared_at DATETIME,
  share_expires_at DATETIME,
  created_at DATETIME, updated_at DATETIME,
  INDEX (business_id, status, last_message_at DESC),
  INDEX (business_id, reply_needed, last_message_at DESC),
  INDEX (business_id, client_id),
  INDEX (business_id, project_id),
  INDEX (business_id, vlevel),
  UNIQUE INDEX (share_token)
);

-- 3. email_messages
CREATE TABLE email_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  business_id INT NOT NULL REFERENCES businesses(id),
  direction ENUM('inbound','outbound') NOT NULL,
  -- IMAP / SMTP 식별자
  message_id VARCHAR(500) NOT NULL,
  in_reply_to VARCHAR(500),
  references_chain TEXT,                     -- RFC 822 References 헤더
  imap_uid INT,
  -- From/To/Cc/Bcc
  from_email VARCHAR(255), from_name VARCHAR(100),
  to_emails JSON NOT NULL,
  cc_emails JSON,
  bcc_emails JSON,                           -- outbound only (개인정보)
  -- 본문
  subject VARCHAR(500),
  body_html LONGTEXT,
  body_text LONGTEXT,                        -- 검색 + LLM input
  -- 발신
  sent_by_user_id INT REFERENCES users(id),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  -- 상태
  delivery_status ENUM('pending','sent','delivered','bounced','failed') DEFAULT 'sent',
  delivery_error TEXT,
  -- AI 분석 (백그라운드 채움)
  ai_intent VARCHAR(50),                     -- 'question' | 'request' | 'fyi' | 'thanks' | 'complaint'
  ai_summary VARCHAR(500),                   -- 1줄 요약 (긴 메일용)
  ai_processed_at DATETIME,                  -- 처리 시각 (null = pending)
  -- 메타
  sent_at DATETIME NOT NULL,
  created_at DATETIME, updated_at DATETIME,
  INDEX (thread_id, sent_at),
  INDEX (business_id, direction, sent_at DESC),
  INDEX (message_id),
  FULLTEXT INDEX ft_search (subject, body_text)
);

-- 4. email_attachments (File 통합)
CREATE TABLE email_attachments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  message_id INT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  file_id INT REFERENCES files(id),          -- File 인박스 자동 저장
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes BIGINT,
  content_id VARCHAR(100),                   -- inline image cid:
  is_inline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME,
  INDEX (message_id)
);

-- 5. email_thread_participants (스레드별 멤버)
CREATE TABLE email_thread_participants (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  is_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  is_following BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_message_id INT,
  last_read_at DATETIME,
  -- 동시 작업 인디케이터 (1.7)
  is_viewing BOOLEAN NOT NULL DEFAULT FALSE,
  viewing_started_at DATETIME,
  is_drafting BOOLEAN NOT NULL DEFAULT FALSE,
  drafting_started_at DATETIME,
  created_at DATETIME, updated_at DATETIME,
  UNIQUE INDEX (thread_id, user_id),
  INDEX (user_id, is_assigned, is_following)
);

-- 6. email_drafts (답장 작성중)
CREATE TABLE email_drafts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT REFERENCES email_threads(id) ON DELETE CASCADE,
  business_id INT NOT NULL REFERENCES businesses(id),
  user_id INT NOT NULL REFERENCES users(id),
  in_reply_to_message_id INT REFERENCES email_messages(id),
  account_id INT REFERENCES email_accounts(id),   -- 어떤 계정으로 보낼지
  to_emails JSON, cc_emails JSON, bcc_emails JSON,
  subject VARCHAR(500),
  body_html LONGTEXT,
  attachment_file_ids JSON,                  -- [file_id, ...]
  created_at DATETIME, updated_at DATETIME,
  INDEX (user_id, updated_at DESC),
  INDEX (thread_id)
);
```

### 2.2 기존 테이블 확장

```sql
-- clients — 같은 고객의 다른 메일 주소
ALTER TABLE clients ADD COLUMN email_aliases JSON;

-- clients — 메일 응답 상태 (bounce 추적)
ALTER TABLE clients ADD COLUMN email_status ENUM('valid','bounced','suppressed') DEFAULT 'valid';

-- task_candidates — source_type 확장
ALTER TABLE task_candidates MODIFY COLUMN source_type
  ENUM('conversation','email_thread','meeting','manual','ai') DEFAULT 'conversation';

-- kb_documents — FAQ 자동 축적 source 추적 (옵션)
ALTER TABLE kb_documents ADD COLUMN faq_source VARCHAR(50);  -- 'mail_cluster' | 'chat_cluster' | 'manual'
ALTER TABLE kb_documents ADD COLUMN faq_source_count INT;     -- 클러스터 크기 (≥3)
ALTER TABLE kb_documents ADD COLUMN faq_last_seen_at DATETIME;
```

---

## 3. API 설계 (35+ endpoint, 통일 패턴)

### 3.1 EmailAccount (`requireMenu('qmail', 'admin')`)

```
GET    /api/businesses/:bizId/email-accounts
POST   /api/businesses/:bizId/email-accounts            -- IMAP test 자동 실행
PUT    /api/businesses/:bizId/email-accounts/:id
DELETE /api/businesses/:bizId/email-accounts/:id        -- soft (is_active=false)
POST   /api/businesses/:bizId/email-accounts/:id/sync-now
POST   /api/businesses/:bizId/email-accounts/:id/test
POST   /api/businesses/:bizId/email-accounts/:id/set-default
```

### 3.2 EmailThread (인박스, `requireMenu('qmail', 'read')`)

```
GET    /api/businesses/:bizId/email-threads
  ?folder=reply_needed|inbox|assigned|following|uncertain|spam|archived
  &account_id=&client_id=&project_id=&labels=tag1,tag2
  &unread=true|false&starred=true|false
  &q=keyword                                            -- 풀텍스트
  &page=&limit=
GET    /api/businesses/:bizId/email-threads/:id         -- 상세 + 모든 message
PUT    /api/businesses/:bizId/email-threads/:id         -- archive/star/label/client/project/status
POST   /api/businesses/:bizId/email-threads/:id/mark-read
POST   /api/businesses/:bizId/email-threads/:id/mark-spam
POST   /api/businesses/:bizId/email-threads/:id/mark-not-spam
POST   /api/businesses/:bizId/email-threads/:id/assign       body: { user_id }
POST   /api/businesses/:bizId/email-threads/:id/follow       body: { follow: bool }
PUT    /api/businesses/:bizId/email-threads/:id/visibility   body: { level, project_id?, target_member_ids? }
POST   /api/businesses/:bizId/email-threads/:id/viewing      body: { active: bool }    -- 동시 작업 인디케이터
```

### 3.3 EmailMessage

```
POST   /api/businesses/:bizId/email-threads/:id/messages    -- 답장
  body: { body_html, attachment_file_ids?, cc?, bcc?, account_id? }
POST   /api/businesses/:bizId/email-messages                -- 신규 스레드
  body: { to, cc?, bcc?, subject, body_html, attachment_file_ids?, account_id }
POST   /api/businesses/:bizId/email-messages/:id/forward
GET    /api/businesses/:bizId/email-messages/:id            -- 단일 (HTML 전체)
```

### 3.4 EmailDraft (AutoSave 패턴)

```
GET    /api/businesses/:bizId/email-drafts
POST   /api/businesses/:bizId/email-drafts
PUT    /api/businesses/:bizId/email-drafts/:id              -- AutoSaveField 2초 debounce
DELETE /api/businesses/:bizId/email-drafts/:id
POST   /api/businesses/:bizId/email-drafts/:id/send
```

### 3.5 라벨 (KbCategory 패턴 재사용 — email_labels 별도 테이블 X, businesses.email_labels JSON)

```
GET    /api/businesses/:bizId/email-labels                  -- 라벨 마스터 list
POST   /api/businesses/:bizId/email-labels                  body: { name, color? }
PUT    /api/businesses/:bizId/email-labels/:name            body: { newName }
DELETE /api/businesses/:bizId/email-labels/:name
```

### 3.6 FAQ 자동 제안 (Cue 통합)

```
GET    /api/businesses/:bizId/email-faq-suggestions         -- 클러스터 list (cache)
POST   /api/businesses/:bizId/email-faq-suggestions/:id/accept   -- KbDocument 등록
POST   /api/businesses/:bizId/email-faq-suggestions/:id/dismiss  -- 7일 hide
```

### 3.7 공개 share

```
GET    /api/email-threads/public/by-token/:token
```

### 3.8 인사이트 (운영 효율 측정)

```
GET    /api/businesses/:bizId/email-insights
  → {
      avg_response_minutes,            -- 평균 응답 시간
      open_reply_needed_count,         -- 미답변 누적
      faq_auto_accepted_30d,           -- 30일 FAQ 자동 등록 수
      time_saved_estimate_minutes,     -- AI 응대로 절감 추정 (FAQ 활용 × 평균 응답 시간)
      top_clients_by_volume,           -- 메일 많이 보내는 client top 5
      top_labels                       -- 자주 쓰는 라벨 top 10
    }
```

---

## 4. UI 설계 (다른 페이지 완전 통일)

### 4.1 페이지 구조

```
/mail
PageShell title="Q Mail"
┌─────────────────┬─────────────────────────┬────────────────────────┐
│ MailFolderTree  │ MailThreadList          │ MailThreadDetail        │
│ (Q docs 패턴)    │ (Q Talk LeftPanel 패턴)  │ (Q Talk ChatPanel 패턴) │
│                  │ PanelHeader              │ PanelHeader             │
│ ▾ 답변필요 (5)🔴│ ┌─────────────────────┐ │ Subject                  │
│ ▾ 인박스         │ │● 고객A · 2시간 전    │ │ From: ... · To: ...      │
│   미할당 (3)     │ │  Re: 견적 요청       │ │ ─────────────────────── │
│   내 담당 (7)    │ │  본문 미리보기...     │ │ <iframe sandbox>         │
│   팔로우         │ └─────────────────────┘ │   <body_html>             │
│ ▾ 라벨           │ ┌─────────────────────┐ │ </iframe>                │
│   #고객문의 (12) │ │  고객B · 1일 전      │ │                          │
│   #처리중 (4)    │ │  신규 문의           │ │ [답장] [포워드] [...]    │
│ ▾ 확인권장 (2)🟡│ └─────────────────────┘ │ ─────────────────────── │
│ ▾ 스팸           │                          │ ContextPanel             │
│ ▾ 보관함         │ [+ 새 메일]              │ [📋 후보 (3)]            │
│                  │                          │ [🚨 이슈 (1)]            │
│ + 새 라벨        │                          │ [✅ 내 할 일 (2)]        │
│                  │                          │ [👤 client meta]         │
│                  │                          │ [🔗 링크 / 첨부]         │
└─────────────────┴─────────────────────────┴────────────────────────┘
```

### 4.2 핵심 컴포넌트 (모두 신규 — Phase 9 의 큰 부분)

| 컴포넌트 | 경로 | 재사용 패턴 |
|---|---|---|
| `MailPage` | `pages/QMail/MailPage.tsx` | PageShell + 3컬럼 grid (Q Talk 패턴) |
| `MailFolderTree` | `pages/QMail/MailFolderTree.tsx` | Q docs FolderTree (`pages/QProject/DocsTab.tsx`) 패턴 + badge |
| `MailThreadList` | `pages/QMail/MailThreadList.tsx` | Q Talk LeftPanel 패턴 + 가상화 (react-window) + 다중 라벨 칩 필터 |
| `MailThreadDetail` | `pages/QMail/MailThreadDetail.tsx` | iframe sandbox + 시간순 메시지 + 답장 인라인 펼침 |
| `MailReplyEditor` | `pages/QMail/MailReplyEditor.tsx` | Tiptap (Q docs editor 재사용) + AttachmentField + AutoSaveField 2초 |
| `MailContextPanel` | `components/Context/ContextPanel.tsx` (Phase 9 공통) | Q Talk RightPanel 패턴 + entity_type='email_thread' |
| `NewMailModal` | `pages/QMail/NewMailModal.tsx` | DetailDrawer + To/Cc/Bcc input + Tiptap + AttachmentField |
| `EmailAccountSettings` | `pages/Settings/EmailAccountSettings.tsx` | PageShell + AutoSaveField + 새 계정 모달 |
| `FaqSuggestionCard` | `components/QMail/FaqSuggestionCard.tsx` | Dashboard "Cue 제안" 카드 + Q info 등록 1클릭 |
| `MailLabelChip` | `components/QMail/MailLabelChip.tsx` | KbCategory 칩 패턴 |

### 4.3 답변 필요 폴더 UI (★ 사용자 호소)

```
좌측 폴더트리 첫 번째:
  ┌──────────────────────────────┐
  │ 🔴 답변 필요              5  │  ← 빨간 배지 + 큰 폰트
  └──────────────────────────────┘

중앙 리스트 (이 폴더 선택 시):
  ┌──────────────────────────────────────────┐
  │ 🔴 고객A · 어제                     2일 전│  ← "응답 시간 지연" 표시
  │   Re: 견적 요청 — 가격 확인 부탁드려요   │
  │   이번 주까지 가능할까요?                 │
  └──────────────────────────────────────────┘
  ┌──────────────────────────────────────────┐
  │ 🟡 고객B · 오늘                    3시간 전│
  │   신규 문의 — 도입 가능한가요?            │
  └──────────────────────────────────────────┘
  
  [📊 평균 응답 시간 2시간 · 가장 오래된 미답변 2일 전]
```

### 4.4 Uncertain 폴더 UI (사용자 호소 #6)

```
🟡 확인 권장 (2)
  ┌──────────────────────────────────────────┐
  │ ⚠️ unknown@xyz.com · 3시간 전             │
  │   "신규 고객 가능성 (회사 도메인 일치)"   │  ← uncertain_reason 강조
  │   "PlanQ 도입 검토 중인데 데모 가능할지" │
  │   [📥 인박스로]  [🗑 스팸]                │
  └──────────────────────────────────────────┘
```

### 4.5 FAQ 자동 제안 UI (★★ 사용자 호소 #4)

```
Dashboard + Q info "AI 제안" 탭 :
  ┌─────────────────────────────────────────────────────────┐
  │ ✨ Cue 제안 — FAQ 자동 등록                              │
  │                                                          │
  │ "환불 정책" 관련 질문이 지난 30일간 5건 들어왔어요.       │
  │                                                          │
  │ 표준 질문: 환불 어떻게 받나요?                            │
  │ 표준 답변: 결제일 7일 이내 100% 환불... (편집 가능)        │
  │                                                          │
  │ 출처:                                                    │
  │  ▸ 메일: 고객A (2024-05-20)                              │
  │  ▸ 메일: 고객B (2024-05-22)                              │
  │  ▸ 채팅: 고객C (2024-05-25)                              │
  │  + 2건                                                   │
  │                                                          │
  │ [Q info 등록]  [무시 7일]  [편집]                         │
  └─────────────────────────────────────────────────────────┘
```

### 4.6 반응형 (모바일 — 마스터-디테일 드릴다운)

```
≤768px:
  - Folder tree → hamburger (Sheet 패턴)
  - Thread list → 단일 컬럼 풀 라우트 (/mail)
  - Detail → 슬라이드 push 풀 라우트 (/mail/:threadId) + 상단 < 뒤로
  - 답장 → 풀스크린 modal (iOS Mail 패턴)
  - 답변 필요 폴더가 mobile 첫 진입 default (PWA 시작 최적화)
```

### 4.7 색상/간격 (COLOR_GUIDE 정합)

- 답변 필요 폴더: `#EF4444` (Error red, urgency)
- Uncertain: `#F59E0B` (Warning amber)
- 라벨 chip: KbCategory 패턴 (teal-50 bg / teal-700 text)
- ContextPanel "FAQ 후보": `#F43F5E` (Accent rose — AI 감지 강조)
- 메시지 본문: padding 20px, line-height 1.6
- 답장 inline expand: card 14px radius + teal-500 left border

---

## 5. IMAP/SMTP 통합 (services 신규)

### 5.1 IMAP fetch cron — `services/emailImapCron.js`

```js
// 5 분 cron — 활성 email_accounts 의 신규 메일 fetch + 자동 AI 분석
//
// 1. accounts WHERE is_active=true ORDER BY last_sync_at ASC LIMIT 50
// 2. 각 account 에 대해 sequential (병렬 X — IMAP server rate-limit):
//    A. imap-simple connect (TLS) — timeout 30s
//    B. UID > last_uid 메시지 fetch (limit 50)
//    C. 각 메시지:
//       - mailparser → from/to/cc/subject/body_html/body_text/attachments
//       - thread 매칭:
//         a. In-Reply-To → 기존 email_messages.message_id → thread_id
//         b. 없으면 References 헤더에서 같이 검사
//         c. 없으면 Subject (Re:/Fwd: stripped) + 같은 참여자 set → 기존 thread
//         d. 없으면 신규 thread
//       - client 매칭:
//         a. from_email → clients.email exact match
#        b. 없으면 clients.email_aliases JSON contains
#        c. 없으면 client_id=null (미할당)
#       - email_messages insert
#       - attachments → File 자동 저장 (visibility=L3, folder='Email Attachments')
#       - thread 갱신 (unread_count++, last_message_*, participants)
#       - socket emit 'mail:new' to business room
#    D. AI 백그라운드 job queue:
#       - mailReplyClassifier (LLM intent)
#       - task_extractor (source_type='email_thread')
#       - faqClusterDetector (embedding 유사도)
#    E. last_uid + last_sync_at 갱신
# 3. 에러 시 fail_count++ + last_sync_error 기록
# 4. fail_count ≥ 3 → admin platform alert
```

### 5.2 SMTP 발송 — `services/emailSendService.js`

```js
// EMAIL_DELIVERY_POLICY 정합:
// 1. account.smtp_* 가 있으면 그것 (account 단위)
// 2. 없으면 businesses.smtp_config (Pro+ workspace custom)
// 3. 없으면 PlanQ default (env SMTP_*)
// 4. nodemailer + Message-ID + In-Reply-To + References 헤더 강제
// 5. 발송 성공 → email_messages outbound + thread.last_message_direction='outbound'
// 6. delivery_status='sent' → SMTP 250 응답
// 7. bounce webhook (외부 mail server 가 webhook 지원 시) → status='bounced' + clients.email_status='bounced'
// 8. EmailLog 통합 (기존 모델 재사용)
```

### 5.3 AI 백그라운드 워커 — `services/mailAiWorker.js`

```js
// 3개 job queue 분리:
// 1. reply_needed_classifier (mailReplyClassifier)
//    - 5초 마다 ai_processed_at IS NULL AND direction='inbound' top 20
//    - LLM gpt-4o-mini 500 토큰
//    - reply_needed + ai_intent + ai_summary 갱신
// 2. task_extractor (기존 재사용)
// 3. faqClusterDetector
//    - 1시간 마다 ai_processed_at NOT NULL 메시지의 임베딩 fetch
//    - 같은 워크스페이스 최근 90일 inbound + KbDocument FAQ 와 cosine 유사도
#    - 유사도 ≥ 0.85 cluster 발견 시 email_faq_suggestions 캐시 row
#    - Cue 카드 자동 노출 (Dashboard + Q info AI 제안 탭)
```

### 5.4 Spam / Uncertain 분류 — `services/mailSpamClassifier.js`

```js
// 1. spam_score 산출 (외부 mail server 가 제공 안 하면 자체):
#    - SPF/DKIM/DMARC 검증 (mailparser 가 제공)
#    - 키워드 ("free / lottery / urgent action" 등) 가중치
#    - From domain reputation (없으면 0)
#    - 본문 image-only ratio
# 2. score > 5.0 → status='spam'
# 3. 2.5 ≤ score ≤ 5.0 → status='uncertain' + LLM 1차 판정:
#    - "신규 고객 가능성" / "견적/계약" / "청구/결제" / "확실히 스팸"
#    - uncertain_reason 갱신
# 4. score < 2.5 → status='open'
```

---

## 6. 권한 매트릭스 (PERMISSION_MATRIX §5.X 추가)

| 역할 | 인박스 | 상세 | 답장 | 새 메일 | 계정 관리 | FAQ 등록 |
|---|---|---|---|---|---|---|
| Owner | 전체 | 전체 | O | O | O | O |
| Admin | 전체 | 전체 | O | O | O | O |
| Member (qmail.write) | 본인 담당 + 미할당 + L3 | 같음 + L2-members + L4 | O | O | X | O |
| Member (qmail.read) | 같음 | 같음 | X | X | X | X |
| Member (qmail.none) | X | X | X | X | X | X |
| Client | 본인 client_id 스레드 (L4) | 같음 | O (자기 스레드만) | X | X | X |
| Cue (AI) | API 호출 | 이슈/업무/FAQ 자동 추출 | X | X | X | (자동 제안만, 사용자 승인 후 등록) |

`middleware/menu_permission.js requireMenu('qmail', 'read|write|admin')` 적용.

---

## 7. AI 통합 (재사용 + 신규)

### 7.1 재사용
- **task_extractor** — `source_type='email_thread'` 분기 (이미 인프라 있음)
- **text-embedding-3-small** — 메일 메시지 임베딩 (KB 패턴 재사용)
- **context_issues** (Phase 9 공통) — entity_type='email_thread' 저장
- **ContextPanel** — entity_type 추가만으로 자동 작동

### 7.2 신규 AI 엔진

| 엔진 | 모델 | 호출 빈도 | 비용 |
|---|---|---|---|
| **mailReplyClassifier** | gpt-4o-mini 500 토큰 | 메시지당 1회 | $0.0001 |
| **mailSpamClassifier** | gpt-4o-mini 300 토큰 (uncertain 만) | 의심 메시지만 (10%) | $0.00006 |
| **mailSummary** (긴 메일) | gpt-4o-mini 800 토큰 | 본문 ≥ 500 자 메시지만 | $0.0002 |
| **faqClusterDetector** | 임베딩 cosine + LLM 요약 (cluster 발견 시만) | 1시간 cron | $0.001/cluster |
| **autoReplyDrafter** (옵션, M9+) | gpt-4o-mini 1500 토큰 | 사용자 명시 클릭 | $0.0003 |

운영 비용 — 1일 100 inbound 메일 / 워크스페이스 = **$0.025/일 ≈ $9/년/워크스페이스**

---

## 8. 실시간 동기화 (CLAUDE.md §16 정합)

| Event | room | 시점 | frontend listener |
|---|---|---|---|
| `mail:new` | `business:${bizId}` | IMAP fetch 신규 | MailPage debouncedReload (250ms) |
| `mail:updated` | `business:${bizId}` | thread/message 변경 | MailPage merge state |
| `mail:deleted` | `business:${bizId}` | thread archived/deleted | MailPage remove |
| `mail:read` | `user:${userId}` | 본인 read 상태 (다중 디바이스) | unread count sync |
| `mail:reply_needed` | `business:${bizId}` | AI 판정 완료 | "답변 필요" 폴더 badge++ |
| `mail:faq_suggestion` | `business:${bizId}` | FAQ cluster 발견 | Cue 카드 노출 |
| `mail:viewing` | `thread:${id}` | 동시 작업 인디케이터 | 다른 멤버 "보고 있음" 표시 |
| `mail:drafting` | `thread:${id}` | 답장 작성 중 | "OO 작성 중" 표시 |

frontend: MailPage mount → `s.emit('join:business', bizId)` + `s.on('mail:*', ...)` + thread 열 때 `s.emit('join:thread', threadId)`.

---

## 9. 마이그레이션 단계 (총 8주, 9주 Phase 9 안)

| M | 주차 | 작업 | 산출물 |
|---|---|---|---|
| **M0 - 기획** | 0 (완료) | Q_MAIL_SPEC v2 | 이 문서 |
| **M1 - DB + IMAP fetch** | 1주 | 6 모델 + ALTER + EmailAccount CRUD + imapCron + AES-256-GCM | 인박스 read DB 영구 |
| **M2 - 인박스 UI** | 1주 | MailPage 3컬럼 + ThreadList + ThreadDetail (iframe sandbox) + 사이드바 메뉴 추가 + 클라이언트 자동 매칭 노출 | 받은 메일 보기 |
| **M3 - 답장/draft** | 1주 | MailReplyEditor + EmailSendService + EmailDraft AutoSave + 답장 후 reply_needed=false | 양방향 통신 |
| **M4 - 라벨 + 폴더** | 0.5주 | MailFolderTree + 라벨 CRUD + 다중 라벨 필터 칩 | 사용자 호소 #1 |
| **M5 - 답변 필요 + AI** | 1주 | mailReplyClassifier + 답변 필요 폴더 + ai_summary + task_extractor (email_thread source) | 사용자 호소 #2 #3 |
| **M6 - FAQ 자동 축적** | 1주 | faqClusterDetector + FaqSuggestionCard + KbDocument 자동 등록 흐름 | 사용자 호소 #4 ★ |
| **M7 - 스팸 + Uncertain** | 0.5주 | mailSpamClassifier + 스팸/확인 권장 폴더 + 1클릭 archive | 사용자 호소 #5 #6 |
| **M8 - 권한 + visibility + 새 메일 + 포워드** | 0.5주 | requireMenu('qmail') + VisibilityField + NewMailModal + 포워드 | 풀세트 |
| **M9 - 모바일 + 운영 + 인사이트** | 0.5주 | 마스터-디테일 드릴다운 + bounce 처리 + audit + EmailInsights API | 운영 진입 |

총 **7~8주** (9주 Phase 9 안 → ENTITY_PROFILE_SPEC + TASK_VISIBILITY_REDESIGN 1주 같이 진행 가능)

---

## 10. 다른 페이지와 통일 매트릭스

| 영역 | Q Mail | 통일 출처 |
|---|---|---|
| 페이지 헤더 | PageShell title="Q Mail" actions=... | 모든 페이지 |
| 패널 헤더 | PanelHeader 60px | Q Talk |
| 셀렉트 | PlanQSelect (raw select 금지) | 전역 |
| AutoSave | AutoSaveField (draft, 2초 debounce) | 전역 |
| 첨부 | AttachmentField (File 통합) | Q docs / Q info |
| 에디터 | Tiptap (Q docs PostsPage editor) | Q docs |
| 모달 | DetailDrawer (반응형 풀스크린) | Q Calendar / Q Task / Q info |
| visibility 변경 | VisibilityField + VisibilityChangeModal | 전역 |
| 공유 | ShareModal | 전역 |
| 댓글/메모 | (해당없음 — 메일 자체) | — |
| ContextPanel | components/Context/ContextPanel (Phase 9 공통) | 전 entity |
| 라벨 chip | KbCategory pattern (PostCategory 패턴 응용) | Q info / Q docs |
| 실시간 sync | socket business:${bizId} + listener + useVisibilityRefresh | 전 페이지 (CLAUDE.md §16) |
| 토글 재클릭 해제 | 리스트 row + drawer | UI 규칙 (CLAUDE.md) |
| 모바일 | mediaTablet 분기 + 마스터-디테일 드릴다운 | Q Talk / Q Calendar |
| 색상 | COLOR_GUIDE teal palette | 전역 |
| i18n | locales/ko/qmail.json + en/qmail.json | 전역 |

---

## 11. 보안/개인정보 (CLAUDE.md 보안 정합)

- **IMAP/SMTP password** — AES-256-GCM 암호화 (`services/encryption.js` 신규)
  - master key — env `EMAIL_ENCRYPTION_KEY` (32 bytes)
  - 운영 .env 별도 생성 (배포 별도 안내)
- **본문 iframe sandbox** — `sandbox="allow-same-origin"` 만 (script/form/popup 차단)
- **inline image cid:** — File 저장 후 srcdoc 안에서 src 변환
- **외부 링크** — `target="_blank" rel="noopener noreferrer"` 강제 (sanitize-html)
- **BCC** — inbound 시 다른 수신자 노출 금지 (DB 저장 X, 본인만)
- **GDPR — 메일 삭제** — soft delete (archived 30일) + hard delete cron
- **EmailLog** — 발송 audit (이미 모델 있음) + 외부 발송 입력 검증 (CLAUDE.md §8)
- **rate-limit** — POST /messages 시 per-user 분당 30회 (CLAUDE.md §1)
- **cross-tenant 격리** — 모든 라우트 `attachWorkspaceScope({ memberOnly: true })`

---

## 12. 검증 시나리오 (M2 PR 단위)

1. IMAP 새 메일 fetch → 인박스 즉시 표시 (socket 250ms)
2. 같은 client 의 새 메일 → 같은 스레드 클러스터링
3. 다른 워크스페이스 token 으로 thread GET → 403
4. client 역할이 본인 스레드만 보임
5. 모바일 375px 에서 마스터-디테일 드릴다운
6. 답장 발송 → outbound row + recipients 메일 도착
7. 첨부 inline image 정상 렌더 (cid 변환)
8. share_token L4 외부 접속 가능
9. AI reply_needed 판정 정확도 — 의문문 메일 100건 중 ≥ 90 정답
10. FAQ 클러스터링 — 같은 의도 3건 누적 시 후보 카드 노출
11. spam_score 5.0+ → 자동 spam 폴더 + 인박스 hide
12. 동시 작업 인디케이터 — 2 탭에서 같은 스레드 진입 시 "OO 보고 있음"

---

## 13. 운영 비용 추정

| 항목 | 비용 |
|---|---|
| IMAP fetch (5분 cron, 50 account/cycle) | 0 (자체) |
| 저장 — 메시지 평균 5KB × 100/일 + 첨부 200KB × 50/일 | 25MB/일 → 9GB/년 |
| AI 비용 (위 §7.2) | $9/년/워크스페이스 |
| SMTP 발송 (PlanQ default) | 0 (Nodemailer 자체) |
| Custom SMTP (Pro+) | 0 (사용자 제공) |

100 워크스페이스 운영 시 — 저장 1TB/년 (~$10/월) + AI $75/월 (~$900/년) = 미미.

---

## 14. 미적용 (다음 사이클 / 옵션)

- **Gmail/Outlook OAuth** — IMAP password 대신 OAuth 2.0
- **메일 발송 캠페인** — Mailchimp 같은 bulk (별도 도구)
- **자동 라우팅 룰** — "From 이 X 면 라벨 Y" (M9 이후)
- **메일 템플릿** — DocumentTemplate kind='email' 재사용
- **서명 (signature)** — DocumentTemplate kind='email_signature'
- **delegate** — 다른 멤버에게 메일 위임
- **AI 자동 답장 초안** — autoReplyDrafter (사용자 명시 클릭만 — 자동 X)
- **다중 받은편지함 통합 뷰** — 모든 account 인박스 한 화면
- **FAQ 클러스터링 — 채팅 source 통합** — Q Talk conversations 도 같은 엔진

---

## 15. 인사이트 통합 (`/insights` 'team' 탭)

| 지표 | 정의 |
|---|---|
| 평균 응답 시간 | inbound 도착 ~ outbound 발송 시간차 평균 (분) |
| 미답변 누적 | reply_needed=true AND outbound 없음 카운트 |
| 답변률 | 답변 완료 / 답변 필요 마킹 메일 비율 |
| FAQ 자동 등록 (30일) | faq_source='mail_cluster' AND faq_last_seen_at > NOW()-30d |
| 시간 절감 추정 | FAQ 활용 횟수 × 평균 응답 시간 |
| Top 클라이언트 | 메일 보낸 횟수 top 5 |
| Top 라벨 | 최근 30일 사용 빈도 top 10 |

→ 업무효율 컨설턴트 관점 — 사용자가 직접 측정 가능. PlanQ 도입 효과 정량화.

---

## 부록 A — 데이터 흐름 (mermaid)

```
[IMAP] →cron→ [emailImapCron] → [email_messages insert]
                                  ↓
                         [thread/client 매칭]
                                  ↓
                       [socket emit 'mail:new']
                                  ↓
              ┌───────────────────┼───────────────────┐
              ↓                   ↓                   ↓
   [mailReplyClassifier]  [task_extractor]    [faqClusterDetector]
   reply_needed, intent   task_candidates     email_faq_suggestions
              ↓                   ↓                   ↓
   [socket 'mail:reply_  [ContextPanel 후보]  [Cue 카드 노출]
    needed']               섹션 (Q Talk 패턴)   Dashboard + Q info AI 탭
```

---

## 부록 B — 파일 구조 (M1~M9 최종)

```
dev-backend/
├─ models/
│  ├─ EmailAccount.js          [M1]
│  ├─ EmailThread.js           [M1]
│  ├─ EmailMessage.js          [M1]
│  ├─ EmailAttachment.js       [M1]
│  ├─ EmailThreadParticipant.js [M1]
│  └─ EmailDraft.js            [M1]
├─ routes/
│  ├─ email_accounts.js        [M1]
│  ├─ email_threads.js         [M2~M8]
│  ├─ email_messages.js        [M3]
│  ├─ email_drafts.js          [M3]
│  ├─ email_labels.js          [M4]
│  ├─ email_faq_suggestions.js [M6]
│  └─ email_insights.js        [M9]
├─ services/
│  ├─ emailImapCron.js         [M1]
│  ├─ emailSendService.js      [M3]
│  ├─ mailReplyClassifier.js   [M5]
│  ├─ mailSpamClassifier.js    [M7]
│  ├─ mailAiWorker.js          [M5]
│  ├─ faqClusterDetector.js    [M6]
│  └─ encryption.js            [M1] (AES-256-GCM)
└─ middleware/
   └─ menu_permission.js       (기존 — qmail 추가)

dev-frontend/
├─ pages/QMail/
│  ├─ MailPage.tsx             [M2]
│  ├─ MailFolderTree.tsx       [M4]
│  ├─ MailThreadList.tsx       [M2]
│  ├─ MailThreadDetail.tsx     [M2]
│  ├─ MailReplyEditor.tsx      [M3]
│  ├─ NewMailModal.tsx         [M8]
│  └─ types.ts                 [M1]
├─ pages/Settings/
│  └─ EmailAccountSettings.tsx [M1]
├─ components/QMail/
│  ├─ MailLabelChip.tsx        [M4]
│  ├─ FaqSuggestionCard.tsx    [M6]
│  └─ UncertainMailRow.tsx     [M7]
├─ services/
│  └─ mail.ts                  [M1~M8]
└─ public/locales/
   ├─ ko/qmail.json            [M2]
   └─ en/qmail.json            [M2]

docs/
├─ Q_MAIL_SPEC.md              [M0 — 이 문서]
├─ UNIFIED_CONTEXT_DESIGN.md   (기존 — 상위)
├─ EMAIL_DELIVERY_POLICY.md    (기존)
├─ ENTITY_PROFILE_SPEC.md      (Phase 9 — 별도 작성)
└─ TASK_VISIBILITY_REDESIGN.md (Phase 9 — 별도 작성)
```

---

**다음** — M1 (DB + IMAP) 구현 시작. 1주 단위 PR + 통합 검증.
