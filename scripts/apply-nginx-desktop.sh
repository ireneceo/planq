#!/bin/bash
# 데스크탑 앱 설치 파일·자동 업데이트 목록 자리 — nginx `/desktop/` → /opt/planq/desktop-releases/ (2026-11-10).
#   sudo bash /opt/planq/scripts/apply-nginx-desktop.sh /etc/nginx/sites-enabled/planq.kr   # 운영(Irene)
#
# 왜: docs/DESKTOP_APP_DESIGN.md §4-3 (Fable DESIGN-READY). 이 자리가 없으면 nginx 의 SPA 폴백이 /desktop/latest.yml 에
#   index.html 을 200 으로 준다 → 자동 업데이트가 «목록이 깨졌다» 로 조용히 실패하고 받기 버튼도 화면을 받는다.
# 하는 일: ① 폴더 만들기(주인 = sudo 를 부른 사람 — publish.sh 가 그 사람으로 올린다) ② 첫 `location / {` 앞에 정적 블록
#   (목록 안 보임 · 없는 파일 404 · no-cache — 새 버전 목록을 바로 보게) ③ nginx -t 통과면 다시 읽기, 아니면 원래대로.
# 되돌리기: 출력의 백업 파일을 제자리에 복사 → nginx -t → systemctl reload nginx.
set -e
CONF=${1:-/etc/nginx/sites-enabled/dev.planq.kr}
DIR=/opt/planq/desktop-releases
BAK=/tmp/$(basename "$CONF").bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0 $*"; exit 1; }
[ -e "$CONF" ] || { echo "설정 파일 없음: $CONF"; exit 1; }
OWNER=${SUDO_USER:-irene}
mkdir -p "$DIR" && chown "$OWNER":"$OWNER" "$DIR" && chmod 755 "$DIR"
echo "폴더 준비: $DIR (주인 $OWNER)"
if grep -qF "location ^~ /desktop/" "$CONF"; then echo "nginx 에 이미 들어가 있습니다. 할 일 없음."; exit 0; fi
grep -qE '^[[:space:]]*location / \{$' "$CONF" || { echo "location / 를 못 찾음 — 중단. nginx 는 바꾸지 않았습니다."; exit 1; }
SNIP=""; grep -q "snippets/planq-security-headers.conf" "$CONF" && SNIP="        include snippets/planq-security-headers.conf;"

cp -L "$CONF" "$BAK"
python3 - "$(readlink -f "$CONF")" "$SNIP" "$DIR" <<'PY'
import sys, re
path, snip, d = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
block = "    # 데스크탑 앱 설치 파일·자동 업데이트 목록 (scripts/apply-nginx-desktop.sh, 2026-11-10)\n    location ^~ /desktop/ {\n"
block += f"        alias {d}/;\n        autoindex off;\n"
if snip: block += snip + "\n"
block += '        add_header Cache-Control "no-cache" always;\n    }\n\n'
m = re.search(r'^[ \t]*location / \{$', s, re.M)
s = s[:m.start()] + block + s[m.start():]
open(path, 'w').write(s)
PY
if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
  HOST=$(grep -m1 -oE 'server_name [^;]+' "$CONF" | awk '{print $2}')
  echo "확인: https://${HOST}/desktop/없는파일 → 404 여야 정상(200 이면 SPA 폴백)"
  curl -s -o /dev/null -w '%{http_code}\n' "https://${HOST}/desktop/__check__.yml"
else
  cp "$BAK" "$(readlink -f "$CONF")"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
