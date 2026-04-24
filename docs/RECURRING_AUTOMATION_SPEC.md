# PlanQ 반복 · 정기 자동화 (Recurring & Subscription Automation)

> **구독 고객의 반복 업무 자동 생성 + 월 자동 청구 + 실패 처리 + 해지 정책.**
> 상위 지도: `INTEGRATED_ARCHITECTURE.md §4`
> 연관: `TEMPLATE_SYSTEM_SPEC.md §3.4 (subscription 템플릿)` · `Q_BILL_SPEC.md §13`
>
> 작성: 2026-04-24 · 상태: 설계 확정 (구현 Phase 3)

---

## 1. 철학

1. **업무와 청구는 분리된 이벤트** — "업무는 매월 15일 자동 생성", "청구는 매월 1일 자동 발행" 처럼 두 cron 이 독립. 결제 실패해도 업무는 생성(실무 계속되는 게 맞음), grace 끝나면 비활성화.
2. **rrule 표준** — iCalendar `RRULE` 문자열을 `rrule` 라이브러리(이미 package.json)로 파싱. "매월 15일" "매주 월·수" "격주 금" 전부 한 필드.
3. **멱등 (idempotent)** — cron 이 같은 시점 2회 돌아도 중복 생성 안 됨. `last_fired_at` + unique key 로 방어.
4. **자동 생성은 항상 AI 배지 + 되돌리기** — UX 약속 §9.2.
5. **초기엔 node-cron 로 충분. Stage 2(500 biz+) 시 BullMQ 전환** — 기술 스택 §7.

---

## 2. 데이터 모델

### 2.1 `recurring_tasks` (신규)

자동 생성되는 업무의 "설계도". 실제 업무는 `tasks` 에 복제된다.

```sql
CREATE TABLE recurring_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  project_id BIGINT NULL REFERENCES projects(id) ON DELETE CASCADE,  -- null 가능 (워크스페이스 전역 반복)
  -- 업무 설계
  title VARCHAR(300) NOT NULL,            -- 결과물 기반 명사+동사 (feedback_task_naming)
  description TEXT,
  assignee_user_id INT NULL,              -- 고정 담당
  assignee_role VARCHAR(50) NULL,         -- 또는 '기획/디자인/개발' 중 프로젝트 기본 담당자 자동 선택
  estimated_hours DECIMAL(5,1),
  category VARCHAR(50),
  priority ENUM('low','normal','high') DEFAULT 'normal',
  -- 반복 규칙
  rrule_str VARCHAR(500) NOT NULL,        -- 'FREQ=MONTHLY;BYMONTHDAY=15'
  timezone VARCHAR(50) DEFAULT 'Asia/Seoul',
  -- 실행 상태
  next_fire_at DATETIME NOT NULL,         -- 다음 실행 시각 (UTC)
  last_fired_at DATETIME NULL,
  fire_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  -- 제약
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,                  -- 자동 비활성화 시점
  max_occurrences INT NULL,               -- 최대 발동 횟수
  -- 원천 추적
  source_type ENUM('template','subscription','manual') DEFAULT 'manual',
  source_ref_id BIGINT NULL,              -- subscription 시 projects.id
  -- 감사
  created_by_user_id INT NOT NULL,
  created_at DATETIME, updated_at DATETIME,
  INDEX idx_fire (is_active, next_fire_at),
  INDEX idx_project (project_id),
  INDEX idx_business (business_id)
);
```

### 2.2 `subscription_cycles` (신규)

구독 프로젝트의 청구 주기 상태. **idempotency 핵심**.

