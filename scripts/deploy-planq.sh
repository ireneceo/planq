#!/bin/bash
#
# PlanQ Production Deployment Script v1.0
#
# 모델: dev 서버 → 운영서버 SSH rsync push (POS deploy-production-v3.sh 패턴 + 서버간 SSH)
#
# 사용법:
#   ./deploy-planq.sh              # 대화형 (확인 프롬프트 1회)
#   ./deploy-planq.sh --auto       # 자동 모드 (CI/CD 또는 검증된 재배포)
#   ./deploy-planq.sh --dry-run    # 미리보기 (rsync -n + 실제 명령 출력만)
#   ./deploy-planq.sh --skip-build # 백엔드만 (긴급 hotfix)
#   ./deploy-planq.sh --skip-qnote # Q Note 제외
#
# 사전 조건 (운영서버 1회 셋업, 이미 완료):
#   1) /opt/planq/{backend,frontend-build,q-note,logs,uploads} mkdir
#   2) MySQL: planq_prod_db / planq_admin (생성됨)
#   3) /opt/planq/backend/.env (운영값 입력 — 첫 dry-run 후 운영서버 Claude 가 입력)
#   4) /etc/nginx/sites-available/planq.kr (첫 dry-run 후 설정)
#   5) PM2 ecosystem 등록 (첫 deploy 후 자동)
#   6) DNS: planq.kr → 87.106.78.146 (등록됨, 24h propagation 대기)

set -euo pipefail

# ─── 설정 ───
DEV_BE="/opt/planq/dev-backend"
DEV_FE="/opt/planq/dev-frontend"
DEV_FE_BUILD="/opt/planq/dev-frontend-build"
DEV_QNOTE="/opt/planq/q-note"

PROD_HOST="irene@87.106.78.146"
PROD_BE="/opt/planq/backend"
PROD_FE_BUILD="/opt/planq/frontend-build"
PROD_QNOTE="/opt/planq/q-note"
PROD_LOGS="/opt/planq/logs"
PROD_BACKUPS="/opt/planq/backups"
PROD_PORT=3004
PROD_DOMAIN="planq.kr"

PM2_BACKEND="planq-prod-backend"
PM2_QNOTE="planq-prod-qnote"
PM2_MCP="planq-prod-mcp"   # #D-4 MCP 읽기 서버 (127.0.0.1:3005, 외부 노출은 nginx /mcp 라우트 필요)

SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh $SSH_OPTS"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$PROD_BACKUPS/$TIMESTAMP"

# ─── 플래그 ───
AUTO_MODE=false
DRY_RUN=false
SKIP_BUILD=false
SKIP_QNOTE=false

for arg in "$@"; do
  case "$arg" in
    --auto)       AUTO_MODE=true ;;
    --dry-run)    DRY_RUN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-qnote) SKIP_QNOTE=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ─── 색상 ───
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; GRAY='\033[90m'; NC='\033[0m'
log()     { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
dim()     { echo -e "${GRAY}$1${NC}"; }

confirm() {
  if [ "$AUTO_MODE" = true ]; then return 0; fi
  read -p "$1 (yes/no): " response
  [ "$response" = "yes" ]
}

# 운영서버에서 명령 실행 (dry-run 시 출력만)
#
# ★ 원격 파이프는 종료코드를 가린다 — `| tail`/`| head` 를 쓰는 명령에는 명령 문자열 **맨 앞에**
#   `set -o pipefail;` 을 직접 붙여야 한다. 이 함수는 `ssh HOST "$1"` 이라 파이프가 **원격 셸에서**
#   돌고, 이 스크립트 상단의 `set -euo pipefail` 은 거기까지 미치지 않는다.
#   실측 반증: `ssh HOST 'false | tail -10'` → **exit 0** (실패가 통째로 삼켜진다).
#             `ssh HOST 'set -o pipefail; false | tail -10'` → exit 1.
#   이걸 빠뜨리면 마이그레이션·npm ci 가 실패해도 배포가 계속 진행돼, 스키마가 안 바뀐 상태로
#   새 백엔드가 떠서 `ER_BAD_FIELD_ERROR` 로 기능이 통째로 죽는다.
#   → **신규 prod_run 에 파이프를 쓰면 pipefail 을 같이 넣을 것.**
prod_run() {
  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] ssh $PROD_HOST '$1'"
  else
    ssh $SSH_OPTS "$PROD_HOST" "$1"
  fi
}

