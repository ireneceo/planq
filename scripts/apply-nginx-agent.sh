#!/bin/bash
# nginx 서버 블록에 AI 에이전트 경로(scripts/nginx-agent.conf)를 끼워 넣는다 (#439).
#   개발: sudo bash /opt/planq/scripts/apply-nginx-agent.sh
#   운영: sudo bash /opt/planq/scripts/apply-nginx-agent.sh   (경로 생략 시 이 서버의 설정을 찾는다)
#   백업 → 한 번만 삽입 → 문법 검사 실패하면 원복 → 성공하면 reload.
# ★ 운영 planq.kr 은 sites-available 을 가리키는 **바로가기(symlink)** 다. `sed -i` 는 기본으로 바로가기를
#   보통 파일로 바꿔 버려 다음에 sites-available 을 고쳐도 안 먹는다 → `--follow-symlinks` 로 원본을 고친다.
set -e
# 경로를 안 주면 이 서버에 있는 것을 찾는다 — 개발(dev.planq.kr) 먼저, 없으면 운영(planq.kr).
#   (긴 명령을 복사하다 줄이 나뉘어 인자가 빠지는 일이 실제로 있었다 — 인자 없이도 맞게 돈다)
if [ -n "$1" ]; then CONF=$1
elif [ -e /etc/nginx/sites-enabled/dev.planq.kr ]; then CONF=/etc/nginx/sites-enabled/dev.planq.kr
else CONF=/etc/nginx/sites-enabled/planq.kr; fi
SNIP=/opt/planq/scripts/nginx-agent.conf
BAK=/tmp/$(basename "$CONF").bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0 $*"; exit 1; }
[ -f "$SNIP" ] || { echo "조각 파일 없음: $SNIP"; exit 1; }
[ -e "$CONF" ] || { echo "설정 파일 없음: $CONF"; exit 1; }
if grep -q "nginx-agent.conf" "$CONF"; then echo "이미 들어가 있습니다. 할 일 없음."; exit 0; fi
N=$(grep -cE '^[[:space:]]*location /api/ \{$' "$CONF" || true)
[ "$N" = "1" ] || { echo "넣을 자리(location /api/ {)가 ${N}개 — 하나가 아니라 중단. 아무것도 바꾸지 않았습니다."; exit 1; }

cp -L "$CONF" "$BAK"
sed -i --follow-symlinks -E "s#^([[:space:]]*)location /api/ \{\$#\1include $SNIP;\n\1location /api/ {#" "$CONF"
if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
else
  cp "$BAK" "$(readlink -f "$CONF")"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
