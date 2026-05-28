#!/bin/bash
# PlanQ — Claude Stop hook
# 매 응답 끝마다 (1) 활동 타임스탬프 기록 (2) idle 30분 넘었으면 wip 자동 저장.
# dead-man-switch (cron deadman) 가 이 타임스탬프를 읽어 Claude 사망 후에도 작동.
#
# stdout 으로 아무것도 내보내지 않는다 (exit 0 = 정상 진행).

ACTIVITY_FILE="/tmp/.claude-last-activity"
LOG="/opt/planq/logs/claude-autosave.log"

# hook JSON stdin 은 소비만 (사용 안 함)
cat >/dev/null 2>&1

# 활동 타임스탬프 갱신 — cron deadman 의 기준점
date +%s > "$ACTIVITY_FILE" 2>/dev/null

# Claude 살아있는 동안의 idle 저장 (마지막 커밋 30분 초과 시 wip)
/opt/planq/scripts/claude-autosave.sh hook >> "$LOG" 2>&1

exit 0
