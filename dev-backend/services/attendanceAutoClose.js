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
const { dateStrInTz, ymd } = require('../utils/datetime');
const A = require('./attendanceTransition');

/** 마감 시각 추정 — 마지막 근태 이벤트와 그날 마지막 몰입 활동 중 늦은 쪽. */
async function guessCloseAt(day) {
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
  const focus = await FocusSession.findOne({
    where: {
      user_id: day.user_id, business_id: day.business_id,
      last_activity_at: { [Op.between]: [dayStart, dayEnd] },
    },
    order: [['last_activity_at', 'DESC']],
    attributes: ['last_activity_at'],
  });
  if (focus?.last_activity_at && new Date(focus.last_activity_at) > best) best = new Date(focus.last_activity_at);
  return best;
}

async function runAttendanceAutoClose() {
  try {
    const open = await AttendanceDay.findAll({
      where: { state: { [Op.in]: ['working', 'on_break'] } },
      attributes: ['id', 'business_id', 'user_id', 'work_date', 'clock_in_at'],
      limit: 1000,
    });
    if (!open.length) return { closed: 0 };
    // 워크스페이스마다 '오늘' 이 다르다 — tz 를 한 번씩만 읽는다.
    const tzCache = new Map();
    let closed = 0;
    for (const day of open) {
      let tz = tzCache.get(day.business_id);
      if (!tz) {
        const biz = await Business.findByPk(day.business_id, { attributes: ['timezone'] });
        tz = biz?.timezone || 'Asia/Seoul';
        tzCache.set(day.business_id, tz);
      }
      const today = dateStrInTz(new Date(), tz);
      if (ymd(day.work_date) >= today) continue;   // String(Date) 로 비교하면 요일 문자열이 나온다   // 오늘 근무 중인 사람은 건드리지 않는다
      const at = await guessCloseAt(day);
      try {
        await A.clockOut({
          businessId: day.business_id, userId: day.user_id,
          actorUserId: day.user_id, source: 'auto_close',
          at, workDate: ymd(day.work_date),
        });
        closed += 1;
      } catch (e) { console.warn('[attendanceAutoClose] day', day.id, e.message); }
    }
    if (closed) console.log(`[attendanceAutoClose] closed=${closed}`);
    return { closed };
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
