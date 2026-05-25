# Q Mail 상세 설계 (Phase 9 — 2026-05-25)

> Phase 9 메인 설계 `docs/UNIFIED_CONTEXT_DESIGN.md` 의 하위 spec.
> Q Mail = 메일 수신/스레드/답장 + 엔티티(고객/프로젝트) 자동 연결 + ContextPanel 통합.
>
> 관련: `docs/EMAIL_DELIVERY_POLICY.md` (발송 정책 — PlanQ SMTP / Custom SMTP),
> `docs/ENTITY_PROFILE_SPEC.md` (예정), `docs/TASK_VISIBILITY_REDESIGN.md` (예정).

---

## 0. 비전

**Front + Slack + Linear 의 메일 모듈 — B2B SaaS 안에서 일하는 사람을 위한 공동 인박스.**

핵심 원칙:
1. **메일도 대화방이다** — Q Talk 의 conversation 패턴 그대로 (인박스 = 리스트 / 스레드 = 본문 / 우측 = ContextPanel)
2. **메일은 고객/프로젝트에 귀속** — 외부 메일 주소가 들어오면 자동 client 매칭. 매칭 안 되면 "미할당" 인박스.
3. **AI 재사용** — 이슈 추출 + 업무 추출 = Q Talk 와 같은 엔진. source 만 다름 (`source_type='email_thread'`).
4. **읽기 우선, 발송 보조** — 1차 목표는 받은 메일을 팀이 같이 처리. 발송은 답장/포워드 위주. 신규 발송 메일 캠페인은 별도 도구.

---

## 1. 사용 시나리오

### 1.1 받은 메일 처리 (인박스)

```
1. 고객이 contact@우리회사.com 으로 메일 발송
2. IMAP fetch (5분 cron) → email_messages 신규 row + email_threads 매칭/생성
3. From 주소 → clients.email 매칭 → client_id 자동 설정
4. /mail 인박스에 "New" 표시 + 좌측 사이드바 unread 카운트 +1
5. socket emit 'mail:new' → 본인이 /mail 열고 있으면 즉시 표시
6. AI 자동 추출: 이슈/업무 후보 → ContextPanel "후보" 섹션
```

### 1.2 답장

```
1. 스레드 열기 → "답장" 클릭 → 본문 작성 (Tiptap, attachment 가능)
2. 발송 → SMTP (PlanQ default 또는 워크스페이스 custom)
3. email_messages 신규 row (direction='outbound')
4. 같은 스레드 안에 시간순 추가
```

### 1.3 포워드 / 새 메일

```
- "포워드" — 본문 + 첨부 그대로, To 새로 입력
- "새 메일" — From 워크스페이스, To/Cc/Bcc 입력, client 자동 매칭
```

### 1.4 동시 작업 (Front 패턴)

```
- 같은 스레드에 여러 멤버가 "답장 작성 중" 동시 진입 시
- 다른 멤버가 작성 중이면 "OO 답변 작성 중" 인디케이터
- 락 mechanism — 발송 전까지 draft 공유 안 함 (Front 와 다름. 단순화)
```

### 1.5 라벨/필터

```
- 라벨: "처리중", "고객문의", "내부", custom 자유 (PostCategory 패턴)
- 필터: client / project / member / 라벨 / unread / starred / archived
```

---

## 2. 데이터 모델

### 2.1 신규 테이블 6개

