# 수정세금계산서 · 증빙 취소 흐름 설계 (RECEIPT_CORRECTION_DESIGN)

> 작성: 2026-06-13 · 대상: Q Bill 증빙(세금계산서/현금영수증) 발행 후 정정·취소
> 전제: PlanQ 는 홈택스/팝빌 **자동 발행을 하지 않는다**(운영 실시작 시 도입 — `project_billing_automation_scope`).
> 따라서 이 설계는 **"외부에서 수정발행/취소한 사실을 추적·기록·상태반영"** 하는 *마킹 추적* 시스템이다.
> 발행 마킹(세금계산서/현금영수증) 패턴과 정확히 대칭으로 설계해 코드·UX 일관성을 유지한다.

---

## 1. 문제 정의 (현재 갭)

발행 마킹은 완비됨(단건/분할 × 세금계산서/현금영수증 4조합 + 고객통지 + 기한큐). 그러나 **발행 후 거래가 바뀌는 경우**가 dead-end:

- 현재: 청구서 취소(PATCH status→canceled) 시 발행된 증빙 있으면 owner/admin 에 "수정/취소 필요" 알림 + AuditLog `invoice.receipt_correction_needed` 발생 — **여기서 끝.**
- 누락: ① 수정을 **실제로 했는지** 추적 없음 ② 수정세금계산서(음의 계산서) 번호·작성일·금액 **기록 없음** ③ 취소된 청구서에 'issued' 마크가 **그대로 잔존**(증빙 큐·records 부정확) ④ 고객에게 수정 사실 통지 없음 ⑤ 취소뿐 아니라 **금액변동·반품·기재착오** 등 다른 수정사유는 시작점조차 없음.

**사용자(발행자) 실제 니즈:** "세금계산서를 발행했는데 거래가 바뀌었다(취소·환불·금액변동·오타). 홈택스에서 수정세금계산서를 발행했다. PlanQ가 (a) 필요함을 알려주고 (b) 내가 한 걸 기록하게 하고 (c) 증빙 큐·거래내역이 정정된 상태로 정확히 보이게 해달라."

---

## 2. 도메인 — 한국 부가세법 수정세금계산서 (정확성 핵심)

부가세법 시행령 §70: **수정세금계산서 발급사유 6종**, 각각 발급방법·작성일자·금액부호가 다르다. PlanQ는 이를 **6 사유코드**로 모델링하되 SaaS B2B 실무에 맞춰 라벨링한다.

| 사유코드 | 법적 사유 | 발급방법 | 작성일자 | 금액부호 | 비고 |
|---|---|---|---|---|---|
| `clerical` | 기재사항 착오·정정 | 당초분 음(-) 1장 + 정확분 정(+) 1장 (2장) | **당초 작성일** | -전액 후 +정확액 | 오타·상호·번호 오기 |
| `amount_change` | 공급가액 증감 | **증감분만** 1장 (±) | 변동 사유 발생일 | ± delta | 단가 조정·할인 추가 |
| `return` | 환입(반품) | 환입금액만큼 음(-) | 환입된 날 | -부분액 | 일부/전부 반품 |
| `cancel` | 계약의 해제 | 전액 음(-) 1장 | 계약 해제일 (비고에 당초 작성일) | -전액 | 청구서 취소의 주 경로 |
| `duplicate` | 착오 이중발급·잘못된 수신자 | 음(-)로 취소 | 당초 작성일 | -전액 | 중복·오발행 |
| `other` | 내국신용장 사후개설·영세율 사후 등 | 사유별 | 사유별 | 사유별 | 드묾(catch-all) |

**현금영수증 취소:** 별도 사유 분류 없음. 홈택스/단말기에서 **취소거래**(원 승인번호 기준 음(-) 승인) 1건. PlanQ는 `kind='cash'` + 취소 승인번호로 단순 기록.

**기한·가산세:** 수정세금계산서도 사유발생일 익월 10일까지 발급 권장(지연 시 가산세). 큐에서 기한 노출(발행 큐와 동일 urgency 로직 재사용).

> ⚠️ PlanQ는 위 발급방법을 **자동 수행하지 않는다.** owner가 홈택스에서 직접 발급 후 **발행번호를 마킹**한다. 설계의 책임은 "사유에 맞는 작성일자·부호를 *안내*하고, 발급 결과를 *기록*"하는 것.

