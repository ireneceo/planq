# 세금 설정·표기 설계 (초안 v0 — Fable 설계 판정 전, 구현 0줄)

> 2026-10-23 · [Opus] 초안 · 정찰 계획 `.claude/plans/qmvkqa1g7.md`(HEAD 8a8ff401) 를 HEAD e58cde8c 로 다시 대조함.

## 0. 요청 (Irene 원문)
> 정기구독 추가하고 청구서랑 연결하고 하는 모든 경로에 세금이 별도인지 안나오잖아. 이거 세금이 %가 나라마다 다르지 않아?
> % 세팅하게 해서 세금 받는지 안받는지 설정 나오게 해야지. 그리고 금액 다 그렇게 표시되게 세금포함인지 세금불포함인지
> 표시를 이름이랑 항목에서 명확히 해줘야 해.

요구 세 가지: ① 세율 % 를 자유롭게 ② 세금을 받는지/안 받는지 켜고 끄기 ③ 모든 금액 이름·항목에 «세금 포함/불포함».

## 1. 지금 (사실, HEAD e58cde8c)

### 세율 칸 — 네 곳, 단위 둘
| 곳 | 칸 | 단위 | 화면 |
|---|---|---|---|
| 워크스페이스 기본 | `businesses.default_vat_rate` DECIMAL(4,3) | 분수 0.1 | Q Bill 설정 `SettingsTab.tsx:376` — 0%/10% 선택만 |
| 고객 정기구독 | `client_subscriptions.vat_rate` DECIMAL(5,2) | **퍼센트 10** | 폼이 안 보냄 → 서버 10 고정(`routes/client_subscriptions.js:118`, 워크스페이스 기본값 무시). PATCH 151 범위검사 없음 |
| 청구서 | `invoices.vat_rate` DECIMAL(4,3) | 분수 | 새 청구서 `NewInvoiceModal.tsx:950` 0/10 선택 |
| 문서 청구 조건 | `posts` 청구 조건 `vat_rate` | 분수 | `BillingTermsModal.tsx:208` 0/10 선택 |
| 프로젝트 월정액 | `projects.monthly_fee` (세율 칸 없음) | — | 엔진이 워크스페이스 기본값 사용 |

### 금액 공식 — 여섯 벌, 전부 «입력 = 공급가, 세금은 위에 더함»
| # | 곳 | 비고 |
|---|---|---|
| F1 | `services/invoiceCreate.computeAmounts` (청구서 POST · 문서 청구 조건 → 초안 `contractBilling`) | 항목 합 → `tax = round(sub × r)` |
| F2 | `routes/invoices.js` PUT ~1325 (항목 교체 재계산) | F1 과 같은 식을 손으로 한 벌 더 |
| F3 | `routes/invoices.js` 복사 ~772 | 같은 식 또 한 벌 |
| F4 | `services/clientSubscriptionBilling.js:123-128` | `r/100` (퍼센트 칸) |
| F5 | `services/recurring_invoice.js:81-84` (프로젝트 월정액) | 워크스페이스 기본 |
| F6 | 화면 `pages/QBill/InvoiceLinesEditor.invoiceTotalsOf` (새 청구서·문서 청구 조건 창) | 서버 F1 과 같은 식(반올림 규칙 맞춤) |
분할 회차는 `grand_total × percent` — 세금 방식과 무관(그대로).

### 표기 결함
1. ~~청구서 목록 `grand_total` 옆 «VAT 별도» 거짓~~ — **이 방에서 고침**(세액>0 → «VAT 포함», 0 → «VAT 없음», 통화 무관).
2. 구독 폼 «부가세 10%가 자동으로 더해져» 10 이 글자에 박힘(`ClientSubscriptions.tsx:182`).
3. 구독 카드 금액 = 공급가인데 표기 없음, 실제 청구액 안 보임.
4. 프로젝트 «월 청구액»(`TransactionsTab.tsx`) 공급가인데 표기 없음.
5. 서버 세율 범위검사 없음(구독 POST/PATCH · 청구서 POST/PUT).

## 2. 제안

