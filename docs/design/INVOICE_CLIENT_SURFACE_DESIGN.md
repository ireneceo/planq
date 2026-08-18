# 청구서 — 발행자/수신자(고객) 표면 정리 설계 (운영 피드백 #274)

**Fable 설계 게이트 문서** · 2026-08-18 · 대상: 돈·주문 무결성 + 권한 경계 (고위험 3단 게이트)
작성 근거: dev 로컬 코드 전수 확인 (`파일:줄` 표기). 운영 서버 미접촉.

---

## 0. 요약 — 무엇이 문제인가

Irene 원문 4가지 호소를 코드로 확인한 결과:

| # | 호소 | 판정 |
|---|------|------|
| 1 | 고객에게 "결제 독촉 보내기" 등 발행자 버튼이 보인다 | **사실.** 프론트만 뚫림 — 백엔드는 client 403 (아래 §1.2) |
| 2 | 입금자명에 기재하라는 "인보이스번호+이름"이 송금 시 다 안 들어간다 | **사실.** `INV-2026-0042 상호명` 은 은행 입금자명 필드 한도 초과 (§5) |
| 3 | 세금계산서 정보가 이미 있으면 "발행될 예정" 미리보기가 나와야 하는데 혼란 | **사실.** 공개페이지는 정보가 있어도 "신청" CTA, 고객 로그인 화면은 발행자용 문구 노출 (§6) |
| 4 | 메일로 받는 웹페이지와 로그인 화면이 다르다 — 수신자 상태를 정돈해달라 | **사실.** 세 표면이 각각 다른 논리로 그려짐 (§2 비교표) |

추가로 조사 중 발견한 **백엔드 결함 1건(§1.1 — draft 노출)** 이 이번 절단면에 반드시 포함되어야 한다.

---

## 1. 현재 상태 진단 — 결함 목록 (심각도 순)

### 1.1 🔴 [백엔드까지 뚫림 — 보안/영업기밀] 고객이 **발행 전 draft 청구서**를 조회할 수 있다

- `middleware/access_scope.js:313-319` `invoiceListWhere` — client 분기가 `{ business_id, client_id IN (내 clientIds) }` 만 건다. **status 필터가 없다.**
- `middleware/access_scope.js:375-381` `canAccessInvoice` — 동일. status 무관 통과.
- 결과: 로그인 고객이 다음을 **실제로 200 으로 받는다** (코드로 판정 — "아마"가 아님):
  - `GET /api/invoices/:businessId` (routes/invoices.js:657) → 자기 앞으로 작성 중인 **draft 목록·금액·항목** 전부
  - `GET /api/invoices/:businessId/:id` (routes/invoices.js:1044→1057 canAccessInvoice) → draft 상세
  - `GET /api/invoices/:businessId/:id/pdf` (routes/invoices.js:1030→1034) → **draft PDF 다운로드**
  - `GET /api/invoices/:businessId/:id/corrections` (routes/invoices.js:2152→2156) → draft 정정 이력 (실질 0건이나 통과 자체가 술어 결함)
- 대조: **공개 페이지는 draft/canceled 를 404 로 거부한다** (routes/invoices.js:135-137). 로그인 고객 경로만 뚫려 있다.
- 왜 심각한가: draft 는 발행자가 **아직 확정하지 않은 금액·문구**다. 협상 전 가격, 지웠다 다시 쓴 항목이 고객에게 실시간 노출된다. 프론트 `InvoicesTab.tsx:18` 은 고객에게도 `draft` 필터 칩을 그대로 보여줘 이 노출을 UI 로 증폭한다.
- 파급: `GET /:businessId/receipts-due` (routes/invoices.js:918) 도 `invoiceListWhere` 를 쓰므로 술어를 고치면 자동으로 같이 조여진다 (증빙 큐는 결제 완료 건 기반이라 실질 영향 0).

### 1.2 🟠 [프론트만 뚫림 — UX/신뢰] 드로어 발행자 액션이 고객·member 에게 노출

`pages/QBill/InvoiceDetailDrawer.tsx` — `isOwner`(:73) 게이트가 붙은 것은 4개뿐: 발송(:465), 미리보기(:480), 결제완료(:508), 결제취소(:520).

**게이트 없이 고객(client)에게도 렌더되는 것 (백엔드 대조 포함):**

