#!/bin/bash
# PlanQ 운영 배포 스크립트
#
# 사용법:
#   /opt/planq/scripts/deploy-prod.sh --dry-run   # 미리보기 (rsync -n + 실제 명령 출력만)
#   /opt/planq/scripts/deploy-prod.sh             # 실제 배포
#   /opt/planq/scripts/deploy-prod.sh --skip-build  # 백엔드만 (긴급 hotfix)
#
# ─── 사전 조건 (운영 진입 첫 1회만) ───
#   1) 운영 DB 생성:
#        mysql -uroot -p -e "CREATE DATABASE planq_prod_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
#        mysql -uroot -p -e "CREATE USER 'planq_admin'@'localhost' IDENTIFIED BY '<강력한_비밀번호>';"
#        mysql -uroot -p -e "GRANT ALL ON planq_prod_db.* TO 'planq_admin'@'localhost'; FLUSH PRIVILEGES;"
#
#   2) 운영 .env 파일 작성:
#        cp /opt/planq/dev-backend/.env.production.example /opt/planq/prod-backend/.env
#        # 모든 placeholder 값을 실제 운영 값으로 채움
#
#   3) 운영 Q Note .env (있으면):
#        cp /opt/planq/q-note/.env /opt/planq/prod-qnote/.env
#        # OPENAI_API_KEY 등 운영용으로 교체
#
#   4) PM2 ecosystem 등록:
#        pm2 start /opt/planq/scripts/prod-ecosystem.config.js
#        pm2 save
#
#   5) nginx + SSL:
#        sudo cp /opt/planq/scripts/nginx-planq.kr.conf /etc/nginx/sites-available/planq.kr
#        sudo ln -s /etc/nginx/sites-available/planq.kr /etc/nginx/sites-enabled/
#        sudo nginx -t && sudo systemctl reload nginx
#        sudo certbot --nginx -d planq.kr -d www.planq.kr
#
#   6) DB 스키마 초기화:
#        cd /opt/planq/prod-backend && NODE_ENV=production node sync-database.js

set -euo pipefail

# ─── 설정 ───
DEV_BE="/opt/planq/dev-backend"
DEV_FE="/opt/planq/dev-frontend"
DEV_QNOTE="/opt/planq/q-note"
PROD_BE="/opt/planq/prod-backend"
PROD_FE_BUILD="/opt/planq/prod-frontend-build"
PROD_QNOTE="/opt/planq/prod-qnote"
PROD_PORT=3002
ECOSYSTEM="/opt/planq/scripts/prod-ecosystem.config.js"

DRY_RUN=false
SKIP_BUILD=false
SKIP_QNOTE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-qnote) SKIP_QNOTE=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

color_blue()  { printf "\033[34m%s\033[0m\n" "$1"; }
color_green() { printf "\033[32m%s\033[0m\n" "$1"; }
color_red()   { printf "\033[31m%s\033[0m\n" "$1"; }
color_gray()  { printf "\033[90m%s\033[0m\n" "$1"; }

# ─── 안전 가드 ───
color_blue "▶ 사전 검사"

# 1) Dev 디렉터리 존재
[[ -d "$DEV_BE" ]] || { color_red "✗ $DEV_BE 없음"; exit 1; }
[[ -d "$DEV_FE" ]] || { color_red "✗ $DEV_FE 없음"; exit 1; }
color_green "✓ dev 소스 디렉터리 OK"

# 2) Prod 디렉터리 존재 — 첫 배포면 생성
if [[ ! -d "$PROD_BE" ]]; then
  if $DRY_RUN; then
    color_gray "[dry] mkdir -p $PROD_BE"
  else
    mkdir -p "$PROD_BE"
    color_green "✓ $PROD_BE 생성"
  fi
fi
if [[ ! -d "$PROD_FE_BUILD" ]]; then
  if $DRY_RUN; then
    color_gray "[dry] mkdir -p $PROD_FE_BUILD"
  else
    mkdir -p "$PROD_FE_BUILD"
    color_green "✓ $PROD_FE_BUILD 생성"
  fi
fi

# 3) 운영 .env 존재 — 없으면 배포 거부 (env 누락은 즉시 크래시 유발)
if [[ ! -f "$PROD_BE/.env" && ! $DRY_RUN ]]; then
  color_red "✗ $PROD_BE/.env 없음. 사전 조건 2번 참고."
  color_red "  cp $DEV_BE/.env.production.example $PROD_BE/.env"
  color_red "  # 후 placeholder 값을 운영 값으로 채워야 함"
  exit 1
fi

# 4) Uncommitted 변경사항 경고 (재현성 보장)
cd /opt/planq
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  color_red "⚠ uncommitted 변경사항 있음. 운영 배포 전 커밋 권장."
  if ! $DRY_RUN; then
    read -p "그래도 진행? (yes/no): " ANSWER
    [[ "$ANSWER" == "yes" ]] || { color_red "취소됨"; exit 1; }
  fi
