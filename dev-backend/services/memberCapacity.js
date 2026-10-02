// memberCapacity — 멤버 주간 가용시간 **단일 원천** (Fable 설계 게이트 #288, 2026-08-17).
//
// 왜 이 파일이 생겼나:
//   같은 "가용시간" 이 세 벌로 갈라져 있었다 —
//     ① routes/tasks.js getMemberCapacity      : daily × days × rate (holidays 는 따로 실어 보냄)
//        그런데 화면(QTaskPage)은 그걸 받아 daily × (days − holidays) × rate 로 다시 계산했다
//     ② weeklyReviewSnapshot.js getUserCapacity : daily × days        (rate·holidays 무시)
//     ③ weeklyReviewSnapshot.js 인라인          : daily × days        (같은 파일 안에서 또 한 벌)
//   숫자가 갈라지면 "화면 그래프와 보고서 그래프가 다르다" 는 신고가 난다 — #254 가 정확히 그 계열이었다.
//   (memory: feedback_cumulative_ledger_needs_baseline — 정의는 모든 소비처가 **공유**해야 한다.)
//
// 정본 공식은 **라이브 화면이 쓰던 것**으로 통일한다:
//     weekly = daily_work_hours × (weekly_work_days − weekly_holidays) × participation_rate
//   화면이 사용자에게 이미 그 숫자를 보여주고 있었으므로, 보고서를 화면에 맞춘다(그 반대가 아니다).
const { BusinessMember } = require('../models');

const DEFAULTS = { daily: 8, days: 5, rate: 1, holidays: 0 };

/** 원시 설정값 — 소비처가 daily/days 를 따로 쓰는 곳이 있어 함께 돌려준다. */
async function getMemberCapacity(userId, businessId) {
  const bm = await BusinessMember.findOne({
    where: { user_id: userId, business_id: businessId },
    attributes: ['daily_work_hours', 'weekly_work_days', 'participation_rate', 'weekly_holidays'],
  });
  const daily = Number(bm?.daily_work_hours) || DEFAULTS.daily;
  const days = Number(bm?.weekly_work_days) || DEFAULTS.days;
  const rate = Number(bm?.participation_rate) || DEFAULTS.rate;
  const holidays = Number(bm?.weekly_holidays) || DEFAULTS.holidays;
  return { daily, days, rate, holidays, weekly: weeklyHours({ daily, days, rate, holidays }) };
}

/** 주간 가용시간 — 공식 1벌. 근무일에서 휴일을 빼고 참여율을 곱한다. */
function weeklyHours({ daily, days, rate, holidays }) {
  const workDays = Math.max(0, (Number(days) || 0) - (Number(holidays) || 0));
  return Math.round((Number(daily) || 0) * workDays * (Number(rate) || 0) * 10) / 10;
}

/** 기간 가용시간 — 주간을 기간 길이로 환산한다.
 *  월간 보고서가 주간 캐파를 그대로 쓰면 4~5배 과소 표기된다. 환산 규칙을 여기 한 곳에 못박는다:
 *      capacity_period = weekly × (기간일수 / 7)
 *  (Fable 설계 명시값. 예: 2026-08 31일 · 주 30h → 30 × 31/7 = 132.9h) */
