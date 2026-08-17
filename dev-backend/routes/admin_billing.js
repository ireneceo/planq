// 플랫폼 관리자 — 구독 / 결제 라우트.
//
// 왜 별도 파일인가: routes/admin.js 가 god-file 래칫(동결 1006줄)을 넘겨 게이트가 깨졌다.
// CLAUDE.md 규약대로 **베이스라인을 올리지 않고 절출**한다(adminModalKit 절출과 같은 판단).
// 마운트는 server.js 가 아니라 routes/admin.js 가 한다 — `/api/admin` prefix 와
// `authenticateToken + requireRole('platform_admin')` 게이트를 그대로 물려받기 위해서다.
// (여기서 따로 마운트하면 인증 게이트를 다시 걸어야 하고, 빠뜨리면 무인증 구멍이 된다.)
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, Subscription, Payment } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { isExemptNow, exemptBusinessIds, liveBusinessIds } = require('../services/billingExemptView');

// ============================================
// Subscriptions (플랫폼 → 워크스페이스 PlanQ 구독)
// ============================================

// GET /api/admin/subscriptions — 구독 목록 (status 필터 + 검색)
//   query: ?status=active|past_due|grace|demoted|pending|canceled|all (default 'all')
//          ?q= 워크스페이스명 검색
//          ?limit=50 ?offset=0
router.get('/subscriptions', async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    const q = String(req.query.q || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const where = {};
    if (status !== 'all') where.status = status;
    // 'replaced' 는 default 에서 숨김 (plan 변경 이력)
    if (status === 'all') where.status = { [Op.ne]: 'replaced' };

    const include = [{
      model: Business,
      // 삭제된 워크스페이스의 구독 이력은 목록·집계에서 뺀다 (행은 DB 에 보존).
      required: true,
      attributes: ['id', 'name', 'brand_name', 'slug', 'plan', 'subscription_status',
        // 결제 면제 (운영 #275) — 면제 워크스페이스의 옛 강등/연체 구독 행이
        // 현재 상태처럼 보이면 안 된다. 행 단위로 판정 근거를 같이 내려준다.
        'billing_exempt', 'billing_exempt_kind', 'billing_exempt_until'],
      where: {
        deleted_at: null,
        ...(q ? { [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { brand_name: { [Op.like]: `%${q}%` } },
          { slug: { [Op.like]: `%${q}%` } },
        ] } : {}),
      },
    }];

    const { rows, count } = await Subscription.findAndCountAll({
      where, include, order: [['created_at', 'DESC']],
      limit, offset, distinct: true,
    });

    // 각 subscription 의 latest pending Payment (mark-paid 액션 대상)
    const subIds = rows.map((s) => s.id);
    const pendingPayments = subIds.length > 0
      ? await Payment.findAll({
          where: { subscription_id: { [Op.in]: subIds }, status: 'pending' },
          attributes: ['id', 'subscription_id', 'amount', 'currency', 'method', 'period_start', 'period_end', 'created_at', 'notify_paid_at', 'notify_payer_name', 'payer_name'],
          order: [['created_at', 'DESC']],
        })
      : [];
    const pendingMap = new Map();
    for (const p of pendingPayments) {
      if (!pendingMap.has(p.subscription_id)) pendingMap.set(p.subscription_id, p);
    }

    res.set('X-Total-Count', String(count));
    return successResponse(res, rows.map((s) => ({
      id: s.id,
      business: s.Business ? {
        id: s.Business.id,
        name: s.Business.brand_name || s.Business.name,
        slug: s.Business.slug,
        plan: s.Business.plan,
        subscription_status: s.Business.subscription_status,
        // 프론트는 이 값만 보고 "면제" 뱃지를 띄우고 상태 라벨을 과거형으로 바꾼다.
        billing_exempt: isExemptNow(s.Business),
        billing_exempt_kind: s.Business.billing_exempt_kind,
      } : null,
      plan_code: s.plan_code,
      cycle: s.cycle,
      status: s.status,
      price: Number(s.price),
      currency: s.currency,
      started_at: s.started_at,
      current_period_start: s.current_period_start,
      current_period_end: s.current_period_end,
      next_billing_at: s.next_billing_at,
      past_due_at: s.past_due_at,
      grace_ends_at: s.grace_ends_at,
      demoted_at: s.demoted_at,
      canceled_at: s.canceled_at,
      cancel_reason: s.cancel_reason,
      created_at: s.created_at,
      pending_payment: pendingMap.has(s.id) ? {
        id: pendingMap.get(s.id).id,
        amount: Number(pendingMap.get(s.id).amount),
        method: pendingMap.get(s.id).method,
        period_start: pendingMap.get(s.id).period_start,
        period_end: pendingMap.get(s.id).period_end,
        created_at: pendingMap.get(s.id).created_at,
        // 고객 입금 통보 — 관리자 확인 우선순위 표시용
        notify_paid_at: pendingMap.get(s.id).notify_paid_at,
        notify_payer_name: pendingMap.get(s.id).notify_payer_name || pendingMap.get(s.id).payer_name || null,
      } : null,
    })));
  } catch (err) { next(err); }
});