### D1. 설정 모델
- `businesses.tax_enabled` BOOLEAN NOT NULL DEFAULT true — 끄면 새 구독·청구서·월정액의 기본 세율 0 + 방식 `none`, 화면에서 세율 칸 숨김.
- `businesses.default_vat_rate` 를 **자유 입력 % (0~100, 소수 2자리)** 로. 저장 단위는 분수 그대로 두되 DECIMAL(4,3) → **DECIMAL(7,6)** 로 넓힘(예 8.25% = 0.0825 를 담으려면 소수 4자리 필요. 넓히기만 — 기존 값 불변).
  같은 넓히기: `invoices.vat_rate` DECIMAL(4,3) → DECIMAL(7,6). `client_subscriptions.vat_rate`(퍼센트 DECIMAL(5,2)) 는 이미 8.25 를 담음.
- `businesses.tax_label` VARCHAR(20) NULL — 세금 이름(부가세·VAT·GST·消費税…). NULL 이면 화면 언어 기본(ko «부가세» / en «VAT»).
- `businesses.default_tax_mode` ENUM('exclusive','inclusive') DEFAULT 'exclusive' — 금액을 적을 때 기본 기준.
- 스냅샷 `tax_mode` ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive' — `invoices` · `client_subscriptions` · `projects`(월정액용) 각각.
  «세금 없음» 은 방식이 아니라 **세율 0** 으로 표현(세금 끔 = 이후 만드는 것의 기본 세율 0). 방식과 세율 0 이 겹치면 표기는 «세금 없음» 하나로.
- `projects.monthly_vat_rate` DECIMAL(7,6) NULL — NULL 이면 지금처럼 워크스페이스 기본값(옛 행 동작 불변).

### D2. 단위 — 데이터 변환 안 함
`client_subscriptions.vat_rate` 만 퍼센트다. 운영 데이터를 분수로 바꾸면 되돌리기 어렵고 얻는 것이 없다.
→ **저장 단위는 그대로, 변환은 한 함수** `services/taxCalc.rateFraction(value, unit)` 에서만. API 는 지금 단위 그대로(구독 = 퍼센트, 나머지 = 분수). 화면은 언제나 % 로 보여 주고 받는다(`utils/taxCalc.ts`).

### D3. 금액 공식 — 한 함수
`services/taxCalc.js` (+ 화면 `utils/taxCalc.ts` 같은 식, 검산 스크립트가 둘을 같은 사례로 돌림):
```
splitTax({ amount, rate /*분수*/, mode, currency }) → { subtotal, tax, total }
  exclusive: subtotal = round(amount); tax = round(subtotal × rate); total = subtotal + tax   ← 지금과 같은 결과
  inclusive: total = round(amount);    subtotal = round(total / (1 + rate)); tax = total − subtotal
  rate 0   : tax 0, subtotal = total = round(amount)
```
- inclusive 에서 **합계 = 적은 금액**(세액이 반올림 차를 흡수). 한국 세금계산서는 공급가액+세액=합계만 맞으면 됨.
- 청구서 항목: inclusive 이면 항목 단가·금액은 **적은 그대로(세금 포함)** 저장하고, 항목 합 = `total`, 역산은 **청구서 합계 한 번**(항목별 역산 안 함 — 항목별로 하면 합계가 1원 어긋난다).
  `invoice_items.amount` 의 뜻이 방식에 따라 달라진다 → 표 머리 «단가(세금 포함)/(세금 별도)» 로 반드시 드러냄. PDF·공개 페이지·상세 동일.
- F1~F6 을 모두 이 함수로. F2·F3 의 손 복사본은 `computeAmounts` 로 합침(동작 같음).

### D4. 기존 데이터·운영
- 마이그레이션 `scripts/migrate-tax-mode.js`(멱등, 배포 슬롯): 칸 추가 + DECIMAL 넓히기. 기존 행 = exclusive · 세율 그대로 → **옛 청구 금액 0원 변화**(검증: 운영 옛 청구서 subtotal/tax/grand 해시 전후 대조).
- 백필 없음.