# ──────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────
preflight_check() {
  log "Pre-flight checks..."

  # 1) dev 디렉터리 존재
  [ -d "$DEV_BE" ] || { error "$DEV_BE 없음"; exit 1; }
  [ -d "$DEV_FE" ] || { error "$DEV_FE 없음"; exit 1; }
  success "dev 소스 디렉터리 OK"

  # 2) dev 서버 health (코드가 작동하는지)
  if curl -sf --max-time 3 http://localhost:3003/api/health > /dev/null; then
    success "dev 서버 health OK (port 3003)"
  else
    warn "dev 서버 health 응답 없음 — 진행은 가능 (배포 후 운영에서 검증)"
  fi

  # 3) 운영서버 SSH 도달
  if ssh $SSH_OPTS -o BatchMode=yes "$PROD_HOST" 'echo ok' > /dev/null 2>&1; then
    success "운영서버 SSH OK ($PROD_HOST)"
  else
    error "운영서버 SSH 실패 — authorized_keys 확인"
    exit 1
  fi

  # 4) 운영서버 디렉터리 + .env 존재
  if [ "$DRY_RUN" = false ]; then
    PROD_OK=$(ssh $SSH_OPTS "$PROD_HOST" "[ -d $PROD_BE ] && [ -d $PROD_FE_BUILD ] && [ -d $PROD_QNOTE ] && [ -d $PROD_LOGS ] && echo ok || echo fail")
    [ "$PROD_OK" = "ok" ] || { error "운영서버 디렉터리 누락 — mkdir -p $PROD_BE $PROD_FE_BUILD $PROD_QNOTE $PROD_LOGS"; exit 1; }
    success "운영서버 디렉터리 구조 OK"

    # .env 는 첫 배포 시점에 없을 수 있음 — dry-run 후 운영서버 Claude 가 채움. 경고만 출력
    if ! ssh $SSH_OPTS "$PROD_HOST" "[ -f $PROD_BE/.env ]"; then
      warn "$PROD_BE/.env 아직 없음 — 첫 dry-run 후 운영서버에서 입력 필요 (.env.production.example 템플릿 사용)"
    fi
  fi

  # 5) uncommitted 변경 경고 (재현성)
  cd /opt/planq
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "uncommitted 변경사항 있음 — 운영 배포 전 커밋 권장"
    if [ "$AUTO_MODE" = false ] && [ "$DRY_RUN" = false ]; then
      read -p "그래도 진행? (yes/no): " ANS
      [ "$ANS" = "yes" ] || { error "취소"; exit 1; }
    fi
  fi
}

# ──────────────────────────────────────────
# Show changes since last deployed commit
# ──────────────────────────────────────────
show_changes() {
  log "Changes since last deployment..."

  cd /opt/planq
  CURRENT=$(git rev-parse HEAD)
  echo "  Current HEAD: ${CURRENT:0:7} ($(git log -1 --format='%s' | head -c 80))"

  LAST_REMOTE=$(ssh $SSH_OPTS "$PROD_HOST" "cat $PROD_BE/.last-deployed-commit 2>/dev/null" || echo "")
  if [ -n "$LAST_REMOTE" ]; then
    echo "  Last deployed: ${LAST_REMOTE:0:7}"
    CHANGED=$(git diff --name-only "$LAST_REMOTE" HEAD 2>/dev/null | wc -l || echo "?")
    echo "  Changed files: $CHANGED"
    # head -10 이 파이프를 조기에 닫아 git diff/grep 이 SIGPIPE(141) → set -euo pipefail 이 배포 전체를
    # 중단시키던 버그(변경파일 >10 인 모든 증분 배포). || true 로 흡수.
    (git diff --name-only "$LAST_REMOTE" HEAD 2>/dev/null | grep -E '^(dev-(backend|frontend)|q-note)' | head -10 | sed 's/^/    /') || true
  else
    echo "  Last deployed: (first deploy)"
  fi
  echo ""
}

