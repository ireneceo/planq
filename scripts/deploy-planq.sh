#!/bin/bash
#
# PlanQ Production Deployment Script v1.0
#
# 모델: dev 서버 → 운영서버 SSH rsync push (POS deploy-production-v3.sh 패턴 + 서버간 SSH)
#
# 사용법:
#   ./deploy-planq.sh              # 대화형 (확인 프롬프트 1회)
#   ./deploy-planq.sh --auto       # 자동 모드 (CI/CD 또는 검증된 재배포)
#   ./deploy-planq.sh --routine    # 정기 점검 배포 = --auto + 릴리즈노트(초안·발행) 안 함 (2026-10-12)
#   ./deploy-planq.sh --dry-run    # 미리보기 (rsync -n + 실제 명령 출력만)
#   ./deploy-planq.sh --skip-build # 백엔드만 (긴급 hotfix) — 프론트는 빌드도 rsync 도 안 한다
#   ./deploy-planq.sh --skip-qnote # Q Note 제외
#   ./deploy-planq.sh --skip-gates # 게이트 건너뜀 (장애 대응 hotfix 전용 — 평소 쓰지 말 것)
#
# 사전 조건 (운영서버 1회 셋업, 이미 완료):
#   1) /opt/planq/{backend,frontend-build,q-note,logs,uploads} mkdir
#   2) MySQL: planq_prod_db / planq_admin (생성됨)
#   3) /opt/planq/backend/.env (운영값 입력 — 첫 dry-run 후 운영서버 Claude 가 입력)
#   4) /etc/nginx/sites-available/planq.kr (첫 dry-run 후 설정)
#   5) PM2 ecosystem 등록 (첫 deploy 후 자동)
#   6) DNS: planq.kr → 87.106.78.146 (등록됨, 24h propagation 대기)

#
# ★ 2026-10-12 — **마지막 커밋의 깨끗한 사본에서 배포한다.**
#   Irene 2026-10-11: «배포를 하면 모든 작업 일시정지하고 점검 후 배포해야지. 진행중인 거 있으면 그건 빼고.»
#   여태 이 스크립트는 작업 폴더(/opt/planq)를 그대로 빌드·rsync 했다 — 다른 방이 고치던 미커밋 파일이
#   운영에 같이 나갔다. 이제 시작할 때 `scripts/make-deploy-snapshot.sh` 로 커밋 하나(DEPLOY_COMMIT)의
#   사본을 임시 폴더에 만들고, 가드·사본 검사·빌드·rsync·릴리즈노트·장부·기록을 **모두 그 사본/그 커밋**으로 한다.
#   작업 폴더는 **읽기만** 한다 — stash·checkout·커밋하지 않는다. 미커밋 = 다른 방의 진행 중 일, 이번 배포에서 빠진다.
#   작업 폴더 기준으로 남은 것: health-check 는 살아 있는 dev 서버(= 작업 폴더 코드)를 때린다 — 사본 백엔드는
#   운영 재시작 전까지 실행되지 않으므로 대신 `scripts/check-deploy-snapshot.js`(문법·커밋에 없는 require)가 막는다.
#   배포 방이 쓰는 기록(docs/dev-status/next.json · docs/release-notes · scripts/feedback-close-backlog.txt)도
#   **커밋된 것**을 읽는다 — 배포 전에 `git commit -- <그 경로>` 로 그 파일만 커밋한다(`git add -A` 금지).
#   dev 화면의 빌드(/opt/planq/dev-frontend-build)는 이제 배포가 건드리지 않는다 — 운영 번들은 사본 안에서 만든다.
#   ★ 2026-10-16 — 이 스크립트 자신도 그 커밋 것으로 돈다(아래 «절차도 커밋에서»). 작업 폴더의 이 파일이
#   미커밋이어도 멈추지 않고, 미커밋 슬롯 줄은 불리지 않는다.
set -euo pipefail

# ─── 설정 ───
REPO="/opt/planq"
# 아래 DEV_* 는 make_snapshot 이 사본 경로로 바꾼다 — 그 전에는 쓰지 않는다.
DEV_BE="$REPO/dev-backend"
DEV_FE="$REPO/dev-frontend"
DEV_FE_BUILD="$REPO/dev-frontend-build"
DEV_QNOTE="$REPO/q-note"
SNAP=""            # 사본 루트 (임시 폴더, 끝나면 지운다)
DEPLOY_COMMIT=""   # 이번에 운영으로 나가는 커밋 (40자)

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
SKIP_GATES=false
ROUTINE=false   # 상황판 정기 점검 배포 — 버전·릴리즈노트·공지·메일 없음 (Irene 2026-10-11 «배포는 아침점검에서 자동으로»)

for arg in "$@"; do
  case "$arg" in
    --auto)       AUTO_MODE=true ;;
    --routine)    AUTO_MODE=true; ROUTINE=true ;;
    --dry-run)    DRY_RUN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-qnote) SKIP_QNOTE=true ;;
    --skip-gates) SKIP_GATES=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ─── 절차도 커밋에서 — 시작할 때 커밋 하나를 고정하고, 그 커밋의 이 스크립트로 다시 실행한다 (2026-10-16) ───
#   10-12 Fable C1: 마이그 슬롯이 부르는 파일은 사본(커밋)에서 가는데 절차가 작업 폴더 것이면 «미커밋 슬롯 줄 +
#   미커밋 마이그 파일» 이 운영에서 없는 파일을 불러 반쪽 배포가 된다 → 그때는 배포 스크립트가 미커밋이면 멈췄다.
#   그런데 DB 를 바꾸는 일은 거의 다 이 파일에 슬롯 줄을 넣고, 정기 점검의 «저장하고 멈춤» 은 커밋하지 않는다 —
#   점검 시각에 그런 방이 하나라도 있으면 배포가 늘 멈췄다(10-16 00:15 · 방 35bb469f / d1871180).
#   이제 멈추지 않고 **절차와 사본을 같은 커밋으로 맞춘다**: 시작할 때 HEAD 를 한 번 읽어 고정(DEPLOY_PIN)하고,
#   그 커밋의 deploy-planq.sh · make-deploy-snapshot.sh 를 임시 폴더에 꺼내 그것으로 다시 실행한다.
#   미커밋 슬롯 줄은 그 절차에 없으므로 불리지 않는다(C1 이 막으려던 반쪽 배포는 그대로 막힌다).
#   깨끗할 때도 똑같이 다시 실행한다 — 내용이 같아 동작은 그대로이고, 배포 중 다른 방이 이 파일을 고쳐도
#   (bash 는 스크립트를 실행하면서 읽는다) 도는 절차가 바뀌지 않는다. 사본도 같은 DEPLOY_PIN 으로 만든다 —
#   시작 뒤 다른 방이 커밋해도 절차와 사본이 갈라지지 않는다.
SELF_FILES="scripts/deploy-planq.sh scripts/make-deploy-snapshot.sh"
if [ -z "${PLANQ_DEPLOY_PIN:-}" ]; then
  DEPLOY_PIN=$(git -C "$REPO" rev-parse --verify 'HEAD^{commit}') || { echo "[ERROR] HEAD 커밋을 읽지 못함 — 배포 중단"; exit 1; }
  # 지난 배포가 강제 종료로 남긴 절차 폴더(하루 넘은 것만 — 지금 도는 다른 배포의 것을 지우지 않게)
  find /tmp -maxdepth 1 -name 'planq-deploy-self.*' -mmin +1440 -exec rm -rf {} + 2>/dev/null || true
  SELF_TMP=$(mktemp -d /tmp/planq-deploy-self.XXXXXX)
  mkdir -p "$SELF_TMP/scripts"
  for f in $SELF_FILES; do
    git -C "$REPO" show "$DEPLOY_PIN:$f" > "$SELF_TMP/$f" || { echo "[ERROR] 커밋 ${DEPLOY_PIN:0:8} 에서 $f 를 꺼내지 못함 — 배포 중단"; rm -rf "$SELF_TMP"; exit 1; }
    chmod 700 "$SELF_TMP/$f"
  done
  SELF_DRIFT=$(git -C "$REPO" status --porcelain -- $SELF_FILES scripts/check-deploy-snapshot.js 2>/dev/null || true)
  echo "[$(date +%H:%M:%S)] 배포 절차 = 커밋 ${DEPLOY_PIN:0:8} 의 deploy-planq.sh (작업 폴더 것이 아니라)"
  if [ -n "$SELF_DRIFT" ]; then
    echo "[WARN] 작업 폴더의 배포 스크립트가 미커밋 — 다른 방의 진행 중 일로 보고 이번 배포에서 뺀다(그 슬롯 줄은 불리지 않음):"
    printf '%s\n' "$SELF_DRIFT" | sed 's/^/    /'
  fi
  export PLANQ_DEPLOY_PIN="$DEPLOY_PIN" PLANQ_DEPLOY_SELF_DIR="$SELF_TMP"
  exec bash "$SELF_TMP/scripts/deploy-planq.sh" "$@"
fi
# 여기부터는 커밋에서 꺼낸 절차다.
DEPLOY_PIN="$PLANQ_DEPLOY_PIN"
SELF_DIR="${PLANQ_DEPLOY_SELF_DIR:?}"
case "$SELF_DIR" in /tmp/planq-deploy-self.*) ;; *) echo "[ERROR] 절차 폴더가 이상함: $SELF_DIR"; exit 1 ;; esac
git -C "$REPO" rev-parse --verify "${DEPLOY_PIN}^{commit}" >/dev/null 2>&1 || { echo "[ERROR] 고정한 커밋 $DEPLOY_PIN 이 없음 — 배포 중단"; exit 1; }
# 다시 실행된 절차가 정말 그 커밋의 것인지 — 아니면 «절차와 사본이 같은 커밋» 이 거짓이 된다.
#   make-deploy-snapshot.sh 도 본다 — 사본 커밋(COMMIT 줄)을 찍는 것이 그 파일이라 바뀌면 PIN 대조까지 같이 속는다.
for f in $SELF_FILES; do
  if ! git -C "$REPO" show "$DEPLOY_PIN:$f" | cmp -s - "$SELF_DIR/$f"; then
    echo "[ERROR] 도는 배포 절차($f)가 커밋 ${DEPLOY_PIN:0:8} 의 것과 다름 — 배포 중단"; exit 1
  fi
done
cleanup_self() { rm -rf "$SELF_DIR"; }
trap cleanup_self EXIT

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
# 깨끗한 사본 (마지막 커밋) — 배포의 모든 입력은 여기서 나온다
# ──────────────────────────────────────────
cleanup_snapshot() {
  if [ -n "$SNAP" ] && [ -d "$SNAP" ]; then
    rm -rf "$SNAP"
  fi
  cleanup_self
}

