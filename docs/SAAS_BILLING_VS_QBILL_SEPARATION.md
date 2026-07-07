# SaaS 구독결제 vs Q Bill — 혼동 방지 canonical

> **작성 목적 (Irene 지시 2026-07-07):** PlanQ 플랫폼 구독 결제와 워크스페이스 Q Bill 청구가 **절대 혼동되지 않도록** 경계를 코드 수준에서 못박는다. 돈 무결성 문서 — **Fable 게이트 대상**.
> **현재 상태:** 카드/PG 미연동. **송금(무통장입금) 단일 수단.** 토스페이먼츠 보류(연동에 가입비 220,000+연관리비 110,000=첫해 330,000원+심사 요구 → 지금 결제 안 함). 카드 PG 연동 상세는 `SUBSCRIPTION_PAYMENT_DESIGN.md`(PortOne→토스로 교체 예정, 착수 보류).

---

## 0. 한 줄 요약

**두 개의 완전히 다른 결제가 있다. 테이블·계좌·발행주체·UI가 전부 다르며 서로 데이터를 읽거나 쓰지 않는다.**

| 축 | ① 플랫폼 SaaS 구독결제 | ② Q Bill (워크스페이스 청구) |
|----|----------------------|------------------------------|
| 돈 흐름 | **PlanQ → 워크스페이스** (구독료) | **워크스페이스 → 자기 고객** (용역 대금) |
| 저장 테이블 | `subscriptions` + `payments` | `invoices` + `invoice_items` + `invoice_installments` + `invoice_payments` |
| 입금 계좌 | **PlanQ 계좌** — `getPlanqBankInfo()` (`platform_settings` 우선, `.env` fallback) | **워크스페이스 계좌** — `Business.bank_name/bank_account_number/bank_account_name` |
| 세금계산서 | 공급자=**PlanQ**, 공급받는자=워크스페이스. `payments.tax_invoice_*` 컬럼. 발행=platform_admin | 공급자=**워크스페이스**, 공급받는자=고객. `invoices/installments` 세금계산서 필드. 발행=워크스페이스 owner |
| 백엔드 | `services/billing.js`, `routes/plan.js` | `routes/invoices.js`, `services/recurring_invoice.js` |
| 프론트 | 설정 → 플랜·구독 (`Settings/PlanSettings`, `Settings/CheckoutModal`) | Q Bill 메뉴 (`pages/QBill/*`, 공개 `PublicInvoicePage`) |
| 활성화 주체 | **platform_admin** 이 입금 확인 (`markPaymentPaid`) | **워크스페이스 owner** 가 결제 마킹 (`invoices mark-paid`) |

---

## 1. 불변식 (Invariants) — 위반 = 돈 사고

1. **SaaS 결제는 `invoices` 를 절대 쓰지 않는다.** `services/billing.js` 는 `Subscription`·`Payment` 만 생성. `payments.tax_invoice_*` 는 payments 컬럼이지 Invoice 아님. (검증: `grep -nE "\bInvoice[A-Za-z]*\b" services/billing.js` → Invoice 모델 식별자 0. 주의: `grep "Invoice"` 는 `tax_invoice_*` 컬럼명 7건에 오탐 — 그건 정상.)
2. **Q Bill 은 `payments`/`subscriptions` 를 절대 읽지 않는다.** `routes/invoices.js` 는 `Invoice*` 만 조회 → SaaS 결제는 Q Bill 목록·합계·매출통계에 **안 뜬다.**
3. **계좌 출처 교차 금지.** SaaS 체크아웃·이메일 = `getPlanqBankInfo()`(PlanQ) 만. Q Bill 공개 결제 = `Business.bank_*`(워크스페이스) 만. **한 화면이 반대쪽 계좌를 읽으면 = 버그.**
4. **세금계산서 발행주체 분리.** SaaS = PlanQ 가 공급자(홈택스에서 PlanQ 사업자로 발행). Q Bill = 워크스페이스가 공급자. admin 화면·상태필드 교차 금지.
5. **용어 경계.** SaaS UI = "구독 결제 / 플랜 결제 / 결제 안내". Q Bill = "청구서(invoice)". SaaS 화면에 Q Bill 연상 용어("청구서") 쓰지 않음.
6. **멀티테넌트.** 둘 다 `business_id` 스코프(소유 워크스페이스). 의미 동일하나 **조인/집계에서 두 테이블 군을 교차 조인하지 말 것.**

