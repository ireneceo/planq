# PlanQ 권한 매트릭스 (단일 소스)

> **이 문서가 권한 정책의 단일 진실 공급원 (Single Source of Truth).**
> 새 API 를 만들 때, 새 UI 버튼을 붙일 때, 권한 수정을 할 때 — 먼저 이 문서를 보고 업데이트한다.
>
> 작성: 2026-04-24 · 상태: Phase 0 와 함께 확정 · 구현 가이드 포함

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
| **PM** | `project_members.is_pm = 1` (member + PM 배정) | 프로젝트 |
| **client** | `clients.user_id = me` 또는 `project_clients.contact_user_id = me` | 프로젝트/대화 |
| **unauthenticated** | `share_token` / `invite_token` 기반 | 단건 |

**역할 합성 규칙**
- `platform_admin` 은 어떤 워크스페이스든 owner 와 동등 (단 워크스페이스 **토글 설정 편집** 은 예외 — 해당 워크스페이스 owner 만)
- `owner` 는 암묵적 PM — 모든 프로젝트 PM 게이트 액션 통과
- `member` 는 **PM 배정 여부에 따라** 재무/일정/고객정보 편집 가능 여부 결정 (토글 설정과 결합)
- `client` 는 다른 어떤 역할도 겸할 수 없음 (조직 외부)

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

```js
// 미들웨어 후보: middleware/permissions.js
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
];
// bank_* 는 조회 자체는 member 허용 (청구서에 찍혀야 함)
```

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
| 대화방 | `conversation_participants.user_id = me` 또는 `conversations.client_id → clients.user_id = me` |
| 업무 | `tasks.conversation_id` 가 본인 대화방인 것 **AND** `tasks.visibility = 'shared'` (Phase 9 에서 visibility 도입 전까지는 `source='qtalk_extract'` 또는 명시 공유) |
| 파일 | 본인 참여 프로젝트의 파일, 또는 본인이 업로드한 것 |
| 프로젝트 | `project_clients.contact_user_id = me` 인 프로젝트만 |
| 청구서 | 본인 `client_id` 의 것만 |

**고객 자동 진입 흐름**: invite_token → 승인 → `clients.user_id` 연결 → 이후 해당 프로젝트·대화방·청구서 자동 노출.

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

// 비즈니스 데이터 (재무 쓰기)
router.post('/api/invoices/:businessId', authenticateToken, checkBusinessAccess, canFinancial, handler);

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
- [ ] 비즈니스 데이터면 `checkBusinessAccess` 도 적용했는가?
- [ ] 플랫폼 관리면 `requireRole('platform_admin')` 적용했는가?
- [ ] 재무·일정·고객정보 쓰기면 `canFinancial/canSchedule/canClientInfo` 적용했는가?
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

이후 변경 시 이 테이블에 한 줄 + 관련 매트릭스 업데이트.
