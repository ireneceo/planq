#!/bin/bash
# 운영 진입 자동 생성 시크릿 — JWT / Internal API / VAPID
# 사용법: /opt/planq/scripts/generate-prod-secrets.sh
# 결과를 그대로 prod-backend/.env 의 각 항목에 붙여넣으면 됨.

set -euo pipefail
cd /opt/planq/dev-backend

color_blue()  { printf "\033[34m%s\033[0m\n" "$1"; }
color_green() { printf "\033[32m%s\033[0m\n" "$1"; }
color_gray()  { printf "\033[90m%s\033[0m\n" "$1"; }

color_blue "═══ PlanQ 운영 시크릿 자동 생성 ═══"
echo ""

color_gray "# JWT_SECRET (64 bytes hex)"
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")"

color_gray "# JWT_REFRESH_SECRET (64 bytes hex, 위와 다른 값)"
echo "JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")"

color_gray "# INTERNAL_API_KEY (32 bytes hex — Python Q Note ↔ Node 통신)"
echo "INTERNAL_API_KEY=planq-internal-prod-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

color_gray "# VAPID 키 쌍 (Web Push)"
VAPID_OUT=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)
echo "VAPID_PUBLIC_KEY=$(echo "$VAPID_OUT" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>console.log(JSON.parse(s).publicKey))")"
echo "VAPID_PRIVATE_KEY=$(echo "$VAPID_OUT" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>console.log(JSON.parse(s).privateKey))")"
echo "VAPID_SUBJECT=mailto:help@planq.kr"

echo ""
color_green "═══ 생성 완료 ═══"
color_gray "위 5개 라인을 prod-backend/.env 에 추가/교체하세요."
color_gray "(이 출력에는 secret 이 포함되어 있으니 화면 캡처·로그 저장 주의)"
