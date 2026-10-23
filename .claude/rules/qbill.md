---
paths:
  - "dev-backend/routes/invoices.js"
  - "dev-backend/services/invoice*"
  - "dev-backend/services/receipt*"
  - "dev-frontend/src/pages/QBill/**"
  - "dev-frontend/src/components/QBill/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# Q Bill — 재무 권한

> **Invoice 재무 owner only (2026-05-10, 사이클 N+5):** PERMISSION_MATRIX §5.10. `assertInvoiceMutationOwner` 헬퍼 (`routes/invoices.js`) — 발행(send) / 결제 마킹(mark-paid·unmark-paid) / 세금계산서(mark-tax-invoice) / 삭제(invoice·installment) 5개 라우트에 적용. member 호출 시 403 `owner_only`. draft 생성·편집은 member 도 OK. `invoices.owner_user_id` 컬럼은 담당자 표시용으로만 — 권한 부여 안 함 (혼란 방지).


## 받는 쪽(고객 정보)은 **한 함수**가 정한다 (2026-10-23 박제)

> Irene: *"Q sales와 청구서 고객정보랑 제대로 동기화가 안되는 것 같아."*

- 정본 `dev-backend/services/invoiceRecipient.js` `recipientOf(invoice, client)` / `recipientEmailOf(invoice)` —
  **등록 고객이면 지금 고객 값이 먼저**(Q sale·고객 상세에서 고친 값), 청구서 `recipient_*` 는 고객에게 그 칸이 **없을 때만** 메운다.
  외부 수신(client 없음)이면 청구서 값이 전부다.
- 쓰는 곳: 상세 GET `payload.recipient`(화면은 이것을 그린다) · 발송(`invoiceDelivery.resolveRecipient`) · 재발송 · 독촉 · PDF. 공개 페이지·증빙은 원래 이 순서였다.
- 발행 창은 등록 고객의 값을 청구서에 **복사하지 않는다**(보완 칸 값만). 옛날엔 복사해 두어 고객을 고쳐도 상세가 옛 상호, 발송이 옛 주소였다.
- Q bill 목록·개요·증빙 탭·상세·발행 창은 `client:updated` 를 듣는다. 새로 고객 정보를 그리는 Q bill 화면도 같은 두 가지(함수·신호)를 쓴다.

## 입금 코드의 이름은 **회사 이름이 먼저**다 (2026-10-23 박제)

> Irene: *"회사이름이 있으면 회사이름이 쓰이게 … 주식회사나 (주) 이런거 있으면 빼게 … 번호 뒤에 직접 입금자명 표시를 바꾸고 싶으면 클릭해서 바꾸게 해. 곤란하게 만드는 일만 없으면 돼."*

- 정본 `services/receiptsDue.payerCodeOf` — 번호 + ① 그 청구서에서 직접 고친 이름(`invoices.meta.payer_label`, 20자) ② 회사 이름(사업자등록증 상호 → 회사명, `stripCorpMarks` 로 주식회사·(주)·㈜·Co., Ltd. 등 앞뒤 표기 뺌) ③ 사람 이름.
  송금은 경리 직원이 하는 일이 많다 — 담당자 개인 이름을 먼저 쓰지 않는다. 드로어·공개 페이지·메일은 서버 값을 그대로 쓴다.
- 고치는 문 `PATCH /api/invoices/:biz/:id/payer-label`(qbill 쓰기, 빈 값 = 자동) · 화면 `pages/QBill/PayerCodeEditor`(이름 부분을 누르면 입력칸).
- 받는 쪽(공개 페이지·메일)에는 «번호만 그대로면 이름은 바꿔 써도 된다» 를 같이 적는다.
