## 현재 작업 상태
**마지막 업데이트:** 2026-05-01 (저녁 — Q-H 사이클 운영 배포 완료, 다음 세션에 백업 시스템 즉시 작업)
**작업 상태:** 운영 배포 성공 (commit `024d368`). **다음 세션 핵심: 양방향 크로스 DB 백업 + deploy-planq.sh mysqldump + POS 보강**

---

## ⚡ 빠른 재개 (다음 세션에 이걸 그대로 붙여넣기)

```
session-state.md 읽고 "다음 세션 즉시 작업" 섹션의 백업 시스템 5단계 그대로 시작해.
PlanQ 양방향 크로스 + POS 단방향 보강까지 한 번에 처리.
끝나면 1차 수동 실행으로 양 서버에 첫 파일 도착 확인할 것.
```

---

## 🔥 다음 세션 즉시 작업 — 백업 시스템 (Irene 지시)

### 배경 (요약)
- 운영 진입 (commit `024d368`, 2026-05-01) — 이제부터 사용자 데이터 매분 누적
- 현재 deploy-planq.sh 는 코드/.env 백업만 (DB·uploads 백업 없음)
- POS 는 dev → 운영 단방향 크로스만 — 운영 DB 가 더 critical 한데 운영 → dev 크로스가 없는 건 문제
- Irene 결정: PlanQ 부터 양방향 크로스로 제대로 적용. PlanQ 작동 확인 후 POS 도 동일 패턴으로 보강
- **30년차 의견 채택**: cron 자동 백업 (매일) + deploy 시 추가 백업 (변경 직전 스냅샷, 롤백용) 둘 다

### POS 기존 패턴 (분석 완료, 그대로 따라감)

운영서버 POS:
- `/var/www/scripts/backup-database.sh` (운영서버 cron 03:00)
- `mysqldump --single-transaction --quick --lock-tables=false --routines --triggers --no-tablespaces`
- → `/var/backups/orderhere/daily/db_YYYY-MM-DD.sql.gz`
- 7일 보관 (`find ... -mtime +7 -delete`)
- 크로스: 없음 (단방향만 받음 — POS 의 빈 곳)
- 부수: `/home/irene/backups/cross-backup/dev/` 14일 cleanup (dev 가 push 한 파일 정리)

dev 서버 POS:
- `/var/www/scripts/backup-database.sh` (dev cron 04:00)
- mysqldump → `/var/backups/dev-db/daily/dev_db_YYYY-MM-DD.sql.gz`
- 14일 보관
- **크로스: scp → `irene@87.106.78.146:/home/irene/backups/cross-backup/dev/`** (dev → 운영 push)
- 부수: `/home/irene/backups/cross-backup/production/` 14일 cleanup

→ 결론: POS 는 dev → 운영 단방향만. 운영 → dev 가 빠져있음 (운영 DB 가 더 critical 한데).

### 이미 준비된 것 (Irene 가 미리 만든 듯)
- dev 서버: `/var/backups/planq-db/daily/` 디렉토리 존재 (빈 폴더)
- 운영서버: `/opt/planq/backups/` (deploy 백업용, 이미 사용 중)

### 5단계 작업 — 다음 세션 그대로 진행

#### 1. dev 서버 백업 스크립트 — `/opt/planq/scripts/backup-planq-dev-db.sh`

POS dev `backup-database.sh` 와 100% 같은 구조. 차이:
- `/opt/planq/dev-backend/.env` 에서 DB 정보 로드 (DB_NAME=planq_dev_db)
- 결과: `/var/backups/planq-db/daily/dev_db_YYYY-MM-DD.sql.gz`
- 14일 보관
- scp → `irene@87.106.78.146:/home/irene/backups/cross-backup/dev-planq/` (POS 와 디렉토리 분리, `dev-planq/` 명시)
- 운영서버에 디렉토리 mkdir 필요 (스크립트 첫 실행 시 자동 또는 수동)
- 로그: `/opt/planq/logs/backup-planq-dev.log`

#### 2. 운영 서버 백업 스크립트 — `/opt/planq/scripts/backup-planq-prod-db.sh`

POS 운영 패턴 + **운영 → dev 크로스 추가** (POS 보강 핵심):
- `/opt/planq/backend/.env` 에서 DB 정보 로드 (DB_NAME=planq_prod_db)
- 결과: `/var/backups/planq-db/daily/db_YYYY-MM-DD.sql.gz`
- 7일 보관
- **추가**: scp → `irene@87.106.11.184:/home/irene/backups/cross-backup/prod-planq/` (운영 → dev push)
- dev 서버에 디렉토리 mkdir 필요
- 부수: dev 가 push 한 `/home/irene/backups/cross-backup/dev-planq/` 14일 cleanup
- 로그: `/opt/planq/logs/backup-planq-prod.log`

