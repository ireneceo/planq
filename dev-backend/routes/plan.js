// 플랜 API — 현재 플랜 조회 + 카탈로그 + 변경 + 체험 시작 + 예약 다운그레이드 + 이력
const express = require('express');
const router = express.Router();
const { BusinessPlanHistory, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const { PLANS, PLAN_ORDER, ADDONS, toPublicJson, planAtLeast, getAddon, listAddonsForPlan } = require('../config/plans');

// ─── 카탈로그 (공개) ───
router.get('/catalog', authenticateToken, async (req, res, next) => {
  try {
    const catalog = PLAN_ORDER.map(code => toPublicJson(code));
    successResponse(res, catalog);
  } catch (error) { next(error); }
});

// ─── PlanQ SaaS 결제 계좌 (자체결제 P-2) ───
// emailService.getPlanqBankInfo() 단일 헬퍼 경유. platform_settings 우선 + .env fallback
// + placeholder 가드 ('<예: ...>' 같은 example 복사 사고 차단).
router.get('/bank-info', authenticateToken, async (req, res, next) => {
  try {
    const { getPlanqBankInfo } = require('../services/emailService');
    const bank = await getPlanqBankInfo();
    if (!bank.configured) return successResponse(res, null);
    return successResponse(res, { name: bank.name, account: bank.account, holder: bank.holder });
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
    const { plan_code, cycle = 'monthly', currency = 'KRW', tax_invoice } = req.body || {};
    if (!plan_code || !PLANS[plan_code]) return errorResponse(res, 'invalid_plan_code', 400);
    if (!['monthly', 'yearly'].includes(cycle)) return errorResponse(res, 'invalid_cycle', 400);
    if (plan_code === 'free') return errorResponse(res, 'use_downgrade_for_free', 400);

    const result = await billing.createPendingSubscription({
      businessId, planCode: plan_code, cycle, userId: req.user.id, currency,
      taxInvoice: tax_invoice && tax_invoice.biz_no ? tax_invoice : null,
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
      taxInvoice: req.body?.tax_invoice && req.body.tax_invoice.biz_no ? req.body.tax_invoice : null,
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

// ════════════════════════════════════════════════════════════
// Add-on (추가 슬롯) — 카탈로그 + 현재 보유 + 신청
// ════════════════════════════════════════════════════════════

// GET /:businessId/addons — 카탈로그 + 현재 보유 슬롯
router.get('/:businessId/addons', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { biz, plan } = await planEngine.getBusinessPlan(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    const catalog = listAddonsForPlan(plan.code).map((a) => ({
      code: a.code,
      name_ko: a.name_ko,
      name_en: a.name_en,
      price_monthly: a.price_monthly,
      unit: a.unit,
      field: a.field,
    }));
    const currentBy = {
      addon_members: Number(biz.addon_members || 0),
      addon_clients: Number(biz.addon_clients || 0),
      addon_qnote_minutes: Number(biz.addon_qnote_minutes || 0),
      addon_cue_actions: Number(biz.addon_cue_actions || 0),
      addon_storage_bytes: Number(biz.addon_storage_bytes || 0),
    };
    return successResponse(res, {
      plan_code: plan.code,
      catalog,
      current: currentBy,
      effective: await planEngine.getEffectiveLimits(businessId),
    });
  } catch (err) { next(err); }
});

// POST /:businessId/addons/request — 추가 슬롯 신청 (자체결제 흐름)
//   body: { addon_code, quantity }
//   2026-05-05 풀 흐름: 일할 청구서 자동 발행 + 한도 즉시 적용 + 입금 안내 메일.
//   입금 후 owner 가 /addons/orders/:paymentId/mark-paid 로 결제 확정.
router.post('/:businessId/addons/request', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const { addon_code, quantity = 1, tax_invoice } = req.body || {};
    const addonBilling = require('../services/addonBilling');
    try {
      const r = await addonBilling.requestAddon({
        businessId, addonCode: addon_code, quantity, userId: req.user.id,
        taxInvoice: tax_invoice && tax_invoice.biz_no ? tax_invoice : null,
      });
      return successResponse(res, {
        received: true,
        addon_code,
        quantity: r.payment.addon_quantity,
        prorated_amount_krw: r.prorated_amount,
        full_amount_krw: r.full_amount,
        days_remaining: r.days_remaining,
        next_billing_at: r.next_billing_at,
        payment_id: r.payment.id,
        next_step: '입금 안내 메일이 발송됐습니다. 한도는 신청 즉시 적용됐습니다.',
      });
    } catch (e) {
      if (e.message === 'invalid_addon_code') return errorResponse(res, 'invalid_addon_code', 400);
      if (e.message === 'addon_not_available_for_plan') return errorResponse(res, 'addon_not_available_for_plan', 400);
      if (e.message === 'business_not_found') return errorResponse(res, 'business_not_found', 404);
      throw e;
    }
  } catch (err) { next(err); }
});

// POST /:businessId/addons/orders/:paymentId/mark-paid — owner 가 입금 후 호출
//   body: { payer_name?, payer_memo? }
router.post('/:businessId/addons/orders/:paymentId/mark-paid', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const paymentId = Number(req.params.paymentId);
    const { Payment } = require('../models');
    const pay = await Payment.findByPk(paymentId);
    if (!pay) return errorResponse(res, 'payment_not_found', 404);
    if (pay.business_id !== businessId) return errorResponse(res, 'forbidden', 403);
    if (pay.kind !== 'addon') return errorResponse(res, 'not_addon_payment', 400);

    const addonBilling = require('../services/addonBilling');
    const r = await addonBilling.markAddonPaid({
      paymentId,
      markedByUserId: req.user.id,
      payerName: req.body?.payer_name,
      payerMemo: req.body?.payer_memo,
      taxInvoice: req.body?.tax_invoice && req.body.tax_invoice.biz_no ? req.body.tax_invoice : null,
    });
    return successResponse(res, { paid: true, payment_id: r.payment.id, already_paid: !!r.alreadyPaid });
  } catch (err) { next(err); }
});

// DELETE /:businessId/addons/:addonCode — 사용자가 add-on 해지 (한도 즉시 차감, 환불 X)
//   body: { quantity? } (기본 1 unit 의 1 회분 해지)
router.delete('/:businessId/addons/:addonCode', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const addonCode = String(req.params.addonCode);
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);
    const addonBilling = require('../services/addonBilling');
    try {
      const r = await addonBilling.cancelAddon({ businessId, addonCode, quantity, userId: req.user.id });
      return successResponse(res, { canceled: true, ...r });
    } catch (e) {
      if (e.message === 'invalid_addon_code') return errorResponse(res, 'invalid_addon_code', 400);
      if (e.message === 'business_not_found') return errorResponse(res, 'business_not_found', 404);
      throw e;
    }
  } catch (err) { next(err); }
});

