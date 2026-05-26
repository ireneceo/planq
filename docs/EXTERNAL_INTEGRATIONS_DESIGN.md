# 외부 연동 통합 설계 (External Integrations) — 2026-05-26

> **Phase 9 의 기반 작업.** 워크스페이스/개인 scope 명확 분리 + 모든 외부 자원 (Google Calendar/Drive/Mail · Microsoft 등) 통일 모델.
>
> 관련: `docs/Q_MAIL_SPEC.md` · `docs/UNIFIED_CONTEXT_DESIGN.md` · `docs/EMAIL_DELIVERY_POLICY.md`

---

## 0. 문제 진단 (현재 상태)

### 0.1 30년차 진단 — 사용자 호소 (2026-05-26)

> "캘린더 연동은 사실 보통 개인단위로 하잖아. 그런데 지금 솔루션에 캘린더 연동이 유저단위가 아니지? 구글드라이브는 팀단위로 맞는 것 같은데 이것도 개인도 해야 하는 건 아닐까? 그리고 메일은? 메일도 회메일이 있지만 개인메일은? 어떤 회사들은 다 개인메일로 제공하기도 하는데. 지금 외부연동이 팀, 개인 정리가 안되어 있어. 팀설정으로 모두 연동 + 개인설정 가능연동 따로 있으면 좋지."

**현재 PlanQ 의 잘못된 가정 — 모든 외부 연동이 워크스페이스 단위 (1개):**

| 자원 | 현재 (잘못) | 30년차 정합 |
|---|---|---|
| **Google Drive** | 워크스페이스 단위만 | 워크스페이스 (공유 폴더) + 개인 (옵션) |
| **Google Calendar** | 워크스페이스 단위만 (1개) | **개인 단위가 default** (각자 본인 calendar) + 워크스페이스 공용 (회사 공유 calendar) |
| **Gmail / Outlook** | 워크스페이스 단위 | **개인 + 회사 공유 둘 다** (회사 contact@ + 개인 me@gmail.com) |

### 0.2 실제 운영 사례 비교

| 제품 | Calendar | Mail | Drive | 패턴 |
|---|---|---|---|---|
| **Notion Calendar** | 개인 GCal | — | — | 개인 위주 |
| **Slack** | 개인 GCal | — | 워크스페이스 | 혼합 |
| **Linear** | 개인 GCal + GitHub | — | — | 개인 위주 |
| **Front** | 워크스페이스 (공동 인박스) | 워크스페이스 + 개인 | — | 혼합 |
| **Apple Mail / Outlook** | 개인 multi-account | 개인 multi-account | iCloud | 개인 위주 |
| **PlanQ (현재)** | 워크스페이스 only ❌ | 워크스페이스 only ❌ | 워크스페이스 only | 팀 위주 (불완전) |
| **PlanQ (목표)** | 워크스페이스 + 개인 ✓ | 워크스페이스 + 개인 ✓ | 워크스페이스 + 개인 ✓ | **통합 (혼합)** |

### 0.3 실제 시나리오 — 왜 둘 다 필요?

**시나리오 A: 1인 기업 (Irene 같은 케이스)**
- 회사 메일 X. `irene@personal.com` Gmail 만 씀
- 개인 Calendar 가 곧 업무 Calendar
- → 모든 외부 연동이 **개인 단위로만** 작동해야 함

**시나리오 B: 5명 스타트업**
- 회사 도메인 메일 (`hello@startup.com`) — 공동 처리
- 각자 개인 Gmail/Calendar — 업무 일정 본인 관리
- → **둘 다 필요** (회사 공유 + 개인 단위)

**시나리오 C: 50명 회사**
- 회사 Google Workspace 도입 (각자 회사 도메인 계정)
- 회사 공용 calendar (회의실 / 출장 등)
- → 회사 계정 1개 = 워크스페이스 + 본인 (같은 Google 계정 양쪽 활용)

**모두 같은 코드로 해결되려면** → **owner_scope (workspace | user) 패턴 필수**.

---

## 1. 설계 원칙

### 1.1 owner_scope 명시
모든 외부 연동은 **명시적으로** `owner_scope` 가짐:
- **`workspace`**: 워크스페이스 자원 (admin 만 등록/관리, 모든 멤버 접근)
- **`user`**: 개인 자원 (본인만 관리/조회)

### 1.2 동일 provider 의 다른 instance
같은 사용자가 같은 provider 의 여러 account 가질 수 있음:
- `Calendar` 본인 회사 GCal + 본인 개인 GCal
- `Mail` 회사 메일 + 개인 메일 (개인 1개 이상 가능)

