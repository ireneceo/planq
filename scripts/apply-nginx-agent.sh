#!/bin/bash
# dev.planq.kr nginx 에 AI 에이전트 경로(scripts/nginx-agent.conf)를 끼워 넣는다 (#439).
#   사용: sudo bash /opt/planq/scripts/apply-nginx-agent.sh
#   백업 → 한 번만 삽입 → 문법 검사 실패하면 원복 → 성공하면 reload.
set -e
CONF=/etc/nginx/sites-enabled/dev.planq.kr
SNIP=/opt/planq/scripts/nginx-agent.conf
BAK=/tmp/dev.planq.kr.bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0"; exit 1; }
[ -f "$SNIP" ] || { echo "조각 파일 없음: $SNIP"; exit 1; }
if grep -q "nginx-agent.conf" "$CONF"; then echo "이미 들어가 있습니다. 할 일 없음."; exit 0; fi
[ "$(grep -c '^    location /api/ {$' "$CONF")" = "1" ] || { echo "넣을 자리(location /api/)를 하나로 못 찾음 — 중단"; exit 1; }

cp "$CONF" "$BAK"
sed -i "s#^    location /api/ {\$#    include $SNIP;\n    location /api/ {#" "$CONF"
if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
else
  cp "$BAK" "$CONF"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