| 버튼/요소 | 위치 | 고객이 누르면 (백엔드 판정) |
|---|---|---|
| 편집·재발행 (draft/canceled) | :456 | PUT :1072 `checkBusinessAccess`(memberOnly, middleware/auth.js:157) → **403** |
| 삭제 (draft/canceled) | :489 | DELETE :2163 + assert :2164 → **403** |
| 재발송 | :529 | POST /resend :1598 → **403** |
| **결제 독촉 보내기** | :543 | POST /send-reminder :1489 → **403** |
| 청구서 취소 | :554 | PATCH /status :2240 → **403** |
| 독촉 알림 켜기/끄기 토글 | :566-573 | POST /overdue-notify :1565 → **403** |
| 세금계산서/현금영수증 **발행번호 입력** 버튼 2개 | :815-822 | mark-tax/cash :1993/:2018 + assert → **403** |
| 분할 회차 kebab 메뉴 (결제완료·발행마킹·결제취소·회차취소) | InstallmentRow :997, 메뉴 :131-148 | installments 라우트 4종 + assert → **403** |

- **백엔드는 전부 client 를 차단한다** — `checkBusinessAccess = attachWorkspaceScope({ memberOnly: true })` (middleware/auth.js:157, access_scope.js:603-650). 즉 이 그룹은 보안 결함이 아니라 **표면 결함**이다. 그러나 Irene 호소 그대로 — 고객이 "결제 독촉 보내기"를 보는 것 자체가 제품 신뢰를 깬다.
- 같은 이유로 **member 에게도 owner-only 버튼이 노출**된다: 삭제·청구서취소·증빙마킹·회차마킹은 백엔드 owner_only(assert :2164, :1994, :2019, :1658, :1694, :1784, :1847 / PATCH inline :2243)인데 프론트 게이트가 없어 member 가 누르면 403. (재발송 :1598·독촉 :1489·overdue-notify :1565 는 assert 가 **없고** requireMenu('qbill','write') 까지만 — member 허용이 현행 백엔드 정책이다. 안 막혀 있으면 안 막혀 있다고 쓴다: **member 는 독촉·재발송을 보낼 수 있다.** §4 에서 이 정책을 명시적으로 유지 결정.)

### 1.3 🟠 [프론트] 고객 관점(수신자 뷰)이 아예 없다

- `QBillPage.tsx:31-32` — 고객이면 탭만 3개로 줄이고(`CLIENT_TABS`), 각 탭의 **내용물은 발행자용 그대로**다.
- `TaxInvoicesTab.tsx` — "증빙 발행 큐" 통째 노출: "외부(홈택스/팝빌)에서 발행하고 발행번호만 마킹합니다"(:82), 가산세 경고 배너(:89), **발행**(:152)·**수정·취소**(:155,:158) 버튼. 데이터는 자기 것만 오지만(§1.1 의 invoiceListWhere 스코핑, routes/invoices.js:918-926) 문구·버튼 전부 발행자 언어다. 고객이 누르면 403.
- 드로어 증빙 섹션 — 고객에게 "발행 필요"(:807, ko `detail.tax.required`="발행 필요") + "외부에서 발행한 후 발행번호를 입력하세요"(:810) 노출. 수신자에게는 "발행될 예정입니다"로 읽혀야 할 자리다.
- `InvoicesTab.tsx:18` — 고객에게 `draft` 필터 칩 노출 (§1.1 증폭).
- `routes/appRoutes.tsx:100` — `/bills` 라우트 역할 무제한 (`/mail` 은 `roles: BIZ`). 고객 접근 자체는 **의도된 기능**("받은 청구서", QBillPage :91 titleClient)이므로 라우트를 막는 게 아니라 **내용을 수신자 뷰로 바꾸는 것**이 정답.

### 1.4 🟠 [3표면 공통] 입금자명 안내가 물리적으로 불가능한 문자열

- 드로어 :754-759 — `INV-2026-0042 {고객표시명}` 을 "입금자명에 다음을 기재해 주세요"(ko qbill.json:259).
- 공개페이지 `PublicInvoicePage.tsx:211-217` — `payerGuide = "{invoice_number} {상호} {회차라벨}"` — 더 길다.
- 메일(`services/emailService.js:600-618 invoiceEmailHtml`) — 입금자명 안내 자체가 없음 (CTA 만).
- 은행 입금자명(받는 통장 표시) 필드는 통상 **한글 5~8자 / 영숫자 8~16자**에서 잘린다. `INV-2026-0042`(13자) 하나만으로 대부분 꽉 차고, 상호·회차는 절단된다. → §5 확정안.

