// 플랜 API — 현재 플랜 조회 + 카탈로그 + 변경 + 체험 시작 + 예약 다운그레이드 + 이력
const express = require('express');
const router = express.Router();
const { BusinessPlanHistory, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const { PLANS, PLAN_ORDER, toPublicJson, planAtLeast } = require('../config/plans');

// ─── 카탈로그 (공개) ───
router.get('/catalog', authenticateToken, async (req, res, next) => {
  try {
    const catalog = PLAN_ORDER.map(code => toPublicJson(code));
    successResponse(res, catalog);
  } catch (error) { next(error); }
});

// ─── 비즈니스 현재 플랜 + 사용량 + 이력 요약 ───
router.get('/:businessId/status', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const [{ plan, biz, active, inTrial, inGrace, trialEndsAt, graceEndsAt }, usage, historyRows] = await Promise.all([
      planEngine.getBusinessPlan(businessId),
      planEngine.getUsage(businessId),
      BusinessPlanHistory.findAll({
        where: { business_id: businessId },
        include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        limit: 10
      })
    ]);

    successResponse(res, {
      plan: toPublicJson(plan.code),
      active,
      in_trial: !!inTrial,
      in_grace: !!inGrace,
      trial_ends_at: trialEndsAt || null,
      grace_ends_at: graceEndsAt || null,
      plan_expires_at: biz ? biz.plan_expires_at : null,
      scheduled_plan: biz ? biz.scheduled_plan : null,
      subscription_status: biz ? biz.subscription_status : null,
      usage,
      history: historyRows.map(h => ({
        id: h.id,
        from_plan: h.from_plan,
        to_plan: h.to_plan,
        reason: h.reason,
        changed_by: h.changer ? h.changer.name : null,
        note: h.note,
        effective_at: h.effective_at,
      }))
    });
  } catch (error) { next(error); }
});

// ─── 체험 시작 (Starter 이상, 14일) ───
// 조건: 현재 free + trial_ends_at 비어있음 (재체험 방지)
router.post('/:businessId/start-trial', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 요금제 변경은 owner 또는 platform_admin 만
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const { plan_code } = req.body || {};
    if (!plan_code || !['starter', 'basic', 'pro'].includes(plan_code)) {
      return errorResponse(res, 'invalid_plan_code', 400);
    }
    const { biz } = await planEngine.getBusinessPlan(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    if (biz.plan !== 'free') return errorResponse(res, 'already_on_paid_plan', 400);
    if (biz.trial_ends_at) return errorResponse(res, 'trial_already_used', 400);

    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await planEngine.changePlan(businessId, {
      toPlan: plan_code,
      reason: 'trial_start',
      changedBy: req.user.id,
      note: `14일 무료 체험 시작 (${plan_code})`,
      trialEndsAt: trialEnd,
    });
    // subscription_status = 'trialing'
    biz.subscription_status = 'trialing';
    await biz.save();
    planEngine.invalidateBusinessCache(businessId);

    successResponse(res, { plan_code, trial_ends_at: trialEnd });
  } catch (error) { next(error); }
});

// ─── 플랜 변경 (결제 완료 후 — 현재는 Owner 또는 Admin 만) ───
// 결제 시스템 연동 전 임시. 실제 production 은 결제 콜백에서만 호출.
router.post('/:businessId/change', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const { to_plan, billing_cycle = 'monthly' } = req.body || {};
    if (!to_plan || !PLANS[to_plan]) return errorResponse(res, 'invalid_plan', 400);
    if (!['monthly', 'yearly'].includes(billing_cycle)) return errorResponse(res, 'invalid_billing_cycle', 400);

    const { biz, plan: currentPlan } = await planEngine.getBusinessPlan(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    const isUpgrade = planAtLeast(to_plan, currentPlan.code) && to_plan !== currentPlan.code;
    const isDowngrade = !isUpgrade && to_plan !== currentPlan.code;

    if (isDowngrade) {
      // 다운그레이드는 결제주기 말 적용 예약
      const scheduledAt = biz.plan_expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      biz.scheduled_plan = to_plan;
      biz.plan_expires_at = scheduledAt;
      await biz.save();
      planEngine.invalidateBusinessCache(businessId);
      return successResponse(res, {
        scheduled: true,
        scheduled_plan: to_plan,
        effective_at: scheduledAt,
      }, `${scheduledAt.toISOString().slice(0, 10)} 에 ${to_plan} 로 전환 예약됨`);
    }

    // 업그레이드는 즉시 적용 (결제 완료 가정)
    const days = billing_cycle === 'yearly' ? 365 : 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await planEngine.changePlan(businessId, {
      toPlan: to_plan,
      reason: 'upgrade',
      changedBy: req.user.id,
      note: `${billing_cycle} 결제로 ${to_plan} 업그레이드`,
      expiresAt,
      trialEndsAt: null,
      graceEndsAt: null,
      scheduledPlan: null,
    });
    if (biz.subscription_status !== 'active') {
      biz.subscription_status = 'active';
      await biz.save();
    }
    planEngine.invalidateBusinessCache(businessId);
    successResponse(res, {
      upgraded: true,
      plan: to_plan,
      billing_cycle,
      expires_at: expiresAt,
    });
  } catch (error) { next(error); }
});

// ─── 예약 다운그레이드 취소 (owner-only) ───
router.post('/:businessId/cancel-schedule', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
    return errorResponse(res, 'owner_only', 403);
  }
  try {
    const businessId = Number(req.params.businessId);
    const { biz } = await planEngine.getBusinessPlan(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    if (!biz.scheduled_plan) return errorResponse(res, 'no_scheduled_change', 400);
    const scheduled = biz.scheduled_plan;
    biz.scheduled_plan = null;
    await biz.save();
    await BusinessPlanHistory.create({
      business_id: businessId,
      from_plan: biz.plan,
      to_plan: biz.plan,
      reason: 'admin_adjust',
      changed_by: req.user.id,
      note: `예약 다운그레이드 취소 (${scheduled} 예정 → 취소)`,
      effective_at: new Date(),
    });
    planEngine.invalidateBusinessCache(businessId);
    successResponse(res, { canceled_scheduled_plan: scheduled });
  } catch (error) { next(error); }
});

module.exports = router;
