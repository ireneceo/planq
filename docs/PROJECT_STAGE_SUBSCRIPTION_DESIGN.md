# 거래 단계 ② — 구독형 반복 사이클 설계 (Project Stage / Subscription Recurring)

> 상태: **설계 (Irene 승인 후 구현)** · 작성 2026-06-15
> 선행: ① 단계 수동 완료/건너뛰기 (manual_locked) — 구현·배포 완료 (commit f369f0c)

## 1. 문제

현재 거래 단계(`project_stages` + `projectStageEngine`)는 **일회성 선형 모델**이다:
`견적 → 계약 → 청구·결제 → 세금계산서` 를 한 번 통과하면 "완료".

**구독형 프로젝트(subscription)** 는 이 모델과 안 맞는다:
- **월별 청구·결제**는 매달 **반복**되는 일 (1회 완료 아님)
- **세금계산서 발행**도 매 회차 **반복**
- 프로젝트는 구독이 끝날 때까지 **계속 "진행 중"** — "완료되는 단계"가 아님
- 현재는 invoice 단계에 `metadata.recurring:true` 플래그만 있고, 엔진은 "모든 invoice paid → completed" 로직이라 **다음 달 청구가 또 생기는 구조를 표현 못 함**

→ 사용자 호소: "월 청구·세금계산서는 계속 생기는 일인데 이게 반복적으로 도는 구조야? 구독형인데?"

## 2. 설계 원칙

1. **구독형은 "초기 단계(1회)" + "반복 사이클(N회)" 두 부분으로 분리**
   - 1회: 계약 체결 (초기 1번)
   - 반복: [청구 → 결제 → 세금계산서] 가 매 결제주기마다 1 사이클
2. **단계판 = 일회성 체크리스트 → "진행 중인 반복 의무 + 이번 회차 상태 + 다음 예정일"**
3. **기존 자산 재사용** — 고객 구독청구 엔진([[project_client_subscriptions]], `ClientSubscription` + daily cron)이 이미 weekly/monthly/quarterly/yearly 반복 청구를 생성. 단계판은 그 사이클을 **표시·추적**만.
4. ① manual_locked 와 공존 (계약 단계는 수동 완료 가능)

## 3. 데이터 모델

### project_stages 확장 (기존 테이블, 컬럼 추가 없이 metadata 활용 우선)
- `metadata.recurring: true` — 반복 단계 표시 (이미 있음)
- `metadata.cycle`: `{ period: 'monthly'|'quarterly'|..., anchor_day, next_due_at, completed_cycles, total_cycles|null }`
- subscription 단계는 status 를 "completed" 로 박지 않고 **`active`(진행 중) 유지** — 사이클 회전

### 연결: ClientSubscription ↔ project_stages
- 구독형 프로젝트 생성 시 `ClientSubscription` 1건과 연결 (`project_stages.metadata.subscription_id`)
- 청구 cron 이 회차 invoice 생성 → 단계판이 그 invoice 들로 "이번 회차" 계산

## 4. 엔진 변경 (projectStageEngine)

```
subscription 단계 평가:
  - contract: 기존대로 (서명 or manual_locked) → completed (1회)
  - invoice(recurring): completed 로 박지 않음. 대신:
      · 이번 주기 invoice 있나? → 없으면 "다음 청구 예정" (next_due_at)
      · 있으면 paid? → "이번 회차 결제 완료" / 미납 "결제 대기"
      · status = active 유지 (사이클 회전)
  - tax_invoice(recurring): 이번 회차 invoice 의 세금계산서 발행 여부로 "발행 대기/완료"
next_action:
  - 이번 회차에 해야 할 것 (청구 발행 / 결제 확인 / 세금계산서 발행) 1개
  - 다음 회차 예정일 표시
```

## 5. UI 변경 (TransactionsTab)

- **반복 단계 시각화**: "월별 청구·결제" 단계에 `🔁 반복` 배지 + "이번 회차: 6월 (결제 완료) · 다음: 7월 15일"
- 단계판 하단에 **회차 타임라인** (지난 회차 + 이번 회차 + 예정) — receiptsDue/청구 내역 재사용
- 프로젝트 status: 구독 활성 동안 "진행 중" 고정, 구독 종료 시 "완료"

## 6. 구현 Phase

| Phase | 범위 | 규모 |
|---|---|---|
| 2-A | 엔진: subscription invoice/tax_invoice 를 사이클 평가로 (completed 박제 제거 + next_due 계산) | 중 |
| 2-B | UI: 반복 배지 + 이번 회차/다음 예정 표시 | 중 |
| 2-C | ClientSubscription 연결 (구독형 프로젝트 ↔ 구독청구) + 회차 타임라인 | 중~대 |
| 2-D | 구독 종료 처리 (프로젝트 완료 전이) | 소 |

## 7. 미해결 결정 사항 (Irene 확인 필요)
- 구독형 프로젝트 생성 시 ClientSubscription 을 **자동 생성**할지, **기존 구독 연결**만 할지
- 세금계산서를 회차마다 강제 단계로 둘지, 한국 사업자 고객만 노출할지 (기존 receiptsDue 정책 따름)
- 회차 타임라인을 거래 탭에 둘지, 별도 "구독 현황" 섹션으로 둘지