```sql
CREATE TABLE subscription_cycles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id INT NOT NULL,
  -- 주기 식별
  cycle_start DATE NOT NULL,              -- 2026-04-01
  cycle_end DATE NOT NULL,                -- 2026-04-30
  billing_date DATE NOT NULL,             -- 2026-04-15 (청구 발행일)
  due_date DATE NOT NULL,                 -- 2026-04-25
  -- 금액
  amount DECIMAL(14,2) NOT NULL,          -- 기본 monthly_fee
  overage_amount DECIMAL(14,2) DEFAULT 0, -- 초과 사용분 (예: 시간 초과)
  total_amount DECIMAL(14,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'KRW',
  -- 실행 상태
  status ENUM('scheduled','invoiced','paid','overdue','canceled','failed') DEFAULT 'scheduled',
  invoice_id INT NULL REFERENCES invoices(id),   -- 발행된 Q Bill invoice
  fired_at DATETIME NULL,                  -- 실제 청구 발행 시각
  failed_reason VARCHAR(500) NULL,
  retry_count INT DEFAULT 0,
  -- 감사
  created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uniq_project_cycle (project_id, cycle_start),
  INDEX idx_billing (billing_date, status)
);
```

**멱등성 핵심**: `UNIQUE (project_id, cycle_start)` — 같은 프로젝트의 같은 주기는 단 1회만 생성.

### 2.3 기존 테이블과의 연결

- `projects.billing_type='subscription'` + `projects.monthly_fee` → cycle 자동 생성
- `invoices.project_id` → cycle.invoice_id 로 역참조
- `invoice_payments` → cycle.status 업데이트 트리거

---

## 3. Cron 스케줄러

### 3.1 작업 목록

| Cron | 주기 | 책임 | 실패 시 |
|---|---|---|---|
| **recurring-tasks.tick** | 매 15분 | `recurring_tasks.next_fire_at <= NOW()` 인 것을 `tasks` 로 복제, 다음 `next_fire_at` 계산 | 실패 업무는 `AuditLog` 기록, 다음 tick 에 재시도 (최대 3회) |
| **subscription-cycles.plan** | 매일 02:00 KST | 구독 프로젝트 별로 다음 주기의 `subscription_cycles` 레코드 준비 (billing_date 하루 전에) | 워크스페이스 owner 이메일 |
| **subscription-cycles.invoice** | 매일 03:00 KST | `billing_date <= TODAY` + `status='scheduled'` 인 cycle 에 대해 Q Bill invoice 발행 | `status='failed'` + retry_count++ |
| **subscription-cycles.charge** | 매일 04:00 KST | `status='invoiced'` + 포트원 빌링키 보유 고객에 대해 자동 결제 시도 | `status='failed'`, 다음날 재시도 (최대 3회), 이후 owner 알림 + `overdue` |
| **overdue-check** | 매일 05:00 KST | `due_date < TODAY` + `status='invoiced'` → `status='overdue'` + 고객·오너 알림 | 조용히 log |

### 3.2 구현 패턴

```js
// services/cron/recurring_tasks.js
const { RRule } = require('rrule');

async function tickRecurringTasks() {
  const now = new Date();
  const due = await RecurringTask.findAll({
    where: { is_active: true, next_fire_at: { [Op.lte]: now } },
    limit: 500,    // 한 tick 에 500개까지. 이상은 다음 tick 으로.
  });

  for (const rt of due) {
    const t = await sequelize.transaction();
    try {
      // 1) tasks 생성 (결과물 기반 업무명은 rt.title 그대로)
      const task = await Task.create({
        business_id: rt.business_id,
        project_id: rt.project_id,
        title: rt.title,
        description: rt.description,
        assignee_id: rt.assignee_user_id || await resolveRoleAssignee(rt.project_id, rt.assignee_role),
        estimated_hours: rt.estimated_hours,
        category: rt.category,
        priority: rt.priority,
        source: 'recurring',
        source_message_id: null,
        created_by: rt.created_by_user_id,
        // 자동 생성 마커
        is_auto_generated: true,         // Phase 3 에서 tasks 에 컬럼 추가
        auto_source_ref_id: rt.id,
      }, { transaction: t });

      // 2) 다음 next_fire_at 계산 (rrule)
      const rule = RRule.fromString(rt.rrule_str);
      const next = rule.after(now, false);

      // 3) 상태 업데이트
      await rt.update({
        last_fired_at: now,
        next_fire_at: next,
        fire_count: rt.fire_count + 1,
        is_active: next && (!rt.max_occurrences || rt.fire_count + 1 < rt.max_occurrences),
      }, { transaction: t });

      await t.commit();

      // 4) Socket.IO 알림
      io.to(`business:${rt.business_id}`).emit('task:new', task.toJSON());
    } catch (e) {
      await t.rollback();
      logger.error('[recurring-tasks.tick]', { rtId: rt.id, error: e.message });
    }
  }
}
```

