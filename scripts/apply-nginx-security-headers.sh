#!/bin/bash
# apply-nginx-security-headers.sh — 앱 화면(HTML)에 보안 헤더 적용 (2026-09-02 보안감사 H-1)
#
# 문제: 백엔드 helmet 은 /api/ 응답에만 붙고, 화면은 nginx 가 직접 서빙해서
#       CSP·X-Frame-Options·HSTS 가 **하나도 없다** → 클릭재킹 열림 + XSS 완화 0.
#
# ★ 함정 (실측): `add_header` 는 **하위 블록에서 하나라도 쓰면 상위 것이 전부 사라진다.**
#   server 블록 맨 위에 넣는 것만으로는 0개가 나온다 —
#     · dev  : `location /` 가 Cache-Control 3개를 add_header 로 붙인다
#     · 운영 : `/talk` 은 try_files 로 /index.html 이 되어 `location ~* \.html$`(add_header 보유)에 걸린다
#   그래서 **snippet 하나를 만들고, add_header 를 쓰는 모든 정적 블록에 include 한다.**
#   프록시 블록(/api/ · /socket.io/ · /qnote/)은 건드리지 않는다 — 거기는 helmet 이 붙인다.
#
# 사용 (root 필요):
#   sudo /opt/planq/scripts/apply-nginx-security-headers.sh dev
#   sudo /opt/planq/scripts/apply-nginx-security-headers.sh prod
#
# 안전장치: 백업 → 수정 → `nginx -t` 실패 시 자동 원복 → 성공해야 reload → 실측 검증 실패 시 **자동 원복**.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  dev)  CONF=/etc/nginx/sites-enabled/dev.planq.kr; HOST=https://dev.planq.kr ;;
  prod) CONF=/etc/nginx/sites-enabled/planq.kr;     HOST=https://planq.kr ;;
  *) echo "사용: sudo $0 {dev|prod}"; exit 1 ;;
esac

# 리허설 훅 — 실제 운영에서는 아무것도 바뀌지 않는다(기본값이 실경로·실명령).
#   손대기 전에 사본으로 전 과정을 한 번 돌려보기 위한 것 (샌드박스 nginx 를 고포트로 띄워 리허설).
CONF="${PLANQ_NGINX_CONF:-$CONF}"
HOST="${PLANQ_NGINX_HOST:-$HOST}"
NGINX_BIN="${PLANQ_NGINX_BIN:-nginx}"
RELOAD_CMD="${PLANQ_NGINX_RELOAD:-systemctl reload nginx}"

if [ "${PLANQ_NGINX_REHEARSAL:-0}" != "1" ]; then
  [ "$(id -u)" = "0" ] || { echo "✗ root 권한이 필요합니다:  sudo $0 $TARGET"; exit 1; }
fi
[ -f "$CONF" ] || { echo "✗ 설정 파일 없음: $CONF"; exit 1; }

SNIPPET_DIR="${PLANQ_NGINX_SNIPPET_DIR:-/etc/nginx/snippets}"
SNIPPET="$SNIPPET_DIR/planq-security-headers.conf"
INCLUDE_LINE="include snippets/planq-security-headers.conf;"

# ── 1) snippet (두 호스트 공용 단일 원천) ────────────────────────────────────
# CSP 는 **실제 코드가 무엇을 부르는지 실측해서** 정했다 (2026-09-02):
#   script-src 'self'      — 빌드 index.html 에 인라인 스크립트 0개(실측). unsafe-inline 불필요
#   frame-src  'self' blob: data:
#                          — PDF 미리보기가 blob: iframe (utils/download.ts:133),
#                            메일 본문이 srcDoc iframe. 'none' 이면 둘 다 죽는다
#   media-src  'self' blob: data:
#                          — 음성·영상 미리보기가 blob:/서명 URL
#   img-src    ... https:  — 메일 본문(sandbox iframe 이 부모 정책을 상속)의 원격 이미지
#   style-src  'unsafe-inline'
#                          — styled-components 가 런타임에 <style> 을 주입한다 (제거 불가)
#   frame-ancestors 'self' — 클릭재킹 차단 (X-Frame-Options 의 최신 대체재)
# ★ 이 값은 dev-backend/middleware/security.js 의 cspMiddleware 와 **같은 값**으로 유지한다.
mkdir -p "$SNIPPET_DIR"
cat > "$SNIPPET" <<'EOF'
# PlanQ 앱 화면(HTML·정적) 보안 헤더 — scripts/apply-nginx-security-headers.sh 가 관리한다.
#   ★ add_header 는 블록마다 상속이 끊긴다. 새 location 을 만들면 이 include 도 같이 넣을 것.
#   ★ CSP 값은 dev-backend/middleware/security.js 의 cspMiddleware 와 동일하게 유지한다.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' blob: https: wss:; frame-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
EOF
echo "snippet: $SNIPPET"

# ── 2) 백업 ──────────────────────────────────────────────────────────────────
# ★ 백업을 sites-enabled/ 안에 두지 말 것 — nginx.conf 가 `include sites-enabled/*` 라
#   확장자와 무관하게 **백업까지 설정으로 읽는다.** 그러면 server 블록이 두 벌이 되어
#   `duplicate listen options` 로 nginx -t 가 깨지고, 원인이 우리 수정인 것처럼 보인다.
#   (2026-09-02 실측 — 실패한 건 수정이 아니라 백업 위치였다. 게다가 원복 후에도 백업이
#    남아 **다음 reload·재부팅에서 nginx 가 안 뜨는** 상태가 된다.)
BAKDIR="${PLANQ_NGINX_BAKDIR:-/var/backups/planq-nginx}"
mkdir -p "$BAKDIR"
STAMP=$(date +%Y%m%d_%H%M%S)
BAK="$BAKDIR/$(basename "$CONF").bak-${STAMP}"

