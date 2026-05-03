#!/bin/bash
# PlanQ 개발 DB 자동 백업 스크립트 (dev)
# 실행: 매일 새벽 4:30 (POS dev 04:00 와 30분 offset)
# 결과: /var/backups/planq-db/daily/dev_db_YYYY-MM-DD.sql.gz (14일 보관)
# 크로스: scp → 운영서버 87.106.78.146:/home/irene/backups/cross-backup/dev-planq/

# .env 파일에서 DB 정보 로드
if [ -f "/opt/planq/dev-backend/.env" ]; then
    source <(grep -E "^DB_" /opt/planq/dev-backend/.env | sed 's/^/export /')
    DB_USER=$DB_USER
    DB_PASS=$DB_PASSWORD
    DB_NAME=$DB_NAME
else
    echo "Error: /opt/planq/dev-backend/.env not found"
    exit 1
fi

# 설정
BACKUP_DIR="/var/backups/planq-db"
DATE=$(date +%Y-%m-%d)
LOG_FILE="/opt/planq/logs/backup-planq-dev.log"

# 백업 디렉토리 생성
mkdir -p $BACKUP_DIR/daily
mkdir -p /opt/planq/logs

echo "==================================================" >> $LOG_FILE
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting PlanQ dev DB backup..." >> $LOG_FILE

# 데이터베이스 백업 (압축)
BACKUP_FILE="$BACKUP_DIR/daily/dev_db_${DATE}.sql.gz"

mysqldump -u $DB_USER -p$DB_PASS \
  --single-transaction \
  --quick \
  --lock-tables=false \
  --routines \
  --triggers \
  --no-tablespaces \
  $DB_NAME | gzip > $BACKUP_FILE

# 백업 성공 여부 확인
if [ $? -eq 0 ] && [ -s $BACKUP_FILE ]; then
    BACKUP_SIZE=$(du -h $BACKUP_FILE | cut -f1)
    echo "$(date '+%Y-%m-%d %H:%M:%S') - OK Backup successful: $BACKUP_FILE ($BACKUP_SIZE)" >> $LOG_FILE
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - FAIL Backup failed!" >> $LOG_FILE
    exit 1
fi

# 14일 이상 된 백업 삭제
find $BACKUP_DIR/daily/ -name "dev_db_*.sql.gz" -mtime +14 -delete
# 운영이 push 한 prod-planq cleanup (14일)
find /home/irene/backups/cross-backup/prod-planq/ -name "db_*.sql.gz" -mtime +14 -delete 2>/dev/null
echo "$(date '+%Y-%m-%d %H:%M:%S') - Cleaned up backups older than 14 days" >> $LOG_FILE

# 백업 디렉토리 총 용량
TOTAL_SIZE=$(du -sh $BACKUP_DIR | cut -f1)
echo "$(date '+%Y-%m-%d %H:%M:%S') - Total backup size: $TOTAL_SIZE" >> $LOG_FILE

# 크로스 백업: dev DB 백업을 운영서버로 전송
CROSS_BACKUP_DIR="irene@87.106.78.146:/home/irene/backups/cross-backup/dev-planq"
scp -o ConnectTimeout=10 -q $BACKUP_FILE $CROSS_BACKUP_DIR/ 2>/dev/null
if [ $? -eq 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - OK Cross-backup sent to production server" >> $LOG_FILE
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - WARN Cross-backup to production server failed" >> $LOG_FILE
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - PlanQ dev DB backup completed!" >> $LOG_FILE
