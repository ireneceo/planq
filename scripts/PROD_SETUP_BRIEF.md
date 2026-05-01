# PlanQ 운영 진입 인수인계 (운영서버 Claude 용)

이 문서는 PlanQ 를 **POS 운영서버에 공존 설치** 하는 작업을 진행하는 운영서버 Claude 에게 전달하는 브리프입니다.

---

## 1. PlanQ 한 줄 소개

B2B SaaS 업무 OS — 고객 채팅 + 업무 + 메모(Q Note) + 청구서 + 문서/서명. Node 18 (Express + Sequelize + Socket.IO) + Python 3.10 (FastAPI, Q Note STT) + MySQL 8 + nginx + PM2.

GitHub: `git@github-planq:ireneceo/planq.git` (Irene 의 SSH alias `github-planq` — id_ed25519 키로 접근).

운영자: 워프로랩 (Irene). dev 서버는 `87.106.11.184` (`dev.planq.kr`). 운영은 **POS 운영서버에 공존** — 별도 호스트 비용 안 들이고 기존 인프라 재사용.

---

## 2. 공존 설계 (충돌 회피)

POS 운영서버에 이미 떠있는 POS 서비스와 충돌 없도록 PlanQ 는 다음 자원만 사용합니다.

| 자원 | PlanQ 운영 사용값 | POS 와 충돌? |
|------|------------------|------|
| 백엔드 port | **3002** | POS 가 3001 또는 다른 포트 사용 가정. `prod-diagnose.sh` 결과로 확인 |
| Q Note (Python) port | **8001** | POS 가 안 쓰는 포트 |
| 도메인 | **planq.kr / www.planq.kr** | POS 와 다른 도메인 — nginx sites 추가만 |
| MySQL DB | **planq_prod_db** | POS 와 분리, 같은 MySQL 인스턴스 공유 |
| MySQL 사용자 | **planq_admin@localhost** | POS 의 dev_admin/prod_admin 과 분리 |
| 디렉터리 | **/opt/planq** | POS 가 `/var/www` 라면 공존 OK |
| PM2 앱 | **planq-prod-backend, planq-prod-qnote** | 이름 다르므로 OK |
| nginx site 파일 | **/etc/nginx/sites-available/planq.kr** | 별도 파일 |
| 이메일 SMTP | help@irenewp.com (Gmail) | POS 와 SMTP 공유 — `SMTP_FROM=help@purplehere.com` 그대로 사용 |

**자원 분리는 PlanQ 가 자기 영역만 건드리는 원칙이며, POS 디렉터리/DB/PM2/nginx site 는 절대 수정 금지** (PlanQ dev 의 CLAUDE.md 와 동일 정책).

---

## 3. 첫 번째 작업: 환경 진단

운영서버 Claude 는 **먼저 진단부터** 실행해서 충돌 가능성 확인 후 설치 진행. 진단 스크립트는 PlanQ git clone 후 첫 명령:

```bash
git clone git@github-planq:ireneceo/planq.git /opt/planq
bash /opt/planq/scripts/prod-diagnose.sh
```

진단 결과로 확인할 것:
- POS 가 3002 / 8001 사용 중이면 PlanQ 포트 변경 (또는 POS 의 포트 위치 파악)
- nginx sites-enabled 에 `planq.kr` 이미 있으면 (구식) 새로 만들지 말고 기존 점검
- MySQL 에 `planq_admin` 이름이 다른 용도로 쓰이고 있으면 별도 사용자명 (예: `planq_prod_admin`)
- DNS 가 이 서버를 가리키지 않으면 DNS 등록 후 24h 기다려야 (SSL 발급 가능 시점)

---

## 4. 설치 단계 (Irene 의 입력 + 운영서버 Claude 의 자동화)

### 4-1. Irene 이 결정해서 알려줘야 할 정보

운영서버 Claude 가 진행하기 전 Irene 에게 받아야 할 값:

| 항목 | 비고 |
|------|------|
| **운영 DB 비밀번호** | 강력한 24자+. Irene 결정 또는 운영서버 Claude 가 generate. |
| **PLANQ_BILLING_BANK_NAME** | 사업자 통장 은행 (예: 토스뱅크) |
| **PLANQ_BILLING_BANK_ACCOUNT** | 계좌번호 (예: 100-1234-5678) |
| **PLANQ_BILLING_BANK_HOLDER** | 예금주 (워프로랩 또는 PlanQ) |
| **OPENAI_API_KEY** | 운영용 (dev 키 그대로 OK 인지 Irene 결정) |
| **DAILY_API_KEY** | Deepgram 운영 키 (dev 키 그대로 OK 인지) |
| **SMTP_PASSWORD** | help@irenewp.com Gmail App Password (dev 와 동일하게 가능) |
| **GOOGLE_CLIENT_ID / SECRET** | (선택) Google Drive OAuth — 운영 redirect URI 등록 후 발급 |

