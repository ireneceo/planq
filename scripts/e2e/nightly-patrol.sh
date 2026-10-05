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
timeout 5400 node scripts/e2e/run.js --suite patrol > "logs/patrol/run-$D.log" 2>&1
RC=$?
echo "$(date -u +%FT%TZ) exit=$RC $(grep -a '총 실패' "logs/patrol/run-$D.log" | tail -1)" >> logs/patrol/cron.log
# 30일 지난 보고서 정리
find logs/patrol -name '*-20*.log' -mtime +30 -delete 2>/dev/null
exit 0
