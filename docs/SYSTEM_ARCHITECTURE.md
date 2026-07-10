# 04. 시스템 아키텍처

> 최종 갱신: 2026-07-10 (코드 실측 대조) · 이전 2026-04-14
>
> **Changelog (2026-07-10):**
> - 운영 서버 추가 (87.106.78.146 · backend 3004 · q-note 8001 · PM2 `planq-prod-*`) — §2.6, §6
> - Q Note 실측 정정: STT=Deepgram(실시간 WS), LLM=OpenAI(gpt-4.1-nano/gpt-4o-mini), 자체 SQLite + Node internal API 종량과금 — §2.3, §3.3 (기존 "Whisper / MySQL 직결" 표기는 오기)
> - 보안 계층을 server.js 실제 미들웨어 순서로 갱신 (Stripe raw webhook 선마운트, maintenance, requireMenu, costGuard, rate-limit 현행값) — §4
> - 신규 섹션: 실시간 소켓 아키텍처(§12) · Stripe 결제 분리(§13) · 모바일 클라이언트 PWA+Capacitor(§14) · 검사 하니스·가드 스크립트(§15)
> - 오기 정정: nginx 설정 경로(`sites-enabled/dev.planq.kr`), 인증 흐름(refresh_tokens client_kind별 TTL), 백엔드 127.0.0.1 바인드

---

## 1. 전체 시스템 구성도

