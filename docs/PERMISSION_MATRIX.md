# PlanQ 권한 매트릭스 (단일 소스)

> **이 문서가 권한 정책의 단일 진실 공급원 (Single Source of Truth).**
> 새 API 를 만들 때, 새 UI 버튼을 붙일 때, 권한 수정을 할 때 — 먼저 이 문서를 보고 업데이트한다.
>
> 작성: 2026-04-24 · 상태: Phase 0 와 함께 확정 · 구현 가이드 포함
>
> **최종 갱신: 2026-07-10 (코드 실측 대조) · 이전 2026-05-10**
>
> 2026-07-10 changelog:
> - §2 — Cue AI 팀원 role `ai` 추가. `admin` 워크스페이스 역할 **정식 활성화** (ENUM append + 역할변경 라우트 + `access_scope` allowed 세트 편입 + health-check ENUM 유지 감시, 실 HTTP 7/7 검증)
> - §4.5 신설 — 멤버 메뉴 권한 Layer 3 (`business_member_permissions` 11메뉴 + weekly_team × none/read/write, `requireMenu`)
> - §5.7 코드 정합 정정 — project_id 이관 완화(운영 #42), status 직접 PUT 담당자 포함, 워크플로우 라우트 실가드(only_assignee·not_a_reviewer), DELETE 안전핀 "타인 관여 0건"(운영 #14)
> - §5.8 Q Note visibility L1~L4(N+14) 반영 · §5.10 owner_only 가드 5→11 라우트 + 현금영수증·증빙정정 · §5.11 Q위키 visibility 신설 · §6.2 Stripe 키 + 전역 `*_enc` redact · §7 client 업무 조건 실코드 정합

---

## 1. 철학 — "열린 문화 조직" 이 기본값

PlanQ 는 **투명한 업무 처리**를 지향한다. 조직원이 서로 무엇을 하는지 보이지 않으면 협업은 성립하지 않는다. 따라서:

- **조회 권한은 최대한 개방** — 워크스페이스 멤버라면 조직 내 업무·프로젝트·고객·대화·문서를 기본적으로 볼 수 있다.
- **쓰기 권한은 투명 + 가드** — 잘못 건드리면 아픈 것 (재무·일정·고객 민감정보) 은 **워크스페이스 설정 토글**로 "모두 허용" 또는 "PM/오너만" 선택. 기본값은 "모두 허용".
- **개인정보와 법적 책임은 제한** — 동료의 단가·월급, 세금계산서 발행, 결제 수단, 멤버 인사 변경은 오너 고정.
- **고객(Client)은 자기 범위만** — 참여 프로젝트·대화방·자기 청구서.

> 권한은 "풀기는 쉽고 조이기는 어렵다." 의심되면 **조금 더 열어둔다**. 단, 법적·재무·개인정보는 예외.

---

## 2. 역할 체계

| 역할 | 식별 조건 | 전역/로컬 |
|---|---|---|
| **platform_admin** | `users.platform_role = 'platform_admin'` | 전역 |
| **owner** | `business_members.role = 'owner' AND removed_at IS NULL` | 워크스페이스 |
| **member** | `business_members.role = 'member' AND removed_at IS NULL` | 워크스페이스 |
| **ai (Cue)** | `business_members.role = 'ai'` — 워크스페이스 생성 시 자동 시드 (`routes/businesses.js:115`) | 워크스페이스 |
| **PM** | `project_members.is_pm = 1` (member + PM 배정) | 프로젝트 |
| **client** | `clients.user_id = me` 또는 `project_clients.contact_user_id = me` | 프로젝트/대화 |
| **unauthenticated** | `share_token` / `invite_token` 기반 | 단건 |

**역할 합성 규칙**
- `platform_admin` 은 어떤 워크스페이스든 owner 와 동등 (단 워크스페이스 **토글 설정 편집** 은 예외 — 해당 워크스페이스 owner 만)
- `owner` 는 암묵적 PM — 모든 프로젝트 PM 게이트 액션 통과
- `member` 는 **PM 배정 여부에 따라** 재무/일정/고객정보 편집 가능 여부 결정 (토글 설정과 결합)
- `client` 는 다른 어떤 역할도 겸할 수 없음 (조직 외부)
- `ai` (Cue) 는 **API 직접 진입 차단** — `requireMenu` 가 403 `ai_member_blocked` (`middleware/menu_permission.js:82-84`), calendar·conversations 등 개별 라우트도 차단 (`routes/calendar.js:257` 등). 단 업무 **담당자/컨펌자 배정 대상으로는 허용** (`middleware/access_scope.js:251` `assertAssignable`). 역할 변경·멤버 제거는 잠금 — `ai_role_locked` (`routes/businesses.js:1136,1170`)

> **`admin` (워크스페이스 관리자) 역할의 현재 상태 (2026-07-10 활성화, Fable 게이트):**
> admin 은 **정식 활성 역할**이다. `business_members.role` ENUM = `('owner','member','ai','admin')` (`models/BusinessMember.js:46`, dev/운영 DB 동일 — ENUM append). 역할 변경은 전용 라우트 `PUT /:businessId/members/:userId/role` (`routes/businesses.js:894`, `['member','admin']` 전이, owner↔member 인사 라우트와 분리) + owner 에게 노출되는 설정 UI `MemberPermissionMatrix.tsx` "관리자로/멤버로". 권한: `middleware/menu_permission.js:85-86` owner_only 외 전권, `middleware/access_scope.js:31,54` `scope.isAdmin` (+ `attachWorkspaceScope` allowed 세트 포함 — admin 이 워크스페이스 라우트 접근), `routes/tasks.js` FIELD_RULES owner 급. **재무 mutation 은 제외** — `assertInvoiceMutationOwner` 는 owner/platform_admin 만 통과, admin 은 403 `owner_only` (§5.10, 실 HTTP 검증됨). 회귀 감시: 2026-07-10 이전 sync-database 가 모델 미갱신 상태에서 ENUM 에서 admin 을 벗겨 승격 라우트 500 을 유발 → 모델(SSOT)에 admin 을 박고 `scripts/health-check.js` 에 ENUM 유지 검사 추가. (별개로 `attachWorkspaceScope` 는 platform_admin 의 `businessRole` 문자열을 `'admin'` 으로 세팅 — `access_scope.js:40` — 워크스페이스 admin role 과 다른 개념이니 혼동 주의)

---

## 3. PM (Project Manager) 개념

### 3.1 DB 표현

```sql
ALTER TABLE project_members
  ADD COLUMN is_pm TINYINT(1) DEFAULT 0,
  ADD INDEX idx_pm (project_id, is_pm);
```

### 3.2 운용 규칙

- **복수 PM 허용** — 인수인계·공동 PM 문화 지원. 프로젝트당 제한 없음.
- **프로젝트 생성자는 자동 PM** — `project_members.is_pm = 1` 로 seed.
- **owner 는 암묵적 PM** — DB 플래그 없이도 PM 게이트 통과 (코드 레벨에서 `isOwner || isPM`).
- **PM 0명 상태 허용** — 이 경우 PM 게이트는 owner 만 통과.
- **PM 지정/해제** — owner 만 가능 (인사 권한). PM 이 자기 자신을 해제하는 것도 owner 승인 필요.

### 3.3 UI 표시 (Phase 1 구현)

- 프로젝트 카드·상세 헤더에 **PM 배지** (이름 옆 `PM` 칩). 30년차 UX 원칙: "누가 책임자인지 한 눈에."
- 멤버 리스트에서 PM 멤버 위로 정렬 + PM 아이콘.
- "PM 배정" 은 프로젝트 설정 탭에서 체크박스로 복수 선택.

---

## 4. 워크스페이스 권한 토글 (3축)

### 4.1 DB 표현

```sql
ALTER TABLE businesses
  ADD COLUMN permissions JSON
  DEFAULT ('{"financial":"all","schedule":"all","client_info":"all"}');
```

### 4.2 토글 정의

| 토글 키 | 값 | 포함 액션 | 기본값 이유 |
|---|---|---|---|
| **financial** | `all` \| `pm` | 견적서 발행/수정/삭제 · 청구서 발행/수정/삭제 · 프로젝트 `contract_amount`·`monthly_fee` 편집 | `all` — 소규모 조직은 누구나 견적/청구 찍을 수 있어야 속도 난다 |
| **schedule** | `all` \| `pm` | 프로젝트 `start_date`·`end_date` · 내 담당 외 업무 `due_date`·`start_date` 변경 | `all` — 일정 조율은 공유 책임 |
| **client_info** | `all` \| `pm` | 고객 `biz_tax_id`·`bank_*`·사업자주소 편집 (**조회는 항상 모두 가능**) | `all` — 청구 실무는 member 도 한다 |

### 4.3 해석 함수 (백엔드)

**구현체 존재:** `middleware/permissions.js` — `canFinancial()` / `canSchedule()` / `canClientInfo()` 미들웨어 팩토리 + `requireBusinessOwner` (owner 고정 액션용). owner·platform_admin 항상 통과, `pm` 모드에서 `projectIdFrom` 추출 실패(조직 단위 액션) 시 403 `pm_required` (`middleware/permissions.js:100-119`). 아래는 로직 요약:

```js
// 구현: middleware/permissions.js (makeToggleMiddleware)
async function canFinancialAction(user, businessId, projectId) {
  if (user.platform_role === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { business_id: businessId, user_id: user.id } });
  if (!bm) return false;
  if (bm.role === 'owner') return true;
  const biz = await Business.findByPk(businessId, { attributes: ['permissions'] });
  const mode = biz?.permissions?.financial || 'all';
  if (mode === 'all') return true;
  // pm 모드: 해당 프로젝트의 PM 인지 확인 (projectId 필수)
  if (!projectId) return false;
  const pm = await ProjectMember.findOne({ where: { project_id: projectId, user_id: user.id, is_pm: true } });
  return !!pm;
}
```

같은 패턴으로 `canScheduleAction` · `canClientInfoAction` 제공.

### 4.4 UI 설계 (30년차 UX 관점)

워크스페이스 설정 > **권한** 탭:

```
┌─────────────────────────────────────────────────────────┐
│  권한 정책                                              │
│  열린 문화를 기본으로, 민감 액션만 선택적으로 가드합니다 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  💰 재무 발행                                           │
│  견적서·청구서·계약금액 편집                            │
│  ◉ 모든 멤버 허용 (투명 · 권장)                        │
│  ○ PM 또는 오너만                                       │
│  ▸ 이 설정이면 홍길동·김디자 5명이 견적서를 만들 수     │
│    있습니다                                             │
│                                                         │
│  🗓️ 일정 편집                                           │
│  프로젝트 기간·타인 업무 마감일                         │
│  ◉ 모든 멤버 허용                                       │
│  ○ PM 또는 오너만                                       │
│                                                         │
│  👤 고객 민감정보                                       │
│  사업자등록번호·은행계좌·주소 편집 (조회는 항상 허용)   │
│  ◉ 모든 멤버 허용                                       │
│  ○ PM 또는 오너만                                       │
└─────────────────────────────────────────────────────────┘
```

**30년차 UX 원칙 적용:**
1. **결과 프리뷰** — 각 토글 아래 "이 설정이면 ○명이 ○할 수 있습니다" 실시간 안내. 사용자가 선택의 결과를 **즉시 체감**.
2. **권장 표시** — 기본값 옆 "권장" 라벨로 대부분 이걸 그대로 두게 유도.
3. **이모지·색상** — 재무·일정·고객 3축을 시각적으로 구분. "설정" 처럼 텍스트 벽이 아니라 **블록** 으로.
4. **기본값 명시** — owner 고정 영역 (결제·세금계산서 등) 은 설정 탭에 아예 안 나옴 (변경 불가능하므로 혼란 없게).

### 4.5 멤버 메뉴 권한 — Layer 3 (사이클 N+21, 2026-05-18 · 2026-07-10 코드 실측 반영)

§4.2 토글(액션 축)과 별개의 **메뉴 축**. member 개인별로 메뉴 단위 접근 레벨을 제한한다.

- **테이블:** `business_member_permissions` — UNIQUE(business_id, user_id, menu_key), `level` ENUM `none`/`read`/`write` (`models/BusinessMemberPermission.js`)
- **가드:** `middleware/menu_permission.js` `requireMenu(menuKey, requiredLevel)` — 라우트에 `authenticateToken + checkBusinessAccess + requireMenu('qbill','write')` 패턴으로 체인
- **메뉴 키 12종** (`menu_permission.js:32-35`): 사이드바 11 — `qtalk qmail qtask qcalendar qnote qdocs qinfo qfile qbill clients insights` — + `weekly_team`
- **평가 순서** (`menu_permission.js:61-108`):
  1. platform_admin → 통과
  2. owner → 통과
  3. `ai` → 403 `ai_member_blocked`
  4. admin → 통과 (정식 활성 역할 — §2 참고)
  5. member → row 조회. **row 없음 = `write` 기본 (열린 문화)**. `none` → 403 `forbidden_menu_hidden` · `read` 인데 write 요청 → 403 `forbidden_read_only`
- **READ_ONLY 메뉴:** `insights`, `weekly_team` — write 저장 시도 시 read 로 코어스 (`menu_permission.js:38`, `routes/businesses.js:860`)
- **예외 — `weekly_team` 은 default `none`:** `requireMenu` 경유가 아닌 `routes/weekly_reviews.js:312-326` 자체 가드. row 없으면 차단 (owner/admin 만 자동 통과) — 워크스페이스 통합 주간보고는 멤버끼리 자동 공유하지 않음
- **권한 설정 주체:** owner (또는 platform_admin) 만 — `PUT /api/businesses/:businessId/members/:userId/permissions` (`routes/businesses.js:847`). owner/admin/ai 대상은 변경 차단 (`role_has_implicit_full_access`, `routes/businesses.js:869-871`)
- **권한 무관 영역 (항상 RW):** 본인 프로필·인박스·설정·Cue (`models/BusinessMemberPermission.js:10`)

---

## 5. 카테고리별 권한 매트릭스

**표기**: `●` = 가능 · `○` = 조건부 (조건 옆에 표시) · `-` = 불가

### 5.1 본인 데이터

| 액션 | platform_admin | owner | member | PM | client |
|---|:---:|:---:|:---:|:---:|:---:|
| 내 프로필 조회/편집 | ● | ● | ● | ● | ● |
| 내 비밀번호 변경 | ● | ● | ● | ● | ● |
| 내 workspace 전환 (active_business_id) | ● | ● | ● | ● | - |

### 5.2 정보 조회 (투명성 최대)

| 액션 | platform_admin | owner | member | PM | client |
|---|:---:|:---:|:---:|:---:|:---:|
| 워크스페이스 멤버 목록 | ● | ● | ● | ● | - |
| 프로젝트 목록·상세 | ● | ● | ● | ● | 참여 건만 |
| 업무 전체 목록 | ● | ● | ● | ● | 참여 건만 |
| 고객 목록·기본정보 | ● | ● | ● | ● | - |
| 파일·문서·대화방 목록 | ● | ● | ● | ● | 참여 건만 |
| 메시지 조회 | ● | ● | ● | ● | 참여 방만 |
| 견적서·청구서 목록·상세 | ● | ● | ● | ● | 본인 것만 |
| 결제 내역 조회 | ● | ● | ● | ● | 본인 것만 |
| 통계 — 업무·가동률·팀 | ● | ● | ● | ● | - |
| 통계 — 매출 총계 (금액) | ● | ● | ● | ● | - |
| 고객 민감정보 **조회** (세금ID/은행) | ● | ● | ● | ● | - |

### 5.3 쓰기 — 투명하게 풀기 (조직 운영)

| 액션 | platform_admin | owner | member | PM | client |
|---|:---:|:---:|:---:|:---:|:---:|
| 업무 생성/수정 | ● | ● | ● | ● | 자기 대화방 내만 |
| 업무 삭제 | ● | ● | 본인 생성·담당·요청 | ● | 자기 것 |
| 프로젝트 생성 | ● | ● | ● | - | - |
| 프로젝트 상태 토글 (active/closed) | ● | ● | - | ● | - |
| 프로젝트 삭제 | ● | ● | - | - | - |
| 파일 업로드 | ● | ● | ● | ● | 자기 참여 프로젝트 |
| 파일 삭제 | ● | ● | 본인 업로드 | ● | 본인 업로드 |
| 고객 추가 | ● | ● | ● | ● | - |
| 고객 기본정보 편집 (이름/회사/연락처) | ● | ● | ● | ● | - |
| 고객 삭제 | ● | ● | - | - | - |
| 대화방 생성 | ● | ● | ● | ● | - |
| 대화방 참여자 추가 | ● | ● | ● | ● | - |
| 댓글·메시지 작성 | ● | ● | ● | ● | 참여 방만 |
| 메시지 수정/삭제 | ● | ● | 본인 것 | 본인 것 | 본인 것 |

### 5.4 쓰기 — 토글 게이트 (financial / schedule / client_info)

| 액션 | platform_admin | owner | member | PM | 관련 토글 |
|---|:---:|:---:|:---:|:---:|---|
| 견적서 발행/수정/삭제 | ● | ● | 토글에 따라 | ● | `financial` |
| 청구서 발행/수정/삭제 | ● | ● | 토글에 따라 | ● | `financial` |
| 프로젝트 `contract_amount`·`monthly_fee` 편집 | ● | ● | 토글에 따라 | ● | `financial` |
| 프로젝트 `start_date`·`end_date` 편집 | ● | ● | 토글에 따라 | ● | `schedule` |
| 내 담당 **외** 업무 `due_date`·`start_date` 변경 | ● | ● | 토글에 따라 | ● | `schedule` |
| 고객 `biz_tax_id`·`bank_*`·사업자주소 편집 | ● | ● | 토글에 따라 | ● | `client_info` |

> `토글=all` → member 전원 ● · `토글=pm` → PM 또는 owner 만 ●

### 5.5 조직/재무 — owner 고정

| 액션 | platform_admin | owner | member | PM | client |
|---|:---:|:---:|:---:|:---:|:---:|
| 멤버 초대/제거/역할 변경 | ● | ● | - | - | - |
| PM 지정/해제 | ● | ● | - | - | - |
| 워크스페이스 설정 (이름/로고/권한 토글) | ● | ● | - | - | - |
| 플랜 (내향 구독) 변경·결제수단 등록 | ● | ● | - | - | - |
| 포트원·팝빌 API 키 등록 | ● | ● | - | - | - |
| 결제 수동 기록 (invoice_payments 수동) | ● | ● | - | - | - |
| 환불 처리 | ● | ● | - | - | - |
| 세금계산서 발행/취소 | ● | ● | - | - | - |
| 멤버 `hourly_rate`·`monthly_salary` 조회 | ● | ● | 본인 것만 | 본인 것만 | - |
| 멤버 `hourly_rate`·`monthly_salary` 편집 | ● | ● | - | - | - |
| 프로젝트 수익성·마진 조회 | ● | ● | - | - | - |
| 월간/분기/연간 경영 보고서 | ● | ● | - | - | - |
| 고정비 (overhead_items) CRUD | ● | ● | - | - | - |
| 직접비 (project_expenses) CRUD | ● | ● | ● | ● | - |

> 직접비는 프로젝트 원가 기록이라 member·PM 도 등록 가능 (증빙). 조회도 동일.

### 5.6 플랫폼 관리 — platform_admin 고정

| 액션 | platform_admin | 기타 |
|---|:---:|:---:|
| `/api/admin/*` 전체 | ● | - |
| 워크스페이스 목록·정지·삭제 | ● | - |
| 플랫폼 통계 (구독 · 수익) | ● | - |
| 사용자 비밀번호 강제 리셋 | ● | - |

### 5.7 Task 본문 필드별 권한 (사이클 N+5 — 책임선 분리)

업무는 **의뢰(description)** 와 **결과물(body)** 이 분리된 자산. 권한도 책임선대로 분리한다.

| 필드 | 작성자 | 담당자 | 컨펌자 | 요청자 | owner | member | client | admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| title | ● | ● | - | ● | ● | - | - | ● |
| **description (의뢰 명세)** | ● | - | - | ● | ● | - | △ (요청 시) | ● |
| **body (결과물)** ★ | - | ● | - | - | - | - | - | ● (감사) |
| category | ● | ● | - | ● | ● | - | - | ● |
| status (직접 PUT) | ● | ● | - | ● | ● | - | - | ● |
| status (워크플로우: submit_review/cancel_review/complete) | - | ● | - | - | - | - | - | - |
| status (approve / revision_requested) | - | - | ● | - | - | - | - | - |
| status (revert-status 직전 상태 되돌리기) | - | ● | - | - | ● | - | - | ● |
| ack (요청 수락) | - | ● | - | - | - | - | - | - |
| assignee_id | ● | - | - | ● | ● | - | - | ● |
| due_date / start_date | ● | - | - | ● | ● | - | - | ● |
| planned_week_start | ● | ● (자기 주간) | - | ● | ● | - | - | ● |
| recurrence_rule | ● | - | - | ● | ● | - | - | ● |
| project_id (이관) · workstream_id · is_milestone | ● | ● | - | ● | ● | - | - | ● |
| estimated_hours | - | ● | - | - | ● | - | - | ● |
| actual_hours / progress | - | ● | - | - | ● | - | - | ● |
| reviewers (add/remove) | ● | ● | - | ● | ● | - | - | - |
| share 토큰 | ● | ● | - | ● | ● | - | - | ● |
| **DELETE task** ★ | △ (타인 관여 0건만) | - | - | - | ● | - | - | ● |

★ **사이클 N+5 정식 정책 (2026-05-10) + 2026-07-10 코드 실측 정합:**
- **body (결과물)** — 담당자 본인 영역. owner 도 못 만짐. owner 가 결과물을 고치고 싶으면 **컨펌 반려 (revision_requested)** 워크플로우로 풀어야 함. admin 만 운영 감사 백도어. (`routes/tasks.js:1127`)
- **description (의뢰 명세)** — 발주자(작성자/요청자/owner) 영역. 담당자는 코멘트로 보충. 의뢰 명세를 담당자가 임의 수정 금지. (`routes/tasks.js:1126`)
- **DELETE task** — owner/admin. 작성자는 **"타인의 관여" 0건**일 때만 (실수 정정용 안전핀). 운영 #14 완화: 본인 자동 status_history·본인 댓글은 잠금 사유에서 제외 — 타인 댓글/타인 상태변경/타인 리뷰어가 1건이라도 있으면 403 (`routes/tasks.js:1342-1356`).
- **project_id 이관** — 운영 #42 (2026-06-16) 정책 완화: owner/admin 전용이었으나 **담당자·작성자도 허용** ("내 업무 정리" — 초기 분류·재분류 일관, `routes/tasks.js:1136-1139`).
- **status 직접 PUT** — 담당자/작성자/owner/admin (`routes/tasks.js:1129`). 단 reviewer 가드: reviewer 0명이면 `reviewing`/`revision_requested` 진입 400 `no_reviewers_assigned` (`routes/tasks.js:1081-1086`).
- **워크플로우 라우트는 owner 도 대행 불가** — submit-review/cancel-review/complete 는 담당자만 (`only_assignee`, `routes/task_workflow.js:224,274,527`), approve/revision 은 등록된 컨펌자만 (`not_a_reviewer`, `task_workflow.js:322-324`) — owner 는 스스로 리뷰어로 등록된 경우에만 가능. revert-status 만 담당자 또는 owner/admin/platform_admin (`task_workflow.js:481-485`).
- **reviewers add/remove** — 담당자/요청자(작성자 포함)/owner (`task_workflow.js:573,650`). 워크플로우의 `isOwner` 헬퍼는 `role === 'owner'` 만 인정 — admin·platform_admin 미포함 (`task_workflow.js:65-68`).
- **"요청자" 열 판정 기준** — PUT 라우트 FIELD_RULES 는 `created_by`(작성자)만 검사하며 요청 생성 흐름에서 요청자=작성자라 실질 동일. `request_by_user_id` 만 별도로 가진 사용자는 워크플로우 라우트의 `isRequester`(`request_by_user_id OR created_by`, `task_workflow.js:62-64`)에서만 인정.
- **estimated/actual/progress** — 담당자 또는 owner/admin (`routes/tasks.js:1142-1144`). PATCH `/:id/time` 경로는 담당자·owner 외 403 `only_assignee_can_edit_hours` (`routes/tasks.js:334-340`).

> **이유:** 담당자 결과물을 owner 가 임의 수정하면 책임선 무너지고 동기부여 저하. 의뢰 명세를 담당자가 수정하면 발주자 권한 침해. 본문이 두 갈래로 나뉘어 있으니 권한도 두 갈래.

### 5.8 Q Note — 개인 도구 권한 (owner·admin 백도어 없음, 세션별 visibility 는 생성자가 개방)

| 필드/액션 | 세션 생성자 | owner | member | client | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| 세션 생성 | – | ● | ● | - (memory) | ● |
| 세션 목록 (남 세션) | - | - | - | - | - |
| 트랜스크립트 / 메모 / 답변 보기 — **기본 (L1)** | ● | - | - | - | - |
| 트랜스크립트 / 메모 / 답변 보기 — 생성자가 visibility 개방 시 | ● | △ | △ | - | △ |
| 편집 (제목·메모) | ● | - | - | - | - |
| 답변·요약 생성 | ● | - | - | - | - |
| 삭제 | ● | - | - | - | - |
| visibility 변경 · 공유 (share_token) | ● | - | - | - | - |

> **원칙:** Q Note 는 **진짜 사적 공간**. 기본값(L1)에서는 owner 도 admin 도 남의 Q Note 못 봄 — 운영 감사 백도어 없음. **세션 생성자만** visibility 를 개방할 수 있고, 개방 범위대로만 열람 가능 (사이클 N+14):
> - `_load_session_or_403` (`q-note/routers/sessions.py:386-435`) — 생성자 항상 통과. **`status='recording'` 은 무조건 owner only** (잠정 데이터 절대 비노출). L1=생성자만 / L2=같은 프로젝트 멤버 (Node internal API `project-membership` 검사) / L3·L4=같은 워크스페이스 멤버.
> - **쓰기는 visibility 무관 생성자만** — PUT(제목·메모)/DELETE/visibility 변경/share 생성·삭제 라우트가 별도 `owner_only` 403 (`sessions.py:978-979, 1011-1012, 1055-1056, 1127-1128, 1156-1157`).
>
> memory `feedback_qnote_personal_tool.md` 박제. "owner 급 역할"이 아니라 **생성자의 명시적 개방**만이 열람을 허용한다는 점이 §5.7 body 책임선과 같은 철학.

### 5.9 Message 모더레이션 (Q Talk)

| 액션 | 본인 (작성자) | 같은 대화 참여자 | owner | client | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| 메시지 송신 | ● | ● | ● | △ (참여 conv) | ● |
| 메시지 편집 | ● (본인 msg 만) | - | - | △ (본인 msg) | ● |
| 메시지 삭제 (마스킹) — 본인 msg | ● | - | ● | △ (본인 msg) | ● |
| 메시지 삭제 (마스킹) — 남 msg (모더레이션) | - | - | ● | - | ● |

> **원칙:** 메시지는 마스킹 정책 (`is_deleted=true`, 원본 DB 유지, UI "삭제된 메시지"). owner 의 남 메시지 삭제는 **모더레이션** 용도 — 댓글 가이드라인 위반, 민감정보 노출 사고 등. AuditLog 강제.

### 5.10 Invoice 재무 권한 (owner 강함 — member 차단)

| 액션 | workspace owner | member | client | admin |
|---|:-:|:-:|:-:|:-:|
| draft 생성 | ● | ● (가벼움) | - | ● |
| draft 편집 (금액·항목) | ● | ● | - | ● |
| **발행 (sent)** ★ | ● | - | - | ● |
| 분할 회차 생성/편집 | ● | ● (draft 만) | - | ● |
| **결제 마킹 (mark-paid / unmark-paid)** ★ | ● | - | - | ● |
| 세금계산서 발행 마킹 (KR 사업자, invoice·회차) ★ | ● | - | - | ● |
| 현금영수증 발급 마킹 (invoice·회차, 2026-06-13) ★ | ● | - | - | ● |
| 증빙 정정 기록 (receipt_corrections, 2026-06-13) ★ | ● | - | - | ● |
| status 직접 변경 (PATCH) | ● | - | - | ● |
| 환불 / 취소 | ● | - | - | ● |
| 삭제 — invoice · 분할 회차 ★ | ● | - | - | ● |
| 발송 리마인더 / 재발송 | ● | ● | - | ● |
| 공유 링크 (고객용) | ● | - | - | ● |
| 외화 결제 정보 설정 | ● | - | - | ● |

★ = `routes/invoices.js` `assertInvoiceMutationOwner` 가드 (`invoices.js:56-63` — `req.businessRole === 'owner'` OR platform_admin, 아니면 403 `owner_only`). 사이클 N+5 (2026-05-10) 5개 라우트로 시작 → **2026-07-10 실측 11개 라우트**: send(:1231) · send-preview(:1441) · installment mark-paid(:1619) / unmark-paid(:1655) / mark-tax-invoice(:1700) / mark-cash-receipt(:1763) · invoice mark-tax-invoice(:1908) / mark-cash-receipt(:1933) · corrections(:2016) · DELETE invoice(:2084) / DELETE installment(:2124). PATCH `/:businessId/:id/status` 는 인라인 동일 검사 (`invoices.js:2159-2161`). 리마인더/재발송은 owner 가드 없음 — member 도 가능 (rate-limit + qbill write).

> **Layer 중첩:** 위 라우트들은 모두 `requireMenu('qbill','write')` (§4.5 Layer 3) 도 체인 — member 는 qbill 메뉴 write 권한이 있어도 ★ 라우트에서 `owner_only` 로 차단된다 (메뉴 권한 ⊅ 재무 권한).

> **핵심:** member 는 청구서 **발행·결제 마킹·세금계산서·삭제** 불가. draft 만 가능. 재무 사고·미수금 추적·세무 분쟁 방지. `invoices.owner_user_id` 컬럼은 "담당자 표시" 용도로 남기되 권한 부여 안 함 (헷갈림 방지).

### 5.11 Q위키 / 도움말 — 플랫폼 공통 콘텐츠 (2026-06-18 신설)

`help_categories` / `help_articles` 는 **워크스페이스 격리 축이 없는 플랫폼 공통 콘텐츠** (business_id 없음). 격리 축은 `visibility` 하나뿐.

| 액션 | 게스트 (미인증) | 인증 사용자 (역할 무관) | platform_admin |
|---|:-:|:-:|:-:|
| `visibility='public'` article 조회 | ● (is_published=1 만) | ● | ● |
| `visibility='authenticated'` article 조회 | - | ● (is_published=1 만) | ● |
| article/category 생성·수정·삭제 | - | - | ● |

- 조회: `routes/wiki.js` — `optionalAuth` + `visibilityWhere()` (`wiki.js:72-77` — `req.user` 없으면 `visibility='public'` 강제, 단건도 `wiki.js:189-192` 동일 차단)
- 편집: `routes/admin_wiki.js:14` — `router.use(authenticateToken, requireRole('platform_admin'))` 전 엔드포인트 일괄
- 본문 임베딩은 `kb_chunks` 재사용 (`source_type='wiki'`, business_id NULL) — 워크스페이스 KB 검색 비오염 (CLAUDE.md Q위키 항목)

---

## 6. 민감 정보 정책 — 응답 제외 규칙

다음 필드는 API 응답에서 **항상 제외** 되거나 **조건부 포함**.

### 6.1 User (모든 응답에서 제외)

```js
const USER_SENSITIVE = ['password_hash', 'refresh_token', 'reset_token', 'reset_token_expires', 'verification_token'];
```

### 6.2 Business (owner/platform_admin 에게만)

```js
const BUSINESS_SENSITIVE = [
  'portone_store_id', 'portone_api_secret',
  'portone_channel_domestic', 'portone_channel_overseas',
  'portone_webhook_secret',
  'popbill_link_id', 'popbill_secret_key',
  // Stripe (2026-07 워크스페이스 카드결제) — models/Business.js:189-191
  'stripe_secret_enc', 'stripe_webhook_secret_enc',
];
// bank_* 는 조회 자체는 member 허용 (청구서에 찍혀야 함)
// stripe_publishable_key 는 설계상 평문 공개키 — 민감 아님
```

> **전역 안전망:** `models/index.js:144-150` 이 `Model.prototype.toJSON` 을 override 하여 **`*_enc` 로 끝나는 모든 컬럼을 전 모델 API 응답에서 일괄 제거** (응답에는 `*_set` boolean 만). 개별 라우트 exclude 누락에도 암호화 시크릿은 새지 않음.

### 6.3 BusinessMember (본인 + owner/platform_admin 만 본인 외 단가 조회)

```js
// member 가 동료 상세 조회 시 hourly_rate·monthly_salary 제외
const MEMBER_SENSITIVE = ['hourly_rate', 'monthly_salary'];
```

### 6.4 Client (member 전원 OK, Phase 2 에서 '고객 담당자만' 으로 제한 검토)

- 고객 민감정보 조회 자체는 모든 member 허용 (청구 업무)
- **편집**은 토글 `client_info` 에 따라 분기

### 6.5 Invoice/Quote (해당 프로젝트 참여자)

- member: 본인 워크스페이스 전체 조회 가능
- client: 자기 프로젝트 것만. `share_token` 있으면 미인증도 조회 가능 (단건)

---

## 7. Client (고객) 접근 범위

고객은 "조직 외부" 라서 명시적 화이트리스트로만 접근.

| 자원 | 접근 조건 |
|---|---|
| 대화방 | `conversation_participants.user_id = me` 또는 `conversations.client_id → clients.user_id = me` (`access_scope.js:144-182`) |
| 업무 | 담당자 / 작성자 / 요청자(`request_by_user_id`) / 컨펌자(TaskReviewer) 본인 **OR** 본인 참여 대화방의 task **OR** 본인 참여 프로젝트의 task (`access_scope.js:187-230` — visibility 필드 검사 아님, 화이트리스트 OR 조건) |
| 파일 | 본인 참여 프로젝트의 파일, 또는 본인이 업로드한 것 (`access_scope.js:285-295`) |
| 프로젝트 | `project_clients.contact_user_id = me` 인 프로젝트만 (`access_scope.js:274-280`) |
| 청구서 | 본인 `client_id` 의 것만 (`access_scope.js:300-314`) |

**고객 자동 진입 흐름**: invite_token → 승인 → `clients.user_id` 연결 → 이후 해당 프로젝트·대화방·청구서 자동 노출.

**구현 단일 원천 (2026-04-28 신설 → 현행):** `middleware/access_scope.js` — `getUserScope()` 로 역할 종합 (`isOwner/isMember/isAdmin/isClient/isAi` + `businesses.owner_id` fallback, 운영 #14/#36) → `canAccess*()` 단건 검사 + `*ListWhere()` 목록 WHERE 생성 + `attachWorkspaceScope()` 미들웨어 (`req.scope`/`req.businessRole` 주입). 신규 라우트는 인라인 BusinessMember 조회 대신 이 헬퍼 사용.

**4단계 Visibility (L1~L4, 사이클 N+9)** — files/posts/kb_documents 는 client 격리와 별개로 **멤버 간에도** 자산별 공개 레벨 적용: L1=개인(업로더/작성자만) / L2=프로젝트 멤버 또는 지정 멤버(`target_member_ids`) / L3=워크스페이스 / L4=외부(share_token, 워크스페이스 멤버도 열람). 구현: `canAccessFileByLevel`/`fileListWhereByLevel`/`canAccessPostByLevel`/`postListWhereByLevel`/`canAccessKbDocumentByLevel` (`access_scope.js:349-515`). Task/Conversation 등 협업 자산은 이 레벨 정책 미적용 (열린 문화 유지). 상세 설계: `docs` visibility 문서 + memory `project_visibility_unified_arch.md`.

---

## 8. 공개 토큰 접근 (unauthenticated)

### 8.1 share_token

- 견적서 (`quotes.share_token`) · 청구서 (`invoices.share_token`) · 보고서 (`reports.share_token`)
- 단건 조회 전용. CRUD 불가.
- **만료**: 견적은 `valid_until` 지나면 무효. 청구·보고서는 무기한 (고객이 나중에 재조회 가능).
- **취소**: owner 가 `share_token` 재생성 또는 NULL 로 설정하여 무효화.
- **쿨링**: 첫 조회 시 `viewed_at` 기록 (감사용).

### 8.2 invite_token

- 멤버 초대 (`business_members.invite_token`) · 고객 초대 (`clients.invite_token`) · 프로젝트 고객 (`project_clients.invite_token`)
- 단발성. accept 시 토큰 무효화 (NULL 로 설정).
- **만료**: 7일 (기본값, 설정 가능).
- **rate-limit 필수**: 토큰 brute-force 방지.

---

## 9. 백엔드 구현 가이드

### 9.1 미들웨어 체인 표준

```js
// 공개 (로그인/회원가입/공개 토큰 조회)
router.post('/api/auth/login', loginLimiter, handler);

// 사용자 본인 데이터
router.get('/api/users/me', authenticateToken, handler);

// 비즈니스 데이터 (조회)
router.get('/api/.../:businessId', authenticateToken, checkBusinessAccess, handler);

// 비즈니스 데이터 (메뉴 단위 기능 — Layer 3, §4.5)
router.post('/api/invoices/:businessId', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), handler);

// 비즈니스 데이터 (재무 쓰기)
router.post('/api/invoices/:businessId', authenticateToken, checkBusinessAccess, canFinancial(), handler);

// 플랫폼 관리
router.get('/api/admin/businesses', authenticateToken, requireRole('platform_admin'), handler);
```

### 9.2 미들웨어 원칙

1. **인증 → 비즈니스 접근 → 액션 권한** 순으로 체인.
2. **Route handler 안에서 `req.businessRole` 사용** — `checkBusinessAccess` 가 세팅.
3. **라우트 내부 추가 검증** (예: 본인 생성 여부) 은 권한 미들웨어 통과 후 안에서.
4. **platform_admin 은 모든 비즈니스 가드 통과** — `checkBusinessAccess` 가 자동 처리.
5. **에러 메시지 통일**: 401 `Access token required` · 403 `forbidden` 또는 구체 사유.

### 9.3 새 라우트 추가 시 체크리스트

- [ ] `authenticateToken` 적용했는가?
- [ ] 비즈니스 데이터면 `checkBusinessAccess` (또는 `attachWorkspaceScope`) 도 적용했는가?
- [ ] client 접근 가능 자원이면 `access_scope.js` 의 `canAccess*`/`*ListWhere` 를 썼는가? (인라인 재구현 금지)
- [ ] 메뉴 단위 기능이면 `requireMenu('<menu>', 'read'|'write')` (§4.5) 적용했는가?
- [ ] 플랫폼 관리면 `requireRole('platform_admin')` 적용했는가?
- [ ] 재무·일정·고객정보 쓰기면 `canFinancial/canSchedule/canClientInfo` 적용했는가?
- [ ] invoice 발행·결제·증빙·삭제류면 `assertInvoiceMutationOwner` (§5.10) 적용했는가?
- [ ] 응답에서 민감 필드 제외 (`attributes: { exclude: [...] }`) 했는가?
- [ ] 트랜잭션 필요한 다중 테이블 쓰기면 `sequelize.transaction()` 감쌌는가?
- [ ] Socket.IO 이벤트 brodcast 시 room 권한 재검증 거쳤는가?
- [ ] 이 매트릭스 문서 5장 테이블 업데이트했는가?

---

## 10. 프론트엔드 구현 가이드

### 10.1 UX 원칙 (30년차)

> **"권한 부족 버튼은 사라지지 말고 비활성화 + 툴팁."**
> 사용자가 "왜 이 버튼이 없지?" 라고 헤매는 것보다 "왜 눌리지 않지? — PM 만 가능합니다" 라고 즉시 이해하는 게 10배 낫다.

**구현 원칙 3가지:**

1. **버튼은 항상 보이게** — 단, 권한 없으면 `disabled + title="PM만 발행 가능합니다"`. 메뉴 자체를 숨기면 "이 앱에 이 기능이 있나?" 조차 모름.
2. **이유를 툴팁으로** — "권한이 없습니다" X. "PM 만 견적서를 발행할 수 있습니다. 설정 > 권한 에서 변경 가능" O.
3. **오너/PM 전용 UI 는 배지** — 수익성 탭 진입 시 "오너 전용" 배지 달기. 오해 방지.

### 10.2 권한 훅

```ts
// hooks/usePermissions.ts
export function usePermissions(projectId?: number) {
  const { user, business, projectMembership } = useAuth();
  const mode = business?.permissions || { financial: 'all', schedule: 'all', client_info: 'all' };
  const isOwner = business?.role === 'owner';
  const isPlatformAdmin = user?.platform_role === 'platform_admin';
  const isPM = projectMembership?.is_pm ?? false;

  const can = (toggle: 'financial' | 'schedule' | 'client_info') => {
    if (isPlatformAdmin || isOwner) return true;
    return mode[toggle] === 'all' || isPM;
  };

  return {
    isOwner, isPM, isPlatformAdmin,
    canFinancial: can('financial'),
    canSchedule: can('schedule'),
    canClientInfo: can('client_info'),
    reason: (toggle: string) =>
      mode[toggle] === 'pm' && !isPM && !isOwner
        ? 'PM 또는 오너만 이 액션을 수행할 수 있습니다.'
        : null,
  };
}
```

### 10.3 UI 예시

```tsx
const { canFinancial, reason } = usePermissions(projectId);

<PrimaryButton
  disabled={!canFinancial}
  title={reason('financial') ?? undefined}
  onClick={openInvoiceModal}
>
  청구서 발행
</PrimaryButton>
```

### 10.4 오너 전용 탭의 표시

```tsx
<TabBar>
  <Tab to="/stats/overview">개요</Tab>
  <Tab to="/stats/profit">
    수익성 <OwnerBadge>오너 전용</OwnerBadge>
  </Tab>
</TabBar>
```

라우트 단에서 `requiredRole` 로 막되, 탭 자체는 보이게. 클릭 시 "오너만 접근 가능" 설명 페이지.

---

## 11. 새 엔드포인트 추가 체크리스트

```
[ ] 이 문서 5장 매트릭스에 해당 액션을 추가했는가?
[ ] 라우트에 authenticateToken 적용
[ ] 비즈니스 데이터면 checkBusinessAccess 적용
[ ] 플랫폼 관리면 requireRole('platform_admin') 적용
[ ] 재무·일정·고객정보 쓰기면 canFinancial/canSchedule/canClientInfo 적용
[ ] 민감 필드 응답 제외 (exclude)
[ ] Socket.IO 브로드캐스트 시 room 권한 확인
[ ] 프론트에서 같은 액션 버튼에 usePermissions 훅 적용
[ ] disabled + title 툴팁 이유 명시
[ ] 통합 테스트: 각 역할별 호출 시 기대 응답 (200/403) 검증
```

---

## 12. 역사 · 변경 이력

| 날짜 | 변경 | 주도 |
|---|---|---|
| 2026-04-24 | 초판 작성 — 5 역할, 3 토글, 전 매트릭스 | 기획 (Irene) + 30년차 관점 검증 |
| 2026-04-28 | **§7 client 정책 백엔드 일괄 구현** — `middleware/access_scope.js` 신설. conversations/tasks/task_attachments/calendar/files/file_folders/posts/docs/invoices/dashboard 11개 라우트가 client 도 자기 자원 통과시키도록 통일. E2E 검증: client 격리 12/12 + owner 쓰기 5/5 통과 | Irene 요청 — "권한에 맞게 안 나옴" 진단 후 일괄 수정 |
| 2026-05-10 | **사이클 N+5 — 책임선 명확화**: §5.7 Task 필드별 권한 신설 (description = 의뢰자 / body = 수행자), §5.8 Q Note 개인도구 박제 (owner 차단), §5.9 Message 모더레이션, §5.10 Invoice 재무 owner only. `routes/tasks.js` FIELD_RULES 분리, `TaskDetailDrawer.tsx` canEditDescription/canEditBody 분리. RichEditor 링크 클릭 항상 새 탭 | Irene 요청 — "관리자가 결과물 수정되는 게 말 안 됨" 진단 후 정책 정리 |
| 2026-07-10 | **코드 실측 대조 갱신 (Fable 게이트)**: §2 `ai`(Cue) 역할 추가 + admin 스캐폴드 실태 명시 (ENUM 은 owner/member/ai — `models/BusinessMember.js:46`), §4.3 토글 미들웨어 구현체 확인 (`middleware/permissions.js`), §4.5 멤버 메뉴 권한 Layer 3 신설 (`requireMenu`, 12 메뉴키, weekly_team default none), §5.7 실코드 정합 (project_id 이관 완화 운영 #42 · status 직접 PUT 담당자 포함 · 워크플로우 only_assignee/not_a_reviewer · DELETE 타인 관여 0건 운영 #14), §5.8 Q Note visibility L1~L4 (N+14, 쓰기는 여전히 생성자만), §5.10 owner_only 11 라우트 + 현금영수증·증빙정정 + requireMenu 중첩, §5.11 Q위키 visibility 신설, §6.2 Stripe `*_enc` + 전역 toJSON redact, §7 client 업무 조건 실코드(화이트리스트 OR) 정합 + access_scope 단일원천 + L1~L4 요약 | Fable 검증 게이트 — 코드가 진실 원칙으로 문서 정정 |

| 2026-07-10 | **admin 역할 정식 활성화 (Fable 게이트 — "정석" 판정 A)**: `BusinessMember.role` ENUM 에 `admin` append (모델=SSOT → sync-database 재-strip 차단), `access_scope.js` `attachWorkspaceScope` allowed 세트에 `scope.isAdmin` 편입 (누락 시 admin 이 checkBusinessAccess 전 라우트 403 잠김 — E2E 로 발견), `scripts/health-check.js` ENUM 유지 감시 항목 추가. 실 HTTP 7/7: 승격 200(기존 ENUM 결손 500 회귀 해소)·DB admin·admin 게이트 통과·admin invoice send 403 owner_only(재무 불변식)·강등 복원. 근본원인: 6-09 수동 ALTER 가 모델 미갱신 → sync 가 벗김 | Fable 판정 — "죽은 스캐폴드가 아닌 N+21 배포기능의 DB 결손 사고, 승인된 설계 복원이 정석" |

이후 변경 시 이 테이블에 한 줄 + 관련 매트릭스 업데이트.