#### 3. cron 등록 (POS 와 30분 offset 분리)

dev 서버 (현재 머신):
```bash
crontab -e
# Add:
30 4 * * * /opt/planq/scripts/backup-planq-dev-db.sh >> /opt/planq/logs/backup-planq-dev.log 2>&1
```

운영서버 (87.106.78.146):
```bash
ssh irene@87.106.78.146 "crontab -e"
# Add:
30 3 * * * /opt/planq/scripts/backup-planq-prod-db.sh >> /opt/planq/logs/backup-planq-prod.log 2>&1
```

POS 03:00/04:00, PlanQ 03:30/04:30 — 30분 offset.

#### 4. `deploy-planq.sh` `create_backup()` 보강 — mysqldump + rotation

```bash
# create_backup() 함수 안에 추가:
prod_run "
  mysqldump --single-transaction --quick --lock-tables=false --routines --triggers --no-tablespaces \
    -u planq_admin -p\$(cat /opt/planq/.db-password) planq_prod_db \
    | gzip > $BACKUP_DIR/db.sql.gz
"

# create_backup() 마지막에 rotation:
prod_run "ls -1t $PROD_BACKUPS | tail -n +15 | xargs -I {} rm -rf $PROD_BACKUPS/{} 2>/dev/null || true"
```

운영 deploy 백업 14개 보관.

#### 5. 메모리 + 1차 수동 검증

a. 메모리 신규: `project_backup_strategy.md`
   - 3-2-1 규칙 (3 복사본 / 2 매체 / 1 오프사이트)
   - 양 서버 cron 시각, 보관 기간, 크로스 방향 도식
   - 복원 절차 (운영 자체 → 운영 backup, 운영 자체 손실 → dev 의 prod-planq → 운영 복원, dev 자체 손실 → 운영의 dev-planq → dev 복원)

b. 양 서버 첫 실행 + 검증:
```bash
# dev 에서
bash /opt/planq/scripts/backup-planq-dev-db.sh
ls -la /var/backups/planq-db/daily/                  # 새 dev_db_*.sql.gz
ssh irene@87.106.78.146 "ls /home/irene/backups/cross-backup/dev-planq/"  # 크로스 도착

# 운영에서
ssh irene@87.106.78.146 "bash /opt/planq/scripts/backup-planq-prod-db.sh"
ssh irene@87.106.78.146 "ls /var/backups/planq-db/daily/"  # 새 db_*.sql.gz
ls /home/irene/backups/cross-backup/prod-planq/                # 크로스 도착
```

### POS 보강안 (PlanQ 작동 확인 후 Irene 가 직접 적용)

POS 운영 → dev 크로스 추가:

`/var/www/scripts/backup-database.sh` 의 운영 측 스크립트 마지막에 추가:
```bash
# 크로스 백업: 운영 DB 백업을 개발서버로 전송 (PlanQ 패턴과 동일)
CROSS_BACKUP_DIR="irene@87.106.11.184:/home/irene/backups/cross-backup/production-pos"
scp -o ConnectTimeout=10 -q $BACKUP_FILE $CROSS_BACKUP_DIR/ 2>/dev/null
if [ $? -eq 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ✓ Cross-backup sent to dev server" >> $LOG_FILE
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ⚠️ Cross-backup to dev server failed" >> $LOG_FILE
fi
```

dev 서버에 mkdir:
```bash
mkdir -p /home/irene/backups/cross-backup/production-pos
```

dev 측 POS `backup-database.sh` 마지막에 cleanup 추가:
```bash
find /home/irene/backups/cross-backup/production-pos/ -name "db_*.sql.gz" -mtime +14 -delete 2>/dev/null
```

이 3개 변경으로 POS 도 양방향 크로스 완성.

---

## 📦 이번 세션 (Q-H 사이클) 작업 요약 — 누적 정리

### ✅ 첫 운영 실배포 (commit `661b893` → `024d368`)
- 운영서버 (87.106.78.146 / planq.kr / port 3004) PM2 + nginx + SSL 모두 정상
- DB sync 시 `kb_documents.project_id` INT vs `projects.id` BIGINT FK 불일치 fix (broken FK 드롭 + INT→BIGINT)
- POS production-backend (3002) 와 공존 영향 없음
- 두 번째 배포 (`024d368`, Q-H 사이클): 32 파일, +1667/-467, 96초 완료, planq-prod-backend reload 1회