# ──────────────────────────────────────────
# Backup (운영서버에서 — .env, backend, frontend-build tar)
# ──────────────────────────────────────────
create_backup() {
  log "Creating backup on prod..."

  prod_run "
    mkdir -p $BACKUP_DIR
    [ -f $PROD_BE/.env ] && cp $PROD_BE/.env $BACKUP_DIR/.env.backup || true
    if [ -d $PROD_BE ] && [ \"\$(ls -A $PROD_BE 2>/dev/null)\" ]; then
      tar -czf $BACKUP_DIR/backend.tar.gz --exclude=node_modules --exclude='*.log' -C /opt/planq backend 2>/dev/null || true
    fi
    if [ -d $PROD_FE_BUILD ] && [ \"\$(ls -A $PROD_FE_BUILD 2>/dev/null)\" ]; then
      tar -czf $BACKUP_DIR/frontend-build.tar.gz -C /opt/planq frontend-build 2>/dev/null || true
    fi
    # DB mysqldump (운영 변경 직전 스냅샷, 롤백용 — 일별 백업과 별개)
    if [ -f /opt/planq/.db-password ]; then
      mysqldump --single-transaction --quick --lock-tables=false --routines --triggers --no-tablespaces \\
        -u planq_admin -p\$(cat /opt/planq/.db-password) planq_prod_db 2>/dev/null \\
        | gzip > $BACKUP_DIR/db.sql.gz || echo 'WARN: db dump failed (continue)'
    else
      echo 'WARN: /opt/planq/.db-password 없음 — DB 백업 스킵'
    fi
    # Rotation: 최신 14개만 보관 (deploy 백업)
    ls -1t $PROD_BACKUPS 2>/dev/null | tail -n +15 | xargs -I {} rm -rf $PROD_BACKUPS/{} 2>/dev/null || true
    echo \"Backup at: $BACKUP_DIR\"
  "
  success "Backup 완료"
}

# ──────────────────────────────────────────
# Sync backend (rsync over SSH, .env/uploads/node_modules 제외)
# ──────────────────────────────────────────
sync_backend() {
  log "Syncing backend (rsync over SSH)..."

  RSYNC_FLAGS="-az --delete --exclude=.env --exclude=.env.* --exclude=node_modules --exclude=uploads --exclude='*.log' --exclude=.server.pid"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_BE/ $PROD_HOST:$PROD_BE/"
    rsync -azn --delete --exclude=.env --exclude=.env.* --exclude=node_modules --exclude=uploads --exclude='*.log' --exclude=.server.pid -e "$RSYNC_SSH" "$DEV_BE/" "$PROD_HOST:$PROD_BE/" | head -20
  else
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_BE/" "$PROD_HOST:$PROD_BE/"
    success "백엔드 sync 완료"
  fi
}

# ──────────────────────────────────────────
# Install backend deps (운영서버에서 npm ci --omit=dev)
# ──────────────────────────────────────────
install_deps() {
  log "Installing backend deps on prod..."
  prod_run "set -o pipefail; cd $PROD_BE && npm ci --omit=dev --silent 2>&1 | tail -3"
  success "deps 설치 완료"
}

# ──────────────────────────────────────────
# DB schema sync (Sequelize alter)
# ──────────────────────────────────────────
sync_database() {
  # ★ rename 마이그레이션은 sync-database **앞**에서 돌아야 한다.
  #   sequelize alter:true 는 **모델에 없는 컬럼을 DROP** 한다. sync 가 먼저 돌면
  #   옛 gcal_sync 가 삭제되면서 그 값(사용자가 끈 연동)이 파괴되고, 새 컬럼이 default 1 로
  #   생겨 **껐던 일정이 전부 다시 켜진다.** 그 뒤엔 rename 할 대상이 없어 이 스크립트도 무력하다.
  #   Fable 게이트가 재현으로 확정한 경로다 — 순서를 바꾸지 말 것.
  log "Running pre-sync migrations (rename)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-sync-split.js 2>&1 | tail -10"

  log "Syncing DB schema on prod..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node sync-database.js 2>&1 | tail -20"
  success "DB sync 완료"

  # sync-database(Sequelize alter)가 못 하는 것 — ENUM 확장·NULL 허용 변경·백필.
  # 전부 멱등이라 매 배포 실행해도 안전하다. 순서 중요: 이걸 건너뛴 채 신 모델 코드가
  # 올라가면 push_subscriptions 조회가 Unknown column 으로 죽어 기존 웹푸시까지 전멸한다.
  log "Running idempotent migrations..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-push-native.js 2>&1 | tail -10"
  # Q Bill 결제 원장 — invoice_payments.installment_id (매출 통계 원천). 코드보다 먼저.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-invoice-payment-installment.js 2>&1 | tail -10"
  # 계정 삭제(회원 탈퇴) 스키마 — users/businesses/business_members 컬럼.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-account-deletion.js 2>&1 | tail -10"
  # #203/#207 Q Mail 알림 — notification_prefs/notifications ENUM 확장 + email_accounts.notify_scope.
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저 끝나야 한다(신 코드가 먼저 뜨면 Data truncated).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-notify.js 2>&1 | tail -10"
  # #206 Q Task 보류/외부컨펌 — tasks.status ENUM 에 on_hold/external_review append + hold 컬럼 2개.
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저 끝나야 한다(신 코드가 먼저 뜨면 Data truncated).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-task-hold-status.js 2>&1 | tail -10"
  # Q Mail 발송 상태 — email_messages.delivery_status ENUM 에 'suppressed' append.
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저 끝나야 한다(신 코드가 먼저 뜨면 Data truncated).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-email-delivery-status.js 2>&1 | tail -10"
  # 캘린더 연동 토글 — sync_enabled 2컬럼 + calendar_events.gcal_sync + calendar_event_gcal_links 테이블.
  #   이 스크립트는 sync-database 보다 **뒤에** 돌기 때문에(위 222행), 테이블은 대개 sync 가 먼저 만든다.
  #   그래서 FK 보증은 여기가 아니라 **모델 CalendarEventGcalLink 의 references/onDelete** 가 한다
  #   (모델에 없으면 sync 가 FK 없이 만들고, 이 스크립트는 hasTable 로 skip 해 FK 가 영구 누락된다).
  #   이 스크립트는 컬럼 3개와 "sync 가 손대지 않는 경우" 의 안전망 역할.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-sync-toggles.js 2>&1 | tail -10"
  # #242 ② 역방향 동기화 — gcal_sync_token ×2 · last_pushed_etag · calendar_events DATETIME(3).
  #   ★ 반드시 PM2 reload **앞**에서 돈다. 모델이 gcal_sync_token 을 선언하므로 컬럼 없이 새
  #     백엔드가 뜨면 ExternalConnection 조회 전체가 ER_BAD_FIELD_ERROR 로 죽는다(외부연동·캘린더 전멸).
  #   ★ sync-database 에 맡기면 안 된다 — 그쪽은 모델별 alter 실패를 exit 0 으로 삼키고(64키 한도 전례),
  #     DATETIME(3) 정밀도 승격이 반영된다는 보장도 없다. 이 스크립트는 스키마를 재조회해 판정하고
  #     실패 시 exit 1 을 낸다.
  #   ★ pipefail 규칙은 아래 "원격 파이프" 주석 참조 — 이 블록의 모든 DB 단계에 일괄 적용돼 있다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-reverse-sync.js 2>&1 | tail -10"
  success "마이그레이션 완료 (push native / invoice-payment / account-deletion / mail-notify / task-hold / mail-delivery / calendar-sync / calendar-split / calendar-reverse-sync)"

  # 백필 — 마이그레이션 후. 과거 paid invoice/회차에 payment 원장 생성(멱등). 매출 0 복구.
  log "Backfilling invoice payments..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-invoice-payments.js 2>&1 | tail -6"
  success "백필 완료 (invoice payments)"
}

# ──────────────────────────────────────────
# Build frontend (dev 서버에서)
# ──────────────────────────────────────────
build_frontend() {
  if [ "$SKIP_BUILD" = true ]; then
    dim "▶ build 스킵 (--skip-build)"
    return 0
  fi
  log "Building frontend on dev..."

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] cd $DEV_FE && npm run build"
    return 0
  fi

  cd "$DEV_FE"
  rm -rf node_modules/.cache 2>/dev/null || true

  # N+75-B — 빌드 메모리 8GB 강제 (N+74 배포 사고 박제).
  # 옛 4GB 로 OOM Killed → backend rsync 완료 + frontend 옛 빌드 그대로 → 미완성 배포 회귀.
  # set -eu 가 pipe exit code 못 잡으니 PIPESTATUS 검사 + index.html mtime 사전·사후 비교로 이중 안전망.
  BUILD_LOG="/tmp/planq-deploy-build-$(date +%s).log"
  PRE_MTIME=$(stat -c %Y "$DEV_FE_BUILD/index.html" 2>/dev/null || echo 0)

  # heap 4096 — dev 는 7.7GB 머신이라 8192 는 OOM 으로 Terminated 된다(2026-07-24 부분배포 실사고).
  #   package.json build 도 인라인 4096 이라 여기 환경변수는 정합용. 8192 로 올리지 말 것.
  NODE_OPTIONS='--max-old-space-size=4096' npm run build > "$BUILD_LOG" 2>&1
  BUILD_EXIT=$?
  tail -8 "$BUILD_LOG"

  if [ $BUILD_EXIT -ne 0 ]; then
    error "Frontend build 실패 (exit $BUILD_EXIT) — log: $BUILD_LOG"
    exit 1
  fi
  if [ ! -f "$DEV_FE_BUILD/index.html" ]; then
    error "Frontend build 실패 — $DEV_FE_BUILD/index.html 없음 (log: $BUILD_LOG)"
    exit 1
  fi
  POST_MTIME=$(stat -c %Y "$DEV_FE_BUILD/index.html" 2>/dev/null || echo 0)
  if [ "$POST_MTIME" = "$PRE_MTIME" ]; then
    error "Frontend build 실패 — index.html mtime 갱신 안 됨 (옛 빌드 그대로). log: $BUILD_LOG"
    exit 1
  fi
  rm -f "$BUILD_LOG"
  success "frontend 빌드 완료"
}

# ──────────────────────────────────────────
# Deploy frontend (rsync 빌드 산출물)
# ──────────────────────────────────────────
deploy_frontend() {
  log "Deploying frontend (rsync)..."

  RSYNC_FLAGS="-az --delete"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_FE_BUILD/ $PROD_HOST:$PROD_FE_BUILD/"
    if [ -d "$DEV_FE_BUILD" ]; then
      rsync -azn --delete -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/" | head -10
    fi
  else
    [ -d "$DEV_FE_BUILD" ] || { error "$DEV_FE_BUILD 없음 — build 먼저"; exit 1; }
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/"
    success "frontend 배포 완료"
  fi
}

# ──────────────────────────────────────────
# Sync Q Note (rsync, venv 제외)
# ──────────────────────────────────────────
sync_qnote() {
  if [ "$SKIP_QNOTE" = true ]; then dim "▶ Q Note 스킵 (--skip-qnote)"; return 0; fi
  [ -d "$DEV_QNOTE" ] || { dim "▶ Q Note 디렉터리 없음 — 스킵"; return 0; }

  log "Syncing Q Note (rsync)..."
  RSYNC_FLAGS="-az --delete --exclude=venv --exclude=data --exclude=uploads --exclude=.env --exclude='*.db' --exclude=__pycache__ --exclude='*.pyc'"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_QNOTE/ $PROD_HOST:$PROD_QNOTE/"
    rsync -azn --delete --exclude=venv --exclude=data --exclude=uploads --exclude=.env --exclude='*.db' --exclude=__pycache__ --exclude='*.pyc' -e "$RSYNC_SSH" "$DEV_QNOTE/" "$PROD_HOST:$PROD_QNOTE/" | head -10
  else
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_QNOTE/" "$PROD_HOST:$PROD_QNOTE/"

    # 첫 배포 시 venv 자동 생성
    prod_run "
      if [ ! -d $PROD_QNOTE/venv ]; then
        echo '[Q Note venv 생성 — 첫 배포]'
        python3 -m venv $PROD_QNOTE/venv
        $PROD_QNOTE/venv/bin/pip install --upgrade pip --quiet
        $PROD_QNOTE/venv/bin/pip install -r $PROD_QNOTE/requirements.txt --quiet
      fi
    "
    success "Q Note sync 완료"
  fi
}

# ──────────────────────────────────────────
# Restart PM2 (운영서버)
# ──────────────────────────────────────────
restart_server() {
  log "Restarting PM2 on prod..."

  prod_run "
    if pm2 describe $PM2_BACKEND > /dev/null 2>&1; then
      pm2 reload $PM2_BACKEND --update-env
    else
      cd $PROD_BE && pm2 start server.js --name $PM2_BACKEND --max-memory-restart 1G
    fi
    if [ -d $PROD_QNOTE/venv ]; then
      if pm2 describe $PM2_QNOTE > /dev/null 2>&1; then
        pm2 reload $PM2_QNOTE
      else
        # 보안 하드닝(C1 트랙A): 127.0.0.1 바인드 — q-note 를 인터넷에 직접 노출하지 않음.
        # nginx(/qnote/→localhost:8001)·Node(→localhost:8001) 내부통신 무해. 최초 기동 시 적용.
        pm2 start $PROD_QNOTE/venv/bin/uvicorn --name $PM2_QNOTE --interpreter $PROD_QNOTE/venv/bin/python -- main:app --host 127.0.0.1 --port 8001 --app-dir $PROD_QNOTE
      fi
    fi
    # #D-4 MCP 읽기 서버 — 127.0.0.1:3005 바인드(코드가 강제). 외부 노출은 nginx /mcp 라우트를 별도 적용해야 열린다.
    if [ -f $PROD_BE/mcp/server.js ]; then
      if pm2 describe $PM2_MCP > /dev/null 2>&1; then
        pm2 reload $PM2_MCP --update-env
      else
        cd $PROD_BE && MCP_PORT=3005 pm2 start mcp/server.js --name $PM2_MCP --max-memory-restart 300M
      fi
    fi
    pm2 save
  "
  success "PM2 reload 완료"
}

# ──────────────────────────────────────────
# Reload nginx (운영서버, sudo 필요 — sudoers NOPASSWD 또는 사전 승인)
# ──────────────────────────────────────────
reload_nginx() {
  log "Reloading nginx on prod..."

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] ssh $PROD_HOST 'sudo systemctl reload nginx'"
    return 0
  fi

  if ssh $SSH_OPTS "$PROD_HOST" 'sudo -n systemctl reload nginx 2>&1' > /dev/null 2>&1; then
    success "nginx reload 완료"
  else
    warn "nginx reload 실패 또는 sudo 비번 필요 — 수동 처리: ssh $PROD_HOST 'sudo systemctl reload nginx'"
  fi
}

