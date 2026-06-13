# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-13 19:20 — **정기업무 fix + 드로어 정정이력 운영 라이브 (deploy `20260613_191904`, commit `3c3b735`). 작업 상태: 완료·배포됨. 미배포 0.**

## 현재 작업 상태 (이번 세션 종합)
**작업 상태:** 완료 · 운영 라이브 · 미배포 커밋 0

### 이번 세션 완료·배포 (Q Bill 증빙/PDF + Q Task 정기업무, 8+ 사이클)
1. **증빙 발행 큐 통합** (v1.35.0) — receiptsDue 단일원천 + 법정기한 + 세금계산서/현금영수증 단건·분할 4조합
2. **증빙 루프 완성** — 발행완료 고객 통지 메일 + 취소 후 수정/취소 알림
3. **회차별 현금영수증** (v1.36.0) — InvoiceInstallment cash 3컬럼
4. **문서 PDF 다운로드** — Document PDF 라우트 + posts 서버PDF 격상 (인증 blob fetch)
5. **청구서 PDF 401 + Puppeteer 자가복구** — window.open→blob, 죽은 브라우저 재사용 모든 PDF 행 버그 fix
6. **운영 피드백 #34/#35/#36** 정리·회신 (코드 0)
7. **수정세금계산서·증빙 취소 Phase 1** — receipt_corrections 테이블 + 부가세법 §70 6사유 + CorrectionModal + 정정 이력(큐+드로어)
8. **정기업무 점검·완성** — 인스턴스 project_id 누락 버그 fix(prod 고아 16건 백필) + reviewer 복사

### 최근 운영 배포
- `20260613_191904` (3c3b735) — 정기업무 fix + 드로어 정정이력 + prod 백필 16→0
- `20260613_182837` (0906a5c) — 수정세금계산서 Phase 1 (receipt_corrections 테이블)
- `20260613_165308`~ — PDF fix / 문서 PDF / 회차 현금영수증(v1.36.0) / 증빙 큐(v1.35.0)

### 다음 할 일 (다음 세션 후보)
- 증빙 Phase 2: 정정 PDF · insights 정정 반영 · 팝빌 자동발급 (운영 실시작 때)
- 또는 새 영역 (Irene 지정)

### Git 상태
- HEAD: `9c2214a` (배포 기록). working tree clean. 미배포 커밋 0 (전부 운영 반영).

## 🔖 직전 작업 — 청구서 PDF 401 + Puppeteer 죽은 브라우저 버그
문서 PDF 검증 중 발견 → 진단 확대. commit `990c5cc`.
- **버그1 (청구서 멤버 PDF 401):** InvoiceDetailDrawer가 `window.open(/api/.../pdf)`인데 authenticateToken은 Authorization 헤더만 받아 401(새 탭 에러 JSON). → `downloadInvoicePdf` 인증 blob fetch + busy/error.
- **버그2 (★ 운영 전체 PDF 먹통):** `pdfService.getBrowser` 싱글톤이 chrome 크래시(--single-process 메모리압박/OOM) 후에도 **죽은 browser 영구 재사용** → newPage가 protocolTimeout(30s) 행 → 청구서·문서·포스트·보고서 **모든 PDF 500**. 방금 prod 올린 문서 PDF 포함 전체 해당. → disconnected 이벤트 싱글톤 리셋 + connected 체크 + render 1회 재launch 재시도 + protocolTimeout 60s.
- **검증:** 헬스 29/29 · 빌드 EXIT0 · 청구서 PDF 인증 200 유효 90KB · **자가복구 실증**(chrome 3개 kill 후 렌더 200/2.5s, 기존 30s행→500) · qbill i18n 556/556.
- **미배포 커밋:** `990c5cc` → 다음 `/배포`(운영 PDF 안정성 직결, 권장).
- **기록(스코프밖):** InvoiceDetailDrawer 기존 하드코딩 3건(310/316/331 sourcePost·은행) + formatMoney `원` — 별도 i18n 정리 대상.

