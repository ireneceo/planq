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
  prod_run "cd $PROD_BE && npm ci --omit=dev --silent 2>&1 | tail -3"
  success "deps 설치 완료"
}

# ──────────────────────────────────────────
# DB schema sync (Sequelize alter)
# ──────────────────────────────────────────
sync_database() {
  log "Syncing DB schema on prod..."
  prod_run "cd $PROD_BE && NODE_ENV=production node sync-database.js 2>&1 | tail -20"
  success "DB sync 완료"

  # sync-database(Sequelize alter)가 못 하는 것 — ENUM 확장·NULL 허용 변경·백필.
  # 전부 멱등이라 매 배포 실행해도 안전하다. 순서 중요: 이걸 건너뛴 채 신 모델 코드가
  # 올라가면 push_subscriptions 조회가 Unknown column 으로 죽어 기존 웹푸시까지 전멸한다.
  log "Running idempotent migrations..."
  prod_run "cd $PROD_BE && NODE_ENV=production node scripts/migrate-push-native.js 2>&1 | tail -10"
  success "마이그레이션 완료 (push native / client_kind)"
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

  NODE_OPTIONS='--max-old-space-size=8192' npm run build > "$BUILD_LOG" 2>&1
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
