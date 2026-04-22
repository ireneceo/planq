#!/bin/bash
#
# PlanQ Production Rollback — 지정 타임스탬프 백업으로 되돌리기
#
# 사용법:
#   ./rollback-production.sh 20260422_213000
#
set -e

TIMESTAMP=$1
[ -z "$TIMESTAMP" ] && { echo "Usage: $0 <YYYYMMDD_HHMMSS>"; exit 1; }

REMOTE_PROD_BACKEND="/opt/planq-prod/backend"
REMOTE_PROD_FRONTEND="/opt/planq-prod/frontend-build"
REMOTE_BACKUP_DIR="/opt/planq-prod/backups"

BACKEND_BACKUP="$REMOTE_BACKUP_DIR/backend_$TIMESTAMP"
FRONTEND_BACKUP="$REMOTE_BACKUP_DIR/frontend_$TIMESTAMP"

[ -d "$BACKEND_BACKUP" ] && [ -d "$FRONTEND_BACKUP" ] || { echo "백업 없음: $TIMESTAMP"; exit 1; }

echo "[$(date +%H:%M:%S)] 롤백 시작 → $TIMESTAMP"

# 현재 상태를 추가 백업 (롤백의 롤백용)
CUR_TS=$(date +%Y%m%d_%H%M%S)
cp -r "$REMOTE_PROD_BACKEND" "$REMOTE_BACKUP_DIR/backend_preroll_$CUR_TS"
cp -r "$REMOTE_PROD_FRONTEND" "$REMOTE_BACKUP_DIR/frontend_preroll_$CUR_TS"

# 백업 복원
rsync -a --delete "$BACKEND_BACKUP/" "$REMOTE_PROD_BACKEND/"
rsync -a --delete "$FRONTEND_BACKUP/" "$REMOTE_PROD_FRONTEND/"

# DB 마이그레이션 주의 — 스키마가 앞으로만 간 경우 자동 롤백 불가
echo "[WARN] DB 스키마는 자동 롤백 안 함. 필요 시 수동 확인: SHOW TABLES + describe."

# 재시작
cd "$REMOTE_PROD_BACKEND"
npm install --production --silent
pm2 restart planq-production-backend --update-env

sleep 3
curl -sf http://localhost:3004/api/health > /dev/null && echo "[OK] 롤백 완료" || echo "[ERROR] 헬스 실패 — pm2 logs 확인"

sudo systemctl reload nginx