```sql
-- 1. email_accounts (워크스페이스 단위 IMAP/SMTP 계정)
CREATE TABLE email_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL REFERENCES businesses(id),
  email VARCHAR(255) NOT NULL,           -- e.g., contact@회사.com
  display_name VARCHAR(100),              -- "회사 고객지원"
  -- IMAP 연결
  imap_host VARCHAR(200),
  imap_port INT DEFAULT 993,
  imap_username VARCHAR(255),
  imap_password_encrypted TEXT,           -- AES-256-GCM
  imap_tls BOOLEAN DEFAULT TRUE,
  imap_folder VARCHAR(50) DEFAULT 'INBOX',
  imap_last_uid INT DEFAULT 0,            -- IMAP UIDNEXT 추적
  -- SMTP 연결 (발송 — businesses.smtp_config 와 별도, account 단위 발송)
  smtp_host VARCHAR(200),
  smtp_port INT DEFAULT 587,
  smtp_username VARCHAR(255),
  smtp_password_encrypted TEXT,
  -- 상태
  is_active BOOLEAN DEFAULT TRUE,
  last_sync_at DATETIME,
  last_sync_error TEXT,
  created_at DATETIME, updated_at DATETIME,
  INDEX (business_id, email)
);

-- 2. email_threads (스레드 — 같은 Subject + 같은 참여자 클러스터)
CREATE TABLE email_threads (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL REFERENCES businesses(id),
  account_id INT NOT NULL REFERENCES email_accounts(id),
  subject VARCHAR(500),                   -- 첫 메시지 subject (Re:/Fwd: stripped)
  -- 자동 매칭 결과
  client_id INT REFERENCES clients(id),   -- null = 미할당
  project_id BIGINT REFERENCES projects(id),
  -- 상태
  is_archived BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  labels JSON,                            -- ["고객문의", "처리중"]
  -- 메타
  message_count INT DEFAULT 0,
  unread_count INT DEFAULT 0,
  last_message_at DATETIME,
  last_message_preview VARCHAR(500),      -- 인박스 행 미리보기
  participants JSON,                      -- [{name, email, is_internal}, ...]
  -- vlevel (PlanQ visibility 통일)
  vlevel ENUM('L1','L2','L3','L4') DEFAULT 'L3',  -- 기본 워크스페이스 전체
  target_member_ids JSON,
  -- 공유 link
  share_token VARCHAR(64),
  created_at DATETIME, updated_at DATETIME,
  INDEX (business_id, last_message_at DESC),
  INDEX (business_id, client_id),
  INDEX (business_id, vlevel),
  UNIQUE INDEX (share_token)
);

-- 3. email_messages (스레드 안 개별 메시지)
CREATE TABLE email_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  business_id INT NOT NULL REFERENCES businesses(id),
  direction ENUM('inbound', 'outbound') NOT NULL,
  -- IMAP / SMTP 식별자
  message_id VARCHAR(500),                -- RFC822 Message-ID
  in_reply_to VARCHAR(500),               -- 답장 추적
  imap_uid INT,                           -- IMAP UID (inbound only)
  -- From/To/Cc/Bcc
  from_email VARCHAR(255), from_name VARCHAR(100),
  to_emails JSON,                         -- [{email, name}, ...]
  cc_emails JSON,
  bcc_emails JSON,                        -- outbound 만 (개인정보 보호)
  -- 본문
  subject VARCHAR(500),
  body_html LONGTEXT,
  body_text LONGTEXT,                     -- plain (검색용)
  -- 발신자
  sent_by_user_id INT REFERENCES users(id),   -- outbound 시 멤버 ID
  is_read BOOLEAN DEFAULT FALSE,
  -- 상태
  delivery_status ENUM('pending','sent','delivered','bounced','failed') DEFAULT 'sent',
  delivery_error TEXT,
  -- 외부 식별
  spam_score FLOAT,
  -- 메타
  sent_at DATETIME NOT NULL,              -- IMAP 기준 또는 SMTP send 시각
  created_at DATETIME, updated_at DATETIME,
  INDEX (thread_id, sent_at),
  INDEX (business_id, direction, sent_at DESC),
  INDEX (message_id)
);

-- 4. email_attachments (메시지 첨부 — File 통일)
CREATE TABLE email_attachments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  message_id INT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  file_id INT REFERENCES files(id),       -- File 통합 인박스 (자동 저장)
  -- inbound 첨부 raw 정보 (File 변환 전)
  filename VARCHAR(255),
  mime_type VARCHAR(100),
  size_bytes BIGINT,
  content_id VARCHAR(100),                -- inline image cid:
  is_inline BOOLEAN DEFAULT FALSE,
  created_at DATETIME,
  INDEX (message_id)
);

-- 5. email_thread_participants (스레드별 멤버 — 읽음/배정)
CREATE TABLE email_thread_participants (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  -- 역할
  is_assigned BOOLEAN DEFAULT FALSE,      -- "내 담당" 표시 (Front 패턴)
  is_following BOOLEAN DEFAULT FALSE,     -- "팔로우" 새 메시지 알림
  -- 읽음 추적
  last_read_message_id INT,
  last_read_at DATETIME,
  -- 메타
  created_at DATETIME, updated_at DATETIME,
  UNIQUE INDEX (thread_id, user_id),
  INDEX (user_id, is_assigned, is_following)
);

-- 6. email_drafts (작성 중 답장 — 임시저장)
CREATE TABLE email_drafts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  thread_id INT REFERENCES email_threads(id) ON DELETE CASCADE,
  business_id INT NOT NULL REFERENCES businesses(id),
  user_id INT NOT NULL REFERENCES users(id),
  in_reply_to_message_id INT REFERENCES email_messages(id),
  to_emails JSON, cc_emails JSON, bcc_emails JSON,
  subject VARCHAR(500),
  body_html LONGTEXT,
  attachment_file_ids JSON,               -- [file_id, ...] (File 인박스)
  created_at DATETIME, updated_at DATETIME,
  INDEX (user_id, updated_at DESC)
);
```

