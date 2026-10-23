# 청구서 AI 작성 — 설계 (초안 v0 · [Opus] 조사 · Fable 설계 판정 전)

> Irene 2026-10-23: *"청구서도 AI 작성 버튼 추가해서 고객사 대충 입력하거나 있는 고객사나 기존 상담리스트에서 가져오게 하고,
> 가격이나 내용도 문서 추가나 연결하면 파악하고 해서 최종 청구서 만들게"*
> 정찰 계획 `.claude/plans/qmvkpy0yz.md` (HEAD 8a8ff401 시점 — 이후 a76b58b9 가 source-candidates 읽기 술어를 고쳤다)

## 1. 범위
- 청구서 발행 창(`pages/QBill/NewInvoiceModal.tsx`)에 [✦ AI 작성] → 작은 창에서 재료를 받고 → **발행 창 폼을 채우기만** 한다.
  저장·발행·발송 0. 사람이 확인하고 기존 [발행]/[임시저장] 으로 끝낸다(saleExtract·ai-create 선례: 미리보기만).
- 비범위: 고객 새로 만들기 · 청구서 자동 저장 · 분할(회차) 추정 · 정기청구.

## 2. 재료 (모두 «부른 사람이 읽을 수 있는 것» 만 — 공유 규칙 5)
| 재료 | 받는 값 | 술어 | 비고 |
|---|---|---|---|
| 고객 단서 | `client_hint` 자유 글(≤200) 또는 `client_id` | client-options 와 같은 범위(qbill write 는 이미 워크스페이스 고객 전원을 본다) | 문의 고객(prospect)도 같은 clients 표 — 발행 라우트가 status 를 막지 않음(확인) |
| 상담 기록 | `client_id` 가 있으면 서버가 그 고객 `client_interactions` 최근 5건 summary/key_points(없으면 body 앞부분) | **그 사람이 `qsale` 읽기 메뉴가 있을 때만**(saleCommon readChain 과 같은 판정) — 없으면 `skipped:['interactions']` | Q bill 권한만 있는 청구 담당자에게 상담 원장이 새지 않게 |
| 연결 문서 | `post_ids[]`(≤3) | business_id WHERE + `canReadPost` + published | 문서에 `post_billing_terms` 가 있으면 **그 값을 그대로 씀(AI 금액 추정 안 함)** — 16a87c86 단일 원천 |
| 첨부 파일 | `file_ids[]`(≤3, 발행 창에서 올리거나 고른 것) | business_id + deleted_at NULL + `canUserSeeFile`(posts/brief 와 같은 문) | 본문 `services/fileText.extractFileText` 건당 6k |
| 붙여넣은 글 | `text`(≤8k) | — | |
못 읽는 id 는 400 으로 전체 거절하지 않고 `skipped[]` 로 돌려 화면이 «읽지 못한 자료 n건» 을 말한다(조용히 빼지 않는다).

## 3. 서버
- 새 라우터 `routes/invoice_ai.js`(invoices.js 2437줄 god-file — 커밋 훅이 키우면 막는다), `server.js` 에서 `/api/invoices` **기존 라우터보다 앞**에 마운트.
  `POST /api/invoices/:businessId/ai-draft` — authenticateToken · checkBusinessAccess · requireMenu('qbill','write') · client 403 ·
  `perUserDaily('invoice-ai',{perMin:3, perDay:30})` · `plan.can('use_cue',{actions:1})` 422 · `checkUsageLimit` · 입력 합 캡 24k.
  `// audit-exempt: 미리보기 — 폼 값만 돌려주고 저장하지 않는다(사용량은 cue_usage)`.
- 새 서비스 `services/invoiceExtract.js`(saleExtract 모양). `callLLM({purpose:'invoice_draft', json:true})` + `recordUsage`.
- **고객 맞추기는 서버가 먼저 결정론으로**: 이름 정규화(공백·주식회사/(주)/㈜ 제거, NFC, 소문자) 후 display_name·company_name·biz_name 일치 →
  1건이면 그 id, 여럿이면 후보 목록(≤5) 으로 돌려 화면이 고르게, 0건이면 LLM 이 글에서 뽑은 `client_guess` → 외부 직접 입력 칸.
  LLM 이 내는 id 는 쓰지 않는다(지어낸 id 차단).
