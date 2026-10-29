// cronalive-exempt: 열린 집중·출근 기록을 닫는 정리뿐 — 발송·외부 호출·LLM 없음
// 미퇴근 자동 마감 (#208) — docs/ATTENDANCE_LEAVE_DESIGN.md §4.3
//
// 퇴근을 안 누르고 그냥 집에 가는 일은 반드시 생긴다. 그대로 두면 '근무중' 이 며칠씩 이어지고
//   그 사람의 근무시간이 무한히 늘어난다 — 통계 전체가 못 쓰게 된다.
// 그래서 **워크스페이스 tz 기준 어제 이전** 의 열린 하루를 닫는다. 자동으로 닫힌 것은
//   `auto_closed` 로 표시해 화면이 "자동 마감됨" 을 보여주고, 관리자·본인이 정정하게 한다
//   (조용히 닫으면 틀린 값이 맞는 값인 척한다).
const cron = require('node-cron');
const { Op } = require('sequelize');
const { AttendanceDay, AttendanceEvent, FocusSession, Business } = require('../models');
const { dateStrInTz, ymd, addDaysStr, startOfDayInTz } = require('../utils/datetime');
const A = require('./attendanceTransition');

/** 마감 시각 추정 — 마지막 근태 이벤트와 그날 마지막 몰입 활동 중 늦은 쪽. */
async function guessCloseAt(day, tz) {
  const lastEvent = await AttendanceEvent.findOne({
    // 스코프: attendance_day_id 는 한 워크스페이스·한 사람의 하루에 묶인 자식이다.
    where: { attendance_day_id: day.id },
    order: [['at', 'DESC']],
    attributes: ['at'],
  });
  let best = lastEvent ? new Date(lastEvent.at) : new Date(day.clock_in_at);
  // ★ Focus 시각은 **마감 시각 추정에만** 쓰고 어디에도 노출하지 않는다.
  //   본인 기록을 닫기 위한 계산이라 프라이버시 계약(§6 FocusSession 은 관리자도 못 봄)을 깨지 않는다.
  // ★ work_date 는 DATEONLY 지만 **Date 객체로 온다**(이 프로젝트의 알려진 함정).
  //   그대로 템플릿에 넣으면 `"Sat Aug 22 2026 00:00:00 GMT+0000 (…)T00:00:00"` 가 되어
  //   Invalid Date → MySQL 에 'Invalid date' 로 나가 쿼리가 통째로 실패한다.
  //   운영 실측(2026-08-24): `[attendanceAutoClose] error: Incorrect DATETIME value: 'Invalid date'`
  //   가 매 tick 반복돼 **자동 마감이 한 번도 동작한 적이 없었다.** 정규화 함수를 쓴다.
  const dayStart = new Date(`${ymd(day.work_date)}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 36 * 3600 * 1000);
  // ★ 그 날 다음 자정 전에 **시작한** 세션만 보고, 결과도 다음 자정을 넘기지 않는다(2026-10-22 Fable 자정 분할 판정).
  //   안 그러면 00:02 에 새로 시작한 오늘 세션의 활동이 어제 퇴근 시각이 되어 «어제 퇴근 00:05 > 오늘 출근 00:02» 로 뒤집힌다.
  const nextMidnight = startOfDayInTz(addDaysStr(ymd(day.work_date), 1), tz);
  const focus = await FocusSession.findOne({
    where: {
      user_id: day.user_id, business_id: day.business_id,
      started_at: { [Op.lt]: nextMidnight },
      last_activity_at: { [Op.between]: [dayStart, dayEnd] },
    },
    order: [['last_activity_at', 'DESC']],
    attributes: ['last_activity_at'],
  });
  if (focus?.last_activity_at && new Date(focus.last_activity_at) > best) best = new Date(focus.last_activity_at);
  return best > nextMidnight ? nextMidnight : best;
}

// 워크스페이스마다 '오늘' 이 다르다 — tz 를 한 번씩만 읽는다.
async function tzOf(cache, businessId) {
  let tz = cache.get(businessId);
  if (!tz) {
    const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
    tz = biz?.timezone || 'Asia/Seoul';
    cache.set(businessId, tz);
  }
  return tz;
}

/**
 * 2차 패스(2026-10-15 Fable 판정) — 근태 행 없이 날을 넘긴 포커스 세션을 닫는다.
 *   근태가 열려 있던 날은 1차 패스의 clockOut 이 세션도 닫는다(clock_out). 근태가 없던 날(자동 출근 끔·
 *   다른 경로)은 닫을 근태가 없어 멈춘 세션이 며칠이고 남았다 — 다음 날 «미출근 + 어제 업무 자리 비움 · 재개».
 *   기준 시각(멈춤이면 멈춘 시각, 아니면 마지막 활동 → 시작)이 그 워크스페이스 tz 의 오늘 이전일 때만 닫는다 —
 *   야간 근무자는 heartbeat 로 마지막 활동이 오늘이라 건드리지 않는다. 시간은 computeActualSeconds 의 캡(#94)이 지킨다.
 */
async function closeStaleFocus(tzCache) {
  const live = await FocusSession.findAll({
    where: { state: { [Op.in]: ['active', 'paused'] } },
    attributes: ['id', 'user_id', 'business_id', 'state', 'started_at', 'paused_at', 'last_activity_at'],
    limit: 1000,
  });
  let stopped = 0;
  for (const s of live) {
    const tz = await tzOf(tzCache, s.business_id);
    const ref = (s.state === 'paused' && s.paused_at) ? s.paused_at : (s.last_activity_at || s.started_at);
    if (dateStrInTz(new Date(ref), tz) >= dateStrInTz(new Date(), tz)) continue;
    try {
      const r = await A.stopActiveFocus(s.user_id, 'day_end', { businessId: s.business_id, broadcast: true });
      if (r) stopped += 1;
    } catch (e) { console.warn('[attendanceAutoClose] focus', s.id, e.message); }
  }
  return stopped;
}

async function runAttendanceAutoClose() {
  try {
    const open = await AttendanceDay.findAll({
      where: { state: { [Op.in]: ['working', 'on_break'] } },
      attributes: ['id', 'business_id', 'user_id', 'work_date', 'clock_in_at'],
      limit: 1000,
    });
    const tzCache = new Map();
    let closed = 0;
    let splitCount = 0;
    for (const day of open) {
      const tz = await tzOf(tzCache, day.business_id);
      const today = dateStrInTz(new Date(), tz);
      if (ymd(day.work_date) >= today) continue;   // String(Date) 로 비교하면 요일 문자열이 나온다   // 오늘 근무 중인 사람은 건드리지 않는다
      // 자정을 넘겨 일하는 중이면 마감 대신 이어 준다(어제 24:00 퇴근 + 오늘 00:00 출근) — /today 가 먼저 했으면 no-op.
      //   어제보다 오래된 열린 행은 술어와 무관하게 종전 마감.
      if (ymd(day.work_date) === addDaysStr(today, -1)) {
        let split = null;
        try {
          split = await A.ensureMidnightSplit({ businessId: day.business_id, userId: day.user_id });
        } catch (e) { console.warn('[attendanceAutoClose] split', day.id, e.message); }
        if (split) { splitCount += 1; continue; }
      }
      const at = await guessCloseAt(day, tz);
      try {
        await A.clockOut({
          businessId: day.business_id, userId: day.user_id,
          actorUserId: day.user_id, source: 'auto_close',
          at, workDate: ymd(day.work_date),
        });
        closed += 1;
      } catch (e) { console.warn('[attendanceAutoClose] day', day.id, e.message); }
    }
    // 근태 닫기가 먼저다 — 열린 날의 세션은 clock_out 으로 닫혀야 한다(순서가 end_reason 을 정한다).
    const focusStopped = await closeStaleFocus(tzCache);
    if (closed || focusStopped || splitCount) console.log(`[attendanceAutoClose] closed=${closed} midnight_split=${splitCount} focus_day_end=${focusStopped}`);
    return { closed, split: splitCount, focusStopped };
  } catch (err) {
    console.error('[attendanceAutoClose] error:', err.message);
    return { closed: 0, error: err.message };
  }
}

function initAttendanceAutoClose() {
  // 매시 5분 — 워크스페이스 tz 가 제각각이라 하루 한 번으로는 어느 지역이든 늦는다.
  cron.schedule('5 * * * *', runAttendanceAutoClose);
  console.log('[attendanceAutoClose] initialized — hourly');
}

module.exports = { initAttendanceAutoClose, runAttendanceAutoClose };
