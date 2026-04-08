# 04. 시스템 아키텍처

---

## 1. 전체 시스템 구성도

```
                    ┌──────────────┐
                    │   Client     │
                    │  (Browser)   │
                    └──────┬───────┘
                           │ HTTPS
                    ┌──────▼───────┐
                    │    Nginx     │
                    │  (Reverse    │
                    │   Proxy)     │
                    └──┬───┬───┬──┘
                       │   │   │
            ┌──────────┘   │   └──────────┐
            ▼              ▼              ▼
   ┌────────────┐  ┌─────────────┐  ┌──────────┐
   │  Frontend  │  │   Backend   │  │ Q Note   │
   │  (React)   │  │  (Express)  │  │ (FastAPI) │
   │            │  │             │  │          │
   │  Vite      │  │  Port 3003  │  │ Port 8000│
   │  Static    │  │             │  │          │
   └────────────┘  └──────┬──────┘  └────┬─────┘
                          │              │
                    ┌─────▼─────┐        │
                    │  Socket.IO │        │
                    │ (실시간)    │        │
                    └─────┬─────┘        │
                          │              │
                    ┌─────▼──────────────▼──┐
                    │      MySQL 8.0         │
                    │    planq_dev_db         │
                    └────────────────────────┘
```

---

## 2. 컴포넌트 상세

### 2.1 Frontend (React + TypeScript + Vite)
| 항목 | 값 |
|------|-----|
| 위치 | /opt/planq/dev-frontend |
| 빌드 결과 | /opt/planq/dev-frontend-build |
| 빌드 도구 | Vite |
| 언어 | TypeScript |
| 상태 관리 | React Context + useReducer |
| 라우팅 | react-router-dom |
| HTTP 통신 | Axios |
| 실시간 | socket.io-client |
| 스타일링 | styled-components |

### 2.2 Backend (Node.js + Express)
| 항목 | 값 |
|------|-----|
| 위치 | /opt/planq/dev-backend |
| 포트 | 3003 |
| Entry Point | server.js |
| 프레임워크 | Express |
| ORM | Sequelize |
| 인증 | JWT (Access + Refresh Token) |
| 실시간 | Socket.IO |
| 파일 업로드 | Multer |
| 이메일 | Nodemailer |
| 프로세스 관리 | PM2 (planq-dev-backend) |

### 2.3 Q Note (Python + FastAPI)
| 항목 | 값 |
|------|-----|
| 위치 | /opt/planq/q-note |
| 포트 | 8000 |
| 프레임워크 | FastAPI |
| STT | OpenAI Whisper |
| LLM | Claude API / OpenAI API |
| 프로세스 관리 | PM2 (planq-qnote) |

### 2.4 MySQL
| 항목 | 값 |
|------|-----|
| DB명 | planq_dev_db |
| 유저 | planq_admin |
| 포트 | 3306 |
| 버전 | MySQL 8.0 |

### 2.5 Nginx
| 항목 | 값 |
|------|-----|
| 설정 파일 | /etc/nginx/sites-available/planq-dev |
| 도메인 | dev.planq.kr |
| / | → /opt/planq/dev-frontend-build |
| /api | → http://localhost:3003 |
| /socket.io | → http://localhost:3003 (WebSocket) |
| /qnote | → http://localhost:8000 |

---

## 3. 데이터 흐름

### 3.1 인증 흐름
```
Client → POST /api/auth/login
       → Backend: 이메일/비밀번호 검증
       → JWT Access Token (15분) + Refresh Token (7일) 발급
       → Client: Access Token을 Authorization 헤더에 포함

Client → 모든 API 요청 시 Authorization: Bearer {token}
       → Backend: middleware/auth.js에서 검증
       → 만료 시 → POST /api/auth/refresh → 새 토큰 발급
```