// GET /api/admin/subscriptions/summary — 카운트 요약 (탭 배지용)
router.get('/subscriptions/summary', async (req, res, next) => {
  try {
    // ★ 면제 워크스페이스는 연체/유예/강등 집계에서 뺀다 (운영 #275).
    //   면제를 켠 뒤에도 옛 demoted 행이 남아 KPI 에 "강등 1" 로 잡히면,
    //   화면이 현재 사실과 다르게 말한다 — Irene 실사례(워프로랩 biz2).
    //   행 자체는 이력이라 지우지 않고, **집계에서만** 분리해 exempt 로 따로 센다.
    //   ★ 행 단위 isExemptNow() 와 **같은 술어**로 뽑는다. raw 플래그만 보면 종료일이 지난
    //     워크스페이스가 집계에서만 면제로 빠져 같은 응답 안에서 자기모순이 난다 (Fable M1).
    const exemptIds = await exemptBusinessIds();
    // 삭제된 워크스페이스의 구독 이력도 집계에서 뺀다 — 목록(required: true)과 숫자가 어긋나면 안 된다.
    const liveIds = await liveBusinessIds();

    const counts = await Subscription.findAll({
      attributes: ['status', [Subscription.sequelize.fn('COUNT', Subscription.sequelize.col('id')), 'count']],
      where: {
        status: { [Op.ne]: 'replaced' },
        business_id: {
          [Op.in]: liveIds.filter((id) => !exemptIds.includes(id)),
        },
      },
      group: ['status'],
      raw: true,
    });
    const out = { active: 0, pending: 0, past_due: 0, grace: 0, demoted: 0, canceled: 0, total: 0, exempt: 0 };
    for (const c of counts) {
      out[c.status] = Number(c.count);
      out.total += Number(c.count);
    }
    // 면제 구독은 숨기지 않고 별도 항목으로 노출한다(숫자가 사라지는 것도 오정보).
    if (exemptIds.length) {
      out.exempt = Number(await Subscription.count({
        where: {
          status: { [Op.ne]: 'replaced' },
          business_id: { [Op.in]: exemptIds.filter((id) => liveIds.includes(id)) },
        },
      }));
      out.total += out.exempt;
    }
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// POST /api/admin/subscriptions/:id/mark-paid — pending Payment 활성화 (계좌이체 확인 후)
router.post('/subscriptions/:id/mark-paid', async (req, res, next) => {
  try {
    const sub = await Subscription.findByPk(req.params.id);
    if (!sub) return errorResponse(res, 'subscription_not_found', 404);

    const pending = await Payment.findOne({
      where: { subscription_id: sub.id, status: 'pending' },
      order: [['created_at', 'ASC']],
    });
    if (!pending) return errorResponse(res, 'no_pending_payment', 400);

    const billing = require('../services/billing');
    const result = await billing.markPaymentPaid({
      paymentId: pending.id,
      markedByUserId: req.user.id,
      payerName: req.body?.payer_name || null,
      payerMemo: req.body?.payer_memo || null,
    });

    require('../services/auditService').logAudit(req, {
      action: 'admin.subscription.mark_paid',
      targetType: 'subscription',
      targetId: sub.id,
      newValue: { payment_id: pending.id, plan: sub.plan_code, cycle: sub.cycle, amount: Number(pending.amount) },
    });

    return successResponse(res, result, 'marked_paid');
  } catch (err) { next(err); }
});

// POST /api/admin/subscriptions/:id/demote — 강제 강등 (Free 로)
router.post('/subscriptions/:id/demote', async (req, res, next) => {
  try {
    const sub = await Subscription.findByPk(req.params.id);
    if (!sub) return errorResponse(res, 'subscription_not_found', 404);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : 'admin manual demote';

    const billing = require('../services/billing');
    // downgradeToFree 는 구조분해 시그니처({businessId,userId,reason}) — positional 호출은 businessId=undefined 로 항상 실패했다(Fable 발견).
    await billing.downgradeToFree({ businessId: sub.business_id, userId: req.user?.id, reason });

    require('../services/auditService').logAudit(req, {
      action: 'admin.subscription.demote',
      targetType: 'subscription',
      targetId: sub.id,
      newValue: { reason, prev_plan: sub.plan_code },
    });

    return successResponse(res, { demoted: true }, 'demoted');
  } catch (err) { next(err); }
});

// ============================================
// Payments (결제 이력 + 환불·조정)
// ============================================

// GET /api/admin/payments — 결제 이력 목록
//   query: ?status=pending|paid|failed|refunded|canceled|all (default 'all')
//          ?method=bank_transfer|card|portone|manual_adjust
//          ?q= 워크스페이스명
//          ?limit=50 ?offset=0
router.get('/payments', async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    const method = req.query.method || 'all';
    const q = String(req.query.q || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const where = {};
    if (status !== 'all') where.status = status;
    if (method !== 'all') where.method = method;

    const include = [
      {
        model: Business,
        attributes: ['id', 'name', 'brand_name', 'slug'],
        ...(q ? { where: { [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { brand_name: { [Op.like]: `%${q}%` } },
        ] } } : {}),
        required: !!q,
      },
      { model: Subscription, attributes: ['id', 'plan_code', 'cycle', 'status'] },
    ];

    const { rows, count } = await Payment.findAndCountAll({
      where, include, order: [['created_at', 'DESC']],
      limit, offset, distinct: true,
    });

    res.set('X-Total-Count', String(count));
    return successResponse(res, rows.map((p) => ({
      id: p.id,
      business: p.Business ? {
        id: p.Business.id,
        name: p.Business.brand_name || p.Business.name,
        slug: p.Business.slug,
      } : null,
      subscription: p.Subscription ? {
        id: p.Subscription.id,
        plan_code: p.Subscription.plan_code,
        cycle: p.Subscription.cycle,
        status: p.Subscription.status,
      } : null,
      method: p.method,
      status: p.status,
      amount: Number(p.amount),
      currency: p.currency,
      cycle: p.cycle,
      period_start: p.period_start,
      period_end: p.period_end,
      payer_name: p.payer_name,
      payer_memo: p.payer_memo,
      paid_at: p.paid_at,
      refunded_at: p.refunded_at,
      refund_reason: p.refund_reason,
      cancel_reason: p.cancel_reason,
      // 매출 계상 여부 (운영 #275) — 행 단위로도 식별 가능해야 합계와 목록이 대조된다.
      is_revenue: p.is_revenue !== false,
      created_at: p.created_at,
      // Day 8 — addon / 세금계산서 신규 필드
      kind: p.kind,
      addon_code: p.addon_code,
      addon_quantity: p.addon_quantity,
      tax_invoice_requested: p.tax_invoice_requested,
      tax_invoice_status: p.tax_invoice_status,
      tax_invoice_data: p.tax_invoice_data,
      tax_invoice_issued_at: p.tax_invoice_issued_at,
    })));
  } catch (err) { next(err); }
});

// GET /api/admin/payments/summary — 카운트 + 합계
router.get('/payments/summary', async (req, res, next) => {
  try {
    const counts = await Payment.findAll({
      attributes: ['status', [Payment.sequelize.fn('COUNT', Payment.sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    });
    const out = { pending: 0, paid: 0, failed: 0, refunded: 0, canceled: 0, total: 0 };
    for (const c of counts) {
      out[c.status] = Number(c.count);
      out.total += Number(c.count);
    }
    // 비매출(내부·테스터) 결제 건수 — 위 status 카운트에 섞여 있으므로 따로 노출한다.
    // 숨기지 않고 분리한다: admin 이 합계와 목록을 대조할 때 숫자가 안 맞아 보이면 안 된다.
    out.nonrevenue_paid = Number(await Payment.count({ where: { status: 'paid', is_revenue: false } }));

    // 이번 달 수익 (paid 중 실매출만) + 비매출 분리 (운영 #275)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [monthRev, monthNonRev] = await Promise.all([
      Payment.sum('amount', { where: { status: 'paid', is_revenue: true, paid_at: { [Op.gte]: monthStart } } }),
      Payment.sum('amount', { where: { status: 'paid', is_revenue: false, paid_at: { [Op.gte]: monthStart } } }),
    ]);
    out.month_revenue = Number(monthRev || 0);
    out.month_nonrevenue = Number(monthNonRev || 0);
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// POST /api/admin/payments/:id/refund — 환불 처리
router.post('/payments/:id/refund', async (req, res, next) => {
  try {
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    if (p.status !== 'paid') return errorResponse(res, 'only_paid_can_refund', 400);
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : '관리자 환불';
    await p.update({
      status: 'refunded',
      refunded_at: new Date(),
      refund_reason: reason,
    });
    require('../services/auditService').logAudit(req, {
      action: 'admin.payment.refund',
      targetType: 'payment',
      targetId: p.id,
      newValue: { reason, amount: Number(p.amount), business_id: p.business_id },
    });
    return successResponse(res, { refunded: true, refunded_at: p.refunded_at }, 'refunded');
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════
// Day 10 — addon Payment mark-paid + 세금계산서 발행 (admin)
// ═════════════════════════════════════════════════════════════

// POST /admin/payments/:id/mark-paid — kind 자동 판별 (plan 또는 addon)
//   body: { payer_name?, payer_memo?, tax_invoice? }
router.post('/payments/:id/mark-paid', async (req, res, next) => {
  try {
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    if (p.status === 'paid') return successResponse(res, { already_paid: true, payment: p.toJSON() });
    if (p.status !== 'pending') return errorResponse(res, 'invalid_state', 400);

    const taxInvoice = req.body?.tax_invoice && req.body.tax_invoice.biz_no ? req.body.tax_invoice : null;
    let result;
    if (p.kind === 'addon') {
      result = await require('../services/addonBilling').markAddonPaid({
        paymentId: p.id, markedByUserId: req.user.id,
        payerName: req.body?.payer_name, payerMemo: req.body?.payer_memo,
        taxInvoice,
      });
    } else {
      result = await require('../services/billing').markPaymentPaid({
        paymentId: p.id, markedByUserId: req.user.id,
        payerName: req.body?.payer_name, payerMemo: req.body?.payer_memo,
        taxInvoice,
      });
    }
    require('../services/auditService').logAudit(req, {
      action: 'admin.payment.mark_paid',
      targetType: 'payment',
      targetId: p.id,
      newValue: { kind: p.kind, business_id: p.business_id, amount: Number(p.amount), tax_invoice: !!taxInvoice },
    });
    return successResponse(res, result, 'marked_paid');
  } catch (err) { next(err); }
});

// POST /admin/payments/:id/issue-tax-invoice — 세금계산서 발행 마킹
//   현재: Payment.tax_invoice_status='issued' 수동 마킹 + AuditLog. 팝빌 자동 발행은 다음 사이클.
//   body: { issued_by? — 발행 시스템 ('manual'|'popbill'), reference? }
router.post('/payments/:id/issue-tax-invoice', async (req, res, next) => {
  try {
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    if (p.status !== 'paid') return errorResponse(res, 'only_paid_can_issue', 400);
    if (!p.tax_invoice_data || !p.tax_invoice_data.biz_no) return errorResponse(res, 'no_tax_invoice_data', 400);
    if (p.tax_invoice_status === 'issued') return successResponse(res, { already_issued: true });

    const now = new Date();
    await p.update({
      tax_invoice_status: 'issued',
      tax_invoice_issued_at: now,
      tax_invoice_error: null,
    });
    require('../services/auditService').logAudit(req, {
      action: 'admin.payment.tax_invoice_issued',
      targetType: 'payment',
      targetId: p.id,
      newValue: { biz_no: p.tax_invoice_data.biz_no, issued_by: req.body?.issued_by || 'manual', reference: req.body?.reference || null },
    });
    return successResponse(res, { issued: true, issued_at: now });
  } catch (err) { next(err); }
});

// POST /admin/payments/:id/tax-invoice-failed — 발행 실패 마킹 (수동 또는 자동)
router.post('/payments/:id/tax-invoice-failed', async (req, res, next) => {
  try {
    const p = await Payment.findByPk(req.params.id);
    if (!p) return errorResponse(res, 'payment_not_found', 404);
    const error = String(req.body?.error || '발행 실패').slice(0, 500);
    await p.update({ tax_invoice_status: 'failed', tax_invoice_error: error });
    require('../services/auditService').logAudit(req, {
      action: 'admin.payment.tax_invoice_failed',
      targetType: 'payment', targetId: p.id, newValue: { error },
    });
    return successResponse(res, { failed: true });
  } catch (err) { next(err); }
});

// GET /admin/payments/pending-tax-invoices — 발행 대기 결제 목록
router.get('/payments/pending-tax-invoices', async (req, res, next) => {
  try {
    const rows = await Payment.findAll({
      where: { status: 'paid', tax_invoice_status: 'requested' },
      order: [['paid_at', 'DESC']],
      limit: 200,
    });
    return successResponse(res, rows.map(p => ({
      id: p.id,
      business_id: p.business_id,
      kind: p.kind,
      amount: Number(p.amount),
      currency: p.currency,
      paid_at: p.paid_at,
      tax_invoice_data: p.tax_invoice_data,
      tax_invoice_status: p.tax_invoice_status,
    })));
  } catch (err) { next(err); }
});

module.exports = router;
