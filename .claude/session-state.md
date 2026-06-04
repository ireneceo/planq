# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-04 (사이클 N+86)
**작업 상태:** **운영 라이브 v1.32.0** (deploy `20260604_111416`, commit `1d48770`). Q Bill 결제 독촉 보내기.

---

## 완료된 작업 (이번 세션 — 운영 라이브 v1.32.0)

### Q Bill 결제 독촉 보내기 (N+86)
- "입금 확인 대기"의 반대쪽 — 은행계좌·수동 결제 운영 루프 완성. **입금 확인 대기**(고객 송금보고→확인) ↔ **결제 독촉**(미결제→운영자 리마인더).
- **백엔드 신규** `POST /api/invoices/:biz/:id/send-reminder` — sent/partially_paid/overdue 만, `requireMenu('qbill','write')`+`checkBusinessAccess`. **per-user rate-limit 30/h + invoice별 6시간 쿨다운** + AuditLog(`invoice.send_reminder`) + `invoice:updated` broadcast + `meta.last_reminder_at`/`reminder_count`.
- **메일** `emailService.sendPaymentReminderEmail` (emailWrap 레이아웃 일관, 연체 시 빨강 강조).
- **프론트** `InvoiceDetailDrawer` "결제 독촉 보내기" 액션 + "최근 발송 N일 전" 툴팁 + ok/warn 인라인 피드백(토스트 금지). `ApiInvoice.meta` 타입 + `sendInvoiceReminder` 서비스.
- DB 스키마 0(meta 기존). E2E 12/12. 검증: 헬스 29/29·빌드 EXIT 0·운영 smoke 401.

---

## 직전 세션 (v1.31.0, 사이클 N+85)

### Q Bill 결제 자동화 — 검증 + "입금 확인 대기" 보강
- **요청 범위 확정:** 청구서 자동발행 + 은행계좌(계좌이체)만. 카드결제(PortOne)·오픈뱅킹 자동입금확인은 "운영 실제 시작 때"로 보류 (Irene 결정).
- **(b) 기존 자동청구 흐름 E2E 22/22 검증** — 구독 생성 → 자동발행 엔진(bill-now) → VAT/금액 → 발행(send) → 은행계좌 공개 결제페이지(익명) → 입금확인(mark-paid). 이미 ~80% 구현되어 작동 중임 증명. (`recurring_invoice.js` 프로젝트 월정액 + `clientSubscriptionBilling.js` 고객 정기구독, 매일 자정 cron)
- **(a) 신규 "입금 확인 대기" 섹션** — 고객 송금보고(`notify_paid_at`) 미확인 청구서를 Q Bill Overview 상단에 모아 표시 + owner 원클릭 확인(단건 PATCH status / 분할 mark-paid), 비owner는 drawer. 대기 0건이면 숨김.
- **실시간 §16:** OverviewTab 에 socket(invoice:*+inbox:refresh) + useVisibilityRefresh 추가 (notify-paid 가 inbox:refresh emit → 즉시 뜸).
- **백엔드 0 변경** (notify_paid_at 기존 컬럼). 프론트 3파일: `services/invoices.ts`(타입 2필드) · `pages/QBill/OverviewTab.tsx` · `qbill.json`(ko/en 9키).
- 데이터흐름 E2E **12/12**. 검증: 헬스 29/29 · 빌드 EXIT 0 · 멀티테넌트/권한 가드 정합 · i18n 0 하드코딩.

> **참고(다음 정리):** `OverviewTab.tsx` 기존 하드코딩 6건(`'어제'`, `${days}일 전`, `${month}월` — formatRelative/buildTrend 헬퍼, 이번 작업 아님) i18n 전환 후순위.

---

## 직전 세션 (v1.30.0, 사이클 N+84)
**deploy `20260604_081629`, commit `46a8e70`.** Q Task "Cue에게 말하기" 바 + iOS 채팅 입력 fix(확정) + 키보드 스크롤 + Cue 고객전용 게이팅. 진단 인프라 제거 완료.

---

## 완료된 작업 (이번 세션 — 전부 dev)

### ① Q Task "Cue에게 말하기" 바 (신규 기능)
- 헤더/탭 아래 상시 입력 바. 캐주얼 한마디 → Cue 가 업무로 정리 → 인라인 미리보기(모달 아님) → [추가].
- 신규 `components/QTask/CueTaskBar.tsx` + `AiCandidateCard.tsx`(분해 모달과 공유 추출, DRY). QTaskPage 마운트(week/all/workspace-tasks 탭).
- 백엔드 재사용 `/api/tasks/ai-create`(+/confirm) + 신규 `mode:'quick'`(한마디=1업무, 나열 시만 다중). i18n ko/en `ai.bar.*`.

### ② iOS 채팅 입력란 위로 사라짐 — **확정 해결** (Irene 아이폰 "이제 해결됐어")
- 근본: `index.html` viewport 메타 `interactive-widget=resizes-content` 제거(iOS 가 innerHeight 줄이고 phantom scroll) + `main.tsx` scrollTo(0,0) 가드.
- 메모리 [[feedback_mobile_chat_input_offsettop]] 갱신 완료(offsetTop translate 가설 폐기).

### ③ 키보드 up 시 채팅 맨 아래 자동 스크롤
- `ChatPanel.tsx` 키보드 핸들러 `distance<240` 가드가 키보드 높이만큼 커진 distance에 걸려 스킵 → shrinkAmount 보정 + RAF.

### ④ Cue 고객전용 게이팅
- `routes/projects.js` 메시지 라우트 — sender 가 내부 스태프(business_member, owner 포함)면 Cue 응답 스킵. 고객(외부) 발화만. 메모리 [[feedback_cue_client_only]].

### ⑤ 진단 오버레이 정리
- ViewportDebug 모바일 전용(데스크탑 검정 박스 제거) + dev hostname 게이트(dev 계정 이메일 irene@irenecompany.com 보완).

**검증:** 헬스 29/29 · 빌드 8GB EXIT 0 · API 6/6(Cue 게이팅·quick·멀티테넌트 403) · 서빙 200.

---

## 다음 할 일

1. **Irene 운영(planq.kr) 재확인**: 기존 홈화면 앱에서 채팅 입력란/키보드 스크롤/Cue 고객전용 정상 동작 — 운영 라이브됨.
2. (후순위) 결제 자동화(PortOne/팝빌), 고객 온보딩 심화, Google OAuth 검증 제출(Irene 액션).

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003 · prod: planq.kr / 87.106.78.146 / 3004 (v1.29.0)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘.`
