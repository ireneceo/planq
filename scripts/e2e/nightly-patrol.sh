#!/usr/bin/env bash
# 매일 밤 «모든 버튼 눌러보기» 순찰 (dev) — scripts/e2e/canary-button-patrol.js
#   보고서: /opt/planq/logs/patrol/patrol-YYYY-MM-DD.log (사람이 읽는 판정) · run-YYYY-MM-DD.log (러너 출력)
#   쓰기 요청은 순찰이 전부 막으므로 dev 데이터는 바뀌지 않는다.
set -o pipefail
cd /opt/planq || exit 1
mkdir -p logs/patrol
D=$(date -u +%F)
# 다른 순찰이 아직 돌고 있으면 겹치지 않는다
exec 9>/opt/planq/logs/patrol/patrol-lock.log
flock -n 9 || { echo "$(date -u +%FT%TZ) skip: previous patrol still running" >> logs/patrol/cron.log; exit 0; }
timeout 9000 node scripts/e2e/run.js --suite patrol > "logs/patrol/run-$D.log" 2>&1
RC=$?
echo "$(date -u +%FT%TZ) exit=$RC $(grep -a '총 실패' "logs/patrol/run-$D.log" | tail -1)" >> logs/patrol/cron.log
# 30일 지난 보고서 정리
find logs/patrol -name '*-20*.log' -mtime +30 -delete 2>/dev/null
find logs/sweep -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null
# 순찰이 끝나면 전체 검사(등록된 스위트 전부) — 잠금을 풀고 넘긴다(full-sweep 도 같은 잠금을 잡는다).
#   아침 00:00 UTC «/개발시작» 방이 두 결과를 읽고 실패부터 처리한다(.claude/commands/개발시작.md 1-C).
exec 9>&-
[ "${PATROL_ONLY:-0}" = "1" ] || /opt/planq/scripts/e2e/full-sweep.sh >/dev/null 2>&1
exit 0