### ✅ /배포 스킬 정비
- `.claude/commands/배포.md` 운영서버 정보 + deploy-planq.sh 호출 + 한/영 릴리즈노트 + POS 가드

### ✅ Client(고객) 권한 매트릭스
| 영역 | client 동작 | 가드 |
|------|------------|------|
| 사이드바 노출 | 인박스, Q Talk, Q Task, Q Project, Q Calendar, Q Bill, 프로필 | hasBiz 분기 |
| 사이드바 숨김 | Q Note, Q Knowledge, Q Docs, Q File, Q Mail, 통계, 설정, 멤버 | 동일 |
| Q File POST/move/DELETE/bulk-delete | 403 | files.js client 차단 |
| Q Calendar POST/PUT/DELETE | 403 | calendar.js client 차단 |
| Q Calendar GET | 자기 attendee 만 | calendar.js:85-94 |
| Q Task POST | 자기 자신 X, 다른 사람에게 요청만 OK | tasks.js:361 |
| Q Task 우측 패널 | detail 있을 때만 노출 | QTaskPage.tsx isClient |
| Q Knowledge GET 4개 | 403 | kb.js client 차단 |
| `/business/settings/notifications` | 접근 OK (App.tsx 별도 라우트, owner/member/client) | requiredRole 3 역할 |
| client 사이드바 2뎁스 | 설정 → 내 프로필/알림 (AccordionWrap) | MainLayout |
- 메모리: `project_client_permission_matrix.md`

### ✅ Calendar 권한 명확화
- Member/Owner default = 워크스페이스 전체 일정
- "나" 탭 = 자기 관련만 (frontend 후처리 필터)
- "나" 탭 task 필터 버그 fix (created_by 만 → assignee_id+created_by)
- Client = 자기 attendee 만 (변동 없음)

### ✅ GDrive 정책 (옵션 B + 옵션 1)
- 워크스페이스 공용 파일 (project_id 있음) = Drive
- 개인 파일 (project_id 없음 = "내 파일") = PlanQ 자체
- StorageSettings 안내: 보관/미보관 항목 리스트 + 단방향
- CloudConnectNotice: client hidden, 멤버/오너에게만 호박색(연결됨)/청록색(권장)
- 메모리: `project_gdrive_policy.md`

### ✅ Push UX 정정
- NotificationSettings PushSection: "본인 계정 + 이 브라우저 1개만 적용" 명시 안내

### ✅ 계정 vs 워크스페이스 프로필 분리
- DB:
  - `users` 7 컬럼 (email_verified_at, secondary_email + 5 OTP)
  - `business_members` 10 컬럼 (name, name_localized + Q Note 8 필드: bio, expertise, organization, job_title, expertise_level, language_levels, answer_style_default, answer_length_default)
  - `clients.display_name_localized`
- 신규 라우트 12개:
  - `GET/PUT /api/businesses/:id/me/profile`
  - `POST /api/users/:id/email-verify-request` + `-confirm`
  - `POST /api/users/:id/secondary-email-verify-request` + `-confirm`
  - `POST /api/users/:id/secondary-email-change-request` + `-verify`
  - `DELETE /api/users/:id/secondary-email`
  - PUT `/api/users/:id` username 차단 (안전핀)
- ProfilePage 재설계:
  - "계정 정보" Card: 아이디 readonly + 이메일 verified 뱃지/인증 버튼 + 보조 이메일 + 기본 언어
  - "{워크스페이스명} 프로필" Card: 이름·영어이름 (BusinessMember)
  - "{워크스페이스명} — Q note 답변 생성용" Card: 조직·직책·전문분야·소개 + 5단계 expertise
  - 알림 매트릭스 카드 제거 (별도 메뉴로)
- expertise_level 5단계 + 결과 예시 카드 (입문자/학습자/실무자/숙련자/전문가)
- EmailChangeModal `kind` 4종 (primary, secondary, verify-primary, verify-secondary)
- 메모리: `project_account_workspace_profile_split.md`

### ✅ Q Note 용어 통일 + UX
- i18n ko/en: 회의 → 음성메모, 회의 제목 → 제목, 회의 안내 → 안내 메모, 회의 언어 → 사용 언어, 회의 진행 → 녹음 시작, 회의 종료 → 음성메모 종료
- StartMeetingModal:
  - 목적 칩 (회의/상담/강의/인터뷰/메모/기타, 재클릭 토글)
  - 캡처 방식 안내 (호박색 박스, 마이크/화상회의 차이)
  - 프로필 미완성 배너 (bio/expertise/organization/job_title 비면 표시 + /profile 새 탭 링크)

