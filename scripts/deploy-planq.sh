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

  # ★ 고아 링크 정리 + connection_id FK 도 **pre-sync 여야 한다** (아래 idempotent 슬롯 아님).
  #   sync-database.js:29 가 SET FOREIGN_KEY_CHECKS=0 으로 alter 를 도는데, FK 검사가 꺼진 상태의
  #   ADD FOREIGN KEY 는 기존 행을 검증하지 않는다 → 모델 references 를 보고 sync 가 FK 를 붙이면
  #   **고아가 남은 채 FK 만 공존하는 최악 상태**가 조용히 만들어진다. 정리가 먼저여야 한다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-gcal-link-fk.js 2>&1 | tail -10"

  log "Syncing DB schema on prod..."
  # ★ 이번 배포에 스키마가 바뀌었는지를 **기계가 판정**해 개발 현황에 남긴다.
  #   사람이 "마이그레이션 있음" 을 적게 두면 반드시 어긋난다. 모델/마이그레이션 파일이
  #   직전 배포 이후 손댔는지로 본다(LAST_REMOTE 가 없으면 판단 불가 → false).
  if [ -n "${LAST_REMOTE:-}" ] && ! git -C /opt/planq diff --quiet "${LAST_REMOTE}" HEAD -- dev-backend/models dev-backend/scripts/migrate- 2>/dev/null; then
    DEPLOY_SCHEMA_CHANGED=true
  fi
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
  # #353 ⑤ 업무 중요도 — tasks.priority_level ENUM 신설 (NULL default, 백필 없음).
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저 끝나야 한다(신 코드가 없는 컬럼에 쓰면 실패).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-task-priority-level.js 2>&1 | tail -10"
  # #259 게스트 링크 — clients.guest_user_id · users.is_guest · 킬스위치 2컬럼.
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저. guest_links 테이블은 sync-database 가 만든다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-guest-links.js 2>&1 | tail -10"
  # #259 2차 — 게스트 링크에서 고객 의존을 뗀다 (client_id NULL 허용 · guest_links.guest_user_id 신설
  #   · clients.guest_user_id DROP). ★ 반드시 1차 뒤에. 멱등이며 운영 링크 0건이라 백필 없음.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-guest-link-owner.js 2>&1 | tail -12"
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
  #   ★ pipefail 규칙은 위 prod_run 정의부 주석 참조 — 이 블록의 모든 DB 단계에 일괄 적용돼 있다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-reverse-sync.js 2>&1 | tail -10"
  # #244 수령확인 회전 — refresh_tokens.first_used_at + revoked_reason ENUM 값 추가.
  #   ★ PM2 reload **앞**이어야 한다. 모델이 first_used_at 을 선언하므로 컬럼 없이 새 백엔드가 뜨면
  #     RefreshToken 조회 전체가 ER_BAD_FIELD_ERROR → **로그인·세션 갱신 전멸**이다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-refresh-delivery-confirm.js 2>&1 | tail -10"
  # #239 문서 외부 컨펌 — signature_requests.kind/confirmed_at/comment/comment_at + status ENUM 2값.
  #   ★ PM2 reload **앞**이어야 한다. 신 코드가 kind='confirm'·status='confirmed' 를 쓰므로
  #     컬럼/ENUM 없이 새 백엔드가 뜨면 Data truncated 로 확인 기능이 통째로 죽는다.
  #   ★ 롤백은 **코드만 revert**. 컬럼·ENUM 은 남긴다(옛 코드에 무해). 단 models/SignatureRequest.js 의
  #     컬럼 선언은 revert 금지 — sync alter 가 모델에 없는 컬럼을 DROP 한다. (스크립트 헤더 참조)
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-doc-external-confirm.js 2>&1 | tail -10"

  # #379 — Drive 역방향 동기화 스키마 (gdrive_sync_logs · file_folders.gdrive_folder_id).
  #   ★ 2026-08-28 실측: sync-database 가 모델 정의를 보고 **우연히** 만들어 줬다. 그래도 명시한다 —
  #     자동 생성에 기대면 sync alter 64키 한도(memory)나 모델 로딩 순서 변화에 조용히 실패한다.
  #     멱등이라 이미 있으면 skip 한다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-gdrive-sync.js 2>&1 | tail -10"

  # #385 — 체크박스 빠른완료가 진행률을 안 채워 완료 업무가 진척 그래프에서 증발하던 것.
  #   쓰기측(services/actions/task_actions.js complete)은 고쳤고, **이미 쌓인 것**을 여기서 정리한다.
  #   멱등 — 이미 100 이면 건드리지 않는다(dev 실측: 적용 후 재실행 0건).
  #   ★ 완료일 **이후** 스냅샷만 고친다 — 완료 전 날짜는 실제로 진행 중이었다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-completed-progress.js --apply 2>&1 | tail -8"

  # #378 — 문서에 들어간 파일/이미지가 그 문서의 프로젝트·노출범위를 안 따라가던 것.
  #   쓰기측(업로드 경로)은 고쳤고, 여기서 **이미 쌓인 것**을 문서 기준으로 맞춘다.
  #   넓히기 한 방향뿐 · 임시저장(L1) 문서는 제외 · 볼 사람이 안 정해지는 L2 는 건너뛴다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-post-file-scope.js --apply 2>&1 | tail -12"

  # 파일 휴지통 — files.deleted_by / files.purged_at (멱등 ALTER).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-file-trash.js 2>&1 | tail -6"
  # 옛 삭제분 stamp — 이 변경 전의 삭제는 **바이트까지 지웠다.** 그 행들을 휴지통에 그대로 두면
  #   목록이 "눌러도 안 되는 항목" 으로 채워진다(dev 실측 1292건). 디스크를 실제로 확인해
  #   **없는 것만** purged_at 을 찍는다 — 옛 코드도 sibling 이 있으면 물리삭제를 보류했으므로
  #   되살릴 수 있는 것이 섞여 있다. 멱등(dev 실측: 적용 후 재실행 0건).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-file-purged.js --apply 2>&1 | tail -6"

  # Drive 역방향 v2 — 정본 축 분리(files.origin_provider) · Drive 체크섬 자리(files.drive_md5)
  #   · 인제스트 커서. 백필까지 한 스크립트 안에서 하고 **검산 실패 시 exit 1** 이라 배포가 멈춘다.
  #   여기가 없으면 코드만 올라가고 컬럼이 없어 조용히 죽는다(memory: 게이트에 안 붙은 가드는 없는 가드).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-gdrive-origin.js 2>&1 | tail -8"

  # #384 — 메일별 후속 알림 기간 (email_threads.follow_up_days). NULL=기본 3일 · 0=끔 · N=N일.
  #   백필하지 않는다 — NULL 이 곧 "기본값" 이라 옛 대화의 동작이 그대로 유지된다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-followup-days.js 2>&1 | tail -6"

  # task_candidates.conversation_id NULL 허용 — 운영만 NOT NULL 이라 **메일에서 업무가 나오면
  #   항상 500** 이었다(2026-08-29 운영 실측). sync-database 는 기존 컬럼의 NULL 허용을 안 바꾼다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-candidate-nullable-conv.js 2>&1 | tail -5"

  # 운영 #360 — 연결 post 가 없는 표(q_record)는 화면에서 열 길이 없다.
  #   Q record 메뉴 폐지 후 표를 여는 통로는 post(kind=table) 뿐인데, POST /api/records 가
  #   post 없이 표만 만들 수 있어 운영에 도달 불가 표가 생겼다(#12 "앱 스토어 개발자 계정", 행 15).
  #   가시성(vlevel·target_member_ids)은 원본 표에서 그대로 옮기므로 더 넓게 보이지 않는다.
  log "Backfilling orphan record posts (#360)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-orphan-record-posts.js --apply 2>&1 | tail -8"
  success "마이그레이션 완료 (push native / invoice-payment / account-deletion / mail-notify / task-hold / mail-delivery / calendar-sync / calendar-split / calendar-reverse-sync / doc-confirm / file-trash / gdrive-origin / mail-followup / candidate-null)"

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

  # ★ 2026-08-24 사고 — `--delete` 로 옛 청크를 즉시 지웠다가 운영 화면이 깨졌다.
  #   빌드마다 파일명 해시가 바뀌므로 새 산출물은 새 파일로 올라온다. 그런데 옛 파일을 지우면,
  #   **이미 옛 번들을 로드한 브라우저**가 참조하는 lazy 청크가 404 가 되어 그 순간부터
  #   모든 요청이 `Failed to fetch` 로 죽는다(메일 전송·AI 초안·목록 갱신 전부).
  #   자동 새로고침 가드(BuildVersionGuard.isReloadSafe)는 입력 중이면 reload 를 미루므로,
  #   작업 중인 사용자일수록 정확히 이 함정에 빠진다.
  #   → 옛 청크는 지우지 않고 남긴다. index.html 은 no-cache 라 새로고침하면 새 번들로 간다.
  #   정리는 별도 주기 작업으로 (예: 30일 지난 assets 삭제) — 배포 시점에 지우지 않는다.
  RSYNC_FLAGS="-az"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_FE_BUILD/ $PROD_HOST:$PROD_FE_BUILD/"
    if [ -d "$DEV_FE_BUILD" ]; then
      rsync -azn -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/" | head -10
    fi
  else
    [ -d "$DEV_FE_BUILD" ] || { error "$DEV_FE_BUILD 없음 — build 먼저"; exit 1; }
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/"
    success "frontend 배포 완료 (옛 청크 보존 — 사용 중 사용자의 화면이 깨지지 않게)"
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

    # venv 생성(첫 배포) + requirements 변경 시 재설치
    #
    # ★ 여태 `if [ ! -d venv ]` 라 **첫 배포에만** pip install 이 돌았다. 운영 venv 는 이미
    #   있으므로 requirements.txt 에 새 패키지를 넣어도 **영영 설치되지 않는다** — 코드만
    #   올라가고 의존성은 안 따라오는, `.env` 플래그가 rsync 보호로 죽던 것과 같은 계열이다
    #   (memory feedback_env_flag_default_off_dies_silently). 파이썬 쪽만 뚫려 있었다
    #   (Node 는 매 배포 npm ci 가 돈다). Fable 설계 게이트에서 발각 (2026-08-30).
    #
    #   해시를 venv 안에 박아 두고 바뀔 때만 설치한다 — 안 바뀌면 수 밀리초, 바뀌면 그때만 느리다.
    prod_run "set -o pipefail
      if [ ! -d $PROD_QNOTE/venv ]; then
        echo '[Q Note venv 생성 — 첫 배포]'
        python3 -m venv $PROD_QNOTE/venv
        $PROD_QNOTE/venv/bin/pip install --upgrade pip --quiet
      fi
      REQ=$PROD_QNOTE/requirements.txt
      STAMP=$PROD_QNOTE/venv/.requirements.sha256
      NEW=\$(sha256sum \"\$REQ\" | awk '{print \$1}')
      OLD=\$(cat \"\$STAMP\" 2>/dev/null || echo none)
      if [ \"\$NEW\" != \"\$OLD\" ]; then
        echo \"[Q Note requirements 변경 감지 (\$OLD → \$NEW) — pip install 실행]\"
        $PROD_QNOTE/venv/bin/pip install -r \"\$REQ\" --quiet 2>&1 | tail -5
        echo \"\$NEW\" > \"\$STAMP\"
      else
        echo '[Q Note requirements 무변경 — pip install 건너뜀]'
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
# 장부 닫기 (운영 #276) — **배포와 같은 실행 안에서** 끝낸다.
#
# 왜 배포에 붙이는가: 나중에 사람이 따로 닫기로 하면 안 닫힌다. 2026-08-18 실측으로 운영 피드백
#   67건 중 29건이 "이미 고쳐 배포까지 끝났는데 pending" 이었고, 그래서 같은 것이 세 번까지
#   재신고됐다(팝아웃 핀 #258 → #280 → #286). 사용자에겐 "말해도 반응이 없다" 이다.
#   고친 사실이 **도달**해야 처리된 것이므로, 도달하는 시점(배포)에 장부도 같이 닫는다.
#
# 안전장치는 close-deployed-feedback.js 안에 있다 — **답글 없는 건은 닫지 않고**, 이미 done 이면
#   건너뛴다(멱등). 여기서는 이번에 나가는 커밋들의 `#번호` 만 넘긴다.
#   실패해도 배포를 되돌리지 않는다 — 코드는 이미 정상 반영된 상태다.
# ──────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
# 릴리즈 노트 자동 발행 (운영 #346 · #289)
# ─────────────────────────────────────────────────────────────
#   Irene: "배포하고 업데이트하면 자동으로 스피커 아이콘에 공지로 나가는 거 아니야?
#           우리가 업데이트하면서 바뀌는 거나 중요한 부분들 제대로 표시해야 하는데 왜 안되지?"
#           "업데이트하는 내용 알리는 것도 안되고 자동화되어서 개발하면 내역이 정돈되어서
#            고객에게 공지되어야 하는데 그것도 없어."
#
#   여태 이 단계가 배포 스크립트에 **아예 없었다.** 문서(스킬)에만 "버전 올릴까요?" 로 적혀 있어
#   사람이 기억할 때만 나갔고, 그래서 대부분의 배포가 사용자에게 고지되지 않았다.
#
#   규칙:
#   - 발행 대상은 `docs/release-notes/v<package.json version>.json` 하나뿐이다.
#     버전을 올리면서 노트를 안 썼으면 **발행할 것이 없다** → 경고만 하고 배포는 계속한다
#     (노트가 없다고 이미 끝난 배포를 실패시키면 안 된다).
#   - `publish-release-note.js` 는 slug `update-<버전>` 으로 **upsert** 라 재배포해도 글이 하나다(멱등).
#   - 이 단계는 verify 뒤에 둔다 — 서버가 실제로 살아난 뒤에 고지해야 사용자가 눌렀을 때 열린다.
publish_release_note() {
  log "Publishing release note..."
  local VER NOTE
  VER=$(node -p "require('/opt/planq/dev-backend/package.json').version" 2>/dev/null || echo "")
  if [ -z "$VER" ]; then warn "  버전을 읽지 못함 — 릴리즈 노트 건너뜀"; return 0; fi
  NOTE="/opt/planq/docs/release-notes/v${VER}.json"
  if [ ! -f "$NOTE" ]; then
    warn "  v${VER} 릴리즈 노트 없음 — 사용자에게 이번 배포가 고지되지 않습니다"
    dim  "  (작성 위치: docs/release-notes/v${VER}.json — ko/en 짝 필수)"
    return 0
  fi
  if [ "$DRY_RUN" = true ]; then dim "  [dry] scp $NOTE + publish-release-note.js --publish"; return 0; fi
  scp $SSH_OPTS -q "$NOTE" "$PROD_HOST:/tmp/v${VER}.json" || { warn "  노트 전송 실패 — 건너뜀"; return 0; }
  # 실패해도 배포를 되돌리지 않는다 — 코드는 이미 나갔고, 고지는 나중에 손으로도 할 수 있다.
  if prod_run "cd $PROD_BE && node scripts/publish-release-note.js /tmp/v${VER}.json --publish"; then
    success "릴리즈 노트 v${VER} 발행 완료 (새 소식에 노출)"
    DEPLOY_RELEASE_NOTE_PUBLISHED=true
  else
    warn "  릴리즈 노트 발행 실패 — 배포 자체는 정상. 수동 발행 필요"
  fi
  prod_run "rm -f /tmp/v${VER}.json" || true
}

close_feedback() {
  log "Closing deployed feedback in ledger..."
  cd /opt/planq

  if [ -z "${LAST_REMOTE:-}" ]; then
    dim "  (first deploy — 범위가 없어 건너뜀)"
    return 0
  fi

  # ★ 본문의 `#숫자` 를 긁으면 **안 된다.** 실측 반증(2026-08-21): 이 브랜치 5커밋에서 그렇게 뽑으니
  #   123,167,180,213,…,258,274,280,286,288,300 이 나왔다 — #123·#167·#180·#274 는 근거로 인용한
  #   **업무 번호**이고 #258·#280·#286 은 주석에 든 옛 사례 번호다. 그대로 닫았으면 고치지도 않은
  #   사용자 신고가 done 으로 바뀐다(장부 어긋남의 반대 방향 사고).
  #   → **명시적 트레일러만** 인정한다:  `Feedback-Closes: 213, 220`
  #   인용은 자유롭게 하되, 닫으려면 그 줄을 의도적으로 적어야 한다.
  #   grep 무매치는 exit 1 이라 || true 필수 — set -euo pipefail 아래서 배포 전체가 중단된다.
  local RANGE_IDS BACKLOG_IDS IDS
  RANGE_IDS=$( { git log --format=%B "${LAST_REMOTE}..HEAD" 2>/dev/null || true; } \
               | grep -iE '^[[:space:]]*Feedback-Closes:' \
               | grep -oE '[0-9]{2,5}' || true )

  # 이미 배포가 끝난 옛 커밋의 번호는 위 범위에 **영영 안 들어온다** — 그런 잔여분을 담는 자리.
  #   (2026-08-21 실측: #213 #220 #222 #232 #257 #260 #287 이 6b3f4590·41158147 에서 나가
  #    운영에 도달했는데 장부는 pending 이었다.) 닫힌 뒤 다시 실려도 스크립트가 건너뛴다(멱등).
  BACKLOG_IDS=$( { grep -oE '^[[:space:]]*[0-9]{3,4}\b' /opt/planq/scripts/feedback-close-backlog.txt 2>/dev/null || true; } \
                 | tr -d ' \t' || true )

  # ★ 철회 트레일러 — 앞선 커밋의 `Feedback-Closes:` 를 **나중 커밋이 취소**한다.
  #   커밋 메시지는 되돌릴 수 없다. 그런데 "다 고친 줄 알았는데 부분 해결이었다" 는 흔하다
  #   (2026-08-28 실측: #378 은 5개 요구 중 2개만 고쳤는데 트레일러를 넣어 닫힐 뻔했다).
  #   부분 해결을 닫으면 나머지가 묻히고, 사용자는 무시당했다고 느낀다.
  #   사용법:  Feedback-Keeps-Open: 378
  local KEEP_IDS
  KEEP_IDS=$( { git log --format=%B "${LAST_REMOTE}..HEAD" 2>/dev/null || true; } \
              | grep -iE '^[[:space:]]*Feedback-Keeps-Open:' \
              | grep -oE '[0-9]{2,5}' || true )
  IDS=$( printf '%s\n%s\n' "$RANGE_IDS" "$BACKLOG_IDS" | grep -E '^[0-9]+$' | sort -un \
         | { if [ -n "$KEEP_IDS" ]; then grep -vxF -f <(printf '%s\n' $KEEP_IDS) || true; else cat; fi; } \
         | paste -sd, - || true )
  if [ -n "$KEEP_IDS" ]; then dim "  (열어둠: $(printf '%s' "$KEEP_IDS" | paste -sd, -) — 부분 해결)"; fi
  # 개발현황(publish_dev_status)이 같은 값을 다시 계산하지 않게 전역에 남긴다.
  # 두 곳이 각자 뽑으면 반드시 갈라진다 — 한쪽은 닫았다 하고 한쪽은 안 닫았다 한다.
  DEPLOY_CLOSED_IDS="$IDS"
  DEPLOY_KEPT_IDS=$(printf '%s' "$KEEP_IDS" | paste -sd, - || true)

  if [ -z "$IDS" ]; then
    dim "  (커밋 메시지에 피드백 번호가 없어 건너뜀)"
    return 0
  fi
  echo "  대상 번호: $IDS"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] scp scripts/close-deployed-feedback.js → $PROD_HOST:/tmp/cdf.js"
    dim "  [dry] ssh $PROD_HOST 'cd $PROD_BE && node /tmp/cdf.js --ids $IDS --apply'"
    return 0
  fi

  # 운영에는 git 저장소도 scripts/ 도 없다(rsync 는 dev-backend 만 보낸다) → 실행 직전에 실어 보낸다.
  if ! scp $SSH_OPTS /opt/planq/scripts/close-deployed-feedback.js "$PROD_HOST:/tmp/cdf.js" > /dev/null 2>&1; then
    warn "장부 스크립트 전송 실패 — 장부는 수동으로 닫아야 합니다 (배포 자체는 정상)"
    return 0
  fi
  prod_run "cd $PROD_BE && node /tmp/cdf.js --ids $IDS --apply" \
    || warn "장부 닫기 실패 — 수동 확인 필요 (배포 자체는 정상)"
  prod_run "rm -f /tmp/cdf.js" > /dev/null 2>&1 || true
}

# ──────────────────────────────────────────
# Update record (.last-deployed-commit)
# ──────────────────────────────────────────
# ──────────────────────────────────────────
# 개발 현황 발행 (플랫폼 관리자 > 개발 현황)
# ──────────────────────────────────────────
#   왜 여기(스크립트) 인가: 문서(스킬)에만 적어 두면 사람이 기억할 때만 나간다 —
#   장부 닫기 3-B 가 이미 그렇게 스크립트와 어긋난 채 남아 있다.
#   릴리즈노트(publish_release_note)와 같은 정책: 실패해도 배포를 되돌리지 않는다.
#
#   ★ 기계가 아는 사실은 사람이 적지 않는다. 이 함수가 --meta 로 주입하고,
#     json 에는 서술(무엇을 했고 무엇이 열려 있는지)만 적는다.
publish_dev_status() {
  log "Publishing dev status..."
  cd /opt/planq
  local HEAD_FULL NOTE META SHORT MY_VER
  HEAD_FULL=$(git rev-parse HEAD)
  SHORT=$(git rev-parse --short HEAD)
  # ★ publish_release_note 의 $VER 은 그 함수의 local 이라 여기까지 안 온다 —
  #   첫 실전(6ffbc710)에서 version 이 null 로 들어갔다. 여기서 직접 읽는다.
  MY_VER=$(node -p "require('/opt/planq/dev-backend/package.json').version" 2>/dev/null || echo "")
  # ★ 커밋 해시는 커밋하기 전에는 알 수 없다. 그래서 작성 중인 현황은 next.json 에 쓰고,
  #   배포 시점에 이 스크립트가 실제 HEAD 로 도장을 찍는다(파일은 그대로 두고 DB 키만 커밋).
  #   특정 배포를 다시 쓸 일이 있으면 {짧은해시}.json 을 만들어 두면 그쪽이 우선한다.
  NOTE="/opt/planq/docs/dev-status/${SHORT}.json"
  [ -f "$NOTE" ] || NOTE="/opt/planq/docs/dev-status/next.json"
  if [ ! -f "$NOTE" ]; then
    warn "  개발 현황 없음 (docs/dev-status/${SHORT}.json 또는 next.json) — 이번 배포가 장부에 안 남습니다"
    return 0
  fi
  dim "  원본: $(basename "$NOTE")"

  META=$(cat <<EOF
{"commit_to":"$HEAD_FULL","commit_from":"${LAST_REMOTE:-}","version":"${MY_VER:-}",
 "deployed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","backup_dir":"$BACKUP_DIR",
 "closed_feedback_ids":[$(printf '%s' "${DEPLOY_CLOSED_IDS:-}" | tr -d ' ')],
 "kept_open_ids":[$(printf '%s' "${DEPLOY_KEPT_IDS:-}" | tr -d ' ')],
 "pdf_check":"${PDF_CHECK_RESULT:-미실행}",
 "release_note_published":${DEPLOY_RELEASE_NOTE_PUBLISHED:-false},
 "schema_changed":${DEPLOY_SCHEMA_CHANGED:-false}}
EOF
)
  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] scp $NOTE + publish-dev-status.js --meta"
    return 0
  fi
  scp $SSH_OPTS -q "$NOTE" "$PROD_HOST:/tmp/devstatus-${SHORT}.json" || { warn "  전송 실패 — 건너뜀"; return 0; }
  if prod_run "cd $PROD_BE && node scripts/publish-dev-status.js /tmp/devstatus-${SHORT}.json --meta '$META'"; then
    success "개발 현황 발행 완료 (${SHORT})"
  else
    warn "  개발 현황 발행 실패 — 배포 자체는 정상"
  fi
  prod_run "rm -f /tmp/devstatus-${SHORT}.json" > /dev/null 2>&1 || true
}

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
  publish_release_note
  close_feedback
  publish_dev_status
  show_summary
  update_record

  END=$(date +%s)
  ELAPSED=$((END - START))

  echo ""
  echo -e "${GREEN}=========================================${NC}"
  echo -e "${GREEN}  Deployment Complete (${ELAPSED}s)${NC}"
  echo -e "${GREEN}=========================================${NC}"
  # ★ `$DRY_RUN && dim ...` 로 두면 실배포(DRY_RUN=false)에서 이 줄이 1 을 반환하고,
  #   그것이 main() 의 마지막 명령이라 **성공한 배포가 exit 1 로 끝난다.**
  #   그 탓에 "배포 exit 1 은 무시해도 된다" 가 학습돼 진짜 실패까지 가려진다.
  if $DRY_RUN; then dim "(dry-run — 실제 변경 없음)"; fi
  return 0
}

main
