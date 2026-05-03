#!/bin/bash
# PlanQ 운영 DB 자동 백업 스크립트 (production)
# 실행: 매일 새벽 3:30 (POS 운영 03:00 와 30분 offset)
# 결과: /opt/planq/backups-db/daily/db_YYYY-MM-DD.sql.gz (7일 보관)
#       (sudo 불필요 — irene 권한 디렉토리. dev 는 /var/backups/planq-db/ 사용)
# 크로스: scp → dev 서버 87.106.11.184:/home/irene/backups/cross-backup/prod-planq/
#         (POS 보강 핵심 — 운영 → dev 단방향이 빠져있던 부분)

# .env 파일에서 DB 정보 로드 (운영은 password 별도 파일)
if [ -f "/opt/planq/backend/.env" ] && [ -f "/opt/planq/.db-password" ]; then
    source <(grep -E "^DB_(NAME|USER|HOST)" /opt/planq/backend/.env | sed 's/^/export /')
    DB_PASS=$(cat /opt/planq/.db-password)
else
    echo "Error: /opt/planq/backend/.env or /opt/planq/.db-password not found"
    exit 1
fi

# 설정
BACKUP_DIR="/opt/planq/backups-db"
DATE=$(date +%Y-%m-%d)
LOG_FILE="/opt/planq/logs/backup-planq-prod.log"

# 백업 디렉토리 생성
mkdir -p $BACKUP_DIR/daily
mkdir -p $BACKUP_DIR/weekly
mkdir -p /opt/planq/logs

echo "==================================================" >> $LOG_FILE
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting PlanQ prod DB backup..." >> $LOG_FILE

# 데이터베이스 백업 (압축)
BACKUP_FILE="$BACKUP_DIR/daily/db_${DATE}.sql.gz"

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

# 7일 이상 된 일간 백업 삭제 (운영 = 짧게 보관, dev 가 복사본 보유)
find $BACKUP_DIR/daily/ -name "db_*.sql.gz" -mtime +7 -delete
# dev 가 push 한 dev-planq cleanup (14일)
find /home/irene/backups/cross-backup/dev-planq/ -name "dev_db_*.sql.gz" -mtime +14 -delete 2>/dev/null
echo "$(date '+%Y-%m-%d %H:%M:%S') - Cleaned up backups older than retention" >> $LOG_FILE

# 일요일이면 주간 백업 복사 (4주 보관)
if [ $(date +%u) -eq 7 ]; then
    WEEK=$(date +%Y-W%V)
    cp $BACKUP_FILE "$BACKUP_DIR/weekly/db_${WEEK}.sql.gz"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Weekly backup created: db_${WEEK}.sql.gz" >> $LOG_FILE
    find $BACKUP_DIR/weekly/ -name "db_*.sql.gz" -mtime +28 -delete
fi

# 백업 디렉토리 총 용량
TOTAL_SIZE=$(du -sh $BACKUP_DIR | cut -f1)
echo "$(date '+%Y-%m-%d %H:%M:%S') - Total backup size: $TOTAL_SIZE" >> $LOG_FILE

# 디스크 사용량 체크 (80% 이상이면 경고)
DISK_USAGE=$(df -h /var | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - WARN Disk usage is ${DISK_USAGE}%!" >> $LOG_FILE
fi

# 크로스 백업: 운영 DB 백업을 dev 서버로 전송 (POS 보강 핵심)
CROSS_BACKUP_DIR="irene@87.106.11.184:/home/irene/backups/cross-backup/prod-planq"
scp -o ConnectTimeout=10 -q $BACKUP_FILE $CROSS_BACKUP_DIR/ 2>/dev/null
if [ $? -eq 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - OK Cross-backup sent to dev server" >> $LOG_FILE
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - WARN Cross-backup to dev server failed" >> $LOG_FILE
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - PlanQ prod DB backup completed!" >> $LOG_FILE