### 1.5 🟡 세금계산서 "발행 예정" 예고 부재

- 공개페이지 증빙 섹션 (`PublicInvoicePage.tsx:543-596`) — 고객 정보가 이미 완비(`receipt.profile` prefill, routes/invoices.js:221-233)라도 미제출(`requested_at` null)이면 "발행을 원하시면 정보를 입력·확인해주세요" + **신청 버튼**. "이미 있는 정보로 발행될 예정" 상태가 표현되지 않는다.
- 고객 로그인 드로어 — §1.3 대로 발행자 문구.
- 청구서 메일 — 세금계산서 언급 0.
- 판정 술어는 이미 단일 원천이 있다: `services/receiptsDue.js:51 receiptKindOf()` (receipt_type 또는 한국 사업자 fallback). 이걸 그대로 쓴다. → §6.

### 1.6 참고 — 뚫리지 **않은** 것 (조사로 확인)

- 목록·상세·PDF 의 **타 고객 청구서** 접근: client_id 매칭으로 차단 (access_scope.js:313-319, :375-381) ✅
- status-history(:987-992)·timeline(:1018-1025)·tax-breakdown(:929-940): `isMemberOrAbove` 로 client 403 ✅ (드로어가 이 두 fetch 를 고객 세션에서도 시도하다 403 — 조용히 빈 섹션. 수신자 뷰에선 아예 fetch 안 하도록 정리)
- 공개페이지: draft/canceled 404(:135-137), 만료 410(:139-146), 발신측 열람 미기록(:149-155) ✅
- 대시보드 할일: 역할 분기 정상 — client 는 "결제할 청구서"만(dashboard.js:408-411), 증빙 큐는 owner/admin 만(:647-649) ✅
- 결제 표면: PaymentsTab 은 읽기 전용(행 클릭 → 드로어 이동뿐, PaymentsTab.tsx:86) ✅. `canPurchaseInApp` 게이트는 SaaS 플랜 구매 표면(PlanSettings·배너·utils/purchase.ts)에만 걸려 있고 Q Bill 청구서 결제(공개페이지 Stripe :511-519)와는 **무접점** — 이번 변경이 건드리지 않는다 ✅

---

## 2. 세 표면 비교표

### 현재 상태 (AS-IS)

| 항목 | (A) 발행자 로그인 `/bills` | (B) 고객 로그인 `/bills` | (C) 공개 웹페이지 `/public/invoices/:token` |
|---|---|---|---|
| 탭 | overview+invoices+payments+tax | invoices+payments+tax (내용은 A 와 동일 컴포넌트) | 단일 페이지 |
| draft 노출 | 보임 (정상) | **보임 (결함 §1.1)** | 404 (정상) |
| 발행자 액션 (발송·편집·삭제·독촉·재발송·취소·마킹) | 보임 — 단 owner-only 4종만 게이트, 나머지는 member 도 보임 | **전부 보임 → 403 (§1.2)** | 없음 (정상) |
| 결제 수단 | — | 없음 (계좌만 표시, 결제 CTA 없음) | 카드(Stripe)+계좌+송금완료알림 |
| 입금자명 안내 | `INV-… 이름` (불가능 문자열) | 동일 | `INV-… 상호 회차` (더 김) |
| 증빙(세금계산서) | 발행 큐 + 마킹 (정상) | **발행 큐 문구·버튼 그대로 (§1.3)** | 신청 폼 — 정보 있어도 "신청하세요" (§1.5) |
| 상태이력·타임라인 | 보임 | fetch 시도 → 403, 빈 섹션 | 없음 |
| 메일 | — | — | 금액+기한+CTA. 입금자명·증빙 안내 없음 |

### 되어야 할 상태 (TO-BE)

