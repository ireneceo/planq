# 09. 보안 설계

---

## 1. 인증 보안

### JWT 구조
| 토큰 | 만료 | 저장 위치 | 용도 |
|------|------|----------|------|
| Access Token | 15분 | 메모리 (React state) | API 요청 인증 |
| Refresh Token | 7일 | HttpOnly Cookie | Access Token 갱신 |

### Access Token Payload
```json
{
  "userId": 1,
  "email": "irene@planq.kr",
  "platformRole": "user",
  "iat": 1712500000,
  "exp": 1712500900
}
```

### 비밀번호
- bcryptjs (salt rounds: 12)
- 최소 8자, 영문+숫자 필수
- 재설정 토큰: 1시간 유효, 1회 사용

---

## 2. API 보안

### Helmet
```javascript
app.use(helmet());
// X-Content-Type-Options, X-Frame-Options, CSP 등 자동 설정
```

### CORS
```javascript
app.use(cors({
  origin: ['https://dev.planq.kr', 'https://planq.kr'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### Rate Limiting
| 대상 | 제한 | 윈도우 |
|------|------|--------|
| 전체 API | 100 요청 | 1분 |
| /auth/login | 5 요청 | 15분 |
| /auth/register | 3 요청 | 1시간 |
| /auth/forgot-password | 3 요청 | 1시간 |
| 파일 업로드 | 10 요청 | 1분 |

### 입력 검증
- express-validator로 모든 입력 검증
- SQL Injection: Sequelize ORM 사용 (파라미터 바인딩) + 패턴 감지 미들웨어
- XSS: 메시지 content 저장 시 sanitize

### 추가 보안 계층 (POS 동일 기준)
- SSRF 방어: URL 파라미터 검사, 내부 IP 차단
- CSP (Content Security Policy): 스크립트/스타일 소스 제한
- SQL Injection 패턴 감지: 추가 방어층
- 보안 헤더: XSS-Protection, X-Frame-Options, Referrer-Policy, Permissions-Policy
- API 캐시 제어: no-store, no-cache
- Cookie 보안: HttpOnly, Secure, SameSite=strict

---

## 3. 멀티테넌트 격리

### checkBusinessAccess 미들웨어
```
모든 /businesses/:id/* API 요청
    ↓
JWT에서 userId 추출
    ↓
BusinessMember 또는 Client 테이블에서
해당 userId가 business_id에 속하는지 확인
    ↓
미소속 → 403 Forbidden
소속 → req.businessRole 세팅 후 다음 미들웨어
```

### 데이터 격리 규칙
- 모든 SELECT 쿼리에 `WHERE business_id = ?` 필수
- JOIN 시에도 business_id 조건 유지
- Client는 자기 대화방/할일/파일만 접근 가능
- Cue 계정은 `is_ai=true` AND `business_members.role='ai'` 로만 접근 가능 (로그인 금지)
- Cue 는 오직 자기 워크스페이스의 리소스에만 접근 (타 워크스페이스 격리 동일)
- 메시지 조회 시 `is_internal=true` 는 Client 에게 반환 금지 (서버 레벨에서 제외)
- Draft 메시지 (`is_ai=true` AND `ai_mode_used='draft'`) 는 Client 에게 반환 금지, 멤버만 조회

---

## 3.5 Cue 안전장치

### 3.5.1 로그인 불가
- Cue user (`is_ai=true`) 는 JWT 발급 대상에서 제외 — `/auth/login` 에서 `WHERE is_ai=false` 강제
- Cue 이메일·패스워드 NULL, 로그인 시도 시 무조건 `INVALID_CREDENTIALS`

### 3.5.2 사용량 hard cap
- 모든 Cue 액션 실행 전 `cue_usage` 에서 `year_month + business_id` 로 집계 조회
- 플랜 한도 초과 시 액션 거부 + "이번 달 휴식 중" 응답
- 한도 도달 후에도 기존 메시지 조회·UI 는 영향 없음 (읽기는 가능)

### 3.5.3 비용 통제 가드
- 프롬프트당 최대 input 토큰 한도 (대화 8K, task 실행 16K)
- 한 세션에서 Cue 연속 호출 3회 이상 시 간격 규칙 (중복 응답 방지)
- gpt-4o 호출 시 워크스페이스 설정에 명시적 허용 필요 (기본 차단)

### 3.5.4 응답 필터링
- 민감 키워드(환불·계약해지·법적·금액) 감지 시 Cue 답변을 Auto 모드라도 Draft 로 강제 전환 → 사람 검토 요구
- 개인정보(주민번호·카드번호 패턴) 노출 차단 정규식

### 3.5.5 프롬프트 주입 방어
- 고객 메시지 내 `{{ system }}`, `ignore previous instructions` 등 패턴 sanitize
- KB 문서 청크도 인덱싱 시 시스템 지시어 escape

---

## 3.6 가시성 정책 시행

### 가시성 열거형 (visibility)
- `private`: 소유자만
- `workspace`: 워크스페이스 멤버 전체 (기본)
- `custom`: shared_with 배열에 포함된 user_id 만

### 메뉴별 기본값 (SYSTEM_ARCHITECTURE 9. 참조)
| 메뉴 | 기본 | 예외 |
|---|---|---|
| Q Talk | workspace | `is_internal=true` 메시지는 멤버 전용, Client 차단 |
| Q Task | workspace | "내 할일" 필터 (private 생성 가능) |
| Q Calendar | workspace | 개인 일정 private 토글 |
| Q Docs | workspace | 관리자 전용 / 멤버 열람 |
| Q File | private | "고객 공유" 토글 시 해당 client 에게 공개 |
| Q Bill | 관리자 한정 | 담당 member 열람 가능 |
| Q Note | private | "팀 공개" 시 렌더 타임 "나 → 이름" 치환 |

### 적용 순서
1. 인증 (`authenticateToken`)
2. 워크스페이스 격리 (`checkBusinessAccess`)
3. 리소스 단위 가시성 (`checkVisibility`) — 신규 미들웨어
4. 역할 기반 권한 (`requireRole` / 리소스별 비즈니스 로직)

---

## 3.7 Q Talk 프로젝트 권한 매트릭스 (Phase 5, 2026-04-15)

Phase 5 에서 추가되는 프로젝트 중심 자원에 대한 권한. **같은 뼈대, 권한 필터** 원칙 준수.

### 역할 체계
- `platform_admin` — 플랫폼 전체 관리 (Q Talk 비즈니스 자원엔 접근 안 함)
- `business_owner` (Admin) — 워크스페이스 관리자 (`business_members.role = 'owner'`)
- `business_member` (Member) — 워크스페이스 일반 멤버 (`business_members.role = 'member'`)
- `client` — 워크스페이스 고객 (`clients` 테이블 + optional `user_id`)

한 사용자가 **워크스페이스마다 다른 역할**을 가질 수 있음 (예: irene 은 워프로랩의 Admin, 테스트 워크스페이스의 Member, 파트너스의 Client).

### 프로젝트 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| 프로젝트 생성 | ✓ | ✓ | ✗ |
| 프로젝트 조회 | ✓ (전체) | ✓ (참여 프로젝트) | ✓ (참여 프로젝트) |
| 프로젝트 편집 (이름/설명/기간/상태) | ✓ | ✓ (자기 프로젝트) | ✗ |
| 프로젝트 삭제 (closed 전환) | ✓ | ✓ (자기 생성) | ✗ |
| 멤버 + 역할 매핑 변경 | ✓ | ✓ (자기 프로젝트) | ✗ |
| 고객 참여자 초대 | ✓ | ✓ | ✗ |
| 기본 담당자 변경 | ✓ | ✓ | ✗ |

### 대화 채널 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| `customer` 채널 조회/메시지 | ✓ | ✓ | ✓ (참여) |
| `internal` 채널 조회 | ✓ | ✓ | ✗ |
| `internal` 채널 메시지 작성 | ✓ | ✓ | ✗ |
| `group` 채널 (멤버 + 특정 고객) | ✓ | ✓ (참여) | ✓ (초대된 경우만) |
| 채널 추가 생성 | ✓ | ✓ | ✗ |
| `auto_extract_enabled` 토글 | ✓ | ✓ | ✗ |

### 메시지 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| 메시지 전송 | ✓ | ✓ | ✓ (참여 채널) |
| 본인 메시지 수정 | ✓ | ✓ | ✓ |
| 본인 메시지 삭제 (마스킹) | ✓ | ✓ | ✓ |
| 타인 메시지 삭제 | ✓ | ✗ | ✗ |
| 답글 (`reply_to_message_id`) | ✓ | ✓ | ✓ |

### 자동 업무 추출 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| 추출 트리거 (자동/수동) | ✓ | ✓ | ✗ |
| 후보 리스트 조회 | ✓ | ✓ | ✗ |
| 후보 등록 / 병합 / 거절 | ✓ | ✓ | ✗ |
| 후보 히스토리 조회 | ✓ | ✓ | ✗ |

### 프로젝트 메모 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| `personal` 메모 작성 (본인) | ✓ | ✓ | ✓ |
| `personal` 메모 조회 (본인 것만) | ✓ | ✓ | ✓ |
| `internal` 메모 작성 | ✓ | ✓ | ✗ |
| `internal` 메모 조회 | ✓ | ✓ | ✗ |
| 본인 메모 수정/삭제 | ✓ | ✓ | ✓ |
| 타인 메모 수정/삭제 | ✗ | ✗ | ✗ |

**쿼리 시행**:
```sql
-- 멤버/관리자 조회
WHERE project_id = :pid
  AND (visibility = 'internal' OR (visibility = 'personal' AND author_user_id = :me))

-- 고객 조회 (자동 적용)
WHERE project_id = :pid
  AND visibility = 'personal' AND author_user_id = :me
```

### 주요 이슈 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| 이슈 조회 | ✓ | ✓ | ✓ |
| 이슈 작성 / 수정 / 삭제 | ✓ | ✓ | ✗ |

### Cue 답변 처리 권한

| 액션 | Admin | Member | Client |
|---|:---:|:---:|:---:|
| Draft 카드 조회 | ✓ | ✓ | ✗ |
| Draft 잠금 획득 / 해제 | ✓ | ✓ | ✗ |
| Draft 전송 / 거절 | ✓ | ✓ | ✗ |

**낙관적 잠금**: `processing_by` 가 다른 user 이고 `processing_at + 5분` 이내면 acquire 거절 (409). TTL 만료 시 자동 해제.

### 검색 권한

| 범위 | Admin | Member | Client |
|---|---|---|---|
| 검색 대상 | 워크스페이스 전체 메시지 | 참여 프로젝트의 모든 채널 | 참여 채널 (customer / group 참여분) |
| 구현 | SQL `WHERE` 조건 자동 주입 | 동일 | 동일 |

**쿼리 시행**:
```sql
-- 멤버 기본
WHERE MATCH(body) AGAINST (:q IN NATURAL LANGUAGE MODE)
  AND conversation_id IN (
    SELECT id FROM conversations
    WHERE project_id IN (SELECT project_id FROM project_members WHERE user_id = :me)
  )

-- 고객
WHERE MATCH(body) AGAINST (:q IN NATURAL LANGUAGE MODE)
  AND conversation_id IN (
    SELECT c.id FROM conversations c
    JOIN project_clients pc ON pc.project_id = c.project_id
    WHERE pc.contact_user_id = :me
      AND c.channel_type IN ('customer', 'group')
  )
```

### 파일 첨부 권한 (Phase 5 데이터 모델 완결, UI Phase 2)

- 업로드: 메시지 작성 가능한 사용자 모두
- 다운로드: 해당 메시지 조회 권한자 모두
- 삭제: 작성자 본인 + Admin
- `files.project_id` 필터 자동 적용

### 미들웨어 적용 (Phase 5 신규)

```
authenticateToken                              // JWT 검증
  ↓
checkBusinessAccess                            // 워크스페이스 소속 확인
  ↓
loadProject(:id)                               // req.project 세팅
  ↓
checkProjectRole(['admin','member'])           // 프로젝트 참여자 확인
  ↓
checkChannelVisibility(:channel_type)          // client 가 internal 접근 시도 시 403
  ↓
액션별 비즈니스 로직
```

**위반 응답**:
- 401: 인증 실패
- 403 `not_project_member`: 프로젝트 참여자 아님
- 403 `forbidden_channel`: 채널 타입 접근 권한 없음 (예: client 가 internal 요청)
- 403 `forbidden_note_visibility`: 메모 가시성 위반
- 409 `locked_by_other`: Cue draft 잠금 충돌

### 초대 링크 보안

- 토큰: 32 bytes random (crypto.randomBytes) → base64url
- TTL: 7일
- 사용 후 1회성 소멸 (`project_clients.invite_token_used_at`)
- 초대 대상 이메일 해시 검증 (피싱 방어)
- 이메일 발송 생략(Phase 2) 상태에서는 **링크 복사 후 수동 전달** 전제

### Rate Limit (Phase 5)

| 엔드포인트 | 한도 |
|---|---|
| `POST /conversations/:id/messages` | 60 / 분 / 사용자 |
| `POST /conversations/:id/task-candidates/extract` | 10 / 시간 / 프로젝트 (LLM 비용 제어) |
| `GET /search/messages` | 30 / 분 / 사용자 |
| `POST /projects` | 10 / 시간 / 사용자 |
| `POST /cue-draft/acquire` | 제한 없음 (낙관적 잠금 자체 방어) |

---

## 4. 파일 업로드 보안

| 항목 | 규칙 |
|------|------|
| 허용 확장자 | jpg, jpeg, png, gif, pdf, doc, docx, xls, xlsx, ppt, pptx, zip, txt |
| 파일명 | UUID로 변환 (원본 파일명은 DB에 저장) |
| 저장 경로 | /opt/planq/dev-backend/uploads/{business_id}/{yyyy-mm}/ |
| 용량 제한 | 요금제별 (Free: 10MB, Basic: 30MB, Pro: 50MB per file) |
| 바이러스 검사 | 추후 ClamAV 연동 (Phase 2 이후) |

---

## 5. 감사 로그 (Audit)

### 기록 대상
| 액션 | 설명 |
|------|------|
| message.create | 메시지 생성 |
| message.update | 메시지 수정 (old_value에 원문) |
| message.delete | 메시지 삭제 (old_value에 원문) |
| task.create | 할일 생성 |
| task.update | 할일 수정 (상태/마감일/담당자 등) |
| task.delete | 할일 삭제 |
| client.invite | 고객 초대 |
| client.update | 고객 정보 변경 |
| member.invite | 멤버 초대 |
| member.remove | 멤버 제거 |
| invoice.create | 청구서 생성 |
| invoice.send | 청구서 발송 |
| invoice.paid | 입금 확인 |
| file.upload | 파일 업로드 |
| file.delete | 파일 삭제 |
| workspace.brand_update | 브랜드 정보 수정 |
| workspace.legal_update | 법인 정보 수정 |
| cue.message | Cue 가 대화 메시지 생성 (auto/draft) |
| cue.task_execute | Cue 가 task 를 실제 수행 |
| cue.summary | Cue 가 고객 요약 생성 |
| cue.kb_answer | Cue 가 KB 검색해서 답변 (source 포함) |
| cue.pause | Cue 수동 일시정지 |
| cue.resume | Cue 재개 |
| cue.mode_change | Cue 모드 변경 (smart/auto/draft) |
| cue.draft_approve | 사람이 Draft 메시지 승인 발송 |
| cue.draft_reject | 사람이 Draft 메시지 거절 |
| kb.document_upload | 대화 자료 문서 업로드 |
| kb.document_delete | 대화 자료 문서 삭제 |
| kb.pinned_faq_create | Pinned FAQ 등록 |
| kb.pinned_faq_update | FAQ 수정 |
| kb.pinned_faq_delete | FAQ 삭제 |

### audit 미들웨어 사용법
```javascript
// 라우트에서 호출
await auditLog(req, {
  action: 'task.update',
  targetType: 'Task',
  targetId: task.id,
  oldValue: { status: 'pending' },
  newValue: { status: 'completed' }
});
```

---

## 6. 환경 변수 관리

### .env 파일 (절대 Git에 포함하지 않음)
```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=planq_dev_db
DB_USER=planq_admin
DB_PASS=************
JWT_SECRET=************
JWT_REFRESH_SECRET=************
PORT=3003
NODE_ENV=development
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@planq.kr
ALLOWED_ORIGINS=https://dev.planq.kr,http://localhost:5173
```

### 민감 정보 규칙
- API 키, DB 비밀번호는 절대 코드에 하드코딩 금지
- .env는 .gitignore에 포함
- 운영 환경은 별도 .env 관리

---

## 7. HTTPS (SSL)

### 개발 환경
- Let's Encrypt 무료 인증서
- certbot으로 자동 발급/갱신
- dev.planq.kr에 적용

### Nginx SSL 설정
```nginx
server {
    listen 443 ssl;
    server_name dev.planq.kr;
    ssl_certificate /etc/letsencrypt/live/dev.planq.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dev.planq.kr/privkey.pem;
    ...
}
server {
    listen 80;
    server_name dev.planq.kr;
    return 301 https://$server_name$request_uri;
}
```

---

## 8. 백업

### DB 백업
| 항목 | 규칙 |
|------|------|
| 주기 | 매일 1회 (새벽 3시) |
| 방법 | mysqldump → gzip → /var/backups/planq-db/daily/ |
| 보관 | 최근 7일분 유지, 이전 자동 삭제 |

### 파일 백업
| 항목 | 규칙 |
|------|------|
| 대상 | /opt/planq/dev-backend/uploads/ |
| 주기 | 매일 1회 |
| 방법 | tar.gz |

### 백업 스크립트 (cron)
```bash
# /etc/cron.d/planq-backup
0 3 * * * irene /opt/planq/scripts/backup.sh
```
