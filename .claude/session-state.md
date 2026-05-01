## 현재 작업 상태
**마지막 업데이트:** 2026-05-01 (개발완료)
**작업 상태:** 완료 — 운영 진입 첫 배포 직전. 양쪽 Claude 세션 저장 후 다음 섹션에서 이어감

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 운영 진입 이어서 진행해. 운영서버(87.106.78.146) Claude 도 같이 깨워야 함.
```

---

## 📦 이번 세션 작업 요약

**N+ 운영 진입 사이클 — dev/운영 양쪽 Claude 협업으로 운영서버 셋업 1~4단계 완료. 첫 실배포 직전.**

### 1. 배포 모델 결정 — 모델 B (POS rsync 패턴) 확정
- dev (87.106.11.184) → SSH rsync push → 운영 (87.106.78.146)
- 운영서버에 git repo 없음 (받기만), GitHub key 노출 없음
- POS deploy-production-v3.sh 시퀀스/플래그 그대로 채용

### 2. dev 측 작업
- `commit 6c34535` — N+ 사이클 (cron 4종 + Reports 자동 + 요금제 Addon + Q Bill 결제 폴리싱 + 운영 스크립트, +3239/-594)
- `commit 1f3b791` — `scripts/deploy-planq.sh` (442줄, 모델 B)
- 운영 자료 4개 + .env.production.example scp → 운영서버
- dev .env 의 OPENAI/Deepgram/SMTP 5개를 SSH sed 통해 운영 .env 직접 입력 (채팅 노출 없음)
- dry-run 통과 (모든 단계 정상)

### 3. 운영서버 (별도 Claude 세션) 작업
- `whoami` = irene (uid 1000, sudo group)
- /opt/planq/{backend,frontend-build,q-note,logs,uploads} mkdir
- ~/.ssh/authorized_keys 에 dev 공개키 등록 확인
- MySQL `planq_prod_db` + `planq_admin@localhost` (DB 비번 `/opt/planq/.db-password` mode 600)
- DNS A 레코드 → 87.106.78.146 (Irene 등록, propagation 대기)
- `.env` 13개 항목 자동/수동 입력 완료 (PORT 3004, DB_PASSWORD, JWT 2개, INTERNAL_API_KEY, VAPID 쌍, OpenAI, Deepgram, SMTP 3개)

### 4. 핵심 결정
- **운영 = dev 정확 복사** — 운영 전용 별도 코드/정보 없음
- **운영 정보는 모두 DB + 관리자 UI** — `.env` 는 시크릿만, 회사명·SMTP_FROM·은행계좌는 platform_settings 테이블 + 플랫폼 관리자 settings 페이지
- 은행계좌 (PLANQ_BILLING_BANK_*) 는 첫 배포 후 platform_settings 사이클 (반나절) 에서 처리

### 5. 검증
- 헬스체크 27/27 통과
- 빌드 OK (exit 0, 2.06s)
- dev → 운영 SSH 도달 OK
- deploy-planq.sh dry-run 통과

---

## 진행 중인 작업
- 없음 (세션 저장 후 다음 섹션 인계)

## 완료된 작업 (이번 세션)
- 배포 모델 결정 (모델 B)
- 미커밋 변경 1,924줄 검증 + commit `6c34535`
- `scripts/deploy-planq.sh` 신규 작성 + commit `1f3b791`
- 운영서버 셋업 1~4단계 (디렉터리, MySQL, .env 13항목, DNS) 완료
- dry-run 검증 통과
- DEVELOPMENT_PLAN.md 히스토리 추가
- memory 업데이트 (project_prod_deploy_scripts, feedback_prod_equals_dev)

---

## 🔖 다음 할 일 (우선순위 순)

### 즉시 — 양쪽 Claude 세션 재개 후 첫 실배포

1. **운영서버 Claude:** 본인 세션 저장 파일 읽고 진행 마저 처리:
   - `/opt/planq/scripts/nginx-planq.kr.conf` 수정 (root → `/opt/planq/frontend-build`, port 3002 → 3004) → `/etc/nginx/sites-available/planq.kr` 설치 + `nginx -t` + `sudo systemctl reload nginx`
   - `/opt/planq/scripts/prod-ecosystem.config.js` 수정 (cwd `prod-backend` → `backend`, q-note 동일, PORT 3004)
   - DNS propagation 확인 (`dig +short planq.kr` = 87.106.78.146) 후 `sudo certbot --nginx -d planq.kr -d www.planq.kr`
2. **dev Claude:** 운영서버 신호 받으면 `cd /opt/planq && ./scripts/deploy-planq.sh` (--dry-run 없이) 첫 실배포 (~3-5분)
3. **검증:** `https://planq.kr/api/health` 200 / 회원가입 → 워크스페이스 생성 → 청구서 발행 E2E

