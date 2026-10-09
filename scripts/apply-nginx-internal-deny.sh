#!/bin/bash
# apply-nginx-internal-deny.sh — 내부 전용 주소를 nginx 에서도 막는다 (2026-10-09 보안점검)
#
# 무엇을:
#   ① `location /api/internal` (prefix, 대소문자 구분) → `location ~* ^/api/internal` (대소문자 무시)
#      Express 는 대소문자를 가리지 않아 `/api/INTERNAL/…` 이 deny 를 비켜 Node 까지 갔다.
#   ② `location ~* ^/qnote/api/[^/]+/internal { deny all; }` 추가
#      `/qnote/` 가 Q Note 전체를 바깥에 열어 내부 주소(회의록 내보내기·사용자 삭제)가 키 하나로만 지켜졌다.
#   앱 층(Node utils/internalAuth · q-note main.py _internal_gate)이 이미 막는다 — 이것은 두 번째 겹이다.
#
# 사용 (root 필요):
#   sudo /opt/planq/scripts/apply-nginx-internal-deny.sh dev
#   sudo /opt/planq/scripts/apply-nginx-internal-deny.sh prod
#
# 안전장치: 백업 → 수정 → `nginx -t` 실패 시 자동 원복 → reload → 실측(403) 실패 시 자동 원복. 두 번 돌려도 같다(멱등).
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  dev)  CONF=/etc/nginx/sites-enabled/dev.planq.kr; HOST=https://dev.planq.kr ;;
  prod) CONF=/etc/nginx/sites-enabled/planq.kr;     HOST=https://planq.kr ;;
  *) echo "사용: sudo $0 {dev|prod}"; exit 1 ;;
esac
[ "$(id -u)" = "0" ] || { echo "✗ root 권한이 필요합니다:  sudo $0 $TARGET"; exit 1; }
[ -f "$CONF" ] || { echo "✗ 설정 파일 없음: $CONF"; exit 1; }

BACKUP="$CONF.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$CONF" "$BACKUP"
restore() { echo "↩ 원복: $BACKUP"; cp -a "$BACKUP" "$CONF"; nginx -t >/dev/null 2>&1 && systemctl reload nginx || true; }

python3 - "$CONF" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'location\s+/api/internal\s*\{', 'location ~* ^/api/internal {', s)
if '^/qnote/api/[^/]+/internal' not in s:
    s = re.sub(r'(\n(\s*)location\s+/qnote/\s*\{)',
               r'\n\2# 2026-10-09 보안점검 — Q Note 내부 주소는 바깥에서 막는다(앱 층과 두 겹)\n\2location ~* ^/qnote/api/[^/]+/internal {\n\2    deny all;\n\2}\1', s, count=1)
open(p, 'w').write(s)
PY

if ! nginx -t; then echo "✗ nginx -t 실패"; restore; exit 1; fi
systemctl reload nginx
sleep 1

fail=0
for path in /api/internal/x /api/INTERNAL/x /qnote/api/sessions/internal/export /qnote/api/SESSIONS/internal/export; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$HOST$path" || echo 000)
  echo "  $path → $code"
  [ "$code" = "403" ] || fail=1
done
# 대조군 — 일반 주소는 막히면 안 된다
code=$(curl -s -o /dev/null -w '%{http_code}' "$HOST/qnote/health" || echo 000)
echo "  /qnote/health (대조군) → $code"
[ "$code" = "200" ] || fail=1

if [ "$fail" = "1" ]; then echo "✗ 실측 실패"; restore; exit 1; fi
echo "✓ 적용 완료 (백업 $BACKUP)"
