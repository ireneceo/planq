#!/bin/bash
# PlanQ — Fable 검증 게이트 Stop 훅 (Irene 지시 2026-07-21)
# 정책: 모든 구현 검증·테스트 검증은 무조건 Fable 이 수행 (CLAUDE.md '역할 분담').
#
# 동작: dev-backend/dev-frontend/q-note 에 미커밋 변경이 있는데
#       그 상태에 대한 Fable 게이트 통과 마커가 없으면 → 정지(완료)를 1회 차단하고
#       /fable-검증 실행을 요구한다.
#
# 무한 루프/대화 방해 방지: "지문(변경 상태 해시)" 단위로 딱 1회만 차단한다.
#   - 같은 변경 상태에서 두 번째 정지부터는 통과 (경고는 이미 전달됨).
#   - 코드가 더 바뀌면 지문이 바뀌어 다시 1회 경고.
#   - /fable-검증 통과로 마커가 기록되면 완전히 침묵.
#
# 마커:  /opt/planq/.claude/.fable-gate.json   (/fable-검증 통과 시 기록)
# 우회:  touch /opt/planq/.claude/.fable-gate-skip   (Irene 수동 통과)

cat >/dev/null 2>&1   # hook stdin 소비 (사용 안 함)

REPO=/opt/planq
MARKER="$REPO/.claude/.fable-gate.json"
SKIP="$REPO/.claude/.fable-gate-skip"
NAG="$REPO/.claude/.fable-gate.nag"

# 수동 우회 스위치
[ -f "$SKIP" ] && exit 0

# 소스 미커밋 변경 상태 (추적/미추적 모두)
CHANGED=$(git -C "$REPO" status --porcelain -- dev-backend dev-frontend q-note 2>/dev/null)

# 소스 변경 없음 → 통과 (일반 대화·문서 편집·커밋 완료 상태)
[ -z "$CHANGED" ] && exit 0

FP=$(printf '%s' "$CHANGED" | sha256sum | cut -d' ' -f1)

# 이 상태로 이미 Fable 게이트를 통과했으면 통과
if [ -f "$MARKER" ]; then
  SAVED=$(jq -r '.fingerprint // empty' "$MARKER" 2>/dev/null)
  [ "$SAVED" = "$FP" ] && exit 0
fi

# 이 상태로 이미 1회 경고했으면, 반복 차단하지 않고 통과 (대화 방해 방지)
if [ -f "$NAG" ] && [ "$(cat "$NAG" 2>/dev/null)" = "$FP" ]; then
  exit 0
fi

# 첫 감지 → 지문 기록 후 1회 차단
printf '%s' "$FP" > "$NAG"

REASON="🚦 Fable 검증 게이트 미통과 — 완료(정지) 금지.

dev-backend/dev-frontend/q-note 에 미커밋 소스 변경이 있는데 이 상태를 Fable 이 아직 검증하지 않았습니다. CLAUDE.md '역할 분담' 정책상 구현 검증·테스트 검증은 무조건 Fable(model:fable) 이 독립 수행해야 합니다. Opus 자체 검증만으로 완료 보고 금지.

지금 할 일:
  → /fable-검증  실행 (fable 서브에이전트로 ①diff범위 ②가드스크립트 ③실HTTP회귀 ④배포안전성 독립 검증 → 통과 시 마커 기록)

이 변경 상태로는 이 경고를 한 번만 표시합니다.
Irene 이 수동으로 넘기려면: touch $SKIP"

jq -n --arg r "$REASON" '{decision:"block", reason:$r}'
exit 0