### D5. 세금 끔의 뜻
- 워크스페이스 `tax_enabled=false` → 새로 만드는 구독·청구서·월정액 기본 세율 0, 세율 칸 숨김(대신 «세금 받지 않음 — 설정에서 켜기»).
- **이미 있는 구독·월정액 세율은 바꾸지 않는다**(스냅샷). 단 프로젝트 월정액 중 `monthly_vat_rate NULL`(워크스페이스 기본 따라감)은 끔이 곧 0 — 이건 지금 동작(기본값 따라감)과 같다. → 끌 때 «기존 구독 N개는 지금 세율 그대로 청구됩니다» 안내.
- 한국 증빙(세금계산서·현금영수증, `receiptsDue`)은 세액 0 이어도 판정 그대로(면세 계산서는 이번 범위 밖).

### D6. 표기 (ko/en)
- 모든 금액 라벨 끝에 기준: «청구 금액 (VAT 포함)» · «공급가 (VAT 별도)» · «VAT 없음». 세금 이름은 `tax_label`.
- 구독 카드: `₩500,000 + VAT 10% = 청구 ₩550,000` (exclusive) / `₩550,000 (VAT 10% 포함)` (inclusive) / `₩500,000 (VAT 없음)`.
- 구독 폼·월정액 폼·새 청구서·문서 청구 조건: 세율 % 입력(워크스페이스 기본 미리 채움) + 기준 «세금 별도 / 세금 포함» 두 칸 선택 + 아래 실시간 «공급가 · 세액 · 청구 합계».
- 청구서 목록(고침)·상세·공개 결제 페이지·PDF·메일 금액: 합계 옆 «VAT 포함»/«VAT 없음», 내역에 «공급가 · VAT n% · 합계», 항목 표 머리에 기준.
- Q Bill 설정: [세금 받기] 켬/끔 · 세율 % · 세금 이름 · 기본 기준.

### D7. 서버 검증
세율 0 ≤ r ≤ 100% (분수 0~1) · 소수 4자리(분수 6자리) 넘으면 400 · `tax_mode` 두 값 외 400. 구독 POST 기본값은 고정 10 이 아니라 워크스페이스 기본(끔이면 0).

## 3. Fable 에 묻는 것
1. D1 모델(워크스페이스 켬/끔 + 세율 + 이름 + 기본 기준, 대상별 `tax_mode` 스냅샷, 세금 없음 = 세율 0) 이 맞나. 문서 청구 조건(`posts` 메타)에도 `tax_mode` 를 둬야 하나.
2. D2 단위 그대로 + 변환 한 함수 vs 퍼센트/분수 통일.
3. D3 inclusive 역산(합계 한 번 역산, 항목은 포함가 그대로) 과 반올림 규칙. 항목 금액 뜻이 방식에 따라 달라지는 것을 받아들일지.
4. D5 끔의 뜻(기존 스냅샷 불변, NULL 월정액은 따라감).
5. 검산 사례(아래)가 충분한가.

## 4. 검증 계획
- `scripts/check-tax-calc.js`(서버·화면 함수 같은 사례): KRW excl 10,000@10% → 10,000/1,000/11,000 · KRW incl 11,000 → 10,000/1,000/11,000 · KRW incl 33,333 → 30,303/3,030/33,333 · KRW incl 1 → 1/0/1 · USD incl 99.99@8.25% → 92.37/7.62/99.99 · JPY incl 1,100@10% → 1,000/100/1,100 · 0% 두 방식 · exclusive 결과 = 옛 공식 결과(옛 식 1,000 무작위 사례 대조 — 회귀 0).
- 실HTTP: 구독 생성(incl 11,000) → 엔진 수동 실행 → 청구서 10,000/1,000/11,000 · excl 10,000 → 11,000 · 끔 → 0 · 세율 150% 400 · 청구서 POST/PUT/복사 incl · 문서 청구 조건 → 초안 incl · 월정액 incl.
- 옛 청구서 금액 해시 마이그레이션 전후 같음. 화면 3폭(설정·구독·월정액·새 청구서·목록·상세·공개·PDF).
