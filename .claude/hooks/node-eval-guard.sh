#!/bin/bash
# PlanQ — 끝나지 않는 `node -e "require('./…')"` 확인 막기 (PreToolUse Bash · 2026-11-11)
#   왜: 서버 방 11-11 — dev-backend 의 라우트·모델·서비스를 require 하면 DB 풀·타이머가 이벤트 루프를 붙잡아
#     node 가 스스로 끝나지 않는다. 명령 창이 시간 초과로 놓아도 프로세스는 남아 1~5일씩 메모리를 썼다(4개).
#   하는 일: 명령에 `node -e`/`node --eval` + 로컬 require(`require('./`·`require("./`·`require('../`) 가 있는데
#     `process.exit` 도 `timeout ` 도 없으면 막고, 고칠 방법을 알려 준다. 그 밖에는 아무것도 안 한다(stdout 없음 · exit 0).
#   남은 것 치우기: scripts/reap-orphans.js (e2e 시작마다 · 1시간 넘은 node -e).
CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
printf '%s' "$CMD" | grep -qE "(^|[[:space:];&|(])node[[:space:]]+(-e|--eval|-p)[[:space:]]+[\"']" || exit 0  # 따옴표 인자까지 — 글 속 «node -e» 낱말은 안 잡는다
printf '%s' "$CMD" | grep -qE "require\([\"'](\./|\.\./)" || exit 0
printf '%s' "$CMD" | grep -qE 'process\.exit|(^|[[:space:];&|(])timeout[[:space:]]' && exit 0
REASON="이 node -e 는 dev-backend 모듈을 require 해서 DB 풀·타이머 때문에 스스로 끝나지 않는다(11-11 고아 4개 · 1~5일). 같은 명령 앞에 'timeout 60 ' 을 붙이거나 끝에 ';process.exit(0)' 를 넣어 다시 실행할 것."
jq -n --arg r "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