## ✅ 정기업무 fix + 드로어 정정이력 운영 라이브 (deploy `20260613_191904`, 132초, commit `3c3b735`)
운영 헬스 200·프론트 200·PM2 2/2. **운영 백필 실행 — prod 고아 인스턴스 16건 → 0건**(정기업무 인스턴스 16개가 프로젝트에서 안 보이던 실버그 해소). 드로어 정정이력(84210f8)도 함께 배포. dev: 헬스 29/29·빌드 EXIT0·E2E 4/4.

## ✅ 정기업무(반복 업무) 점검·완성 (2026-06-13 18:20, dev 검증완료)
30년차 감사 — 전 계층(cron·모델·프론트 UI·recurrence utils) 이미 라이브였고, **2건 실제 버그/갭 발견·수정**:
- **🔴 버그: 인스턴스 project_id 누락** — `recurringTaskGenerator` create에 `project_id` 빠져 프로젝트 정기업무 인스턴스가 project_id=NULL → 프로젝트 업무목록(`where project_id`)에서 사라짐. **dev 11건 고아 확인**. create에 `project_id: parent.project_id` 추가 + dev 백필 완료(고아 0).
- **갭: reviewer 미복사** — review_policy만 복사되고 TaskReviewer 미복사 → reviewer 필요 정기업무 인스턴스가 완료 불가. parent reviewer를 인스턴스로 복사(state=pending 리셋) 추가.
- **검증:** 헬스 29/29 · E2E **7/7**(project_id 복사·reviewer 복사·pending 리셋·멱등·next_occurrence 전진).
- **운영 백필 SQL (배포 후 1회 실행 — memory G):** `UPDATE tasks t JOIN tasks p ON t.recurrence_parent_id=p.id SET t.project_id=p.project_id WHERE p.project_id IS NOT NULL AND t.project_id IS NULL;` (idempotent)
- **미배포 커밋:** recurringTaskGenerator fix → 다음 `/배포` + 운영 백필.

## ✅ 청구서 상세 드로어 증빙 정정 이력 (2026-06-13 18:00, commit `84210f8`, dev·미배포)
정정 이력이 큐뿐 아니라 InvoiceDetailDrawer 증빙 섹션에도 표시(GET /corrections 재사용). 헬스29/29·빌드EXIT0·E2E 2/2.

## ✅ 수정세금계산서·증빙 취소 흐름 Phase 1 운영 라이브 (deploy `20260613_182837`, 133초, commit `0906a5c`)
운영 헬스 200·프론트 200·PM2 2/2·**receipt_corrections 테이블 16컬럼 자동 생성 확인**·corrections 라우트 익명 401. dev: 헬스 29/29·빌드 EXIT0·E2E 13/13.

## ✅ 수정세금계산서·증빙 취소 흐름 Phase 1 (2026-06-13 17:55, commit `52b4d92`, dev 검증완료)
부가세법 §70 6 수정사유 마킹 추적(홈택스 자동발행 X). 설계: `docs/RECEIPT_CORRECTION_DESIGN.md`.
- **DB:** `receipt_corrections` 테이블 신규(원 발행 보존 + 정정 참조 이벤트, 감사 이력). sync-database 생성 확인. 운영 deploy 시 sync_database 가 CREATE — `SHOW TABLES LIKE 'receipt_corrections'` 검증 필요.
- **백엔드:** POST `/:biz/:id/corrections` + `/installments/:instId/corrections` + GET 이력. owner_only+audit(`invoice.receipt.correction`)+broadcast+멤버알림+고객통지(`sendReceiptCorrectionEmail`). `receiptsDue` 유효상태 파생(corrected/amended/canceled, 취소+발행+미정정→correction_pending) — 취소건도 fetch 포함하도록 변경(초안만 제외).
- **프론트:** `markReceiptCorrection` + CorrectionModal(사유 PlanQSelect + 사유별 안내박스 + 증감액/고객메모) + 큐 유효상태 배지(수정필요/수정발행/취소발행) + 수정·취소 액션. qbill i18n 591/591.
- **검증:** 헬스 29/29 · 빌드 EXIT0 · 백엔드 E2E **14/14**(6사유·correction_pending→canceled 전이·amended·고객통지 EmailLog·owner_only 403·멀티테넌트 403·잘못사유 400·회차 현금영수증).
- **미배포:** `52b4d92` → 다음 `/배포`(신규 테이블 sync_database 자동).
- **Phase 2(추후):** 정정 PDF · insights 정정 반영 · InvoiceDetailDrawer 정정 이력 표시 · 팝빌 자동발급.

