#!/bin/bash
# 공유 링크 미리보기(OG) — 미리보기 봇(카카오·페이스북·슬랙…)의 요청을 **모든 경로**에서 백엔드로 넘긴다 (2026-10-30).
#   sudo bash /opt/planq/scripts/apply-nginx-share-bot.sh /etc/nginx/sites-enabled/planq.kr 3004   # 운영
#
# 왜: 운영 nginx 는 `/insights/:slug · /public/posts/:t · /public/docs/:t` 세 경로만 백엔드로 넘겼다(docs/OG_PREVIEW_NGINX_PROD.md).
#   그래서 /public/files·/public/folders·/public/tasks·/sign·/c … 공유 링크는 봇에게 index.html 의 고정 홍보 문구가 나갔다
#   (2026-10-30 실측: 카카오 UA 로 /public/files/<토큰> → «PlanQ — 일이 일이 되지 않게» + 메인 썸네일).
#   개발서버는 이미 이 방식이다(conf.d/planq-share-bot.conf 의 map + `location /` 안 if) — 같은 모양으로 맞춘다.
#   백엔드 middleware/ogMeta.js 가 경로별 제목·이미지를 만들고, 공유 경로가 아니면 기본 OG 를 준다. 사람 요청은 그대로 정적 파일.
# 하는 일: ① http 단계 map(봇 UA → $planq_share_bot) 파일이 없으면 만든다 ② `location / {` 와 `location ^~ /c/ {` 맨 앞에
#   `if ($planq_share_bot) { proxy_pass …; break; }` 를 넣는다(이미 있으면 건너뜀) ③ nginx -t 통과 때만 reload, 실패면 되돌림.
# 되돌리기: 출력의 백업 파일을 제자리에 복사 → nginx -t → systemctl reload nginx (map 파일은 남겨도 무해 — 쓰는 곳이 없으면 아무 일 안 함).
set -e
CONF=${1:-/etc/nginx/sites-enabled/dev.planq.kr}
PORT=${2:-3003}
MAP=/etc/nginx/conf.d/planq-share-bot.conf
BAK=/tmp/$(basename "$CONF").bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0 $*"; exit 1; }
[ -e "$CONF" ] || { echo "설정 파일 없음: $CONF"; exit 1; }
grep -qE '^[[:space:]]*location / \{$' "$CONF" || { echo "location / 를 못 찾음 — 중단. 아무것도 바꾸지 않았습니다."; exit 1; }

MAP_NEW=0
if ! grep -rqs 'map \$http_user_agent \$planq_share_bot' /etc/nginx/conf.d/ /etc/nginx/nginx.conf; then
  # 목록은 개발서버 conf.d/planq-share-bot.conf 와 같다. bare 'KakaoTalk' 금지 — 인앱 브라우저(실사용자)가 잡힌다(#189).
  cat > "$MAP" <<'NGX'
# share bot UA 감지 — SNS 공유 시 backend 의 ogMetaMiddleware 로 proxy (페이지별 OG meta 동적)
# scripts/apply-nginx-share-bot.sh (2026-10-30) — 개발서버와 같은 목록
map $http_user_agent $planq_share_bot {
    default 0;
    "~*facebookexternalhit"   1;
    "~*Facebot"               1;
    "~*Twitterbot"            1;
    "~*LinkedInBot"           1;
    "~*Slackbot"              1;
    "~*SkypeUriPreview"       1;
    "~*TelegramBot"           1;
    "~*WhatsApp"              1;
    "~*Kakaotalk-scrap"       1;
    "~*Discordbot"            1;
    "~*Pinterest"             1;
    "~*Embedly"               1;
    "~*Applebot"              1;
    "~*Mastodon"              1;
    "~*redditbot"             1;
}
NGX
  MAP_NEW=1
fi

cp -L "$CONF" "$BAK"
python3 - "$(readlink -f "$CONF")" "$PORT" <<'PY'
import sys, re
path, port = sys.argv[1], sys.argv[2]
s = open(path).read()
snippet = ("        # 공유 링크 미리보기 봇 → 백엔드 ogMeta (scripts/apply-nginx-share-bot.sh)\n"
           "        if ($planq_share_bot) {\n"
           f"            proxy_pass http://127.0.0.1:{port};\n"
           "            break;\n"
           "        }\n")
def body_of(m):
    i = s.index('{', m.end() - 1); depth = 0; j = i
    while True:
        if s[j] == '{': depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0: return i, j
        j += 1
changed = 0
for pat in (r'^[ \t]*location / \{$', r'^[ \t]*location \^~ /c/ \{$'):
    m = re.search(pat, s, re.M)
    if not m: continue
    i, j = body_of(m)
    if 'planq_share_bot' in s[i:j]: continue
    s = s[:i + 1] + '\n' + snippet + s[i + 1:].lstrip('\n')
    changed += 1
open(path, 'w').write(s)
print(f"블록 {changed}곳에 넣음")
PY

if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
  HOST=$(grep -m1 -oE 'server_name [^;]+' "$CONF" | awk '{print $2}')
  # 봇 UA 로 없는 파일 토큰 → 백엔드가 만든 HTML 은 들여쓰기 없는 `<meta property="og:title" content=...>` 이다(정적 index.html 은 4칸 들여쓰기).
  if curl -s -A 'Kakaotalk-scrap/1.0' "https://${HOST}/public/files/AAAAAAAAAAAAAAAAAAAAAAAA" | grep -q '^<meta property="og:title"'; then
    echo "확인: 봇 요청이 백엔드로 갑니다 ✓"
  else
    echo "⚠ 봇 요청이 아직 정적 파일로 갑니다 — 설정을 확인하세요(백업으로 되돌릴 수 있음: $BAK)"
  fi
  curl -s -o /dev/null -w "사람 요청: %{http_code}\n" "https://${HOST}/public/files/AAAAAAAAAAAAAAAAAAAAAAAA"
else
  cp "$BAK" "$(readlink -f "$CONF")"
  [ "$MAP_NEW" = 1 ] && rm -f "$MAP"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
