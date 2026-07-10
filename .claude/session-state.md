# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-10 (Opus, 1M) — 아키텍처 탈속인화(Fable 감사) + 이메일 알림 모바일 실버그 fix + 설계문서 3종 코드 실측 갱신
**작업 상태:** 완료 (dev 검증만 — **미배포**)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-10)

Irene "Claude 없어도 안전하게 확장하게 구조·아키텍처·스킬 보완해" 지시 → Fable 감사·구현. 헬스 29/29 · guard-invariants 13/13 · e2e tenant 0실패 · tsc error 0 · 위키 게이트 exit0.

1. **🏛️ 아키텍처 탈속인화** — CLAUDE.md 불변식 13종을 *문서→자동 게이트*로 전환.
   - 신규 `scripts/guard-invariants.js`(mock/i18n·ko-en 패리티/무스코프/pagination/notify·broadcast·costGuard·재무owner/god-file 래칫 — 하드·잠금·래칫 3방식) + `guards-baseline.json`
   - 신규 `scripts/e2e/canary-tenant.js`(멀티테넌트 403 실증, 대조군200 공허방지) + run.js `tenant` 스위트
   - `docs/ONBOARDING.md`(memory 없이 진입) + `/온보딩`·`/아키감사` 스킬
   - `/검증`·`/개발완료` 0단계에 가드 3축 편입 완료
   - 박제 [[project_guard_invariants_depersonalization]]

2. **📧 이메일 알림 모바일 문구 fix (Irene 실사용 호소)** — 미읽음 알림 에스컬레이션 메일(`emailService.js unreadNotificationEmailHtml`)이 회색 보일러플레이트("앱 알림 못 받으셨을 수 있어…")로 실내용 밀어냄 + preheader 부재로 모바일 미리보기줄 잠식. 보일러플레이트 하단 강등 + 실내용 최상단 + preheader=첫 알림제목 명시. 렌더 실측 검증 완료.

3. **📚 설계문서 3종 코드 실측 갱신 (docfresh 12/13→13/13)** — SYSTEM_ARCHITECTURE(480→646, 오기7 정정) · DATABASE_ERD(923→1162, 신규 테이블 85개, 108모델 커버리지 100%) · PERMISSION_MATRIX(526→607, 메뉴권한L3·워크플로우 권한열·owner_only 5→11 정정).

---

## ✅ admin role 해결 완료 (2026-07-10, Irene "fable에게 물어봐, 정석 개발로" → Fable 판정 A → 구현·검증, dev만)

Fable 반전: 죽은 스캐폴드 아니라 **N+21 배포기능의 DB 결손 사고**(설정 "관리자로" 버튼 owner 노출·승격 라우트·17파일 admin 분기 완비인데 ENUM 결손으로 owner 가 승격 누르면 **라이브 500**). 정석 = (A) 활성화.
- **근본 fix:** `BusinessMember.js:46` ENUM 에 admin **append**(모델=SSOT → sync 재-strip 차단) + dev DB ALTER + `health-check.js` ENUM 유지 감시(30/30).
- **잠복 버그 2건 동시수정 (E2E 가 잡음):** ①`access_scope.js attachWorkspaceScope` `allowed` 세트 `isAdmin` 누락 → admin 전 라우트 403 잠김 ②File·Kb 가시성 헬퍼 4개 admin 누락 → L3/L4 워크스페이스 파일·KB 못 봄. 둘 다 fullView 패턴 정렬.
- **실 HTTP 검증:** 승격 200(500 해소)·DB admin·admin 게이트 통과·파일목록 200·**admin invoice 403 owner_only(재무 불변식)**·강등 복원 + 가시성 canAccess 시맨틱 통과. 가드 3축 green(health 30/30·guard 13/13·tenant 0).
- **문서·memory 정정:** PERMISSION_MATRIX·DATABASE_ERD "스캐폴드/부재" → "활성", memory `project_workspace_admin_role` ✅.
- **⚠️ 운영 미배포** — 운영 반영 시 운영 DB 에 `ALTER TABLE business_members MODIFY COLUMN role ENUM('owner','member','ai','admin') NULL DEFAULT 'member'` **수동 선행** 필수(ENUM append=INSTANT, sync 의존 금지).

## 🔴 Irene 판단 대기 (거버넌스 SSOT — Claude 임의수정 불가)

1. **CLAUDE.md Fable 게이트 ② 목록에 guard-invariants 1줄 등재** — Fable 이 "CLAUDE.md=거버넌스 SSOT라 에이전트 승인 불가"로 의도적 보류. 실효는 스킬 편입으로 달성. Irene 직접 스탬프 사안.
2. 부수: refresh_tokens.client_kind CLAUDE.md 2값 → 실제 4값(ios/android).

---

## 🚀 배포 상태

**이번 세션 전부 미배포.** 운영 반영하려면 명시적 `/배포`. 자동저장 크론이 wip 커밋만 함(origin push 안 됨 — 이 개발완료 커밋이 push까지).

이메일 fix 는 운영 반영 가치 있음(실사용 호소). /배포 시 backend(emailService.js) 반영.

---

## 🔖 다음 할 일

1. **Irene: admin role 판단** (활성화 vs 제거) — 위 판단대기 #1.
2. **이번 세션 운영 배포** (/배포 대기, 특히 이메일 fix).
3. **운영 Stripe 활성화** (Irene 몫 — sk_live roll·관리자/워크스페이스 키·webhook·소액 스모크).
4. **검사 하니스 다음 보강** — chrome-suppression 스위트(FAB/배너 라우트 전수) · canary-crawl 라우트 자동 인벤토리(App.tsx Route 정적파싱) · 기능완결성 스위트. (INSPECTION_PLAYBOOK §5)
5. **P1 부채** — god-file 분리(`projects.js` 3071·`invoices.js` 2229[생명선]·`QNotePage.tsx` 4464), QTalk `Mock*` 이름부채·`RightPanel.tsx:196` 하드코딩 id.
6. Irene 확인대기: #133 폰 아젠다 · #126 구글캘린더 양방향 OAuth.

---

## 🔑 환경/인증 현황
- dev 백엔드 port 3003 (irene PM2 planq-dev-backend). q-note 8000/운영 8001.
- 운영: 87.106.78.146 port 3004 (planq-prod-backend/planq-prod-qnote). POS 공존(건드리지 말 것).
- 가드 3축: `node scripts/health-check.js` + `node scripts/guard-invariants.js` + `node scripts/e2e/run.js --suite tenant`. 큰 사이클엔 `--suite mobile,crosscut,l1,tenant`.
- Stripe 키: dev·운영 모두 미저장(휴면). EMAIL_ENCRYPTION_KEY dev 미설정.

---

## 📂 주요 문서
- 온보딩(신규): `docs/ONBOARDING.md` — 새 실행자 첫 진입
- 가드: `scripts/guard-invariants.js` · `scripts/e2e/` · `docs/qa/INSPECTION_PLAYBOOK.md`
- 설계(2026-07-10 갱신): `docs/SYSTEM_ARCHITECTURE.md` · `docs/DATABASE_ERD.md` · `docs/PERMISSION_MATRIX.md`
- 메모리: `project_guard_invariants_depersonalization` · `project_workspace_admin_role`(🔴admin 부재) · `project_inspection_harness_plan`

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
