## 현재 작업 상태
**마지막 업데이트:** 2026-05-05
**작업 상태:** 🟡 진행 — Q-R 사이클 코드 작성 완료, **검증·배포는 다음 세션 이어받기**

### 진행 중인 작업
- **Q-R 사이클** — Free 플랜 폐지 + Starter 14일 trial + Addon 자체결제 + 세금계산서 + 운영 안정화 UI
- 이전 세션이 도중에 멈춘 채로 발견 → 본 세션이 박제 commit + plan/session-state 정리만 수행
- 빌드·DB sync·검증·배포는 다음 세션이 이어받음

### 완료된 작업 (이번 세션)
- 멈춘 작업 식별 (25 modified + 8 new = +1700 line)
- DEVELOPMENT_PLAN.md 에 Q-R 사이클 섹션 + 검증·배포 10단계 체크리스트 박제
- session-state.md 갱신 (다음 세션 진입 명확화)
- 박제 commit + push (검증 안 된 코드를 main 에 올리는 건 정책 예외 — Irene 명시 결정)
- 헬스체크 27/27 통과 확인 (이전 커밋 기준 PM2 정상)

### 다음 할 일 (다음 세션 즉시 실행)

**Q-R 검증·배포 — 10단계 체크리스트:**

```
1. cd /opt/planq/dev-backend && node sync-database.js          # Payment 7 컬럼 추가
2. pm2 restart planq-dev-backend                                # 신규 라우트·서비스 로드
3. cd /opt/planq/dev-frontend && npm run build                  # 프론트 신규 4 컴포넌트 (run_in_background:true)
4. cd /opt/planq/dev-backend && node scripts/migrate-free-to-starter.js  # 기존 Free 일괄 starter+trialing 14일
5. node /opt/planq/scripts/health-check.js                      # 27 테스트
6. 결제 시나리오 검증 (login → checkout → mark-paid → 세금계산서)
7. trial 시나리오 검증 (신규 가입 → starter+trialing 14일 → TrialStatusBanner)
8. addon 시나리오 검증 (/addons/request → 일할 청구 → mark-paid → 한도 증가)
9. UI 검증 (LimitReached / Usage / Trial / BuildVersionGuard 4 컴포넌트, 브라우저)
10. /배포 — 운영 DB 백업 필수, 운영도 sync-database + migrate-free 동일 적용
```

**Q-R 검증·배포 완료 후:**
- CLAUDE.md / docs/PLATFORM_BILLING_SPEC.md / docs/Q_BILL_SPEC.md 문서에서 Free 플랜 표기 제거 + Starter trial 정책 반영 (일괄)
- 메모리 추가 검토: Free 폐지 정책 / Addon 자체결제 풀 흐름 / BuildVersionGuard 패턴

**Q-R 마무리 후 다음 사이클:**
- **주간 보고 (Weekly Review)** — `docs/WEEKLY_REVIEW_DESIGN.md` Phase 1. Q Task 4번째 탭 + 자동·수동 박제 + JSON 통계.

### Q-R 변경 요약 (검증 시 참고)

**핵심 정책 변경:**
- Free 플랜 폐지 (`config/plans.js` `deprecated:true`, PLAN_ORDER 제외, getPlan fallback → starter)
- Starter 한도 재설계 (members 1, conversations 10, storage 2GB, cue 50, qnote 60min)
- 신규 가입 = starter + trialing 14일 자동 부여 (`services/trial.js`)

**신규 모델/스키마 (sync-database 필요):**
- `Payment` 7 컬럼 추가 — `kind`, `addon_code`, `addon_quantity`, `tax_invoice_requested`, `tax_invoice_status`, `tax_invoice_data`, `tax_invoice_issued_at`

**신규 서비스/스크립트:**
- `services/trial.js` (153줄), `services/addonBilling.js` (246줄), `scripts/migrate-free-to-starter.js` (87줄)

**신규 라우트:**
- `routes/admin.js` Day 10 — `/payments/:id/mark-paid` (kind 자동 분기) + 세금계산서 발행

**신규 프론트 컴포넌트 (4):**
- `BuildVersionGuard.tsx`, `LimitReachedDialog.tsx`, `TrialStatusBanner.tsx`, `UsageWarningCard.tsx`

**플랫폼 결제계좌 관리:** env → `platform_settings` 우선 (admin UI 관리 가능)

---

## 환경
- **운영 라이브 (직전 사이클):** https://planq.kr (`f7256ac`, timestamp `20260504_182803`)
- **dev:** dev-backend port 3003 (planq-dev-backend), dev.planq.kr — 헬스체크 통과 (이전 커밋 기준)
- **운영:** backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
Q-R 검증·배포 10단계 체크리스트 1번부터 순서대로 진행해줘.
```
