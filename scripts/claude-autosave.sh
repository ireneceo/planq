#!/bin/bash
# PlanQ — Claude idle 자동 저장 (스냅샷 전용. push 안 함, 브랜치 히스토리 안 건드림)
#
# 두 경로에서 호출된다:
#   hook    : Claude Stop hook (Claude 살아있음). 마지막 스냅샷이 30분 넘었으면 저장
#   deadman : cron 5분마다 (Claude 죽었거나 SSH 끊겼을 수 있음).
#             /tmp/.claude-last-activity 가 30분 이상 stale + git dirty 면 저장
#
# 목적: 잠들거나 멈춰도, Claude 가 죽어도 작업이 날아가지 않는다.
#
# ★ 2026-08-10 재설계 — 왜 브랜치에 커밋하지 않는가
#   옛 버전은 `git add -A && git commit` 으로 **작업 브랜치(main)에 직접** wip 커밋을 쌓았다.
#   세 가지가 무너졌다:
#     ① 지우기로 되어 있는 임시 검증 스크립트를 커밋했다. CLAUDE.md 는 `node test-xxx.js` 후
#        `rm` 을 명시하는데, 검증이 30분을 넘으면 그 사이 자동저장이 먼저 집어갔다.
#        실제로 2026-08-05·06·08·10 네 세션에서 반복됐다(test-fable-*.js, test-tags-fable*.js …).
#     ② 작업 **진행 중** 상태가 커밋돼, 의도해서 박제한 커밋과 구분되지 않았다. 히스토리가
#        wip 로 뒤덮여 "이 사이클이 무엇을 바꿨나" 를 커밋 로그로 읽을 수 없었다.
#     ③ **Fable 게이트 훅을 침묵시켰다.** 그 훅은 "미커밋 소스 변경이 있는데 미검증" 일 때 정지를
#        막는데, 자동저장이 트리를 깨끗하게 만들어 경고가 사라졌다. 안전망이 안전망을 껐다.
#
#   그래서 스냅샷을 **작업 브랜치가 아니라 전용 ref** `refs/autosave/<브랜치>` 에 쌓는다.
#   워킹트리·인덱스·브랜치 어느 것도 건드리지 않는다(임시 인덱스 사용 — 사용자가 `git add` 하던
#   중이어도 간섭하지 않는다). 유실 방지력은 그대로고, 히스토리는 사람이 박제한 것만 남는다.
#
#   복구:
#     git log --oneline refs/autosave/main          # 스냅샷 목록
#     git show refs/autosave/main:<경로>            # 파일 하나 꺼내보기
#     git diff HEAD refs/autosave/main              # 지금과 마지막 스냅샷 차이
#     git checkout refs/autosave/main -- <경로>     # 되살리기
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"
export HOME="/home/irene"

MODE="${1:-deadman}"
REPO="${CLAUDE_AUTOSAVE_REPO:-/opt/planq}"
ACTIVITY_FILE="${CLAUDE_ACTIVITY_FILE:-/tmp/.claude-last-activity}"
THRESHOLD="${CLAUDE_AUTOSAVE_THRESHOLD:-1800}"   # 30분 (초)
NOW=$(date +%s)

cd "$REPO" 2>/dev/null || exit 0
git rev-parse --verify -q HEAD >/dev/null 2>&1 || exit 0   # 커밋 하나도 없는 저장소

# git dirty 아니면 저장할 것 없음
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  exit 0
fi

BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached")
AUTOSAVE_REF="refs/autosave/${BRANCH}"
LAST=$(git rev-parse --verify -q "$AUTOSAVE_REF" 2>/dev/null || true)

# 나이 기준 — 브랜치 커밋이 아니라 **마지막 스냅샷** 을 본다.
#   옛 버전은 마지막 브랜치 커밋을 봤다. 그래서 오래 파고드는 작업 중에는 계속 조건이 성립해
#   30분마다 브랜치에 wip 이 쌓였다. 스냅샷 기준이면 "직전 스냅샷 이후 30분" 이 된다.
if [ -n "$LAST" ]; then
  REF_TIME=$(git log -1 --format=%ct "$LAST" 2>/dev/null || echo 0)
else
  REF_TIME=$(git log -1 --format=%ct HEAD 2>/dev/null || echo 0)
fi
SNAP_AGE=$(( NOW - REF_TIME ))

case "$MODE" in
  hook)
    # Claude 활동 중 — 마지막 스냅샷이 30분 넘었을 때만 저장
    [ "$SNAP_AGE" -lt "$THRESHOLD" ] && exit 0
    IDLE_SRC=$SNAP_AGE
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

# ── 스냅샷 트리 만들기 (임시 인덱스 — 사용자의 인덱스/스테이징 상태 무접촉)
TMP_INDEX=$(mktemp "${TMPDIR:-/tmp}/.claude-autosave-index.XXXXXX") || exit 0
trap 'rm -f "$TMP_INDEX"' EXIT
export GIT_INDEX_FILE="$TMP_INDEX"
git read-tree HEAD >/dev/null 2>&1 || exit 0
git add -A >/dev/null 2>&1            # .gitignore 존중 — 임시 검증 스크립트는 여기서 걸러진다
TREE=$(git write-tree 2>/dev/null) || exit 0
unset GIT_INDEX_FILE

# 직전 스냅샷과 내용이 같으면 남기지 않는다 (같은 상태를 반복 박제하지 않음)
if [ -n "$LAST" ] && [ "$(git rev-parse -q --verify "${LAST}^{tree}" 2>/dev/null)" = "$TREE" ]; then
  exit 0
fi
# 추적 대상 변경이 실제로 없으면(무시 파일만 dirty) 남길 것 없음
if [ "$(git rev-parse -q --verify 'HEAD^{tree}' 2>/dev/null)" = "$TREE" ]; then
  exit 0
fi

IDLE_MIN=$(( IDLE_SRC / 60 ))
TS=$(date '+%Y-%m-%d %H:%M')
HEAD_SHORT=$(git rev-parse --short HEAD)

COMMIT=$(git commit-tree "$TREE" ${LAST:+-p "$LAST"} $([ -z "$LAST" ] && echo "-p HEAD") \
  -m "autosave ${TS} (idle ${IDLE_MIN}m, mode ${MODE}, at ${HEAD_SHORT})" \
  -m "작업 브랜치가 아닌 스냅샷 ref. 복구: git checkout ${AUTOSAVE_REF} -- <경로>" 2>/dev/null) || exit 0

git update-ref "$AUTOSAVE_REF" "$COMMIT" ${LAST:+"$LAST"} 2>/dev/null || exit 0

echo "[$(date '+%F %T')] snapshot (mode=$MODE idle=${IDLE_MIN}m) -> ${AUTOSAVE_REF} $(git rev-parse --short "$COMMIT")  |  복구: git checkout ${AUTOSAVE_REF} -- <경로>"
exit 0
