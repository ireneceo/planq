# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-04 (사이클 N+86)
**작업 상태:** **완료 · 운영 라이브 v1.32.0** (deploy `20260604_111416`, commit `1d48770`, 버전 bump `b740770`). Q Bill 결제 독촉 보내기.

---

## 완료된 작업 (이번 세션 — 운영 라이브 v1.31.0 + v1.32.0)

### v1.32.0 / N+86 — Q Bill 결제 독촉 보내기
- "입금 확인 대기"의 반대쪽 — 은행계좌·수동 결제 운영 루프 완성. **입금 확인 대기**(고객 송금보고→확인) ↔ **결제 독촉**(미결제→운영자 리마인더).
- **백엔드 신규** `POST /api/invoices/:biz/:id/send-reminder` — sent/partially_paid/overdue 만, `requireMenu('qbill','write')`+`checkBusinessAccess`. **per-user rate-limit 30/h + invoice별 6시간 쿨다운** + AuditLog(`invoice.send_reminder`) + `invoice:updated` broadcast + `meta.last_reminder_at`/`reminder_count`.
- **메일** `emailService.sendPaymentReminderEmail` (emailWrap 일관, 연체 시 강조).
- **프론트** `InvoiceDetailDrawer` "결제 독촉 보내기" 액션 + "최근 발송 N일 전" 툴팁 + ok/warn 인라인 피드백(토스트 금지). `ApiInvoice.meta` 타입 + `sendInvoiceReminder` 서비스.
- DB 스키마 0. E2E 12/12. 검증: 헬스 29/29·빌드 EXIT 0·운영 smoke 401.

### v1.31.0 / N+85 — 결제 자동화 검증 + "입금 확인 대기" 보강
- **범위 확정 (Irene 결정):** 청구서 자동발행 + 은행계좌(계좌이체)만. **카드결제(PortOne)·오픈뱅킹 자동입금확인은 "운영 실제 시작 때"로 보류.** [[project_billing_automation_scope]]
- 기존 자동청구 흐름 E2E **22/22** 검증 (이미 ~80% 구현 — `recurring_invoice.js` 프로젝트 월정액 + `clientSubscriptionBilling.js` 고객 정기구독, 매일 자정 cron).
- 신규 **"입금 확인 대기"** 섹션 — 고객 송금보고(`notify_paid_at`) 미확인 청구서를 Q Bill Overview 상단에 모음 + owner 원클릭 확인. 실시간 §16(socket + useVisibilityRefresh). 백엔드 0 변경, 데이터흐름 E2E 12/12.

> **다음 정리 후순위:** `OverviewTab.tsx` 기존 하드코딩 6건(`'어제'`, `${days}일 전`, `${month}월` — formatRelative/buildTrend, 이번 작업 아님) i18n 전환.

### 직전 (v1.30.0 / N+84)
Q Task "Cue에게 말하기" 바 + iOS 채팅 입력 fix(확정) + 키보드 스크롤 + Cue 고객전용 게이팅. 진단 인프라 제거.

---

## 다음 할 일
- (후보 1) **고객 온보딩** — 현재 견고함 확인됨(환영 대화 자동생성·자동선택, 빈 상태 존재). 추가 개선은 product 방향 필요 시.
- (후보 2) **외부 연동 Phase 5~7** — Microsoft(Outlook/OneDrive) + 옛 email_accounts 모델 마이그레이션 (N+76 후순위).
- (후보 3) `OverviewTab.tsx` 기존 하드코딩 6건 i18n 정리 (소).
- (보류) 결제 카드(PortOne)·오픈뱅킹 자동입금확인 — 운영 실제 시작 시점. Google OAuth 검증 제출 — Irene 콘솔 액션.

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003 · prod: planq.kr / 87.106.78.146 / 3004 (운영 v1.32.0)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘.`
