// 관리자(admin)의 구독 결제 — 대표가 아닌 사람이 결제를 시작할 때만 거는 두 가지 (Fable 2026-11-16 B1·B2).
//   결제(지불)는 대표·관리자 둘 다(2026-11-16 Irene «관리자도 결제할 수 있어야» — routes/plan.js isWorkspaceAdminReq).
//   B2 «플랜 내리기는 대표만» 이 결제로 우회되지 않게 지금 플랜보다 낮은 플랜은 거절.
//   B1 새 결제는 미결제 구독을 replaced 로 밀어 그 청구를 닫는다(billing.replacePendingCheckout) — 이미 «입금했어요» 했거나
//      카드 결제창이 열린 청구가 있으면, 그 사실을 모르는 관리자가 취소시키지 않게 거절하고 그 청구를 알려 준다.
//   대표·플랫폼 관리자는 종전 동작 그대로(null).
// 반환: null(통과) | { status, body }
const { Op } = require('sequelize');
const { Payment } = require('../models');
const planEngine = require('./plan');
const { planAtLeast } = require('../config/plans');

async function adminCheckoutDenial(req, businessId, planCode) {
  if (req.businessRole === 'owner' || req.user?.platform_role === 'platform_admin') return null;
  const { plan: currentPlan } = await planEngine.getBusinessPlan(businessId);
  if (currentPlan && !planAtLeast(planCode, currentPlan.code)) {
    return { status: 403, body: { success: false, message: 'downgrade_owner_only' } };
  }
  const frozen = await Payment.findOne({
    where: {
      business_id: businessId, kind: 'plan', status: 'pending',
      [Op.or]: [{ notify_paid_at: { [Op.ne]: null } }, { stripe_session_id: { [Op.ne]: null } }],
    },
    order: [['id', 'DESC']],
  });
  if (frozen) return { status: 409, body: { success: false, message: 'payment_in_progress', data: { payment_id: frozen.id } } };
  return null;
}

module.exports = { adminCheckoutDenial };