## ✅ 운영 피드백 #34/#35/#36 정리·회신 완료 (2026-06-13 16:55, 코드 변경 0)
v1.34.0에서 고쳐 배포됐으나 티켓이 'pending'·미회신이던 것 정리. 운영 코드 반영 grep 검증 후 close.
- 운영 반영 확인: #36 `access_scope.js` owner_id fallback · #35 `focusSync.js`+`taskActualHours.js` · #34 빌드 flex-shrink.
- #35/#36(lua=운영 user 3) → respond 라우트로 status='done'+회신+알림 발송(200). #34(Irene 본인) → DB 직접 close(자가 알림 생략).
- 3건 모두 status='done', admin_response 작성, lua 알림 2건 생성 확인.

다음 후보: 신규 개발(Qinfo 공유 / 단계 되돌리기 / 수정세금계산서) 또는 청구서 PDF 기존 i18n 정리.

---

**이전:** 2026-06-13 16:25 — **문서 PDF 다운로드 운영 라이브 (deploy `20260613_163008`, commit `e9cbc16`).**

## 🔖 직전 작업 — 문서 PDF 다운로드
Document(계약/공식문서) PDF 라우트 신설 + posts 서버PDF 격상. 청구서 Puppeteer 엔진 재사용, DB 0.
- **백엔드:** `pdfTemplates.documentPdfHtml`(postPdfHtml 미러, body_html/body_json). `docs.js` GET `/documents/:id/pdf`(멤버 assertReadAccess+client scope) + GET `/public/:token/pdf`(공유, 만료검사). `renderPdfFromHtml` 재사용, attachment+RFC5987 한글파일명.
- **프론트:** `docs.downloadDocumentPdf`/`posts.downloadPostPdf` — **인증 blob fetch**(authenticateToken은 Authorization 헤더만 받아 window.open 불가, 그래서 blob 방식). DocumentEditorPage "PDF 다운로드" 버튼+에러표시. ProjectPostsTab `window.print()`→서버 PDF 격상.
- **검증:** 헬스 29/29 · 빌드 EXIT0 · E2E: 문서 PDF 7/7(멤버 200·유효 %PDF 바이너리 68KB·attachment헤더·멀티테넌트 403·익명 401·공개 200·404) + posts PDF 200 유효 · i18n 신규 하드코딩 0(추가한 'PDF 생성 실패' fallback→t() 교체). 
- **함정 박제:** `authenticateToken`은 Authorization 헤더 전용 → 멤버 PDF는 `window.open` 불가, 인증 blob fetch 필수. (청구서 InvoiceDetailDrawer의 window.open 멤버 PDF는 잠재 미인증 — 별도 확인 필요).
- **미배포 커밋:** 이번 문서 PDF → 다음 `/배포`(DB 변경 0).

다음 후보: 운영 백로그(Qinfo 공유 / 단계 되돌리기) 또는 수정세금계산서.

---

**이전:** 2026-06-13 16:01 — **v1.36.0 회차별 현금영수증 운영 라이브 (deploy `20260613_155838`, commit `1478c7f`).** 운영 헬스 200·프론트 200·PM2 prod online·운영 DB cash_receipt 3컬럼 자동 추가 확인(sync_database). dev 검증: 헬스 29/29·빌드 EXIT0·E2E 9/9(회차별·멀티테넌트·owner_only·세금계산서 회귀없음). 다음: 운영 백로그 또는 수정세금계산서 흐름.

