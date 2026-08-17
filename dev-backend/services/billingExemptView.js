// 결제 면제 — **조회/집계용 술어 한 벌** (운영 #275).
//
// 왜 있는가 (Fable 검증 M1)
//   면제 판정이 두 갈래로 갈라져 있었다:
//     · 행 단위: `isExemptNow()` — billing_exempt_until 경과를 본다
//     · 집계:    `WHERE billing_exempt = true` — 경과를 **안 본다**
//   그래서 종료일이 지나 정상 과금이 재개된 워크스페이스가 요약 KPI 에서는 계속 면제로 빠지고,
//   같은 응답의 행 단위 값은 면제가 아니라고 말하는 **자기모순**이 났다.
//   (memory `feedback_predicate_must_match_both_sides`)
//
// ★ 정본은 `services/plan.js getBusinessPlan()` 의 `exemptActive` 다.
//   여기 것은 그 술어를 **조회 계층에서 재현**한 것으로, 조건이 반드시 같아야 한다:
//     billing_exempt && (billing_exempt_until 이 없거나 아직 미래)
//   plan.js 쪽 조건을 바꾸면 여기도 같이 바꿀 것.
const { Op } = require('sequelize');

/** 이 워크스페이스가 **지금** 면제 상태인가. (Business 인스턴스 또는 raw row) */
function isExemptNow(biz) {
  if (!biz || !biz.billing_exempt) return false;
  if (!biz.billing_exempt_until) return true;
  return new Date(biz.billing_exempt_until).getTime() > Date.now();
}

/** 집계용 where 절 — 위 술어와 **같은 조건**을 SQL 로. */
function exemptWhere() {
  return {
    billing_exempt: true,
    [Op.or]: [
      { billing_exempt_until: null },
      { billing_exempt_until: { [Op.gt]: new Date() } },
    ],
  };
}

/**
 * 지금 면제 중인 워크스페이스 id 배열.
 * 집계에서 면제분을 분리할 때 쓴다 — raw 플래그로 직접 조회하지 말 것(M1 재발).
 */
async function exemptBusinessIds() {
  const { Business } = require('../models');
  const rows = await Business.findAll({ attributes: ['id'], where: exemptWhere(), raw: true });
  return rows.map((b) => b.id);
}

/**
 * 살아있는(soft-delete 안 된) 워크스페이스 id 배열.
 * 목록은 `required: true` + `where deleted_at` 로 거르는데 집계는 조인이 없으므로,
 * 같은 기준을 여기서 한 벌로 제공한다 — 목록과 숫자가 어긋나면 화면이 거짓말한다.
 */
async function liveBusinessIds() {
  const { Business } = require('../models');
  const rows = await Business.findAll({ attributes: ['id'], where: { deleted_at: null }, raw: true });
  return rows.map((b) => b.id);
}

module.exports = { isExemptNow, exemptWhere, exemptBusinessIds, liveBusinessIds };
