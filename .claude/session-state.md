# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-25 (사이클 N+70 완료, /개발완료)
**작업 상태:** 완료 — 다음 섹션에서 M2 진행 예정

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 직전 사이클 — N+70 (Q Mail M1 + OAuth 통합)

**완료 (12 commit, 운영 미배포):**
- Q Mail M1 — 6 DB 모델 + IMAP cron + EmailAccount CRUD + AES-256-GCM + EmailAccountSettings UI
- Google OAuth PlanQ 로그인 — refresh_token cookie 패턴 + 자동 Business+Cue 가입
- Gmail OAuth 메일 연동 (XOAUTH2 RFC 7628) — 앱 비밀번호 대체
- OAuth Connection 표준 3분기 (oauth_connections 테이블)
- 계정 합치기: id=3 (irenecompany.com) + secondary_email='irenewp.com'
- DailyStartModal 업무 진행 링크 fix (/projects → /tasks)

**최근 commit:** `312e130` (DailyStartModal fix)

**바로 다음 작업:** Q Mail M2 인박스 UI (MailPage 3컬럼 + MailThreadList + MailThreadDetail iframe sandbox)

---

## 📦 누적 사이클

| 사이클 | 영역 | 버전 |
|---|---|---|
| N+70 | Q Mail M1 + OAuth | (미배포) |
| N+68+N+69 | visibility 통일 마무리 + Q Mail 기획 | v1.19.1 |
| N+63~N+67 | visibility 전수 통일 | v1.19.0 |
| N+49~N+62 | SaaS readiness | v1.18.0 |
| N+39~N+49 | PWA + 실시간 + 정기업무 + Brief | v1.17.0 |

---

## 📂 다음 할 일 (우선순위 순)

1. **Q Mail M2 인박스 UI** (1주) — MailPage 3컬럼 + ThreadList + ThreadDetail iframe sandbox + 사이드바 메뉴 활성
2. **Settings → "Google 로그인 연결/해제" UI** — API 는 이미 있음 (GET /oauth-connections / DELETE :id)
3. **Microsoft OAuth (B/D)** — 한국 시장 후순위
4. **Q Mail M3 답장 + M5 답변 필요 AI 분류 + M6 FAQ 마이닝** — 사용자 호소 ★

---

## 🔑 환경변수 / 인증 현황

**OAuth (Google 4 통합):**
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 설정 ✓
- GOOGLE_REDIRECT_URI (GDrive)
- GOOGLE_LOGIN_REDIRECT_URI (선택, fallback 자동 — Login)
- GMAIL_OAUTH_REDIRECT_URI (선택, fallback 자동 — Gmail)
- GCP 콘솔 등록 완료 (Irene)

**Q Mail:**
- SMTP_HOST/PORT/USER/PASSWORD (PlanQ default 발송, Gmail)
- IMAP — EmailAccount 별 등록 (5분 cron)
- EMAIL_ENCRYPTION_KEY (옵션, JWT_SECRET fallback)

---

## 주요 문서 위치

- `docs/Q_MAIL_SPEC.md` (943줄 v2)
- `docs/UNIFIED_CONTEXT_DESIGN.md` (Phase 9 메인)
- `docs/EMAIL_DELIVERY_POLICY.md` (메일 발송 정책)
- `DEVELOPMENT_PLAN.md` (개발 히스토리)

---

## 복구 가이드

운영 롤백:
```bash
ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/{TIMESTAMP}/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'
```

dev 백업:
```bash
mysqldump -u dev_admin planq_dev_db > /opt/planq/backups/dev_$(date +%Y%m%d_%H%M).sql
```
