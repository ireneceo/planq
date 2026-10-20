#!/bin/bash
# 내 명함 공개 페이지(/c/<토큰>) — 검색엔진 색인 차단 헤더를 nginx 에서 붙인다 (2026-10-17).
#   sudo bash /opt/planq/scripts/apply-nginx-name-card.sh                         # 개발(dev.planq.kr)
#   sudo bash /opt/planq/scripts/apply-nginx-name-card.sh /etc/nginx/sites-enabled/planq.kr   # 운영(배포 때)
#
# 왜(Fable 설계 판정 차단1, docs/BUSINESS_CARD_DESIGN.md 0절): 사람·Googlebot·네이버 Yeti 는 `location /` 의 try_files 로
#   index.html 을 **직접** 받는다 — 백엔드가 붙이는 X-Robots-Tag 는 SNS 미리보기 봇에게만 간다. 명함 링크는 이메일 서명·
#   SNS 프로필·인쇄물에 올라가는 것이 정상이라 검색엔진이 찾아오고, 색인되면 전화·이메일이 캐시에 박혀 회수할 수 없다.
# 하는 일: 첫 `location / {` 바로 앞에 `location ^~ /c/ { … }` 를 넣는다 — 보안 헤더 snippet 재포함(add_header 는 블록마다
#   상속이 끊긴다) · X-Robots-Tag · no-cache · 공유 봇은 백엔드(OG) · 나머지는 index.html.
# 되돌리기: 출력의 백업 파일을 제자리에 복사 → nginx -t → systemctl reload nginx.
set -e
CONF=${1:-/etc/nginx/sites-enabled/dev.planq.kr}
BAK=/tmp/$(basename "$CONF").bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0 $*"; exit 1; }
[ -e "$CONF" ] || { echo "설정 파일 없음: $CONF"; exit 1; }
# ★ 2026-10-17 Fable 완료 검증 FAIL — 옛 블록은 `try_files $uri /index.html;` 이라 /index.html 로 **내부 이동**해
#   응답을 `location /` 가 만들었고, 그러면 이 블록의 add_header(X-Robots-Tag)가 버려진다(Googlebot·Yeti UA 실측 헤더 없음).
#   `try_files /index.html =404;` 는 첫 인자가 있으면 **이 location 안에서** 그대로 준다 → 헤더가 남는다.
#   옛 블록이 있으면 지우고 새로 넣는다(같은 블록이 이미 맞으면 할 일 없음).
if grep -qF "location ^~ /c/" "$CONF" && grep -qF "try_files /index.html =404; # name-card" "$CONF"; then echo "이미 들어가 있습니다. 할 일 없음."; exit 0; fi
N=$(grep -cE '^[[:space:]]*location / \{$' "$CONF" || true)
[ "$N" -ge 1 ] || { echo "location / 를 못 찾음 — 중단. 아무것도 바꾸지 않았습니다."; exit 1; }
# 백엔드 포트 — 기존 공유 봇 분기의 proxy_pass 에서 읽는다(없으면 봇 분기 없이 넣는다)
PORT=$(grep -oE 'proxy_pass http://(localhost|127\.0\.0\.1):[0-9]+;' "$CONF" | grep -oE ':[0-9]+' | head -1 | tr -d ':')
SNIP=""; grep -q "snippets/planq-security-headers.conf" "$CONF" && SNIP="        include snippets/planq-security-headers.conf;"
BOT=""; if grep -q 'planq_share_bot' "$CONF" && [ -n "$PORT" ]; then
  BOT="        if (\$planq_share_bot) {\n            proxy_pass http://localhost:${PORT};\n            break;\n        }"
fi

cp -L "$CONF" "$BAK"
python3 - "$(readlink -f "$CONF")" "$SNIP" "$BOT" <<'PY'
import sys, re
path, snip, bot = sys.argv[1], sys.argv[2], sys.argv[3].replace('\\n', '\n')
s = open(path).read()
block = "    # 내 명함 공개 페이지 — 개인 연락처라 검색 색인 차단 (scripts/apply-nginx-name-card.sh, 2026-10-17)\n    location ^~ /c/ {\n"
if snip: block += snip + "\n"
block += '        add_header X-Robots-Tag "noindex, nofollow" always;\n'
if bot: block += bot + "\n"
block += '        add_header Cache-Control "no-cache, no-store, must-revalidate" always;\n        try_files /index.html =404; # name-card\n    }\n\n'
# 옛 블록(주석 한 줄 + location ^~ /c/ { … }) 이 있으면 지운다 — 블록 안 `if { }` 하나까지 중괄호를 맞춰 끝을 찾는다
old = re.search(r'(^[ \t]*# 내 명함 공개 페이지[^\n]*\n)?^[ \t]*location \^~ /c/ \{', s, re.M)
if old:
    i = s.index('{', old.end() - 1); depth = 0
    while True:
        if s[i] == '{': depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    end = i + 1
    while end < len(s) and s[end] in ' \t': end += 1
    if s[end:end+1] == '\n': end += 1
    if s[end:end+1] == '\n': end += 1
    s = s[:old.start()] + s[end:]
m = re.search(r'^[ \t]*location / \{$', s, re.M)
s = s[:m.start()] + block + s[m.start():]
open(path, 'w').write(s)
PY
if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
  HOST=$(grep -m1 -oE 'server_name [^;]+' "$CONF" | awk '{print $2}')
  curl -sL -o /dev/null -D - "https://${HOST}/c/AAAAAAAAAAAAAAAAAAAAAA" | grep -iE '^HTTP|x-robots-tag'
else
  cp "$BAK" "$(readlink -f "$CONF")"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
