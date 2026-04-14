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

---

## 8. 네이밍 정책 (내부 코드 ↔ 사용자 표기 분리)

### 8.1 원칙

DB 스키마·백엔드 코드의 내부 명칭과 사용자에게 보이는 브랜드 표기를 **의도적으로 분리**한다.
이유: 이미 검증된 스키마의 rename 은 수십 개 테이블의 FK·모델·라우트·프론트 코드까지 수정하는 고비용 작업이며, 실제 사용자 가치는 0. 대신 i18n 레이어에서 표기만 교체하면 동일한 효과를 낼 수 있다 (Slack, Linear, Notion 동일 패턴).

### 8.2 네이밍 매핑

| 내부 (DB / 코드) | 사용자 표기 (ko) | 사용자 표기 (en) | 의미 |
|---|---|---|---|
| `businesses` 테이블, `business_id`, `businessId` | **워크스페이스** | Workspace | 구독·소유의 단위 (결제·플랜 귀속) |
| `users.role = 'business_owner'` | **관리자** | Admin | 워크스페이스의 최고 권한자 |
| `users.role = 'business_member'` | **멤버** | Member | 워크스페이스의 일반 멤버 |
| `users.role = 'platform_admin'` | **플랫폼 관리자** | Platform Admin | PlanQ 전체 관리자 |
| `clients` 테이블, `client_id` | **고객** | Client | 워크스페이스의 외부 고객 |

### 8.3 적용 규칙

1. **i18n JSON에서만 교체** — `public/locales/{ko,en}/*.json` 의 `role.*`, `workspace.*` 키
2. DB 컬럼·Sequelize 모델·라우트 파라미터·REST URL(`/api/businesses/:id`) 은 내부 명칭 유지
3. 새 기능 개발 시 주석에만 "워크스페이스(=business)" 표기를 명시
4. 향후 DB rename 이 꼭 필요해지면 Phase X 로 별도 마이그레이션 진행 (현 시점 불필요)

---

## 9. 가시성 정책 (Visibility / Privacy)

### 9.1 원칙

모든 메뉴는 **성격에 맞는 기본 가시성**을 가진다. 사용자에게 매번 결정을 강제하지 않고, 예외 상황만 명시적으로 토글하게 한다.

| 메뉴 | 기본 가시성 | 공유 옵션 |
|---|---|---|
| **Q Talk** (대화) | 워크스페이스 공개 | 내부 메모만 비공개 |
| **Q Task** (할일) | 워크스페이스 공개 | "내 할일만" 필터, 개인 task 가능 |
| **Q Calendar** (일정) | 워크스페이스 공개 | 개인 일정 숨김 토글 |
| **Q Docs** (문서) | 워크스페이스 공개 | 관리자 전용 / 멤버 열람 |
| **Q File** (자료) | 비공개 (개인) | 고객 공유 / 팀 공유 명시 |
| **Q Bill** (청구) | 관리자 제한 | 담당 멤버 열람 가능 |
| **Q Note** (회의 기록) | 비공개 (개인) | 특정 멤버 / 워크스페이스 전체 |

### 9.2 "나 → 이름" 렌더 타임 치환 (Q Note)

Q Note는 `feedback_qnote_personal_tool.md` 원칙에 따라 "답변은 나(=사용자)로서 생성"된다. 공개 전환 시 원본 DB는 "나" 관점으로 저장하되, 타인이 조회할 때 렌더 타임에 실제 이름으로 치환한다.

- DB: "나는 ~를 연구 중이다" (원본 불변)
- 본인 조회: 원본 그대로
- 타인 조회: "{사용자 이름}은 ~를 연구 중이다" (UI 레이어에서 swap)

이 방식으로 **저장 무결성** + **공유 시 자연스러움** 을 모두 충족.

### 9.3 가시성 DB 모델 (공통)

각 주요 테이블에 `visibility` enum 컬럼 추가 (단, Q Talk 등 워크스페이스 공개 기본 리소스는 생략 가능):

