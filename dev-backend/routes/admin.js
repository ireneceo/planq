// Platform Admin 전용 라우트 — 결제 연동 전 임시 플랜 수동 조정 / 체험 연장 / 이력 조회
// 모든 엔드포인트는 authenticateToken + requireRole('platform_admin') 이중 체크
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, BusinessMember, User, BusinessPlanHistory, PlatformSetting, Subscription, Payment } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const { PLANS, PLAN_ORDER, toPublicJson } = require('../config/plans');

router.use(authenticateToken, requireRole('platform_admin'));

// ─── 워크스페이스 목록 ───
// GET /api/admin/businesses?q=검색어
router.get('/businesses', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const where = q ? { name: { [Op.like]: `%${q}%` } } : {};
    const items = await Business.findAll({
      where,
      attributes: ['id', 'name', 'slug', 'plan', 'subscription_status', 'plan_expires_at', 'trial_ends_at', 'grace_ends_at', 'scheduled_plan', 'created_at'],
      order: [['id', 'ASC']]
    });

    const memberCounts = await BusinessMember.findAll({
      attributes: ['business_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'n']],
      group: ['business_id'],
      raw: true
    });
    const memberMap = new Map(memberCounts.map(r => [Number(r.business_id), Number(r.n)]));

    successResponse(res, items.map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      plan: b.plan,
      subscription_status: b.subscription_status,
      plan_expires_at: b.plan_expires_at,
      trial_ends_at: b.trial_ends_at,
      grace_ends_at: b.grace_ends_at,
      scheduled_plan: b.scheduled_plan,
      member_count: memberMap.get(b.id) || 0,
      created_at: b.created_at,
    })));
  } catch (err) { next(err); }
});

// ─── 워크스페이스 상세 + 사용량 ───
// GET /api/admin/businesses/:id
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    const [{ plan }, usage] = await Promise.all([
      planEngine.getBusinessPlan(id),
      planEngine.getUsage(id)
    ]);

    successResponse(res, {
      id: biz.id,
      name: biz.name,
      slug: biz.slug,
      plan: biz.plan,
      subscription_status: biz.subscription_status,
      plan_expires_at: biz.plan_expires_at,
      trial_ends_at: biz.trial_ends_at,
      grace_ends_at: biz.grace_ends_at,
      scheduled_plan: biz.scheduled_plan,
      timezone: biz.timezone,
      created_at: biz.created_at,
      effective_plan: toPublicJson(plan.code),
      usage: {
        members: usage.members,
        clients: usage.clients,
        projects: usage.projects,
        conversations: usage.conversations,
        storage_bytes: usage.storage_bytes,
        file_count: usage.file_count,
        cue_actions_this_month: usage.cue_actions_this_month,
        qnote_minutes_this_month: usage.qnote_minutes_this_month,
      }
    });
  } catch (err) { next(err); }
});

// ─── 플랜 이력 ───
// GET /api/admin/businesses/:id/history
router.get('/businesses/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = await BusinessPlanHistory.findAll({
      where: { business_id: id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'email'], required: false }],
      order: [['created_at', 'DESC']],
      limit: 100
    });
    successResponse(res, rows.map(r => ({
      id: r.id,
      from_plan: r.from_plan,
      to_plan: r.to_plan,
      reason: r.reason,
      note: r.note,
      changed_by: r.changer ? { id: r.changer.id, name: r.changer.name, email: r.changer.email } : null,
      effective_at: r.effective_at,
      created_at: r.created_at,
    })));
  } catch (err) { next(err); }
});

// ─── 플랜 수동 변경 ───
// PUT /api/admin/businesses/:id/plan
// body: { to_plan, note?, plan_expires_at?, scheduled_plan? }
router.put('/businesses/:id/plan', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { to_plan, note = null, plan_expires_at = null, scheduled_plan = null } = req.body || {};

    if (!to_plan || !PLANS[to_plan]) {
      return errorResponse(res, 'Invalid plan code', 400);
    }
    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    await planEngine.changePlan(id, {
      toPlan: to_plan,
      reason: 'admin_adjust',
      changedBy: req.user.id,
      note,
      expiresAt: plan_expires_at !== null ? (plan_expires_at ? new Date(plan_expires_at) : null) : null,
      scheduledPlan: scheduled_plan,
    });

    successResponse(res, { id, plan: to_plan }, 'Plan updated');
  } catch (err) { next(err); }
});

