// 역방향 동기화 cron — 구글에서 고친 내용을 PlanQ 로 되돌려 받는다 (#242 ②).
//
// 주기 **1분**(2026-08-14). watch(push) 채널을 쓰지 않는 대신 syncToken 증분 폴링이라 호출 비용이 작다
// (변경이 없으면 빈 응답 1회). 폴링 대상은 **링크를 가진 살아있는 연결만** 이라 연결 수에 비례한다.
//
// ★ 왜 5분에서 내렸나: 5분은 사용자에게 **고장으로 읽혔다**. #242 재신고의 실체가 이것이었다 —
//   신고자가 구글에서 고친 뒤 3분 만에 확인하고 "안 된다" 고 판단했고, 실제로는 그 뒤에 반영됐다.
//   실제 호출량은 `calendarReverseSync` 의 소스별 백오프가 거른다(조용한 소스는 5분으로 물러난다).
//   지연 0 은 watch(push) 채널이라야 하는데, 운영에서 push 수신 경로가 한 번도 산 적이 없어
//   (watch_channel_id 전부 NULL = 도메인 검증 미실증) 별도 청크로 미룬다.
//
// ★ 겹침 방지: 앞선 회차가 아직 돌고 있으면 이번 회차는 건너뛴다. node-cron 은 이전 실행이
//   끝났는지 보지 않아, 느린 회차가 쌓이면 같은 커서로 동시에 돌며 중복 반영을 낼 수 있다.
const cron = require('node-cron');
const reverseSync = require('./calendarReverseSync');

let running = false;
let appRef = null;

async function runCalendarReverseSyncCron() {
  if (running) {
    console.log('[calendarReverseSyncCron] 이전 회차 진행 중 — skip');
    return;
  }
  running = true;
  try {
    const io = appRef ? appRef.get('io') : null;
    await reverseSync.runAll({ io });
  } catch (e) {
    console.error('[calendarReverseSyncCron] 실패:', e.message);
  } finally {
    running = false;
  }
}

/** @param {import('express').Express} app — socket.io 인스턴스를 얻기 위해 받는다(실시간 반영 16번). */
function initCalendarReverseSyncCron(app) {
  appRef = app || null;
  cron.schedule('* * * * *', runCalendarReverseSyncCron);
  console.log('[calendarReverseSyncCron] initialized — ticks every minute (소스별 백오프로 실제 호출을 거른다)');
}

module.exports = { initCalendarReverseSyncCron, runCalendarReverseSyncCron };