### 2.2 기존 테이블 확장

```sql
-- clients 에 이미 email 컬럼 있음 — 추가 매칭용 필드
ALTER TABLE clients ADD COLUMN email_aliases JSON;  -- 같은 고객의 다른 메일 주소들

-- task_candidates 에 source_type 'email_thread' 추가 (이미 있을 수 있음)
ALTER TABLE task_candidates MODIFY COLUMN source_type
  ENUM('conversation','email_thread','meeting','manual','ai') DEFAULT 'conversation';
```

---

## 3. API 설계

### 3.1 EmailAccount (워크스페이스 admin only)

```
GET    /api/businesses/:bizId/email-accounts        -- list
POST   /api/businesses/:bizId/email-accounts        -- 신규 (IMAP test 포함)
PUT    /api/businesses/:bizId/email-accounts/:id    -- 수정
DELETE /api/businesses/:bizId/email-accounts/:id    -- 비활성화 (data 보존)
POST   /api/businesses/:bizId/email-accounts/:id/sync-now   -- 즉시 sync
POST   /api/businesses/:bizId/email-accounts/:id/test       -- 연결 테스트
```

### 3.2 EmailThread (인박스)

```
GET    /api/businesses/:bizId/email-threads
  ?account_id=&client_id=&project_id=&label=&unread=&starred=&archived=
  &page=&limit=          -- pagination 표준
GET    /api/businesses/:bizId/email-threads/:id      -- 상세 + messages
PUT    /api/businesses/:bizId/email-threads/:id      -- archive/star/label/client/project 변경
DELETE /api/businesses/:bizId/email-threads/:id      -- soft delete (는 archive 권장)
POST   /api/businesses/:bizId/email-threads/:id/mark-read
POST   /api/businesses/:bizId/email-threads/:id/assign       body: { user_id }
POST   /api/businesses/:bizId/email-threads/:id/follow       body: { follow: bool }
PUT    /api/businesses/:bizId/email-threads/:id/visibility   body: { level, project_id?, target_member_ids? }
```

### 3.3 EmailMessage (개별 메시지)

```
POST   /api/businesses/:bizId/email-threads/:id/messages   -- 답장 발송
  body: { body_html, attachment_file_ids?, cc?, bcc?, send_as_account_id }
POST   /api/businesses/:bizId/email-messages                -- 신규 스레드 발송
  body: { to, cc?, bcc?, subject, body_html, attachment_file_ids?, account_id }
POST   /api/businesses/:bizId/email-messages/:id/forward    -- 포워드
GET    /api/businesses/:bizId/email-messages/:id            -- 단일 (HTML 전체)
```

