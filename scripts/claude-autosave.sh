#!/bin/bash
# PlanQ — Claude idle 자동 저장 (wip 커밋, push 안 함. 안전 우선)
#
# 두 경로에서 호출된다:
#   hook    : Claude Stop hook (Claude 살아있음). 마지막 커밋이 30분 넘었으면 커밋
#   deadman : cron 5분마다 (Claude 죽었거나 SSH 끊겼을 수 있음).
#             /tmp/.claude-last-activity 가 30분 이상 stale + git dirty 면 커밋
#
# 목적: 잠들거나 멈춰도, Claude 가 죽어도 작업이 날아가지 않는다.
# push 는 절대 하지 않는다 — 로컬 wip 스냅샷만 박제.
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"
export HOME="/home/irene"

MODE="${1:-deadman}"
REPO="${CLAUDE_AUTOSAVE_REPO:-/opt/planq}"
ACTIVITY_FILE="${CLAUDE_ACTIVITY_FILE:-/tmp/.claude-last-activity}"
THRESHOLD=1800   # 30분 (초)
NOW=$(date +%s)

cd "$REPO" 2>/dev/null || exit 0

# git dirty 아니면 저장할 것 없음
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  exit 0
fi

LAST_COMMIT=$(git log -1 --format=%ct 2>/dev/null || echo 0)
COMMIT_AGE=$(( NOW - LAST_COMMIT ))

case "$MODE" in
  hook)
    # Claude 활동 중 — 마지막 커밋이 30분 넘었을 때만 저장
    [ "$COMMIT_AGE" -lt "$THRESHOLD" ] && exit 0
    IDLE_SRC=$COMMIT_AGE
    ;;
  deadman)
    # cron — 활동 타임스탬프 기준. 파일 없으면 Claude 안 띄운 것 → skip
    [ -f "$ACTIVITY_FILE" ] || exit 0
    LAST_ACT=$(cat "$ACTIVITY_FILE" 2>/dev/null || echo "$NOW")
    ACT_AGE=$(( NOW - LAST_ACT ))
    # 아직 Claude 활동 중(30분 미만)이면 hook 이 처리 → skip
    [ "$ACT_AGE" -lt "$THRESHOLD" ] && exit 0
    IDLE_SRC=$ACT_AGE
    ;;
  *)
    exit 0
    ;;
esac

IDLE_MIN=$(( IDLE_SRC / 60 ))
TS=$(date '+%Y-%m-%d %H:%M')

git add -A >/dev/null 2>&1
git commit --no-verify \
  -m "wip: auto-save ${TS} (idle ${IDLE_MIN}m)" \
  -m "자동 저장 — 잠들거나 멈춰도 작업 보존 (mode: ${MODE}). push 안 함." \
  >/dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "[$(date '+%F %T')] auto-saved (mode=$MODE idle=${IDLE_MIN}m) -> $(git rev-parse --short HEAD)"
fi
exit 0
