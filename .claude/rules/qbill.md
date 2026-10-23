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