### 3.4 EmailDraft (작성중)

```
GET    /api/businesses/:bizId/email-drafts                  -- 내 draft list
POST   /api/businesses/:bizId/email-drafts                  -- 신규
PUT    /api/businesses/:bizId/email-drafts/:id              -- AutoSave
DELETE /api/businesses/:bizId/email-drafts/:id              -- 폐기
POST   /api/businesses/:bizId/email-drafts/:id/send         -- 발송 → message + draft delete
```

### 3.5 공개 share

```
GET    /api/email-threads/public/by-token/:token            -- 외부 공유 (L4)
```

---

## 4. UI 설계

### 4.1 페이지 구조 (3컬럼 — Q Talk 패턴 재사용)

```
/mail
┌───────────┬─────────────────────────┬──────────────────────┐
│ Folders   │ Thread List (Inbox)     │ Thread Detail        │
│           │                          │                       │
│ ▸ 인박스   │ ▾ 인박스 (5)             │ Subject              │
│   미할당   │ ┌──────────────────────┐ │ ─────────────────── │
│   내 담당  │ │ 고객A · 2시간 전  ●   │ │ From: ... · To: ... │
│   팔로우   │ │ Re: 견적 요청...      │ │                       │
│ ▸ 라벨     │ │ 본문 미리보기...      │ │ <iframe sandbox       │
│   고객문의 │ └──────────────────────┘ │   srcdoc=body_html>   │
│   내부     │ ┌──────────────────────┐ │                       │
│   처리중   │ │ 고객B · 1일 전        │ │ [답장] [포워드]       │
│ ▸ 보관함   │ │ 신규 문의             │ │ ─────────────────── │
│           │ └──────────────────────┘ │ ContextPanel (4-A)    │
│ + 새 메일 │                          │ [후보][이슈][할일]    │
└───────────┴─────────────────────────┴──────────────────────┘
```

### 4.2 핵심 컴포넌트

| 컴포넌트 | 경로 | 패턴 |
|---|---|---|
| `MailPage` | `pages/QMail/MailPage.tsx` (신규) | Q Talk Page 패턴 복사 |
| `MailFolderTree` | `pages/QMail/MailFolderTree.tsx` | Q docs FolderTree 패턴 |
| `MailThreadList` | `pages/QMail/MailThreadList.tsx` | Q Talk LeftPanel 패턴 |
| `MailThreadDetail` | `pages/QMail/MailThreadDetail.tsx` | Q Talk ChatPanel + iframe sandbox |
| `MailReplyEditor` | `pages/QMail/MailReplyEditor.tsx` | Tiptap (Q docs editor 재사용) |
| `MailContextPanel` | `components/Context/ContextPanel.tsx` (이미 Phase 9 공통) | Q Talk RightPanel 재사용 |
| `NewMailModal` | `pages/QMail/NewMailModal.tsx` | To/Cc/Bcc input + Tiptap + AttachmentField |
| `EmailAccountSettings` | `pages/Settings/EmailAccountSettings.tsx` | IMAP/SMTP 등록 |

### 4.3 반응형 — 모바일

- ≤768px: 3컬럼 → 단일 컬럼 마스터-디테일 드릴다운 (Q Talk 패턴)
- Folder tree → hamburger (overlay)
- Thread list → 전체 화면
- Detail → 슬라이드 push
- 답장 → 풀스크린 modal

---

## 5. IMAP/SMTP 통합

### 5.1 IMAP fetch cron (services/emailImapCron.js — 신규)

