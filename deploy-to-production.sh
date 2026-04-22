#!/bin/bash
#
# PlanQ Production Deployment Script
# 개발서버(87.106.11.184)에서 운영서버(87.106.78.146)로 SSH 배포.
#
# 사용법:
#   ./deploy-to-production.sh            # 대화형
#   ./deploy-to-production.sh --auto     # 자동
#   ./deploy-to-production.sh --skip-build
#
# 전제 조건 (운영서버 irene@87.106.78.146 에 사전 세팅 — 초기 1회):
#   - /opt/planq-prod/{backend,frontend-build,uploads,logs} 디렉토리
#   - MySQL planq_prod_db + planq_prod_admin 계정
#   - PM2 planq-production-backend 등록 (포트 3004)
#   - nginx planq.kr + www.planq.kr → localhost:3004
#   - Let's Encrypt 인증서
#   - /opt/planq-prod/backend/.env.production (JWT_SECRET·DB·SMTP·Google OAuth)
#
# 동일 서버의 PurpleHere POS 서비스와 충돌 없음:
#   POS: 3001/3002, production-backend, /var/www/production-*
#   PlanQ: 3004, planq-production-backend, /opt/planq-prod/*
#

set -e

# ─── Colors ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Configuration ───
PROD_SERVER="irene@87.106.78.146"
LOCAL_DEV_BACKEND="/opt/planq/dev-backend"
LOCAL_DEV_FRONTEND="/opt/planq/dev-frontend"
LOCAL_FRONTEND_BUILD="/opt/planq/dev-frontend-build"
REMOTE_PROD_BACKEND="/opt/planq-prod/backend"
REMOTE_PROD_FRONTEND="/opt/planq-prod/frontend-build"
REMOTE_BACKUP_DIR="/opt/planq-prod/backups"
REMOTE_UPLOADS="/opt/planq-prod/uploads"
REMOTE_QNOTE="/opt/planq-prod/q-note"
LOCAL_QNOTE="/opt/planq/q-note"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ─── Flags ───
AUTO_MODE=false
SKIP_BUILD=false
SKIP_QNOTE=false
DRY_RUN=false

for arg in "$@"; do
    case $arg in
        --auto) AUTO_MODE=true ;;
        --skip-build) SKIP_BUILD=true ;;
        --skip-qnote) SKIP_QNOTE=true ;;
        --dry-run) DRY_RUN=true ;;
    esac
done

# ─── Helpers ───
log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

confirm() {
    $AUTO_MODE && return 0
    read -p "$(echo -e ${YELLOW}$1${NC}) [y/N]: " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || { warn "취소"; exit 0; }
}

run_remote() {
    $DRY_RUN && { echo "[DRY] ssh $PROD_SERVER $*"; return; }
    ssh -o ConnectTimeout=10 "$PROD_SERVER" "$@"
}

rsync_to_remote() {
    local src=$1 dst=$2 exclude_flags=$3
    $DRY_RUN && { echo "[DRY] rsync $src → $PROD_SERVER:$dst"; return; }
    # shellcheck disable=SC2086
    rsync -avz --delete $exclude_flags "$src/" "$PROD_SERVER:$dst/"
}

# ─── Header ───
echo ""
echo "============================================"
echo "  PlanQ Production Deployment"
echo "  From: 개발서버 (87.106.11.184)"
echo "  To:   운영서버 (87.106.78.146)"
echo "  Time: $TIMESTAMP"
$DRY_RUN && echo "  Mode: DRY RUN (no changes)"
echo "============================================"
echo ""

# ─── Step 1: SSH 연결 확인 ───
log "1/10 SSH 연결 확인"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$PROD_SERVER" "echo OK" > /dev/null 2>&1 \
    || error "SSH 연결 실패. SSH 키 설정 확인: ssh-copy-id $PROD_SERVER"
success "SSH OK"

# ─── Step 2: 개발서버 헬스체크 ───
log "2/10 개발서버 헬스체크 (localhost:3003)"
curl -sf "http://localhost:3003/api/health" > /dev/null \
    || error "개발 백엔드 응답 없음. 먼저 개발 환경 정상 확인 후 재실행."
success "개발 백엔드 OK"

node /opt/planq/scripts/health-check.js > /tmp/planq-healthcheck.log 2>&1 \
    || { cat /tmp/planq-healthcheck.log | tail -10; error "헬스체크 실패"; }
success "헬스체크 27/27"

