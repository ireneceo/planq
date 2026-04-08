#!/bin/bash
# PlanQ 프로젝트 안전 가드
# 1. POS 파일/DB/PM2 건드리기 차단
# 2. Nginx POS 설정 건드리기 차단
# 3. 배포 무단 실행 차단

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# ===== BASH 명령어 검증 =====
if [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

  # POS PM2 프로세스 건드리기 차단 (planq-dev-backend는 허용)
  if echo "$CMD" | grep -qE "pm2.*(restart|stop|delete|start).*dev-backend" && ! echo "$CMD" | grep -q "planq-dev-backend"; then
    deny "BLOCKED: POS PM2 프로세스(dev-backend)를 건드릴 수 없습니다. 이 창은 PlanQ 전용입니다."
  fi

  # POS DB 접근 차단
  if echo "$CMD" | grep -qi "purple_dev_db"; then
    deny "BLOCKED: POS DB(purple_dev_db)에 접근할 수 없습니다. 이 창은 PlanQ 전용입니다."
  fi

  # /var/www/ 경로 파일 수정 명령 차단 (읽기는 허용)
  if echo "$CMD" | grep -qE "(echo|tee|sed|cp|mv|rm).*(/var/www/(dev-backend|dev-frontend|production))"; then
    deny "BLOCKED: /var/www/ POS 파일을 수정할 수 없습니다. POS는 별도 창에서 작업하세요."
  fi

  # POS Nginx 설정 건드리기 차단
  if echo "$CMD" | grep -qE "(dev\.purplehere\.com)"; then
    if echo "$CMD" | grep -qE "(tee|sed|echo|cat.*>|mv|cp|rm)"; then
      deny "BLOCKED: POS Nginx 설정(dev.purplehere.com)을 수정할 수 없습니다."
    fi
  fi

  # node_modules/.cache 삭제 차단
  if echo "$CMD" | grep -qE "rm.*node_modules/.cache"; then
    deny "BLOCKED: node_modules/.cache 삭제 금지. 삭제하면 빌드가 오래 걸립니다."
  fi

  # 배포 스크립트 무단 실행 경고
  if echo "$CMD" | grep -qE "deploy.*production|deploy-to-production"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "운영 배포를 실행하려 합니다. Irene이 /배포 명령을 했는지 확인하세요."
      }
    }'
    exit 0
  fi
fi

# ===== 파일 수정 검증 =====
if [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

  # /var/www/dev-backend, dev-frontend 등 POS 파일 수정 차단
  if echo "$FILE_PATH" | grep -qE "^/var/www/(dev-backend|dev-frontend|production|CLAUDE\.md|DEVELOPMENT_PLAN\.md)"; then
    deny "BLOCKED: POS 파일을 수정할 수 없습니다. POS는 별도 창(/var/www/)에서 작업하세요."
  fi

  # POS Nginx 설정 파일 차단
  if echo "$FILE_PATH" | grep -q "dev.purplehere.com"; then
    deny "BLOCKED: POS Nginx 설정을 수정할 수 없습니다."
  fi
fi

exit 0