```js
// 5 분 cron — 활성 email_accounts 의 신규 메일 fetch
// 1. accounts WHERE is_active=true AND last_sync_at < NOW() - 5min
// 2. 각 account 에 대해:
//    - IMAP login (imap-simple)
//    - UID > last_uid 메일 fetch (limit 50)
//    - 각 메시지: parse → email_messages 신규 row
//    - thread 매칭: same In-Reply-To OR same Subject + same participants
//    - client 매칭: from email → clients.email (또는 email_aliases)
//    - attachment 자동 File 저장 (visibility=L3, folder='Email Attachments')
//    - thread.unread_count++, last_message_*, participants 갱신
//    - socket emit 'mail:new' to business room
// 3. last_uid + last_sync_at 갱신
// 4. 에러 시 last_sync_error 기록 + admin notify (3회 연속 실패 시)
```

### 5.2 SMTP 발송 (services/emailSendService.js — 신규)

```js
// EMAIL_DELIVERY_POLICY 정합
// 1. send_as_account_id 가 있으면 그 account.smtp_* 사용
// 2. 없으면 businesses.smtp_config (Pro+ custom)
// 3. 없으면 PlanQ default (env SMTP_*)
// 4. nodemailer + Message-ID + In-Reply-To 헤더
// 5. 발송 후 email_messages outbound row + thread 갱신
// 6. delivery_status='sent' → SMTP receipt 시 'delivered' / bounce 'bounced'
// 7. EmailLog 통합 (기존 모델 재사용)
```

### 5.3 bounce / spam 처리

- bounce — Mailgun-style hard bounce 시 client.email_status='bounced' marking
- spam — spam_score > 5.0 시 자동 archived (별도 폴더 노출)

---

## 6. 권한 매트릭스

| 역할 | 인박스 | 스레드 상세 | 답장 | 새 메일 | 계정 관리 |
|---|---|---|---|---|---|
| **Owner** | 전체 | 전체 | O | O | O |
| **Admin** | 전체 | 전체 | O | O | O |
| **Member** | 본인 담당 + 미할당 + L3 | 본인 담당 + L2-members + L3 + L4 | O | O | X |
| **Client** | 본인 client_id 스레드만 (L4) | 같음 | O (자기 스레드 답장만) | X | X |
| **Cue (AI)** | (API 호출) | 이슈/업무 자동 추출 | X | X | X |

`menu_permission.js requireMenu('qmail', 'read|write')` 적용. PERMISSION_MATRIX §5.X 추가.

---

## 7. AI 이슈/업무 추출 (재사용)

```js
// task_extractor.js 에 source_type 'email_thread' 분기
// 1. 새 inbound 메시지 도착 → 백그라운드 job queue
// 2. body_text + 최근 5 메시지 context → LLM (gpt-4o-mini)
// 3. 추출된 후보 → task_candidates (source_type='email_thread', source_ref_id=thread.id)
// 4. ContextPanel "후보" 섹션에 표시 (Q Talk 와 동일 UI)
// 5. 멤버 승인 시 → tasks 신규 + task_candidates.status='accepted'
```

이슈 추출 — `context_issues` 테이블 (Phase 9 신규) 에 entity_type='email_thread', entity_id 으로 저장. 같은 ContextPanel 컴포넌트 재사용.

---

## 8. 실시간 동기화 (CLAUDE.md 운영 안정성 16번)

| Event | broadcast 대상 | 시점 |
|---|---|---|
| `mail:new` | `business:${bizId}` | IMAP fetch 신규 메시지 |
| `mail:updated` | `business:${bizId}` | thread/message 변경 |
| `mail:deleted` | `business:${bizId}` | thread archived/deleted |
| `mail:read` | `user:${userId}` | 본인 read 상태 변경 (다중 디바이스) |
| `mail:draft:updated` | `user:${userId}` | draft 변경 |

frontend: MailPage mount → `s.emit('join:business', bizId)` + `s.on('mail:*', debouncedReload)`.

---

## 9. 마이그레이션 단계 (9주 Phase 9 일부)