### 1.3 UI 분리 (혼란 차단)

**워크스페이스 설정** (`/business/settings/integrations`) — admin only
```
회사 외부 연동
  ├─ 회사 Google Drive (1개) — 공유 폴더
  ├─ 회사 Google Calendar (1개) — 공용 calendar
  ├─ 회사 메일 계정 (N개) — contact@ / sales@ 등 공동 인박스
  └─ Microsoft 365 (옵션)
```

**개인 설정** (`/profile/integrations`) — 본인만
```
내 외부 연동
  ├─ Google 로그인 (PlanQ 로그인용) — OauthConnection (이미 있음)
  ├─ 내 Google Calendar — 본인 일정 PlanQ 통합 뷰
  ├─ 내 Google Drive (옵션) — 개인 파일 끌어와 보기
  └─ 내 개인 메일 (N개) — irene@personal.com 등
```

### 1.4 통합 뷰

| 영역 | 워크스페이스 source | 개인 source | 통합 표시 |
|---|---|---|---|
| **Q Calendar** | 회사 공유 calendar (옵션) | 내 calendar (default) | 색깔 분리 overlay (회사=teal / 개인=violet) |
| **Q Mail** | 회사 인박스 (공동 처리) | 개인 인박스 (본인만) | 폴더트리 좌측 "회사 / 개인" 분리 + 한꺼번에 보기 |
| **Q File (Drive)** | 워크스페이스 GDrive 폴더 | 내 GDrive (옵션) | 별도 탭 (회사 / 내 파일) |

---

## 2. 데이터 모델

### 2.1 `external_connections` 신규 테이블 (통합 모델)

```sql
CREATE TABLE external_connections (
  id INT PRIMARY KEY AUTO_INCREMENT,
  -- 핵심: scope 명시
  owner_scope ENUM('workspace', 'user') NOT NULL,
  business_id INT NOT NULL REFERENCES businesses(id),    -- 항상 필수 (tenant 격리)
  user_id INT NULL REFERENCES users(id),                  -- owner_scope='user' 일 때만 NOT NULL (실제로 not null 검증은 hook)
  -- provider
  provider ENUM(
    'google_calendar', 'google_drive', 'gmail',
    'microsoft_calendar', 'microsoft_drive', 'outlook',
    'apple_calendar'                                       -- 향후
  ) NOT NULL,
  -- 인증
  auth_type ENUM('oauth', 'password', 'app_password') NOT NULL,
  access_token_encrypted TEXT NULL,
  refresh_token_encrypted TEXT NULL,
  password_encrypted TEXT NULL,                           -- IMAP 옛 방식 (auth_type='password')
  expires_at DATETIME NULL,
  scope TEXT NULL,                                         -- OAuth 권한 범위
  -- 외부 계정 식별
  account_email VARCHAR(255) NOT NULL,                    -- 사용자 인지 표시 (모든 provider 공통)
  account_external_id VARCHAR(255) NULL,                  -- Google sub, Microsoft oid 등
  account_name VARCHAR(100) NULL,                          -- "회사 고객지원" / "Irene Personal"
  -- IMAP/SMTP 호스트 정보 (provider='gmail'/'outlook' 의 password 방식)
  imap_host VARCHAR(200) NULL,
  imap_port INT NULL,
  imap_tls BOOLEAN DEFAULT TRUE,
  imap_folder VARCHAR(50) DEFAULT 'INBOX',
  imap_last_uid INT DEFAULT 0,
  smtp_host VARCHAR(200) NULL,
  smtp_port INT NULL,
  smtp_tls BOOLEAN DEFAULT TRUE,
  -- 상태
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,              -- 같은 (scope, provider) 안에 1개만
  last_sync_at DATETIME NULL,
  last_sync_error TEXT NULL,
  fail_count INT NOT NULL DEFAULT 0,
  -- provider-specific metadata (Google root folder id 등)
  metadata JSON NULL,
  created_at DATETIME, updated_at DATETIME,
  -- 인덱스 + UNIQUE
  INDEX (business_id, owner_scope, provider, is_active),
  INDEX (user_id, provider, is_active),                   -- 개인 빠른 list
  -- workspace scope: 같은 (business, provider, account_email) 1개
  -- user scope: 같은 (user, provider, account_email) 1개
  UNIQUE KEY ext_conn_unique (business_id, owner_scope, user_id, provider, account_email)
);
```

### 2.2 옛 모델 backward-compat 전략