# ─── Step 3: 운영서버 디렉토리 존재 확인 ───
log "3/10 운영서버 디렉토리 확인"
run_remote "test -d $REMOTE_PROD_BACKEND && test -d $REMOTE_PROD_FRONTEND" \
    || error "운영 디렉토리 없음. 초기 세팅 필요: $REMOTE_PROD_BACKEND, $REMOTE_PROD_FRONTEND"
success "디렉토리 OK"

# ─── Step 4: 백업 ───
log "4/10 운영서버 백업 생성 ($TIMESTAMP)"
confirm "계속하시겠습니까?"
run_remote "mkdir -p $REMOTE_BACKUP_DIR && \
    cp -r $REMOTE_PROD_BACKEND $REMOTE_BACKUP_DIR/backend_$TIMESTAMP && \
    cp -r $REMOTE_PROD_FRONTEND $REMOTE_BACKUP_DIR/frontend_$TIMESTAMP"
success "백업 완료: $REMOTE_BACKUP_DIR/{backend,frontend}_$TIMESTAMP"

# ─── Step 5: 프론트엔드 빌드 ───
if ! $SKIP_BUILD; then
    log "5/10 프론트엔드 로컬 빌드"
    cd "$LOCAL_DEV_FRONTEND"
    npm run build || error "빌드 실패"
    success "빌드 완료"
else
    warn "빌드 스킵 (--skip-build)"
fi

# ─── Step 6: 백엔드 rsync ───
log "6/10 백엔드 동기화"
rsync_to_remote "$LOCAL_DEV_BACKEND" "$REMOTE_PROD_BACKEND" \
    "--exclude=node_modules --exclude=.env --exclude=uploads --exclude=logs --exclude=tests --exclude=*.log"
success "백엔드 rsync 완료"

# ─── Step 7: 프론트엔드 rsync ───
log "7/10 프론트엔드 빌드 산출물 동기화"
rsync_to_remote "$LOCAL_FRONTEND_BUILD" "$REMOTE_PROD_FRONTEND" ""
success "프론트엔드 rsync 완료"

# ─── Step 8: Q Note 동기화 (선택) ───
if ! $SKIP_QNOTE; then
    log "8/10 Q Note 동기화"
    rsync_to_remote "$LOCAL_QNOTE" "$REMOTE_QNOTE" \
        "--exclude=__pycache__ --exclude=.venv --exclude=data --exclude=.env --exclude=*.db"
    success "Q Note rsync 완료"
else
    warn "Q Note 스킵 (--skip-qnote)"
fi

# ─── Step 9: 운영서버 npm install + DB sync + PM2 재시작 ───
log "9/10 운영서버 의존성 설치 + PM2 재시작"
run_remote "cd $REMOTE_PROD_BACKEND && \
    npm install --production --silent && \
    NODE_ENV=production node sync-database.js && \
    pm2 restart planq-production-backend --update-env"
success "운영 백엔드 재시작"

# Q Note 별도 재시작 (Python)
if ! $SKIP_QNOTE; then
    run_remote "cd $REMOTE_QNOTE && \
        [ -d .venv ] || python3 -m venv .venv; \
        .venv/bin/pip install -q -r requirements.txt && \
        pm2 restart planq-qnote-prod --update-env || pm2 start .venv/bin/uvicorn --name planq-qnote-prod -- main:app --host 0.0.0.0 --port 8001"
    success "Q Note 재시작"
fi

# ─── Step 10: 운영 헬스체크 + nginx reload ───
log "10/10 운영서버 헬스체크"
sleep 3
run_remote "curl -sf http://localhost:3004/api/health" > /dev/null \
    || error "운영 백엔드 응답 없음. pm2 logs planq-production-backend 확인"
success "운영 백엔드 3004 OK"

run_remote "sudo systemctl reload nginx"
success "nginx reload"

# ─── 외부 접근 확인 ───
if curl -sf "https://planq.kr/api/health" > /dev/null 2>&1; then
    success "planq.kr 외부 접근 OK"
else
    warn "planq.kr 외부 확인 실패. Cloudflare/nginx 설정 확인."
fi

echo ""
echo "============================================"
success "배포 완료 — $TIMESTAMP"
echo "  백업 경로: $REMOTE_BACKUP_DIR/{backend,frontend}_$TIMESTAMP"
echo "  롤백: ssh $PROD_SERVER 'bash /opt/planq/rollback-production.sh $TIMESTAMP'"
echo "============================================"
