#!/usr/bin/env bash
# deploy-busy.sh — 지금 운영 배포(deploy-planq.sh)가 도는 중인가 (2026-10-23)
#
#   왜: 10-22 배포 빌드가 세 번 «Terminated»(earlyoom)로 죽었다. 16:00 은 밤 검사(nightly-patrol → full-sweep)가
#     배포 도중 시작했고, 서버 공용 게이트(heavy-task-gate)는 «시작할 때» 만 막아 나중에 뜬 작업이 배포 빌드를 죽였다.
#     그래서 무거운 쪽(밤 검사·전체 검사·e2e 러너)이 시작 전·스위트 사이마다 이걸 보고 배포가 끝날 때까지 기다린다.
#   판정: 배포가 시작하며 남기는 표시 파일(logs/deploy-running.pid)의 pid 가 살아 있고 그 명령줄이 deploy-planq.sh 일 때만.
#     pgrep -f 로 이름을 찾지 않는다 — 찾는 쪽 명령줄에 같은 글자가 들어가면 자기 자신을 «배포» 로 잡는다.
#     배포가 강제 종료돼 표시 파일이 남아도 pid 가 죽었거나 다른 프로그램이면 «안 돈다» 로 본다.
#
#   사용: scripts/deploy-busy.sh                    # 0 = 배포 중(한 줄 설명 출력) · 1 = 아님
#         scripts/deploy-busy.sh --wait 5400 이름   # 끝날 때까지 기다림 · 0 = 비었음 · 2 = 시간 초과(여전히 배포 중)
PIDFILE=/opt/planq/logs/deploy-running.pid

busy() {
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null) || return 1
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'deploy-planq\.sh' || return 1
  echo "운영 배포가 도는 중 (pid $pid, 시작 $(date -d "@$(stat -c %Y "$PIDFILE")" '+%F %T'))"
  return 0
}

if [ "$1" != "--wait" ]; then busy; exit $?; fi

MAX=${2:-5400}; WHO=${3:-작업}; waited=0
while msg=$(busy); do
  [ $waited -eq 0 ] && echo "[deploy-busy] $WHO — $msg · 끝날 때까지 기다린다(최대 ${MAX}초)" >&2
  if [ $waited -ge "$MAX" ]; then echo "[deploy-busy] $WHO — ${MAX}초 기다렸는데 배포가 안 끝남" >&2; exit 2; fi
  sleep 30; waited=$((waited + 30))
done
[ $waited -gt 0 ] && echo "[deploy-busy] $WHO — 배포 끝남 (${waited}초 기다림)" >&2
exit 0