### ✅ 검증 (/검증 9단계)
- 0단계 헬스체크 27/27
- 1단계 TS 0건
- 3단계 신규 라우트 익명 401 + 잘못된 토큰 403
- 4단계 빌드 산출물에 신규 i18n 키 모두 포함
- 6단계 25 항목 대조
- 8-A 색상 신규 코드 모두 COLOR_GUIDE 토큰 내
- 8-E i18n 하드코딩 0건 (5 파일)
- 9단계 SPA 라우팅 8 페이지 200

---

## 🔖 다음 할 일 (우선순위)

### A. 즉시 (다음 세션 첫 작업) — 백업 시스템
**위 "다음 세션 즉시 작업" 섹션 5단계 그대로 진행.** PlanQ 양방향 크로스 + deploy 시 mysqldump + POS 보강안.

### B. Q Note 실시간 번역 + 텍스트 표시 완성도 (Irene 핵심 피드백)
- Interim transcript 즉시 화면 표시 (회색 → final 검정)
- 글자수 단위 segmenting (긴 발화 자동 끊기, max_tokens 부족 fix)
- 번역 끊김 fix (chunked + retry)
- **범위**: `q-note/main.py` Python (Deepgram) + Frontend `LiveBoard` 양쪽
- 운영서버에 `python3.12-venv` 설치 + Q Note 포함 재배포 같이

### C. AI 사용량 페이지 (별도 사이클)
- 메뉴별 AI 사용량 (Q Note, Q Talk, Q Task, Cue, KB)
- 가장 많이 사용하는 영역 표시
- 플랫폼 개발자 뷰 (사용 영역 + 사용량)
- 통계/리포트 페이지 통합

### D. 운영 진입 후 폴리싱
- User 테이블 인덱스 64 한계 — 누적 unique constraint 정리
- KbDocument FK type — dev DB 도 정비 (운영은 fix 됨)
- Q Task `+ 업무 추가` 버튼 client 시 hidden (현재 Backend 차단으로 cosmetic)
- Python q-note 서비스 client 차단 (사이드바 가드만)
- platform_settings 사이클 (반나절) — `.env` 의 PLANQ_BILLING_BANK_*, EMAIL_LOGO_URL, SMTP_FROM 을 DB+관리자 UI 로
- 한/영 릴리즈노트 작성 + 버전 1.1.0 (이번 Q-H 사이클 분량)

---

## 📂 주요 위치
- 첫 운영 nginx + SSL 완료 commit: `661b893`
- Q-H 사이클 commit: `024d368` (운영 라이브)
- 운영 백업: `/opt/planq/backups/{TIMESTAMP}/` (deploy 시점, 코드만)
- 권한 매트릭스: `memory/project_client_permission_matrix.md`
- GDrive 정책: `memory/project_gdrive_policy.md`
- 프로필 분리: `memory/project_account_workspace_profile_split.md`
- 운영 배포: `scripts/deploy-planq.sh`
- POS dev 백업 스크립트 (참고): `/var/www/scripts/backup-database.sh` (dev)
- POS 운영 백업 스크립트 (참고): 운영서버 `/var/www/scripts/backup-database.sh`

---

## 🔑 환경
- dev backend port 3003 (planq-dev-backend), POS port 다름
- 운영 backend port 3004 (planq-prod-backend), POS port 3002 공존
- DB: dev planq_dev_db, 운영 planq_prod_db
- 운영 DB 비번: 운영서버 `/opt/planq/.db-password` (mode 600, 운영서버에만)
- dev DB 비번: dev `/opt/planq/dev-backend/.env` `DB_PASSWORD`
- POS dev DB: `purple_dev_db` / dev_admin
- POS 운영 DB: 운영서버 `/var/www/production-backend/.env` 안

---

## ⚠️ 미해결 (이번 청크 잔여)
- Q Note 페이지 (`pages/QNote/QNotePage.tsx`) 의 잔여 "회의" 라벨 — 다음 폴리싱
- ProfilePage Trans 컴포넌트의 i18n key 일부 (description 안의 strong 태그 라벨)
- 자동 롤백 (deploy verify 실패 시 자동 백업 복원) — 백업 시스템 완성 후 추가

---

## 🤝 사용자 흐름 권장 (다음 세션 시작 시)

1. session-state.md 읽고 컨텍스트 복원
2. **즉시 백업 시스템 5단계 진행** (위 섹션)
3. 양 서버 1차 수동 실행 + 첫 파일 도착 확인
4. Irene 에게 POS 보강안 안내 (위 "POS 보강안" 섹션 그대로)
5. Q Note 실시간 번역 작업 (B) 또는 Irene 우선순위 따라
