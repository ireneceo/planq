#!/bin/bash
# PlanQ — 정찰 방 읽기 전용 가드 (PreToolUse · 2026-10-12 · 서버 방 요청, Fable 설계 판정 D)
#
# 상황판은 PlanQ 고치는 방이 일하는 동안 서버가 한가하면 대기열 다음 일을 «정찰 방» 이 미리 조사해
# /opt/planq/.claude/plans/q<번호>.md 를 쓰게 한다. 정찰 방은 **계획 파일만 쓴다** — 나머지 쓰기는 여기서 막는다.
#   · 상황판은 이 파일이 있고 settings.json 에 이 이름이 있어야만 정찰을 켠다(없으면 정찰 없음).
#   · 정찰 방이 아니면 아무것도 하지 않는다(stdout 없음 · exit 0). 판정은 scout-detect.sh 한 곳 + 방별 캐시.
#   · 정찰 방이면 무엇을 막는지는 scout-guard.js(명령 분석) — 막으면 deny + 이유.
#
# 막지 못하는 것(알고 둔다): 셸 명령 분석은 휴리스틱이다. 일부러 숨긴 쓰기(base64 로 감싼 명령 등)는
#   못 잡는다. 정찰 방은 상황판이 띄운 우리 쪽 방이고, 이 가드는 «실수로 고치는 방의 일을 건드리지 않게»
#   하는 장치다 — 적대적 실행자를 막는 샌드박스가 아니다.

INPUT=$(cat)
source "$(dirname "$0")/scout-detect.sh"
planq_is_scout "$INPUT" || exit 0

printf '%s' "$INPUT" | node "$(dirname "$0")/scout-guard.js"
exit 0