### 3.3 구독 청구 cron 의 흐름

```
02:00 KST    03:00 KST         04:00 KST       05:00 KST
┌────────┐  ┌───────────────┐  ┌───────────┐  ┌──────────┐
│ plan   │─►│ invoice 발행  │─►│ charge    │─►│ overdue  │
│        │  │ (Q Bill)       │  │ (portone) │  │ 체크     │
└────────┘  └───────────────┘  └───────────┘  └──────────┘
  D-1         billing_date=D    D or 다음날     due_date 경과
  준비        status=invoiced   성공=paid       status=overdue
              + 고객 이메일      실패=failed     + 고객 알림
```

---

## 4. 업무 자동 생성 — 3가지 경로

### 4.1 구독 프로젝트 생성 시 (일괄)

```
사용자: 프로젝트 생성 + billing_type='subscription' + monthly_fee 입력
        + (옵션) subscription 템플릿 선택
         │
         ▼
서버: projects 생성
     + template.recurring_tasks 기반으로 recurring_tasks 일괄 생성
     + subscription_cycles 첫 주기 준비 (status='scheduled')
```

### 4.2 기존 프로젝트에 반복 업무 개별 추가

```
사용자: 프로젝트 상세 > "반복 업무 추가"
         │
         ▼
모달: 제목 · 담당 · 예상시간 · 반복규칙 선택 (매주 월요일 / 매월 15일 / 격주 금 ...)
         │
         ▼
서버: recurring_tasks 레코드 1개 생성
```

### 4.3 템플릿으로 프로젝트 생성 (자동)

```
TEMPLATE_SYSTEM_SPEC §3.1 의 content.recurring 이 있으면
→ 프로젝트 생성과 함께 recurring_tasks 일괄 등록
```

---

## 5. UI 설계

### 5.1 반복 업무 배지

```
[Task Card]
  ┌──────────────────────────────────────┐
  │ 📅 매주 점검 리포트 작성              │
  │ 🔄 자동 생성 · 매주 월요일 09:00     │
  │ ...                                  │
  └──────────────────────────────────────┘
```

- `tasks.is_auto_generated=true` 면 `🔄 자동` 배지 + 호버 시 `recurring_tasks.rrule` 해석된 문구 표시
- 클릭 시 "이 업무는 [매주 월 09:00 반복]에서 생성됨. **이번만 취소** / **반복 중지** / **편집**"

### 5.2 구독 프로젝트 헤더

```
┌────────────────────────────────────────────┐
│ ACME 호스팅 유지보수                        │
│ 🔁 구독 · ₩500,000/월 · 매월 15일 청구       │
│ 다음 청구: 2026-05-15 (25일 후)             │
│ [구독 관리 ▾]                               │
└────────────────────────────────────────────┘
```

- `[구독 관리]` 드롭다운: `일시 중지 · 해지 · 청구 주기 변경 · 금액 변경`

### 5.3 반복 규칙 입력 UI

`rrule` 문자열을 사용자가 직접 쓰게 하면 안 됨. 폼으로:

```
반복 주기:
  ○ 매일
  ○ 매주      [월] [화] [수] [목] [금] [토] [일]
  ◉ 매월      매월 [15]일
  ○ 격주      [월요일] 부터
  ○ 사용자 정의 (고급)

시작:  2026-05-01
종료:  ○ 없음   ○ 날짜 지정   ○ N회 반복 후

[저장]   (미리보기: 다음 5회 — 5/15, 6/15, 7/15, 8/15, 9/15)
```

### 5.4 구독 해지 모달

