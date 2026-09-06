# PlanQ 프로젝트 가이드라인

## 프로젝트 개요

**PlanQ** — B2B SaaS 업무 전용 고객 채팅 + 실행 구조 통합 OS
- 브랜드: Plan + Cue(실행 신호) + Queue(업무 정리)
- 슬로건 — 메인 "일을 일답게 하다, PlanQ" / 서브 "일이 일이되지 않게, PlanQ"
  (구 버전 "요청은 Queue로, 실행은 Cue로" 는 **폐기**. 정본은 memory `project_brand_concept`)
- 핵심 기능: Q Talk(대화), Q Task(할일), Q Note(음성/요약), Q File(자료), Q Bill(청구)

### 역할 체계
| 역할 | 설명 |
|------|------|
| Platform Admin | 플랫폼 전체 관리 |
| Business Owner | 사업자 — 구독 + 고객/팀/청구 관리 |
| Business Member | 사업자 소속 직원 |
| Client | 고객 — 초대 기반, 웹 링크 클릭으로 즉시 접속 |

### 개발팀
| 이름 | 역할 | 설명 |
|------|------|------|
| Irene | CEO / 기획자 | 요구사항 정의, 기능 승인, 최종 의사결정 |
| lua | Project Manager | 개발 진행 관리, 서버 접속 및 코드 수정, 배포 관리 |

**협업 규칙:**
- 같은 파일 동시 수정 시 충돌 가능 → 작업 전 `git pull`로 동기화
- 대규모 기능은 Irene 승인 후 진행
- 버그 수정/소규모 작업은 lua 판단으로 바로 진행 가능

---

## 작업 워크플로우 (최우선 규칙)

### 흐름 (UI-First → 즉시 실 API 연결)
**요구사항 정리 → 화면/UX 설계 → 기술 설계 → UI 구현 → 백엔드 연결 → 검증**

### 🚫 mock 데이터 절대 금지 (최상위 원칙)

**production 소스 코드 어디에도 mock 데이터를 남기지 않는다. 모든 화면은 실 API 데이터로 작동해야 한다.**

- `mockXxx`, `dummyData`, 하드코딩된 배열/객체로 화면 채우기 — 전부 금지
- "다음 sprint에서 실 API 연결" 같은 미루기 금지 — 작업이 끝나기 전에 반드시 실 API 교체
- 검증 단계에서 mock 잔존 1건이라도 있으면 = **검증 실패**. "완료" 보고 금지
- mock.ts 같은 모의 데이터 파일을 만들지 않는다. 필요하면 `__tests__/fixtures/` 안에 테스트 전용으로만
- 새 기능 개발 = 첫 커밋부터 실 API 호출. UI 검증과 백엔드 연결을 분리하지 않는다

### UI-First 원칙 (mock 없이)

화면/UX 합의는 **와이어프레임 텍스트 / Figma / 설계 문서** 단계에서 끝낸다. 코드에 들어가는 순간 실 API.

1. **와이어 단계**: 텍스트 와이어로 레이아웃·정보 위계 합의 (코드 X)
2. **승인 후 구현**: 처음부터 실 API 호출 + 로딩/에러/빈 상태 + i18n
3. **빌드 후 시연**: `https://dev.planq.kr/[경로]` 안내 → 실 데이터로 작동
4. **피드백 반영**: 디자인/인터랙션 조정 (실 API 그대로 유지)

### 규칙
- 이전 단계 산출물을 반드시 참조한 후 다음 단계 진행
- 각 단계 완료 시 핵심 요약을 보여주고 승인 확인
- Irene이 수정 지시하면 해당 단계에서 반영 후 재확인
- **구현 중 설계에 없는 것을 임의로 추가하지 않는다**
- **구현 완료 후 반드시 검증 단계를 실행한다 (절대 생략 금지)**
- 예외: 단순 버그 수정/텍스트 변경 (소 규모 작업은 바로 진행)

### 검증 단계 (필수)

**검증 없이 "완료"라고 보고하는 것은 금지된다.**
**코드 수준 확인만으로 "완료"라고 하는 것도 금지. 실제 API 호출로 데이터 흐름을 증명해야 한다.**

1. **빌드 확인**: 프론트엔드 빌드 성공 + dev 서버 반영
2. **API 실동작 테스트** (실제 호출):
   - 로그인 → 토큰 획득
   - 핵심 API 실제 호출 (GET/POST/PUT/DELETE)
   - 저장 → 조회 → 값 일치 확인
   - 정상 케이스 + 경계 케이스 최소 1개씩
3. **프론트엔드 렌더링 확인**: 변경 페이지 정상 서빙 확인
4. **요구사항 대조**: 원래 요청 항목별 ✅/❌ 표시
5. **검증 결과 보고**: 실제 API 호출 결과 포함

**API 테스트 패턴**:
```bash
cd /opt/planq/dev-backend
node test-xxx.js    # Login → API 호출 → 검증
rm test-xxx.js      # 반드시 삭제
```

### 규모별 자동 조절
| 규모 | 기준 | 워크플로우 |
|------|------|-----------|
| 소 | 버그 수정, 텍스트 변경 | 바로 구현 → 검증 |
| 중 | 기능 추가/수정 (2~5 파일) | 기술 설계 요약 → 승인 → 구현 → 검증 |
| 대 | 신규 시스템, 다수 파일, DB 변경 | 전 단계 수행 → 검증 |

---

## Fable 검증 게이트 — **조건부 판정 규칙** (Irene 지시 2026-09-06)

> *"복잡하고 구조화 필요한 검증과 판단, 고품질 결과가 중요한 것에 한해 조건부로."*
> *"fable은 꼭 필요한 부분에만 사용해. 남용하지마."*

Fable 은 **한정 자원**이다. 목록으로 외우지 말고 **아래 세 질문에 답해서 판정**한다.

### 세 축

| 축 | 질문 | 판정 |
|---|---|---|
| **R** 가역성 | 틀렸을 때 **되돌릴 수 있는가?** 돈이 나갔나 · 데이터가 지워졌나 · 외부로 발송됐나 · 운영 스키마가 변했나 · 무인증 표면이 넓어졌나 | 되돌릴 수 **없다** → R=1 |
| **S** 구조적 판단 | **무엇을 검증해야 하는지부터 설계**해야 하는가? 절단면이 여럿이고 서로 간섭하는가? 상충하는 요구(보안↔도달성, 격리↔편의) 사이에서 **판단**이 필요한가? | 그렇다 → S=1 |
| **F** 자체 반증 가능성 | **내가 만들 수 있는 기계 검사로 참/거짓이 갈리는가?** (빌드 EXIT·`error TS`, health-check, 가드 래칫, 실HTTP 왕복, 실브라우저 좌표·가시성, 양성/음성 대조군) | 갈린다 → F=1 |

### 판정식

```
Fable 에 올린다  ⟺  R=1  OR  (S=1 AND F=0)
내가 검증한다     ⟺  R=0 AND (S=0 OR F=1)
```

- **R=1 이면 무조건 올린다.** 되돌릴 수 없는 것은 "내가 잘 봤다" 로 갈음할 수 없다.
- **R=0 이어도 S=1·F=0 이면 올린다.** 복잡한데 내가 참/거짓을 가를 검사조차 못 만드는 것 —
  여기서 Fable 의 값이 나온다(고품질 판단).
- **F=1 이면 내가 한다.** 되돌릴 수 있고 기계가 판정해 주는 것에 자원을 쓰지 않는다.
  대신 **반드시 실제로 돌려 수치로 보고**하고 **"Fable 미검증(자체 검증)"** 이라고 적는다.

### 축별 구체 (판정 보조)

**R=1 (비가역) — 이 중 하나라도 닿으면**
결제/환불·청구 금액 공식·정기청구 엔진 · 증빙 발행 · 멀티테넌트 격리(`business_id`) ·
운영 DB 마이그레이션·백필 · 인증/권한 미들웨어(`authenticateToken`·`checkBusinessAccess`·
`requireMenu`·`access_scope`) · 라우터 마운트 순서 · **공개(무인증) 라우트 추가·표면 확장** ·
외부 발송(메일/푸시/SMS) 트리거 · 보관기간·삭제 실행 · 생명선 코드(receiptsDue 단일원천,
`task_workflow` status 전이)

**S=1 (구조적 판단)**
새 시스템·아키텍처 결정 · 새 데이터 모델의 절단면 · 여러 진입점이 **같은 술어**를 공유해야 하는 설계 ·
"무엇이 올바른 동작인가" 가 요구사항에서 자동으로 안 나오는 것

**F=1 (자체 반증 가능) — 대부분의 화면 작업이 여기다**
UI 레이아웃·밴드·간격·크기·위치·문구·색·반응형 분기 · 드로어/팝오버 열닫힘·정렬·필터·토글 ·
동작 불변 리팩터링 · i18n 추가 · 로그·에러 문구 노출 · 단일 라우트 버그 수정

### 자체 검증일 때 지켜야 할 최소선
F=1 이라고 선언한 순간, **그 기계 검사를 실제로 만들어 돌린다.** 이번 세션의 교훈:
- **축을 좁히면 F=1 이 거짓말이 된다** — 데스크탑만 재고 폰을 안 재서 회귀 3건을 놓쳤다.
  화면이면 **폰·태블릿·데스크탑**을 다 잰다.
- **크기만 재지 말고 "보이는가" 를 잰다** — rect 가 176×24 인데 부모 높이 0 + `overflow:hidden`
  이라 **한 픽셀도 안 그려진** 사례. 조상 클리핑 + `elementFromPoint` + 스크린샷.
- **검사기를 고쳤으면 양성 대조군으로 증명한다** — 버그 조건을 되살렸을 때 판정이 뒤집히는지.
  안 그러면 빨간불을 끈 것일 뿐이다.