## 🔖 직전 작업 — 회차별 현금영수증
분할 결제에서 회차마다 입금 시점 현금영수증 발급(거래 건별 원칙). 세금계산서 회차 패턴 미러링.
- **DB:** `invoice_installments` + `cash_receipt_no`/`cash_receipt_at`/`cash_receipt_marked_by` (sync-database 자동 반영 확인 — ENUM 아님, 운영도 deploy sync_database 가 자동 추가).
- **백엔드:** `POST /:biz/:id/installments/:instId/mark-cash-receipt` (owner_only+audit `invoice.installment.mark_cash_receipt`+broadcast+멤버/고객통지). `receiptsDue.buildReceiptRows` — 분할이면 세금계산서/현금영수증 **모두 회차별** 산출(기존 cash invoice-level only → 회차 분기 추가). 단건은 invoice-level 유지.
- **프론트:** `markInstallmentCashReceipt` + `ApiInstallment` cash 필드. `TaxInvoicesTab` IssueModal **4-way** 라우팅(cash+installment→회차 / cash 단건 / tax+installment / tax 단건).
- **검증:** 헬스 29/29 · 빌드 EXIT0 · E2E 10/10(분할 cash 회차별 산출·회차1 발행·status 전이·고객메일·owner_only 403) · DB 컬럼 반영 · i18n 신규 하드코딩 0.
- **미배포 커밋:** 이번 회차별 현금영수증 → 다음 `/배포`(sync_database 가 3컬럼 자동 추가).

다음 후보: 운영 백로그(Qdocs·Qinfo 공유, 단계 되돌리기, 문서 PDF 다운로드) 또는 증빙 잔여(수정세금계산서 흐름).

---

**이전:** 2026-06-13 15:48 — **증빙 루프 완성 운영 라이브 (deploy `20260613_154506`, 131초, commit `cc6a4bf` · prod-backend v1.35.0).**

## 🔖 직전 작업 — 증빙 루프 완성 (발행완료 고객 통지 + 취소 후 증빙 정리)
방금 라이브한 증빙 큐(v1.35.0)의 끝단 마무리. 백엔드 2파일만(emailService.js + invoices.js), DB·프론트 변경 0.
- **① 발행완료 고객 메일** — `emailService.sendReceiptIssuedEmail`(emailWrap+발신전용 footer+공개링크 CTA, 세금/현금 분기, template='receipt_issued'). 3 mark 라우트(installment tax/invoice tax/cash)에서 발행 직후 고객 통지. 수신자 우선순위: `receipt_profile.tax_email` > Client `tax_invoice_email`/`billing_contact_email`/`invite_email` > `invoice.recipient_email`. 형식검증(EMAIL_RE)+명시적 수신자만(미인증 자동메일 금지). mail_from_name/reply_to 반영.
- **② 취소 후 증빙 정리** — PATCH status→canceled 시 발행된 증빙(tax_invoice_status/cash_receipt_status=issued 또는 분할 tax_invoice_no) 있으면 owner/admin에 "세금계산서/현금영수증 취소·수정 필요" 알림 + AuditLog `invoice.receipt_correction_needed`. 자동발행/취소는 안 함(외부 수동). 미발행 취소는 noise 없음.
- **검증:** 헬스 29/29 · E2E 9/9(고객메일 기록·수신자없음 skip·취소 audit+알림·미발행 noise차단). **함정:** `&&` 체인 안 `node -e`가 DB 연결로 안 끝나 pm2 restart 누락 → 구코드로 검증돼 처음 실패. 클린 재시작 후 통과(검증 시 재시작 확정 필요).
- **미배포 커밋:** 이번 루프 완성 → 다음 `/배포`.

다음 후보(memory `project_receipt_compliance_queue`): 회차별 현금영수증(DB 컬럼) · 운영 백로그(Qdocs·Qinfo 공유 등).

---

**이전:** 2026-06-13 15:24 — **v1.35.0 증빙 발행 큐 통합 운영 라이브 (deploy `20260613_152008`, 134초, commit `3c40db0`).** 버전 1.34.0→1.35.0.

**배포 검증:** Changed files 9 · DB sync OK · PM2 prod-backend(1.34.0)+prod-qnote online · 운영 헬스 200(내부 3004+외부 HTTPS) · 프론트 200 · 신규 `/receipts-due` 익명 401 가드. dev: 헬스 29/29 · 빌드 EXIT0 · API E2E 17/17.

## ⚡ 빠른 재개 (새 세션)
```
session-state.md 읽고 이어서 개발해.
```

