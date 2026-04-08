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