---

## 2. 현재 흐름 (송금 단일 수단)

1. owner 가 설정→플랜에서 플랜·주기 선택 → `POST /plan/:businessId/checkout` → `createPendingSubscription` → `Subscription`(pending) + `Payment`(pending).
2. 동시 `sendBillingInstructionEmail` → owner 이메일로 **금액(딱 얼마) + PlanQ 계좌(어떻게) + 입금자명 규칙(#결제ID)** 발송 (billing.js:112).
3. `CheckoutModal` 화면도 동일 안내 + 금액·PlanQ 계좌 **복사 아이콘 버튼**(§3).
4. owner 송금 후 "입금했어요" → `POST .../notify-paid` → "입금 확인 대기중" + platform_admin 알림. **owner 자가 활성화 불가.**
5. platform_admin 입금 확인 → `markPaymentPaid`(멱등·period·plan 동기화). 세금계산서 요청분 발행 마킹. 미입금 24h 후 자동 취소.

---

## 3. 복사 UX (2026-07-07) — Q Bill 패턴 재사용, 계좌만 PlanQ

- `CheckoutModal` `copy()`+`copyHit` = `QBill/PublicInvoicePage.tsx` 와 **동일 상호작용**(클립보드 + 1.5s "복사됨"). 아이콘 버튼(클립보드→체크).
- 복사 대상: **결제 금액**(숫자), **PlanQ 계좌번호**. 은행/예금주 행 분리.
- **재사용은 UX 패턴만.** 데이터는 SaaS 전용(`bankInfo` = `/plan/bank-info`). Q Bill `Business.bank_*` 안 읽음 ← 불변식 3.
- 이메일은 JS 불가 → 복사버튼 없음, 계좌·금액 명확 표기(기존 billingInstructionEmailHtml).

---

## 4. Fable 집중 검토 체크리스트

- [ ] SaaS 체크아웃/이메일이 워크스페이스 계좌(`Business.bank_*`)를 실수로 읽지 않는가?
- [ ] Q Bill 목록/통계/합계 쿼리에 `payments`/`subscriptions` 가 섞이지 않는가?
- [ ] SaaS 세금계산서(`payments.tax_invoice_*`)와 Q Bill 세금계산서가 admin 화면·상태에서 안 섞이는가?
- [ ] `CheckoutModal` 이 복사하는 계좌·금액이 SaaS Payment 값(PlanQ)인가?
- [ ] `business_id` 조인이 두 테이블 군을 교차 조인하지 않는가?
- [ ] 프론트 카피에 "청구서" 등 Q Bill 연상 용어로 SaaS 를 표기하지 않는가?
- [ ] SaaS 매출이 Insights/통계(워크스페이스 매출)에 오염되지 않는가? → **경계 인접 파일 재점검 필수**: `services/stats.js`(워크스페이스 매출은 `InvoicePayment` 만 집계, SaaS `Payment`/`Subscription` 금지) · `routes/dashboard.js`(유일한 양세계 접점 — `collectPlanqSubscription` 은 Subscription 만, `collectPaymentNotifies` 는 Invoice 만, 금액 합산에 섞지 말 것).

> **Fable 검토 결과 (2026-07-07): SEPARATION SOUND — 데이터 누수 0.** 7항목 전부 CONFIRMED-SEPARATE. LOW 3건(문구·주석: CheckoutModal 주석 "워크스페이스 계좌"→PlanQ, 이메일·payDue "관리자"→"PlanQ 운영팀", payDue.title "청구"→"구독")는 이 커밋에서 수정 완료.

관련: `SUBSCRIPTION_PAYMENT_DESIGN.md`(PG 연동, 토스로 교체·보류), 메모리 `project_subscription_payment_plan`·`project_self_billing`·`project_bill_reporting_plan`.
