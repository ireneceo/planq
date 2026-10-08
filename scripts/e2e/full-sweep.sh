#!/usr/bin/env bash
# full-sweep.sh — 등록된 검사(run.js SUITES) **전부**를 하나씩 돌린다 (2026-10-07).
#
#   왜: 검사는 125개가 넘게 있는데, 평소에는 «이번에 고친 곳» 검사만 돌렸다(/검증 필수는 tenant,toggles 둘뿐).
#     그래서 A 를 고치다 B 화면이 깨지면 B 검사는 아무도 안 돌려 사용자가 먼저 만났다.
#     매일 밤 순찰(patrol)도 버튼만 누르고 기능 검사는 안 돌렸다.
#   어떻게: 스위트마다 따로 프로세스(한 스위트가 죽어도 다음이 돈다) · 시작 전 메모리 여유를 기다린다 ·
#     순찰과 같은 잠금을 써서 둘이 겹치지 않는다 · 상태를 바꾸는 스위트(toggles)는 맨 뒤.
#   결과: logs/sweep/<날짜>/<스위트>.log + summary.md(사람이 읽는 표) + summary.json(상황판·개발시작이 읽는다)
#
#   사용: scripts/e2e/full-sweep.sh              # 전부
#         SWEEP_ONLY=mobile,tabs scripts/e2e/full-sweep.sh
#         SWEEP_SKIP=gdrivesync scripts/e2e/full-sweep.sh
set -o pipefail
cd /opt/planq || exit 1
D=${SWEEP_DATE:-$(date -u +%F)}
OUT=logs/sweep/$D
mkdir -p "$OUT"
LOCK=/opt/planq/logs/patrol/patrol-lock.log
mkdir -p logs/patrol
exec 9>"$LOCK"
# 순찰이 돌고 있으면 끝날 때까지 기다린다(겹치면 둘 다 메모리 부족으로 죽는다)
flock 9

ALL=$(node -e "
const src=require('fs').readFileSync('scripts/e2e/run.js','utf8');
const body=src.slice(src.indexOf('const SUITES = {'), src.indexOf('};', src.indexOf('const SUITES = {')));
const keys=[...body.matchAll(/^\s+([a-z0-9]+):\s*\(\)\s*=>/gm)].map(m=>m[1]);
console.log(keys.join(' '));")
LAST="toggles"           # 플랫폼 설정을 잠깐 뒤집는다 — 맨 뒤
EXCLUDE=" patrol "       # 순찰은 매일 밤 따로 돈다
SKIP=" ${SWEEP_SKIP//,/ } "
if [ -n "$SWEEP_ONLY" ]; then LIST=${SWEEP_ONLY//,/ }; else
  LIST=""
  for k in $ALL; do
    case "$EXCLUDE$SKIP" in *" $k "*) continue;; esac
    [ "$k" = "$LAST" ] && continue
    LIST="$LIST $k"
  done
  case "$SKIP" in *" $LAST "*) ;; *) LIST="$LIST $LAST";; esac
fi

wait_mem() {   # 쓸 수 있는 메모리가 1.6GB 넘을 때까지 (최대 20분)
  for _ in $(seq 1 120); do
    a=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    [ "$a" -ge 1600 ] && return 0
    sleep 10
  done
  return 1
}

: > "$OUT/progress.txt"
for k in $LIST; do
  wait_mem || echo "$k mem-wait-timeout" >> "$OUT/progress.txt"
  t0=$(date +%s)
  timeout ${SWEEP_TIMEOUT:-1200} node scripts/e2e/run.js --suite "$k" > "$OUT/$k.log" 2>&1
  rc=$?
  t1=$(date +%s)
  tf=$(grep -a '총 실패' "$OUT/$k.log" | tail -1 | grep -oE '[0-9]+' | head -1)
  echo "$k rc=$rc fail=${tf:-?} sec=$((t1-t0))" >> "$OUT/progress.txt"
done

node scripts/e2e/sweep-summary.js "$OUT" > /dev/null 2>&1
echo "$(date -u +%FT%TZ) sweep $D done $(wc -l < "$OUT/progress.txt") suites" >> logs/sweep/cron.log
exit 0