---

## 3. 데이터 모델 — `receipt_corrections` (신규 테이블)

기존 발행 필드(Invoice/InvoiceInstallment의 tax_invoice_*, cash_receipt_*)는 **원 발행 기록**으로 유지. 수정은 그것을 **참조하는 별도 이벤트**다. 단일 컬럼 덮어쓰기(Option A) 대신 **전용 이력 테이블(Option B)** 채택 — 이유: ① 컴플라이언스 감사엔 *전체 정정 이력*이 필요(덮어쓰면 원본 소실) ② 한 증빙이 여러 번 정정될 수 있음(드물지만 amount_change 반복) ③ 거래내역·통계가 정정을 1급 이벤트로 조회.

```
receipt_corrections
  id                 BIGINT PK
  business_id        INT  FK businesses (멀티테넌트 격리)
  invoice_id         INT  FK invoices (항상)
  installment_id     INT  FK invoice_installments NULL (분할 회차 정정이면)
  kind               ENUM('tax','cash')                  -- 세금계산서/현금영수증
  reason             ENUM('clerical','amount_change','return','cancel','duplicate','other')
  original_no        VARCHAR(50)   -- 당초 발행/승인 번호 (snapshot)
  corrected_no       VARCHAR(50)   -- 수정세금계산서 발행번호 / 현금영수증 취소 승인번호
  written_at         DATE          -- 수정 작성일자 (사유별 규칙)
  amount_delta       DECIMAL(15,2) -- 증감액 (cancel/return/duplicate 는 음수, amount_change 는 ±)
  currency           VARCHAR(3)
  customer_note      VARCHAR(300) NULL  -- 고객 안내용 사유 메모(선택)
  marked_by          INT FK users
  customer_notified_at DATETIME NULL
  created_at / updated_at
  INDEX (business_id, invoice_id), (kind, reason)
```

**원 증빙의 "유효 상태"는 파생**한다(컬럼 추가 X). `receiptsDue`/serializer에서:
- 원본 issued + 해당 (invoice|installment, kind)에 correction 존재 → effective `corrected`
- reason='cancel'|'duplicate' 의 -전액 → effective `canceled`
- reason='amount_change'|'return' → effective `amended`(부분), 잔액 표시

> sync-database 가 신규 테이블·컬럼 자동 생성(ENUM 아닌 신규 테이블이라 CREATE — 운영 deploy sync_database 가 처리). 운영 반영 후 `SHOW TABLES LIKE 'receipt_corrections'` 검증.

---

## 4. 상태·트리거

### 트리거 (수정이 필요해지는 지점)
1. **청구서 취소** (PATCH status→canceled, 기존) — 발행된 증빙 있으면 → `cancel` 사유 후보로 "수정 필요" 큐 항목 생성(기존 notify를 큐 항목으로 승격).
2. **회차 취소** (installment cancel) — 해당 회차 발행분 있으면 동일.
3. **수동 시작** — owner가 발행완료된 증빙의 드로어/큐에서 "수정·취소 발행" 직접 시작(금액변동·반품·오타는 취소 아니므로 이 경로).

### 증빙 큐(receiptsDue) 통합
- 기존 행: `pending`(미발행) / `issued`(발행완료).
- 추가: 발행완료 행 중 **"수정 필요"** 상태(트리거 발생 + 아직 미정정) → `correction_pending` urgency(빨강), 큐 상단. 정정 완료 → `corrected`(회색, 음의번호 표시).

---

## 5. 흐름 (마킹 추적)

```
[발행완료 증빙] --(거래 변경)--> 트리거 → 큐에 "수정 필요" 노출
   owner "수정·취소 발행" 클릭
   → 사유 선택 (clerical/amount_change/return/cancel/duplicate/other)
   → 사유별 안내: 작성일자 기본값·금액부호·발급방법 1줄 가이드 (법적 정확)
   → owner 홈택스에서 외부 발행 (PlanQ 자동발행 X)
   → 수정세금계산서 발행번호(음) + 작성일자 + 증감액 입력 → 저장
   → receipt_corrections insert + 원본 effective 상태 파생 갱신
   → AuditLog(invoice.receipt.correction) + 멤버 알림 + 고객 통지 메일(sendReceiptCorrectionEmail)
   → 큐/거래내역/InvoiceDetailDrawer 정정 반영
```