// ─── 체험 기간 설정/연장 ───
// PUT /api/admin/businesses/:id/trial
// body: { trial_ends_at (ISO) | null }  — null 이면 체험 종료 즉시 해제
router.put('/businesses/:id/trial', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { trial_ends_at } = req.body || {};

    const biz = await Business.findByPk(id);
    if (!biz) return errorResponse(res, 'Business not found', 404);

    const nextDate = trial_ends_at ? new Date(trial_ends_at) : null;
    if (trial_ends_at && isNaN(nextDate.getTime())) {
      return errorResponse(res, 'Invalid trial_ends_at', 400);
    }

    const from = biz.trial_ends_at;
    biz.trial_ends_at = nextDate;
    await biz.save();

    await BusinessPlanHistory.create({
      business_id: id,
      from_plan: biz.plan,
      to_plan: biz.plan,
      reason: 'admin_adjust',
      changed_by: req.user.id,
      note: `체험 기간 ${from ? new Date(from).toISOString().slice(0,10) : '미설정'} → ${nextDate ? nextDate.toISOString().slice(0,10) : '해제'}`,
      effective_at: new Date(),
    });

    planEngine.invalidateBusinessCache?.(id);
    successResponse(res, { id, trial_ends_at: biz.trial_ends_at }, 'Trial updated');
  } catch (err) { next(err); }
});

// ─── 플랜 카탈로그 (admin 용 Infinity 포함 x, 공용과 동일) ───
router.get('/plans/catalog', async (_req, res, next) => {
  try {
    successResponse(res, PLAN_ORDER.map(c => toPublicJson(c)));
  } catch (err) { next(err); }
});

// ─── Q-C 메일 모니터링 ───
// GET /api/admin/email-logs?status=&template=&business_id=&page=&limit=
router.get('/email-logs', async (req, res, next) => {
  try {
    const { EmailLog } = require('../models');
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.template) where.template = String(req.query.template);
    if (req.query.business_id) where.business_id = Number(req.query.business_id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { count, rows } = await EmailLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'initiator', attributes: ['id', 'name'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      success: true,
      data: rows.map(r => r.toJSON()),
      pagination: { page, limit, total: count },
    });
  } catch (err) { next(err); }
});

// POST /api/admin/email-logs/:id/retry — 재발송 트리거 (현재는 카운트만 증가, 추후 템플릿 핸들러 연결).
//   PII 우려로 html 본문은 EmailLog 에 저장 안 함. 재발송은 template 식별자 + related_entity 로 다시 빌드.
router.post('/email-logs/:id/retry', async (req, res, next) => {
  try {
    const { EmailLog } = require('../models');
    const log = await EmailLog.findByPk(req.params.id);
    if (!log) return errorResponse(res, 'not_found', 404);
    if (log.status === 'sent') return errorResponse(res, 'already_sent', 400);
    if (!log.template) return errorResponse(res, 'manual_retry_unsupported', 400);
    await log.update({ retry_count: log.retry_count + 1 });
    return successResponse(res, log.toJSON(), 'retry_queued');
  } catch (err) { next(err); }
});

// ─── 플랫폼 설정 (브랜드·법인·지원 메일·로고 등) — DB 단일 row ───
// .env 의 PLATFORM_*, EMAIL_LOGO_URL 대체. emailService 가 5분 캐시로 조회.

// GET /api/admin/platform-settings — 현재 row 조회 (없으면 빈 객체 반환, 클라가 PUT 으로 생성)
router.get('/platform-settings', async (req, res, next) => {
  try {
    const row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    return successResponse(res, row ? row.toJSON() : null);
  } catch (err) { next(err); }
});