## 🔖 지금 상태 — 증빙 발행 큐 통합 (컴플라이언스 큐로 재정의)
30년차 기획 검증 결과 기존 "UI 확장"은 핵심(법정 기한·단일원천)을 놓침 → **컴플라이언스 큐**로 재정의해 구현 완료.

**완료된 작업 (이번 세션, dev only — 운영 미배포):**
- **`services/receiptsDue.js` 단일 진실 원천** — `buildReceiptRows`/`fetchReceiptRows`. receipt_type 기반(세금계산서·현금영수증·단건·분할·외부수신자·레거시 fallback) + 법정기한(세금계산서 익월10일/현금영수증+7일) + urgency(overdue/soon/normal). `iso()` 로 날짜 정규화(Date.localeCompare sort 크래시 fix).
- **`GET /api/invoices/:biz/receipts-due`** (invoices.js, /:id 앞 literal, invoiceListWhere 접근제어).
- **대시보드 인박스 `collectTaxInvoices` 교체** — 같은 헬퍼 사용 → 큐와 숫자 일치 (과거 둘 다 `client.is_business` 따로 계산하던 갭 제거).
- **사업자번호 체크섬** `isValidKrBizNo` — public receipt-request에 적용(형식 10자리만 → 체크섬).
- **`TaxInvoicesTab.tsx` 통합 큐 재작성** — 구분(세금/현금) 배지 + 발행기한 임박/초과 뱃지·정렬 + overdueBanner + 단건/분할 인라인 발행 + 3-way IssueModal + socket/useVisibilityRefresh(§16). 서비스 `listReceiptsDue`+`ReceiptDueRow`.
- **탭 라벨** 세금계산서→증빙 / Tax invoices→Receipts. qbill.json ko/en **554/554 키 정합**.

**검증:** 빌드 EXIT0 · E2E **18/18**(단일원천 산출·세금단건/현금단건/분할 3-way 발행·status 전이·owner_only 403·멀티테넌트 403·체크섬 400/200·미결제 제외) · 대시보드 todo 200 · i18n 하드코딩 0 · 테스트 부수효과로 오염된 seed client 10 복원 완료.

**의도적 보류(다음 사이클) — memory `project_receipt_compliance_queue`:** 회차별 현금영수증(InvoiceInstallment cash 컬럼 필요)·수정세금계산서/취소·발행완료 고객 메일·팝빌 실발행(운영 실시작 때).

**미배포 커밋(누적):** `454c54a`(QBill i18n 정리) + 이번 증빙 큐 작업 → 다음 `/배포` 시 함께.

---

### (배포 완료) v1.34.0 + 송금완료 알림 핫픽스

### 송금완료 알림 핫픽스 (c6b6093) — 운영 라이브
- 공개 결제 페이지 "송금 완료 알림 보내기"가 `inbox:refresh` 소켓만 보내고 `notify`를 안 불러 owner 알림이 0이던 기존 버그(`feedback_notify_trigger_required` 계열). → owner/admin/청구담당자에게 `payment` 알림(알림함+OS push+실시간 종) 발송 + 5분 중복 dedup. 분할·단건 양 분기. link normalizeLink path 정규화. E2E 7/7.

