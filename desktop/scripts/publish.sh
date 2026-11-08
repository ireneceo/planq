#!/usr/bin/env bash
# PlanQ 데스크탑 앱 게시 — 만든 설치 파일·자동 업데이트 목록을 운영 https://planq.kr/desktop/ 에 올린다.
#   docs/DESKTOP_APP_DESIGN.md §3-8. **웹 /배포 와 분리** — 껍데기 버전이 바뀐 때만, Irene 지시가 있을 때만 사람이 돌린다.
#
#   사용: desktop/scripts/publish.sh [--dry-run] <산출물 폴더> [<산출물 폴더> …]
#     예) 윈도우(이 서버에서 만든 것)  desktop/scripts/publish.sh desktop/dist/prod
#         맥(codemagic desktop-mac 산출물을 받아 푼 폴더)도 같은 명령에 이어 붙인다.
#
#   지키는 것:
#     ① 운영 출처(https://planq.kr)로 만든 것만 올린다 — app.asar 의 src/origin.json 을 check.js 로 읽어 본다(시험 표면 0 도 같이).
#     ② 설치 파일을 **먼저**, 목록(latest*.yml)을 **나중에** 올린다 — 목록이 먼저 바뀌면 받을 파일이 없는 업데이트를 알린다.
#     ③ 옛 설치 파일은 지우지 않는다(이미 받던 사람이 이어 받는다). 지우는 것은 사람이 따로.
#   앞선 조건(Irene 할 일): 운영 nginx 의 /desktop/ → /opt/planq/desktop-releases/ 정적 위치.
set -euo pipefail

PROD_HOST="irene@87.106.78.146"          # scripts/deploy-planq.sh 와 같은 값
REMOTE_DIR="/opt/planq/desktop-releases"
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
[ "$#" -ge 1 ] || { echo "usage: $0 [--dry-run] <dist 폴더>…"; exit 2; }

FILES=(); LISTS=()
for d in "$@"; do
  [ -d "$d" ] || { echo "✗ 폴더 없음: $d"; exit 2; }
  # ① 출처·시험 표면 — check.js 가 출처를 찍는다. 운영이 아니면 멈춘다.
  out="$(node "$HERE/scripts/check.js" win "$d" 2>&1)" || { echo "$out"; echo "✗ 패키지 검사 실패: $d"; exit 1; }
  echo "$out" | grep -q "출처 https://planq.kr " || { echo "$out"; echo "✗ 운영 출처로 만든 것이 아니다: $d"; exit 1; }
  while IFS= read -r f; do FILES+=("$f"); done < <(find "$d" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' \))
  while IFS= read -r f; do LISTS+=("$f"); done < <(find "$d" -maxdepth 1 -type f -name 'latest*.yml')
done
[ "${#FILES[@]}" -gt 0 ] || { echo "✗ 올릴 설치 파일이 없다"; exit 1; }
[ "${#LISTS[@]}" -gt 0 ] || { echo "✗ 자동 업데이트 목록(latest*.yml)이 없다"; exit 1; }

echo "올릴 설치 파일 ${#FILES[@]}개 · 목록 ${#LISTS[@]}개 → $PROD_HOST:$REMOTE_DIR"
printf '  %s\n' "${FILES[@]}" "${LISTS[@]}"
if [ "$DRY" = 1 ]; then echo "(--dry-run — 올리지 않았다)"; exit 0; fi

ssh $SSH_OPTS "$PROD_HOST" "test -d '$REMOTE_DIR'" || { echo "✗ 운영에 $REMOTE_DIR 가 없다 — Irene 할 일(nginx /desktop/ + 폴더) 먼저"; exit 1; }
# ② 설치 파일 먼저, 목록 나중
rsync -av -e "ssh $SSH_OPTS" "${FILES[@]}" "$PROD_HOST:$REMOTE_DIR/"
rsync -av -e "ssh $SSH_OPTS" "${LISTS[@]}" "$PROD_HOST:$REMOTE_DIR/"
for l in "${LISTS[@]}"; do
  n="$(basename "$l")"
  # ★ 200 만 보면 거짓 통과한다 — nginx /desktop/ 이 없으면 SPA 폴백이 index.html 을 200 으로 준다(Fable 2026-11-08 실측).
  #   올린 목록과 **같은 version 줄**이 공개 주소 본문에 있는지 본다.
  want="$(grep -m1 '^version:' "$l")"
  got="$(curl -s "https://planq.kr/desktop/$n" | grep -m1 '^version:' || true)"
  echo "  https://planq.kr/desktop/$n → ${got:-(목록 아님)}"
  [ -n "$want" ] && [ "$got" = "$want" ] || { echo "✗ 공개 주소에서 올린 목록이 안 보인다(nginx /desktop/ 확인) — 기대 «$want»"; exit 1; }
done
echo "✓ 게시 완료"