function periodHours(weekly, startYmd, endYmd) {
  const w = Number(weekly) || 0;
  if (!startYmd || !endYmd) return w;
  const ms = Date.parse(`${endYmd}T00:00:00Z`) - Date.parse(`${startYmd}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return w;
  const days = Math.round(ms / 86400000) + 1;   // 양끝 포함
  return Math.round((w * days / 7) * 10) / 10;
}

// ─── 휴가 차감 (#208 · #285) ─────────────────────────────────────
// ★ 여기에 붙이는 이유: 가용시간 공식은 이 파일 **한 벌**이다(위 주석의 병리 참조).
//   휴가 차감을 소비처마다 따로 빼면 그 순간 네 번째 사본이 생기고, 화면과 보고서가 또 갈라진다.
// 수학적 동치: weekly − daily×rate×L === daily×(days − holidays − L)×rate
//   — 즉 "휴가는 휴일과 같은 방식으로 근무일에서 빠진다".

// ─── 공휴일 (#424) ─────────────────────────────────────────────
// 날짜 축은 services/workspaceHolidays.getWorkCalendar 한 곳에서 온다(근무 요일 · 휴일).
// 세 축이 같은 날을 두 번 세지 않는다(설계 §3.2):
//   · 공휴일이 먼저 — 휴가가 공휴일에 걸친 날은 휴가에서 0
//   · 비근무 요일(기본 토·일)에 떨어진 공휴일·휴가는 0
//   · 수동 weekly_holidays 는 그대로 더한다(호환 — 입력칸은 화면에서 없앴다)

/**
 * 기간 [start,end] 의 휴일 일수 · 휴가 일수.
 *  - full_day 휴가: 겹친 날짜 중 **근무일**(근무 요일 ∧ 휴일 아님)만 센다.
 *    (#424 전에는 days_charged 를 달력 일수 비율로 일할했다 — 금~월 휴가가 주말까지 빠졌다.)
 *  - half_day / hours: days_charged 그대로. 단 그 날이 근무일이 아니면 0.
 * 휴일 행 0 · 승인 휴가 0 이면 {0,0} → 종전 값과 diff 0.
 */
async function getDeductionsInRange(userId, businessId, startYmd, endYmd, { cal = null } = {}) {
  const empty = { holiday_days: 0, holiday_list: [], leave_days: 0, work_weekdays: [1, 2, 3, 4, 5] };
  if (!businessId || !startYmd || !endYmd) return empty;
  const { getWorkCalendar, countWorkdays, isWorkday } = require('./workspaceHolidays');
  const c = cal || await getWorkCalendar(businessId, startYmd, endYmd);
  const holiday_list = c.holidays.filter((h) => h.date >= startYmd && h.date <= endYmd);
  const work_weekdays = [...c.weekdays].sort();
  if (!userId) return { ...empty, holiday_days: holiday_list.length, holiday_list, work_weekdays };
  const { Op } = require('sequelize');
  const { LeaveRequest } = require('../models');
  const rows = await LeaveRequest.findAll({
    where: {
      business_id: businessId, user_id: userId, status: 'approved',
      start_date: { [Op.lte]: endYmd }, end_date: { [Op.gte]: startYmd },
    },
    attributes: ['unit', 'start_date', 'end_date', 'days_charged'],
  });
  const { ymd } = require('../utils/datetime');
  let total = 0;
  for (const r of rows) {
    const s = ymd(r.start_date) > startYmd ? ymd(r.start_date) : startYmd;
    const e = ymd(r.end_date) < endYmd ? ymd(r.end_date) : endYmd;
    if (r.unit === 'full_day') { total += countWorkdays(s, e, c); continue; }
    if (isWorkday(s, c)) total += Number(r.days_charged || 0);   // 반차·시간은 하루짜리다
  }
  return { holiday_days: holiday_list.length, holiday_list, leave_days: Math.round(total * 10) / 10, work_weekdays };
}

/** 옛 호출부 호환 — 휴가 일수만. */
async function getLeaveDaysInRange(userId, businessId, startYmd, endYmd) {
  if (!userId) return 0;
  return (await getDeductionsInRange(userId, businessId, startYmd, endYmd)).leave_days;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 그 주의 실질 가용시간. 기존 키(weekly 등)는 그대로 두고 키만 **추가**한다.
 *   work_days        = max(0, days − 수동휴일 − 공휴일 − 휴가)
 *   weekly_effective = daily × work_days × rate   (곱을 한 번만 반올림 — weeklyHours 와 같은 순서)
 * 휴일·휴가가 0 이면 work_days = days − holidays → weekly_effective === weekly (불변 조건).
 */
async function getMemberCapacityForWeek(userId, businessId, weekStartYmd) {
  const cap = await getMemberCapacity(userId, businessId);
  const base = Math.max(0, cap.days - cap.holidays);
  if (!weekStartYmd) {
    return {
      ...cap, leave_days: 0, leave_deduction: 0, holiday_days: 0, holiday_list: [], holiday_deduction: 0,
      work_days: base, work_weekdays: [1, 2, 3, 4, 5], weekly_effective: cap.weekly,
    };
  }
  const d = await getDeductionsInRange(userId, businessId, weekStartYmd, addDays(weekStartYmd, 6));
  const holidayDays = Math.min(d.holiday_days, base);
  const leaveDays = Math.min(d.leave_days, base - holidayDays);
  const workDays = Math.max(0, Math.round((base - holidayDays - leaveDays) * 10) / 10);
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    ...cap,
    leave_days: leaveDays, leave_deduction: r1(cap.daily * cap.rate * leaveDays),
    holiday_days: holidayDays, holiday_list: d.holiday_list, holiday_deduction: r1(cap.daily * cap.rate * holidayDays),
    work_days: workDays, work_weekdays: d.work_weekdays,
    weekly_effective: weeklyHours({ daily: cap.daily, days: workDays, rate: cap.rate, holidays: 0 }),
  };
}

/** 기간 가용시간에서 공휴일·휴가를 뺀 값 — 월간·단위 보고서용. 0 아래로는 내려가지 않는다.
 *  (#424 전 이름 periodHoursWithLeave — 휴일까지 빼게 되어 이름을 넓혔다. 이름이 동작보다 좁으면 다음 사람이 속는다.) */
async function periodHoursEffective(userId, businessId, cap, startYmd, endYmd) {
  const base = periodHours(cap.weekly, startYmd, endYmd);
  const d = await getDeductionsInRange(userId, businessId, startYmd, endYmd);
  const days = d.holiday_days + d.leave_days;
  if (!days) return base;
  const deduction = (Number(cap.daily) || 0) * (Number(cap.rate) || 0) * days;
  return Math.max(0, Math.round((base - deduction) * 10) / 10);
}

module.exports = {
  getMemberCapacity, weeklyHours, periodHours,
  getDeductionsInRange, getLeaveDaysInRange, getMemberCapacityForWeek, periodHoursEffective,
};
