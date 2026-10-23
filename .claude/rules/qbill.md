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
