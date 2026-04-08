#!/bin/bash
# PlanQ 일일 백업 스크립트
# cron: 0 3 * * * irene /opt/planq/scripts/backup.sh

set -e

DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)

# ===== DB 백업 =====
DB_BACKUP_DIR="/var/backups/planq-db/daily"
mkdir -p "$DB_BACKUP_DIR"

# .env에서 DB 정보 읽기
source <(grep -E "^DB_" /opt/planq/dev-backend/.env | sed 's/^/export /')

DB_FILE="$DB_BACKUP_DIR/planq_dev_${TIMESTAMP}.sql.gz"
mysqldump -u "$DB_USER" -p"$DB_PASSWORD" --single-transaction --quick "$DB_NAME" | gzip > "$DB_FILE"
echo "[BACKUP] DB: $DB_FILE"

# ===== 코드 백업 =====
CODE_BACKUP_DIR="/opt/planq/backups/dev-daily/$DATE"
mkdir -p "$CODE_BACKUP_DIR"

tar -czf "$CODE_BACKUP_DIR/dev-backend.tar.gz" \
  --exclude='node_modules' \
  -C /opt/planq dev-backend

tar -czf "$CODE_BACKUP_DIR/dev-frontend.tar.gz" \
  --exclude='node_modules' \
  --exclude='dist' \
  -C /opt/planq dev-frontend

echo "[BACKUP] Code: $CODE_BACKUP_DIR"

# ===== 업로드 파일 백업 =====
if [ -d "/opt/planq/dev-backend/uploads" ]; then
  tar -czf "$CODE_BACKUP_DIR/uploads.tar.gz" \
    -C /opt/planq/dev-backend uploads
  echo "[BACKUP] Uploads: $CODE_BACKUP_DIR/uploads.tar.gz"
fi

# ===== 오래된 백업 정리 (7일 이상) =====
find /var/backups/planq-db/daily -name "*.sql.gz" -mtime +7 -delete 2>/dev/null
find /opt/planq/backups/dev-daily -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null

echo "[BACKUP] Complete: $TIMESTAMP"