**옛 모델 유지** (1~2 사이클 동안):
- `business_cloud_tokens` (GDrive + Calendar)
- `email_accounts` (Q Mail M1)

**점진 마이그레이션:**
- Phase 1 (지금): `external_connections` 신설 + read/write both 모델 (옛 모델 그대로 사용)
- Phase 2: 새 코드는 `external_connections` 만 — 옛 모델 ALTER 시 동기 hook
- Phase 3: 옛 모델 deprecated marking + 운영 1개월 모니터링
- Phase 4: 옛 모델 데이터 이전 + DROP

**호환 헬퍼:** `services/externalConnection.js` — 옛/새 모델 동시 조회 union (gradual)

### 2.3 사용자 모델 옛 컬럼 정합

`users` 테이블에 personal scope 추적 필드 — **추가 안 함** (external_connections.user_id 만으로 충분).

---

## 3. API 설계

### 3.1 통합 endpoint

```
─── 워크스페이스 (admin only) ────────────────────────
GET    /api/businesses/:bizId/external-connections
  ?owner_scope=workspace&provider=
POST   /api/businesses/:bizId/external-connections
  body: { owner_scope: 'workspace', provider, account_email, ... }
PUT    /api/businesses/:bizId/external-connections/:id
DELETE /api/businesses/:bizId/external-connections/:id
POST   /api/businesses/:bizId/external-connections/:id/test
POST   /api/businesses/:bizId/external-connections/:id/sync-now
POST   /api/businesses/:bizId/external-connections/:id/set-default

─── 개인 (본인만) ──────────────────────────────────
GET    /api/me/external-connections
  ?provider=&business_id=          # 워크스페이스 컨텍스트 (멤버십 검증)
POST   /api/me/external-connections
  body: { provider, business_id, account_email, ... }
PUT    /api/me/external-connections/:id
DELETE /api/me/external-connections/:id

─── OAuth 흐름 (workspace/user 분기) ────────────────
GET    /api/oauth/{provider}/initiate?owner_scope=workspace|user&business_id=:id&return_to=
GET    /api/oauth/{provider}/callback?code=&state=
       (state encode: { owner_scope, business_id, user_id?, return_to })
```

### 3.2 옛 endpoint 유지 (deprecated 표시)
- 옛 `/api/cloud/initiate/gdrive` `/api/cloud/initiate/gcal` 그대로 작동
- 옛 `/api/businesses/:bizId/email-accounts` 그대로 작동
- 새 코드는 `/api/me/external-connections` 사용 권장

---

## 4. UI 설계

### 4.1 워크스페이스 설정 (`/business/settings/integrations`)

```
PageShell "회사 외부 연동" (admin only)
  
  ▾ Google Workspace
    ✓ 회사 Google Drive — workspace@company.com  [편집] [해제]
    ✓ 회사 Google Calendar — workspace@company.com  [편집] [해제]
    [+ Google Workspace 연결]
  
  ▾ 회사 메일 계정 (Q Mail)
    ✓ contact@company.com (Gmail OAuth)  [편집] [해제]
    ✓ sales@company.com (IMAP password)  [편집] [해제]
    [+ 메일 계정 추가]  [Gmail 로 연결]
  
  ▾ Microsoft 365 (옵션)
    [Microsoft 365 연결]
```

### 4.2 개인 설정 (`/profile/integrations`) — 신규 탭

```
PageShell "내 외부 연동"

  ▾ 로그인
    ✓ Google — irene@gmail.com  [해제]
    [Microsoft 연결]
  
  ▾ 캘린더
    ✓ Google Calendar — irene@gmail.com  [편집] [해제]
       "내 일정을 Q Calendar 에서 함께 봐요"
    [+ Calendar 추가]
  
  ▾ 메일 (개인)
    ✓ Gmail — irene@gmail.com  [편집] [해제]
    [+ 개인 메일 추가]  [Gmail 로 연결]
  
  ▾ 파일 (개인, 옵션)
    [Google Drive 연결 — 내 파일 보기]
```

### 4.3 통합 뷰 — Q Calendar 색깔 분리

```
Q Calendar 페이지
  좌측 필터:
    ☑ 회사 일정 (teal #14B8A6)
    ☑ 내 일정 (violet #8B5CF6)
    ☑ 업무 일정 (orange #F59E0B)
  
  본문: 색깔별 이벤트 overlay
```

### 4.4 통합 뷰 — Q Mail 폴더트리 분리

```
Q Mail 페이지
  좌측 폴더트리:
    ▾ 회사 인박스
        ▸ contact@company.com (12)
        ▸ sales@company.com (3)
    ▾ 내 인박스
        ▸ irene@gmail.com (45)
    ▾ 라벨 (공통)
        ...
```

