#!/bin/bash
# 개발 서버(dev.planq.kr)만 «링크 → 앱 열기» 를 끈다 — AASA 를 빈 목록 파일로 바꿔 낸다 (2026-10-15).
#   sudo bash /opt/planq/scripts/apply-nginx-dev-aasa.sh
#
# 왜: 스토어의 옛 운영 앱(iOS 1.0)은 entitlements 에 applinks:dev.planq.kr 도 들고 있다. dev.planq.kr 의 AASA 가
#   운영과 같은 appID·같은 경로를 내니, 폰에서 dev 링크(상황판 «확인할 곳»)를 누르면 운영 앱이 가로채
#   **운영 서버의 같은 경로**를 연다. 앱 쪽 수정(cap-link-domains.js — 빌드별 도메인 하나)은 새 앱이 나가야 먹는다.
#   웹 쪽에서 막는 길은 dev 의 AASA 를 비우는 것뿐이다(애플 CDN 이 다시 읽으면 옛 앱도 dev 링크를 안 잡는다).
# ★ public/.well-known/ 의 파일은 고치지 않는다 — 운영 번들도 같은 파일을 싣는다(배포는 같은 소스의 사본에서 빌드).
#   그래서 dev nginx 가 **다른 파일**(scripts/dev-well-known/)을 가리키게 한다. 운영 nginx 는 손대지 않는다.
# 대가: Xcode 로 깐 dev 빌드도(같은 appID) dev 링크를 앱으로 못 연다 — 앱 안 이동·OAuth 복귀(planq://)는 그대로.
# 되돌리기: 출력의 백업 파일을 제자리에 복사 → nginx -t → systemctl reload nginx.
# assetlinks.json(안드로이드)은 그대로 둔다 — 작업기록 2026-10-15 참조(≤11 은 도메인 하나만 실패해도 운영 링크까지 막힌다).
set -e
CONF=${1:-/etc/nginx/sites-enabled/dev.planq.kr}
FILE=/opt/planq/scripts/dev-well-known/apple-app-site-association
BAK=/tmp/$(basename "$CONF").bak.$(date +%s)

[ "$(id -u)" = "0" ] || { echo "sudo 로 실행하세요: sudo bash $0 $*"; exit 1; }
[ -e "$CONF" ] || { echo "설정 파일 없음: $CONF"; exit 1; }
case "$(basename "$(readlink -f "$CONF")")" in dev.planq.kr) ;; *) echo "개발 서버 설정이 아닙니다($CONF) — 중단."; exit 1;; esac
[ -f "$FILE" ] || { echo "빈 AASA 파일 없음: $FILE"; exit 1; }
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['applinks']['details']==[]" "$FILE" \
  || { echo "빈 AASA 파일이 비어 있지 않거나 JSON 이 아닙니다 — 중단."; exit 1; }
if grep -q "dev-well-known/apple-app-site-association" "$CONF"; then echo "이미 들어가 있습니다. 할 일 없음."; exit 0; fi
N=$(grep -cE '^[[:space:]]*location = /\.well-known/apple-app-site-association \{$' "$CONF" || true)
[ "$N" = "1" ] || { echo "AASA location 이 ${N}개 — 하나가 아니라 중단. 아무것도 바꾸지 않았습니다."; exit 1; }

cp -L "$CONF" "$BAK"
# AASA location 안의 try_files 한 줄만 바꾼다(assetlinks 블록은 그대로).
sed -i --follow-symlinks -E "/^[[:space:]]*location = \/\.well-known\/apple-app-site-association \{\$/,/^[[:space:]]*\}/ s#^([[:space:]]*)try_files \\\$uri =404;#\1alias $FILE;#" "$CONF"
grep -q "alias $FILE;" "$CONF" || { cp "$BAK" "$(readlink -f "$CONF")"; echo "바꿀 줄을 못 찾음 → 원래대로. 아무것도 바뀌지 않았습니다."; exit 1; }
if nginx -t; then
  systemctl reload nginx
  echo "완료 — nginx 다시 읽음. (백업: $BAK)"
  curl -s https://dev.planq.kr/.well-known/apple-app-site-association
else
  cp "$BAK" "$(readlink -f "$CONF")"
  echo "문법 오류 → 원래대로 되돌림. 아무것도 바뀌지 않았습니다."
  exit 1
fi