# ──────────────────────────────────────────
# Verify (헬스체크)
# ──────────────────────────────────────────
verify_deployment() {
  log "Verifying..."

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] curl https://$PROD_DOMAIN/api/health"
    dim "  [dry] curl http://localhost:$PROD_PORT/api/health (on prod)"
    return 0
  fi

  sleep 4

  # 1) 운영서버 내부 헬스체크 (SSL/DNS 와 무관)
  if ssh $SSH_OPTS "$PROD_HOST" "curl -sf --max-time 5 http://localhost:$PROD_PORT/api/health" > /dev/null; then
    success "운영서버 내부 health OK (localhost:$PROD_PORT)"
  else
    error "운영서버 내부 health 실패 — pm2 logs $PM2_BACKEND --lines 30 으로 확인"
    exit 1
  fi

  # 2) 외부 HTTPS 헬스체크 (DNS+SSL 둘 다 OK 일 때만)
  if curl -sf --max-time 5 "https://$PROD_DOMAIN/api/health" > /dev/null 2>&1; then
    success "외부 HTTPS health OK (https://$PROD_DOMAIN)"
  else
    warn "외부 HTTPS 미응답 — DNS propagation 또는 SSL 미발급 (운영 1차 진입 시 정상)"
  fi

  # 3) PDF 렌더 실호출 (#253 재발 검출)
  #    운영에만 헤드리스 Chrome 공유 라이브러리가 없어 PDF 6개 기능이 동시에 죽었던 계열.
  #    dev 는 라이브러리가 있어 코드 검증으로는 영원히 안 잡힌다 — 운영에서 1바이트 만들어봐야 안다.
  #    키는 운영 .env 에서 **운영 호스트 내부에서만** 추출 (dev 로 넘어오지 않게).
  PDF_OUT=$(ssh $SSH_OPTS "$PROD_HOST" \
    "K=\$(grep -m1 '^INTERNAL_API_KEY=' $PROD_BE/.env | cut -d= -f2- | tr -d '\"'\\''' | tr -d '\r'); \
     [ -z \"\$K\" ] && echo 'NOKEY' && exit 0; \
     curl -s --max-time 45 -H \"x-internal-api-key: \$K\" http://localhost:$PROD_PORT/api/internal/health/pdf" 2>/dev/null || echo "SSHFAIL")

  if echo "$PDF_OUT" | grep -q '"magic_ok":true'; then
    PDF_BYTES=$(echo "$PDF_OUT" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
    success "운영 PDF 렌더 OK (${PDF_BYTES} bytes, %PDF-)"
    PDF_CHECK_RESULT="OK (${PDF_BYTES} bytes)"
  else
    # 배포를 중단하지는 않는다 — 코드는 이미 착지했고, 메일·공유링크는 degraded 로 계속 동작한다.
    # 다만 조용히 넘어가면 #253 처럼 무증상으로 몇 달을 간다 → 배너 + Summary 잔존.
    echo ""
    echo -e "${RED}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${NC}"
    echo -e "${RED}  운영 PDF 렌더 실패 — PDF 기능 전체(청구서·문서·보고서·${NC}"
    echo -e "${RED}  공개 미리보기·Q info·정기청구 메일)가 죽어 있을 수 있음${NC}"
    echo -e "${RED}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${NC}"
    echo "  응답: $(echo "$PDF_OUT" | head -c 300)"
    echo ""
    echo "  조치:"
    echo "    1) 이번 배포에서 puppeteer/Chrome 버전이 바뀌었는지 확인 (버전 bump = 라이브러리 재결손 1순위 경로)"
    echo "       ssh $PROD_HOST 'cd $PROD_BE && node -e \"console.log(require(\\\"puppeteer\\\").executablePath())\"'"
    echo "    2) 결손 라이브러리 점검:  ssh $PROD_HOST 'ldd <chrome 경로> | grep \"not found\"'"
    echo "    3) LD_LIBRARY_PATH 확인:  ssh $PROD_HOST 'grep LD_LIBRARY_PATH $PROD_BE/.env'"
    echo "    4) 필요 시 롤백:          $BACKUP_DIR"
    echo ""
    PDF_CHECK_RESULT="FAILED — 위 조치 참고"
  fi
}