| 항목 | (A) 발행자 | (B) 고객 로그인 (수신자 뷰) | (C) 공개 웹페이지 |
|---|---|---|---|
| draft | 보임 | **안 보임 (목록 제외·상세 403)** | 404 (유지) |
| 미발송 canceled | 보임 | 안 보임 | 404 (유지) |
| 발송된 canceled | 보임 | 보임 — "취소됨" 뱃지, 액션 없음 | 404 (유지 — 확답 Q2) |
| 액션 | 단일 caps 로 파생: owner=전부, member=편집(draft)·재발송·독촉·PDF·링크 (owner-only 는 숨김) | **결제 안내 페이지 열기 · PDF · 채팅방 가기 · (미결제 시) 송금완료 알림** — 발행자 액션 블록 자체가 렌더 안 됨 | 카드결제·송금완료알림·증빙 신청/확인 (유지) |
| 입금자명 | §5 확정 문구 (짧은 입금코드) | 동일 | 동일 + 메일에도 동일 한 줄 |
| 증빙 | 발행 큐 (유지) | "발행될 예정/발행 완료 + 파일 다운로드" 수신자 문구 | 정보 있으면 **"아래 정보로 발행될 예정" 미리보기 + 수정 링크**, 없으면 신청 폼 (§6) |
| 상태이력·타임라인 | 보임 | **fetch 안 함** (섹션 미렌더) | 없음 |
| 탭 문구 | Q bill | "받은 청구서"(유지) — tax 탭은 수신자 모드 | — |

---

## 3. 절단면 — 파일별 변경 + 단일 착지점

> 원칙: **버튼마다 `isOwner &&` 를 또 흩뿌리지 않는다.** 이 저장소는 이미 그렇게 당했다(발행·마킹 4곳만 붙고 8곳 빠짐). 권한 판정을 **양쪽 각각 한 곳**으로 모은다.

### 3.1 프론트 단일 착지점 — `src/pages/QBill/invoiceCaps.ts` (신규, 1파일)

```ts
export type InvoiceViewer = 'owner' | 'member' | 'recipient';
export function invoiceViewerOf(user): InvoiceViewer;   // business_role/platform_role → 3분류
export function invoiceCapsOf(viewer, invoice): {
  // 발행자 액션 — recipient 는 전부 false 가 "기본값" (fail-closed)
  canSend, canPreview, canEditDraft, canDelete, canMarkPaid, canUnmarkPaid,
  canResend, canRemind, canCancel, canMarkReceipt, canToggleOverdueNotify,
  // 수신자 액션
  canOpenPayPage, canNotifyPaid,
}
```

- 백엔드 정책을 그대로 미러: owner-only = send/preview/markPaid/unmarkPaid/delete/cancel/markReceipt (assert·inline 판정과 1:1), member 허용 = editDraft/resend/remind/toggleOverdueNotify (routes/invoices.js:1072, :1598, :1489, :1565 — assert 없음 확인).
- **소비처**: `InvoiceDetailDrawer.tsx`, `InvoicesTab.tsx`, `TaxInvoicesTab.tsx`. 기존 `isOwner`(:73) 지역 변수 제거.

### 3.2 `InvoiceDetailDrawer.tsx` — 액션바를 viewer 로 **블록 분기**

- `viewer === 'recipient'` 이면 발행자 `<ActionRow>` 블록(:454-561)과 OverdueNotifyRow(:563-575)를 **통째로 렌더하지 않고**, 수신자 액션바(결제 안내 페이지 열기 = shareUrl 새 탭 · PDF · 채팅방 가기)를 렌더. 버튼 단위 조건이 아니라 **블록 단위** — 다음에 발행자 버튼이 추가돼도 수신자에게 새지 않는다.
- 증빙 섹션(:780-830): recipient 분기 — pending 이면 "발행될 예정" 문구(§6), issued 면 기존 발행완료 + (있으면) 파일 다운로드. `ReceiptMarkRow`(:815-822)와 InstallmentRow kebab(:997, 메뉴 :131-148)은 caps 로만 렌더 (`canMarkReceipt`/`canMarkPaid`) — **member 403 노출도 이 한 번에 같이 해결**.
- 상태이력·타임라인 fetch (:150 부근 useEffect): recipient 면 호출 생략.
- 입금 안내 PayerHint(:754-759): §5 문구로 교체 (세 표면 공통 헬퍼 `payerCodeOf(invoice, client)` — invoiceCaps.ts 에 같이 둔다. **같은 값의 공식은 한 벌**).

### 3.3 `InvoicesTab.tsx`

- `FILTER_KEYS`(:18): recipient 면 `draft` 칩 제거 (`canceled` 는 Q2 확답에 따름 — 기본안: 유지).
- 드로어에 `onEdit` 전달(:299): recipient 면 미전달 (caps 와 이중 안전).

### 3.4 `TaxInvoicesTab.tsx` — 수신자 모드

