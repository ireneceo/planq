# 서명 완료 계약서 → 청구서 초안 자동 생성 — 설계 (2026-10-23 · Fable 설계 판정 · Irene 선택 대기)

> Irene: «서명을 완료한 계약서 기반으로 청구서를 자동생성 해줘. 워크스페이스가 결제를 받을 내용이 있으면. 이거 매번 ai가 살펴보지 않고 가능하게 구현돼?»
> 방 4534d85e [Opus] 조사 → Fable 설계 판정 `NEEDS-IRENE`.

## 조사한 사실 (dev)
- 서명 대상은 `posts` 뿐(signature_requests.entity_type='post'. quotes 0행·documents 는 옛 것).
- posts 에는 금액·통화·품목·고객 칸이 없다 — 본문은 자유 Tiptap JSON. 서명 완료 문서 27건의 노드 종류는 doc·paragraph·text·signatureField 뿐(표도 없음).
- → **지금 계약서에는 «결제 받을 내용» 이 구조로 없다.** AI 없이 판정하려면 사람이 서명 전에 구조로 적어 두는 입력이 필요하다.
- 훅 자리: `services/signatureHooks.afterSignatureChange`. 청구서 만들기: `routes/invoices.js POST /:businessId`(번호 `invoiceNumber.nextInvoiceNumber`).

## 선택지
| | 방식 | 결과 |
|---|---|---|
| **A+D (Fable 권고)** | 문서에 «청구 조건» 칸(고객·항목·금액·VAT·통화·분할 일정)을 서명 요청 전에 적는다 → 전원 서명 완료 순간 그대로 초안 복사. 조건 없는 문서는 알림 + «청구서 만들기» 카드(고객·프로젝트·원본 문서만 채움) | AI 0회·금액 추정 0. 입력이 하나 늘어난다 |
| C | 서명 완료 때 AI 가 본문을 한 번 읽어 «확인 필요» 초안 | 입력 추가 없음. 계약당 AI 1회, 금액은 사람이 확인해야 한다 |
| B (금지) | 본문 표를 규칙으로 읽기 | 금액이 틀리면 잘못된 청구 — 되돌리기 어렵다 |

## A 를 고르면 — 설계 결정 (Fable)
- (a) 저장: 새 테이블 `post_billing_terms`(post_id UNIQUE, business_id, client_id, currency, vat_rate, items JSON, installment_mode, installments JSON, locked_at, invoice_id UNIQUE NULL, created_by, auto_error, auto_attempted_at). 잠금 = 서명 요청 보낼 때. 고치려면 회차 닫기(superseded) → 새 회차가 다시 잠금. **서명 화면에 조건 카드를 보여 준다**(서명자가 본 것 = 청구될 것).
- (b) 트리거: 살아 있는 요청(canceled/expired/rejected/superseded 제외)이 1개 이상이고 전부 signed. 술어를 `isFullySigned(postId)` 한 곳으로 빼서 payrollContracts·projectStageEngine·새 훅이 같이 쓴다.
- (c) 멱등: 트랜잭션 안 `UPDATE post_billing_terms SET invoice_id=? WHERE post_id=? AND invoice_id IS NULL` 영향행 1 일 때만 커밋. 문서당 평생 1건(다시 서명해도 «이미 만든 청구서» 알림만).
- (d) created_by = owner_user_id = 서명 요청 보낸 멤버 → 조건 작성자 → 대표. 번호는 수동과 같은 `nextInvoiceNumber`(번호 형식 결정과 무관).
- (e) 고객: 조건 client_id → 프로젝트 고객 → 없으면 만들지 않고 D 카드.
- (f) 워크스페이스 스위치 없음(조건을 적는 것 자체가 문서별 선택).
- (g) 알림: 앱 안 notify 만(담당자 + 재무 권한자) · `invoice:new` 방송 · 외부 발송 0.
- (h) 제외: 급여 계약(`employment_contracts.post_id`) · 조건 없음 · 고객 없음.
- (i) 실패: terms 행에 auto_error 기록 + 요청자 알림, 00:30 서명 cron 이 «전부 signed·invoice_id NULL·조건 있음» 재시도. 감사 `invoice.auto_create`.
- 규모 «대». 완료 검증은 Fable gate(calc) — 조건 → 청구서 항목·VAT·분할 합계 일치 사례 3건 이상.

## C 를 고르면
대기 중인 «청구서 AI 작성» 일과 같은 엔진 — 그 설계와 합쳐 Fable 설계를 다시 받는다(이 문서의 b·c·d·g·h·i 는 그대로 쓸 수 있다).
