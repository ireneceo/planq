#!/bin/bash
# PlanQ — Claude Stop hook
# 매 응답 끝마다 (1) 활동 타임스탬프 기록 (2) idle 30분 넘었으면 wip 자동 저장.
# dead-man-switch (cron deadman) 가 이 타임스탬프를 읽어 Claude 사망 후에도 작동.
#
# stdout 으로 아무것도 내보내지 않는다 (exit 0 = 정상 진행).

ACTIVITY_FILE="/tmp/.claude-last-activity"
LOG="/opt/planq/logs/claude-autosave.log"

HOOK_INPUT=$(cat 2>/dev/null)   # hook stdin — 정찰 방 판정에만 쓴다

# 상황판 «정찰 방»(읽기 전용, 2026-10-12)은 여기서 바로 끝낸다 — 판정은 scout-detect.sh 한 곳.
#   정찰 방은 소스를 고치지 않는다. 그런데 이 훅은 작업 폴더 전체를 보므로, 그대로 두면 정찰 방이
#   **고치는 방의 미커밋 변경**으로 wip 자동 커밋을 하거나 활동 시각을 갱신한다(데드맨 스위치 기준이 흐려진다).
source "$(dirname "$0")/scout-detect.sh"
planq_is_scout "$HOOK_INPUT" && exit 0

# 활동 타임스탬프 갱신 — cron deadman 의 기준점
date +%s > "$ACTIVITY_FILE" 2>/dev/null

# Claude 살아있는 동안의 idle 저장 (마지막 커밋 30분 초과 시 wip)
/opt/planq/scripts/claude-autosave.sh hook >> "$LOG" 2>&1

exit 0
