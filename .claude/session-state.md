# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-08 (Opus, 1M) — 캘린더 Fable 결함 7건 운영 배포 + origin push 완료
**작업 상태:** 완료 (끊긴 세션 마무리 — 미배포/미push 0)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-08, 이어서)

**끊긴 세션 마무리 — 캘린더 Fable 검증 결함 7건 운영 배포 + GitHub push.**

직전 세션이 **커밋(732a386)만 되고 배포·push 중 SSH 끊김**. 이번 세션에서 검증→재배포→push 로 마무리.

- 검증: health 29/29 · build EXIT0/TS0 · 위키 게이트 exit0.
- 배포: `./scripts/deploy-planq.sh --auto` (157s) → **landing 3점 검증** prod health 200(node_env=production)·프론트 HTTP200·PM2 planq-prod-backend uptime 재시작 확인.
- push: origin 미반영 9커밋(5b038fa..732a386) GitHub 반영, 미push 0.

**732a386 내용 (Fable 재검증 FAIL 실증 결함 7건):**
- **B-1(상, 데이터손실)** 반복 exception child 에서 '모든일정/이후' 삭제 시 master 미resolve → 시리즈 생존. child→master resolve 후 cascade/truncate.
- **B-2(중, 데이터손실)** future 삭제 UNTIL off-by-one(전날 00:00:00Z→시각 늦은 전날 회차 잘림) → target 직전순간(전날 23:59:59Z) 보존.
- **A-1(중)** 폰 기본 agenda 오늘 자동스크롤 loading 가드. **A-2** React key 중복 `_instance_key`. **A-3** 자정 종료 이벤트 다음날 유령노출 exclusive end. **A-4** 폰 month 새로고침 시 agenda 복귀 → view URL 항상 기록. **D-1** 멀티데이 시작시간 변경 시 종료 무단변형 → 같은 날짜만 follow.
- 파일: `routes/calendar.js`, `QCalendar/{AgendaView,EventDrawer,NewEventModal,QCalendarPage,types}.tsx`.

---

## ✅ 직전 세션 완료 (2026-07-08) — Stripe 카드결제 에픽

**Stripe 카드결제 전체 — 구독(platform) + Q Bill(workspace) — 운영 배포 완료.** (e40d406·c334685)
1. 구독 카드결제(platform merchant) — webhook 마운트(json前), plan.js stripe-checkout, F4 관리자 Stripe 입력란, CheckoutModal 카드 버튼. Fable 17/17.
2. Q Bill 워크스페이스 카드결제(workspace merchant) — 마이그레이션 7컬럼, `services/invoicePayments.js` 단일 착지점(markInstallmentPaid/markInvoicePaid, 수동+webhook 공유, 멱등), 워크스페이스별 `/api/stripe/webhook/ws/:businessId`, 공개 checkout(비인증 share_token·IP rate-limit·서버금액). Fable 48검증.
3. 전역 toJSON `*_enc→*_set` redaction — 시크릿 응답 차단(F-1 회귀 발견→수정).
4. 카드결제 발행자 알림 notifyOwnerCardPaid(stripe만, 멱등).
- 후속 증분(배포됨): 멤버 표시명 누출 수정(aa5baab), Stripe 네이티브 대응(fdc773f) [[feedback_member_display_name_on_lists]].

## 🔥 운영 피드백 처리 (2026-07-08, Fable 3-에이전트 검증)
- **#132** 알림 계정명 노출 → 배포(5b50e9b). **#104 캘린더 단일 GET vlevel 누출** → 배포(783a627).
- **#121·124·123·122** 캘린더 퀵픽스 → 배포(f357c92). **#133 모바일 아젠다 뷰** → 배포(9d994d1, **Irene 폰 시각확인 필요**).
- **#122·#133 후속 Fable 결함 7건** → 배포(732a386, 이번 세션 마무리).
- 이미 수정됨(큐 stale): #71·95·96·97·120·119·102·118·113·110·86·79 등 12+건 → Irene 큐 done 처리 권장.
- **#126 구글 양방향 = IRENE-BLOCKED**: calendar.events write scope + 구글 OAuth 검증 대기.
- 남은 중간건: Q Mail #130·109·107, Cue #81·90.

---

## 🔖 다음 할 일

**운영 Stripe 활성화 (Irene 몫 — 코드는 라이브, 기능 휴면):**
1. 채팅 노출됐던 `sk_live` **Roll**(폐기·재발급)
2. 운영 `EMAIL_ENCRYPTION_KEY` 설정 (없으면 F3 가드가 시크릿 저장 차단)
3. 관리자 `/admin/billing-settings` Stripe 섹션에 구독용 키 3종 입력
4. 워크스페이스별: Q Bill 설정 → Stripe 섹션 키 3종 + Stripe 대시보드에 `https://planq.kr/api/stripe/webhook/ws/{businessId}` 등록
5. 구독용 Stripe 대시보드 webhook: `https://planq.kr/api/stripe/webhook`
6. 운영 소액 실결제 + 환불 스모크 (Irene 결정: 결제 테스트는 운영에서)

**Irene 확인 대기:**
- #133 모바일 아젠다 뷰 폰 시각확인
- #126 구글 캘린더 양방향 = 구글 OAuth 검증(콘솔 제출 시 calendar.events justification 포함)

**그 외 신규 개발:** Irene 지시 대기.

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