| 단계 | 주차 | 작업 |
|---|---|---|
| **M0 - 기획** | (완료) | Q_MAIL_SPEC.md (이 문서) + ENTITY_PROFILE_SPEC + TASK_VISIBILITY_REDESIGN |
| **M1 - DB + IMAP** | 1주 | 6 신규 테이블 + EmailImapCron + EmailAccount CRUD |
| **M2 - 인박스 read-only** | 1주 | MailPage 3컬럼 + MailThreadList + MailThreadDetail (iframe sandbox) + client 자동 매칭 |
| **M3 - 답장/포워드** | 1주 | MailReplyEditor + EmailSendService + draft autosave |
| **M4 - 새 메일 발송** | 0.5주 | NewMailModal |
| **M5 - AI 추출 통합** | 0.5주 | task_extractor source_type='email_thread' + ContextPanel 후보 섹션 |
| **M6 - 라벨/필터/검색** | 0.5주 | MailFolderTree custom 라벨 + 풀텍스트 검색 (MySQL FULLTEXT 또는 OpenSearch) |
| **M7 - 권한/visibility** | 0.5주 | menu_permission qmail + vlevel L1-L4 + client 자기 스레드만 |
| **M8 - 모바일 반응형** | 0.5주 | 단일 컬럼 드릴다운 + 풀스크린 답장 |
| **M9 - 운영** | 0.5주 | bounce 처리 + spam 필터 + admin 알림 + audit |

총 **6.5주** (UNIFIED_CONTEXT_DESIGN 의 Phase 9 9주 중 큰 부분).

---

## 10. 미적용 (다른 사이클로)

- **Outlook OAuth / Gmail OAuth** — IMAP password 대신 OAuth token. 운영 진입 후 추가
- **메일 발송 캠페인** — Mailchimp 같은 bulk 발송. Q Mail 의 범위 아님
- **메일 자동 라우팅 룰** — "From 이 X 면 자동 라벨 Y" — M9 이후 별도 cycle
- **메일 템플릿** — Q docs 의 DocumentTemplate 재사용 (kind='email')
- **서명 (signature)** — DocumentTemplate kind='email_signature' 박제됨 (INTEGRATED_ARCHITECTURE)
- **delegate / 위임** — 다른 멤버에게 메일 위임 발송. M9 이후

---

## 11. 보안/개인정보

- **IMAP/SMTP password** — AES-256-GCM 암호화 (`crypto/encryption.js`)
- **본문 iframe sandbox** — script/form/popup 차단 (XSS 방지)
- **inline image cid:** — File 저장 후 srcdoc 안에서 직접 src 변환
- **외부 링크** — `target="_blank" rel="noopener noreferrer"` 강제
- **BCC** — inbound 시 다른 수신자 노출 금지 (DB 저장 X, 본인 만)
- **GDPR — 메일 삭제** — soft delete (archived) + 30일 후 hard delete cron

---

## 12. 검증 시나리오 (M2 완료 후 PR 단위)

1. IMAP 새 메일 fetch → 인박스 즉시 표시 (socket)
2. 같은 client 의 새 메일 → 같은 스레드에 묶임
3. 다른 워크스페이스 token 으로 thread GET → 403
4. client 역할이 본인 스레드만 보이는지
5. 모바일 (375px) 에서 단일 컬럼 드릴다운
6. 답장 발송 → outbound row + recipients 메일 도착
7. 첨부 inline image 정상 렌더 (cid 변환)
8. share_token L4 외부 접속 가능

---

## 13. 운영 비용

- IMAP fetch 5분 cron — account 당 평균 50 메일/일 → 1일 100 호출. 무료 SMTP/IMAP 인프라.
- 저장 — 메시지 body 평균 5KB, 첨부 평균 200KB. 100명 워크스페이스 / 일 100 메일 = 25MB/일 ≈ 9GB/년.
- AI 추출 — gpt-4o-mini ($0.15/1M input). 메일 1개당 500 token = $0.0001. 1일 100 메일 = $0.01/일 = $3.6/년/워크스페이스.

---

> **다음 단계** — 사용자 합의 후 M1 (DB + IMAP) 시작. 그 전 `ENTITY_PROFILE_SPEC.md` + `TASK_VISIBILITY_REDESIGN.md` 도 같이 작성 권장 (Phase 9 메인 의존).
