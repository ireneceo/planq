// memberCost — 멤버 **시간당 원가** 단일 원천 (운영 #211 후속, Irene 승인 2026-08-18)
//
// 왜 이 파일이 생겼나:
//   `services/stats.js:577` 이 수익성 탭의 인건비를 `hours * 50000` — **전 직원 시간당 5만원 고정**
//   으로 계산하고 있었다. 주석은 "hourly_rate 컬럼 추후" 라고 되어 있었는데
//   `BusinessMember.hourly_rate` · `monthly_salary` 는 **이미 존재했다**(주석에 "청구/수익성 계산용",
//   "내부 원가 계산용" 이라고까지 적혀 있다). 읽는 API·쓰는 API·입력 화면이 전부 없어서
//   아무도 못 쓰고 있었을 뿐이다.
//   → 돈에 관한 화면에서 가정값이 진짜 숫자처럼 보이고 있었다.
//
// Irene 결정 (2026-08-18):
//   "단가 미입력 멤버는 인건비에서 **제외**하고 경고를 띄운다. 워크스페이스 기본단가로 채우지 않는다."
//   근거: 돈 화면에서 그럴듯한 가짜 숫자가 가장 위험하다 — 지금 문제가 정확히 그것이었다.
//
// ★ 월급 → 시간당 환산에 **새 공식을 만들지 않는다.** 주간 가용시간은 `memberCapacity` 정본을 쓴다.
//   (가용시간이 3벌로 갈라져 화면 30h·보고서 40h 가 나왔던 전례를 반복하지 않는다.)
const { BusinessMember } = require('../models');
const { weeklyHours } = require('./memberCapacity');

// 한 달 평균 주 수 (52주 / 12개월). 월급 → 주 → 시간 환산에만 쓴다.
const WEEKS_PER_MONTH = 52 / 12;   // 4.3333…

/**
 * 워크스페이스 멤버들의 시간당 원가 맵.
 *
 * 결정 순서 (위에서 먼저 맞는 것):
 *   1) hourly_rate 가 있으면 그 값                      → source 'hourly'
 *   2) monthly_salary 가 있으면 salary ÷ (주간가용 × 4.33) → source 'salary'
 *   3) 둘 다 없으면 **null**                             → source null (인건비 계산에서 제외)
 *
 * @returns Map<user_id, { cost: number|null, source: 'hourly'|'salary'|null }>
 */
async function getMemberCostMap(businessId) {
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: [
      'user_id', 'hourly_rate', 'monthly_salary',
      // 월급 환산에 필요한 가용시간 입력값 — memberCapacity 와 같은 필드를 읽는다.
      'daily_work_hours', 'weekly_work_days', 'participation_rate', 'weekly_holidays',
    ],
    raw: true,
  });

  const map = new Map();
  for (const r of rows) {
    if (!r.user_id) continue;

    const hourly = Number(r.hourly_rate);
    if (Number.isFinite(hourly) && hourly > 0) {
      map.set(r.user_id, { cost: hourly, source: 'hourly' });
      continue;
    }

    const salary = Number(r.monthly_salary);
    if (Number.isFinite(salary) && salary > 0) {
      // ★ 주간 가용시간은 정본 공식으로. 여기서 daily × days 를 직접 곱하지 않는다.
      const weekly = weeklyHours({
        daily: Number(r.daily_work_hours) || 8,
        days: Number(r.weekly_work_days) || 5,
        rate: Number(r.participation_rate) || 1,
        holidays: Number(r.weekly_holidays) || 0,
      });
      const monthlyHours = weekly * WEEKS_PER_MONTH;
      if (monthlyHours > 0) {
        map.set(r.user_id, { cost: salary / monthlyHours, source: 'salary' });
        continue;
      }
      // 가용시간이 0 이면(전부 휴일 등) 환산 불가 — 가짜 숫자를 만들지 않고 미입력으로 둔다.
    }

    map.set(r.user_id, { cost: null, source: null });
  }
  return map;
}

/**
 * 담당자별 시간 → 인건비. **단가가 없는 멤버의 시간은 합산하지 않고 따로 센다.**
 *
 * @param hoursByUser Map<user_id, hours> | 평범한 객체
 * @param costMap     getMemberCostMap 결과
 * @returns { cost, uncostedHours, uncostedUserIds, costedHours }
 */
function computeLaborCost(hoursByUser, costMap) {
  let cost = 0;
  let costedHours = 0;
  let uncostedHours = 0;
  const uncostedUserIds = new Set();

  const entries = hoursByUser instanceof Map
    ? [...hoursByUser.entries()]
    : Object.entries(hoursByUser || {}).map(([k, v]) => [Number(k), v]);

  for (const [userId, rawHours] of entries) {
    const hours = Number(rawHours) || 0;
    if (hours <= 0) continue;
    const entry = userId ? costMap.get(Number(userId)) : null;
    // ★ 담당자가 없는 시간(assignee_id null)도 '미입력' 으로 센다 — 누구 시간인지 모르면
    //   단가를 붙일 수 없고, 조용히 0원으로 처리하면 이익이 부풀려진다.
    if (!entry || entry.cost == null) {
      uncostedHours += hours;
      if (userId) uncostedUserIds.add(Number(userId));
      continue;
    }
    cost += hours * entry.cost;
    costedHours += hours;
  }

  return {
    cost: Math.round(cost),
    costedHours: Math.round(costedHours * 10) / 10,
    uncostedHours: Math.round(uncostedHours * 10) / 10,
    uncostedUserIds: [...uncostedUserIds],
  };
}

module.exports = { getMemberCostMap, computeLaborCost, WEEKS_PER_MONTH };