### 올릴 때의 소모 규칙
- **묶어서 한 번.** 같은 기능의 후속 수정을 쪼개 올리지 않는다. 신고가 연달아 와도 2~3건 모아 한 라운드.
  (2026-08-20 팝아웃 핀 하루 8회 · 2026-09-06 상세 헤더 3회 — 둘 다 쪼개 올려서 났다.)
- **프롬프트는 짧게** — 신고 원문 + 변경 요약 + 확인 항목. 배경 설명이 곧 토큰이다.
- **애매하면 자동으로 올리지 않는다. 한 줄로 Irene 에게 묻는다.**
  (옛 규칙 "의심되면 게이트" 는 폐기 — 그 문장이 남용의 근거였다.)

### 올릴 때 Fable 이 하는 것
① **diff 범위 대조** (설계 외 변경 0)
② **가드** — `node scripts/health-check.js`, `npm run build`(EXIT 0 + `error TS` 0),
   `node scripts/guard-invariants.js --category=i18n|parity`, 멀티테넌트 `business_id` 점검
③ **실호출·회귀** — 코드 리뷰가 아닌 실제 HTTP (login → CUD → 재조회 일치, 권한별 403, 운영 옛 데이터 1건)
④ **배포 안전성** — 마이그레이션 절차(idempotent) / 청크 해시 갱신 / 롤백 경로

---

## 개발 환경

### 경로
| 구분 | 경로 |
|------|------|
| 프로젝트 루트 | `/opt/planq/` |
| 백엔드 | `/opt/planq/dev-backend/` |
| 프론트엔드 소스 | `/opt/planq/dev-frontend/` |
| 프론트엔드 빌드 | `/opt/planq/dev-frontend-build/` |
| Q Note (Python) | `/opt/planq/q-note/` |

### 서버
| 구분 | 값 |
|------|-----|
| 개발서버 IP | 87.106.11.184 |
| 개발 도메인 | dev.planq.kr |
| 백엔드 포트 | 3003 |
| Q Note 포트 | 8000 |
| DB | planq_dev_db / planq_admin |
| PM2 | planq-dev-backend, planq-qnote |

### 같은 서버의 다른 서비스 (절대 건드리지 말 것)
| 항목 | 값 |
|------|-----|
| PurpleHere POS 백엔드 | `/var/www/dev-backend` (port 3001) |
| PurpleHere POS 프론트엔드 | `/var/www/dev-frontend-build` |
| POS DB | purple_dev_db / dev_admin |
| POS PM2 | dev-backend |
| POS 도메인 | dev.purplehere.com |

---

## 빌드 & 반영

### 빌드 실행 규칙 (절대 준수)
- **반드시 `run_in_background: true`로 실행** (포그라운드 시 Claude Code가 not responding됨)
- **빌드 실행 후 "빌드 진행 중입니다" 안내** → 완료 알림 오면 결과 보고
- **이전 빌드가 실행 중이면 kill 후 새 빌드 시작**

```bash
# 프론트엔드 빌드
cd /opt/planq/dev-frontend && npm run build

# 백엔드 변경 시
pm2 restart planq-dev-backend

# DB 스키마 변경 시
cd /opt/planq/dev-backend && node sync-database.js
pm2 restart planq-dev-backend
```

---

## 배포 규칙

- **Irene이 "배포" 명령을 하지 않으면 절대 배포하지 않음**
- 빌드 완료 후 자동 배포 금지
- 운영서버 배포 스크립트는 별도 작성 예정

---

## 기술 스택

| 영역 | 스택 |
|------|------|
| Frontend | React + TypeScript + Vite + styled-components |
| Backend | Node.js + Express + Sequelize (MySQL 8.0) + Socket.IO |
| Q Note | Python + FastAPI (별도 프로세스) |
| 인증 | JWT (Access 15분 + Refresh 7일) |
| 이메일 | Nodemailer |
| 프로세스 | PM2 |

---

## 코딩 가이드

### API 응답 형식 (표준)
```javascript
// 성공
res.json({ success: true, data: result });
res.json({ success: true, data: result, message: '선택적 메시지' });

// 성공 (목록 — pagination)
res.json({ success: true, data: [...], pagination: { total, limit, page, offset, has_more } });

// 실패
res.status(400).json({ success: false, message: 'Error description' });
```

### List 라우트 pagination 표준 (사이클 N+50 박제)

**모든 신규 GET list 라우트는 `parsePagination` + `paginatedResponse` 사용 필수.** SaaS readiness — workspace 데이터 누적 시 unbounded 응답 OOM 차단.

```javascript
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await Model.findAndCountAll({
      where,
      include,
      order: [['created_at', 'DESC']],
      limit, offset,
      distinct: true,  // include 조인이 1:N 일 때 count 정확도
    });
    return paginatedResponse(res, rows.map(serialize), count, { limit, page, offset });
  } catch (err) { next(err); }
});
```

**default / max 가이드:**
- 일반 list (records, posts, backlog, requested, archived): default 200 / max 500
- files / aggregate (all-tasks, all-files): default 500 / max 1000
- 큰 list (conversations, kb): cap 1000 / max 2000 (post-fetch sort/filter 있을 때 paginatedResponse 대신 soft cap 만)

**?page=** 1-base 또는 **?offset=** 둘 다 지원. offset 우선. ?limit 없으면 default 사용. ?limit > max 면 max 로 cap.

**Frontend 호환성:** `data` 필드는 여전히 배열 — pagination 키만 추가됨. 기존 호출은 무변경 동작. frontend 가 `?page=` 또는 `pagination` 키를 점진 opt-in 가능.

**적용 완료 (사이클 N+50):** files / posts / conversations(soft cap) / archived / projects all-tasks · all-files / tasks backlog · requested / records / kb(soft cap)

### 파일 크기 기준
- 라우트 파일: 500줄 이상이면 기능별 분리 검토
- 컴포넌트 파일: 800줄 이상이면 하위 컴포넌트 분리 검토

### 백엔드 엔트리 포인트
- PM2 실행 파일: `server.js`만 사용

### 코드 스타일
- 들여쓰기: 2 spaces
- 세미콜론: 사용
- 문자열: 작은따옴표
- async/await 사용 (콜백/then 금지)
- 에러 처리: try/catch + 공통 에러 핸들러
- Sequelize 모델: `class X extends Model`, `X.init({...}, { sequelize, tableName, timestamps, underscored: true })`
- 라우트: `express.Router()`, `successResponse/errorResponse` 헬퍼 사용
- snake_case: DB 컬럼, API 응답 필드
- camelCase: JavaScript 변수, 함수

---

## 보안

### 인증
- JWT (Authorization: Bearer {token})
- Access Token: 15분, Refresh Token: 7일 (HttpOnly Cookie)
- bcryptjs salt rounds: 12

### 인증/인가 미들웨어
| 미들웨어 | 용도 |
|----------|------|
| `authenticateToken` | JWT 토큰 검증 |
| `requireRole(...)` | 플랫폼 역할 확인 |
| `checkBusinessAccess` | 해당 비즈니스 접근 권한 확인 |

### API별 미들웨어 적용
| API 유형 | 필수 미들웨어 |
|----------|-------------|
| 공개 (로그인, 회원가입) | 없음 |
| 사용자 본인 데이터 | authenticateToken |
| 비즈니스 데이터 | authenticateToken + checkBusinessAccess |
| 플랫폼 관리 | authenticateToken + requireRole('platform_admin') |

### 보안 미들웨어 (middleware/security.js)
- Helmet: 보안 헤더
- CORS: dev.planq.kr, planq.kr만 허용
- Rate Limit: 로그인 5회/15분, 회원가입 3회/1시간, 일반 100회/분
- SSRF 방어: URL 파라미터 검사, 내부 IP 차단
- SQL Injection 패턴 감지: 추가 방어층
- CSP: Content Security Policy
- 보안 헤더: XSS-Protection, X-Frame-Options, Referrer-Policy, Cache-Control

### 멀티테넌트 격리
- 모든 쿼리에 `WHERE business_id = ?` 필수
- JOIN 시에도 business_id 조건 유지
- Client는 자기 대화방/할일/파일만 접근

### 체크리스트
- 사용자 입력 검증 필수
- business_id 파라미터 신뢰 금지 → checkBusinessAccess로 소유권 확인
- 민감한 데이터 로깅 금지 (비밀번호, 토큰)

---

## 운영 정책

