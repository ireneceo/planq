# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-13 13:55 — **작업 상태: 중단 (이어서 재개 예정).** v1.34.0 + 송금완료 알림 핫픽스 운영 배포 완료. 다음 개발(증빙 발행 큐 통합) 착수 직전 일시정지.

## ⚡ 빠른 재개 (새 세션)
```
session-state.md 읽고 이어서 개발해.
```

## 🔖 지금 중단 지점
**마지막 작업:** v1.34.0(증빙+이메일+#34/35/36) + 송금완료 알림 핫픽스 운영 배포 완료. dev 예시 청구서 id 80·84 삭제 완료. 다음 개발 착수 직전.

**바로 다음 작업:** **증빙 발행 큐 통합** — `dev-frontend/src/pages/QBill/TaxInvoicesTab.tsx`를 세금계산서 전용 큐 → **세금계산서+현금영수증 통합 증빙 큐**로 확장. (조사만 완료, 코드 변경 전 — 미완 없음)

**맥락 유지할 것:**
- 현재 갭: `TaxInvoicesTab` line 136 `if (!client?.is_business) continue;` → 현금영수증·외부수신자(client 없음)·고객 제출 receipt_profile·단건 인라인 발행 모두 빠짐. `대기`(line 113) 하드코딩.
- 백엔드 발행 라우트 3종 이미 존재: `markInstallmentTaxInvoice` / `markInvoiceTaxInvoice` / `markInvoiceCashReceipt`(`services/invoices.ts`, owner_only). buildRows에 cash 분기 + kind 배지 + receipt_profile 표시 + IssueModal 3-way 라우팅 + i18n(taxInvoices.kind.tax/cash 등 ko/en) 추가하면 됨.
- 증빙 데이터 모델: `Invoice.receipt_type('none'|'tax_invoice'|'cash_receipt')`, `receipt_profile(JSON: biz_type/biz_tax_id/.../cr_purpose/cr_identifier)`, `cash_receipt_status/cash_receipt_no`, `tax_invoice_status/tax_invoice_external_id`.
- 대안 우선순위(원하면 전환): 운영 백로그 — Qdocs·Qinfo 공유, 단계 되돌리기, 문서 PDF 다운로드 등.

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
