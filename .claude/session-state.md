## 현재 작업 상태
**마지막 업데이트:** 2026-04-27
**작업 상태:** 완료 — Q Bill B2 정석 (mock 0건 · 청구서↔출처·채팅방·발송 통합 · CLAUDE.md mock 금지 강제)

---

## ⚡ 빠른 재개

```
session-state.md 읽고 다음 작업 (Phase C — 채팅 결제 요청 + 공개 결제 페이지) 이어서 해.
```

---

## 진행 중인 작업
- **없음** (Q Bill B2 모두 완료, Phase C 부터 다음 세션)

---

## 완료된 작업 (이번 세션, 2026-04-27)

### Q Bill B2 정석 개발
- **견적서 폐기**: QuotesTab/QuoteEditor/ComingSoonTab/mock.ts 삭제
- **5탭 재정의**: 개요/청구서/결제 추적/세금계산서/설정
- **OverviewTab**: 실 invoices 합산 KPI + 12개월 매출 차트 + 미수금 TOP + 최근 활동
- **InvoicesTab**: 검색 + 상태 chip + 분할 dot + 우측 상세 드로어 + URL 싱크
- **InvoiceDetailDrawer**: 모든 액션 실연결 (markPaid·unmarkPaid·markTax·cancelInst·cancelInvoice·copyShareLink) + ConfirmDialog + 출처 카드 + 세금계산서 마킹 모달
- **NewInvoiceModal**: 발신자 자동 채움 + 출처 후보 자동 + 채팅방 자동 검색 + 발송 옵션 통합 + 누락 사업자정보 인라인 보완 + Business 기본값 prefill
- **PaymentsTab**: 회차/단일 union 실 데이터
- **TaxInvoicesTab**: 사업자 고객만 + 결제완료 회차 큐 + 발행번호 마킹 모달 실연결
- **SettingsTab**: 발신자 정보 read-only (1개 진입점) + 입금 계좌 인라인 편집 + 청구서 기본값 인라인 편집 (AutoSaveField + PUT /billing)

### 백엔드
- **DB**: `invoices.source_post_id INT FK posts(id)` + `businesses.default_due_days/default_currency` 컬럼
- **POST /api/invoices**: source_post_id 검증 + milestone_ref 저장 + sourcePost include
- **POST /:id/send**: send_chat/send_email 옵션, Conversation 자동 검색 (project 우선 → client), 새 방 생성 X
- **GET /:bid/source-candidates**, **GET /:bid/find-conversation** 신규
- **PUT /:bid/billing** 신규 (bank_* + default_*)
- **emailService.sendInvoiceEmail** 추가

### 사용자 지적 4건 모두 즉시 반영
1. 청구서↔계약/문서 연결 (source_post_id)
2. "발행 후 어디로?" — 푸터에 명시
3. 채팅 보내기 = 기존 방 자동, 새 방 X
4. 모든 데이터 실 API (mock 0건)

### CLAUDE.md mock 절대 금지 강제
- 작업 워크플로우 최상위에 "🚫 mock 데이터 절대 금지" 섹션 신설
- 절대 금지 사항에 추가
- 메모리 `feedback_no_mvp.md` 강화
- 메모리 `feedback_button_plus_no_duplicate.md` 신규

### UI 보완
- 버튼 "+" 중복 제거 (qbill i18n 5곳)
- "+" 아이콘 정렬 (line-height: 1, svg display: block)
- 버튼 사이즈 통일
- Switch role/aria-checked
- ConfirmDialog로 window.confirm 교체
- 페이지 styled 위반 수정 (Header → DrawerHeader)
- raw select → PlanQSelect (currency/vatRate)

### 발견·수정한 버그
1. milestone_ref 저장 누락
2. Client.biz_representative → biz_ceo 필드명 오류
3. Post.kind 컬럼 없음 → category 사용
4. invoices 라우트 순서 (source-candidates가 :id로 매칭됨) → 위로 이동
5. Client.email 컬럼 없음 → tax_invoice_email 등 우선순위
6. Invoice.source_post_id 타입 불일치 (BIGINT vs INT) → INTEGER 통일

### 검증
- 헬스체크 27/27
- 백엔드 E2E 21/21 (정상/경계/권한)
- 빌드 통과 (마지막 번들 `index-vsqFuaUx.js`)
- Q Bill 영역 mock 잔존 0건
- raw select / window.confirm / alert / page styled 위반 모두 0건

---

## 다음 할 일 (우선순위)

### Phase C (채팅 결제 요청) — ~3일
- **C1**: 채팅 결제 요청 카드 + 공개 결제 페이지 `/public/invoices/:token`
  - 채팅 메시지 카드 클릭 → 공개 페이지 (입금 안내 + 입금자명 가이드)
  - "송금 완료 알림 보내기" 버튼 → 사용자에게 알림
- **C2**: 사용자 마킹 → 카드 자동 갱신 (✓ 결제 완료 표시)

### Phase D (통합 트리거 + 알림 + 통합 뷰) — ~6일
- **D1**: 서명/검수 → 후속 액션 카드 자동 표시
- **D2**: 알림 센터 (서명/결제/세금계산서/검수 일관 표시)
- **D3**: Q docs 리비전 비교 (Phase F 슬롯 시스템과 통합 검토)
- **D4**: **프로젝트/고객 단위 거래 통합 뷰** — 계약/청구/결제/세금계산서 타임라인 + 진행 보드

### Phase E (PDF · 메일 · 알림 인프라) — ~6일
- E1: PDF 생성 (Puppeteer 싱글톤) + post/invoice/signature 모두 적용
- E2: 메일 매트릭스 — 시스템 SMTP / 사용자 SMTP·OAuth + 청구서 메일에 PDF 첨부
- E3: 워크스페이스 메일 설정 (SMTP 검증 / OAuth 연결 / 발신 표시이름)
- E4: 알림 매트릭스 (이벤트 × 채널 × On/Off)

### Phase F (Q docs 슬롯 시스템) — ~5일
- 템플릿에 변수 슬롯 정의
- 문서 작성 = 폼만 입력 (본문 자동 채움)
- 슬롯 단위 변경 비교 + AI 위험 표시
- 발신/수신 자동 채움 (Business + Client biz_*)

---

## 환경 / 인증

- 백엔드: pm2 planq-dev-backend (port 3003)
- DB: planq_dev_db / planq_admin / CE5tloemiYjWNUIs
- 도메인: dev.planq.kr
- 헬스체크: `node /opt/planq/scripts/health-check.js` — 27/27 통과 상태
- 마지막 빌드: `index-vsqFuaUx.js` 서빙 정상

---

## 주요 문서 위치

- `/opt/planq/CLAUDE.md` — **🚫 mock 데이터 절대 금지 (최상위 원칙) 명문화 됨**
- `/opt/planq/docs/Q_BILL_SIGNATURE_DESIGN.md` — Q Bill 통합 설계 (B/C/D Phase 진행 시 참조)
- `/opt/planq/DEVELOPMENT_PLAN.md` (히스토리)
- 메모리: `/home/irene/.claude/projects/-opt-planq/memory/`
  - 이번 세션 신규/강화: `feedback_no_mvp.md`, `feedback_button_plus_no_duplicate.md`

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

또는 더 직접적으로:

```
Phase C — 채팅 결제 요청 + 공개 결제 페이지 구현해줘.
설계는 docs/Q_BILL_SIGNATURE_DESIGN.md §5.4 참고.
실 API 정석 개발. mock 절대 금지.
```
