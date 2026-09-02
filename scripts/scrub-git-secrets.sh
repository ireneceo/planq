#!/bin/bash
# scrub-git-secrets.sh — git 히스토리에 박제된 비밀 제거 (2026-09-02 보안감사 C-2)
#
# 무엇이 있었나: `.claude/session-state.md` 에 **살아 있는 비밀 두 개**가 커밋돼 원격까지 push 됐다.
#   - GOOGLE_CLIENT_SECRET (GOCSPX-…)
#   - INTERNAL_API_KEY (planq-internal-dev-…)
#   커밋 c7e625e8 · ee048461 · 6bf6e1b6 (2026-04-22~24). HEAD 에는 없지만 히스토리에 남아 있다.
#
# ★ 순서가 중요하다 — **키 회전이 먼저다.** 히스토리를 지워도 이미 복제한 사람의 손에는 남는다.
#   회전하면 그 값이 죽고, 히스토리 정리는 "더 이상 퍼지지 않게" 하는 후속 조치다.
#
# ★ 되돌릴 수 없다. 이 스크립트는 실행 전 **번들 백업**을 만들고, 검증에 실패하면 push 하지 않는다.
#
# 영향:
#   - 2026-04-22 이후 **모든 커밋 SHA 가 바뀐다** (히스토리 재작성)
#   - 복제본을 가진 사람(lua)은 **다시 clone** 해야 한다. pull 로는 합쳐지지 않는다
#   - 운영의 `.last-deployed-commit` 이 사라진 SHA 를 가리키게 된다 — 배포 후 갱신할 것
#
# 사용:
#   ./scrub-git-secrets.sh check     # 어디에 남아 있는지만 본다 (변경 0)
#   ./scrub-git-secrets.sh rewrite   # 로컬 히스토리 재작성 (push 안 함)
#   ./scrub-git-secrets.sh push      # 검증 통과 시 원격에 강제 반영
set -euo pipefail
cd /opt/planq

MODE="${1:-check}"
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/planq/backups/git-scrub"
# 찾는 패턴 — 값 자체를 스크립트에 적지 않는다(적으면 이 파일이 다음 유출원이다)
PAT_GOOGLE='GOCSPX-[A-Za-z0-9_-]\{10,\}'
PAT_INTERNAL='planq-internal-[a-z]*-[a-f0-9]\{32\}'

# ★ `grep -q` 를 파이프 뒤에 쓰지 말 것 — 일찍 끝내면서 파이프를 닫아 앞 명령에 SIGPIPE 가 나고,
#   `set -o pipefail` 이 그것을 **파이프라인 실패**로 잡는다. 그래서 검사가 통째로 안 돌고
#   "0 개" 라는 거짓 결과가 나왔다(2026-09-02 실측 — 실제로는 남아 있었다).
#   전부 읽어 세는 방식으로 바꾼다. 느리지만 거짓말하지 않는다.
scan() {
  local found=0 body
  for ref in $(git rev-list --all 2>/dev/null); do
    body=$(git show "$ref:.claude/session-state.md" 2>/dev/null || true)
    [ -n "$body" ] || continue
    case "$body" in
      *GOCSPX-*|*planq-internal-*) ;;
      *) continue ;;
    esac
    if printf '%s' "$body" | grep -cE "GOCSPX-[A-Za-z0-9_-]{10,}|planq-internal-[a-z]*-[a-f0-9]{32}" > /dev/null 2>&1; then
      found=$((found + 1))
    fi
  done
  echo "$found"
}

case "$MODE" in
  check)
    echo "== 비밀이 남아 있는 커밋 수 =="
    echo "  $(scan) 개"
    echo "== 대상 커밋 (값이 바뀐 지점) =="
    git log --all --oneline -S"GOCSPX-" -- .claude/session-state.md | head
    git log --all --oneline -S"planq-internal-" -- .claude/session-state.md | head
    ;;

  rewrite)
    [ -z "$(git status --porcelain)" ] || { echo "✗ 작업트리가 깨끗하지 않다 — 먼저 커밋할 것"; exit 1; }
    mkdir -p "$BACKUP_DIR"
    echo "== 백업 =="
    git bundle create "$BACKUP_DIR/planq-${STAMP}.bundle" --all
    echo "  ✓ $BACKUP_DIR/planq-${STAMP}.bundle ($(du -h "$BACKUP_DIR/planq-${STAMP}.bundle" | cut -f1))"
    git rev-parse --all > "$BACKUP_DIR/refs-${STAMP}.txt"
    git for-each-ref --format='%(refname) %(objectname)' >> "$BACKUP_DIR/refs-${STAMP}.txt"
    echo "  ✓ ref 스냅샷 $BACKUP_DIR/refs-${STAMP}.txt"

    echo "== 재작성 (index-filter — 체크아웃 없이 blob 만 교체) =="
    export FILTER_BRANCH_SQUELCH_WARNING=1
    # ★ 필터 본문에 `exit` 를 쓰지 말 것 — filter-branch 는 필터를 **자기 셸에서 eval** 한다.
    #   `|| exit 0` 한 줄 때문에 **첫 커밋(그 파일이 없는 루트)에서 filter-branch 자신이 조용히
    #   종료했다** — 종료코드 0, 오류 메시지 없음, "Rewrite …(1/2195)" 한 줄만 남기고.
    #   그래서 "재작성했다" 고 믿은 채 58개가 그대로 있었다(2026-09-02 실측). 분기만으로 쓴다.
    git filter-branch -f --index-filter '
      if blob=$(git rev-parse --quiet --verify :.claude/session-state.md 2>/dev/null); then
        if [ -n "$blob" ]; then
          new=$(git cat-file blob "$blob" \
            | sed -e "s/GOCSPX-[A-Za-z0-9_-]\{10,\}/GOCSPX-<REDACTED>/g" \
                  -e "s/planq-internal-[a-z]*-[a-f0-9]\{32\}/planq-internal-<REDACTED>/g" \
            | git hash-object -w --stdin)
          if [ "$new" != "$blob" ]; then
            git update-index --cacheinfo 100644 "$new" .claude/session-state.md
          fi
        fi
      fi
    ' --tag-name-filter cat -- --all

    echo "== 검증 =="
    left=$(scan)
    echo "  남은 커밋: $left 개"
    [ "$left" = "0" ] || { echo "✗ 아직 남아 있다 — push 하지 말 것"; exit 1; }
    echo "  ✓ 히스토리에서 사라짐"
    echo
    echo "다음: ./scrub-git-secrets.sh push  (원격 강제 반영)"
    echo "되돌리려면: git bundle 로 복원 — $BACKUP_DIR/planq-${STAMP}.bundle"
    ;;

  push)
    left=$(scan)
    [ "$left" = "0" ] || { echo "✗ 로컬에 아직 비밀이 남아 있다 ($left 커밋) — rewrite 를 먼저"; exit 1; }
    echo "== 원격 강제 반영 =="
    GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes" git push --force --all origin
    GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes" git push --force --tags origin
    echo "✅ 완료"
    echo
    echo "⚠️ 복제본을 가진 사람은 **다시 clone** 해야 한다 (pull 로는 안 합쳐진다)."
    echo "⚠️ 운영의 .last-deployed-commit 이 사라진 SHA 를 가리킨다 — 다음 배포 때 갱신된다."
    ;;

  *)
    echo "사용: $0 {check|rewrite|push}"; exit 1;;
esac