- viewer==='recipient' 시: 안내 InfoBox(:82-83)·가산세 배너(:89)·발행/수정취소 버튼(:152-158) 대신 — "받을 증빙" 목록: 상태(발행 예정/발행 완료) + 발행완료 건 파일 다운로드 링크(공개 receipt-file 재사용 또는 파일 fetch). 데이터는 기존 `listReceiptsDue` 그대로 (백엔드 이미 스코핑).

### 3.5 백엔드 단일 착지점 — `middleware/access_scope.js`

- 신규 상수/헬퍼 1개: `clientVisibleInvoiceCond()` — `status != 'draft' AND NOT (status='canceled' AND sent_at IS NULL)` (Sequelize `Op` 형태 + 인스턴스 판정용 `isClientVisibleInvoice(inv)` 쌍).
- `invoiceListWhere`(:313) client 분기와 `canAccessInvoice`(:375) client 분기가 **같은 헬퍼를 공유** — 목록/상세/PDF/corrections/receipts-due 5개 소비처가 한 번에 조여진다. member/owner 분기는 **무변경** (owner 가 draft 를 못 보게 되는 회귀 금지 — §8 R1).

### 3.6 백엔드 — 문구·예고 (§5, §6)

- `services/emailService.js` `invoiceEmailHtml`(:600): 입금 코드 한 줄 + (receipt_kind='tax' 이고 미발행 시) 세금계산서 예고 한 줄. 호출측 `POST /send`(:1229 부근 이메일 발송부)에서 `payerCode`·`willIssueTax` 파라미터 전달.
- `routes/invoices.js` `GET /public/:token` 응답(:180-233): `payer_code` 필드 추가 (서버 계산 — 프론트 3곳이 각자 조립하지 않게).
- `PublicInvoicePage.tsx` payerGuide(:211-217): 서버 `payer_code` 사용으로 교체. 증빙 섹션(:588-593): profile 완비 + 미제출이면 "발행 예정 미리보기" 분기 (§6).

### 3.7 선택(권장) — `routes/invoices.js` PATCH /status(:2242-2245) 인라인 owner 검사를 `assertInvoiceMutationOwner` 호출로 교체. 의미 동일(assert 도 `businessRole==='owner' || platform_admin`, :60-67), 판정 단일화 목적. 동작 변화 0.

**변경 파일 합계**: 프론트 5 (invoiceCaps.ts 신규, Drawer, InvoicesTab, TaxInvoicesTab, PublicInvoicePage) + 백엔드 3 (access_scope.js, invoices.js, emailService.js) + i18n ko/en qbill.json.

---

## 4. 백엔드 보강 — assertInvoiceMutationOwner 대조 결론

전수 확인 결과 (routes/invoices.js):

| 라우트 | 현행 | 판정 |
|---|---|---|
| send(:1229)·send-preview(:1447)·installment mark/unmark-paid(:1657/:1693)·unmark-paid(:1748)·installment mark-tax/cash(:1783/:1846)·mark-tax/cash(:1993/:2018)·corrections POST(공용 핸들러 :2095)·DELETE invoice/installment(:2163/:2203) | assert 있음 | ✅ 유지 |
| PATCH /status(:2240) | 인라인 owner 검사(:2243) | ✅ 동등 — §3.7 로 표기 통일만 |
| send-reminder(:1489)·resend(:1598)·overdue-notify(:1565) | assert **없음** (checkBusinessAccess+requireMenu write) | **의도적 유지 결정** — 독촉·재발송은 돈을 움직이지 않는 "발송 행위"라 CLAUDE.md §5.10 재무 mutation 5종에 해당하지 않는다. member 가 수금 실무를 하는 팀이 실존한다. rate-limit(reminderLimiter)·6h 쿨다운(:1504-1512) 기존 방어 유지. **여기에 assert 를 새로 붙이면 member 의 정상 수금 업무가 죽는다 — 붙이지 않는다.** |
| client 차단 | 전 mutation 라우트 `checkBusinessAccess`(memberOnly, auth.js:157) | ✅ 추가 조치 불요 |

**이번에 백엔드에서 실제로 고치는 것은 §3.5 (draft 가시성 술어) 하나다.** "고객 본인 청구 조회"라는 정상 기능은 client 분기의 status 조건 추가로만 조이므로, sent/paid/overdue/partially_paid 조회·PDF 는 그대로 산다 (§7 반증 테스트로 증명).

---

## 5. 입금자명 안내 — 확정 문구

