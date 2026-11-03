#!/usr/bin/env bash
# build-gate.sh — dev 프론트 빌드(npm run build)가 시작해도 되는지 기다린다 (2026-11-03)
#
#   왜: 11-03 07:51 방 710720df 와 07:55 방 9f4c20b5 가 `npm run build`(tsc 6GB·vite 4GB 힙 상한)를 동시에 돌려
#     남은 메모리 3.7GB→200MB · 스왑 99% → 07:57 서버 바깥 통신 0(dev 전부 Cloudflare 522) → 08:02 재부팅.
#     11-01 밤 7시간 53분 끊김도 같은 모양. prebuild 는 운영 배포(deploy-busy.sh)만 기다리고
#     서버 공용 메모리 게이트(/var/www/scripts/heavy-task-gate.sh)를 거치지 않았다.
#   무엇을 기다리나 (차례대로, 우회 없음 — SKIP 변수·강제 옵션을 두지 않는다):
#     ① 운영 배포가 도는 중이면 끝날 때까지 (deploy-busy.sh, 최대 90분)
#     ② 다른 PlanQ dev 빌드가 도는 중이면 끝날 때까지 — 아래 «자리 표시» 로 본다.
#        공용 게이트는 «1.5GB 넘게 쓰는 node» 로 판정하는데 tsc 가 그만큼 차오르기 전 몇십 초 사이에
#        두 번째 빌드가 들어오면 둘 다 통과한다. 그래서 자리를 잡고(flock 안에서) 들어간다.
#     ③ 서버 공용 게이트가 열릴 때까지 (다른 제품 빌드·에뮬레이터·남은 메모리) — 30초마다, 최대 30분.
#        deploy-planq.sh wait_heavy_gate 와 같은 방식.
#   배포 스크립트 안의 빌드(PLANQ_DEPLOY_PIN)는 이걸 부르지 않는다 — 배포가 스스로 게이트를 기다린다(두 번 기다리지 않음).
#
#   자리 표시: logs/frontend-build.owner = 지금 빌드 중인 `npm run build` 프로세스 번호.
#     그 npm 이 끝나면(번호가 죽었거나 다른 프로그램이면) 자리는 저절로 빈다 — 빌드가 강제 종료돼도 남지 않는다.
#   종료: 0 = 시작해도 됨 · 1 = 30분 동안 안 열림(빌드하지 않음) · 2 = 운영 배포가 90분 안에 안 끝남
set -u
ROOT=/opt/planq
GATE=${HEAVY_GATE:-/var/www/scripts/heavy-task-gate.sh}
OWNER=$ROOT/logs/frontend-build.owner
LOCK=$ROOT/logs/frontend-build.flock
MAX=${BUILD_GATE_MAX:-1800}
STEP=${BUILD_GATE_STEP:-30}
WHO=${1:-dev-build}

# ① 운영 배포
bash "$ROOT/scripts/deploy-busy.sh" --wait 5400 "$WHO" || exit 2

# 이 빌드를 돌리는 `npm run build` 프로세스 번호 — 부모를 거슬러 올라가 찾는다.
cmd_of() { { tr '\0' ' ' < "/proc/$1/cmdline"; } 2>/dev/null; }
is_npm_build() { cmd_of "$1" | grep -qE '(^|/| )npm(-cli\.js)?( .*)? (run|run-script) build( |$)'; }
MY_NPM=""
p=$PPID
for _ in 1 2 3 4 5 6; do
  [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null || break
  if is_npm_build "$p"; then MY_NPM=$p; break; fi
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " ")
done

owner_alive() {   # 다른 빌드가 자리를 잡고 있으면 그 번호를 출력하고 0
  local o
  o=$(cat "$OWNER" 2>/dev/null) || return 1
  case "$o" in ''|*[!0-9]*) return 1 ;; esac
  [ "$o" = "$MY_NPM" ] && return 1
  is_npm_build "$o" || return 1
  echo "$o"
}

mkdir -p "$ROOT/logs"
waited=0
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
while :; do
  reason=""
  exec 9>"$LOCK"
  flock -x 9
  if o=$(owner_alive); then
    reason="다른 PlanQ 프론트 빌드가 도는 중 (npm pid $o: $(cmd_of "$o" | cut -c1-60)) — 두 빌드가 겹치면 서버가 멈춘다"
  elif [ -x "$GATE" ] && ! env -u SKIP_MEMGATE "$GATE" build > "$OUT" 2>&1; then   # SKIP_MEMGATE 로 넘기지 않는다
    reason=$(sed 's/^/     /' "$OUT")
  else
    # 열림 — 자리를 잡는다(npm 번호를 못 찾았으면 표시 없이 공용 게이트에만 맡긴다)
    [ -n "$MY_NPM" ] && echo "$MY_NPM" > "$OWNER"
    flock -u 9; exec 9>&-
    [ $waited -gt 0 ] && echo "[build-gate] $WHO — 열림 (${waited}초 기다림)" >&2
    exit 0
  fi
  flock -u 9; exec 9>&-
  if [ $waited -eq 0 ]; then
    echo "[build-gate] $WHO — 빌드를 기다린다(${STEP}초마다 다시 봄, 최대 ${MAX}초). 막는 것:" >&2
    echo "$reason" >&2
  fi
  if [ $waited -ge "$MAX" ]; then
    echo "[build-gate] $WHO — ${MAX}초 기다렸는데 안 열림 → 빌드하지 않는다(우회하지 말 것). 막는 것:" >&2
    echo "$reason" >&2
    exit 1
  fi
  sleep "$STEP"; waited=$((waited + STEP))
done
