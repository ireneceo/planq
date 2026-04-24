# PlanQ 통합 아키텍처 (Integrated Architecture)

> **이 문서는 PlanQ 전체 시스템의 최상위 지도다.** 과금·템플릿·자동화·권한이 서로 어떻게 연결되는지를 한 장에 담는다.
> 개별 상세는 하위 문서에 위임:
> - `docs/TEMPLATE_SYSTEM_SPEC.md` — 템플릿 시스템
> - `docs/RECURRING_AUTOMATION_SPEC.md` — 반복/정기 자동화
> - `docs/PLATFORM_BILLING_SPEC.md` — 플랫폼 구독 결제
> - `docs/Q_BILL_SPEC.md` — 워크스페이스→고객 청구
> - `docs/PERMISSION_MATRIX.md` — 역할·권한
> - `docs/UNIFIED_CONTEXT_DESIGN.md` — 고객/멤버 360° (Phase 9)
>
> 작성: 2026-04-24 · 상태: 최상위 지도 확정

---

## 1. 시스템 계층 (4 Layer)

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 4: AI Layer                                                │
│   Cue (대화·답변·요약·이슈·업무 추출) · Q Note (STT·번역·RAG)    │
│   Engine: OpenAI gpt-4.1-nano / gpt-4o-mini · Deepgram STT       │
└──────────────────────────────────────────────────────────────────┘
                              ▲ 사용량 한도
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: Billing & Subscription Layer                            │
│   두 방향의 과금이 공존:                                          │
│   (A) PlanQ → 워크스페이스 — 플랫폼 구독 (내향)                   │
│   (B) 워크스페이스 → 고객  — Q Bill (외향)                        │
│   공통 PG: 포트원 V2 · Stripe · 팝빌 세금계산서                   │
└──────────────────────────────────────────────────────────────────┘
                              ▲ 결제/정산
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: Automation Layer                                        │
│   Cron (매일 03:00 KST) · rrule 스케줄러 · Webhook 수신 · 업무    │
│   자동 생성 · 구독 자동 청구 · 리포트 자동 생성                   │
└──────────────────────────────────────────────────────────────────┘
                              ▲ 트리거
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: Entity & Context Layer                                  │
│   Workspace · Member · Client · Project · Task · Invoice · File │
│   Template (어떤 엔티티든 템플릿으로 생성 가능)                   │
└──────────────────────────────────────────────────────────────────┘
```

**원칙**: 아래 레이어는 위 레이어를 알지만, 위는 아래를 모른다. Entity 가 먼저 있고, Automation 이 Entity 를 흔들고, Billing 이 그것을 금액으로 환산하고, AI 가 가치를 더한다.

---

## 2. 과금 2축 — 내향 vs 외향

**PlanQ 는 두 방향 결제가 공존하는 매우 드문 SaaS.** 사용자 혼동을 막기 위해 UI·DB·용어·권한 모두 분리한다.

| 축 | 방향 | DB | UI 위치 | 담당 시스템 | 수취 계정 |
|---|---|---|---|---|---|
| **내향** (Subscription) | PlanQ → 워크스페이스 | `businesses.plan`, `business_plan_history`, `contact_inquiries`(enterprise), (Phase 6) `platform_billings`, `platform_billing_keys` | **설정 > 구독 플랜** | `config/plans.js` + 포트원(PlanQ 계정) | **PlanQ 법인** |
| **외향** (Q Bill) | 워크스페이스 → 고객 | `quotes`, `invoices`, `invoice_payments`, `bill_events` | **Q Bill 메뉴** (최상위) | Q Bill + 포트원(워크스페이스 개별 계정) | **워크스페이스 법인** |

### 2.1 공통점
- 포트원 V2 SDK 사용
- 팝빌 세금계산서 연동
- 한국=토스, 해외=Stripe 분기 로직

### 2.2 결정적 차이
| 항목 | 내향 | 외향 |
|---|---|---|
| 포트원 `store_id` | PlanQ 법인 1개 | 워크스페이스 각자 (`businesses.portone_store_id`) |
| 팝빌 `link_id` | PlanQ 법인 1개 | 워크스페이스 각자 (`businesses.popbill_link_id`) |
| 과금 주체 | PlanQ 가 받음 | 워크스페이스가 받음 |
| 세금계산서 발행인 | PlanQ 법인 | 워크스페이스 법인 |
| 관리자 | `platform_admin` | 워크스페이스 `owner` |
| 실패 grace | 7일 후 Free 다운그레이드 | 청구서 `overdue` 상태만 (서비스 중단 아님) |

### 2.3 UI 용어 고정 (다국어 혼동 방지)
- 내향 = **"구독 플랜 / Subscription"** (ko/en 양쪽 합의 완료, Phase 1.1)
- 외향 = **"Q Bill"** (브랜드 고유명사 — 번역 X)
- 내부 문서에서만 `internal: subscription`, `external: qbill` 구분 코드 사용

---

## 3. 템플릿 시스템 — 모든 엔티티가 템플릿 가능

**원칙**: 프로젝트·테이블·견적·청구·구독은 전부 템플릿으로 시작 가능하다. **한 테이블(`templates`) + kind 로 통합**한다. 상세는 `TEMPLATE_SYSTEM_SPEC.md`.

```
templates
  ├─ kind: project_schedule  → 새 프로젝트 생성 시 (마일스톤·업무 자동)
  ├─ kind: process_table     → Q Project 테이블 탭 구조 프리셋
  ├─ kind: quote             → 견적서 품목·문구 프리셋
  ├─ kind: invoice           → 청구서 품목·문구 프리셋
  ├─ kind: subscription      → 정기 구독 상품 (월정액·제공 범위)
  ├─ kind: meeting_agenda    → Q Note 회의 안건 프리셋
  └─ kind: email_signature   → Q Mail 서명 (Phase 9)
