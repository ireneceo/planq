## 현재 작업 상태
**마지막 업데이트:** 2026-04-22
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **초대 플로우 3청크 완성** — 프로젝트 고객·워크스페이스 고객·멤버 초대 + 통합 `/api/invites/:token`
- **업무 삭제 + 요청 칩 통일** — 우측 드로어 Danger Zone, "{요청자}에게 요청받음"
- **Q Talk 메시지 첨부** — 이미지 썸네일 + 파일 chip + Socket.IO
- **Q Note → Drive 자동 저장** — Python ingest 후 Node sync API 호출
- **Drive changes.watch** — webhook 수신 + Socket.IO 브로드캐스트
- **프로젝트 상태 토글·삭제** — 카드 컨텍스트 메뉴 · closed 필터 · owner-only
- **멤버 관리 Phase 2** — removed_at soft delete · role 변경 · 마지막 오너 보호 · defaultScope
- **QNote/QProject i18n 130 키** (Agent A)
- **ProjectClient FK 전환** — email/name 문자열 매칭 폐기 (backfill 완료)
- **운영서버 배포 스크립트** — `deploy-to-production.sh` + `rollback-production.sh`
- **전체 코드 감사 (3 Agent 병렬)** — Critical 1 + High 10건 전수 수정
  - users.js IDOR · platform_role 통일 · OAuth HMAC · refresh_token 해시 · CSP 강화
  - 22개 라우트 checkBusinessAccess 보강
  - invites/businesses 트랜잭션 + 마지막 오너 race 방어
  - conversations participants 외부 user 차단
  - /public/attach 이미지만 + nosniff
- **리포트 + Q Bill 통합 기획** — 문서 2개 신규 (`docs/Q_BILL_SPEC.md`, `docs/FINANCIAL_REPORTS_SPEC.md`)
- **좌측 메뉴 확장** — Q Bill 활성 · 통계·분석 섹션 6 개 · ComingSoon 페이지 · /billing→/bills 통합
- **UI 수정** — /business/settings/plan max-width 제거 · 비용·재무 아이콘 파이차트 교체

### 다음 할 일 (확정된 Phase 순서)

**Phase 0 — DB 기반 스키마 확장 (1주) ← 여기서 시작**
- businesses: 은행정보·포트원·팝빌 키 컬럼
- clients: country·is_business·biz_* 필드
- business_members: hourly_rate·monthly_salary
- projects: contract_amount·billing_type·monthly_fee
- 신규 테이블: quotes, quote_items, invoice_payments, bill_events, overhead_items, project_expenses, reports

**Phase 1 — Q Bill 견적·청구·결제 (3주)**
**Phase 2 — 세금계산서 자동화 (0.5주)**
**Phase 3 — 프로젝트 Bill 탭 + 시간기반 자동청구 (1주)**
**Phase 4 — 통계 대시보드 5개 + 자동해석 (2주)**
**Phase 5 — 월간 보고서 PDF (1주)**
**Phase 6 — PlanQ 자체 구독 빌링키 (0.5주)**
**Phase 7 — 운영서버 세팅 + 실배포 (0.5주, Irene 외부 준비 선행)**

설계 문서: `docs/Q_BILL_SPEC.md` · `docs/FINANCIAL_REPORTS_SPEC.md`

---

## 🔑 환경변수 / 인증 현황

```
JWT_SECRET              = (.env 설정됨, 'planq' 폴백 제거)
INTERNAL_API_KEY        = planq-internal-dev-f76e0bffee43e39959f3dd7eb1cbb222
APP_URL                 = https://dev.planq.kr
PLANQ_NODE_BASE_URL     = http://localhost:3003 (q-note .env)

GOOGLE_CLIENT_ID        = 765630237305-rm9g0emg...
GOOGLE_CLIENT_SECRET    = GOCSPX-...
GOOGLE_REDIRECT_URI     = https://dev.planq.kr/api/cloud/callback/gdrive
```

**향후 필요 (Phase 1~):**
- 포트원 V2 테스트 키 (Starter 플랜, 월 5천만 무료)
- Stripe test mode secret
- 팝빌 테스트 link_id + secret_key

워프로랩 (biz=3):
- Google Drive: irene@irenewp.com · root "PlanQ - 워프로랩"

Irene 계정:
- `irene@irenecompany.com` — platform_admin + owner biz=3

---

## 📂 주요 문서 위치

- Q Bill 설계: `docs/Q_BILL_SPEC.md`
- 리포트 설계: `docs/FINANCIAL_REPORTS_SPEC.md`
- 파일 시스템: `docs/FILE_SYSTEM_DESIGN.md`
- OPS 로드맵: `docs/OPS_ROADMAP.md`
- 개발 로드맵: `DEVELOPMENT_PLAN.md`
- 프로젝트 규칙: `CLAUDE.md`
- UI 가이드: `dev-frontend/UI_DESIGN_GUIDE.md` (§2.4 관리 리스트 패턴 추가됨)
- 배포 스크립트: `deploy-to-production.sh` · `rollback-production.sh`

---

## 🔄 복구 가이드

```
session-state.md 읽고 Phase 0 부터 이어서 개발해.
```

또는 Phase 확인만 필요하면:
```
DEVELOPMENT_PLAN.md 상단 읽어봐.
```
