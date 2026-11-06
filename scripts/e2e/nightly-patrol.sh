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
# 운영 배포가 도는 중이면 끝날 때까지 기다린다(최대 90분) — 배포 빌드가 4.7GB 까지 커져 브라우저 검사와 겹치면
#   earlyoom 이 빌드를 죽인다(2026-10-22 16:00 실측). 90분이 지나도 배포 중이면 오늘 밤은 건너뛴다.
if ! /opt/planq/scripts/deploy-busy.sh --wait 5400 nightly-patrol 2>> logs/patrol/cron.log; then
  echo "$(date -u +%FT%TZ) skip: deploy still running after 90min" >> logs/patrol/cron.log; exit 0
fi
# 순찰은 7환경을 한 번에 돈다 — 기본 몫 1500(상자 1950)을 넘어 11-03 밤 137 로 죽었다 → 순찰만 3000(lib/mem-slot.js)
# 시간 제한 9000(2시간 30분) → 12600(3시간 30분): 10-24 부터 순찰 자체가 2시간 20분 안팎이라 10-29·10-30·11-02·11-04 네 밤이
#   제한에 걸려 끝(exit 124)·보고서 없이 끝났다 — 보고서는 끝에 한 번 쓰므로 제한에 걸리면 그날 결과가 통째로 없다(2026-11-06 정기 점검).
# 2026-11-06 원인: 한 탭으로 화면 수십 개를 연달아 돌아 크롬 메모리가 쌓이며 느려졌다(11-05 정점 3299MB · 3시간 30분).
#   순찰이 화면마다 새 탭을 연다(canary-button-patrol freshPage) — desktop-web 같은 조건 실측 1657초→868초 · 정점 1899→1058MB.
#   그래서 몫 3000 → 2000(상자 2600). 3000(상자 3900)이면 11-05 21:16 처럼 배포 빌드가 자리를 못 받는다. 보고서는 환경마다 다시 쓴다.
PLANQ_CHROME_MB=2000 timeout 12600 node scripts/e2e/run.js --suite patrol > "logs/patrol/run-$D.log" 2>&1
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
