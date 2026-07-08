# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-08 (Opus, 1M)
**작업 상태:** 완료 (Stripe 카드결제 에픽 전체 구현·운영 배포)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-08)

**Stripe 카드결제 전체 — 구독(platform) + Q Bill(workspace) — 운영 배포 완료.**

1. **구독 카드결제** — server.js webhook 마운트(json前), plan.js stripe-checkout, F4 관리자 Stripe 입력란, CheckoutModal 카드 버튼. Fable 17/17.
2. **Q Bill 워크스페이스 카드결제** — 마이그레이션 7컬럼(businesses/invoices/invoice_installments), `services/invoicePayments.js` 단일 착지점(markInstallmentPaid/markInvoicePaid, 수동+webhook 공유, 멱등), 워크스페이스별 webhook `/api/stripe/webhook/ws/:businessId`, 공개 checkout(비인증 share_token·IP rate-limit·서버금액), SettingsTab Stripe UI + PublicInvoicePage 카드 버튼. Fable 48검증.
3. **전역 toJSON `*_enc→*_set` redaction** — 모든 모델 암호화 시크릿 응답 차단. (Fable F-1 회귀 발견→수정, D8 webhook ack)
4. **카드결제 발행자 알림** — notifyOwnerCardPaid(method='stripe'만, 멱등). 구독측은 기존 notifyPlatformAdmins.
5. 위키 아티클 2건(qbill card-payment·settings pay-subscription) + coverage exit0. 운영 배포 2회(e40d406·c334685, DB 7컬럼 반영).

**검증:** Fable 게이트 2회 총 48 PASS·0 FAIL · 실호출 31/31+17/17+7/7+6/6 · health 29/29 · build EXIT0 · 위키 게이트 exit0.

**후속 증분 (전부 운영 배포):**
6. **멤버 표시명 누출 수정** (aa5baab) — OrgPage·멤버피커 4종·NewProjectModal 이 계정명 노출하던 것 → `displayName()`/`m.name`/`user.display_name` 표시명 우선. 박제 [[feedback_member_display_name_on_lists]].
7. **Stripe 결제 네이티브 대응** (fdc773f) — `services/native.ts openExternalUrl` — 네이티브는 인앱 브라우저(Browser.open)+닫힘시 reload, 웹은 리다이렉트. CheckoutModal+PublicInvoicePage. **네이티브 실기기 검증은 앱 배포 후(Irene Mac).**

**네이티브 완성도 스윕 결론:** 웹측 분기(safe-area 19파일·딥링크/백버튼 NativeBridge·nativePush·PWA↔native 문구) 이미 성숙. 유일 갭이던 Stripe 리다이렉트 수정 완료.

## 🔥 운영 피드백 처리 (2026-07-08, Fable 3-에이전트 검증)
운영 feedback_items 미처리 46건(pending 41+reviewing 5) 전수 확인. Fable 병렬 검증으로 이미수정/열림/규모 분류.
- **#132** 알림 계정명 노출 → 수정·배포(5b50e9b): 메시지 알림·공유메일 senderName getMemberDisplayName
- **#104 인접 보안 누출(Fable 실재현 발견)** → 수정·배포(783a627): `calendar.js:430` 단일 이벤트 GET 이 vlevel 미검사 → L2 이벤트 id만 알면 누출. 목록 라우트와 동일 vlevel 접근검사 적용. #106(Q file L1)·#104(캘린더 L1)은 CONFIRMED-FIXED
- **#121·124·123·122** 캘린더 퀵픽스 배치 → 배포(f357c92): 썸네일 contain / 등록후 드로어 자동오픈 제거 / 시작→종료시간 follow / 반복삭제 scope UI(백엔드는 이미 완비)
- **#133 모바일 아젠다 뷰** (Fable 설계→구현) → 배포(9d994d1): AgendaView.tsx, 폰 기본 agenda. 임팩트1위. **Irene 폰 시각확인 필요**
- **이미 수정됨(큐 stale)**: #71·95·96·97·120·119·102·118·113·110·86·79 등 12+건 (Fable 확인) → Irene 이 큐에서 done 처리 권장
- **#126 구글 양방향 = IRENE-BLOCKED**: calendar.events write scope + 구글 OAuth 검증 대기. 콘솔 제출 시 calendar.events justification 함께 포함 권장
- **남은 큰 것**: 없음(대부분 이미수정 or Irene선행). Q Mail #130·109·107, Cue #81·90 등 중간건 잔존

---

## 🔖 다음 할 일

**운영 Stripe 활성화 (Irene 몫 — 코드는 라이브, 기능 휴면):**
1. 채팅 노출됐던 `sk_live` **Roll**(폐기·재발급)
2. 운영 `EMAIL_ENCRYPTION_KEY` 설정 (없으면 F3 가드가 시크릿 저장 차단)
3. 관리자 `/admin/billing-settings` Stripe 섹션에 구독용 키 3종 입력
4. 워크스페이스별: Q Bill 설정 → Stripe 섹션 키 3종 + 각자 Stripe 대시보드에 `https://planq.kr/api/stripe/webhook/ws/{businessId}` 등록
5. 구독용 Stripe 대시보드 webhook: `https://planq.kr/api/stripe/webhook`
6. **운영 소액 실결제 + 환불 스모크** (Irene 결정: 결제 테스트는 운영에서)

**그 외 신규 개발:** Irene 지시 대기 (Stripe 에픽 완결, 별도 큐 없음).

---

## 🔑 환경/인증 현황
- dev 백엔드 port 3003 (irene PM2 planq-dev-backend). q-note 8000/운영 8001.
- 운영: 87.106.78.146 port 3004 (planq-prod-backend/planq-prod-qnote). POS 공존(건드리지 말 것).
- `EMAIL_ENCRYPTION_KEY` dev 미설정(JWT fallback). 운영 명시 설정 필요.
- Stripe 키: dev·운영 모두 미저장(휴면). 관리자/워크스페이스 UI 입력 시 AES-256-GCM 암호화 저장.

---

## 📂 주요 문서
- 통합 결제: `docs/UNIFIED_PAYMENT_ARCHITECTURE.md` · 분리 canonical: `docs/SAAS_BILLING_VS_QBILL_SEPARATION.md` · PG: `docs/SUBSCRIPTION_PAYMENT_DESIGN.md`
- 메모리: `project_qbill_workspace_stripe` · `project_subscription_payment_plan`
- 위키 유지: `docs/Q_WIKI_MAINTENANCE.md`

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
