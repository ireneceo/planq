# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-09 (Opus, 1M) — 검사 하니스 v2 + /tasks 모바일 키보드 실버그 수정, 운영 배포+push 완료
**작업 상태:** 완료 (미배포·미push 0)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-09) — 검사 하니스 v2 (Fable 분석·검증 게이트)

**"다해" + "Fable에게 무조건 분석·검증 시켜" 지시로 검사 하니스 보강 + 하니스가 잡은 모바일 키보드 실버그 수정.**

배포: `1fc57b8` (deploy 166s) → landing 3점 검증 prod health200(node_env=production)·프론트200·PM2 planq-prod-backend uptime 재시작. origin push 완료(b9954b9..1fc57b8).

**핵심 반전 (Fable 분석):** 하니스 v1 이 "확정 실버그"로 보고한 3화면 중 **settings·calendar 2건은 하니스 자체 오탐**, **/tasks 1건만 진짜 버그**.

- **Phase 0 판정엔진 교정** — `assertKeyboardSafe` 가 판정 후 `clearDeviceMetricsOverride` 호출 → puppeteer setViewport(375×667)까지 제거 → 원시창(780×493 데스크탑) 복귀 → 페이지당 첫 입력만 모바일 판정, 2번째부터 데스크탑 환경 오탐. 모바일 뷰포트 재-override+detach, `innerWidth===375` self-assert(오염 재발=FATAL exit2), `visibleInputs` 스코핑 `[role=dialog]`→`[aria-modal]`, `waitForInputs` 추가. (`scripts/e2e/lib/browser.js`·`mobile-keyboard.js`·`run.js`)
- **Phase 1 /tasks 진짜 버그** — 키보드 업(vvh337) 시 프로모배너(~138px) 세로공간 잠식 → Panel(overflow:hidden) 고정크롬 149>PageScroll 143 → CueTaskBar 침몰(스크롤부모 없어 ensureFocusedVisible 구제불가). `PushPromptWrap`+`Banner` 에 `@media(max-width:768px){ body[data-keyboard-up='1'] & {display:none} }`. 배너 role dialog→complementary(×2). NewEventModal aria-modal. **bottom 335→197 GREEN**, Fable 반증실험(억제 무력화 시 465 RED)으로 인과 증명. (`MainLayout.tsx`·`InstallPromptBanner.tsx`·`NewEventModal.tsx`)
- **Phase 2 스위트 확장** — `run.js` 에 crosscut(표시명)·l1(L1누출) 등록. `canary-l1.js` 신규(fileListWhereByLevel 를 실 scope+DB 쿼리로 검증, 트랩=vlevel L1+legacy visibility L3=c57d672 회귀지점). **표시명 누출 0·L1 누출 0**. data-testid 4곳 + URL-파라미터 opener(bills·tasks·calendar 모달 커버, bill-new 6입력 판정). `CLAUDE.md` 17번 + `FEEDBACK_REGRESSIONS.md` v2 박제.

**검증:** health 29/29 · tsc error 0 · `node scripts/e2e/run.js --suite mobile,crosscut,l1` exit 0(mobile 실패0·표시명0·L1 누출0) · **Fable /검증 PASS**(가드 전항목 실측 + 반증실험으로 하니스 교정=은폐 아닌 오탐제거 증명).

---

## 🔖 다음 할 일

**검사 하니스 다음 보강 (코드 — 바로 가능):**
- **chrome-suppression 스위트** — FAB/배너가 팝아웃·마케팅 라우트에서 억제되는지 전 라우트 전수(INSPECTION_PLAYBOOK §5). data-testid 셀렉터 기반.
- **canary-crawl 라우트 자동 인벤토리** — App.tsx `<Route>` 정적 파싱(신규 라우트 drift 차단).
- **기능완결성 스위트** — 상태머신 dead-end(버튼 부재 등) 검출.
- Fable 검증 발견(경미): `useListKeyboardNav.ts:25` role=dialog 의존(배너 complementary 파급, 실사용 극저) · 하니스 배너 렌더 비결정성(강제렌더 스텝 권장) · 시나리오 min-inputs 도입 권장.

**운영 Stripe 활성화 (Irene 몫 — 코드 라이브·기능 휴면):**
1. 채팅 노출됐던 `sk_live` Roll · 2. 운영 `EMAIL_ENCRYPTION_KEY` 설정 · 3. 관리자 `/admin/billing-settings` Stripe 키 3종 · 4. 워크스페이스별 Q Bill Stripe 키 + `https://planq.kr/api/stripe/webhook/ws/{businessId}` 등록 · 5. 구독 webhook `https://planq.kr/api/stripe/webhook` · 6. 소액 실결제/환불 스모크.

**Irene 확인 대기:** #133 모바일 아젠다 뷰 폰 확인 · #126 구글 캘린더 양방향 OAuth 검증.

**그 외 신규 개발:** Irene 지시 대기.

---

## 🔑 환경/인증 현황
- dev 백엔드 port 3003 (irene PM2 planq-dev-backend). q-note 8000/운영 8001.
- 운영: 87.106.78.146 port 3004 (planq-prod-backend/planq-prod-qnote). POS 공존(건드리지 말 것).
- 검사 하니스: `node scripts/e2e/run.js --suite mobile,crosscut,l1` (health-check 동급 게이트). puppeteer=dev-backend/node_modules.
- Stripe 키: dev·운영 모두 미저장(휴면). `EMAIL_ENCRYPTION_KEY` dev 미설정(JWT fallback).

---

## 📂 주요 문서
- 검사 하니스: `docs/qa/INSPECTION_PLAYBOOK.md` · `docs/qa/FEEDBACK_REGRESSIONS.md`(v2 대장) · `scripts/e2e/`
- 통합 결제: `docs/UNIFIED_PAYMENT_ARCHITECTURE.md` · 분리: `docs/SAAS_BILLING_VS_QBILL_SEPARATION.md`
- 메모리: `project_inspection_harness_plan` · `feedback_frontend_verify_real_build` · `project_qbill_workspace_stripe`

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
