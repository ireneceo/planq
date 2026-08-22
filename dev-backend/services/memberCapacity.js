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

/** 기간 [start,end] 과 겹치는 승인 휴가의 차감일 합. 휴가가 없으면 0 → 기존 값과 diff 0. */
async function getLeaveDaysInRange(userId, businessId, startYmd, endYmd) {
  if (!userId || !businessId || !startYmd || !endYmd) return 0;
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
  const dayNum = (v) => Math.floor(Date.parse(`${ymd(v)}T00:00:00Z`) / 86400000);
  let total = 0;
  for (const r of rows) {
    const charged = Number(r.days_charged || 0);
    if (r.unit !== 'full_day') { total += charged; continue; }   // 반차·시간은 하루짜리다
    // 기간 휴가가 조회 구간에 걸쳐 있으면 **겹친 만큼만** 센다.
    //   안 그러면 2주짜리 휴가가 두 주 모두에서 전체 일수로 빠져 이중 차감된다.
    const s = Math.max(dayNum(r.start_date), dayNum(startYmd));
    const e = Math.min(dayNum(r.end_date), dayNum(endYmd));
    const overlap = Math.max(0, e - s + 1);
    const span = Math.max(1, dayNum(r.end_date) - dayNum(r.start_date) + 1);
    total += charged * (overlap / span);
  }
  return Math.round(total * 10) / 10;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 그 주의 실질 가용시간. 기존 키(weekly 등)는 그대로 두고 키만 **추가**한다 —
 * 아직 안 고친 소비처가 있어도 값이 변하지 않는다(회귀 0).
 */
async function getMemberCapacityForWeek(userId, businessId, weekStartYmd) {
  const cap = await getMemberCapacity(userId, businessId);
  if (!weekStartYmd) return { ...cap, leave_days: 0, leave_deduction: 0, weekly_effective: cap.weekly };
  const leaveDays = await getLeaveDaysInRange(userId, businessId, weekStartYmd, addDays(weekStartYmd, 6));
  const deduction = Math.round(cap.daily * cap.rate * leaveDays * 10) / 10;
  const weekly_effective = Math.max(0, Math.round((cap.weekly - deduction) * 10) / 10);
  return { ...cap, leave_days: leaveDays, leave_deduction: deduction, weekly_effective };
}

/** 기간 가용시간에서 휴가를 뺀 값 — 월간·보고서용. 0 아래로는 내려가지 않는다. */
async function periodHoursWithLeave(userId, businessId, weekly, daily, rate, startYmd, endYmd) {
  const base = periodHours(weekly, startYmd, endYmd);
  const leaveDays = await getLeaveDaysInRange(userId, businessId, startYmd, endYmd);
  if (!leaveDays) return base;
  const deduction = (Number(daily) || 0) * (Number(rate) || 0) * leaveDays;
  return Math.max(0, Math.round((base - deduction) * 10) / 10);
}

module.exports = {
  getMemberCapacity, weeklyHours, periodHours,
  getLeaveDaysInRange, getMemberCapacityForWeek, periodHoursWithLeave,
};
