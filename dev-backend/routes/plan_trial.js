// 체험 플랜 고르기·바꾸기 처리기 — routes/plan.js 에서 뗐다(2026-11-25 god-file 래칫 · 동작 불변).
//   마운트는 그대로 routes/plan.js 의 POST /:businessId/trial-plan · /start-trial (같은 처리기 한 벌).
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const billing = require('../services/billing');
const { planAtLeast, newTrialBusinessFields, trialDaysFor, TEAM_TRIAL_PLAN_CODES } = require('../config/plans');
const { sequelize } = require('../config/database');

async function blockIfExempt(businessId, res) {
  const { exempt } = await planEngine.getBusinessPlan(businessId);
  if (exempt) { errorResponse(res, 'billing_exempt', 400); return true; }
  return false;
}

// ─── 체험 플랜 고르기·바꾸기 (2026-10-09 Fable 설계 3 — 옛 start-trial 을 일반화) ───
// body: { plan_code: starter|basic|pro }
//   ① 옛 free(체험 이력 없음) 워크스페이스 → 고른 플랜으로 14일 체험 시작(종전 start-trial 동작)
//   ② 체험 중(결제 0건) → 결제 없이 플랜만 바꾼다. **체험 종료일은 그대로** — 바꿔서 체험이 늘지 않는다.
//      내릴 때는 지금 사용량이 목표 한도 안이어야 한다(409 over_limit). 이미 만든 미결제 사전청구는 옛 금액이라 닫는다
//      (cron 이 다음 날 새 플랜으로 다시 만든다).
// 판정은 planEngine.canSwitchTrialPlan 한 곳 — /status 의 trial_plan_switch 와 같은 함수.
async function trialPlanHandler(req, res, next) {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    if (await blockIfExempt(businessId, res)) return;
    const { plan_code } = req.body || {};
    if (!planEngine.isTrialPlanCode(plan_code)) return errorResponse(res, 'invalid_plan_code', 400);
    const { biz } = await planEngine.getBusinessPlan(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    // ① 무료 → 체험
    //   체험 이력 없음(옛 free) → 고른 플랜으로 체험(종전 start-trial 동작).
    //   체험을 이미 썼으면 «30일 팀 체험»(Basic·Pro) 한 번만 — 판정 planEngine.teamTrialAvailability 한 곳(= /status team_trial).
    if (biz.plan === 'free') {
      if (biz.trial_ends_at) {
        if (!TEAM_TRIAL_PLAN_CODES.includes(plan_code)) return errorResponse(res, 'trial_already_used', 400);
        const gate = await planEngine.teamTrialAvailability(businessId);
        if (!gate.available) return errorResponse(res, `team_trial_${gate.reason}`, 400);
      }
      const fields = newTrialBusinessFields(plan_code);
      await planEngine.changePlan(businessId, {
        toPlan: fields.plan, reason: 'trial_start', changedBy: req.user.id,
        note: `${trialDaysFor(fields.plan)}일 무료 체험 시작 (${fields.plan})`, trialEndsAt: fields.trial_ends_at,
        subscriptionStatus: 'trialing',
      });
      planEngine.invalidateBusinessCache(businessId);
      require('../services/auditService').logAudit(req, {
        action: 'plan.trial_start', targetType: 'business', targetId: businessId, businessId,
        oldValue: { plan: 'free' }, newValue: { plan: fields.plan, trial_ends_at: fields.trial_ends_at },
      });
      return successResponse(res, { plan_code: fields.plan, trial_ends_at: fields.trial_ends_at });
    }

    // ② 체험 중 전환
    const gate = await planEngine.canSwitchTrialPlan(businessId);
    if (!gate.available) return errorResponse(res, `trial_switch_${gate.reason}`, 400);
    if (biz.plan === plan_code) return successResponse(res, { plan_code, trial_ends_at: biz.trial_ends_at, unchanged: true });

    if (!planAtLeast(plan_code, biz.plan)) {
      const exceeds = await planEngine.usageExceedsPlan(businessId, plan_code);
      if (exceeds.length) {
        return res.status(409).json({ success: false, message: 'over_limit', data: { exceeds } });
      }
    }

    const fromPlan = biz.plan;
    const t = await sequelize.transaction();
    try {
      // 옛 플랜 금액으로 만든 미결제 사전청구를 닫는다 — 결제 확정과 같은 «교체» 표시(billing.replacePendingCheckout).
      const replaced = await billing.replacePendingCheckout(businessId, t);
      await planEngine.changePlan(businessId, {
        // 이력 reason 은 ENUM 이라 새 값을 넣으면 운영 스키마 변경이 필요하다 — 체험 (재)시작으로 남기고 note·감사로 가른다.
        toPlan: plan_code, reason: 'trial_start', changedBy: req.user.id,
        note: `체험 플랜 변경 ${fromPlan} → ${plan_code}`,
        trialEndsAt: biz.trial_ends_at, subscriptionStatus: 'trialing', transaction: t,
      });
      await t.commit();
      planEngine.invalidateBusinessCache(businessId);
      require('../services/auditService').logAudit(req, {
        action: 'plan.trial_plan_change', targetType: 'business', targetId: businessId, businessId,
        oldValue: { plan: fromPlan }, newValue: { plan: plan_code, trial_ends_at: biz.trial_ends_at, replaced_pending: replaced },
      });
      return successResponse(res, { plan_code, trial_ends_at: biz.trial_ends_at, replaced_pending: replaced });
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) { next(error); }
}

module.exports = { trialPlanHandler };