### v1.34.0 (이번 세션) — 운영 라이브
- **#36 업무 프로젝트 변경 저장 실패** — `getUserScope`에 `businesses.owner_id` fallback 중앙화(#14 전파 누락 회귀) + ws-admin 포함 + 프론트 셀렉트 게이팅. E2E 통과.
- **증빙(세금계산서+현금영수증)** — invoices `payment_method`/`receipt_type`/`receipt_profile(JSON)`/`cash_receipt_*` 컬럼(운영 자동 반영 확인). 공개 결제 페이지에서 고객이 사업자/개인 증빙정보 **직접 입력·확인**(송금완료 알림과 같은 자리) → owner가 확인된 정보로 발행. 등록고객 Client prefill·재저장, 외부고객 invoice 보관. 단건 mark-tax-invoice/mark-cash-receipt(owner_only) + 드로어 표시·발행.
- **이메일 발신전용/문의 일원화** — Gmail SMTP(help@irenewp.com)로 help@planq.kr 발송이라 회신 불가 → 모든 메일 푸터 "발신 전용·회신 불가" + "문의하기" CTA(/contact), mailto 제거. 공개 청구서 페이지 문의 링크.
- **#35 포커스 실제시간+주간그래프** — 포커스 실측을 actual_hours SSOT로 우선 반영 + daily-progress 집계 Map 키 Date→문자열 정규화 + estimated fallback(요일별 누적 복구).
- **#34 결제 배너 레이아웃 이탈** — MainLayout flex column 앱셸(배너 flex-shrink:0 + PageScroll flex:1) + PanelLayout viewport→height:100% (채팅입력란 넘침·점프 차단).
- **검증** — 헬스 29/29 · 빌드 EXIT0 · 멀티테넌트 4/4 · 신규 i18n 하드코딩 0 · 실제 청구서 발행+이메일 발송(EmailLog #392 sent, irene@irenewp.com) · 운영 DB 컬럼 반영.

### 정리 대기 (Irene 열람 후)
- dev 예시 청구서: id 80(INV-2026-0021, biz5) + id 84(증빙·발신전용 검증, biz3, irene@irenewp.com 발송) — 열람 확인 후 삭제 가능.

### 운영 과제 (코드 아님 — Irene DNS/메일)
- planq.kr **SPF/DKIM/DMARC** + help@planq.kr **실수신함**(또는 Gmail "다른 주소에서 보내기" 별칭 인증). 그 전까지 발신전용 전제. 메모리 `project_email_planq_kr_deliverability`.

---

**이전:** 2026-06-13 — **v1.33.4 운영 배포 + 청구서 철저 검증 + QBill i18n 정리.** 작업 상태: 완료.

---

## 현재 작업 상태
**작업 상태:** 완료 (배포 1건 + 검증 + i18n 정리 커밋)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **v1.33.4 운영 배포** (`20260613_043842`) — #14(업무 삭제 fix)·#26(팝아웃 PiP Pin)·#32(세금계산서 업태/종목)·#33(공개 알림 숨김). 운영 헬스 200·PM2 prod online·`biz_type/biz_item` 컬럼 자동반영 확인.
- **운영 피드백 회신** — #14·#26·#28·#32·#33 → done + 회신 (#14 lua 알림, Irene 본인 항목 자가 push 생략).
- **청구서 철저 검증** — 백엔드 E2E 24/24 PASS, 재무 mutation 7곳 owner_only, 멀티테넌트 격리, 익명 보호 모두 정상.
- **QBill i18n 정리** (커밋 `454c54a`, 미배포) — 내부 발행 화면 ~31건 t() 전환 + qbill.json ko/en 각 494키 정합. (고객 결제 페이지는 원래 정상이었음 — 처음 오판 정정.)
- **예시 청구서 발행** — dev biz5에서 INV-2026-0021(₩3,300,000) → irene@irenewp.com 메일 + 공개링크.

### 다음 할 일 (다음 세션 시작점)
1. **신규 운영 버그 3건 개발** (우선순위순):
   - **#36** 기존 업무에 '프로젝트명' 변경/추가 시 저장 실패 (실사용 차단)
   - **#35** 포커스 타이머로 업무 완료해도 실제시간 미입력 + 주간 진척 그래프가 요일별 누적 안 되고 당일만 표시
   - **#34** 결제 안내 배너 뜨면 데스크탑앱 화면 레이아웃 이탈(위아래 움직임)·채팅입력란 넘어감
2. **다음 `/배포` 시 QBill i18n(`454c54a`) 포함** — 아직 운영 미반영.
3. 정리(선택): dev biz5 데모설정(brand_name 워프로랩·계좌 등) + 예시 청구서 INV-2026-0021(id 80) — Irene 열람 확인 후 원복/삭제.

### 미배포 커밋 (운영에 아직 없음)
- `454c54a` QBill 내부화면 i18n 정리
- (그 위 v1.33.4분 #14/#26/#32/#33 은 배포 완료)

### 참고 — 검증 교훈
- `t('key', '한국어 기본값')` 은 **하드코딩이 아님** (i18n + fallback). 하드코딩 grep 시 `grep -v "t("` 로 t() 호출 줄 제외해야 오판 안 함. ko/en JSON 키 존재 여부로 실제 영어 지원 판정.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