fi

# ─── 1. 백엔드 코드 sync (.env, uploads, node_modules 제외) ───
color_blue "▶ 1/5 백엔드 코드 동기화"
RSYNC_OPTS="-av --exclude .env --exclude .env.* --exclude node_modules --exclude uploads --exclude '*.log' --delete"
if $DRY_RUN; then
  color_gray "[dry] rsync $RSYNC_OPTS $DEV_BE/ $PROD_BE/"
  rsync -avn --exclude .env --exclude .env.* --exclude node_modules --exclude uploads --exclude '*.log' --delete "$DEV_BE/" "$PROD_BE/" | head -20
else
  rsync -av --exclude .env --exclude .env.* --exclude node_modules --exclude uploads --exclude '*.log' --delete "$DEV_BE/" "$PROD_BE/"
  color_green "✓ 백엔드 코드 동기화 완료"
fi

# ─── 2. 백엔드 의존성 설치 (production only) ───
color_blue "▶ 2/5 백엔드 의존성 (npm ci --omit=dev)"
if $DRY_RUN; then
  color_gray "[dry] cd $PROD_BE && npm ci --omit=dev"
else
  ( cd "$PROD_BE" && npm ci --omit=dev --silent )
  color_green "✓ 백엔드 의존성 설치 완료"
fi

# ─── 3. 프론트엔드 빌드 (NODE_ENV=production, --outDir prod-frontend-build) ───
if $SKIP_BUILD; then
  color_gray "▶ 3/5 프론트엔드 빌드 스킵 (--skip-build)"
else
  color_blue "▶ 3/5 프론트엔드 빌드"
  if $DRY_RUN; then
    color_gray "[dry] cd $DEV_FE && NODE_ENV=production npm run build -- --outDir $PROD_FE_BUILD"
  else
    ( cd "$DEV_FE" && NODE_ENV=production npm run build -- --outDir "$PROD_FE_BUILD" )
    color_green "✓ 프론트엔드 빌드 완료 → $PROD_FE_BUILD"
  fi
fi

# ─── 4. Q Note sync + venv 의존성 (rsync) ───
if $SKIP_QNOTE; then
  color_gray "▶ 4/5 Q Note 스킵 (--skip-qnote)"
elif [[ ! -d "$DEV_QNOTE" ]]; then
  color_gray "▶ 4/5 Q Note 디렉터리 없음 — 스킵"
else
  color_blue "▶ 4/5 Q Note 코드 동기화"
  if $DRY_RUN; then
    color_gray "[dry] rsync $DEV_QNOTE → $PROD_QNOTE (venv·data·uploads·.env 제외)"
  else
    mkdir -p "$PROD_QNOTE"
    rsync -av --exclude venv --exclude data --exclude uploads --exclude .env --exclude '*.db' --exclude __pycache__ --exclude '*.pyc' "$DEV_QNOTE/" "$PROD_QNOTE/"
    # venv 가 prod 에 없으면 생성
    if [[ ! -d "$PROD_QNOTE/venv" ]]; then
      color_blue "  venv 생성 + 의존성 설치 (첫 배포)"
      python3 -m venv "$PROD_QNOTE/venv"
      "$PROD_QNOTE/venv/bin/pip" install --upgrade pip --quiet
      "$PROD_QNOTE/venv/bin/pip" install -r "$PROD_QNOTE/requirements.txt" --quiet
    fi
    color_green "✓ Q Note 동기화 완료"
  fi
fi

# ─── 5. PM2 reload (zero-downtime) + Health check ───
color_blue "▶ 5/5 PM2 reload + 헬스체크"
if $DRY_RUN; then
  color_gray "[dry] pm2 reload $ECOSYSTEM"
  color_gray "[dry] curl http://localhost:$PROD_PORT/api/health"
else
  # PM2 ecosystem 등록되어 있지 않으면 start, 있으면 reload
  if pm2 describe planq-prod-backend > /dev/null 2>&1; then
    pm2 reload "$ECOSYSTEM"
  else
    color_blue "  prod-backend 미등록 — 첫 start"
    pm2 start "$ECOSYSTEM"
  fi

  # Health check (재시작 직후 잠깐 기다림)
  sleep 4
  if curl -sf "http://localhost:$PROD_PORT/api/health" > /dev/null; then
    color_green "✓ planq-prod-backend health OK (port $PROD_PORT)"
  else
    color_red "✗ planq-prod-backend health 실패 — pm2 logs planq-prod-backend 확인"
    exit 1
  fi
fi

color_green "════════════════════════════════════════"
color_green "✓ 배포 완료"
$DRY_RUN && color_gray "(dry-run 모드 — 실제 변경 없음)"
color_green "════════════════════════════════════════"
echo "확인:"
echo "  pm2 status"
echo "  curl https://planq.kr/api/health"
echo "  pm2 logs planq-prod-backend --lines 30"
