#!/bin/bash
# apply-nginx-security-headers.sh — 앱 HTML 에 보안 헤더 적용 (2026-09-02 보안감사 H-1)
#
# 문제: 백엔드 helmet 은 /api/ 응답에만 붙고, 화면(HTML)은 nginx 가 직접 서빙해서
#       CSP·X-Frame-Options·HSTS 가 **하나도 없다** → 클릭재킹 열림 + XSS 완화 0.
#
# 사용 (root 필요):
#   sudo /opt/planq/scripts/apply-nginx-security-headers.sh dev
#   sudo /opt/planq/scripts/apply-nginx-security-headers.sh prod
#
# 안전장치: 백업 → 수정 → `nginx -t` 실패 시 **자동 원복** → 성공해야 reload → 마지막에 실측 검증.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  dev)  CONF=/etc/nginx/sites-enabled/dev.planq.kr; URL=https://dev.planq.kr/talk ;;
  prod) CONF=/etc/nginx/sites-enabled/planq.kr;     URL=https://planq.kr/talk ;;
  *) echo "사용: sudo $0 {dev|prod}"; exit 1 ;;
esac

[ "$(id -u)" = "0" ] || { echo "✗ root 권한이 필요합니다:  sudo $0 $TARGET"; exit 1; }
[ -f "$CONF" ] || { echo "✗ 설정 파일 없음: $CONF"; exit 1; }

if grep -q "Content-Security-Policy" "$CONF"; then
  echo "ℹ️  이미 적용돼 있습니다 ($CONF) — 변경 없음"
  exit 0
fi

STAMP=$(date +%Y%m%d_%H%M%S)
BAK="${CONF}.bak-${STAMP}"
cp "$CONF" "$BAK"
echo "백업: $BAK"

# CSP 값은 백엔드 middleware/security.js 의 cspMiddleware 와 같은 값으로 유지할 것.
BLOCK=$(cat <<'EOF'

    # 보안 헤더 — 앱 HTML 용 (백엔드 helmet 은 /api/ 응답에만 붙는다).
    #   ★ add_header 는 하위 location 에서 하나라도 쓰면 상위 것이 전부 사라진다.
    #     새 location 을 만들면 이 블록을 그 안에도 복사할 것.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
EOF
)

# `index index.html;` 다음 줄에 삽입 (server 블록 최상단 — 하위 location 에 상속)
python3 - "$CONF" <<PYEOF
import sys
path = sys.argv[1]
block = '''$BLOCK'''
src = open(path).read()
anchor = 'index index.html;'
if anchor not in src:
    print('✗ 삽입 위치(index index.html;)를 찾지 못했습니다'); sys.exit(1)
open(path, 'w').write(src.replace(anchor, anchor + block, 1))
PYEOF

echo "== nginx 문법 검사 =="
if ! nginx -t; then
  cp "$BAK" "$CONF"
  echo "✗ 문법 오류 — 원복했습니다 (변경 없음)"
  exit 1
fi

systemctl reload nginx
echo "== 실측 검증 =="
sleep 1
N=$(curl -sSI "$URL" | grep -icE 'content-security-policy|x-frame-options|strict-transport-security|x-content-type-options' || true)
echo "  $URL → 보안 헤더 ${N}/4"
if [ "$N" -ge 4 ]; then
  echo "✅ 적용 완료"
else
  echo "⚠️  헤더가 4개 미만입니다 — 하위 location 의 add_header 가 가리고 있을 수 있습니다."
  echo "   원복하려면:  sudo cp $BAK $CONF && sudo nginx -t && sudo systemctl reload nginx"
fi