---

## 5. 권한 매트릭스

| 자원 | Owner | Admin | Member | Client |
|---|---|---|---|---|
| 워크스페이스 external_connections list | ✓ | ✓ | view only | X |
| 워크스페이스 external_connections 등록/수정/삭제 | ✓ | ✓ | X | X |
| 본인 external_connections list/등록/수정/삭제 | ✓ | ✓ | ✓ | ✓ (옵션) |
| 다른 멤버의 external_connections | X | X | X | X |
| 다른 멤버 calendar 일정 (공유 표시) | view (옵션) | view (옵션) | view (옵션) | X |

**핵심: 개인 자원은 본인만 관리.** admin 도 다른 사람 개인 메일/calendar token 보면 안 됨 (개인정보 보호).

---

## 6. OAuth Provider 매트릭스

### 6.1 Google (같은 GOOGLE_CLIENT_ID 공유)

| Use case | scope | redirect URI | owner_scope |
|---|---|---|---|
| **PlanQ 로그인** | openid+email+profile | /api/auth/google/callback | (oauth_connections — 별도) |
| **워크스페이스 GDrive** | drive.file | /api/cloud/callback/gdrive | workspace |
| **워크스페이스 GCal** | calendar | /api/cloud/callback/gcal | workspace |
| **워크스페이스 Gmail** | mail.google.com + email | /api/businesses/email-accounts/oauth/gmail/callback | workspace |
| **개인 GCal** ★ | calendar | /api/me/oauth/gcal/callback (신규) | user |
| **개인 GDrive** ★ | drive.file | /api/me/oauth/gdrive/callback (신규) | user |
| **개인 Gmail** ★ | mail.google.com + email | /api/me/oauth/gmail/callback (신규) | user |

★ — Phase 1+ 신규

### 6.2 Microsoft (향후 — B/D task)

같은 패턴: workspace + user scope 분기.

---

## 7. 마이그레이션 단계

| Phase | 작업 | 작업량 |
|---|---|---|
| **Phase 1** (지금) | external_connections 신설 + 설계 문서 (이 문서) + Profile 외부 연동 탭 (read-only display 옛 데이터) | 3~4일 |
| **Phase 2** | 개인 GCal OAuth + Q Calendar overlay | 1주 |
| **Phase 3** | 개인 Gmail OAuth + Q Mail 폴더트리 분리 | 1주 |
| **Phase 4** | 개인 GDrive + Q File 개인 탭 | 3일 |
| **Phase 5** | Microsoft (Outlook OAuth + Calendar) | 1주 |
| **Phase 6** | 옛 모델 (business_cloud_tokens / email_accounts) → external_connections 데이터 마이그레이션 | 3일 |
| **Phase 7** | 옛 모델 deprecated → DROP | 1일 |

---

## 8. 검증 시나리오

1. Phase 1 — Profile 외부 연동 탭 200 OK + 옛 데이터 read-only 표시
2. Phase 2 — 개인 GCal 연결 → Q Calendar 에 본인 일정 violet 색 overlay
3. Phase 2 — 같은 사용자가 회사 GCal (workspace) + 개인 GCal (user) 둘 다 연결 → 같이 보임
4. Phase 3 — 개인 Gmail 연결 → Q Mail 폴더트리 "내 인박스" 신규 + 5분 cron fetch
5. 권한 — 본인 외 다른 사용자 personal external_connections GET → 403
6. 같은 워크스페이스 다른 멤버 — 회사 메일 계정 (workspace scope) 같이 봄 / 개인 메일 (user scope) 못 봄

---

## 9. 운영 비용

추가 비용 0 — 같은 OAuth client + 같은 IMAP/SMTP 인프라 재사용. DB 만 1 테이블 추가.

---

## 10. 보안

- 모든 token (access/refresh/password) — AES-256-GCM 암호화 (`services/encryption.js` 재사용)
- 개인 자원 — 본인만 조회 (admin 도 차단). audit log 에 owner_scope+user_id 기록
- DELETE 시 OAuth provider 측 token revoke 시도 (best-effort)

---

## 11. 미적용 (다른 사이클)

- 다른 멤버 calendar 일정 공유 (스케줄링 회의실 추천 등) — Phase 9 통합 컨텍스트와 함께
- 캘린더 conflict 자동 감지
- 메일 자동 라우팅 룰 (회사 → 개인 forward)
- WebDAV / CalDAV 같은 다른 standard