# 옛 실행이 남긴 백업이 sites-enabled 안에 있으면 그것부터 치운다 (있으면 nginx -t 가 무조건 깨진다).
STRAY=$(find "$(dirname "$CONF")" -maxdepth 1 -name '*.bak-*' 2>/dev/null || true)
if [ -n "$STRAY" ]; then
  echo "⚠️  sites-enabled 안의 옛 백업을 $BAKDIR 로 옮깁니다 (설정으로 읽히고 있었습니다):"
  echo "$STRAY" | sed 's/^/    /'
  echo "$STRAY" | xargs -r -I{} mv {} "$BAKDIR/"
fi

# ★ 손대기 **전에** 초록불을 확인한다 — 원래 깨져 있었다면 우리 수정을 범인으로 오해한다.
echo "== 기준선 확인 (수정 전 nginx -t) =="
if ! $NGINX_BIN -t; then
  echo "✗ 수정 전부터 nginx 설정이 깨져 있습니다 — 그것부터 고쳐야 합니다 (이 스크립트는 아무것도 안 바꿨습니다)"
  exit 1
fi

cp "$CONF" "$BAK"
echo "백업: $BAK"

# ── 3) add_header 를 쓰는 정적 location 에 include 삽입 ──────────────────────
python3 - "$CONF" "$INCLUDE_LINE" <<'PYEOF'
import re, sys

path, include_line = sys.argv[1], sys.argv[2]
src = open(path).read()

# location 블록을 중괄호로 세어 잘라낸다 (nginx 는 문자열 안 중괄호를 거의 안 쓴다).
def blocks(text):
    for m in re.finditer(r'^([ \t]*)location\s+([^\{]*?)\s*\{', text, re.M):
        depth, i = 0, m.end() - 1
        while i < len(text):
            if text[i] == '{': depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    yield m, m.end(), i, m.group(1), m.group(2).strip()
                    break
            i += 1

patched, skipped, already = [], [], []
edits = []  # (insert_at, text)
for m, body_start, body_end, indent, loc in blocks(src):
    body = src[body_start:body_end]
    if include_line in body:
        already.append(loc); continue
    is_root = loc in ('/', '= /')
    has_add_header = re.search(r'^\s*add_header\b', body, re.M) is not None
    has_proxy = re.search(r'^\s*proxy_pass\b', body, re.M) is not None
    # 프록시 블록은 백엔드 helmet 이 붙인다 — 건드리지 않는다.
    # 단, SPA 루트(`location /`)는 조건부 proxy_pass(share bot)가 있어도 반드시 붙인다.
    if has_proxy and not is_root:
        skipped.append((loc, 'proxy')); continue
    if not (has_add_header or is_root):
        skipped.append((loc, 'add_header 없음 — 상위 상속 유지')); continue
    single_line = '\n' not in body
    ins = f' {include_line}' if single_line else f'\n{indent}    {include_line}'
    edits.append((body_start, ins))
    patched.append(loc)

for at, text in sorted(edits, reverse=True):
    src = src[:at] + text + src[at:]
open(path, 'w').write(src)

for l in patched: print(f'  + {l}')
for l in already: print(f'  = {l} (이미 있음)')
for l, why in skipped: print(f'  - {l} ({why})')
if not patched and not already:
    print('✗ 삽입 대상 location 을 하나도 못 찾았습니다'); sys.exit(1)
PYEOF

# ── 4) 문법 검사 (실패 시 원복) ──────────────────────────────────────────────
echo "== nginx 문법 검사 =="
if ! $NGINX_BIN -t; then
  cp "$BAK" "$CONF"
  echo "✗ 문법 오류 — 원복했습니다 (변경 없음)"
  exit 1
fi

$RELOAD_CMD
sleep 1

# ── 5) 실측 검증 (실패 시 원복) ──────────────────────────────────────────────
# 화면·정적·SPA 라우트를 각각 찌른다 — 한 곳이라도 0 이면 다른 location 이 가리고 있는 것.
echo "== 실측 검증 =="
ASSET=$(curl -sS "$HOST/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true)
FAIL=0
check() { # $1=경로 설명  $2=URL
  local n
  n=$(curl -sSI "$2" | grep -icE '^(content-security-policy|x-frame-options|strict-transport-security|x-content-type-options):' || true)
  printf '  %-28s %s → 보안 헤더 %s/4\n' "$1" "$2" "$n"
  [ "$n" -ge 4 ] || FAIL=1
}
check "SPA 라우트(HTML)" "$HOST/talk"
check "루트(HTML)"       "$HOST/"
[ -n "$ASSET" ] && check "번들 JS" "$HOST$ASSET"
check "manifest"        "$HOST/manifest.json"
check "service worker"  "$HOST/sw.js"

if [ "$FAIL" = "0" ]; then
  echo "✅ 적용 완료 — 원복이 필요하면:  sudo cp $BAK $CONF && sudo nginx -t && sudo systemctl reload nginx"
else
  cp "$BAK" "$CONF"; $NGINX_BIN -t >/dev/null && $RELOAD_CMD
  echo "✗ 헤더가 붙지 않은 경로가 있어 **원복했습니다** (변경 없음). 위 표에서 0 인 줄의 location 을 확인하세요."
  exit 1
fi