```
visibility: 'private' | 'workspace' | 'custom'
owner_user_id: FK
shared_with: JSON (custom 일 때 user_id 배열)
```

- `private`: `owner_user_id` 만 접근
- `workspace`: 워크스페이스 전체 (기본 권한 정책 적용)
- `custom`: `shared_with` 배열에 포함된 사용자만

### 9.4 권한 검사 흐름

```
요청 → JWT 인증 → checkBusinessAccess → visibility 검사 →
  private: user_id === owner_user_id ?
  workspace: business_id 일치 + 역할 권한 통과 ?
  custom: user_id in shared_with ?
→ 통과 시 데이터 반환, 아니면 403
```

---

## 10. AI 팀원 Cue

### 10.1 개념

Cue 는 **모든 워크스페이스에 자동 생성되는 AI 팀원**. 사람 멤버와 동일한 체계로 존재한다:
- `business_members` 테이블의 한 행 (`is_ai = true`)
- 사용자 ID·이름·프로필 이미지를 가짐 (이름은 전 워크스페이스 공통으로 "Cue")
- 메시지 작성자, 할일 담당자, 대화 참여자로 참조 가능
- 사람 팀원과 동일한 역할 시스템을 타지만 권한은 제한적

### 10.2 생성 시점

워크스페이스가 생성될 때 (`POST /auth/register` 또는 내부 `createWorkspace()`) **동시에 Cue 계정 1개 자동 생성**.
- `users.email = null` (로그인 불가)
- `users.name = 'Cue'`
- `users.is_ai = true` (신규 컬럼)
- `business_members.role = 'ai'` (신규 ENUM 값)

### 10.3 Cue 활동 범위 (전 플랜 공통)

모든 워크스페이스에서 Cue 는 동일 기능을 가진다. 플랜은 **월 사용량 한도**만 차등.

| 기능 | 설명 |
|---|---|
| 대화 선응답 | 고객 메시지에 대화 자료(KB) 기반 답변 자동 발송 또는 초안 생성 |
| 동시 응대 | 사람 팀원이 응대 중이어도 Cue 는 자기 판단으로 계속 참여 |
| Task 실행 | Cue 를 담당자로 지정한 task 를 실제 수행 (이메일 초안, 청구서 사전 채움, 자료 요약 등) |
| 자동 요약 | 고객별 대화 히스토리 LLM 요약 |
| 대화 자료 검색 | KB 문서·FAQ 에서 답 찾아 출처와 함께 제시 |

### 10.4 Auto / Draft / Smart 모드

워크스페이스 설정에서 사용자가 자연어로 선택:

| 내부 모드 | UI 라벨 (ko) | 동작 |
|---|---|---|
| `smart` (기본) | 잘 아는 것만 답변한다 | Confidence 임계값 이상만 자동 발송, 낮으면 Draft |
| `auto` | 일단 답변을 시도한다 | 항상 자동 발송 |
| `draft` | 내가 확인한 뒤 보낸다 | 항상 초안, 사람이 승인해야 발송 |

기본값은 `smart`. 사용자에게 confidence 점수는 절대 노출하지 않는다.

### 10.5 Cue 명시적 일시정지

사람이 "Cue 멈춰" 또는 대화별 pause 토글로만 일시정지. 사람 팀원이 메시지를 써도 Cue 가 자동으로 사라지지 않는다. 일시정지 중엔 Cue 아이콘에 "대기 중" 라벨. 재개 시 다음 고객 메시지부터 참여.

**중복 응대 방지**: 사람 팀원이 입력창에 포커스 잡고 타이핑 중이면 Cue 는 해당 턴만 스킵 (대화 DB 의 `cue_suppressed_until` 타임스탬프 기반).

### 10.6 사용량 한도 (플랜별)

월 한도 = **액션 수** 기준. token 수가 아닌 사용자 직관 단위.

| 플랜 | 월 한도 | 초과 시 |
|---|---|---|
| Free | 500 액션 | Cue 조용해짐 (기능 자체는 유지) |
| Basic | 5,000 액션 | 동일 |
| Pro | 25,000 액션 | 동일 |
| Enterprise | 협의 | — |

