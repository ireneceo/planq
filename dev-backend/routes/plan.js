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

// ─── PlanQ SaaS 결제 계좌 (자체결제 P-2 — 사용자가 PlanQ 구독료 송금) ───
// 환경변수 PLANQ_BILLING_BANK_* 가 미설정이면 null 반환 (CheckoutModal 이 fallback 메시지 표시)
router.get('/bank-info', authenticateToken, async (req, res, next) => {
  try {
    const name = process.env.PLANQ_BILLING_BANK_NAME || null;
    const account = process.env.PLANQ_BILLING_BANK_ACCOUNT || null;
    const holder = process.env.PLANQ_BILLING_BANK_HOLDER || null;
    if (!name || !account) return successResponse(res, null);
    return successResponse(res, { name, account, holder });
  } catch (error) { next(error); }
});

// ─── 비즈니스 현재 플랜 + 사용량 + 이력 요약 ───
router.get('/:businessId/status', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { Op } = require('sequelize');
    // P-2: 활성 Subscription + pending Payment 조회 (자체 결제 흐름)
    const SubscriptionModel = require('../models').Subscription;
    const PaymentModel = require('../models').Payment;

    const [{ plan, biz, active, inTrial, inGrace, trialEndsAt, graceEndsAt }, usage, historyRows, subscription, pendingPayment, recentPayments] = await Promise.all([
      planEngine.getBusinessPlan(businessId),
      planEngine.getUsage(businessId),
      BusinessPlanHistory.findAll({
        where: { business_id: businessId },
        include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        limit: 10
      }),
      SubscriptionModel.findOne({
        where: { business_id: businessId, status: { [Op.in]: ['pending', 'active', 'past_due', 'grace'] } },
        order: [['created_at', 'DESC']],
      }),
      PaymentModel.findOne({
        where: { business_id: businessId, status: 'pending' },
        order: [['created_at', 'DESC']],
      }),
      PaymentModel.findAll({
        where: { business_id: businessId, status: { [Op.in]: ['paid', 'refunded'] } },
        order: [['paid_at', 'DESC']],
        limit: 5,
      }),
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
      // P-2 자체 결제 정보
      subscription: subscription ? {
        id: subscription.id,
        plan_code: subscription.plan_code,
        cycle: subscription.cycle,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        next_billing_at: subscription.next_billing_at,
        grace_ends_at: subscription.grace_ends_at,
      } : null,
      pending_payment: pendingPayment ? {
        id: pendingPayment.id,
        subscription_id: pendingPayment.subscription_id,
        method: pendingPayment.method,
        amount: pendingPayment.amount,
        currency: pendingPayment.currency,
        cycle: pendingPayment.cycle,
        created_at: pendingPayment.created_at,
      } : null,
      recent_payments: recentPayments.map(p => ({
        id: p.id, subscription_id: p.subscription_id,
        amount: p.amount, currency: p.currency, cycle: p.cycle,
        status: p.status, paid_at: p.paid_at,
        period_start: p.period_start, period_end: p.period_end,
        payer_name: p.payer_name, method: p.method,
      })),
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

// ════════════════════════════════════════════════════════════
// P-2 자체 결제 — Subscription / Payment 흐름
// ════════════════════════════════════════════════════════════

const billing = require('../services/billing');
const { Subscription, Payment } = require('../models');

// ─── 결제 요청 — 신규 Subscription + pending Payment 생성 + 입금 안내 ───
// body: { plan_code: 'starter'|'basic'|'pro', cycle: 'monthly'|'yearly' }
router.post('/:businessId/checkout', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const { plan_code, cycle = 'monthly', currency = 'KRW' } = req.body || {};
    if (!plan_code || !PLANS[plan_code]) return errorResponse(res, 'invalid_plan_code', 400);
    if (!['monthly', 'yearly'].includes(cycle)) return errorResponse(res, 'invalid_cycle', 400);
    if (plan_code === 'free') return errorResponse(res, 'use_downgrade_for_free', 400);

    const result = await billing.createPendingSubscription({
      businessId, planCode: plan_code, cycle, userId: req.user.id, currency,
    });
    return successResponse(res, {
      subscription_id: result.subscription.id,
      payment_id: result.payment.id,
      amount: result.payment.amount,
      currency: result.payment.currency,
      status: result.payment.status,
    });
  } catch (err) { next(err); }
});

// ─── admin mark-paid (워크스페이스 owner 가 입금 확인) ───
// body: { payer_name?, payer_memo? }
router.post('/:businessId/payments/:paymentId/mark-paid', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const pay = await Payment.findOne({ where: { id: paymentId, business_id: businessId } });
    if (!pay) return errorResponse(res, 'payment_not_found', 404);

    const result = await billing.markPaymentPaid({
      paymentId, markedByUserId: req.user.id,
      payerName: req.body?.payer_name, payerMemo: req.body?.payer_memo,
    });
    return successResponse(res, {
      payment: result.payment.toJSON(),
      subscription: result.subscription.toJSON(),
    });
  } catch (err) { next(err); }
});

// ─── 결제 이력 조회 ───
router.get('/:businessId/payments', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const rows = await Payment.findAll({
      where: { business_id: businessId },
      include: [{ model: Subscription, attributes: ['plan_code', 'cycle', 'status'] }],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    return successResponse(res, rows.map(r => r.toJSON()));
  } catch (err) { next(err); }
});

// ─── 영수증 PDF ───
router.get('/:businessId/payments/:paymentId/receipt.pdf', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const pay = await Payment.findOne({ where: { id: paymentId, business_id: businessId } });
    if (!pay) return errorResponse(res, 'payment_not_found', 404);
    if (pay.status !== 'paid') return errorResponse(res, 'not_paid_yet', 400);
    const pdf = await billing.buildReceiptPdf(paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${pay.id}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ─── 현재 활성 구독 조회 ───
router.get('/:businessId/subscription', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const sub = await billing.getCurrentSubscription(businessId);
    return successResponse(res, sub ? sub.toJSON() : null);
  } catch (err) { next(err); }
});

// ─── cron 수동 트리거 (platform_admin only) ───
router.post('/cron/run', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.platform_role !== 'platform_admin') return errorResponse(res, 'admin_only', 403);
    const stats = await billing.runDailyBillingCron();
    return successResponse(res, stats);
  } catch (err) { next(err); }
});

module.exports = router;