### 4-2. 운영서버 Claude 가 자동 생성

```bash
bash /opt/planq/scripts/generate-prod-secrets.sh
```

출력:
- `JWT_SECRET` (64바이트 hex)
- `JWT_REFRESH_SECRET` (64바이트 hex, 위와 다름)
- `INTERNAL_API_KEY` (32바이트 hex — Q Note ↔ Node 통신)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (Web Push)

### 4-3. 운영 DB 생성

```bash
sudo mysql <<SQL
CREATE DATABASE planq_prod_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'planq_admin'@'localhost' IDENTIFIED BY '<운영_DB_비밀번호>';
GRANT ALL ON planq_prod_db.* TO 'planq_admin'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### 4-4. 운영 .env 작성

```bash
cp /opt/planq/dev-backend/.env.production.example /opt/planq/dev-backend/.env
nano /opt/planq/dev-backend/.env
```

채워야 할 placeholder (모두 `<...>` 로 표시되어 있음). 자세한 항목은 `.env.production.example` 의 주석 참조.

> **주의**: 운영서버에서 PlanQ 코드는 `/opt/planq/dev-backend` 가 아닌 `/opt/planq/prod-backend` 로 둘지 결정. POS 와의 일관성 + 디렉터리 명확성 위해 `prod-backend` 권장. dev 서버의 `deploy-prod.sh` 는 dev→prod rsync 였는데, 운영서버에서는 git pull 로 직접 가져오므로 단순화 가능. **권장: 운영서버 디렉터리 = `/opt/planq/`, 백엔드 코드 = `/opt/planq/dev-backend/` 그대로 사용 (이름은 dev 라고 되어있지만 .env 가 production 모드).** 또는 `mv /opt/planq/dev-backend /opt/planq/backend` 로 rename.

### 4-5. 의존성 설치 + DB 스키마 초기화

```bash
cd /opt/planq/dev-backend  # (또는 rename 한 디렉터리)
npm ci --omit=dev
NODE_ENV=production node sync-database.js   # DB 테이블 생성

cd /opt/planq/q-note
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

### 4-6. 프론트엔드 빌드

```bash
cd /opt/planq/dev-frontend
npm ci
npm run build
# 결과: /opt/planq/dev-frontend-build/
```

### 4-7. nginx + SSL

```bash
sudo cp /opt/planq/scripts/nginx-planq.kr.conf /etc/nginx/sites-available/planq.kr
sudo ln -s /etc/nginx/sites-available/planq.kr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# DNS 가 이 서버를 가리키는지 dig +short planq.kr 로 먼저 확인
sudo certbot --nginx -d planq.kr -d www.planq.kr
```

> **주의**: `nginx-planq.kr.conf` 는 `/opt/planq/prod-frontend-build` 를 root 로 지정. 운영서버에서 `dev-frontend-build` 디렉터리를 사용하면 conf 의 root 경로 수정 필요.

### 4-8. PM2 시작

```bash
pm2 start /opt/planq/scripts/prod-ecosystem.config.js
pm2 save
pm2 startup    # 첫 1회 — 서버 재시작 시 자동 기동
```

> **주의**: `prod-ecosystem.config.js` 는 `/opt/planq/prod-backend` 와 `/opt/planq/prod-qnote` 경로를 가리킴. 디렉터리 이름이 다르면 conf 수정.

### 4-9. 헬스체크 + E2E

```bash
curl -sf http://localhost:3002/api/health
curl -sf https://planq.kr/api/health

# health-check 스크립트 (27 항목)
cd /opt/planq/dev-backend && node /opt/planq/scripts/health-check.js
```

핵심 플로우 검증 (Irene 이 직접):
1. `https://planq.kr/register` 회원가입 + 이메일 도착
2. 워크스페이스 생성
3. 클라이언트 초대 + 메일 도착
4. 청구서 발행 (테스트 데이터)

---

## 5. 자원 위치 + 변경 가능 항목