// POST /:businessId/addons/apply — platform_admin 만. 결제 확인 후 수동 적용
//   body: { field, delta }   (field: addon_members | addon_clients | addon_qnote_minutes | addon_cue_actions | addon_storage_bytes)
router.post('/:businessId/addons/apply', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.user.platform_role !== 'platform_admin') return errorResponse(res, 'admin_only', 403);
    const businessId = Number(req.params.businessId);
    const { field, delta } = req.body || {};
    const allowed = ['addon_members', 'addon_clients', 'addon_qnote_minutes', 'addon_cue_actions', 'addon_storage_bytes'];
    if (!allowed.includes(field)) return errorResponse(res, 'invalid_field', 400);
    const d = Number(delta);
    if (!Number.isFinite(d)) return errorResponse(res, 'invalid_delta', 400);

    const { Business } = require('../models');
    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    const next = Math.max(0, Number(biz[field] || 0) + d);
    await biz.update({ [field]: next });
    planEngine.invalidateBusinessCache(businessId);

    const { BillEvent } = require('../models');
    await BillEvent.create({
      entity_type: 'addon_apply',
      entity_id: businessId,
      actor_user_id: req.user.id,
      kind: 'addon_applied',
      payload_json: { field, delta: d, new_value: next },
    }).catch(() => null);

    return successResponse(res, { field, new_value: next });
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