make_snapshot() {
  log "마지막 커밋의 깨끗한 사본 만드는 중..."
  cd "$REPO"

  # 절차와 사본은 같은 커밋(DEPLOY_PIN)이다 — 위 «절차도 커밋에서» 가 이 스크립트를 그 커밋 것으로 다시 실행했다.
  #   (2026-10-12 Fable 게이트 C1 의 «미커밋이면 멈춤» 을 2026-10-16 «커밋된 절차로 다시 실행» 으로 바꿨다.)

  # 지난 배포가 강제 종료(SIGKILL)로 끝나 trap 이 못 지운 사본(.env 복사본 포함)을 치운다 — 배포 방은 한 번에 하나다.
  rm -rf /tmp/planq-deploy-src.* /tmp/planq-deploy-protect.* 2>/dev/null || true
  SNAP=$(mktemp -d /tmp/planq-deploy-src.XXXXXX)   # 700 — 사본에 dev .env 복사본이 들어간다
  trap cleanup_snapshot EXIT
  local OUT
  if ! OUT=$(bash "$SELF_DIR/scripts/make-deploy-snapshot.sh" "$SNAP" "$DEPLOY_PIN" 2>&1); then
    error "사본 만들기 실패 — 배포 중단"
    printf '%s\n' "$OUT" | tail -5
    exit 1
  fi
  DEPLOY_COMMIT=$(printf '%s\n' "$OUT" | awk '/^COMMIT /{print $2}' | tail -1)
  [ -n "$DEPLOY_COMMIT" ] || { error "사본 커밋을 읽지 못함 — 배포 중단"; exit 1; }
  [ "$DEPLOY_COMMIT" = "$DEPLOY_PIN" ] || { error "사본 커밋(${DEPLOY_COMMIT:0:8})이 절차 커밋(${DEPLOY_PIN:0:8})과 다름 — 배포 중단"; exit 1; }
  if [ "$(git rev-parse HEAD)" != "$DEPLOY_PIN" ]; then
    warn "시작 뒤 새 커밋이 생김 — 이번 배포는 시작 때 커밋 ${DEPLOY_PIN:0:8} 그대로 나간다(새 커밋은 다음 배포)"
  fi
  DEV_BE="$SNAP/dev-backend"
  DEV_FE="$SNAP/dev-frontend"
  DEV_FE_BUILD="$SNAP/dev-frontend-build"
  DEV_QNOTE="$SNAP/q-note"
  success "사본 준비 — 커밋 ${DEPLOY_COMMIT:0:8} ($(git log -1 --format='%s' "$DEPLOY_COMMIT" | head -c 70))"

  # 미커밋 = 다른 방의 진행 중 일 — **커밋하지 않고 빼고** 배포한다. 무엇이 빠지는지 보여만 준다.
  local DIRTY
  DIRTY=$(git status --porcelain 2>/dev/null | wc -l)
  if [ "$DIRTY" -gt 0 ]; then
    warn "작업 폴더 미커밋 ${DIRTY}개 — 진행 중인 일로 보고 이번 배포에서 뺀다 (작업 폴더는 건드리지 않음)"
    (git status --porcelain 2>/dev/null | head -10 | sed 's/^/    /') || true
  fi

  # 배포 방의 기록 파일이 커밋 안 됐으면 커밋된(옛) 내용이 나간다 — 알려 준다(막지는 않는다).
  local f
  for f in docs/dev-status/next.json scripts/feedback-close-backlog.txt docs/release-notes; do
    if [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then
      warn "배포 기록 '$f' 이 커밋 안 됨 — 커밋된 내용으로 나간다. 반영하려면: git commit -- $f"
    fi
  done

  # 자동 저장이 작업 브랜치에 커밋하면 진행 중 일이 «커밋된 것» 이 되어 사본에 섞인다.
  #   PlanQ 자동 저장(scripts/claude-autosave.sh)은 2026-08-10 부터 refs/autosave/* 에만 쌓아 지금은 생기지 않지만,
  #   옛 방식이 되살아나면 여기서 멈춘다(PurpleHere 같은 전환의 Fable 게이트 C1 과 같은 방어).
  if git log -1 --format=%s "$DEPLOY_COMMIT" | grep -qiE '^wip: ?auto-?save'; then
    if [ "$AUTO_MODE" = true ]; then
      error "배포할 커밋이 자동 저장 커밋 — 진행 중 일이 섞여 있어 뺄 수 없음. 끝난 일을 /개발완료 로 커밋한 뒤 다시"
      exit 1
    fi
    warn "배포할 커밋이 자동 저장(wip) 커밋 — 진행 중 일이 섞였을 수 있음"
  fi
}

# rsync 보호 목록 — 운영 쪽에만 있어야 하는(또는 운영이 만든) 파일을 --delete 가 지우지 않게.
#   예전엔 작업 폴더를 통째로 보냈으므로 dev 의 무시 파일(secrets/·backups/ …)이 운영에 같이 가 있었다.
#   사본에는 그것들이 없어 그대로 --delete 하면 **운영 secrets/fcm-service-account.json(앱 푸시 키)** 이 지워진다
#   (2026-10-12 rsync -n 실측: secrets/·backups/·.claude/·.last-deployed-commit 삭제 예정).
#   → 고정 목록 + **작업 폴더에서 git 이 무시하는 경로 전부**(새 무시 파일이 생겨도 따라온다)를 뺀다.
#   제외된 경로는 운영 쪽에서 지워지지도, 덮이지도 않는다(--delete-excluded 를 쓰지 않는다).
build_protect_list() {   # $1 = 저장소 안 하위 폴더(dev-backend|q-note) · 출력 = 제외 파일 경로
  local SUB="$1" OUTF
  OUTF=$(mktemp /tmp/planq-deploy-protect.XXXXXX)
  {
    printf '%s\n' '.env' '.env.*' 'node_modules' 'uploads' '*.log' '.server.pid' '/.last-deployed-commit' \
      '/secrets/' '/backups/' '/.claude/' 'test-*.js' 'venv' '/data/' '*.db' '__pycache__' '*.pyc' \
      '/scripts/out/'
    (cd "$REPO" && git ls-files --others --ignored --exclude-standard --directory -- "$SUB" 2>/dev/null \
      | sed "s#^$SUB/#/#") || true
  } > "$OUTF"
  printf '%s' "$OUTF"
}

# 보호 목록이 **커밋된 파일**을 빼면 운영에 그 파일이 안 간다 — 멈춘다.
#   2026-10-16 사고: 보호 목록의 'data'(q-note/data SQLite 용)가 앵커 없이 적혀 있어
#   dev-backend/services/data/confusables-latin.json(메일 사칭 검사 표)까지 빠졌고,
#   운영 메일 목록이 전부 500 → 화면 폭주 차단(request_throttled)으로 메일이 하나도 안 보였다.
#   예외: .env.* 예시 파일(운영 .env 를 덮지 않으려고 일부러 뺀다).
assert_protect_keeps_tracked() {   # $1 = 하위 폴더 · $2 = 보낼 폴더 · $3 = 보호 목록 파일
  local SUB="$1" SRC="$2" PROTECT="$3" EMPTY LOST
  EMPTY=$(mktemp -d /tmp/planq-deploy-empty.XXXXXX)
  LOST=$(comm -23 \
    <(cd "$SRC" && git -C "$REPO" ls-tree -r --name-only "${DEPLOY_COMMIT:-HEAD}" -- "$SUB" | sed "s#^$SUB/##" | grep -vE '(^|/)\.env' | sort) \
    <(rsync -an --exclude-from="$PROTECT" --out-format='%n' "$SRC/" "$EMPTY/" | grep -v '/$' | sort))
  rm -rf "$EMPTY"
  if [ -n "$LOST" ]; then
    error "보호 목록이 커밋된 파일을 빼서 운영에 안 갑니다($SUB) — build_protect_list 패턴을 고치세요:"
    printf '%s\n' "$LOST" | head -20 | sed 's/^/    /'
    rm -f "$PROTECT"
    exit 1
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

  # 2b) 내 명함 공개 페이지(/c/) 검색 차단 — 운영 nginx 에 `location ^~ /c/` noindex 가 실제로 붙는가(일반 UA 로 잰다).
  #   nginx 는 sudo 라 배포가 고칠 수 없다 → 경고만. 고치는 명령: sudo bash scripts/apply-nginx-name-card.sh /etc/nginx/sites-enabled/planq.kr
  #   (2026-10-17 Fable — 장치가 있는데 헤더가 안 나가던 것을 일반 UA 로만 잡을 수 있었다)
  if curl -s --max-time 5 -o /dev/null -D - -A 'Mozilla/5.0' https://planq.kr/c/AAAAAAAAAAAAAAAAAAAAAA | grep -qi '^x-robots-tag:.*noindex'; then
    success "운영 /c/ 검색 차단 헤더 OK"
  else
    warn "운영 /c/ 응답에 X-Robots-Tag noindex 없음 — 명함 연락처가 검색에 잡힐 수 있다. scripts/apply-nginx-name-card.sh 를 운영 서버에 복사해 sudo bash <파일> <운영 nginx 설정 경로> 로 적용(Irene)"
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

    # 시스템 의존성 — 고객 링크 PDF 미리보기(services/pdfPagePreview.js)가 poppler 를 부른다.
    #   ★ 2026-10-10 Fable FAIL — dev 에만 있고 운영에 없었다. 없으면 배포를 멈춘다(코드는 없을 때 PDF «보기» 를 끄지만,
    #     그러면 Irene 신고 «파일 미리보기가 안 된다» 가 PDF 에서 그대로 남는다). 설치: sudo apt-get install -y poppler-utils
    if ssh $SSH_OPTS "$PROD_HOST" "command -v pdftoppm >/dev/null && command -v pdfinfo >/dev/null"; then
      success "운영서버 poppler(pdftoppm·pdfinfo) OK"
    else
      error "운영서버에 poppler 없음 — Irene 서버 창: sudo apt-get install -y poppler-utils"
      exit 1
    fi

    # .env 는 첫 배포 시점에 없을 수 있음 — dry-run 후 운영서버 Claude 가 채움. 경고만 출력
    if ! ssh $SSH_OPTS "$PROD_HOST" "[ -f $PROD_BE/.env ]"; then
      warn "$PROD_BE/.env 아직 없음 — 첫 dry-run 후 운영서버에서 입력 필요 (.env.production.example 템플릿 사용)"
    fi

    # dev-login(상황판 «시험 계정으로 열기») 비밀은 개발 .env 전용 — 운영 .env 에 있으면 멈춘다(2026-10-12).
    #   운영은 NODE_ENV=production 이라 라우트가 등록되지 않지만, 비밀이 운영에 있는 것 자체가 사고다(두 겹 중 한 겹이 사라진 상태).
    if ssh $SSH_OPTS "$PROD_HOST" "[ -f $PROD_BE/.env ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?DEV_LOGIN_SECRET[[:space:]]*=' $PROD_BE/.env"; then
      error "운영 .env 에 DEV_LOGIN_SECRET 있음 — 개발서버 전용 값이다. 운영 $PROD_BE/.env 에서 그 줄을 지우고 다시 배포"
      exit 1
    fi
    success "운영 .env 에 DEV_LOGIN_SECRET 없음"
  fi

  # 5) 미커밋 변경 — make_snapshot 이 이미 «커밋하지 않고 빼고 배포» 로 처리했다(2026-10-12).
  #    예전엔 여기서 «커밋 권장 · 그래도 진행?» 을 물었고, yes 면 미커밋이 운영에 같이 나갔다.

  # 6) 코드 게이트 — **여기서 막지 않으면 아무 데서도 안 막는다** (2026-09-09 신설)
  #
  #   여태 배포 스크립트에는 품질 게이트가 **하나도** 없었다. health-check 도 불변식 가드도
  #   사람이 기억해야만 돌았고, 기억 못 하면 그대로 운영에 나갔다.
  #   "게이트에 안 붙은 가드는 없는 가드" 다 — 가드를 50개 만들어도 부르는 곳이 없으면 0개다.
  #
  #   ★ 둘 다 실패 시 non-zero 를 준다는 것을 확인하고 붙였다(장식용 게이트 방지):
  #     · health-check      process.exit(allPass ? 0 : 1)
  #     · guard-invariants  process.exit(fail === 0 ? 0 : 1)
  #       (실측 반증: `height: 22px` 위반을 심으니 EXIT 1, 원복하니 EXIT 0)
  #
  #   느린 실브라우저 카나리는 여기 넣지 않는다 — 배포마다 수 분이 붙으면 --skip-gates 가
  #   습관이 되고, 그러면 게이트가 다시 0개가 된다. 여기는 **빠른 두 개만**.
  if [ "$SKIP_GATES" = true ]; then
    warn "코드 게이트 건너뜀 (--skip-gates) — 장애 대응이 아니라면 쓰지 말 것"
  else
    log "코드 게이트 실행 중 (health-check · 불변식 가드 · 사본 검사)..."
    # health-check 는 살아 있는 dev 서버(작업 폴더 코드)를 때린다 — 사본 코드는 가드·사본 검사가 본다.
    if node "$REPO/scripts/health-check.js" > /tmp/deploy-gate-health.log 2>&1; then
      success "health-check 통과"
    else
      error "health-check 실패 — 배포 중단. 자세히: tail -40 /tmp/deploy-gate-health.log"
      tail -15 /tmp/deploy-gate-health.log
      exit 1
    fi
    # 불변식 가드는 **사본**을 검사한다(PLANQ_GUARD_ROOT) — 운영에 나가는 파일 그대로.
    #   (문서 신선도 경고는 사본 mtime 이 커밋 시각이라 조용해진다 — 경고 전용이라 판정에 영향 없음.)
    if PLANQ_GUARD_ROOT="$SNAP" node "$SNAP/scripts/guard-invariants.js" > /tmp/deploy-gate-guard.log 2>&1; then
      success "불변식 가드 통과 (사본)"
    else
      error "불변식 가드 실패 — 배포 중단. 자세히: tail -40 /tmp/deploy-gate-guard.log"
      tail -15 /tmp/deploy-gate-guard.log
      exit 1
    fi
  fi

  # 사본 검사는 --skip-gates 여도 돈다 — 1초 미만이고, 빠지면 커밋에서 빠진 모듈이 운영을 죽인다.
  #   사본 백엔드는 운영 pm2 재시작 전까지 한 번도 실행되지 않는다(health-check 는 작업 폴더 코드를 때린다).
  if node "$SNAP/scripts/check-deploy-snapshot.js" "$SNAP" > /tmp/deploy-gate-snapshot.log 2>&1; then
    success "사본 검사 통과 — $(head -1 /tmp/deploy-gate-snapshot.log | sed 's/^\[snapshot-check\] //')"
  else
    error "사본 검사 실패(문법 오류·커밋에 없는 파일 require) — 배포 중단"
    tail -20 /tmp/deploy-gate-snapshot.log
    exit 1
  fi
}

# ──────────────────────────────────────────
# Show changes since last deployed commit
# ──────────────────────────────────────────
show_changes() {
  log "Changes since last deployment..."

  cd "$REPO"
  CURRENT="$DEPLOY_COMMIT"
  echo "  배포할 커밋: ${CURRENT:0:7} ($(git log -1 --format='%s' "$CURRENT" | head -c 80))"

  LAST_REMOTE=$(ssh $SSH_OPTS "$PROD_HOST" "cat $PROD_BE/.last-deployed-commit 2>/dev/null" || echo "")
  if [ -n "$LAST_REMOTE" ]; then
    echo "  Last deployed: ${LAST_REMOTE:0:7}"
    CHANGED=$(git diff --name-only "$LAST_REMOTE" "$DEPLOY_COMMIT" 2>/dev/null | wc -l || echo "?")
    echo "  Changed files: $CHANGED"
    # head -10 이 파이프를 조기에 닫아 git diff/grep 이 SIGPIPE(141) → set -euo pipefail 이 배포 전체를
    # 중단시키던 버그(변경파일 >10 인 모든 증분 배포). || true 로 흡수.
    (git diff --name-only "$LAST_REMOTE" "$DEPLOY_COMMIT" 2>/dev/null | grep -E '^(dev-(backend|frontend)|q-note)' | head -10 | sed 's/^/    /') || true
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

  local PROTECT
  PROTECT=$(build_protect_list dev-backend)
  assert_protect_keeps_tracked dev-backend "$DEV_BE" "$PROTECT"
  RSYNC_FLAGS="-az --delete --exclude-from=$PROTECT"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_BE/ $PROD_HOST:$PROD_BE/"
    # 운영에서 지워질 것을 먼저 보인다 — 보호 목록이 빠지면 여기에 secrets/ 가 뜬다.
    (rsync -azn --delete --itemize-changes --exclude-from="$PROTECT" -e "$RSYNC_SSH" "$DEV_BE/" "$PROD_HOST:$PROD_BE/" \
      | grep '^\*deleting' | head -20 | sed 's/^/    /') || true
  else
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_BE/" "$PROD_HOST:$PROD_BE/"
    success "백엔드 sync 완료 (커밋 ${DEPLOY_COMMIT:0:8})"
  fi
  rm -f "$PROTECT"
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
  if [ -n "${LAST_REMOTE:-}" ] && ! git -C "$REPO" diff --quiet "${LAST_REMOTE}" "$DEPLOY_COMMIT" -- dev-backend/models dev-backend/scripts/migrate- 2>/dev/null; then
    DEPLOY_SCHEMA_CHANGED=true
  fi
  # 2026-10-15 역할 사전 — member_roles 표 + project_members.role DEFAULT NULL + (처음 한 번) 쓰인 글자 흡수·기본 세트 시드.
  #   ★ 반드시 sync-database **앞**(Fable 게이트 FAIL 실측): sync 가 models/MemberRole.js 로 빈 표를 먼저 만들면
  #     스크립트가 «이미 있음» 으로 흡수·시드를 건너뛰어 전 워크스페이스 역할 0개 + FK DDL 이 스크립트와 달라진다.
  #     (스크립트도 «표가 비어 있으면» 흡수·시드하도록 막아 두었다 — 이중 방어.) docs/MEMBER_ROLES_DESIGN.md
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-member-roles.js 2>&1 | tail -6"
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node sync-database.js 2>&1 | tail -20"
  success "DB sync 완료"

  # sync-database(Sequelize alter)가 못 하는 것 — ENUM 확장·NULL 허용 변경·백필.
  # 전부 멱등이라 매 배포 실행해도 안전하다. 순서 중요: 이걸 건너뛴 채 신 모델 코드가
  # 올라가면 push_subscriptions 조회가 Unknown column 으로 죽어 기존 웹푸시까지 전멸한다.
  log "Running idempotent migrations..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-push-native.js 2>&1 | tail -10"
  # 언어별 메일 서명 — email_accounts/email_account_aliases/businesses 의 `*_en` 3컬럼 (2026-09-18).
  #   ★ **PM2 reload 앞**이어야 한다. 컬럼 없이 새 코드가 뜨면 `EmailAccount.findOne` 이
  #     전 컬럼을 SELECT 하다 ER_BAD_FIELD → **Q mail 전 라우트 500**, `GET /:biz/mail` 도 500.
  #     워크스페이스 컬럼은 더 나쁘다 — try/catch 라 500 도 안 나고 **팀 공통 서명이 조용히 사라진다.**
  #   ★ 이 스크립트는 `--apply` 가 없으면 **dry-run** 이다(형제들과 다르다). 반드시 붙인다.
  #   ★ 여태 「배포 전에 실행한다」가 스크립트 머리말에만 있고 **부르는 곳이 없었다**
  #     — 게이트에 안 붙은 가드는 없는 가드다(Fable 3차 지적).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-signature-lang.js --apply 2>&1 | tail -10"
  # Q Bill 결제 원장 — invoice_payments.installment_id (매출 통계 원천). 코드보다 먼저.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-invoice-payment-installment.js 2>&1 | tail -10"
  # 온보딩 안내 카드 — businesses.onboarding_dismissed_at. businesses 는 키가 많아
  # Sequelize alter 가 죽은 전례가 있어 sync 에 맡기지 않는다(조용히 죽으면 기능 전멸).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-onboarding-dismissed.js 2>&1 | tail -10"
  # 2026-10-04 온보딩 «나» 묶음 닫기 — business_members.onboarding_dismissed_at (M3-d). 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 BusinessMember 를 읽는 라우트가 전부 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-onboarding-personal-dismiss.js 2>&1 | tail -10"
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
  # 2026-09-25 고객 창구(CLIENT_ENTRY P1) — guest_links.scope ENUM 끝에 'workspace' append
  #   · conversation_id NULL 허용. 멱등(2회차 no-op). ★ 순서: PM2 reload 보다 먼저 —
  #   ENUM 에 값이 없는 채 신 코드가 뜨면 창구 발급이 1265/잘림으로 죽는다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-guest-link-scope-workspace.js 2>&1 | tail -10"
  # 2026-09-25 상담 예약(CLIENT_ENTRY P2) — calendar_events.booking_status ENUM NULL + 인덱스. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 캘린더 전체가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-booking-status.js 2>&1 | tail -10"
  # 2026-10-07 일정 ↔ 업무 연결 — calendar_events.task_id INT NULL + 인덱스. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 캘린더 전체가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-calendar-task-link.js 2>&1 | tail -6"
  # 2026-10-07 설문(#460) — q_records.survey_token/survey_settings · q_record_rows.created_by NULL ·
  #   q_record_audits.user_id NULL + action ENUM · notifications/notification_prefs event_kind 'survey'. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 survey_token 을 SELECT 하므로 없으면 표 문서 전체가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-survey.js 2>&1 | tail -10"
  # 2026-10-12 설문 v2(docs/SURVEY_V2_DESIGN.md) — posts.kind +'survey' · q_record_rows 회차·받는 사람 칸 · survey_issues/recipients/rules 표 ·
  #   clients.survey_opt_out_at. 멱등. ★ 순서: migrate-survey.js 뒤, PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 문서·표·고객 조회가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-survey-v2.js 2>&1 | tail -12"
  # 2026-10-09 체험 중 결제 환불 요청(docs/TRIAL_REFUND_DESIGN.md) — payments 컬럼 6개 + 인덱스. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — Payment 모델이 이 칸을 SELECT 하므로 없으면 결제 조회 전부 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-trial-refund.js 2>&1 | tail -10"
  # 2026-10-15 멤버 초대 «수락 전 멤버» 되돌리기(docs/INVITE_INAPP_NOTIFY_DESIGN.md §4) — 배포 때는 **읽기만**(계획·점검 수치 출력).
  #   실제 적용(--apply)은 출력을 사람이 본 뒤 따로 한다(Fable D1 — ⒝=0 확인 후). 코드 앞·뒤 어느 쪽이든 무해.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-invite-prefill.js 2>&1 | tail -20"
  # 2026-10-12 업무 «내부 업무» 보안등급(docs/TASK_SECURITY_LEVEL_DESIGN.md) — tasks.security_level ENUM NOT NULL DEFAULT 'general'. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — Task 모델이 이 칸을 SELECT 하므로 없으면 업무 전체가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-task-security-level.js 2>&1 | tail -6"
  # 2026-10-12 업무 «결과물 액션»(docs/TASK_ACTIONS_DESIGN.md) — task_action_items 표 신설. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 업무 상세·문서 상세가 이 표를 읽으므로 없으면 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-task-action-items.js 2>&1 | tail -4"
  # 2026-10-12 팀 Google 캘린더 «올릴 캘린더»(docs/TEAM_CALENDAR_PICK_DESIGN.md) — business_cloud_tokens.gcal_calendar_id·summary. 멱등, 백필 없음(NULL = primary).
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 클라우드 연동 조회·일정 동기화가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-gcal-team-calendar.js 2>&1 | tail -4"
  # 2026-10-10 고객 프로젝트 링크 «주요 이슈» 공개 축(docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-4) — project_history_entries.client_visible. 멱등.
  #   ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 SELECT 하므로 없으면 프로젝트 히스토리 전체가 500.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-history-entry-client-visible.js 2>&1 | tail -6"
  # 2026-10-08 0-A/0-B 돈 묶음 (docs/FIX_0AB_MONEY_DESIGN.md) — 둘 다 멱등. ★ 코드보다 먼저 돈다:
  #   money: 금액 DECIMAL(14,2) · invoice_number_counters 시드 · UNIQUE(business_id, invoice_number) — 없으면 채번 함수가 없는 표를 UPDATE 해 500.
  #   billing-0a: businesses.scheduled_plan 보장 · payments.line_items — 모델이 선언하므로 없으면 결제 조회 500.
  log "Money bundle migrations (0-A/0-B)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-invoice-money.js 2>&1 | tail -12"
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-billing-0a.js 2>&1 | tail -8"
  # Q Mail 발송 상태 — email_messages.delivery_status ENUM 에 'suppressed' append.
  #   ★ 순서: 이 ALTER 가 PM2 reload 보다 먼저 끝나야 한다(신 코드가 먼저 뜨면 Data truncated).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-email-delivery-status.js 2>&1 | tail -10"
  # 2026-09-21 팀장 — teams.lead_user_id INT NULL. sync 가 먼저 만들었으면 skip, 없으면 추가 후 재조회로 검증.
  #   ★ 순서: PM2 reload 보다 먼저(신 코드가 없는 컬럼을 읽으면 조직 화면이 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-team-lead.js 2>&1 | tail -5"
  # 2026-10-16 사이드바 메뉴 편집 — business_members.nav_prefs JSON NULL. 모델이 SELECT 하므로 PM2 reload 전(없으면 멤버 조회 전부 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-nav-prefs.js 2>&1 | tail -5"
  # 2026-10-16 멤버 프로젝트 가시성 — projects.visibility ENUM NOT NULL DEFAULT 'members'(기존 행 members, Fable 권고).
  #   모델이 SELECT 하므로 PM2 reload 전. 출력의 «숨겨지는 쌍» 수를 배포 보고에 적는다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-project-visibility.js 2>&1 | tail -5"
  # 2026-10-16 고객→멤버 — clients.member_converted_at DATETIME NULL 추가 + 대상 목록(읽기만). 옛 데이터 정리는 --apply 수동.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-client-to-member.js 2>&1 | tail -20"
  # 2026-10-17 내 명함 — name_cards · saved_name_cards 표(멱등). 모델이 읽으므로 PM2 reload 전. nginx `location ^~ /c/` noindex 는 따로(Irene sudo).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-name-cards.js 2>&1 | tail -5"
  # 2026-10-22 내 명함 v2 — brands·name_card_brands 표 + 워크스페이스 기본 브랜드 시드(멱등) · business_members.default_card_id(FK name_cards).
  #   모델(Brand·BusinessMember)이 읽으므로 PM2 reload 전. 순서: name_cards 다음(FK).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-brands.js 2>&1 | tail -5"
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-name-card-default.js 2>&1 | tail -5"
  # 2026-10-17 랜딩 마케팅 측정 — platform_settings.gtm_container_id(NULL = 꺼짐). 모델이 SELECT 하므로 PM2 reload 전. 켜기는 Irene 승인 뒤 관리자 화면.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-marketing-tags.js 2>&1 | tail -5"
  # 2026-09-21 문의/피드백 구분 — feedback_items.kind ENUM. 신 코드가 kind 를 쓰므로 PM2 reload 전.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-feedback-kind.js 2>&1 | tail -5"
  # 2026-10-15 문의·피드백 답 읽음 — feedback_items.reply_seen_at DATETIME NULL(옛 답은 읽음으로 백필, 처음 만들 때만).
  #   신 코드(모델·확인필요 수집기)가 이 칸을 SELECT 하므로 PM2 reload 전.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-feedback-reply-seen.js 2>&1 | tail -5"
  # 2026-10-15 Q talk «열어 봄 ≠ 참여» — conversation_participants.is_viewer TINYINT NOT NULL DEFAULT 0.
  #   모델 defaultScope 가 이 칸을 SELECT 하므로 PM2 reload 전(없으면 채팅 전부 500). 옛 행 정리는 backfill-conv-viewer.js(수동, dry-run 기본).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-conv-viewer.js 2>&1 | tail -5"
  # 2026-10-15 문서 댓글 — post_comments 표 + 두 알림 표 event_kind 끝 'doc_comment'(멱등). 문서 상세가 이 표를 세므로 PM2 reload 전.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-post-comments.js 2>&1 | tail -5"
  # 2026-10-15 직접 관리 고객 — clients.status ENUM 끝 'managed'(멱등). 모델이 이 값을 쓰므로 PM2 reload 전.
  #   옛 «active + 계정 없음» 행 백필은 여기선 읽기만(건수 출력) — 적용은 수동 `--apply`(docs/CLIENT_MANAGED_DESIGN.md).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-client-managed.js 2>&1 | tail -5"
  # 2026-10-16 고객 화면을 Q sale 로 합침 — 메뉴 권한 키 'clients' → 'qsale'(더 좁은 쪽, 옛 행 보존, 멱등).
  #   ★ 적용한다(--apply): 안 하면 'clients=none' 이던 멤버가 'qsale' 기본 write 로 고객 라우트에 열린다. 코드보다 먼저.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-menu-key-clients.js --apply 2>&1 | tail -8"
  # 2026-10-15 메일 분류 기준 공개 — email_threads.triage_criterion VARCHAR(40) NULL + 인덱스(멱등). 모델이 SELECT 하므로 PM2 reload 전.
  #   옛 메일 재판정(승격 전용)은 여기서 하지 않는다 — 운영 읽기 전용 시뮬 뒤 수동(docs/MAIL_CRITERIA_DESIGN.md §6.2).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-criteria.js 2>&1 | tail -5"
  # 2026-10-15 메일 사칭 검사 — email_threads.spam_origin ENUM 끝 'impersonation' + impersonation JSON NULL(멱등).
  #   모델이 이 칸을 SELECT 하므로 PM2 reload 전. 옛 메일 소급은 retriage-mail.js --impersonation(dry-run 기본, 수동 — docs/MAIL_IMPERSONATION_DESIGN.md §5).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-impersonation.js 2>&1 | tail -4"
  # 2026-10-16 갈라진 옛 메일 스레드 합치기 — email_thread_redirects 표(옛 스레드 번호 → 새 번호, 멱등). 상세 GET 이 읽는다(없으면 종전 404).
  #   합치기 자체는 여기서 하지 않는다 — 운영 미리보기(merge-split-mail-threads.js, 기본 dry-run) 보고 뒤 --apply 수동.
  #   그 스크립트의 되돌리기 장부(scripts/out/)는 위 보호 목록 '/scripts/out/' 이 지킨다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-thread-redirects.js 2>&1 | tail -3"
  # 2026-10-15 청구서 외부 카드 결제 링크 + 카드 대금 받는 곳 — invoices·invoice_installments.card_pay_url, businesses.card_payees(멱등).
  #   세 모델이 이 칸을 SELECT 하므로 PM2 reload 전(없으면 청구서·워크스페이스 조회 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-card-pay-link.js 2>&1 | tail -4"
  # 2026-10-15 급여·계약 P1 — businesses.modules 칸 + payroll_people·employment_contracts·pay_items·contract_pay_lines(멱등).
  #   모델이 businesses.modules 를 SELECT 하므로 PM2 reload 전. 급여 기능은 기본 꺼짐 — 운영 동작 변화 없음(docs/PAYROLL_DESIGN.md §3.10).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-payroll.js 2>&1 | tail -4"
  # 2026-10-15 직원 계약서 템플릿 3종 × ko/en(급여 설계 P0) — 시스템 템플릿 시드(kind+is_system+name upsert, 매 배포 안전).
  #   이 시드는 여태 배포 슬롯에 없었다 — 운영 템플릿이 dev 와 갈라지지 않게 매 배포 맞춘다(docs/PAYROLL_DESIGN.md §3.10).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/seed-document-templates.js 2>&1 | tail -3"
  # 2026-09-21 랜딩 방문 집계 테이블 2개(CREATE IF NOT EXISTS · 재조회 검증). PM2 reload 전.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-landing-visits.js 2>&1 | tail -3"
  # 2026-09-21 Sign in with Apple — oauth_connections.provider·ephemeral_tokens.kind ENUM 끝 append +
  #   platform_settings 애플 자격 4칸. 신 코드가 'apple'·'apple_oauth_state' 를 쓰므로 PM2 reload 전.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-apple-login.js 2>&1 | tail -8"
  # 2026-09-28 날짜·시간 표시 형식 — users 칸 3개(ENUM NULL). 모델이 선언하므로 PM2 reload 전(없으면 users 조회 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-user-date-prefs.js 2>&1 | tail -5"
  # 2026-10-01 가입 출처 — users.signup_source VARCHAR(80) NULL. 모델이 선언하므로 PM2 reload 전(없으면 users 조회 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-user-signup-source.js 2>&1 | tail -5"
  # 2026-10-12 내 순서(사람별 업무 순서) — task_user_orders 표(CREATE IF NOT EXISTS · 재조회 검증).
  #   ★ 순서: PM2 reload 전 — 신 코드의 /my-week 가 이 표를 SELECT 한다(없으면 팝아웃·주간 목록 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-task-user-order.js 2>&1 | tail -3"
  # 2026-10-02 #424 근무일·휴일 — businesses.holiday_country + workspace_holidays 표(멱등, 백필 없음).
  #   모델이 선언하므로 PM2 reload 전(없으면 워크스페이스 조회·my-week 가 500).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-workspace-holidays.js 2>&1 | tail -5"
  # 2026-09-23 「지금 결제하면 1개월 추가」 — subscriptions.bonus_months INT NOT NULL DEFAULT 0.
  #   ★ 반드시 PM2 reload **앞**. 모델이 이 컬럼을 선언하므로 컬럼 없이 새 백엔드가 뜨면
  #     markPaymentPaid / createPendingSubscription 이 ER_BAD_FIELD_ERROR 로 죽는다(결제 전멸).
  #   기존 행은 전부 0 이라 옛 구독의 기간 계산은 그대로다. 롤백은 컬럼을 두고 코드만 되돌린다.
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-subscription-bonus-months.js 2>&1 | tail -5"
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
  # 2026-10-22 서명 회차 닫기·고객 «수정 요청» — status ENUM 끝 'superseded' + superseded_at + rejected_kind. 멱등.
  #   ★ PM2 reload **앞** — 모델이 새 칸을 SELECT 하므로 칸 없이 새 백엔드가 뜨면 서명 조회 전체가 500. 롤백은 코드만(모델 선언 유지).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-signature-supersede.js 2>&1 | tail -6"

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

  # 2026-09-07 — 프로젝트 문서 탭 핀(project_pinned_docs). localStorage → 서버 이관.
  #   ★ **코드보다 먼저 돈다** — 테이블이 없으면 /api/projects/:id/pinned-docs 가 500 이다
  #     (guest_links.scope 때와 같은 계열). 스크립트는 멱등(있으면 아무것도 안 함).
  log "Creating project_pinned_docs table..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-project-pinned-docs.js 2>&1 | tail -5"

  # 2026-09-14 — 알림 설정 `push_fallback` (notification_prefs.event_kind ENUM **끝에 append**).
  #   Irene: "푸시 실패 시 메일로 재알림 항목 넣는 거 좋은데?"
  #   ★ **코드보다 먼저 돈다** — 값이 없는데 새 화면이 그 항목을 저장하면 MySQL 이
  #     `Data truncated for column 'event_kind'` 로 500 을 낸다(dev 실측).
  #   ★ 끝에 append 한다(중간 삽입은 기존 행의 값을 민다). 멱등 — 이미 있으면 아무것도 안 한다.
  #   ★ `notifications.event_kind` 는 건드리지 않는다 — 이건 알림 레코드 종류가 아니라 발송 스위치다.
  log "Adding push_fallback to notification_prefs ENUM..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-push-fallback-pref.js 2>&1 | tail -5"

  # 2026-09-17 (#407) — `notifications.preview_policy`: 이 알림의 본문을 **울타리 밖(메일·푸시)으로
  #   내보내도 되는가** 를 행에 적어 둔다. 처음엔 `event_kind` 로 갈랐는데 업무 댓글이 'task' 로
  #   만들어져 **종류로는 못 가른다**(Fable 13차 차단). 만든 쪽이 행에 적고 읽는 쪽이 따른다.
  #   ★ **코드보다 먼저 돈다** — 모델이 이 컬럼을 선언하므로 없으면 알림 생성이 500 이다.
  #   멱등(SHOW COLUMNS 확인). 2026-09-17 배포에서는 손으로 먼저 돌렸고, 이후는 여기서 재실행된다.
  log "Adding preview_policy to notifications..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-notification-preview-policy.js 2>&1 | tail -5"

  # 2026-09-17 (#411) — 일정에 붙는 미팅자료 `calendar_event_attachments`.
  #   파일/문서를 **가리키기만** 한다(바이트 복사 없음, 원본 삭제 시 CASCADE).
  #   ★ **코드보다 먼저 돈다** — 없으면 일정 조회가 없는 테이블을 조인해 500 이다.
  #   ★ `event_id` 는 BIGINT — `calendar_events.id` 가 bigint 라 INT 로 잡으면 FK 가 거부된다.
  log "Creating calendar_event_attachments..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-event-attachments.js 2>&1 | tail -5"

  # 2026-10-02 (#439) — AI 에이전트 연동(ChatGPT·Claude): agent_clients · agent_grants + ephemeral_tokens.kind agent_* 4개.
  #   ★ **코드보다 먼저 돈다** — 모델이 새 kind 를 쓰는데 ENUM 에 없으면 인가 요청 저장이 실패한다. 멱등.
  #   ★ 표면은 운영 .env 의 AGENT_ENABLED=1 + AGENT_TOKEN_SECRET 이 있어야 켜진다(없으면 /agent/* 는 404 — 스키마만 먼저 깔린다).
  log "Creating agent OAuth tables (#439)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-agent-oauth.js 2>&1 | tail -5"

  # 2026-10-15 — AI 앱 연결 여러 워크스페이스(docs/AI_AGENT_MULTI_WORKSPACE_DESIGN.md · Fable 설계):
  #   agent_grants.extra_business_ids JSON NULL. ★ **코드보다 먼저 돈다** — 모델이 SELECT 하므로 없으면 AI 연결 전체가 500. 멱등.
  log "Adding agent_grants.extra_business_ids..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-agent-multi-ws.js 2>&1 | tail -5"

  # 2026-10-02 (#426) — 무료 업무체계 자가진단: diagnosis_responses + contact_inquiries.kind 'diagnosis' append.
  #   ★ **코드보다 먼저 돈다** — 이메일을 남긴 진단이 kind='diagnosis' 문의를 만드는데 ENUM 에 없으면 실패한다. 멱등.
  log "Creating diagnosis_responses (#426)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-diagnosis.js 2>&1 | tail -5"

  # 2026-10-07 — Q mail 업체 보낸편지함·스팸함 가져오기(docs/MAIL_SENT_SPAM_SYNC_DESIGN.md · Fable 판정 수정 후 PASS):
  #   email_account_folders(계정×역할 폴더 커서) + email_messages.source_folder·internal_only + email_threads.spam_origin·spam_since.
  #   ★ **코드보다 먼저 돈다** — 모델이 새 컬럼을 선언하므로 없으면 메일 조회가 500 이다. 멱등.
  #   ★ 배포 뒤 첫 tick 에 폴더 탐색·첫 가져오기(보낸편지함 30일·스팸함 14일, 각 300건)가 돈다. 끄려면 .env QMAIL_EXTRA_FOLDERS=0.
  log "Adding mail extra folders (sent/spam) schema..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-mail-folders.js 2>&1 | tail -10"

  # 2026-10-05 — 화면 크래시 관리자 알림: notifications·notification_prefs.event_kind 끝에 'client_crash' append.
  #   ★ **코드보다 먼저 돈다** — 관리자 설정에서 끄면 prefs 행을 쓰는데 ENUM 에 없으면 500 이다. 멱등.
  log "Appending client_crash notification kind..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-client-crash-kind.js 2>&1 | tail -4"

  # 2026-10-05 — 서명 항목(사인·이미지·서명일·이름): signature_requests.required_items · item_images. **코드보다 먼저**(모델이 선언). 멱등.
  log "Adding signature item columns..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-signature-items.js 2>&1 | tail -4"

  # 2026-10-07 — Cue 질문 분석(Fable 판정 B5): cue_question_topics(주제 통계 — user/business id 없음) · cue_question_raw(가명 원문 30일).
  #   ★ **코드보다 먼저 돈다** — Cue 답변 직후 기록이 이 표에 쓴다(없으면 기록만 실패·로그 — 응답은 막지 않지만 통계가 빈다). 멱등.
  #   ★ 이 배포 뒤 첫 0시 보존 cron 이 help_question_logs 90일 초과분을 **소급 삭제**한다(의도 — 방침 밖 무기한 저장 정리).
  log "Creating cue question analysis tables..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-cue-question-analysis.js 2>&1 | tail -4"

  # 2026-09-14 — Q sale 상담 메모(댓글)의 **기준**을 남기는 칸: project_notes.client_id.
  #   Irene: "메모라고 메모남기기가 댓글처럼 … 어떤 문의를 기준으로 저장된건지 남기게 하고."
  #   ★ **코드보다 먼저 돈다** — 모델이 client_id 를 선언하므로 컬럼이 없으면 메모 조회가 500 이다.
  #   멱등: 컬럼·인덱스가 이미 있으면 아무것도 안 한다.
  log "Adding client_id to project_notes (Q sale 상담 메모)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-sale-note-client.js 2>&1 | tail -5"

  # 2026-09-15 — 카드 결제 **사용 스위치**: platform_settings.stripe_card_enabled.
  #   Irene: "사용할지 말지 토글로 열어야 하는 거 아니야?" — 키를 지우지 않고 결제만 닫기 위한 칸.
  #   ★ **코드보다 먼저 돈다** — 모델이 이 칸을 선언하므로 없으면 설정 화면이 500 이다.
  #   기본 TRUE 라 이 칸이 생기기 전 동작(키가 있으면 켜짐)이 그대로 유지된다. 멱등.
  log "Adding stripe_card_enabled to platform_settings (카드 결제 스위치)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-stripe-card-toggle.js 2>&1 | tail -5"

  # 2026-09-09 — 휴가 **종류**(leave_grants/leave_requests.category ENUM 4종).
  #   Irene: "관리자가 멤버에게 휴가 연차나 등등 종류별로 제공하는 거 어떻게 줘?"
  #   ★ **코드보다 먼저 돈다** — 모델이 category 를 선언하므로 컬럼 없이 새 코드가 뜨면
  #     휴가 부여·잔여 조회가 Unknown column 으로 죽는다(project_pinned_docs 와 같은 계열).
  #   기존 행은 DEFAULT 'annual' 로 채워진다(지금까지 부여한 것은 전부 연차였다). 멱등.
  log "Adding leave category columns..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-leave-category.js 2>&1 | tail -8"

  # 2026-10-22 — 휴가 종류를 워크스페이스 데이터로(leave_types 표 + leave_type_id). 설계 docs/LEAVE_TYPES_DESIGN.md §4.
  #   ★ **코드보다 먼저 돈다** — 모델이 leave_type_id 를 선언한다. 위 category 슬롯 **뒤**여야 한다(백필이 category 로 잇는다).
  #   검증(NULL 0 · 종류별 건수 일치 · 유급/무급 박제 분포 불변)이 실패하면 exit 1 로 멈춘다. 멱등.
  #   롤백(코드만): node scripts/migrate-leave-types.js --rollback-nullable
  log "Adding leave types table..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-leave-types.js 2>&1 | tail -8"
  # 2026-10-22 근태 자정 분할 — attendance_events.source ENUM 끝 'auto_midnight'(멱등). 분할 INSERT 가 이 값을 쓰므로 PM2 reload 전.
  #   백필 없음 · 롤백 코드만(docs/ATTENDANCE_MIDNIGHT_SPLIT_DESIGN.md §2-8).
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-attendance-midnight.js 2>&1 | tail -5"

  # 운영 #257 — 결과물 회차의 승인/수정요청이 **남의 라운드**에 붙어 있었다(버전 번호 ≠ 컨펌 라운드).
  #   제출 시점의 컨펌 라운드를 회차 행에 적어 두고(review_round), 백필로 옛 행도 잇는다.
  #   ★ **코드보다 먼저 돈다** — 모델이 컬럼을 선언하므로 없으면 회차 목록 조회가 500 이 된다. 멱등.
  log "Linking deliverable versions to review rounds..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-deliverable-review-round.js 2>&1 | tail -8"

  # schedule_batches — 일정 일괄 수정의 되돌리기 원장 (2026-09-10)
  #   ★ 코드보다 **먼저** 돈다. 테이블이 없으면 일정 수정 라우트가 500 이다
  #     (project_pinned_docs·guest_links.scope 와 같은 계열). 멱등.
  log "  Creating schedule_batches (일정 수정 되돌리기 원장)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-schedule-batches.js 2>&1 | tail -5"

  # ephemeral_tokens — OAuth 짧은 수명 상태를 메모리에서 DB 로 (2026-09-10)
  #   ★ 코드보다 **먼저** 돌아야 한다. 테이블이 없으면 앱 로그인 라우트가 500 이 난다.
  log "  Creating ephemeral_tokens (OAuth 상태 저장소)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-ephemeral-tokens.js 2>&1 | tail -6"

  # Q sale 1a — ENUM 끝 append 3건(clients.status prospect · 알림 두 테이블 sale). 멱등 (docs/Q_SALE_DESIGN.md §16 U2·U3)
  #   위 sync(alter) 가 모델 순서대로 먼저 붙이므로 여기선 보통 no-op — sync 는 실패를 삼키므로 백스톱이다.
  #   ★ 코드 배포 **전에** 운영에서 `--dry` → 실행을 수동 선행한다(새 코드가 옛 ENUM 에 'prospect' 를 쓰면 저장 실패).
  log "  Appending Q sale ENUM values (clients.status · notifications · notification_prefs)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-qsale.js 2>&1 | tail -6"

  # 운영 #360 — 연결 post 가 없는 표(q_record)는 화면에서 열 길이 없다.
  #   Q record 메뉴 폐지 후 표를 여는 통로는 post(kind=table) 뿐인데, POST /api/records 가
  #   post 없이 표만 만들 수 있어 운영에 도달 불가 표가 생겼다(#12 "앱 스토어 개발자 계정", 행 15).
  #   가시성(vlevel·target_member_ids)은 원본 표에서 그대로 옮기므로 더 넓게 보이지 않는다.
  log "Backfilling orphan record posts (#360)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-orphan-record-posts.js --apply 2>&1 | tail -8"
  success "마이그레이션 완료 (push native / invoice-payment / account-deletion / mail-notify / task-hold / mail-delivery / calendar-sync / calendar-split / calendar-reverse-sync / doc-confirm / file-trash / gdrive-origin / mail-followup / candidate-null / project-pinned-docs / push-fallback-pref / preview-policy / event-attachments)"

  # 백필 — 마이그레이션 후. 과거 paid invoice/회차에 payment 원장 생성(멱등). 매출 0 복구.
  log "Backfilling invoice payments..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/backfill-invoice-payments.js 2>&1 | tail -6"

  # 2026-10-07 — 프로젝트 고객 채널을 «프로젝트 × 고객» 으로(Fable B 판정 7). 다른 고객사의 방에 들어간 고객을 자기 방으로
  #   옮기고 주인 없는 방에 주인을 정한다. 멱등. 아래 contact_user_id 백필보다 **먼저**(그쪽이 고객의 방을 찾는다).
  log "Splitting project customer channels per client..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-customer-channel-per-client.js --apply 2>&1 | tail -12"

  # 2026-10-06 — 계정이 붙은 고객의 project_clients.contact_user_id 백필 + 고객 채널 참여(role client). 멱등.
  #   워크스페이스 고객 초대 수락이 이 값을 안 채워 고객 화면에서 프로젝트·채팅방이 사라졌다(최정우 신고).
  log "Backfilling project client accounts..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-project-client-user.js 2>&1 | tail -6"

  # 2026-10-07 — 다른 앱에서 보낸 우리 답장의 사본을 «보낸 메일·읽음» 으로(받은편지함으로 돌아와 안읽음 점이 떴다). 멱등.
  log "Fixing own sent copies in mail..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/fix-own-sent-copies.js 2>&1 | tail -6"
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
  log "Building frontend in snapshot (커밋 ${DEPLOY_COMMIT:0:8})..."
  #   빌드는 사본 안에서 돈다 — 산출물은 $SNAP/dev-frontend-build(vite outDir '../dev-frontend-build').
  #   dev 화면이 쓰는 /opt/planq/dev-frontend-build 는 건드리지 않는다.

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
  # --skip-build = 백엔드만. 예전엔 작업 폴더의 기존 빌드(미커밋 변경이 섞였을 수 있는)를 그대로 올렸다.
  #   사본에는 빌드가 없으니 프론트는 이번에 보내지 않는다 — 운영 프론트는 직전 배포 그대로.
  if [ "$SKIP_BUILD" = true ]; then
    dim "▶ 프론트 rsync 스킵 (--skip-build — 운영 프론트는 직전 배포 그대로)"
    return 0
  fi
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
  # ★ 2026-09-21 — 검색용 생성물(seoArtifacts)은 **운영 DB 로 운영에서** 만든다. dev 에서 만든 것
  #   (dev DB 의 위키·인사이트 글 페이지 · 그 목록 파일)을 올리면 dev 에만 있는 글이 운영에 샌다.
  #   루트 index.html 은 올리고, 하위 폴더의 index.html(=생성 페이지)·목록 파일·사이트맵은 뺀다.
  #   ★ 패턴 주의 — `**/index.html` 은 **루트 index.html 까지** 뺀다(실측). 하위 폴더만 정확히 뺀다.
  SEO_EXCLUDES=(--exclude='/*/index.html' --exclude='/*/**/index.html' --exclude='/.seo-generated.json' --exclude='/sitemap.xml' --exclude='/rss.xml')

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_FE_BUILD/ $PROD_HOST:$PROD_FE_BUILD/"
    if [ -d "$DEV_FE_BUILD" ]; then
      rsync -azn -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/" | head -10
    fi
  else
    [ -d "$DEV_FE_BUILD" ] || { error "$DEV_FE_BUILD 없음 — build 먼저"; exit 1; }
    rsync $RSYNC_FLAGS "${SEO_EXCLUDES[@]}" -e "$RSYNC_SSH" "$DEV_FE_BUILD/" "$PROD_HOST:$PROD_FE_BUILD/"
    success "frontend 배포 완료 (옛 청크 보존 — 사용 중 사용자의 화면이 깨지지 않게)"
    # 새 빌드(index.html 템플릿·seo-pages.json)로 검색용 페이지·사이트맵을 **운영 DB 기준**으로 다시 만든다.
    #   실패해도 배포는 계속한다(서버 시작 때 한 번 더 돈다) — 대신 조용히 넘기지 않고 경고를 남긴다.
    if prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/generate-seo.js 2>&1 | tail -3"; then
      success "검색용 페이지·사이트맵 생성 완료"
      # Bing 등 IndexNow 참여 엔진에 공개 주소를 바로 알린다(2026-10-04) — 실패해도 배포는 계속한다
      prod_run "cd $PROD_BE && NODE_ENV=production node scripts/indexnow-ping.js 2>&1 | tail -1" || warn "IndexNow 알림 실패 — 다음 배포에 다시 보낸다"
    else
      warn "검색용 페이지 생성 실패 — 서버 시작 시 재시도 (pm2 logs 의 [seo-artifacts] 확인)"
    fi
  fi
}

# ──────────────────────────────────────────
# Sync Q Note (rsync, venv 제외)
# ──────────────────────────────────────────
sync_qnote() {
  if [ "$SKIP_QNOTE" = true ]; then dim "▶ Q Note 스킵 (--skip-qnote)"; return 0; fi
  [ -d "$DEV_QNOTE" ] || { dim "▶ Q Note 디렉터리 없음 — 스킵"; return 0; }

  log "Syncing Q Note (rsync)..."
  local PROTECT
  PROTECT=$(build_protect_list q-note)
  assert_protect_keeps_tracked q-note "$DEV_QNOTE" "$PROTECT"
  RSYNC_FLAGS="-az --delete --exclude-from=$PROTECT"

  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] rsync $RSYNC_FLAGS $DEV_QNOTE/ $PROD_HOST:$PROD_QNOTE/"
    (rsync -azn --delete --itemize-changes --exclude-from="$PROTECT" -e "$RSYNC_SSH" "$DEV_QNOTE/" "$PROD_HOST:$PROD_QNOTE/" \
      | grep '^\*deleting' | head -10 | sed 's/^/    /') || true
    rm -f "$PROTECT"
  else
    rsync $RSYNC_FLAGS -e "$RSYNC_SSH" "$DEV_QNOTE/" "$PROD_HOST:$PROD_QNOTE/"
    rm -f "$PROTECT"

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
# 재시작 **뒤에** 도는 데이터 보정 (멱등)
# ──────────────────────────────────────────
#   코드보다 먼저 돌면 옛 코드가 새 데이터를 틀리게 읽는 창이 생기는 것만 여기 둔다.
post_restart_backfills() {
  # 2026-10-07 — 종일 일정 재부호화(기기 자정 → UTC 자정 날짜, docs/ALLDAY_EVENT_DATE_DESIGN.md · Fable 판정 U).
  #   ★ **재시작 뒤에** — 새 코드는 옛 행을 반올림으로 바로 맞게 읽는다. 먼저 돌리면 옛 코드가 새 행을
  #     «구글 end D+2 · 서쪽 기기 전날» 로 읽는다. updated_at 보존 · 회차 키 이동 · 롤백 --revert.
  log "Re-encoding all-day events as UTC dates..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-allday-utc-date.js 2>&1 | tail -8" \
    || warn "종일 재부호화 실패 — 새 코드는 옛 행도 맞게 읽는다. 원인 확인 후 수동 재실행"
  # 2026-10-22 조직 0단계 — 이용약관 제10조 개정(퇴사 시 업무 인수인계): 약관 버전 1.2(재동의) + 공지 띠 + 활성 회원 고지 메일 1통.
  #   Irene «너가 해» · 메일 «권고대로». ★ **프론트·서버가 새것으로 뜬 뒤**(여기) — 먼저 돌면 메일·재동의 창의 /terms 가 2~3분 옛 조항이다(Fable 비차단 1).
  #   시행일(memberHandover HANDOVER_L1_EFFECTIVE_ON)이 오늘(KST)+30일보다 이르면 아무것도 안 하고 경고 → 시행일을 옮겨 재배포.
  #   멱등 · 실패해도 배포 계속. ★ 메일이 중간에 끊기면 재배포로는 안 보낸다(버전이 이미 1.2) —
  #   운영에서 `node scripts/send-terms-notice.js` 미리보기 → `--send --confirm=<수>` 로 남은 사람만.
  log "Terms update notice (version 1.2 · banner · member mail)..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-terms-handover.js 2>&1 | grep -E 'terms-handover' | tail -6" \
    || warn "약관 개정 고지 단계 실패 — 출력 확인 후 수동 재실행"
  # 남은 옛 부호화 0건 단언 — 운영엔 health-check 가 없어 노란 줄 하나로 묻히지 않게 빨간 줄로(Fable 권고 ③).
  [ "$DRY_RUN" = true ] && return 0
  local LEFT
  LEFT=$(prod_run "cd $PROD_BE && NODE_ENV=production node -e \"require('dotenv').config({quiet:true});const{sequelize}=require('./config/database');const A=require('./utils/allDayDate');sequelize.query('SELECT start_at,end_at FROM calendar_events WHERE all_day=1').then(([r])=>{console.log('@@'+r.filter(x=>!A.isUtcEncoded(x.start_at,x.end_at)).length);process.exit(0)}).catch(()=>{console.log('@@ERR');process.exit(0)})\" 2>/dev/null | grep '^@@' | tail -1")
  if [ "$LEFT" = "@@0" ]; then success "종일 옛 부호화 0건"
  else error "종일 옛 부호화 남음(${LEFT#@@}) — node scripts/migrate-allday-utc-date.js 재실행 필요"; fi
}

# ──────────────────────────────────────────
# nginx 보안헤더 스크립트 전달 (2026-09-10, Fable 게이트 지적)
# ──────────────────────────────────────────
#   rsync 는 `dev-backend/` 만 보낸다 → **운영에 scripts/ 가 없다**(실측: No such file).
#   그래서 CSP 를 바꿔도 운영에 적용할 방법이 서버에 없었다. 파일이라도 보내 둔다.
#   ★ 적용 자체는 root 가 필요하고 운영 계정은 sudo 비번을 묻는다 — 자동화 불가.
#     그래서 verify 단계가 **라이브 헤더를 실제로 재서** 안 맞으면 크게 알린다.
sync_nginx_headers() {
  local SRC="$SNAP/scripts/apply-nginx-security-headers.sh"
  [ -f "$SRC" ] || return 0
  if [ "$DRY_RUN" = true ]; then
    dim "  [dry] scp apply-nginx-security-headers.sh → $PROD_HOST:/opt/planq/scripts/"
    return 0
  fi
  ssh $SSH_OPTS "$PROD_HOST" "mkdir -p /opt/planq/scripts" > /dev/null 2>&1
  if scp $SSH_OPTS -q "$SRC" "$PROD_HOST:/opt/planq/scripts/" 2>/dev/null; then
    ssh $SSH_OPTS "$PROD_HOST" "chmod +x /opt/planq/scripts/apply-nginx-security-headers.sh" > /dev/null 2>&1
    success "nginx 보안헤더 스크립트 전달됨 (적용은 sudo 필요)"
  else
    warn "nginx 보안헤더 스크립트 전달 실패 — 수동 scp 필요"
  fi
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

  # 3) 라이브 CSP 대조 (2026-09-10, Fable 게이트 지적)
  #    저장소의 두 벌(nginx snippet · middleware/security.js)이 일치해도 **운영에 적용되지 않았으면**
  #    아무 소용이 없다. `csp` 가드는 파일만 비교하므로 라이브가 낡아도 초록이다.
  #    실제 사례: Picker 가 apis.google.com 스크립트를 요구하는데 운영 헤더는 `script-src 'self'` 라
  #    버튼은 뜨고 눌러도 안 열린다. 여기서 재지 않으면 아무도 모른다.
  #    ★ `add_header` **줄에서만** 뽑는다 — 그냥 grep 하면 위쪽 주석의 `script-src 'self'` 를
  #      집어 라이브와 영영 다르다(거짓 경보). 가드 checkCsp 와 같은 렌즈를 쓴다.
  #    ★ 한 지시문(script-src)만 보지 않는다 — **헤더 전체**를 비교한다.
  #      Fable 게이트 지적(2026-09-10): 지금 운영은 `frame-src` 도 낡아 Picker iframe 이 막히는데
  #      script-src 만 보면 그건 안 잡힌다. 나중에 frame-src 만 바뀌면 이 검사는 초록이 된다.
  EXPECT_CSP=$(grep -o 'add_header Content-Security-Policy "[^"]*"' "$SNAP/scripts/apply-nginx-security-headers.sh" \
    | head -1 | sed 's/^add_header Content-Security-Policy "//; s/"$//')
  LIVE_CSP=$(curl -sI --max-time 8 "https://$PROD_DOMAIN/" 2>/dev/null \
    | grep -i '^content-security-policy:' | head -1 | sed 's/^[^:]*: *//; s/\r$//')
  if [ -n "$EXPECT_CSP" ] && [ -n "$LIVE_CSP" ] && [ "$EXPECT_CSP" != "$LIVE_CSP" ]; then
    echo ""
    echo -e "${RED}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${NC}"
    echo -e "${RED}  운영 nginx 보안헤더가 낡았습니다 — 코드와 라이브가 다릅니다${NC}"
    # 전체 문자열 두 줄은 눈으로 못 읽는다 — **어긋난 지시문만** 짚는다.
    #   ★★ `|| true` 가 **반드시** 있어야 한다. `diff` 는 차이가 있으면 **exit 1**,
    #      `grep` 은 매치가 없으면 **exit 1** 이다. 스크립트가 `set -euo pipefail` 이라
    #      그 1 이 배포를 그 자리에서 **죽인다.** 2026-09-10 실제로 그렇게 죽어서
    #      릴리즈노트·개발현황 발행·update_record 가 통째로 건너뛰어졌다
    #      (코드·프론트·PM2 는 이미 착지한 뒤라 운영은 멀쩡했다 — 그래서 더 안 보인다).
    #      **알리려고 넣은 검사가 배포를 깨뜨리면 안 된다.**
    {
      diff <(printf '%s' "$EXPECT_CSP" | tr ';' '\n' | sed 's/^ *//') \
           <(printf '%s' "$LIVE_CSP"   | tr ';' '\n' | sed 's/^ *//') 2>/dev/null \
        | grep -E '^[<>]' \
        | while read -r L; do
            case "$L" in
              '<'*) echo -e "${RED}    코드에만: ${L#< }${NC}" ;;
              '>'*) echo -e "${RED}    운영에만: ${L#> }${NC}" ;;
            esac
          done
    } || true
    echo -e "${RED}  → 운영서버에서 실행해야 합니다(root 필요):${NC}"
    echo -e "${RED}    sudo /opt/planq/scripts/apply-nginx-security-headers.sh prod${NC}"
    echo -e "${RED}  적용 전까지 그 헤더에 의존하는 기능(예: Drive 찾아보기)은 동작하지 않습니다${NC}"
    echo -e "${RED}!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!${NC}"
    echo ""
    CSP_CHECK_RESULT="MISMATCH"
  elif [ -n "$LIVE_CSP" ]; then
    success "운영 CSP 라이브 일치 ($LIVE_CSP)"
    CSP_CHECK_RESULT="OK"
  else
    warn "운영 CSP 헤더를 읽지 못했습니다 — 수동 확인 필요"
    CSP_CHECK_RESULT="UNKNOWN"
  fi

  # 4) PDF 렌더 실호출 (#253 재발 검출)
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

  # 5) 이미지 보안 Stage 2a 관측 (docs/IMAGE_STAGE2_DECISIONS.md §4) — **운영 서버 안 카운터**를 읽는다.
  #    dev 사전 게이트의 health-check 는 dev 카운터만 본다 — 사용자는 운영에 있으므로 여기서 봐야 판정이 된다
  #    (Fable 게이트 소견 1). 재시작 직후라 거부 수는 0 에서 시작한다 — 볼 것은 **게이트가 켜져 있는가**다.
  IG_OUT=$(ssh $SSH_OPTS "$PROD_HOST" \
    "K=\$(grep -m1 '^INTERNAL_API_KEY=' $PROD_BE/.env | cut -d= -f2- | tr -d '\"'\\''' | tr -d '\r'); \
     [ -z \"\$K\" ] && echo 'NOKEY' && exit 0; \
     curl -s --max-time 15 -H \"x-internal-api-key: \$K\" http://localhost:$PROD_PORT/api/internal/health/imagegate" 2>/dev/null || echo "SSHFAIL")
  if echo "$IG_OUT" | grep -q '"gate_on":true'; then
    success "운영 이미지 게이트(L1) 켜짐"
    IMAGEGATE_CHECK_RESULT="ON"
  elif echo "$IG_OUT" | grep -q '"gate_on":false'; then
    warn "운영 이미지 게이트(L1) 꺼짐 — platform_settings.image_gate_l1_off_until 확인: $(echo "$IG_OUT" | head -c 200)"
    IMAGEGATE_CHECK_RESULT="OFF — off_until 확인"
  else
    warn "운영 이미지 게이트 관측 실패: $(echo "$IG_OUT" | head -c 200)"
    IMAGEGATE_CHECK_RESULT="UNKNOWN"
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
  if [ "$ROUTINE" = true ]; then
    dim "▶ 릴리즈 노트 건너뜀 (--routine — 정기 점검 배포는 새 소식·초안을 만들지 않는다)"
    return 0
  fi
  log "Publishing release note..."
  local VER NOTE
  VER=$(node -p "require('$SNAP/dev-backend/package.json').version" 2>/dev/null || echo "")
  if [ -z "$VER" ]; then warn "  버전을 읽지 못함 — 릴리즈 노트 건너뜀"; return 0; fi
  NOTE="$SNAP/docs/release-notes/v${VER}.json"
  if [ ! -f "$NOTE" ]; then
    # ★ 2026-09-07 — 여태 여기서 그냥 돌아갔다. 버전은 며칠씩 안 오르는데 배포는 하루 여러 번이라,
    #   대부분의 배포가 **아무것도 남기지 않았다** — "새 소식" 이 8건에 멈춘 이유다
    #   (Irene: "내용이 빈약한데 자동업데이트 배포하면서 하는 거 아니였어?").
    #   → 커밋 범위에서 **미발행 초안**을 만들어 올린다. 발행은 사람이 문구를 다듬은 뒤에 한다
    #     (커밋 제목은 개발자 언어다 — 그대로 사용자에게 내보내지 않는다).
    local DRAFT="/tmp/rn-draft-v${VER}.json"
    if node "$SNAP/dev-backend/scripts/make-release-note-draft.js" "${LAST_REMOTE:-}" "$DEPLOY_COMMIT" "$VER" --out "$DRAFT" 2>&1 | sed 's/^/    /'; then
      if [ "$DRY_RUN" = true ]; then dim "  [dry] 초안 업로드 (미발행)"; return 0; fi
      if scp $SSH_OPTS -q "$DRAFT" "$PROD_HOST:/tmp/rn-draft.json"          && prod_run "cd $PROD_BE && node scripts/publish-release-note.js /tmp/rn-draft.json"; then
        success "릴리즈 노트 **초안** 생성 (미발행) — /admin 에서 다듬어 발행하세요"
      else
        warn "  초안 업로드 실패 — 배포 자체는 정상"
      fi
      prod_run "rm -f /tmp/rn-draft.json" > /dev/null 2>&1 || true
      rm -f "$DRAFT"
    else
      dim "  사용자에게 보일 변경(feat/fix/perf)이 없어 초안 없음"
    fi
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
  cd "$REPO"

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
  RANGE_IDS=$( { git log --format=%B "${LAST_REMOTE}..${DEPLOY_COMMIT}" 2>/dev/null || true; } \
               | grep -iE '^[[:space:]]*Feedback-Closes:' \
               | grep -oE '[0-9]{2,5}' || true )

  # 이미 배포가 끝난 옛 커밋의 번호는 위 범위에 **영영 안 들어온다** — 그런 잔여분을 담는 자리.
  #   (2026-08-21 실측: #213 #220 #222 #232 #257 #260 #287 이 6b3f4590·41158147 에서 나가
  #    운영에 도달했는데 장부는 pending 이었다.) 닫힌 뒤 다시 실려도 스크립트가 건너뛴다(멱등).
  BACKLOG_IDS=$( { grep -oE '^[[:space:]]*[0-9]{3,4}\b' "$SNAP/scripts/feedback-close-backlog.txt" 2>/dev/null || true; } \
                 | tr -d ' \t' || true )

  # ★ 철회 트레일러 — 앞선 커밋의 `Feedback-Closes:` 를 **나중 커밋이 취소**한다.
  #   커밋 메시지는 되돌릴 수 없다. 그런데 "다 고친 줄 알았는데 부분 해결이었다" 는 흔하다
  #   (2026-08-28 실측: #378 은 5개 요구 중 2개만 고쳤는데 트레일러를 넣어 닫힐 뻔했다).
  #   부분 해결을 닫으면 나머지가 묻히고, 사용자는 무시당했다고 느낀다.
  #   사용법:  Feedback-Keeps-Open: 378
  local KEEP_IDS
  KEEP_IDS=$( { git log --format=%B "${LAST_REMOTE}..${DEPLOY_COMMIT}" 2>/dev/null || true; } \
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
  if ! scp $SSH_OPTS "$SNAP/scripts/close-deployed-feedback.js" "$PROD_HOST:/tmp/cdf.js" > /dev/null 2>&1; then
    warn "장부 스크립트 전송 실패 — 장부는 수동으로 닫아야 합니다 (배포 자체는 정상)"
    return 0
  fi
  # ★ **보낸 번호와 실제로 닫힌 번호는 다르다.** 밀린 장부 파일(feedback-close-backlog.txt)의
  #   번호는 매 배포마다 다시 실려 나가고, 이미 done 인 건은 스크립트가 건너뛴다(멱등).
  #   그런데 개발 현황에는 **보낸 번호**를 그대로 적고 있었다 — 그래서 오늘 배포 4건이
  #   전부 "같은 신고 7건을 닫았다" 고 기록됐다. 닫은 것은 첫 배포 하나뿐인데.
  #   닫기 스크립트가 실제로 바꾼 번호(`닫을 건 N: #213 #220`)를 받아 그것만 기록한다.
  local CLOSE_OUT
  CLOSE_OUT=$(prod_run "cd $PROD_BE && node /tmp/cdf.js --ids $IDS --apply" 2>&1) \
    || warn "장부 닫기 실패 — 수동 확인 필요 (배포 자체는 정상)"
  printf '%s\n' "$CLOSE_OUT"
  local ACTUAL
  ACTUAL=$( printf '%s\n' "$CLOSE_OUT" | grep -E '^닫을 건 [0-9]+:' | grep -oE '#[0-9]+' \
            | tr -d '#' | sort -un | paste -sd, - || true )
  # 파싱이 실패하면(문구가 바뀌면) 보낸 번호로 되돌린다 — 기록이 비는 것보다 낫다.
  if [ -n "$CLOSE_OUT" ]; then DEPLOY_CLOSED_IDS="$ACTUAL"; fi
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
  cd "$REPO"
  local HEAD_FULL NOTE META SHORT MY_VER
  HEAD_FULL="$DEPLOY_COMMIT"
  SHORT=$(git rev-parse --short "$DEPLOY_COMMIT")
  # ★ publish_release_note 의 $VER 은 그 함수의 local 이라 여기까지 안 온다 —
  #   첫 실전(6ffbc710)에서 version 이 null 로 들어갔다. 여기서 직접 읽는다.
  MY_VER=$(node -p "require('$SNAP/dev-backend/package.json').version" 2>/dev/null || echo "")
  # ★ 커밋 해시는 커밋하기 전에는 알 수 없다. 그래서 작성 중인 현황은 next.json 에 쓰고,
  #   배포 시점에 이 스크립트가 실제 HEAD 로 도장을 찍는다(파일은 그대로 두고 DB 키만 커밋).
  #   특정 배포를 다시 쓸 일이 있으면 {짧은해시}.json 을 만들어 두면 그쪽이 우선한다.
  # 커밋된 기록을 읽는다(사본) — 배포 방은 배포 전에 `git commit -- docs/dev-status/next.json`.
  NOTE="$SNAP/docs/dev-status/${SHORT}.json"
  [ -f "$NOTE" ] || NOTE="$SNAP/docs/dev-status/next.json"
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
  # HEAD 가 아니라 **실제로 보낸 커밋** — 배포 중 다른 방이 커밋해도 기록이 어긋나지 않는다.
  ssh $SSH_OPTS "$PROD_HOST" "echo $DEPLOY_COMMIT > $PROD_BE/.last-deployed-commit"
}