```
┌────────────────────────────────────────────┐
│ ACME 호스팅 유지보수 구독 해지             │
├────────────────────────────────────────────┤
│ 이 구독을 해지하면:                         │
│                                            │
│ ✓ 다음 청구(2026-05-15)부터 발행되지 않음    │
│ ✓ 이미 생성된 업무는 보존 (완료 가능)        │
│ ✓ 반복 업무 자동 생성 중지                  │
│ ✓ 미수금(2026-04 분 ₩550,000) 은 유지        │
│                                            │
│ 언제 해지할까요?                            │
│  ○ 즉시 (오늘부터 중지)                     │
│  ◉ 현 주기 끝에 (2026-04-30 에 중지)         │
│                                            │
│            [취소]  [구독 해지]              │
└────────────────────────────────────────────┘
```

---

## 6. 실패 처리 상세

### 6.1 업무 자동 생성 실패

원인: assignee 가 removed · 프로젝트가 closed · DB 에러

- 1차: 다음 15분 tick 에 재시도 (최대 3회)
- 3회 실패: `recurring_tasks.is_active=false` + `AuditLog` + 워크스페이스 owner 이메일

### 6.2 구독 청구 발행 실패

원인: 고객이 삭제됨 · client_id 무효

- `subscription_cycles.status='failed'` + `failed_reason` 기록 + 다음날 재시도
- 3회 실패: status 유지 + owner 이메일 + **다음 주기는 정상 진행** (이번 주기만 스킵)

### 6.3 자동 결제 실패

원인: 카드 만료·잔액 부족·한도 초과

- 1차 실패 (D): `status='invoiced'` 유지, 고객 이메일 (카드 확인 요청)
- 2차 재시도 (D+3): 실패 시 `status='overdue'`
- 3차 재시도 (D+7): 실패 시 owner 알림 + 고객에게 "결제 수단 업데이트" 요청
- **서비스 중단은 하지 않음 (Q Bill 은 외향). 플랫폼 구독(PLATFORM_BILLING_SPEC)은 다름.**

---

## 7. 구독 해지 · 일시 중지 정책 (Irene 결정 #9)

| 동작 | 기존 업무 | 반복 업무 | 미수금 | 다음 청구 | 결제 시도 |
|---|---|---|---|---|---|
| **일시 중지** | 보존 | 생성 중지 | 유지 | 중지 | 중지 |
| **해지 (즉시)** | **보존** | 즉시 중지 | 유지 | 중지 | 중지 |
| **해지 (주기 끝)** | 보존 | 주기 끝까지 계속 | 유지 | 이번 주기까지 | 이번 주기까지 |

- 해지 후 재개 시: 새 구독으로 취급 (`subscription_cycles` 새로 시작)
- 해지해도 **프로젝트 자체는 삭제 안 됨**. `projects.billing_type` 만 `'internal'` 로 전환.

---

## 8. 알림 / 이메일

### 8.1 대상별

| 이벤트 | 고객 | 워크스페이스 owner | 담당 멤버 |
|---|---|---|---|
| 반복 업무 생성 | X | X | Socket.IO + in-app (Cue 알림 스타일) |
| 구독 청구 발행 | Email + 링크 | Socket.IO | X |
| 결제 성공 | Email (영수증) | Socket.IO | X |
| 결제 실패 1차 | Email (카드 확인) | Socket.IO | X |
| 결제 실패 3차 (overdue) | Email + 카톡 (Phase 10) | Email + in-app | X |
| 구독 해지 | Email | Email | in-app |

### 8.2 템플릿
- `emailService.sendSubscriptionInvoice(invoice)` — 새 청구 안내
- `emailService.sendPaymentFailed(invoice, retryDate)` — 결제 실패
- `emailService.sendOverdueReminder(invoice, daysOverdue)` — 연체 독촉

---

## 9. 관리자 대시보드 (Phase 3 후속)

`/business/bills/subscriptions` — owner 전용