**액션 단위 정의**
- 대화 답변 1회 = 1 액션
- Task 자동 수행 1회 = 3 액션 (초안·요약·체크리스트 등 복합 작업)
- 자료 요약 1건 = 2 액션
- 히스토리 요약 1회 = 1 액션

### 10.7 비용 구조 (수익성 검증)

**모델별 단가 (2026-04 기준, OpenAI)**
- gpt-4.1-nano: 입력 $0.10 / 출력 $0.40 per 1M tokens
- gpt-4o-mini: 입력 $0.15 / 출력 $0.60 per 1M tokens
- text-embedding-3-small: $0.02 per 1M tokens
- gpt-4o (필요 시만): 입력 $2.50 / 출력 $10.00 per 1M tokens

**단위 액션 실측 비용 (Q Note 데이터 기반)**
| 액션 종류 | 평균 토큰 | 모델 | 비용 |
|---|---|---|---|
| 단순 FAQ 답변 | 300 in + 100 out | nano | $0.00007 |
| KB 기반 답변 | 1,500 in + 200 out | mini | $0.00035 |
| 대화 요약 | 2,000 in + 300 out | mini | $0.00048 |
| 이메일 초안 | 1,500 in + 500 out | mini | $0.00053 |
| 자료 요약 1건 | 5,000 in + 400 out | mini | $0.00099 |

**평균 액션 원가 ≈ $0.0005**

**플랜별 월 원가 & 마진**
| 플랜 | 월 액션 한도 | 월 원가 (최대) | 제안 가격 | 마진 |
|---|---|---|---|---|
| Free | 500 | $0.25 | $0 | 유입용 |
| Basic | 5,000 | $2.50 | $29 | 91% |
| Pro | 25,000 | $12.50 | $99 | 87% |
| Enterprise | 100,000+ | $50+ | $299+ | 83% |

**비용 통제 장치**
1. 모델 기본값은 nano/mini, gpt-4o 는 명시적으로 필요한 곳(복잡 계약서 분석 등)에서만
2. 20 턴 이상 대화는 롤링 요약으로 컨텍스트 압축 (Q Note 기법 재사용)
3. 답변 캐시 (동일 질문 재사용)
4. 워크스페이스별 월 액션 한도 hard cap
5. Free 플랜 악용 방지: 이메일·전화 인증, IP 기반 제한

### 10.8 감사 로그

Cue 의 모든 액션은 `audit_logs` 에 기록:
- `user_id = Cue 계정의 user_id`
- `action = 'cue.message'`, `'cue.task_execute'`, `'cue.summary'` 등
- `new_value` 에 사용한 모델·토큰 수·프롬프트 요약

---

## 11. 사용량 추적 (Cue Usage)

### 11.1 테이블

```sql
CREATE TABLE cue_usage (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     INT NOT NULL,
  year_month      CHAR(7) NOT NULL,       -- '2026-04'
  action_type     VARCHAR(50) NOT NULL,   -- 'answer', 'task_execute', ...
  action_count    INT DEFAULT 0,
  token_input     BIGINT DEFAULT 0,
  token_output    BIGINT DEFAULT 0,
  cost_usd        DECIMAL(10,6) DEFAULT 0,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_business_month_action (business_id, year_month, action_type),
  INDEX idx_business_month (business_id, year_month)
);
```

### 11.2 한도 검사 흐름

```
Cue 액션 실행 전
    ↓
SELECT SUM(action_count) FROM cue_usage
  WHERE business_id=? AND year_month=CURRENT_MONTH
    ↓
한도 초과 → 액션 거부 + "이번 달 휴식 중" UI
한도 이내 → 액션 실행 → 완료 후 cue_usage 증가 (UPSERT)
```

### 11.3 대시보드

워크스페이스 설정 > "Cue 사용량" 탭:
- 이번 달 사용 / 한도 바
- 액션 종류별 분포
- 일별 추이 그래프
- 한도 임박 시 알림 (80%, 95%, 100%)

