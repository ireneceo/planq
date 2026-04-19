# PlanQ 프로젝트 가이드라인

## 프로젝트 개요

**PlanQ** — B2B SaaS 업무 전용 고객 채팅 + 실행 구조 통합 OS
- 브랜드: Plan + Cue(실행 신호) + Queue(업무 정리)
- "요청은 Queue로, 실행은 Cue로."
- 핵심 기능: Q Talk(대화), Q Task(할일), Q Note(음성/요약), Q File(자료), Q Bill(청구)

### 역할 체계
| 역할 | 설명 |
|------|------|
| Platform Admin | 플랫폼 전체 관리 |
| Business Owner | 사업자 — 구독 + 고객/팀/청구 관리 |
| Business Member | 사업자 소속 직원 |
| Client | 고객 — 초대 기반, 웹 링크 클릭으로 즉시 접속 |

---

## 작업 워크플로우 (최우선 규칙)

### 흐름 (UI-First)
**요구사항 정리 → 화면/UX 설계 → 기술 설계 → UI 구현(Mock) → Irene 화면 승인 → 백엔드 연결 → 검증**

### 규칙
- 이전 단계 산출물을 반드시 참조한 후 다음 단계 진행
- **UI-First 원칙 (필수): 새 페이지/기능은 UI를 mock 데이터로 먼저 만들어 빌드 → Irene이 화면 직접 확인 → 승인 후에만 백엔드 연결**
  - mock 단계 완료 보고: 빌드 후 https://dev.planq.kr/[경로] 안내 + "확인 부탁드립니다"
  - Irene 피드백 (디자인/레이아웃/인터랙션) 반영 후 재확인
  - 승인 떨어진 후에만 API 호출 + 데이터 흐름 + 로딩/에러 처리 추가
  - 예외: 단순 버그 수정/텍스트 변경 (소 규모 작업은 바로 진행)
- 각 단계 완료 시 핵심 요약을 보여주고 승인 확인
- Irene이 수정 지시하면 해당 단계에서 반영 후 재확인
- **구현 중 설계에 없는 것을 임의로 추가하지 않는다**
- **구현 완료 후 반드시 검증 단계를 실행한다 (절대 생략 금지)**

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

// 성공 (목록)
res.json({ success: true, data: [...], pagination: { page, limit, total } });

// 실패
res.status(400).json({ success: false, message: 'Error description' });
```

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
- 메시지 수정: 허용 (is_edited=true, edited_at 기록, UI에서 "(수정됨)")
- 할일 마감 지연: 빨간 뱃지, 마감 연장은 담당자 이상
- 감사 로그: 모든 CUD 작업 AuditLog에 기록 (old_value/new_value JSON)

---

## DB 테이블 (25개)

**기본 (13):** users, businesses, business_members, clients, conversations, conversation_participants, messages, message_attachments, tasks, files, invoices, invoice_items, audit_logs

**Q Talk / 프로젝트 (6):** projects, project_members, project_clients, project_notes, project_issues, task_candidates

**Q Task 워크플로우 (4):** task_comments, task_daily_progress, **task_reviewers**, **task_status_history**

**기타 (2):** kb_chunks, kb_documents, kb_pinned_faqs, cue_usage

> **Q Task 상태 ENUM:** `not_started`, `waiting`, `in_progress`, `reviewing`, `revision_requested`, `done_feedback`, `completed`, `canceled`. 관점별 UI 라벨은 `dev-frontend/src/utils/taskLabel.ts` 참조 (i18n `status.{code}.{role}` 4차원 구조).

> **댓글·메모 visibility 통일:** `personal`/`internal`/`shared` — `task_comments` 와 `project_notes` 공통 ENUM.

---

## 파일 저장

- 경로: `/opt/planq/dev-backend/uploads/{business_id}/{yyyy-mm}/`
- 파일명: UUID로 변환 (원본 파일명은 DB에 저장)
- 용량 제한: Free 10MB, Basic 30MB, Pro 50MB (파일당)
- 허용 확장자: jpg, jpeg, png, gif, pdf, doc, docx, xls, xlsx, ppt, pptx, zip, txt

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
```bash
# 한국어 하드코딩 감지 (주석 제외, 코드 내부 문자열만)
grep -rEn "(['\"\`])[^'\"\`]*[가-힣][^'\"\`]*\1" dev-frontend/src --include='*.tsx' --include='*.ts' \
  | grep -v -E '//|/\*|\*/|^\s*\*' | grep -v '/locales/'
```
결과에 줄이 나오면 해당 위치를 i18n으로 전환해야 한다.

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

### 금지
- 페이지 루트에 직접 `<Page>`/`<Header>` styled 컴포넌트 선언 금지
- 헤더 높이·padding·제목 폰트 커스터마이즈 금지 (일관성)
- 헤더에 여러 줄(제목+부제) 쌓기 금지 — 부제/메타는 제목 옆 인라인으로 배치

---

## 자동저장 (필수)

- **저장이 필요한 모든 입력 폼은 AutoSaveField 컴포넌트를 사용**
- 저장 버튼 없음 → 입력하면 자동 저장 (debounce: input 2초, select/toggle 300ms)
- 성공: ✓ 뱃지만 표시 (2초 후 페이드), 에러: ! 뱃지 (4초 후 페이드)
- 성공 팝업/토스트 절대 금지
- 예외: 청구서 작성처럼 복잡한 폼은 저장 버튼 사용 가능
- 컴포넌트: `src/components/Common/AutoSaveField.tsx`
- 상세: `dev-frontend/UI_DESIGN_GUIDE.md` 섹션 7

## UI 규칙 — 액션 버튼 / 중복 제출 / URL 싱크

- **액션 버튼 3톤** (Primary / Secondary / Danger)만 사용. 상태 색을 버튼 배경에 칠하지 말 것. `UI_DESIGN_GUIDE.md` 섹션 1.7.
- **생성/추가/승인 액션은 중복 제출 가드 필수** — `submitting` state + 버튼 `disabled`. Enter 단독 저장 금지 (Ctrl/Cmd+Enter 만 허용). 섹션 1.8.
- **상세/드로어 패널은 URL 싱크** — `?task=:id`, `?client=:id` 등 단수형 쿼리로 싱크. 새로고침·공유 시 컨텍스트 유지. 섹션 1.9.

---

## 절대 금지 사항

- 운영서버 직접 코드 수정/배포
- POS 관련 파일/DB/PM2 건드리기
- alert(), toast.success() 사용
- 샘플/가짜 데이터 사용 → 모든 데이터는 DB에서 API로
- API 테스트 시 기존 계정 비밀번호 변경 금지
- **프론트엔드 문자열 하드코딩 (한국어/영어 모두)** → 반드시 `t()` 사용