- 메시지 삭제: 마스킹 (is_deleted=true, 원본은 DB 유지, UI에서 "삭제된 메시지")
  - **원문을 지우는 것은 서버 책임** — `utils/deletedMessage.js` `maskDeletedMessages()` 단일 지점.
    조회 라우트는 이 함수를 부른다(직접 필드를 비우지 말 것). 2026-09-02 실사례:
    `content` 만 비운 코드가 **`translations`(번역 캐시는 원문 언어 사본을 함께 갖는다)·`ai_sources` 로
    본문을 그대로 내보냈다.** 화면에 안 보인다고 안 나간 것이 아니다.
  - **지울 것을 열거하지 말고 남길 것만 남긴다(화이트리스트).** 열거 방식은 컬럼이 늘 때마다 조용히 샌다.
  - **마스킹은 표시명(applyMemberDisplayName·applyGuestDisplayName)을 다 적용한 뒤에 부른다.**
    게스트 이름은 `meta.guest.name` 에서 오므로 `meta` 를 먼저 지우면 그림자 User 이름
    (= 고객 표시명)으로 떨어져 **링크 받은 제3자가 고객 본인처럼 보인다**(#259 회귀).
  - **고객(Client)·게스트에게는 자리도 보이지 않는다** — `routes/guest.js` `visibleToGuest` 와 같은 술어.
    지운 것을 지웠다고 알리는 것은 우리 쪽 사정이다.
- 메시지 수정: 허용 (is_edited=true, edited_at 기록, UI에서 "(수정됨)")
- 할일 마감 지연: 빨간 뱃지, 마감 연장은 담당자 이상
- 감사 로그: 모든 CUD 작업 AuditLog에 기록 (old_value/new_value JSON)

---

## DB 테이블 (34개)

**기본 (13):** users, businesses, business_members, clients, conversations, conversation_participants, messages, message_attachments, tasks, files, invoices, invoice_items, audit_logs

**Q Talk / 프로젝트 (6):** projects, project_members, project_clients, project_notes, project_issues, task_candidates

**Q Task 워크플로우 (4):** task_comments, task_daily_progress, **task_reviewers**, **task_status_history**

**파일 시스템 (3):** **file_folders**, **business_storage_usage**, **ops_capacity_log**

**Q docs (4):** document_templates, documents, document_revisions, document_shares, posts, post_attachments, post_categories

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
> - **요청 탭 책임선 분리** — `tab='requested'` 시 예측시간/AI/반복 UI 숨김 + 백엔드 POST 라우트 sanitize (담당자 ≠ 작성자면 NULL 강제). PERMISSION_MATRIX §5.7 일관.
> - **디자인 시스템** — `components/Common/ActionButton.tsx` (3톤 × sm 36/md 40/lg 44 + Spinner + focus ring) + `DrawerFooter.tsx` (sticky bottom + safe-area + 좌/우 슬롯). TaskDetailDrawer Action* alias 마이그레이션 (사용처 17곳 무변경).
> - **개인 보관함 정책 재정의** — Drive 연동과 무관, 항상 자체 스토리지. 워크스페이스 공용 quota 안 합산. 개인별 quota 분리 X. 설정 페이지 "파일 저장소" → **"파일·외부 연동"** (캘린더 포함 의도).
> - **GDrive reconnect 옛 폴더 재사용** — drive.file scope 안에서 같은 이름 폴더 search → 가장 오래된 createdTime 재사용. 중복 폴더 자동 차단.

**기타 (2):** kb_chunks, kb_documents, kb_pinned_faqs, cue_usage

**플랫폼 운영 (1):** **dev_status_reports** (2026-09-03 신규 — 배포별 개발 현황. platform_admin 전용.
키는 `commit_to` UNIQUE (버전은 며칠씩 안 오르는데 배포는 하루 여러 번 한다 — version 을 키로 잡으면
그날 배포가 1행으로 덮인다). 기계가 아는 값(커밋 범위·배포 시각·롤백 경로·닫은 신고·스키마 변경 여부)은
`scripts/deploy-planq.sh publish_dev_status()` 가 `--meta` 로 주입하고, 사람은 `docs/dev-status/next.json` 에
서술 11섹션만 쓴다. **릴리즈노트(HelpArticle)와 같은 곳에 두지 않는다** — HelpArticle.visibility 는
('public','authenticated') 두 값뿐이라 넣는 순간 모든 로그인 사용자에게 흘러가고, 여기에는 미공개 이슈가 실린다.
화면 `/admin/dev-status` 는 **텍스트로만** 렌더한다(저장형 XSS 차단). 발행 스크립트는 `dev-backend/scripts/` 에
둔다 — 운영에는 루트 `scripts/` 가 없다(rsync 는 dev-backend 만 보낸다))

**Q Note STT 과금 (2026-07-03 신규):** `qnote_usage` (월 rollup — `seconds_used` source of truth, `minutes_used`=FLOOR(초/60) 표시용), **`qnote_usage_events`** (멱등 원장 — UNIQUE(stream_id, segment_seq). stream_id=WS 연결마다 UUID → 재연결 quota 우회 차단. session_id는 q-note SQLite 소재라 FK 없음). q-note `live.py`가 5분마다 `POST /api/internal/qnote/usage`로 billed 초(stereo ×2) 기록, 트랜잭션 멱등 insert + `FOR UPDATE` rollup(정확히 한 번). 진입 hard-block: `/ws/live` accept 후 Deepgram 연결 前 internal `qnote/can`(4030) + `business-membership`(4031). 설계 docs/QNOTE_STT_BILLING_DESIGN.md

**게스트 링크 (1):** **guest_links** — 무로그인 링크(#259). **2026-09-05: `scope` ENUM('conversation','project') 추가, 기본값 `conversation`.** 이 컬럼이 곧 **여는 것의 상한**이다 — `conversation` 토큰으로 프로젝트 탭 라우트(`/api/guest/:token/tasks` 등)를 부르면 **404**. 기본값을 conversation 으로 둔 이유: **이미 나가 있는 링크가 조용히 넓어지면 안 된다**(운영 기존 행은 전부 conversation 으로 남는다). 운영 적용은 `dev-backend/scripts/migrate-guest-link-scope.js`(멱등) — **코드 배포 전에** 실행한다(컬럼이 없으면 500). 발급 가능 판정은 `services/guest_link.js assertGuestLinkIssuable` **한 함수**(대화방·프로젝트 두 라우트가 같이 부른다 — 복사했다가 한쪽에서 죽은 코드가 된 전례). 설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md

**Q위키 (2):** **help_categories**, **help_articles** (2026-06-18 신규 — PlanQ 제품 사용법 도움말. 플랫폼 공통 콘텐츠(business_id 없음), 격리 축은 article.visibility('public'/'authenticated')만. help_articles FULLTEXT(ngram) 한글검색 + body ko/en JSON 블록. 본문 임베딩은 **kb_chunks 재사용**(source_type ENUM 'kb'/'wiki' 추가 + source_id + business_id/kb_document_id nullable — wiki chunk는 플랫폼 공통이라 NULL, 워크스페이스 KB 검색 비오염). 스크린샷은 File 재사용(image 블록 file_id). 운영 적용 시 `dev-backend/setup-wiki-schema.js`(FULLTEXT+ALTER 멱등) + `seed-wiki-content.js`(콘텐츠) 실행. 설계 docs/Q_WIKI_DESIGN.md)

> **Q Task 상태 ENUM:** `not_started`, `waiting`, `in_progress`, `reviewing`, `revision_requested`, `completed`, `canceled`. (2026-04-25: `done_feedback` 폐지 — 컨펌 정책 충족 시 `recalcStatusFromReviewers` 가 자동 `completed` 전환). 관점별 UI 라벨은 `dev-frontend/src/utils/taskLabel.ts` 참조 (i18n `status.{code}.{role}` 4차원 구조).
>
> **Q Task 시간/진행율 권한 (2026-04-25):** `estimated_hours / actual_hours / progress_percent` 는 **담당자만 입력 가능**. 비담당자가 PATCH/PUT 시 `only_assignee_can_edit_hours` 403. 프론트는 `assignee_id !== myId` 시 input disabled (회색·점선·spinner 숨김). 다른 역할은 read-only 참고.
>
> **Q Task 본문 필드 책임선 분리 (2026-05-10, 사이클 N+5):** PERMISSION_MATRIX §5.7 정식 박제.
> - **description (의뢰 명세)** → 작성자/owner/admin (담당자 빠짐). 담당자는 코멘트로 보충
> - **body (결과물)** → 담당자/admin (owner 빠짐 — 결과물에 owner 가 손대고 싶으면 컨펌 반려 워크플로우로)
> - **title/category** → 작성자/담당자/owner/admin
> - **DELETE task** → owner/admin. 작성자는 댓글·이력·리뷰어 0건 신생 task 만 (실수 정정용)
> - 프론트엔드: `TaskDetailDrawer.tsx` `canEditTitle/canEditDescription/canEditBody` 3분기. 권한 없으면 RichEditor `readOnly` + 섹션 옆 회색 "읽기 전용" 뱃지
> - RichEditor 의 anchor 는 `openOnClick: true` + `target=_blank` — editable/readOnly 무관하게 본문 링크 항상 새 탭

> **Invoice 재무 owner only (2026-05-10, 사이클 N+5):** PERMISSION_MATRIX §5.10. `assertInvoiceMutationOwner` 헬퍼 (`routes/invoices.js`) — 발행(send) / 결제 마킹(mark-paid·unmark-paid) / 세금계산서(mark-tax-invoice) / 삭제(invoice·installment) 5개 라우트에 적용. member 호출 시 403 `owner_only`. draft 생성·편집은 member 도 OK. `invoices.owner_user_id` 컬럼은 담당자 표시용으로만 — 권한 부여 안 함 (혼란 방지).

> **Q Note 진짜 사적 공간 (코드 정합):** `q-note/routers/sessions.py` 의 모든 라우트가 `_load_session_or_403(db, session_id, user['user_id'])` 강제. 본인 세션 외 무조건 403 — owner 도 admin 도 백도어 없음. PERMISSION_MATRIX §5.8 박제. memory `feedback_qnote_personal_tool.md` 와 일치.

> **사이클 N+6/N+7 — v1.5.3 (2026-05-11):** 진행률 sync + reviewer 분기 + 관련업무·description 첨부 + 시간 자동 누적 + 모바일 UX. commit `1031409`.
>
> - **task_links 테이블 (양방향, a < b 강제)** — 관련 업무 링크. `routes/tasks.js` GET/POST/DELETE links + GET search. workspace 격리, cross-workspace 차단. 자기 자신·중복 차단. UI: `RelatedTasksSection.tsx` (description 섹션 안)
> - **TaskAttachment.context ENUM 'description_attach' 신설** — 의뢰자 영역 댓글식 첨부. 권한 = description 편집 권한 (작성자/owner/admin, 담당자 빠짐). `DescriptionAttachments.tsx` (FilePicker 패턴, uploads + 기존 파일·문서 link)
> - **Task.actual_source ENUM('auto','user')** — 시간 자동 누적 vs 사용자 입력 구분. `services/taskActualHours.js` recomputeActualHoursFromHistory + TaskStatusHistory afterCreate hook. in_progress 진입~이탈 라운드 합산. 사용자 직접 입력 시 'user' 자동 전환 + 자동 누적 정지
> - **reviewer 가드 (PUT 라우트)** — reviewer 0명이면 status='reviewing'/'revision_requested' 차단 (400 `no_reviewers_assigned`). 100% 자동 completed 도 reviewer ≥ 1 시 차단 (in_progress 유지, "확인 요청 보내기" 명시 클릭 필요)
> - **진행률 ↔ status 양방향 sync (PATCH + PUT 단일 진실 원천)** — `routes/tasks.js` PUT 에 progress → status 자동 전환 분기 추가. completed → active 전환 시 progress 100 → 90 자동 / completed 진입 시 progress < 100 이면 자동 100. frontend QTaskPage.saveField 의 이중 PUT 호출 제거
> - **refresh_token chain 격리** — reuse_detected 가 같은 user 의 모든 active row 일괄 revoke 하던 회귀 → chain (`replaced_by_id` 사슬) 만 revoke. rotation grace 30s → 5min (모바일 PWA wake-up). memory `project_multi_device_session.md` 업데이트
> - **refresh_token TTL by client_kind (사이클 N+10, 2026-05-12):** `refresh_tokens.client_kind` ENUM('pwa','web'). PWA standalone=365일 / web=30일 sliding renewal. 결정 우선순위: `req.body.client_kind` > `X-Client-Kind` 헤더 > 옛 row.client_kind > 'web'. frontend `detectClientKind()` 가 `display-mode: standalone` 매치 시 'pwa' 결정. login/register/refresh fetch 에 헤더 + body 자동 전달. cookie maxAge 동기. JWT expiresIn 도 동일 분기 (365d/30d).
> - **이번 주 내 업무 필터** — 담당자=나 분기 status 화이트리스트 제거 → 활성 status 모두 표시 (reviewing 포함). "마감 책임 = 담당자 끝까지"
> - **statusOptionsFor 3곳 일관** — QTaskPage / TaskDetailDrawer / ProjectTaskList — reviewer 0명이면 reviewing/revision_requested 옵션 숨김
> - **모바일 UX** — FilePicker 75vh bottom sheet (slide-up, safe-area), QTalk LeftPanel PinBtn `@media (hover: none), (max-width: 1024px)` 항상 노출 + Unread `margin-left: auto` 우측 끝
> - **보안 .env 권한 600 → 640** — planq 그룹 (irene + lua) read 허용. lua PM2 환경변수 정상 로드. q-note/.env 도 강화

> **댓글·메모 visibility 통일:** `personal`/`internal`/`shared` — `task_comments` 와 `project_notes` 공통 ENUM.
>
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

## 파일 저장

- 경로: `/opt/planq/dev-backend/uploads/{business_id}/{yyyy-mm}/`
- 파일명: UUID로 변환 (원본 파일명은 DB에 저장)
- **파일당 용량 제한:** Free 10MB, Basic 30MB, Pro 50MB
- **플랜별 총 스토리지 쿼터:** Free 1GB / Basic 50GB / Pro 500GB (운영 기준)
- 허용 확장자: jpg, jpeg, png, gif, pdf, doc, docx, xls, xlsx, ppt, pptx, zip, txt

### SHA-256 dedup
- 업로드 시 `content_hash` 계산 → 동일 해시 존재하면 물리 파일 1개만 보관, `ref_count` 증가
- 삭제는 소프트 삭제 (`deleted_at`) + `ref_count` 감소. 0 도달 시 물리 파일 제거
- 외부 클라우드(gdrive) 연동 시 dedup 비활성 (외부 정책 위임)

### 파일 시스템 문서
- **설계:** `docs/FILE_SYSTEM_DESIGN.md` (스키마·API·UI·외부 연동 전 10섹션)
- **운영 로드맵:** `docs/OPS_ROADMAP.md` (Stage 0~4 임계치, 자동 경보 스크립트)
- **OPS 체크:** `scripts/ops-capacity-check.js` (주 1회, 가입자·용량 집계 + Stage 전환 감지)
- **UI 컴포넌트:** `pages/QProject/DocsTab.tsx` — scope prop 으로 프로젝트/워크스페이스 재사용

---

## 설계 문서

| 문서 | 경로 |
|------|------|
| 시스템 아키텍처 | `docs/SYSTEM_ARCHITECTURE.md` |
| ERD 데이터베이스 | `docs/DATABASE_ERD.md` |
| 정보구조 (IA) | `docs/INFORMATION_ARCHITECTURE.md` |
| API 설계 | `docs/API_DESIGN.md` |
| 기능 정의서 | `docs/FEATURE_SPECIFICATION.md` |
| 보안 설계 | `docs/SECURITY_DESIGN.md` |
| 개발 로드맵 + 프롬프트 | `docs/DEVELOPMENT_ROADMAP.md` |
| **Q Bill·서명·결제 통합 설계 (2026-04-26)** | `docs/Q_BILL_SIGNATURE_DESIGN.md` |
| UI 디자인 가이드 | `dev-frontend/UI_DESIGN_GUIDE.md` |
| 색상 가이드 | `dev-frontend/COLOR_GUIDE.md` |

---

## Git

- 저장소: `git@github-planq:ireneceo/planq.git`
- SSH Host: `github-planq` (id_ed25519 키 사용)
- 기본 브랜치: main

---

## 다국어 (i18n — 필수)

PlanQ는 **한국어/영어 두 언어를 동시 지원**한다. 모든 사용자 노출 문자열은 처음부터 ko/en 양쪽을 작성해야 한다.

### 규칙
- **사용자에게 보이는 모든 문자열은 하드코딩 금지** — `useTranslation('<네임스페이스>')` + `t('key')` 사용
- **기획 단계에서부터 ko/en 문구를 함께 정의** — 설계 문서에 영어 텍스트 없는 항목은 미완으로 간주
- 새 페이지/기능 개발 시: **JSON(ko/en) 작성 → 컴포넌트에서 `t()` 사용** 순서
- 인라인 HTML 태그가 포함된 문구는 `<Trans i18nKey="..." components={{ 1: <strong /> }} />` 사용
- 동적 값은 `{{name}}` 보간: `t('register.hello', { name })`
- 제외: 코드 주석, 개발용 로그, 언어별 예시 문장(예: 음성 등록용 한국어 샘플)

### 네임스페이스 구조
- `common` — 공통 버튼/상태/메시지/역할
- `auth` — 로그인/회원가입
- `layout` — 사이드바 메뉴/사용자 영역
- `profile` — 내 프로필
- `qnote` — Q note 페이지 + 회의 시작 모달
- (신규 기능 추가 시: `qtalk`, `qtask`, `qcalendar`, `qdocs`, `qfile`, `qbill`, `dashboard` …)

### 파일 위치
- ko: `dev-frontend/public/locales/ko/<namespace>.json`
- en: `dev-frontend/public/locales/en/<namespace>.json`
- 설정: `dev-frontend/src/i18n.ts` (`ns` 배열에 신규 네임스페이스 등록 필수)

### 검사

**정본은 가드 스크립트다. 아래 명령으로만 판정한다.**

```bash
# 한국어 하드코딩 래칫 + ko/en 키 패리티 + i18n.ts ns 등록
node scripts/guard-invariants.js --category=i18n
node scripts/guard-invariants.js --category=parity
```

래칫이라 **기존 부채는 동결, 증가만 실패**한다. 실패하면 신규 위반을 i18n 으로 전환하고,
의도적으로 부채를 줄인 경우에만 `--update-baseline` 으로 조인다.
(단독 `--category=X --update-baseline` 은 **다른 카테고리 베이스라인을 파괴**한 전례가 있다 — 전체 실행으로 갱신할 것.)

제외 규칙(가드 내장): `t()` 폴백·`i18nKey`·`defaultValue`·`console.*`·주석(`//`, `/*`, `*`, JSX `{/*`).
memory `feedback_i18n_tdefault_not_hardcoding` — **t() 기본값은 하드코딩이 아니다.**

**한 파일만 눈으로 훑을 때의 보조 grep** (가드보다 시끄럽다 — `t()` 폴백까지 잡힌다):

```bash
grep -rEn "'[^']*[가-힣][^']*'|\"[^\"]*[가-힣][^\"]*\"" dev-frontend/src --include='*.tsx' --include='*.ts' \
  | grep -v -E '//|/\*|\*/|^\s*\*' | grep -v '/locales/'
```

> ⚠️ **옛 문서의 역참조 grep(`(['\"\`])…\1`)은 쓰지 말 것 — 거짓 통과한다.**
> 이 서버 `grep` 은 ugrep 이라 **역참조가 동작하지 않아 저장소 전체에 대해 항상 0건**을 반환한다.
> 2026-07-28 반증: 실제 하드코딩(`title="저장되었습니다"`)을 심고 세 명령을 돌린 결과 —
> 옛 grep **0건(못 잡음)** / 가드 스크립트 **FAIL(426 vs base 426, 잡음)** / 위 보조 grep **1건(잡음)**.
> 같은 정규식이 가드 스크립트(JavaScript) 안에서는 정상 동작하므로 가드 자체는 건전하다.

---

## 페이지 레이아웃 표준 (필수)

모든 페이지는 아래 **2가지 레이아웃 중 하나**를 사용한다. 공통 컴포넌트 안에 표준 스타일이 잠겨있으므로 **신규 페이지는 반드시 이 둘 중 하나로 구현**한다.

### 1) 단일 컬럼 페이지 — `PageShell`

설정·프로필·목록(고객/업무/문서 등) 페이지에 사용.

```tsx
import PageShell from 'components/Layout/PageShell';

<PageShell
  title={t('page.title')}
  count={items.length}                 // 선택 — 제목 옆 카운트 배지
  actions={<><SearchInput/><InviteBtn/></>}  // 선택 — 헤더 우측
>
  {/* 본문 */}
</PageShell>
```

표준값(건드리지 말 것):
- 헤더 `min-height: 60px`, `padding: 14px 20px`, `background: #fff`, `border-bottom: #e2e8f0`
- 제목 `18px / 700 / -0.2px`
- 배경 `#f8fafc`, Body padding 20px

### 2) 멀티 컬럼(패널) 페이지 — `PanelHeader`

Q Talk / Q Note / Q Task 같은 3컬럼 레이아웃에서 각 패널 상단에 사용. **모든 패널의 헤더 `min-height: 60px`** 로 좌우 border-bottom 이 수평 연결된다.

```tsx
import PanelHeader, { PanelTitle, PanelSubTitle, PanelMetaTitle } from 'components/Layout/PanelHeader';

<PanelHeader><PanelTitle>Q talk</PanelTitle></PanelHeader>       // 앱 타이틀 (18px)
<PanelHeader><PanelSubTitle>{chat.name}</PanelSubTitle></PanelHeader>  // 선택된 항목명 (16px)
<PanelHeader><PanelMetaTitle>프로젝트 작업대</PanelMetaTitle></PanelHeader>  // 보조 섹션 (13px)
```

### 3) 상세 화면은 **두 밴드**로 끝낸다 (2026-09-06 박제 — 전 화면 공통)

상세(detail) 화면의 제목 위쪽 크롬은 **항상 밴드 2개**다. 셋째 밴드를 만들지 않는다.

| 밴드 | 컴포넌트 | 왼쪽 | 오른쪽 |
|---|---|---|---|
| 1 · 60px | `PanelHeader` (`PanelHeaderBar`) | 제목 (**자르지 않는다**) | **⋯ 하나만** (`OverflowMenu`) |
| 2 · 57px | `DetailMetaBar` + `DetailMetaLeft`/`Right` | 메타·상태 칩 (작성자·날짜·분류·담당·라벨) | 자주 쓰는 액션 **3개 이내** |

```tsx
import PanelHeader, { PanelSubTitle, DetailMetaBar, DetailMetaLeft, DetailMetaRight }
  from 'components/Layout/PanelHeader';

<PanelHeader onBack={...}>
  <TitleSlot><PanelSubTitle>{title}</PanelSubTitle></TitleSlot>
  <ActionSlot><OverflowMenu label={t('actions.more')} items={menuItems} /></ActionSlot>
</PanelHeader>
<DetailMetaBar>
  <DetailMetaLeft>{/* 칩·메타 */}</DetailMetaLeft>
  <DetailMetaRight>{/* 액션 3개 이내 */}</DetailMetaRight>
</DetailMetaBar>
```

**규격은 절대 각자 쓰지 않는다.** 밴드1 은 `PanelHeaderBar`, 밴드2 는 `DetailMetaBar` 를
**상속**한다(`styled(PanelHeaderBar)`). 손으로 다시 쓰면 반드시 갈라진다 — 2026-09-06 실측:

| 화면 | 무엇이 갈라져 있었나 |
|---|---|
| Q Note 음성 세션 (`MainHeader`) | 표준을 **베낀 복사본**. 2026-08-25(폰 `column` 폐기)·08-30(높이 하한) 두 수리를 못 받아 폰에서 밑줄이 어긋났다. 접기 손잡이가 셋째 자식이라 `:last-child` 계약을 가로채 **액션 칸이 `flex-shrink` 를 잃고 있었다** |
| Q Note 메모 (`MemoView`) | 제목·저장상태·분류/태그를 헤더 **안에 세로 3줄**로 쌓아 60px 계약을 넘겼다 |
| Q Note 리스트 (`SidebarHeader`) | `min-height:60px` + 안쪽 32px 버튼 → **61px**. 우측 상세는 `height:60px` → 60px. 좌우 회색 선이 **1px** 어긋났다 |

> Irene 2026-09-06: *"노트는 틀어지네. 모든 상세 헤더영역 다 검토해줘."*

**밴드1 안에는 자식을 정확히 둘(제목 칸 / 액션 칸)만 둔다.** 셋째를 넣으면 `:last-child`
계약이 그쪽으로 옮겨가 액션 칸이 줄어든다 — `position:absolute` 인 장식이라도 선택자에는
걸린다. 그런 것은 밴드 **밖**(감싸는 `position:relative` 요소)에 둔다.

**밴드2 좌측은 `flex-wrap` 하지 않는다** — 라벨이 늘 때마다 밴드가 두 줄, 세 줄이 되면
"2밴드" 계약이 데이터에 따라 조용히 깨진다. 넘치면 가로로 흘린다(`overflow-x`).

**값이 붙은 메타(담당자·라벨)는 `components/Common/ChipPopover.tsx`** — 값은 칩으로 보이고
고치는 컨트롤은 누를 때만 꺼낸다. 셀렉트를 툴바에 그대로 세우면 150px 를 상시 먹는다.

> ⚠️ **팝오버 안에 `PlanQSelect` 를 넣지 말 것.** 그 컴포넌트는 메뉴를 `document.body` 로
> **포털**한다(`PlanQSelect.tsx:309`). 팝오버의 바깥클릭 판정에는 포털된 옵션이 "바깥" 이라
> **선택되기 전에 닫힌다** — 눌러도 아무 일이 없는 컨트롤이 된다
> (memory `feedback_ui_control_sends_nothing`). 목록 버튼으로 직접 그린다.

**보기·편집 두 모드를 같이** 바꾼다 — 한쪽만 밴드 수가 다르면 모드를 오갈 때 가로 실선이 튄다.
폰(≤640px)에서는 액션 묶음이 메타 아래로 감기게 둔다.

**아이콘 전용 버튼을 늘리는 것은 자리를 먹으면서 뜻은 안 알려주는 최악의 조합**이다.
메뉴로 접으면 자리를 돌려주고 글자 라벨이 붙어 오히려 읽힌다.

#### 실측 (1440px, 2026-09-06)

| 화면 | 본문 시작 y (전 → 후) | 밴드1 밑줄 좌/우 |
|---|---|---|
| Q Mail 상세 | **197 → 117** (액션·라벨이 3줄로 감겼다) | 190 / 190 ✅ |
| Q docs 상세 (보기) | 157 → **117** (메타줄이 본문 안에 있어 스크롤과 함께 사라지던 것도 밴드로) | 190 / 190 ✅ |
| Q docs 상세 (편집) | → **117** (보기와 같은 y) | 190 / 190 ✅ |
| Q Note 메모 상세 | 헤더 3줄 → **2밴드** | 190 / 190 ✅ (전 191/190) |

적용처: `pages/QMail/MailPage.tsx` · `components/Docs/PostsPage.tsx` ·
`pages/QNote/{QNotePage,MemoView}.tsx`. 신규 상세 화면도 이 구조를 쓴다.

> **좌측 리스트도 같이 맞춘다 (2026-09-06 해소).** Q Mail 폴더 탭 줄이 43px 이라 밴드2(57)와
> 14px 어긋나 있었다 → `FolderTabs` 에 `@media (min-width: 1025px) { min-height: 57px }`.
> Q Note 좌측 검색줄도 61 → 57(`padding-bottom` 12→8). 실측 **좌 247 / 우 247** 일치.
> ★ **폰·태블릿에는 주지 않는다** — 패널이 하나씩만 보여 이을 상대가 없고, 메일은 그 자리를
> 키우면 2026-09-03 에 고친 "상단이 화면의 48%"(#406) 가 그대로 돌아온다.

### 금지
- 페이지 루트에 직접 `<Page>`/`<Header>` styled 컴포넌트 선언 금지
- 헤더 높이·padding·제목 폰트 커스터마이즈 금지 (일관성)
- 헤더 **안에** 여러 줄(제목+부제) 쌓기 금지 — 부제/메타는 제목 옆 인라인으로 배치.
  액션이 많아 줄이 필요하면 위 3) 처럼 헤더 **밖(아래)** 으로 내린다
- 상세 헤더에 아이콘 전용 버튼 4개 이상 나열 금지 → OverflowMenu

---

## 자동저장 (필수)

- **저장이 필요한 모든 입력 폼은 AutoSaveField 컴포넌트를 사용**
- 저장 버튼 없음 → 입력하면 자동 저장 (debounce: input 2초, select/toggle 300ms)
- 성공: ✓ 뱃지만 표시 (2초 후 페이드), 에러: ! 뱃지 (4초 후 페이드)
- 성공 팝업/토스트 절대 금지
- 예외: 청구서 작성처럼 복잡한 폼은 저장 버튼 사용 가능
- 컴포넌트: `src/components/Common/AutoSaveField.tsx`
- **토글은 `type="toggle"` 로 감싸기만 하면 된다** — Wrapper 가 click 을 받는다(ref·triggerSave 불필요).
  래퍼 안에는 **저장 대상 컨트롤만** 둔다. 2026-09-02 이전엔 자식 `onChange` 만 감싸서
  **토글 5곳이 눌러도 저장을 안 했다**(운영 점검 모드 포함). 회귀는 `--suite toggles` 가 눌러서 잡는다.
- 상세: `dev-frontend/UI_DESIGN_GUIDE.md` 섹션 7

## 반응형 기본 원칙 (신규 코드 작성 시)

본격 반응형 스프린트는 기능 완성 후 진행 예정이지만, **신규 컴포넌트는 아래 3원칙을 지켜 작성**해야 나중 리팩토링 비용이 줄어든다.

1. **고정 px 폭 지양** — `width: 420px` 대신 `max-width`, `flex`, `minmax()` 사용. 불가피하게 고정이 필요하면 `dev-frontend/src/theme/breakpoints.ts` 의 미디어쿼리 토큰으로 모바일 축소 규칙을 같이 작성.
2. **아이콘 버튼 최소 36×36** — 하단 44까지 확장 가능하도록 여백 확보. 현재 타겟은 36, Phase 5 에서 44 로 일괄 상향.
3. **인라인 `style={{ width: '...' }}` 금지** — styled-components 또는 props 로 관리. 미디어쿼리가 끼어들 틈을 남겨둘 것.

토큰:
```ts
import { mediaPhone, mediaTablet, BP } from 'theme/breakpoints';
// phone: <=640 / tablet: <=1024 / desktop: >=1025
```

## UI 규칙 — 리스트 재클릭 토글

**"선택된 항목을 다시 클릭하면 선택 해제"** — 리스트/드로어/탭 모두 공통.

- Q Talk 대화방, Q Note 세션, Q Task 업무 드로어, Q Project 업무 드로어, Q Task 리스트 행, 카드 — 모두 동일 패턴 적용
- 구현 원칙: 선택 핸들러 진입부에서 `active === clickedId` 검사 후 해제
- URL 싱크된 상세(drawer) 도 같이: `closeDetail()` 호출해 `?task=` 파라미터 제거
- 장기적으로 신규 리스트/상세 컴포넌트 추가 시 이 규칙을 먼저 적용

```ts
const handleSelect = (id) => {
  if (activeId === id) { setActiveId(null); return; } // 토글 해제
  setActiveId(id);
};
```

## UI 규칙 — 하던 일 위에 얹히는 진입점은 새 탭 (2026-08-28 박제)

**알림·새 소식처럼 헤더 아이콘에서 여는 드롭다운의 항목은 `tabStore.openInNewTab(path)` 로 연다.**
`navigateActive` 는 보던 탭을 덮어써서, 글 쓰던 중 알림 하나 눌렀다가 그 화면을 잃는다
(Irene: "드롭다운에서 갑자기 탭 내용 바뀌면 하던 일 문제될 것 같아").

- 같은 화면이 이미 열려 있으면 **새로 만들지 않고 그 탭으로** 간다 (탭 무한 증식 방지)
- 미러 모드(단일 탭·모바일)는 탭 개념이 없으므로 종전대로 이동
- `<ChromeLink to=… newTab>` 로도 같은 동작. 사이드바 메뉴 같은 **주 내비게이션은 종전대로**(새 탭 X)

**드롭다운 껍데기는 `components/Common/dropdownShell.ts` 에서 가져다 쓴다.**
각자 styled 를 다시 선언하면 반드시 갈라진다 — 알림과 새 소식이 서로를 베껴 만들어져
아이콘 유무·안읽음 표시 위치·빈 상태 여백·목록 폭이 전부 달랐고, **전체보기 페이지는
링크 없는 알림을 눌러도 아무 일이 없는 기능 결손**까지 있었다.

**팝아웃 도구는 `RightDock.launchDockTool(tool)` 단일 진입점.**
`openDockTool` 은 이름과 달리 **모바일 in-app 폴백 전용**이라 그것만 부르면 데스크탑에서
아무 일도 안 일어난다(실측).

---

## UI 규칙 — 드로어 접근성 (신규 코드 필수)

모든 드로어·모달은 아래 3개 훅을 반드시 사용한다. 프리미티브 `DetailDrawer` 는 이미 내장.

```tsx
import { useBodyScrollLock } from 'hooks/useBodyScrollLock';
import { useFocusTrap } from 'hooks/useFocusTrap';
import { useEscapeStack } from 'hooks/useEscapeStack';

const ref = useRef<HTMLElement>(null);
useBodyScrollLock(open);                 // 배경 스크롤 잠금
useEscapeStack(open, onClose);           // 중첩 모달 안전한 Esc (최상단만 닫힘)
useFocusTrap(ref, open);                 // Tab 순회 + 복귀
// 드로어 루트: ref + role="dialog" + aria-modal="true" + aria-label
```

**키보드 단축키 표준:** 우측 패널 토글은 `⌘/` (mac) · `Ctrl+\` (win). Q Task · Q Talk 에 구현됨.

## UI 규칙 — 떠 있는 패널의 **상단 기준선** (2026-09-06 박제)

**"위에서 얼마" 를 각 컴포넌트가 정하지 않는다.** 기준선은 토큰 하나다.

| 토큰/조각 | 뜻 | 쓰는 곳 |
|---|---|---|
| `--pq-chrome-bottom` | **상단 크롬이 끝나는 y** (탭 모드=탭바 아래 / 좁은 폭 미러 모드=모바일 헤더 아래 / 그 외 0) | 크롬과 **함께** 보여야 하는 곁패널 |
| `belowChrome` (`theme/layout.ts`) | 위 토큰을 쓰는 css 조각 | 〃 |
| `belowTabs` (`theme/layout.ts`) | 탭바 아래(`--chrome-top`). 미러 모드에선 0 | 전면으로 덮는 상세 드로어 |

- **모드 분기는 CSS 가 한다** (`html.pq-tabmode` + `@media (max-width:1024px)`).
  JS 상수를 인라인 `style` 로 넘기면 미디어쿼리가 못 덮는다 — 2026-09-06 하루에 두 번 겪었다
  (탭바 `leftOffset` 이 사이드바 폭만큼 밀렸고, `--chrome-top` 이 40 고정이라 상태바 24px 만큼 어긋났다).
- **우측 상세/편집은 `components/Common/DetailDrawer` 를 쓴다.** 18개 화면이 이미 쓰고 있어
  기준선 수정 한 번이 전부에 먹는다. 직접 그리면 갈라진다 — 실측으로 오버레이 101개 중
  우측 패널 **8곳**이 `top:0` / `56px` / `--pq-mobile-chrome` / `16px` 로 제각각이었다.
- **가운데 모달은 예외** — 전면(`inset:0`)으로 크롬을 덮는 게 맞다. 팝오버/드롭다운도 앵커가 다르다.
- 재발은 가드가 막는다: `node scripts/guard-invariants.js --category=overlaytop`
  (`position:fixed` + `right:0` 인 styled 의 `top` 이 토큰이 아니면 실패).
- 실브라우저 회귀: `node scripts/e2e/run.js --suite tabletchrome` (9 뷰포트 + **네이티브 상태바 모사**).
  ★ 브라우저는 `--pq-safe-top` 이 0 이라 이 계열 버그가 **재현되지 않는다** — 모사 패스 없이 재면 초록이 거짓말한다.

> Irene 2026-09-06: *"이거 기준점 자체를 헤더 끝나는 위치에 맞추면 어떤 디바이스든 어떤 사이즈든
> 잘 맞지 않을까?"* — 맞다. 그리고 *"다른 우측패널들도 다 체크해야 해? 컴포넌트 기본은 없어?"* —
> **하나씩 확인하는 것은 답이 아니다.** 계약 하나 + 가드.

---

## UI 규칙 — 반응형 상세 드로어 (신규 코드 필수)

우측 상세/편집 드로어는 **공통 프리미티브 `components/Common/DetailDrawer.tsx`** 를 사용한다. 기존 커스텀 드로어도 아래 반응형 CSS 를 반드시 적용.

- **≥1025px:** 지정 width (기본 440px) 사이드 드로어
- **641~1024px:** `width: min(560px, 90vw)`
- **≤640px:** `width: 100vw` 풀스크린, border-left·box-shadow 제거, `padding-bottom: env(safe-area-inset-bottom)`

공통 규칙:
- **body 스크롤 잠금**: `hooks/useBodyScrollLock(open)` 필수 — 드로어/모달 열림 동안 배경 스크롤 차단, 스크롤바 폭 보정 포함
- Esc 닫기 + 백드롭 클릭 닫기 + 재클릭 토글 기본
- 폰에서 리사이즈 핸들 `@media (max-width: 1024px) { display: none; }`
- 터치 타겟 폰에서 최소 40×40

```tsx
import DetailDrawer from 'components/Common/DetailDrawer';
<DetailDrawer open={!!selected} onClose={close} width={440} ariaLabel="일정 상세">
  <DetailDrawer.Header onClose={close}>...</DetailDrawer.Header>
  <DetailDrawer.Body>...</DetailDrawer.Body>
  <DetailDrawer.Footer>...</DetailDrawer.Footer>
</DetailDrawer>
```

적용처: EventDrawer(신규) · TaskDetailDrawer · ClientsPage Drawer. 이후 신규 상세/편집 드로어는 반드시 DetailDrawer 사용.

## 운영 안정성 규칙 (사이클 N+3 박제)

외부 점검에서 도출된 7가지 — 신규 코드 작성 시 처음부터 적용. 같은 계열 회귀 차단.

1. **Rate-limit (외부 quota·비용 라우트)** — push/email/sms/llm 처럼 외부 quota 또는 비용을 발생시키는 라우트는 **per-user rate-limit 필수**. `keyGenerator: req => 'name-' + req.user.id` 로 IP NAT 우회. 예: `/api/push/test` 분당 5회. 정책 누락 시 사용자 1명이 quota 폭주 가능. **공유 헬퍼 `middleware/costGuard.js`** 사용 강제: `perUserLimiter`/`perUserDaily`(분+일 이중 윈도우)/`capText`(입력 크기 캡). LLM 라우트는 rate-limit + `plan.can('use_cue')` 게이트 + 입력 캡 3종 세트. **함정: `plan.fileSizeLimit`은 존재하지 않는 유령함수** — 파일 업로드는 `plan.can('upload_file', {size, external})` + `BusinessStorageUsage` 집계(files.js 패턴). 신규 첨부/업로드 경로는 쿼터 집계 누락 금지(2026-07-02 비용폭탄 총점검 박제).

2. **PWA 자동 reload 안전** — 새 빌드 감지로 사용자 모르게 reload 시 **입력 도중 데이터 손실 위험**. 정본 가드는 `components/Common/BuildVersionGuard.tsx` 의 `isReloadSafe()`: input/textarea/contentEditable focus + `body.dataset.formDirty='1'` + `[data-form-dirty="1"]` + `body.dataset.pipActive='1'`(핀 PiP) + `body.dataset.recordingActive='1'`(Q Note 녹음) 를 모두 통과한 idle 일 때만 reload, 아니면 **다음 navigation 까지 보류**. 자동 reload 가 다시 들어가는 신규 코드는 같은 가드 재사용. (옛 `version.json` 폴링 + socket `server:build` + `<UpdateBanner>` 토스트 시스템은 사이클 N+3 에 제거됐고 2026-08-14 에 잔존 파일까지 삭제 — 배너로 되돌리려면 새로 만들어야 한다.)

3. **사운드/효과 debounce** — `playPing()` 같은 audio/효과 함수는 짧은 시간 연속 호출 시 중첩 재생 → UX 짜증. 200ms 이내 중복 skip 패턴 (lastTime ref). NotificationToaster.tsx 참조.

4. **외부 endpoint 화이트리스트 (DB 저장 전)** — webhook · push · OAuth callback 등 외부 URL 을 DB 에 저장하는 경우 `new URL(...).protocol === 'https:'` + 알려진 도메인 화이트리스트 검증 필수. 임의 URL 무검증 저장 금지. `routes/push.js:isAllowedEndpoint()` 패턴 재사용.

5. **Sub-resource 재등록 명시 cleanup** — endpoint·token·serial 같은 unique 자원이 다른 user 로 재등록될 때, 옛 row 를 `expired_at = NOW()` 명시 마크 후 신규 row insert. 그냥 update reassign 하면 감사 기록 사라짐. `routes/push.js` POST `/subscribe` 패턴 참조.

6. **외부 발송 = LogTable 처음부터** — push/email/sms 같은 외부 발송은 처음 release 부터 Log 테이블 (user_id, target, status, status_code, error_message, sent_at). 운영 시작 후 추가는 히스토리 없음. PushLog/EmailLog 모델 참조.

7. **Sticky 권한 동기화** — OS/브라우저 권한 OFF (push notification, mic, camera 등) 일 때 backend 의 자원 (구독·토큰·세션) 도 자동 정리. 좀비 endpoint 누적 차단. `services/push.ts:syncPermissionOnFocus()` + `bindPermissionSync()` 패턴 — 페이지 focus 복귀 시 권한 재검사 → denied 면 backend DELETE 자동.

8. **외부 발송 입력 검증 + 실패율 모니터링 (사이클 N+12 박제)** — push/email/sms 라우트는 형식 검증 표준:
   - web push: `p256dh.length >= 80` (base64url 65 bytes), `auth.length >= 8`
   - email: RFC 5322 form, sms: E.164
   존재 검사만으로 부족 — 깨진 데이터가 DB 저장되면 발송 시점 silent fail. 동일 user 5분 윈도우 3회 실패 → platform_admin email 알림 (push 채널은 본인이 실패 중일 수 있어 사용 금지). 헬스체크에 24h 실패율 임계치 항목 추가. `services/push_service.js:maybeAlertOnFailure()` 패턴 참조. 박제: `feedback_external_dispatch_validation.md`.

9. **visibility/focus 복원 = server fresh 덮어쓰기 (사이클 N+12 박제)** — `useVisibilityRefresh` 같은 PWA background→foreground 복원 로직에서 list-style 자원 (conv, task, file 등) 은 **server response 전체로 setState 교체**. 신규만 merge 하는 패턴은 stale unread/last_message 회귀 유발. merge 가 정말 필요하면 *왜 server 응답을 무시하는지* 주석 명시. focus 외 `visibilitychange` 도 listen (모바일 PWA focus 발동 보장 없음). 박제: `feedback_visibility_refresh_server_fresh.md`.

10. **sw.js 자가 update — push/notificationclick 시점 (사이클 N+12 후속 박제)** — 옛 SW 가 메모리에 active 인 PWA 에서 새 빌드 떴어도 자동 갱신 안 되는 회귀 차단. `sw.js` 의 `push` handler 와 `notificationclick` handler 시작 부분에 `event.waitUntil(self.registration.update().catch(()=>null))` 호출. PWA wake-up 자체가 SW lifecycle 진행 트리거 — 새 SW 있으면 install→activate. 알림 클릭 시 옛 main bundle 메모리의 옛 chunk hash 가 404 나는 "Importing a module script failed" 회귀의 근본 차단. ErrorBoundary 의 chunk reload 도 SW update 같이 호출 (`Common/ErrorBoundary.tsx`). 박제: `feedback_pwa_sw_self_update.md`.

11. **lazy() chunk 미스매치 자동 복구 강화 (사이클 N+12 후속)** — ErrorBoundary 의 `reset()` 가 chunk error 였으면 단순 state reset 이 아니라 `window.location.reload()` + SW update 강제. 사용자 "다시 시도" 클릭은 60초 자동 가드 무관하게 통과. 자동 reload (componentDidCatch) 도 SW update 동반. 동일 chunk 가 영영 missing 인 무한 reload 만 60초 가드로 막음. SPA 신규 lazy 페이지 추가 시 같은 ErrorBoundary 가 자동 처리.

12. **useLayoutEffect 안의 layout 측정은 즉시, RAF 지연 금지 (사이클 N+12 후속)** — DOM commit 직후 layout phase 라 scrollIntoView/scrollTop 즉시 호출 가능. `requestAnimationFrame x 2` 지연 패턴은 "첫 paint 가 측정 전 위치로 그려진 뒤 2 frame 후 점프" 회귀 유발 — 사용자 입장에서 "위에 갔다 옴". 비동기 콘텐츠 (이미지·번역 박스) 보정만 후속 1 RAF + ResizeObserver 로 별도 처리. ChatPanel `scrollToBottom` 패턴 참조.

13. **메시지/status 전이 라우트는 notify 호출 강제 (사이클 N+13 박제)** — 새 메시지 발송 라우트, status 전이 라우트, reviewer/assignee 변경 라우트는 **반드시 `routes/notifications.js` 의 `notify` / `notifyMany` 호출 코드 포함**. 누락 시 OS push 영영 0. 사이클 N+13 회귀 실사례: `routes/projects.js POST /conversations/:id/messages` (frontend qtalk.ts sendMessage 호출) + `routes/task_workflow.js` 7 라우트 (ack, submit-review, cancel-review, approve, revision, complete, reviewers POST) 모두 notify 누락 상태였음. 운영 데이터로 PushLog 검증 시 `'테스트 알림' 또는 admin 직접 발송' 만 sent` 패턴이면 trigger 누락 강한 의심. 검증 패턴 — node test 스크립트: login → POST → sleep 3000 → `SELECT FROM push_logs WHERE user_id IN (...) AND created_at >= since` row ≥ 1 확인. 박제: `feedback_notify_trigger_required.md`.

14. **PushSubscription 같은 host 좀비 자동 만료 (사이클 N+13 박제)** — `POST /api/push/subscribe` 시점에 **같은 user 의 같은 push service host (web.push.apple.com / fcm.googleapis.com / ...) 의 다른 active sub 들 자동 `expired_at` 마크**. 한 user × 한 host = active 1개만. 다른 host 는 별개 (Mac Chrome + iPhone Safari 동시 OK). iOS Safari 가 endpoint 갱신 시 옛 sub 가 `expired_at IS NULL` 그대로 → `sendPushToUser` 가 모든 active sub 로 fan-out → Apple push service 가 옛 endpoint silent drop → 사용자 "한 번은 오고 한 번은 안 오는" 변동성 회귀 차단. unique 제약 해소 위해 옛 row 의 `endpoint` 를 `'expired:<id>:<원본>'` 으로 prefix 변경. 박제: `feedback_push_same_host_zombie.md`.

15. **web-push 발송 옵션 — urgency 'high' + TTL 1일 (사이클 N+13 박제)** — `webpush.sendNotification(sub, json, { TTL: 86400, urgency: 'high' })`. urgency 'high' 는 push service 가 즉시 전달 시도 (default 'normal' 보다 빠름, 모바일 도착률 ↑). TTL 86400 = 1일 (default 28일은 너무 길어 stale 알림 도착). topic 옵션은 의도적으로 비활성 — 짧은 시간 다건 메시지가 collapse 되지 않게.

16. **🔥 실시간 데이터 반영 — 모든 페이지 강제 (사이클 N+38 박제)** — **사용자 호소 핵심: "리프레시 없이 즉시 보여야 한다".** 다른 사용자가 데이터 추가/수정/삭제하면 본인이 그 페이지를 열고 있을 때 **즉시 자동 반영**. 페이지 mount 시 다음 4 요소 모두 구현 필수:

    **(a) socket 연결 + business room join** — `io({ auth: token })` + `s.emit('join:business', businessId)` (cross-workspace 사용자는 모든 워크스페이스 room join). 재연결 시 `s.on('connect')` 에서 자동 재 join (TodoPage.tsx:122-124 패턴).

    **(b) backend broadcast 호출** — 데이터 변경 라우트는 모두 `io.to('business:${bizId}').emit('<event>', payload)` 호출. 라우트 추가 시 같이 broadcast 강제:
       - tasks: `task:new` / `task:updated` / `task:deleted`
       - candidates: `candidate:new` / `candidate:updated` (`routes/task_workflow.js` broadcast helper 참조)
       - messages: `message:new` (routes/conversations.js)
       - posts/files/kb/invoices/events: 같은 패턴 — entity 별 event 명. 누락 시 사용자 호소 "갱신 안 됨" 반복.

    **(c) frontend listener + silentLoad 또는 setState merge** — `s.on('<event>', debouncedReload)` (250ms debounce + 250ms 합치기) 또는 즉시 `setState((prev) => merge(prev, payload))`. list 큰 페이지는 silentLoad (server fresh — memory `feedback_visibility_refresh_server_fresh.md`), list 작은 페이지는 즉시 state merge.

    **(d) visibility/focus 복귀 안전망** — `useVisibilityRefresh(silentLoad)` 훅 추가. PWA background → foreground 또는 socket 끊김 → 재연결 시 missed event 회복. 모바일 PWA 에서 시스템이 socket 끊을 때 정합.

    **(e) 같은 탭 안 안전망 (선택)** — workflow 액션 (status 변경 등) 시 `window.dispatchEvent(new CustomEvent('inbox:refresh'))` + 페이지가 `window.addEventListener('inbox:refresh', debouncedReload)`. socket broadcast 와 별개로 자체 액션 즉시 sync (TaskDetailDrawer + TodoPage N+35 패턴).

    **검증 시나리오 — 신규 페이지 추가 시 필수 통과:**
       1. **2 브라우저 탭** (다른 사용자 시뮬레이션) — A 가 추가/수정 → B 가 그 페이지 열고 있으면 즉시 보임 (≤ 1초)
       2. **socket 끊김** — 모바일 background 5분 후 foreground → 그 동안 다른 사용자가 추가한 데이터 즉시 보임
       3. **다중 디바이스** — 같은 사용자 데스크탑 + 모바일 동시 접속. 한 쪽 액션 → 다른 쪽 즉시 반영 (`user:N` socket room)
       4. **새로고침 불필요** — F5 안 눌러도 페이지 자체가 갱신. F5 누르면 리셋 — 사용자 호소 "리프레시 안 해도" 보장

    **신규 페이지 / 라우트 추가 시 체크리스트:**
       - [ ] backend route 가 `broadcast()` 호출하는가?
       - [ ] frontend 페이지가 socket listener 등록하는가?
       - [ ] silentLoad 함수가 200~250ms debounce 되는가?
       - [ ] `useVisibilityRefresh` 등록되어 있는가?
       - [ ] 다른 탭에서 변경 시 즉시 보이는지 visual 검증했는가?

    **회귀 사례 (N+35~):**
       - 확인필요 카드 (Dashboard/TodoPage) — socket broadcast 정합인데도 silentLoad debounce 지연 → window CustomEvent 안전망 추가
       - MemoPopup → QNote sync — backend Q note 가 별도 FastAPI 라 socket.io 사용 X → window CustomEvent 패턴
       - task_workflow.js 8 라우트 broadcast 누락 (옛) → `broadcast(req, task)` 호출 강제

    **박제: 신규 모든 페이지/라우트 작성 시 이 16번 항목을 체크리스트로 사용. 누락 시 사용자 호소 회귀 반복.**

17. **검사 하니스 자동화 요건 (사이클 N+? 박제, 2026-07-09)** — 운영 피드백 42건이 기존 검증 다 통과했는데 유출(특히 모바일 키보드 가림) → `scripts/e2e/` Puppeteer 하니스(health-check 동급 게이트, `node scripts/e2e/run.js --suite mobile,crosscut,l1`)로 자동 검출. 신규 코드는 처음부터 아래 준수:
    - **인터랙티브 요소에 `data-testid` 부여 필수** — 모달/드로어 오프너·FAB·폼 제출 버튼. 네이밍 `{화면}-{동작}`(예: `bill-new-invoice`, `dock-create-task`, `clients-invite-open`). selector 취약성(텍스트/위치 휴리스틱) 제거 → 하니스 opener 안정.
    - **모달/드로어 루트에 `aria-modal="true"`** — 하니스가 `[aria-modal="true"]` 로만 모달 스코핑(배경 입력 노이즈 차단). 비모달 배너에 `role="dialog"` 금지(→ `complementary`) — 스코핑 오염.
    - **모바일 키보드 가림 회귀 방지** — 키보드 업 시 인플로우 배너(push/install prompt 등)가 세로공간을 잠식하면 `overflow:hidden` 고정크롬(패널 하단 입력줄)이 뷰포트 밖으로 침몰, `ensureFocusedVisible` 이 구제 불가. `body[data-keyboard-up='1']` 계약으로 `@media(max-width:768px)` 게이트하에 억제. (max-width:768px 게이트 필수 — flag 는 세로축소만으로도 켜져 데스크탑 회귀).
    - **하니스 시뮬 함정 2가지** — ①CDP `setDeviceMetricsOverride` 에 `screenOrientation` 넣지 말 것 ②판정 후 `clearDeviceMetricsOverride` 쓰지 말 것(puppeteer viewport 까지 제거 → 데스크탑 환경 오탐). 상세·오탐 사례: `docs/qa/FEEDBACK_REGRESSIONS.md`, 설계 `docs/qa/INSPECTION_PLAYBOOK.md`.

---

## 상태값 규약 — 알 수 없는 값은 **보이게** 렌더 (2026-08-30 박제)

**새 상태값을 만들면 그 값을 해석하는 곳을 전수로 찾아 같이 고친다. 기본값으로 조용히 떨어뜨리지 않는다.**

2026-08-30 실사례 — Q Note 녹음 업로드에서 종료 상태를 `ended` 로 썼는데 기존 규약은 `completed` 였다.
그 값은 목록 라벨 분기에도 없고 상세 phase 판정에도 없어 **둘 다 기본값으로 떨어졌다**:
- 목록에 **"대기"** 로 표시 (실제로는 완료)
- 상세에 **"녹음 이어하기 / 음성 노트 종료"** 버튼 (업로드 노트에 있을 수 없는 버튼)

Irene 은 이것을 "**올리면 상세페이지가 떠야 하는데 아무 반응이 없어**" 로 신고했다.
즉 사용자에게는 "안 열린다" 와 구별되지 않는다.

### 규칙
1. **상태 ENUM 을 늘리면** 그 값을 읽는 곳을 `grep` 으로 전수 확인한다 — 라벨·색·phase·권한·정렬.
   삼항 사슬의 **끝(기본값)** 에 새 값이 떨어지면 그것이 곧 버그다.
2. **성격이 다른 자원은 상태값이 아니라 종류로 못을 박는다.** 예: 업로드한 노트는
   `capture_mode === 'upload'` 면 상태값이 무엇이든 읽기 모드다 — status 만 보면 새 상태가
   생길 때마다 같은 사고가 난다.
3. **검증은 "화면에 뭐라고 보이는가" 까지.** 상태 전이·API·원장만 확인하고 완료 보고하면
   이 계열은 100% 빠져나간다 (memory `feedback_backend_done_ui_missing`).

---

## 검증 시나리오 — 채팅·알림 (사이클 N+12 박제)

채팅·알림 영역 (Q Talk, NotificationToaster, push, socket) 기능 추가/수정 시 **아래 4 시나리오 모두 검증**. 활성 시나리오 하나만 통과시키면 회귀가 운영까지 도달함 (N+11 → N+12 회귀 실사례).

1. **활성 conv 외 conv 메시지** → 사이드바 토탈 unread +1 + 좌측 리스트 conv row unread +1 + (활성 tab 이면) NotificationToaster 토스터 + ping 사운드
2. **background → foreground 복귀** → 백그라운드 동안 다른 conv 에 도착한 메시지로 사이드바·리스트 unread 갱신 (활성 conv 의 messages 만 복원 ≠ 검증 완료)
3. **OS push 실제 도착** (in-app 토스터와 분리) → 데스크탑·모바일 둘 다 background tab. 다른 user 가 메시지 → 두 디바이스 모두 OS notification + PushLog status='sent'. test push (디바이스 알림 테스트) 통과 ≠ 실제 채팅 push 도착 보장
4. **다중 디바이스 동기화** → 같은 user 데스크탑 + 모바일 동시 접속. 한 쪽에서 conv 읽음/핀 → 다른 쪽 자동 반영 (`user:N` socket room broadcast)

박제: `feedback_chat_notification_verification.md`.

---

## UI 규칙 — 액션 버튼 / 중복 제출 / URL 싱크

- **액션 버튼 3톤** (Primary / Secondary / Danger)만 사용. 상태 색을 버튼 배경에 칠하지 말 것. `UI_DESIGN_GUIDE.md` 섹션 1.7.
- **생성/추가/승인 액션은 중복 제출 가드 필수** — `submitting` state + 버튼 `disabled`. Enter 단독 저장 금지 (Ctrl/Cmd+Enter 만 허용). 섹션 1.8.
- **상세/드로어 패널은 URL 싱크** — `?task=:id`, `?client=:id` 등 단수형 쿼리로 싱크. 새로고침·공유 시 컨텍스트 유지. 섹션 1.9.

---

## 절대 금지 사항

- 운영서버 직접 코드 수정/배포
- POS 관련 파일/DB/PM2 건드리기
- alert(), toast.success(), window.confirm(), window.prompt() 사용
- **mock 데이터 일체** — `mockXxx`, dummy 배열/객체, 하드코딩 시드 데이터 모두 금지. 모든 데이터는 DB에서 API로 (자세한 정책: 위 "🚫 mock 데이터 절대 금지" 섹션)
- 샘플/가짜 데이터로 화면 채우기 — production 소스에 잔존 시 검증 실패
- API 테스트 시 기존 계정 비밀번호 변경 금지
- **프론트엔드 문자열 하드코딩 (한국어/영어 모두)** → 반드시 `t()` 사용