- 출력 계약:
```json
{ "client": { "match_id": 12|null, "candidates": [{id,name,status}], "guess": {name, email, biz_tax_id}|null },
  "title": string|null, "currency": "KRW"|"USD"|...|null,
  "vat": { "mode": "excluded"|"included"|"none"|null },
  "items": [{ "description": string, "detail": string|null, "quantity": number|null, "unit_price": number|null, "source": "terms"|"ai" }],
  "notes": string|null, "due_days": number|null,
  "from_terms_post_id": number|null, "skipped": [{kind,id,reason}], "warnings": [string] }
```
  - **글에 없는 금액은 null** — 지어내지 않는다. 화면은 단가 0 + 칸 경고(«문서에서 금액을 못 찾음»).
  - 금액은 서버가 숫자로 정리: 문자열 «3,300,000원»·«330만» 해석은 LLM, 서버는 유한수·≥0·통화별 소수 자리만 검사(아니면 null).
  - **VAT 포함 표기 처리(계산 — Fable 판정 필요)**: 안 A) `vat.mode='included'` 면 서버가 공급가 = round(금액 / (1+vat_rate)) 로 바꿔 단가에 넣고 warnings 에 «부가세 포함 금액을 공급가로 나눔» · 안 B) 바꾸지 않고 화면이 «부가세 포함 금액으로 보입니다 — 공급가로 바꿀까요?» 한 번 묻기.
    `none` 이면 vat_rate 0 제안, `excluded`/null 이면 워크스페이스 기본값 그대로.
  - 품목 ≤ 30, 설명 200자 캡.

## 4. 화면
- 발행 창 `<Head>` 제목 옆 [✦ AI 작성] (`data-testid="invoice-ai-draft"`, 편집 모드·발행 완료 화면에서는 숨김). Cue 한도면 비활성 + 이유.
- 누르면 공용 `StandardModal` 하나: ①고객 칸(자유 입력 + 기존/상담 고객 고르기 — client-options 재사용, prospect 는 «상담 고객» 라벨) ②문서 연결(source-candidates 재사용, 서명 완료·그 고객 문서 먼저) ③파일(`AttachmentField`) ④붙여넣기 글 → [만들기].
- 결과 적용: 폼에 이미 쓴 값(품목 설명·단가 하나라도, 제목, 고객)이 있으면 `ConfirmDialog` «지금 쓴 내용을 바꿀까요?» 후 덮음. 기존 setter 로만(새 state 없음).
  고객 1건 일치 → `setRecipientMode('client')+setClientId`, 후보 여럿 → 결과 창에서 고르게, 없음 → `external` + extName/extEmail/extBizNumber.
  문서 1건이면 `setSourcePostId`(고객 모드일 때만 — 발행 라우트 규칙).
- 채운 칸 옆 «AI 가 채움» 표시(사람이 고치면 사라짐) · 금액 null 품목 경고 · skipped 안내.
- i18n `qbill.json newInvoice.ai.*` ko/en.

## 5. 결정 (권고 포함)
1. 대충 쓴 고객이 안 맞을 때: **새 고객을 만들지 않고 외부 직접 입력으로 채움**(만들면 한도·영업 단계가 걸린다).
2. 문의 고객(prospect)에게 청구: 지금 발행이 막지 않음 — 그대로.
3. VAT 포함 금액: §3 안 A/B — Fable.
4. 상담 기록 재료의 권한: qsale 읽기 있을 때만 — Fable.

## 6. 검증 계획
- 실HTTP(owner ws6): 붙여넣기 «[확인용] 브랜드파트너스 웹사이트 리뉴얼 3,300,000원 VAT 별도, 유지보수 월 300,000 x 3» → 품목 2·단가 3300000/300000·수량 1/3 · 고객 결정론 매칭.
  경계: 금액 없는 글 → unit_price null + warning · 남의 워크스페이스 post/file → skipped · member2 가 남의 L1 문서 → skipped · client 403 · qsale 없는 멤버 → interactions skipped · 청구 조건 있는 문서 → source terms(LLM 금액 0) · Cue 한도 422.
- 화면 3폭(390·820·1440): 버튼 보임·창·적용·덮어쓰기 확인·발행까지. build EXIT 0 · guard · health.