# ──────────────────────────────────────────
# Update record (.last-deployed-commit)
# ──────────────────────────────────────────
update_record() {
  if [ "$DRY_RUN" = true ]; then return 0; fi
  cd /opt/planq
  COMMIT=$(git rev-parse HEAD)
  ssh $SSH_OPTS "$PROD_HOST" "echo $COMMIT > $PROD_BE/.last-deployed-commit"
}

# ──────────────────────────────────────────
# Summary
# ──────────────────────────────────────────
show_summary() {
  echo ""
  echo -e "${BLUE}=========================================${NC}"
  echo -e "${BLUE}  PlanQ Deployment Summary${NC}"
  echo -e "${BLUE}=========================================${NC}"
  cd /opt/planq
  echo ""
  echo "  Commit:    $(git rev-parse --short HEAD) — $(git log -1 --format='%s' | head -c 70)"
  echo "  Timestamp: $TIMESTAMP"
  echo "  Backup:    $BACKUP_DIR (on prod)"
  echo ""
  echo "  PDF 렌더:  ${PDF_CHECK_RESULT:-미실행}"
  echo ""
  echo "  Production:"
  echo "    https://$PROD_DOMAIN/api/health"
  echo "    pm2 logs $PM2_BACKEND --lines 30  (on prod)"
  echo ""
  echo "  Rollback:"
  echo "    ssh $PROD_HOST 'tar -xzf $BACKUP_DIR/backend.tar.gz -C /opt/planq && pm2 reload $PM2_BACKEND'"
  echo ""
}

# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────
main() {
  echo ""
  echo -e "${GREEN}=========================================${NC}"
  echo -e "${GREEN}  PlanQ Production Deployment v1.0${NC}"
  echo -e "${GREEN}=========================================${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    warn "DRY-RUN MODE — 실제 변경 없음"
    echo ""
  fi

  START=$(date +%s)

  preflight_check
  show_changes

  if [ "$AUTO_MODE" = false ] && [ "$DRY_RUN" = false ]; then
    confirm "Continue with deployment?" || { echo "취소됨"; exit 0; }
  fi

  echo ""

  create_backup
  sync_backend
  install_deps
  sync_database
  build_frontend
  deploy_frontend
  sync_qnote
  restart_server
  reload_nginx
  verify_deployment
  show_summary
  update_record

  END=$(date +%s)
  ELAPSED=$((END - START))

  echo ""
  echo -e "${GREEN}=========================================${NC}"
  echo -e "${GREEN}  Deployment Complete (${ELAPSED}s)${NC}"
  echo -e "${GREEN}=========================================${NC}"
  $DRY_RUN && dim "(dry-run — 실제 변경 없음)"
}

main
