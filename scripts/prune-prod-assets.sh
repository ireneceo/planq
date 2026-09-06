#!/usr/bin/env bash
# scripts/prune-prod-assets.sh — 운영 프론트 청크 정리 (기본 dry-run · 삭제 아닌 격리)
#
# ★ 왜 필요한가: 배포마다 해시가 바뀐 청크가 쌓인다. 2026-09-06 실측 36,761개 / 636MB
#   (2주치 · 현재 빌드는 480개). 지우지 않으면 계속 는다.
#
# ★ 왜 mtime 으로 지우면 안 되는가 (이 스크립트의 존재 이유):
#   내용이 안 바뀐 청크는 **해시가 같아 파일명이 그대로**다. 그 파일은 지금도 살아 있는데
#   오래돼 보일 수 있다. 나이만 보고 지우면 **살아 있는 청크를 지운다.**
#   그래서 "살아 있는 목록" 을 로컬 빌드 산출물에서 계산하고, 그 밖의 것만 후보로 둔다.
#
# ★ 왜 삭제가 아니라 격리(mv)인가: 같은 파일시스템이라 즉시·무비용이고 **되돌릴 수 있다.**
#   되돌릴 수 없는 작업으로 만들 이유가 없다. 확인 후 격리 폴더를 지우면 끝이다.
#
# 사용: scripts/prune-prod-assets.sh [--days N] [--apply] [--purge-quarantine 경로]
set -euo pipefail

PROD_HOST="${PROD_HOST:-irene@87.106.78.146}"
PROD_ASSETS="/opt/planq/frontend-build/assets"
LOCAL_ASSETS="/opt/planq/dev-frontend-build/assets"
DAYS=7
APPLY=0
PURGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --purge-quarantine) PURGE="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1"; exit 2 ;;
  esac
done

if [ -n "$PURGE" ]; then
  case "$PURGE" in /opt/planq/backups/stale-assets-*) ;; *) echo "❌ 격리 폴더만 지울 수 있다: $PURGE"; exit 2 ;; esac
  echo "격리 폴더 삭제: $PURGE"
  ssh "$PROD_HOST" "test -d '$PURGE' && du -sh '$PURGE' && rm -rf '$PURGE' && echo '삭제 완료'"
  exit 0
fi

[ -d "$LOCAL_ASSETS" ] || { echo "❌ 로컬 빌드가 없다: $LOCAL_ASSETS"; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ls -1 "$LOCAL_ASSETS" | sort > "$TMP/live.txt"
ssh "$PROD_HOST" "ls -1 $PROD_ASSETS" | sort > "$TMP/prod.txt"

MISSING=$(comm -23 "$TMP/live.txt" "$TMP/prod.txt" | wc -l)
if [ "$MISSING" -ne 0 ]; then
  # 로컬 빌드가 운영에 올라간 그것이 아니라는 뜻 — 살아있는 목록을 믿을 수 없다.
  echo "⛔ 중단 — 로컬 빌드의 파일 $MISSING 개가 운영에 없다. 배포부터 맞춰라."
  comm -23 "$TMP/live.txt" "$TMP/prod.txt" | head -5
  exit 1
fi
comm -13 "$TMP/live.txt" "$TMP/prod.txt" > "$TMP/stale.txt"

echo "살아있는 청크 $(wc -l < "$TMP/live.txt")개 (운영에 전부 존재) · 옛 청크 후보 $(wc -l < "$TMP/stale.txt")개"
echo "보존 기간 ${DAYS}일 — 그보다 새 것은 남긴다(오래 열어둔 탭·옛 서비스워커가 참조할 수 있다)."

scp -q "$TMP/stale.txt" "$PROD_HOST:/tmp/pp_stale.txt"
STAMP=$(date +%Y%m%d_%H%M%S)
QUAR="/opt/planq/backups/stale-assets-$STAMP"

ssh "$PROD_HOST" "
set -e
cd $PROD_ASSETS
N=0; S=0
: > /tmp/pp_targets.txt
while IFS= read -r f; do
  [ -e \"\$f\" ] || continue
  if [ -z \"\$(find \"\$f\" -maxdepth 0 -mtime -$DAYS)\" ]; then
    echo \"\$f\" >> /tmp/pp_targets.txt
    N=\$((N+1)); S=\$((S+\$(stat -c%s \"\$f\")))
  fi
done < /tmp/pp_stale.txt
echo \"  대상 \$N개 · \$((S/1024/1024))MB\"
if [ $APPLY -eq 1 ] && [ \$N -gt 0 ]; then
  mkdir -p $QUAR
  xargs -a /tmp/pp_targets.txt -d '\n' -r mv -t $QUAR
  echo \"  격리 완료 → $QUAR (\$(du -sh $QUAR | cut -f1))\"
  echo \"  되돌리기: mv $QUAR/* $PROD_ASSETS/\"
elif [ $APPLY -eq 0 ]; then
  echo '  (dry-run — 실제로 옮기려면 --apply)'
fi
rm -f /tmp/pp_stale.txt /tmp/pp_targets.txt
"