// PUT /api/admin/platform-settings — 단일 row upsert.
//   body 의 알려진 필드만 업데이트. 다른 필드는 보존. 결제 설정 (bank/portone/vat/due) 같이 처리.
router.put('/platform-settings', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.brand !== undefined && (!String(b.brand).trim() || String(b.brand).length > 100)) {
      return errorResponse(res, 'brand_invalid', 400);
    }
    const setStr = (k, max) => (b[k] !== undefined ? { [k]: b[k] ? String(b[k]).slice(0, max) : null } : {});
    const setNum = (k, fb) => (b[k] !== undefined && Number.isFinite(Number(b[k])) ? { [k]: Number(b[k]) } : (fb !== undefined ? {} : {}));
    const updates = {
      ...(b.brand !== undefined ? { brand: String(b.brand).trim() } : {}),
      ...setStr('tagline', 300),
      ...setStr('website', 300),
      ...setStr('support_email', 200),
      ...setStr('legal_entity', 100),
      ...setStr('email_logo_url', 500),
      // 결제 설정
      ...setStr('bank_name', 100),
      ...setStr('bank_account_number', 50),
      ...setStr('bank_account_holder', 100),
      ...setStr('portone_store_id', 100),
      ...setStr('portone_channel_key', 200),
      ...setStr('portone_channel_key_billing', 200),
      ...setStr('portone_webhook_secret', 200),
      ...setNum('default_vat_rate'),
      ...setNum('default_due_days'),
      updated_by_user_id: req.user.id,
    };
    // VAT rate 0~1 검증
    if (updates.default_vat_rate !== undefined && (updates.default_vat_rate < 0 || updates.default_vat_rate > 1)) {
      return errorResponse(res, 'vat_rate_out_of_range (0~1)', 400);
    }
    if (updates.default_due_days !== undefined && (updates.default_due_days < 0 || updates.default_due_days > 365)) {
      return errorResponse(res, 'due_days_out_of_range (0~365)', 400);
    }
    let row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    if (row) {
      await row.update(updates);
    } else {
      row = await PlatformSetting.create({ brand: updates.brand || 'PlanQ', ...updates });
    }
    // emailService 캐시 무효화
    try { require('../services/emailService').invalidatePlatformCache?.(); } catch { /* */ }
    require('../services/auditService').logAudit(req, {
      action: 'platform_settings.update',
      targetType: 'platform_setting',
      targetId: row.id,
      newValue: updates,
    });
    return successResponse(res, row.toJSON(), 'updated');
  } catch (err) { next(err); }
});

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
      attributes: ['id', 'name', 'brand_name', 'slug', 'plan', 'subscription_status'],
      ...(q ? { where: { [Op.or]: [
        { name: { [Op.like]: `%${q}%` } },
        { brand_name: { [Op.like]: `%${q}%` } },
        { slug: { [Op.like]: `%${q}%` } },
      ] } } : {}),
      required: !!q,
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
          attributes: ['id', 'subscription_id', 'amount', 'currency', 'method', 'period_start', 'period_end', 'created_at'],
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
      } : null,
    })));
  } catch (err) { next(err); }
});

// GET /api/admin/subscriptions/summary — 카운트 요약 (탭 배지용)
router.get('/subscriptions/summary', async (req, res, next) => {
  try {
    const counts = await Subscription.findAll({
      attributes: ['status', [Subscription.sequelize.fn('COUNT', Subscription.sequelize.col('id')), 'count']],
      where: { status: { [Op.ne]: 'replaced' } },
      group: ['status'],
      raw: true,
    });
    const out = { active: 0, pending: 0, past_due: 0, grace: 0, demoted: 0, canceled: 0, total: 0 };
    for (const c of counts) {
      out[c.status] = Number(c.count);
      out.total += Number(c.count);
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
    await billing.downgradeToFree(sub.business_id, reason);

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
      created_at: p.created_at,
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
    // 이번 달 수익 (paid 만)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRev = await Payment.sum('amount', {
      where: { status: 'paid', paid_at: { [Op.gte]: monthStart } },
    });
    out.month_revenue = Number(monthRev || 0);
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

module.exports = router;