**결정: 입금 코드 = `{청구서 순번 끝 4자리}{고객 표시명}`** — 예: `0042홍길동`, 분할이면 회차 붙임 `0042-2홍길동`.

근거:
1. 국내 은행 "받는 분 통장 표시"는 통상 한글 5~8자/영숫자 8~16자에서 **뒷부분이 절단**된다. 현행 안내(`INV-2026-0042 상호명`, 드로어 :756-758·공개페이지 :211-217)는 번호만 13자라 이름 전에 이미 잘린다.
2. 절단이 꼬리에서 일어나므로 **식별번호를 선두에** 둔다 — 한글 7자 절단 기준으로도 `0042홍길` 까지 남아 대사(청구서 특정 + 입금자 추정)가 성립한다. 순번 4자리는 연도 내 유일(`generateInvoiceNumber`, INV-YYYY-순번, routes/invoices.js:105-121).
3. 정확 매칭의 정본은 어차피 **송금 완료 알림**(공개페이지 notify-paid, payer_name 입력 :640-651)이다 — 문구에 이 채널을 같이 안내한다.

**ko** (`qbill.json` — 드로어 `detail.bank.payerMemoHelp` 교체 + 신규 `detail.bank.payerMemoNote`, 공개 `public.payerGuideDesc` 교체 + `public.payerGuideNote` 신규):
- 안내: `"입금자명(보내는 분 표시)에 아래 코드를 넣어 주세요. 은행에 따라 글자 수가 제한되어 짧게 만들었습니다."`
- 코드: `0042홍길동` (payer_code — 서버 계산)
- 보조: `"입금자명을 바꾸기 어려우면 그대로 보내신 뒤, 아래 '송금 완료 알림 보내기'로 알려 주세요."` (공개페이지) / `"입금 후 결제 안내 페이지에서 '송금 완료 알림'을 보내면 더 빨리 확인됩니다."` (드로어)

**en**:
- `"Use the short code below as the sender name — banks truncate long names, so we kept it short."`
- `"If you can't change the sender name, just send the transfer and tap 'I've sent the payment' below."`

메일(`invoiceEmailHtml`): 총액 박스 아래 한 줄 — ko `"입금자명에 <b>{payer_code}</b> 를 적어 주시면 확인이 빠릅니다."` (메일은 발신 시점 언어 정책이 ko 고정인 기존 템플릿 관례를 따름 — emailService.js 전 템플릿 ko).

---

## 6. 세금계산서 "발행 예정" 예고

**조건 (단일 원천)**: `receiptKindOf(invoice, client)` (services/receiptsDue.js:51) — 이미 목록·상세·공개 응답에 `receipt_kind` 로 내려오고 있다 (routes/invoices.js:106(공개), :678(목록), :1063(상세)). 새 술어를 만들지 않는다.

| 위치 | 조건 | 문구 (ko / en) |
|---|---|---|
| 공개페이지 증빙 섹션 | `receipt_kind` 존재 && 미발행 && profile 완비(tax: biz_tax_id+상호 / cash: cr_identifier) && 미제출 | **"결제가 확인되면 아래 정보로 {세금계산서/현금영수증}가 발행될 예정입니다"** + profile 미리보기(사업자번호·상호·수취 이메일 — 기존 ReceiptInfoBox 마크업 재사용) + "정보가 다르면 수정" 링크(기존 openReceipt 모달) / "A {tax invoice/cash receipt} will be issued with the details below once payment is confirmed." |
| 〃 | profile 미비 | 기존 신청 CTA 유지 (변경 없음) |
| 고객 드로어 증빙 섹션 | recipient && status pending | 같은 "발행될 예정" 문구 (발행자용 "발행 필요/번호 입력" 대체) |
| 〃 | recipient && issued | "발행 완료 · {번호}" + 파일 다운로드 (기존 유지) |
| 청구서 메일 | `receipt_kind==='tax'` && 미발행 | 한 줄: "결제 확인 후 세금계산서가 발행됩니다." |
| 발행자 화면 | — | **무변경** (발행 큐가 정본) |

---

## 7. 검증 계획 (구현 후 Fable 구현 게이트에서 실 HTTP 로 증명)

계정 3종: owner / member / client(청구 대상 Client.user_id 연결). 테스트 데이터: draft 1건 + sent 1건 + paid·tax pending 1건 + 미발송 canceled 1건 + 발송된 canceled 1건 (전부 같은 client 앞).