### deploy-prod.sh 의 한계
이 dev 서버에 만들어 둔 `/opt/planq/scripts/deploy-prod.sh` 는 **dev 서버에서 prod 디렉터리로 rsync 하는 방식** 입니다. 운영서버에서는 **git pull 기반 배포** 가 더 단순:

```bash
# 운영서버 배포 흐름 (deploy-prod.sh 대체)
cd /opt/planq
git pull
cd dev-backend && npm ci --omit=dev
cd ../dev-frontend && npm ci && npm run build
cd ..
NODE_ENV=production node dev-backend/sync-database.js  # 스키마 변경 시
pm2 reload planq-prod-backend
curl -sf https://planq.kr/api/health
```

운영서버 Claude 가 위 흐름을 단일 스크립트 `prod-pull-deploy.sh` 로 만들어서 사용하는 게 안전합니다.

### 디렉터리 명명 결정
운영서버에서 `dev-backend`, `dev-frontend` 같은 이름 그대로 쓰면 혼란. 다음 중 선택:
- **A. 그대로** — `.env` 의 `NODE_ENV=production` 으로 모드 구분. 변경 최소.
- **B. rename** — `mv dev-backend backend; mv dev-frontend frontend; mv dev-frontend-build frontend-build`. 명확하지만 nginx-planq.kr.conf, prod-ecosystem.config.js 의 경로 다 수정 필요.

권장: **A** (그대로). 코드 안에 박힌 경로 이슈 없음.

---

## 6. 보안 / 운영 정책

- **SSH key**: 운영서버에 `id_ed25519` 키 등록 — GitHub `ireneceo/planq` 의 deploy key 또는 Irene 개인 키.
- **`.env` 보호**: `chmod 600 /opt/planq/dev-backend/.env` — 다른 사용자 읽기 차단.
- **MySQL root**: 운영서버 root 비밀번호는 Irene 만 보관. `planq_admin` 만 PlanQ 가 사용.
- **POS 와의 격리**: PlanQ 는 절대 POS 디렉터리(`/var/www/...`), POS DB, POS PM2 앱을 건드리지 않음. dev 서버에서도 같은 정책 (CLAUDE.md hook 으로 차단).
- **자동 백업**: PlanQ DB 별도 백업 cron — 운영서버 Claude 가 `/opt/planq/scripts/backup-prod.sh` 만들어서 daily cron.
- **모니터링**: PM2 가 자동 재시작 (max_restarts: 10, min_uptime: 10s). 헬스체크 스크립트를 외부 monitoring (UptimeRobot 등) 에 등록 권장.

---

## 7. 운영 진입 후 즉시 해야 할 후속

| 항목 | 우선순위 |
|------|----------|
| 운영 SMTP 발신자 alias 등록 — Gmail Workspace 에 `noreply@planq.kr` Send-As 추가 → SMTP_FROM 변경 | 1주 내 |
| 운영 VAPID 키 → 모든 dev 사용자 push subscription 무효화 (정상 동작) | 즉시 |
| Reports 자동 생성 cron — 매월 1일 작동 확인 | 첫 달 후 |
| 정기 청구 cron — `auto_invoice_enabled=true` 프로젝트 작동 확인 | 첫 청구일 후 |
| 연체 cron — 단계별 알림 작동 확인 | 첫 연체 발생 후 |

---

## 8. 정상 운영 진입 완료 기준

- [ ] `https://planq.kr` 200 + SSL 인증서 valid
- [ ] `https://planq.kr/api/health` 200
- [ ] PM2 `planq-prod-backend` + `planq-prod-qnote` online + autorestart
- [ ] 회원가입 → 메일 인증 → 워크스페이스 생성 E2E 통과
- [ ] 헬스체크 스크립트 27/27 통과
- [ ] Web Push 구독 1건 성공
- [ ] daily cron 1회 실행 (자정 지나서 로그 확인)
- [ ] DB 백업 cron 등록

---

## 9. 충돌/장애 시 dev 서버 Claude 에 보고할 정보

운영서버 Claude 가 막히면 dev 서버 Claude 에게 다음 정보 보고:
- `prod-diagnose.sh` 실행 결과
- `pm2 logs planq-prod-backend --lines 50`
- `sudo nginx -t` 출력
- 에러가 발생한 명령 + stack trace

dev 서버 Claude 는 PlanQ 코드 전체를 읽을 수 있어서 디버그 가능.

---

문서 끝. 운영서버 Claude — 4-1 절의 Irene 입력 정보를 먼저 받고, 4-2 부터 진행하세요.