---

## 6. API (발행 마킹과 대칭)

| 메서드·경로 | 설명 | 가드 |
|---|---|---|
| `POST /api/invoices/:biz/:id/corrections` | 단건 증빙 수정·취소 마킹 (body: kind, reason, corrected_no, written_at, amount_delta, customer_note) | owner_only(`assertInvoiceMutationOwner`) + checkBusinessAccess |
| `POST /api/invoices/:biz/:id/installments/:instId/corrections` | 회차 증빙 수정·취소 | 동일 |
| `GET /api/invoices/:biz/:id/corrections` | 해당 청구서 정정 이력 | read |
| (확장) `receipts-due` | effective 상태(corrected/canceled/correction_pending) 포함 | 기존 |

- audit action: `invoice.receipt.correction` / `invoice.installment.receipt.correction`
- broadcast: `inbox:refresh` (큐·대시보드 실시간)
- 고객 통지: `emailService.sendReceiptCorrectionEmail` (emailWrap+발신전용, "수정세금계산서가 발행되었습니다" / "현금영수증이 취소되었습니다", 공개링크). 수신자 resolve 는 발행 통지와 동일 우선순위.

---

## 7. UI

- **TaxInvoicesTab(증빙 큐)**: `correction_pending` 행 빨강 뱃지 "수정 필요" + "수정·취소 발행" 버튼 → CorrectionModal. `corrected`/`canceled` 행은 회색 + 음의번호 + 사유 라벨.
- **CorrectionModal**(신규, IssueModal 자매): 사유 셀렉트(PlanQSelect) → 사유별 안내 박스(작성일자/부호/발급방법) + 발행번호 + 작성일(SingleDateField) + 증감액 + 고객메모. 사유 변경 시 기본값 자동 prefill. 중복제출 가드.
- **InvoiceDetailDrawer**: 증빙 섹션에 "정정 이력"(원 발행 → 수정세금계산서 음의번호, 사유, 작성일) 표시 + 발행완료 증빙에 "수정·취소 발행" 액션.
- i18n: `qbill.corrections.*` ko/en (사유 라벨 6종 + 사유별 안내문 + 모달).

---

## 8. 스코프 경계 (30년차 — 안 만드는 것 명시)

- ❌ 홈택스/팝빌 자동 발급 — 운영 실시작 때(`project_billing_automation_scope`). 지금은 마킹.
- ❌ 수정세금계산서 PDF 생성 — 원 청구서 PDF로 충분, 정정은 기록. 추후.
- ❌ `other`(내국신용장 사후개설·영세율 사후) 정교화 — catch-all 자유입력. 거의 미발생.
- ❌ 자동 금액 재계산/회계 분개 — delta 는 사용자 입력(외부 발행값 그대로). PlanQ는 진실원천 아님.

---

## 9. 검증 계획

- 헬스 29/29 + 빌드 EXIT0.
- E2E: 사유 6종 마킹 → receipt_corrections insert + effective 상태 파생(cancel→canceled, amount_change→amended) · owner_only 403 · 멀티테넌트 403 · 고객 통지 EmailLog · 큐 correction_pending→corrected 전이 · 취소 트리거→큐 노출.
- 운영 옛 데이터: 정정 이력 없는 기존 issued 증빙은 effective='issued' 그대로(파생 로직 backward-compat).
- 운영 DB: `receipt_corrections` 테이블 생성 확인.

---

## 10. 단계 (Phasing)

- **Phase 1 (이번 사이클, 권장):** 테이블 + 단건/회차 corrections 라우트 + receiptsDue effective 상태 + CorrectionModal + 큐 표시 + 고객 통지 + 취소 트리거 큐 승격. (사유 6종 전부, 마킹 추적 완결)
- **Phase 2 (추후):** 정정 이력 PDF, 통계(insights) 정정 반영, 팝빌 자동 발급 연동.

핵심 원칙: **발행 마킹 패턴과 100% 대칭** — receiptsDue 단일원천·owner_only·고객통지·실시간·i18n 모두 기존 인프라 재사용.
