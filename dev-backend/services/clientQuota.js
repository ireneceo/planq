// services/clientQuota.js — 플랜 한도에 **세는 고객**의 술어 단일 원천 (docs/Q_SALE_DESIGN.md §3.6·§16.4)
//
// 왜 한 파일인가: plan.js 의 사용량(getUsage) 과 게이트(can('add_client')) 가 각자
//   `Client.count({business_id})` 를 불렀다 — 같은 값의 공식 두 벌. 화면 숫자와 실제 가능 여부가
//   갈라지는 모양이라(memory feedback_same_value_multiple_formulas) 이번에 모은다.
//
// 한도 규칙 (2026-11-15 Irene · Fable 설계 DESIGN-READY):
//   > *"초대해서 입장한 고객이 아니면 한도도달 아닌건데 … Q sales에 나오는 고객은 DB일 뿐인데"*
//   · 한도에 세는 고객 = **초대를 받아 입장한 고객** = status 'active' + 계정 연결(user_id).
//     고객 접근 판정(access_scope — `user_id = me AND status = 'active'`)과 같은 집합이다.
//   · 세지 않는다: 직접 관리(managed, 정보만) · 문의(prospect) · 초대 대기(invited) · 보관/멤버 전환(archived) · status NULL.
//   · 대기 초대를 세지 않으므로 게이트는 두 곳 — 초대 보낼 때(plan.can('add_client')) + **입장할 때**(services/invites.js).
//   · 문의 고객(prospect) 은 별도 상한 prospects_max.
//
// registeredClientWhere — «정식 고객을 등록했나» 를 보는 **지표**용(여정·온보딩·활성화 단계·문의 깔때기).
//   한도와 뜻이 다르다. 옛 한도 술어(prospect 만 뺀 집합)를 그대로 둔다 — 바꾸면 지표가 조용히 0 으로 떨어진다.
//   status 는 NULL 허용 컬럼이다 — `status != 'prospect'` 만 쓰면 SQL 이 NULL 행을 빼 버린다.
const { Op } = require('sequelize');

function billableClientWhere(businessId) {
  return {
    business_id: businessId,
    status: 'active',
    user_id: { [Op.ne]: null },
  };
}

function registeredClientWhere(businessId) {
  return {
    business_id: businessId,
    [Op.or]: [{ status: null }, { status: { [Op.ne]: 'prospect' } }],
  };
}

function prospectWhere(businessId) {
  return { business_id: businessId, status: 'prospect' };
}

module.exports = { billableClientWhere, registeredClientWhere, prospectWhere };
