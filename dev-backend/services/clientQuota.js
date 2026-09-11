// services/clientQuota.js — 플랜 한도에 **세는 고객**의 술어 단일 원천 (docs/Q_SALE_DESIGN.md §3.6·§16.4)
//
// 왜 한 파일인가: plan.js 의 사용량(getUsage) 과 게이트(can('add_client')) 가 각자
//   `Client.count({business_id})` 를 불렀다 — 같은 값의 공식 두 벌. 화면 숫자와 실제 가능 여부가
//   갈라지는 모양이라(memory feedback_same_value_multiple_formulas) 이번에 모은다.
//
// 한도 규칙 (Irene 결정 1 · 사이클 1a):
//   · 정식 고객 = **기존 계수 술어에서 prospect 만 뺀 것.** archived 를 세는 옛 동작은 그대로 둔다
//     (바꾸면 기존 워크스페이스 숫자가 조용히 변한다 — 바꿀지는 실측 뒤 따로 결정, Fable 2026-09-11).
//   · 문의 고객(prospect, Q sale 에서 게스트로 정보만 저장) = 별도 상한 prospects_max.
//   · status 는 NULL 허용 컬럼이다 — `status != 'prospect'` 만 쓰면 SQL 이 NULL 행을 빼 버린다.
const { Op } = require('sequelize');

function billableClientWhere(businessId) {
  return {
    business_id: businessId,
    [Op.or]: [{ status: null }, { status: { [Op.ne]: 'prospect' } }],
  };
}

function prospectWhere(businessId) {
  return { business_id: businessId, status: 'prospect' };
}

module.exports = { billableClientWhere, prospectWhere };
