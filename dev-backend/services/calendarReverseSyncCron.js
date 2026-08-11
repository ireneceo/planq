// 역방향 동기화 cron — 구글에서 고친 내용을 PlanQ 로 되돌려 받는다 (#242 ②).
//
// 주기 5분. watch(push) 채널을 쓰지 않는 대신 syncToken 증분 폴링이라 호출 비용이 작다
// (변경이 없으면 빈 응답 1회). 폴링 대상은 **링크를 가진 살아있는 연결만** 이라 연결 수에 비례한다.
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
  cron.schedule('*/5 * * * *', runCalendarReverseSyncCron);
  console.log('[calendarReverseSyncCron] initialized — runs every 5 minutes');
}

module.exports = { initCalendarReverseSyncCron, runCalendarReverseSyncCron };