- **구독 고객 목록** (client 별 · billing_type='subscription' 프로젝트 집계)
- **이번 달 예상 매출** (구독료 × 활성 구독 수)
- **실패한 청구 목록** (action 필요)
- **이번 주 자동 생성된 업무** (감사용)

---

## 10. API 엔드포인트

```
반복 업무
  GET    /api/projects/:id/recurring-tasks
  POST   /api/projects/:id/recurring-tasks        body: { title, rrule_str, assignee_user_id, ... }
  PUT    /api/recurring-tasks/:id
  DELETE /api/recurring-tasks/:id (is_active=false + 취소)
  POST   /api/recurring-tasks/:id/skip-next       body: { reason? }  — 이번 회차만 취소

구독 주기
  GET    /api/projects/:id/subscription-cycles
  POST   /api/projects/:id/subscription/pause
  POST   /api/projects/:id/subscription/resume
  POST   /api/projects/:id/subscription/cancel    body: { effective: 'now' | 'end_of_cycle' }
  PATCH  /api/subscription-cycles/:id             body: { amount, due_date }  — 이번 주기만 조정

Cron 수동 트리거 (platform_admin — 개발/검증)
  POST   /api/admin/cron/recurring-tasks
  POST   /api/admin/cron/subscription-invoice
  POST   /api/admin/cron/subscription-charge
```

---

## 11. 권한 매트릭스 (PERMISSION_MATRIX 확장)

| 작업 | platform_admin | owner | member | PM | client |
|---|:---:|:---:|:---:|:---:|:---:|
| 반복 업무 조회 | ● | ● | ● | ● | 참여 프로젝트만 |
| 반복 업무 생성/편집/삭제 | ● | ● | `schedule=all` 이면 ● | ● | - |
| 구독 주기 조회 | ● | ● | ● | ● | 본인 것만 |
| 구독 청구 금액 변경 | ● | ● | `financial=all` 이면 ● | ● (financial=pm 시) | - |
| 구독 일시중지·해지 | ● | ● | - | - | - |
| Cron 수동 트리거 | ● | - | - | - | - |

---

## 12. 검증 체크리스트

- [ ] 같은 `recurring_task` 를 같은 시각에 2번 fire 해도 task 1건만 생성
- [ ] rrule 파싱 — 매주/매월/격주/월말(L-1) 모두 정확
- [ ] 타임존 — `Asia/Seoul` 기준 "매월 15일 09:00" 이 UTC 로 올바르게 저장
- [ ] 구독 해지 "주기 끝" 선택 시 다음 청구 발행 안 됨
- [ ] 구독 해지 후 기존 tasks 유지 (삭제 안 됨)
- [ ] 결제 3회 실패 → overdue 전환
- [ ] `subscription_cycles` UNIQUE 제약으로 중복 cycle 생성 안 됨
- [ ] 프로젝트 삭제 시 recurring_tasks/subscription_cycles CASCADE 삭제
- [ ] Cron 실패 시 AuditLog 남김

---

## 13. 구현 일정 (Phase 3 내)

| Day | 작업 |
|---|---|
| 1 | `recurring_tasks` + `subscription_cycles` DB 스키마 + 모델 |
| 2 | Cron 구현 (recurring-tasks.tick + subscription-cycles.plan/invoice/charge/overdue) |
| 3 | 반복 업무 입력 UI (rrule 폼) + 프로젝트 상세 "반복 업무" 섹션 |
| 4 | 구독 프로젝트 헤더 + 해지/중지 모달 + 주기 타임라인 |
| 5 | 알림 이메일 템플릿 + 실패 처리 + AuditLog |
| 6 | 관리자 대시보드 `/business/bills/subscriptions` |
| 7 | E2E 검증 (시간 앞당기기 + cron 수동 트리거) |

---

## 14. 변경 이력

| 날짜 | 버전 | 요약 |
|---|---|---|
| 2026-04-24 | 1.0 | 반복/정기 자동화 설계 확정. rrule + cron + idempotent subscription_cycles · 해지 3모드 · Phase 3 7일 일정 |