**① client 토큰 기대 응답 매트릭스:**

| 호출 | 기대 |
|---|---|
| GET /:biz (목록) | 200 — **draft·미발송 canceled 미포함**, sent/paid/발송된 canceled 포함 |
| GET /:biz/:draftId · /:draftId/pdf | **403** (수정 전 200 인 것을 먼저 실측 박제 — 반증의 before) |
| GET /:biz/:sentId · /:sentId/pdf | **200 (정상 기능 생존 반증)** |
| GET /:biz/receipts-due | 200 — 자기 건만 |
| POST send/resend/send-reminder/overdue-notify, PATCH status, DELETE, mark-* 전종 | **403** (현행도 403 — 회귀 없음 확인) |
| GET status-history/timeline/tax-breakdown | 403 (현행 유지) |

**② member 토큰:** resend·send-reminder·overdue-notify·PUT draft **200 (기능 생존)** / send·mark-paid·mark-tax·DELETE·PATCH status **403**.

**③ owner 토큰 (회귀 0):** draft 목록 포함·상세 200·발송 200·독촉 200·마킹 200 — 전 액션 생존.

**④ 공개페이지 (비인증):** GET /public/:token(sent) 200 + `payer_code` 필드 존재 / draft 토큰 404 유지 / notify-paid 200 / receipt-request 200 / profile 완비 건 응답으로 "발행 예정" 분기 렌더 조건 성립 확인.

**⑤ 프론트 (2브라우저):** client 세션 `/bills` — 발행자 버튼 0개(DOM 검사: `결제 독촉`·`발행번호 입력`·`삭제` 텍스트 부재), draft 행 부재, tax 탭 수신자 문구. owner 세션 — 기존 버튼 전부 존재. 빌드 `npm run build` exit 0 + i18n 가드 `node scripts/guard-invariants.js --category=i18n --category=parity`.

**⑥ 메일 실발송 1건:** send → 수신 HTML 에 payer_code·세금계산서 예고 라인 존재.

---

## 8. 리스크

| # | 리스크 | 방어 |
|---|---|---|
| R1 | 술어를 client 분기 밖에 잘못 적용 → **owner/member 가 draft 를 못 보게 됨** (목록·발행 대기 큐 전멸) | 헬퍼를 client 분기 안에서만 호출. §7-③ owner draft 목록 포함이 게이트 통과 조건 |
| R2 | "고객 본인 청구 조회" 정상 기능이 같이 죽는 전례 재발 | §7-① sent 200 반증 테스트를 매트릭스에 명시 (403 전수만 확인하고 끝내는 것 금지) |
| R3 | 발송된 canceled 를 숨겨버리면 "받은 청구서가 사라졌다" 신고 | 기본안: 발송된 canceled 는 목록 유지 (Q2). 목록 병합/socket 갱신 시 삭제행 처리 확인 |
| R4 | recipient 분기 도입 시 훅 순서 변경 → React #310 (이 드로어는 항상 mount, Drawer :122-125 주석의 전례) | 훅은 전부 early-return 위 유지, 분기는 JSX 렌더에서만 |
| R5 | member 독촉·재발송에 assert 를 "내친김에" 붙여 정상 업무 차단 | §4 명시 결정 — 붙이지 않는다. diff 범위 대조 항목 |
| R6 | payer_code 를 프론트 3곳이 각자 조립해 다시 3벌로 갈라짐 | 서버 계산 `payer_code` 단일 원천 + 프론트 헬퍼 1개 |
| R7 | TaxInvoicesTab 수신자 모드의 파일 다운로드 권한 (로그인 client 가 receipt file 접근) | 공개 receipt-file 라우트(share_token) 재사용 — 신규 권한 경로 안 만듦 |
| R8 | i18n 신규 키 ko/en 패리티 누락 | parity 가드가 게이트 (§7-⑤) |

---

## 9. Irene 확답 필요 (2건)

- **Q1. 입금 코드 형식** — `0042홍길동` (순번 끝4자리 + 이름, 번호 선두) 확정 여부. 대안: 이름만 안내 + 송금완료알림 전적 의존.
- **Q2. 발송된 적 있는 '취소' 청구서** — 고객 로그인 목록에 "취소됨"으로 남길지(기본안·소통 맥락 보존) / 고객에겐 완전히 숨길지(공개페이지와 동일). 미발송 canceled·draft 는 확답 불요 — 무조건 숨김.