# ──────────────────────────────────────────
# Summary
# ──────────────────────────────────────────
show_summary() {
  echo ""
  echo -e "${BLUE}=========================================${NC}"
  echo -e "${BLUE}  PlanQ Deployment Summary${NC}"
  echo -e "${BLUE}=========================================${NC}"
  cd "$REPO"
  echo ""
  echo "  Commit:    ${DEPLOY_COMMIT:0:8} — $(git log -1 --format='%s' "$DEPLOY_COMMIT" | head -c 70)  (깨끗한 사본)"
  echo "  Timestamp: $TIMESTAMP"
  echo "  Backup:    $BACKUP_DIR (on prod)"
  echo ""
  echo "  PDF 렌더:  ${PDF_CHECK_RESULT:-미실행}"
  echo "  이미지게이트: ${IMAGEGATE_CHECK_RESULT:-미실행}"
  echo "  운영 CSP:  ${CSP_CHECK_RESULT:-미실행}"
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
# ──────────────────────────────────────────
# 약관·방침 버전 올리기 — 새 화면이 올라가고 검증까지 끝난 **뒤에** 돈다(2026-10-07)
#   재동의 창은 platform_settings 버전이 바뀌면 뜬다. 프론트 배포 전에 올리면 그 몇 분 동안 옛 방침 문구로 재동의를 받는다.
#   Irene: "배포할 때 전달되게 해야지." — 손으로 올리는 단계를 없앴다. 목표 버전은 스크립트 안 TARGET(멱등 · 낮추지 않음).
# ──────────────────────────────────────────
bump_policy_versions() {
  if [ "$DRY_RUN" = true ]; then dim "  [dry] node scripts/bump-privacy-version.js"; return 0; fi
  log "Bumping privacy policy version..."
  prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/bump-privacy-version.js 2>&1 | tail -3" \
    || warn "방침 버전 올리기 실패 — 관리자 > 플랫폼 설정에서 privacy_version 을 직접 올려 주세요"
}

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

  make_snapshot
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
  post_restart_backfills
  sync_nginx_headers
  reload_nginx
  verify_deployment
  bump_policy_versions
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