### 3.2 메시지 → 할일 전환 흐름
```
Client → Q Talk에서 메시지 전송
       → Backend: Message 저장 + Socket.IO로 실시간 전달
       → 사업자: 메시지에서 "할일 만들기" 클릭
       → Backend: Task 생성 (source_message_id 연결)
       → Message.task_id 업데이트 (양방향 링크)
       → Socket.IO로 할일 패널 실시간 업데이트
```

### 3.3 Q Note 처리 흐름
```
사용자 → 음성 파일 업로드
       → Q Note API (FastAPI): 파일 저장
       → Whisper: 음성 → 텍스트
       → LLM: 텍스트 → 요약 + 질문 추출
       → (선택) 업로드된 문서 검색 → 답변 생성
       → 결과 반환
```

### 3.4 청구서 발송 흐름
```
사업자 → Q Bill에서 청구서 작성
       → Backend: Invoice + InvoiceItem 저장 (status: draft)
       → "발송" 클릭
       → Nodemailer: 이메일 발송 (HTML 템플릿)
       → Invoice.status → sent, sent_at 기록
       → 입금 확인 (수동) → status → paid, paid_at 기록
```

---

## 4. 보안 계층

```
┌─────────────────────────────────┐
│ 1. Nginx (HTTPS, rate-limit)    │
├─────────────────────────────────┤
│ 2. Express Middleware            │
│    ├── Helmet (보안 헤더)         │
│    ├── CORS (허용 도메인만)       │
│    ├── rate-limit (요청 제한)     │
│    └── express-validator (입력)   │
├─────────────────────────────────┤
│ 3. Auth Middleware               │
│    ├── JWT 검증                  │
│    ├── requireRole (역할 확인)    │
│    └── checkBusinessAccess       │
│        (테넌트 격리)              │
├─────────────────────────────────┤
│ 4. Audit Middleware              │
│    └── 모든 CUD 작업 기록         │
├─────────────────────────────────┤
│ 5. Sequelize (SQL Injection 방지)│
└─────────────────────────────────┘
```

---

## 5. 디렉토리 구조

```
/opt/planq/
├── dev-backend/
│   ├── server.js
│   ├── app.js
│   ├── .env
│   ├── ecosystem.config.js
│   ├── package.json
│   ├── models/
│   ├── routes/
│   ├── middleware/         (auth, security, audit)
│   ├── services/          (emailService)
│   ├── templates/         (invoiceEmail.html)
│   ├── uploads/
│   └── sync-database.js
│
├── dev-frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── contexts/
│   │   ├── pages/
│   │   ├── components/
│   │   └── utils/
│   ├── vite.config.ts
│   └── package.json
│
├── dev-frontend-build/    (Vite 빌드 결과)
│
├── q-note/
│   ├── main.py
│   ├── .env
│   ├── requirements.txt
│   ├── routers/
│   ├── services/
│   └── uploads/
│
├── docs/
├── CLAUDE.md
├── DEVELOPMENT_PLAN.md
└── .claude/
```

---

## 6. 포트 맵

| 포트 | 서비스 | 비고 |
|------|--------|------|
| 80 | Nginx | dev.planq.kr |
| 443 | Nginx (HTTPS) | SSL 적용 시 |
| 3001 | POS Backend | 기존, 건드리지 않음 |
| 3003 | PlanQ Backend | Express |
| 3306 | MySQL | 로컬 접속만 |
| 8000 | Q Note | FastAPI |

---

## 7. 멀티테넌트 격리

```
모든 API 요청
    ↓
JWT에서 user_id 추출
    ↓
BusinessMember / Client 테이블에서 소속 business_id 확인
    ↓
요청된 리소스의 business_id와 일치 여부 검증
    ↓
불일치 → 403 Forbidden
일치 → 데이터 반환 (항상 business_id WHERE 조건 포함)
```

테넌트 격리는 **middleware/auth.js의 checkBusinessAccess** 함수가 담당.
모든 쿼리에 `WHERE business_id = ?`가 반드시 포함되어야 함.