```
              ┌────────────────────────────────┐
              │            Client              │
              │ Browser · PWA(sw.js) ·         │
              │ Capacitor iOS 네이티브앱        │
              └───────────────┬────────────────┘
                              │ HTTPS
                       ┌──────▼───────┐
                       │    Nginx     │
                       │  (Reverse    │
                       │   Proxy)     │
                       └──┬───┬───┬──┘
                          │   │   │
               ┌──────────┘   │   └──────────┐
               ▼              ▼              ▼
      ┌────────────┐  ┌─────────────┐  ┌────────────┐
      │  Frontend  │  │   Backend   │  │  Q Note    │
      │  (React)   │  │  (Express)  │  │ (FastAPI)  │
      │            │  │  Port 3003  │◄─┤ Port 8000  │
      │  Vite      │  │ (운영 3004)  │  │ (운영 8001) │
      │  Static    │  │  Socket.IO  │  │ SQLite     │
      └────────────┘  └──────┬──────┘  └────────────┘
                             │        internal API
                       ┌─────▼──────┐ (X-Internal-Api-Key,
                       │  MySQL 8.0 │  localhost 전용)
                       │planq_dev_db│
                       └────────────┘

  ※ Backend·Q Note 는 둘 다 127.0.0.1 바인드 — nginx 프록시로만 외부 노출
  외부 서비스: Stripe(webhook 수신) · Deepgram(STT) · OpenAI(LLM/임베딩)
             · APNs/FCM/Web Push · SMTP(Nodemailer) · Google API(OAuth/Calendar/Drive)
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
| i18n | react-i18next (ko/en, `public/locales/{ko,en}/*.json`) |
| PWA | sw.js (Web Push·Share Target·자가 update) + version.json 폴링 + `server:build` socket 신호 |
| 네이티브앱 | Capacitor iOS (`dev-frontend/ios/`, `capacitor.config.ts` appId `app.planq`) — React 번들 재사용, §14 참조 |

### 2.2 Backend (Node.js + Express)
| 항목 | 값 |
|------|-----|
| 위치 | /opt/planq/dev-backend |
| 포트 | 3003 (운영 3004) — `BIND_HOST` 기본 **127.0.0.1** (nginx 프록시로만 노출) |
| Entry Point | server.js (PM2 필수 — pm_id 없으면 즉시 exit, root 실행 금지) |
| 프레임워크 | Express (`trust proxy: 1` — nginx 1-hop) |
| ORM | Sequelize (MySQL 8.0) |
| 인증 | JWT (Access + Refresh Token, §3.1) |
| 실시간 | Socket.IO (handshake JWT 인증, §12) |
| 파일 업로드 | Multer |
| 이메일 | Nodemailer |
| 프로세스 관리 | PM2 (dev: planq-dev-backend / 운영: planq-prod-backend) |

**백그라운드 배치 (server.js 내장 — 별도 crontab 아님):**
- 자정 setTimeout 체인: task 스냅샷 → SaaS 청구 cron(billing) → trial → 매월 1일 보고서 → 정기청구(recurring_invoice) → 고객 구독청구 → 정기업무 생성 → 업로드 정리 → 연체(overdue) → share token 정리 → share 만료 임박 알림
- 매시: weekly review 박제, 단위보고서 경계 확정 / 5분: 일정 임박 알림, Q Mail IMAP fetch / 30초: export job worker
- 일·월 단위: FAQ 클러스터링(04:10), 위키 질문 클러스터(월 05:00), Cue 지식 채굴(월 05:20), 업무 후보 만료 정리

### 2.3 Q Note (Python + FastAPI)
| 항목 | 값 |
|------|-----|
| 위치 | /opt/planq/q-note |
| 포트 | 8000 (운영 8001) — uvicorn `--host 127.0.0.1` (venv, nginx 프록시 전용) |
| 프레임워크 | FastAPI (라우터: live / llm / sessions / voice) |
| 자체 DB | **SQLite** (`data/qnote.db`, aiosqlite) — MySQL 미사용. 세션 데이터는 q-note 소재 |
| STT | **Deepgram** (실시간 WebSocket `/ws/live`, keyword boosting) |
| LLM | OpenAI — `gpt-4.1-nano`(실시간 정제) / `gpt-4o-mini`(답변 생성), env로 교체 가능 |
| Node 연동 | `POST/GET /api/internal/qnote/*` (X-Internal-Api-Key 공유 시크릿, localhost) — STT 종량과금·quota·멤버십 검사 (§3.3) |
| 접근 통제 | 전 라우트 본인 세션만 (`_load_session_or_403`) — owner/admin 백도어 없음 |
| 프로세스 관리 | PM2 (dev: planq-qnote / 운영: planq-prod-qnote) |

### 2.4 MySQL
| 항목 | 값 |
|------|-----|
| DB명 | planq_dev_db (운영 별도 인스턴스) |
| 유저 | planq_admin |
| 포트 | 3306 (로컬 접속만) |
| 버전 | MySQL 8.0 |
| 비고 | Q Note 는 MySQL 에 직접 접속하지 않음 (internal API 경유) |

### 2.5 Nginx
| 항목 | 값 |
|------|-----|
| 설정 파일 | `/etc/nginx/sites-enabled/dev.planq.kr` (⚠️ dev 는 sites-enabled 가 실파일/복사본 — sites-available 편집은 무효, `nginx -T` 로 확인) |
| 도메인 | dev.planq.kr (운영 planq.kr) |
| / | → /opt/planq/dev-frontend-build (HTML 은 no-cache, 해시 자산은 immutable) |
| /api | → http://localhost:3003 |
| /socket.io | → http://localhost:3003 (WebSocket) |
| /qnote | → http://localhost:8000 (운영 8001) |

### 2.6 운영 서버 (Production)
| 항목 | 값 |
|------|-----|
| 서버 | 87.106.78.146 (POS 와 공존 — POS 자원 절대 접촉 금지) |
| Backend | port **3004**, PM2 `planq-prod-backend` |
| Q Note | port **8001**, PM2 `planq-prod-qnote` |
| 배포 | `/opt/planq/scripts/deploy-planq.sh` (dev → 운영 rsync + 스냅샷 백업, Irene "배포" 명령 시에만) |
| 원칙 | 운영 = dev 정확 복사. 환경차는 .env 시크릿과 platform_settings(DB)로만 |

---

## 3. 데이터 흐름

### 3.1 인증 흐름
```
Client → POST /api/auth/login
       → Backend: 이메일/비밀번호 검증 (또는 Google/Microsoft OAuth — routes/auth_oauth.js)
       → JWT Access Token (15분) + Refresh Token (HttpOnly Cookie) 발급
       → Refresh TTL 은 client_kind 별: pwa/ios/android = 365일, web = 30일 (sliding)
       → Client: Access Token을 Authorization 헤더에 포함

Client → 모든 API 요청 시 Authorization: Bearer {token}
       → Backend: middleware/auth.js에서 검증
       → 만료 시 → POST /api/auth/refresh → rotation (새 row + 옛 row revoke)
```

- **다중 디바이스 세션**: `refresh_tokens` 테이블에 디바이스별 row. `client_kind` ENUM(`'pwa','web','ios','android'`) — 결정 우선순위 `req.body.client_kind` > `X-Client-Kind` 헤더 > 옛 row > `'web'`
- **reuse 방어**: rotation 사슬(`replaced_by_id`) 재사용 감지 시 해당 chain 만 일괄 revoke (rotation grace 5분 — 모바일 PWA wake-up 대응)

### 3.2 메시지 → 할일 전환 흐름
```
Client → Q Talk에서 메시지 전송
       → Backend: Message 저장 + Socket.IO로 실시간 전달
       → 사업자: 메시지에서 "할일 만들기" 클릭
       → Backend: Task 생성 (source_message_id 연결)
       → Message.task_id 업데이트 (양방향 링크)
       → Socket.IO로 할일 패널 실시간 업데이트
```

### 3.3 Q Note 처리 흐름 (실시간 회의 + STT 종량과금)
```
사용자 → WebSocket /ws/live 연결 (JWT)
       → Q Note: accept 후 Deepgram 연결 前 진입 hard-block —
         Node internal API 검사: qnote/can (quota, 4030) + business-membership (4031)
       → Deepgram 실시간 STT (keyword boosting — 브리프·참여자·자료에서 추출)
       → LLM (gpt-4.1-nano): 실시간 정제 / 질문 감지
       → 답변 생성 (gpt-4o-mini): 우선순위 priority > custom > reuse > generated > RAG > general
       → 5분마다 POST /api/internal/qnote/usage 로 billed 초 기록
         (stream_id = WS 연결마다 UUID, UNIQUE(stream_id, segment_seq) 멱등 원장
          → qnote_usage 월 rollup, FOR UPDATE 정확히 한 번)
```
- 세션 본문은 q-note **SQLite**(`data/qnote.db`)에, 과금 원장(`qnote_usage_events`)은 Node MySQL 에 저장
- 설계: `docs/QNOTE_STT_BILLING_DESIGN.md`

### 3.4 청구서 발송 흐름
```
사업자 → Q Bill에서 청구서 작성
       → Backend: Invoice + InvoiceItem 저장 (status: draft)
       → "발송" 클릭
       → Nodemailer: 이메일 발송 (HTML 템플릿, 공개 결제 페이지 share_token 링크)
       → Invoice.status → sent, sent_at 기록
       → 결제: 계좌이체 입금 확인(수동 마킹) 또는 Stripe 카드결제(workspace merchant, §13)
       → 어느 경로든 markInvoicePaid / markInstallmentPaid 단일착지 → status paid, paid_at
       → paid 후 증빙(세금계산서/현금영수증) 발행 큐 = receiptsDue 단일원천, 정정은 receipt_corrections
```

---

## 4. 보안 계층 (server.js 실제 미들웨어 순서)

```
┌──────────────────────────────────────────────────┐
│ 0. Nginx (HTTPS 종단, 리버스 프록시)               │
├──────────────────────────────────────────────────┤
│ 1. Stripe webhook raw 마운트 — express.json 前    │
│    /api/stripe/webhook/ws/:businessId (Q Bill)   │
│    /api/stripe/webhook (구독) — 서명검증에 raw     │
│    body 필요. 마운트 순서 자체가 Fable 게이트       │
├──────────────────────────────────────────────────┤
│ 2. express.json/urlencoded (10mb) + cookieParser │
│ 3. requestIdMiddleware (X-Request-Id — 신고↔로그) │
│ 4. maintenanceMiddleware (점검모드 503,           │
│    platform_admin·ALLOW_PATHS 통과)              │
│ 5. ogMetaMiddleware (SNS 공유봇 OG meta)          │
├──────────────────────────────────────────────────┤
│ 6. setupSecurity (middleware/security.js)        │
│    ├── Helmet + 추가 보안헤더 + CSP               │
│    ├── CORS (ALLOWED_ORIGINS env, 허용 헤더:      │
│    │    X-Client-Kind, X-Internal-Api-Key)       │
│    ├── rate-limit: 전역 600/분 (인증자 user 버킷, │
│    │    미인증 IP), login 8회/15분(성공 제외),     │
│    │    register 3회/1h, forgot-password 3회/1h, │
│    │    /api/files 10회/분                        │
│    ├── SSRF 방어 (url·redirect 등 파라미터 검사)   │
│    └── SQL Injection 고신뢰 시그니처 감지          │
│        (부가 방어층 — 본방어는 Sequelize)          │
├──────────────────────────────────────────────────┤
│ 7. 라우트별 인증/인가 미들웨어                      │
│    ├── authenticateToken (JWT 검증)              │
│    ├── requireRole (플랫폼 역할)                  │
│    ├── checkBusinessAccess (테넌트 격리)          │
│    ├── requireMenu(menu, level) — 멤버 메뉴권한   │
│    │    11메뉴+weekly_team × none/read/write     │
│    │    (middleware/menu_permission.js, Layer 3) │
│    ├── costGuard — 외부비용(LLM·STT·메일) 라우트   │
│    │    perUserLimiter/perUserDaily/capText      │
│    └── internal API 키 — /api/internal/*         │
│        (X-Internal-Api-Key, Q Note→Node 전용)    │
├──────────────────────────────────────────────────┤
│ 8. Audit — 모든 CUD 작업 audit_logs 기록          │
│ 9. Sequelize parameterized query (SQLi 본방어)    │
│ 10. errorHandler (공통 에러 + request_id)         │
└──────────────────────────────────────────────────┘
```

추가 하드닝:
- Backend·Q Note 모두 **127.0.0.1 바인드** — 포트 직결 차단, nginx 경유만
- PM2 강제 (pm_id 검사) + root 실행 방지 + JWT_SECRET 필수 체크 (server.js 상단)
- Socket.IO 도 handshake JWT 인증 + room join 시 소유권 재검증 (§12)

---

## 5. 디렉토리 구조

```
/opt/planq/
├── dev-backend/
│   ├── server.js            (PM2 엔트리 유일)
│   ├── .env                 (권한 640, planq 그룹)
│   ├── ecosystem.config.js  (planq-dev-backend + planq-qnote)
│   ├── package.json
│   ├── models/
│   ├── routes/              (50+ 라우터 — server.js 마운트 순서 참조)
│   ├── middleware/          (auth, security, errorHandler, costGuard,
│   │                         menu_permission, maintenance, ogMeta, audit)
│   ├── services/            (billing, recurring_invoice, push_service,
│   │                         apns_sender, emailService, cron 서비스 다수)
│   ├── templates/
│   ├── uploads/             ({business_id}/{yyyy-mm}/, SHA-256 dedup)
│   └── sync-database.js
│
├── dev-frontend/
│   ├── src/
│   │   ├── App.tsx / main.tsx
│   │   ├── contexts/ · pages/ · components/ · hooks/ · utils/
│   │   └── i18n.ts
│   ├── public/locales/{ko,en}/   (i18n JSON)
│   ├── ios/                 (Capacitor iOS 네이티브앱)
│   ├── capacitor.config.ts
│   ├── vite.config.ts
│   └── package.json
│
├── dev-frontend-build/      (Vite 빌드 결과 — nginx 서빙)
│
├── q-note/
│   ├── main.py
│   ├── .env
│   ├── venv/                (uvicorn 실행 주체)
│   ├── data/qnote.db        (자체 SQLite)
│   ├── routers/             (live, llm, sessions, voice)
│   ├── services/            (deepgram_service, llm_service, billing_client,
│   │                         embedding_service, speaker_clustering 등)
│   └── uploads/
│
├── scripts/                 (health-check.js, e2e/ 검사 하니스,
│                             deploy-planq.sh, backup-*.sh, ops-capacity-check.js)
├── docs/                    (설계 문서 + qa/ 검사 플레이북)
├── CLAUDE.md
└── .claude/
```

---

## 6. 포트 맵

### 개발 서버 (87.106.11.184 · dev.planq.kr)
| 포트 | 서비스 | 비고 |
|------|--------|------|
| 80/443 | Nginx | dev.planq.kr (HTTPS) |
| 3001 | POS Backend | 타 서비스 — 절대 건드리지 않음 |
| 3003 | PlanQ Backend | Express, 127.0.0.1 바인드 |
| 3306 | MySQL | 로컬 접속만 |
| 8000 | Q Note | FastAPI, 127.0.0.1 바인드 |

### 운영 서버 (87.106.78.146 · planq.kr)
| 포트 | 서비스 | 비고 |
|------|--------|------|
| 3004 | PlanQ Backend | PM2 planq-prod-backend (POS 공존으로 3003 대신 3004) |
| 8001 | Q Note | PM2 planq-prod-qnote, 127.0.0.1 바인드 |

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

- 신규 라우트는 권한 헬퍼 단일 모듈 **`middleware/access_scope.js`** (`attachWorkspaceScope` + `listWhere/canAccess`) 사용 — client 격리 포함
- 격리 회귀는 검사 하니스 카나리 **`scripts/e2e/canary-tenant.js`** (비멤버 workspace 403 실증)가 상시 감시 (§15)

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

---

## 12. 실시간 소켓 아키텍처 (Socket.IO)

*(2026-07-10 추가 — server.js 실측)*

### 12.1 인증과 room 자동 join

```
socket 연결 (io({ auth: { token } }))
    ↓ io.use — JWT 검증 실패 시 연결 거부
connection 직후 서버가 자동 join:
    ├── user:{userId}          — 같은 user 의 모든 디바이스 동기화 (읽음/핀/알림)
    ├── business:{bizId} 전부   — 멤버인 모든 워크스페이스 (autoJoinUserBusinesses)
    └── conv:{convId}          — 비멤버(고객) 참여 대화만 (남의 대화 노출 차단)
```

클라이언트가 join 을 "잊어버려도" 서버가 connection 시점에 보장 — unread 뱃지 실시간 회귀 근본 차단. 명시적 `join:conversation` / `join:project` / `join:business` 이벤트는 **소유권 재검증 후** join (인증만으로는 부족).

### 12.2 broadcast 규약 (CLAUDE.md 운영안정성 16번)

- 데이터 변경 라우트는 `io.to('business:${bizId}').emit('<entity>:<event>')` 호출 강제 — `task:new/updated/deleted`, `message:new`, `candidate:new/updated` 등
- 프론트: socket listener + debounce silentLoad(200~250ms) + `useVisibilityRefresh` 안전망(server fresh 덮어쓰기)
- cron 등 req context 없는 곳은 `global.__planqIo` 참조
- `server:build` 이벤트: 배포 후 build_id broadcast → 클라이언트 업데이트 배너 (`isReloadSafe()` 가드 — 입력 중 자동 reload 금지)
- `debug:rooms` ack: health-check 'realtime' 카테고리가 room auto-join 회귀 자동 검출

---

## 13. 결제 아키텍처 (Stripe — 구독 vs Q Bill 절대 분리)

*(2026-07-10 추가 — 상세: `docs/SAAS_BILLING_VS_QBILL_SEPARATION.md`)*

두 결제 축은 merchant·테이블·webhook 이 완전히 분리된다 (혼동 금지 5불변식):

| 축 | Merchant | 테이블 | 착지 함수 | Webhook |
|---|---|---|---|---|
| **SaaS 구독** (워크스페이스가 PlanQ 에 지불) | Platform (PlanQ Stripe 계정) | `payments` | `markPaymentPaid` 단일착지 | `/api/stripe/webhook` |
| **Q Bill** (고객이 워크스페이스에 지불) | Workspace (워크스페이스별 Stripe 계정) | `invoices` / `invoice_installments` | `markInvoicePaid` / `markInstallmentPaid` (수동 마킹과 webhook 이 공유) | `/api/stripe/webhook/ws/:businessId` (business별 webhook secret 서명검증) |

- 두 webhook 모두 **express.json() 前에 `express.raw()` 로 마운트** (서명 검증에 raw body 필요) — server.js 최상단, 마운트 순서 = Fable 게이트
- 계좌이체(송금)가 여전히 1순위 결제수단 — Stripe 는 카드 결제 추가 축
- Stripe 키는 암호화 저장(`*_enc`), 전역 toJSON 이 `*_enc → *_set` boolean 으로 redact (응답에 시크릿 미노출)

---

## 14. 모바일 클라이언트 (PWA + Capacitor iOS)

*(2026-07-10 추가)*

### 14.1 PWA
- `sw.js` — Web Push(VAPID) 수신, Share Target, push/notificationclick 시점 자가 update (`self.registration.update()`)
- 새 빌드 감지: version.json 5분 폴링 + `server:build` socket 신호 → `isReloadSafe()` 통과 시에만 silent reload, 아니면 UpdateBanner
- standalone 감지(`display-mode: standalone`) → `client_kind='pwa'` (refresh TTL 365일)

### 14.2 Capacitor iOS 네이티브앱
- `dev-frontend/ios/` + `capacitor.config.ts` (appId `app.planq`) — React 번들 그대로 재사용
- push: APNs (`services/apns_sender.js`), 배포는 TestFlight

### 14.3 Push 발송 fan-out (`services/push_service.js`)
- `push_subscriptions.kind` 분기: web(VAPID) / **apns**(iOS 네이티브) / fcm — 한 user 의 전 구독에 kind 별 발송, 결과는 PushLog 기록
- 같은 push service host 좀비 자동 만료 (한 user × 한 host = active 1개)
- web push 옵션: `urgency: 'high'` + `TTL: 86400`

---

## 15. 검사·가드 인프라 (검증 게이트)

*(2026-07-10 추가)*

| 도구 | 경로 | 역할 |
|---|---|---|
| 헬스체크 | `/opt/planq/scripts/health-check.js` | 29+ 항목 프로젝트 안전망 (realtime room join 회귀 포함) |
| 검사 하니스 v2 | `/opt/planq/scripts/e2e/run.js --suite mobile,crosscut,l1,tenant` | Puppeteer, health-check 동급 게이트 (exit 0/1) |
| ├ mobile | `mobile-keyboard.js` | 모바일 키보드 가림 회귀 검출 |
| ├ crosscut | `canary-crawl.js` | 표시명(계정명) 누출 카나리 크롤 |
| ├ l1 | `canary-l1.js` | L1 개인자원 누출 카나리 (백엔드 API 크롤) |
| └ tenant | `canary-tenant.js` | 멀티테넌트 격리 카나리 (비멤버 biz 403 실증) |
| 런타임 모니터링 | `GET /api/health` | DB pool 사용률 + env 시그널 (deepgram/openai/smtp/vapid 설정 여부) |
| 빌드 감지 | `GET /api/build-version` | 프론트 폴링용 빌드 버전 |
| OPS 용량 | `scripts/ops-capacity-check.js` | 주 1회 가입자·용량 집계, Stage 전환 감지 |

- **Fable 검증 게이트**: 고위험 변경(생명선 코드·돈·마이그레이션·보안 경계·신규 아키텍처) 전용 별도 검증 — 기준·내용은 `CLAUDE.md` "Fable 검증 게이트" 절
- 하니스 설계: `docs/qa/INSPECTION_PLAYBOOK.md`, 오탐·회귀 사례: `docs/qa/FEEDBACK_REGRESSIONS.md`