```

### 3.1 scope 3단계
- `system` — **PlanQ 기본 제공** (직군별 프리셋: 웹사이트 제작 12주 / 브랜딩 6주 / 앱 제작 16주 / 영상 제작 4주 / 마케팅 캠페인 8주). 누구나 복제 가능, 수정 불가.
- `workspace` — 워크스페이스 공용 (owner/PM 만 편집, 멤버는 사용)
- `user` — 개인 초안 (본인만)

### 3.2 템플릿 → 자동화 연결
```
Project 생성 시 템플릿 선택
  → content.milestones 를 project.start_date 기준으로 날짜 계산
  → content.tasks 를 Task 레코드로 생성 (due_date·assignee 매핑)
  → content.recurring (있으면) → recurring_tasks 레코드로 등록
```

---

## 4. 반복/정기 자동화 — rrule + cron

상세: `RECURRING_AUTOMATION_SPEC.md`. 요약:

### 4.1 입력
- `recurring_tasks` (신규) — `rrule_str`, `project_id`, `assignee_user_id`, `template_task_id`, `next_fire_at`, `is_active`
- `projects.billing_type='subscription'` + `monthly_fee`
- `subscription_cycles` (신규) — 구독 고객별 청구 주기 상태

### 4.2 엔진
- **Cron 매시간** — `next_fire_at <= NOW()` 인 `recurring_tasks` 를 `tasks` 로 생성, 다음 `next_fire_at` 계산 후 저장
- **Cron 매일 03:00 KST** — 오늘이 청구일인 구독 프로젝트에 대해 Q Bill 자동 청구서 발행 → 포트원 자동 결제 시도

### 4.3 실패 처리
- 업무 자동 생성 실패 → AuditLog + 다음 hour 에 재시도 (최대 3회) → 실패 시 `is_active=false` + 워크스페이스 오너에게 알림
- 구독 청구 실패 → Q Bill `invoice.status='overdue'` + 고객에게 이메일 + 3일 후 재시도

### 4.4 구독 해지 정책 (Irene 확정)
- 해지 시점까지 이미 생성된 업무는 **보존**
- 해지 이후 예정이던 다음 반복은 **생성 중지**
- 미수금은 그대로 `overdue` 유지 (결제 재시도 중단)

---

## 5. 플랫폼 구독 결제 — Phase 6 상세

상세: `PLATFORM_BILLING_SPEC.md`. 요약:

- 2026-04-24 옵션 C 합의 (hybrid per-seat)
- 포함 seat / 추가 seat 과금 / 고객 한도 / AI 초과 시 차단+업그레이드 제안
- 포트원 V2 빌링키 기반 월 자동 결제
- 실패 시 3회 재시도 → grace 7일 → Free 다운그레이드 + 읽기 전용 30일
- 해외 워크스페이스(business.country ≠ 'KR') → Stripe

---

## 6. Phase 매핑 — 무엇이 언제 만들어지는가

| Phase | 기간 | 주요 산출물 | 관련 문서 |
|---|---|---|---|
| 0 | 1주 | DB 스키마 (businesses·clients·projects·business_members·invoices 확장 + 7 신규 테이블 + permissions) | ✅ 완료 |
| 1 | 3주 | **Q Bill 견적·청구·결제** + 견적/청구 **템플릿**(kind=quote/invoice) | Q_BILL_SPEC, TEMPLATE_SYSTEM |
| 2 | 0.5주 | 세금계산서 자동화 (팝빌) | Q_BILL_SPEC §4.5 |
| 3 | 1주 | 프로젝트 Bill 탭 + 시간기반 자동청구 + **project_schedule / process_table 템플릿** + **구독 프로젝트 자동 청구·반복 업무** | Q_BILL_SPEC §5, TEMPLATE_SYSTEM, RECURRING_AUTOMATION |
| 4 | 2주 | 통계 대시보드 5 + 자동해석 | FINANCIAL_REPORTS_SPEC |
| 5 | 1주 | 월간 보고서 자동 생성 + PDF | FINANCIAL_REPORTS_SPEC §5 |
| 6 | 1.5주 (0.5 → 확대) | **플랫폼 구독 빌링키 + per-seat 추가 과금 + 관리자 대시보드** | PLATFORM_BILLING_SPEC |
| 7 | 0.5주 | 운영서버 배포 | (스크립트 기존) |
| 8 | 1주 | 반응형 스프린트 | DEVELOPMENT_PLAN §Phase 8 |
| 9 | 9주 (M0~M4) | 통합 컨텍스트 360° + Q Mail + AI 엔진 | UNIFIED_CONTEXT_DESIGN |
| 10+ | — | 템플릿 마켓플레이스 (장기 비전, 지금 기획 스킵) | — |

---

## 7. 기술 스택 고정표 (중복 결정 방지)

| 영역 | 선택 | 이유 / 근거 |
|---|---|---|
| 국내 PG | **포트원 V2 Starter** | 월 5천만 미만 무료 · 토스/카카오/네이버페이 통합 |
| 해외 PG | **Stripe** | 포트원 연동 가능 · 한국 SaaS 해외 청구 표준 |
| 세금계산서 | **팝빌** | API · 국내 표준 |
| STT | **Deepgram** | Nova-3 · multilingual · 한국어 정확도 |
| LLM 기본 | **gpt-4.1-nano** | 단순 분류·짧은 생성 |
| LLM 고급 | **gpt-4o-mini** | 요약·업무 추출 |
| 임베딩 | **text-embedding-3-small** | Q Talk KB · Q Note RAG 공통 |
| 스케줄러 | **node-cron** (구조) + `services/task_snapshot.js` 패턴 | 이미 Phase 0 이전부터 있는 방식 재사용 |
| 반복 규칙 | **rrule** (이미 package.json 에 포함) | iCalendar 호환 표준 |
| 큐/잡 | **없음 (Phase 10 까지)** | 초기엔 setTimeout + cron 으로 충분. Redis BullMQ 는 Stage 2 (500 biz+) 때 |

---

## 8. Irene 확정 결정 (이 문서로 락)

| # | 질문 | 결정 | 날짜 |
|---|---|---|---|
| 1 | 플랫폼 과금 모델 | **옵션 C 하이브리드** (포함 seat 평플랜 + 초과 시 추가 seat 과금) | 2026-04-24 |
| 2 | AI 한도 초과 동작 | **차단 + 업그레이드 제안 모달** | 2026-04-24 |
| 3 | 고객 한도 | 폐지하지 않음. **Basic 50 / Pro 200** 타이트하게 재설정 | 2026-04-24 |
| 4 | 포함 seat 수 | **Free/Starter 1 · Basic 5 · Pro 15** | 2026-04-24 |
| 5 | Starter 멤버 추가 | **불가** (1인 프리랜서 전용, 팀이면 Basic 업그레이드) | 2026-04-24 |
| 6 | 시스템 기본 템플릿 제공 | **제공** (직군별 5~7종) | 2026-04-24 |
| 7 | 템플릿 버전 관리 | **스냅샷** (생성된 엔티티는 영향 없음 · 템플릿 수정은 신규에만) | 2026-04-24 |
| 8 | 구독 업무 자동 생성 타이밍 | **매월 정해진 날짜 독립** (결제 실패해도 생성, grace 끝나면 중지) | 2026-04-24 |
| 9 | 구독 해지 시 기존 업무 | **보존** (완료되지 않은 것도 유지) | 2026-04-24 |
| 10 | Starter 자동 결제 | **O** (₩9,900 도 빌링키) | 2026-04-24 |
| 11 | 다운그레이드 적용 시점 | **현 결제 주기 종료 시점** | 2026-04-24 (기존 유지) |
| 12 | 해외 vs 국내 PG 분기 | **워크스페이스 대표 `country`** 기준 (카드 국가 무관) | 2026-04-24 |
| 13 | 템플릿 마켓플레이스 | **Phase 10+** (지금 기획 스킵) | 2026-04-24 |

> 이후 추가 결정은 이 테이블에 한 줄씩 기록. **구현 중 헷갈리면 이 표를 본다.**

---

## 9. UX 의 3대 일관성 약속 (전 Phase 공통)

설계 문서 작성 중 자주 놓칠 수 있어 여기 명시:

1. **템플릿 진입점은 "만들기" 버튼 옆에 항상 존재** — 새 프로젝트 · 새 견적 · 새 청구서 모두 `[템플릿에서 시작] / [빈 것부터]` 선택이 첫 화면.
2. **자동 생성된 것은 AI 배지 + 되돌리기** — `recurring_tasks` 가 만든 업무, `subscription_cycles` 가 만든 청구서 모두 "자동 생성" 배지 + "이번만 취소 / 반복 중지" 메뉴.
3. **과금 계산은 항상 미리보기** — seat 추가 · 플랜 변경 · 구독 청구 모두 **결제 전 금액 확인 모달** 필수. "얼마 나갈지 몰라서 못 누르는" 상태 금지.

---

## 10. 다음 단계 (문서 작성 후)

1. 본 문서 + 하위 4개 문서 (Template / Recurring / Platform Billing / Q Bill 확장) 작성 완료
2. `config/plans.js` 옵션 C 재설계 (Phase 1.3 이어서)
3. Phase 1 (Q Bill) 진입 시 Template + Quote/Invoice 스펙을 동시에 구현
4. Phase 3 에서 Recurring + Subscription Cycle 구현
5. Phase 6 에서 Platform Billing 구현

---

## 11. 변경 이력

| 날짜 | 버전 | 요약 |
|---|---|---|
| 2026-04-24 | 1.0 | 최상위 통합 지도 초판 · 과금 2축 분리 · 템플릿 통합 · 자동화 레이어 · Phase 매핑 · Irene 결정 13개 락 |