### 첫 배포 후 — platform_settings 사이클 (반나절)
운영 정보를 .env 에서 DB+관리자 UI 로 이전:
- `models/PlatformSetting.js` (key/value JSON)
- `routes/admin.js` GET/PUT `/platform-settings`
- `pages/Admin/PlatformSettingsPage.tsx`
- 마이그레이션: `.env` 의 PLANQ_BILLING_BANK_*, PLATFORM_*, EMAIL_LOGO_URL, SMTP_FROM 을 DB 로

### Q-F 반응형 일괄 (Phase 8, 5~7d)
- 햄버거 2뎁스 아코디언 + 마스터-디테일 드릴다운

### K — PortOne V2 + 팝빌 (마지막)
- 운영 진입 안정화 후

---

## 🔑 환경변수 / 인증 현황

### dev 서버 (87.106.11.184)
- 백엔드: port 3003 (PM2 `planq-dev-backend` online)
- DB: planq_dev_db / planq_admin
- 도메인: dev.planq.kr
- 헬스체크 27/27 통과

### 운영서버 (87.106.78.146 POS 공존)
- 백엔드 port: **3004** / Q Note port: **8001**
- 도메인: planq.kr / www.planq.kr (DNS propagation 대기)
- DB: planq_prod_db / planq_admin (생성 완료, 비번 `/opt/planq/.db-password` 운영서버에만)
- `.env`: 13항목 입력 완료. 남은 placeholder = PLANQ_BILLING_BANK_*, GOOGLE_CLIENT_*, PORTONE_*
- nginx site / PM2 ecosystem: 운영서버 Claude 진행 중 (다음 세션)
- SSL: DNS propagation 후 certbot

### Git 상태
- 마지막 commit: `1f3b791` (deploy-planq.sh)
- 그 전: `6c34535` (N+ 운영 진입 사이클)
- working tree: clean (개발완료 시점)

---

## 📂 주요 문서 위치

- 프로젝트 가이드: `/opt/planq/CLAUDE.md`
- UI 가이드: `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md`
- 운영 인수인계: `/opt/planq/scripts/PROD_SETUP_BRIEF.md`
- **첫 배포 스크립트**: `/opt/planq/scripts/deploy-planq.sh` (commit 1f3b791)
- nginx site 템플릿: `/opt/planq/scripts/nginx-planq.kr.conf`
- PM2 ecosystem 템플릿: `/opt/planq/scripts/prod-ecosystem.config.js`
- env 템플릿: `/opt/planq/dev-backend/.env.production.example`

---

## 🤝 양쪽 Claude 협업 메모

이번 사이클은 **dev Claude (여기) + 운영서버 Claude (87.106.78.146)** 두 세션이 Irene 을 메신저로 협업.

- **운영서버 Claude 의 분석 정확** — 배포 모델 분류 (A/B), POS v3.sh 가 legacy 임을 발견, .env 자동 채움 sed 패턴
- **dev 측 (여기) 가 한 일** — 코드 베이스 정보 답변, deploy-planq.sh 작성, dry-run 검증, secret 을 SSH 통해 dev → 운영 직접 박음 (채팅 노출 없음)
- **다음 세션에서 양쪽 모두 깨워야 진행** — 운영서버 Claude 가 nginx + PM2 ecosystem 마저 끝내야 dev 가 첫 배포 가능

---

## 복구 가이드

새 dev Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
session-state.md 읽고 운영 진입 이어서 진행해. 운영서버(87.106.78.146) Claude 도 같이 깨워줘.
```

새 운영서버 Claude 세션 시작 시 (Irene 이 운영서버 본인 세션에 입력):
```
PlanQ 운영 진입 이어서. 본인이 저장한 진행 상태 파일 읽고 nginx + PM2 ecosystem 마저 진행해줘.
```
