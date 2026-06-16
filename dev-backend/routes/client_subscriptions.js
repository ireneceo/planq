// 고객 정기 구독청구 (사이클 N+83) — 사업자가 고객에게 거는 구독 CRUD + 즉시 발행.
//   GET    /api/client-subscriptions/:businessId            list
//   POST   /api/client-subscriptions/:businessId            create
//   PUT    /api/client-subscriptions/:businessId/:id        edit / pause / resume
//   DELETE /api/client-subscriptions/:businessId/:id        cancel (soft)
//   POST   /api/client-subscriptions/:businessId/:id/bill-now  즉시 1회 발행
// 권한: qbill write (멤버도 OK — recurring_invoice 와 동일 정책). 멀티테넌트 business_id 강제.
const express = require('express');
const router = express.Router();
const { ClientSubscription, Client, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

const INTERVALS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];
const END_MODES = ['never', 'after_count', 'until_date'];

function serialize(s) {
  const o = s.toJSON ? s.toJSON() : s;
  return {
    id: o.id, client_id: o.client_id, plan_name: o.plan_name,
    amount: Number(o.amount), currency: o.currency, interval: o.interval,
    vat_rate: Number(o.vat_rate), auto_mode: o.auto_mode, due_days: o.due_days,
    status: o.status, start_date: o.start_date, next_billing_at: o.next_billing_at,
    last_invoiced_at: o.last_invoiced_at, notes: o.notes,
    // 운영 — 회차 자동 종료
    end_mode: o.end_mode || 'never', max_occurrences: o.max_occurrences != null ? Number(o.max_occurrences) : null,
    occurrences_count: Number(o.occurrences_count || 0), end_date: o.end_date,
    client: o.Client ? { id: o.Client.id, display_name: o.Client.display_name, company_name: o.Client.company_name } : null,
  };
}

// 운영 — 종료조건 입력 정규화 (create/update 공용). after_count→max_occurrences 필수, until_date→end_date 필수.
function parseEndCondition(b) {
  if (b.end_mode == null) return {};
  if (!END_MODES.includes(b.end_mode)) return { _error: 'invalid_end_mode' };
  if (b.end_mode === 'after_count') {
    const n = Number(b.max_occurrences);
    if (!Number.isInteger(n) || n < 1) return { _error: 'max_occurrences_required' };
    return { end_mode: 'after_count', max_occurrences: n, end_date: null };
  }
  if (b.end_mode === 'until_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '')) return { _error: 'end_date_required' };
    return { end_mode: 'until_date', end_date: b.end_date, max_occurrences: null };
  }
  return { end_mode: 'never', max_occurrences: null, end_date: null };
}

function broadcast(req, businessId, payload) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit('client_subscription:changed', payload);
}

// GET list — ?client_id 로 특정 고객 필터
router.get('/:businessId', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'read'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (req.query.client_id) where.client_id = Number(req.query.client_id);
    if (req.query.status) where.status = String(req.query.status);
    const { rows, count } = await ClientSubscription.findAndCountAll({
      where,
      include: [{ model: Client, attributes: ['id', 'display_name', 'company_name'], required: false }],
      order: [['status', 'ASC'], ['next_billing_at', 'ASC']],
      limit, offset, distinct: true,
    });
    return paginatedResponse(res, rows.map(serialize), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// POST create
router.post('/:businessId', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { client_id, plan_name, amount, currency, interval, vat_rate, auto_mode, due_days, start_date, notes } = req.body || {};
    if (!client_id) return errorResponse(res, 'client_id_required', 400);
    if (!plan_name || !String(plan_name).trim()) return errorResponse(res, 'plan_name_required', 400);
    const amt = Number(amount);
    if (!(amt > 0)) return errorResponse(res, 'amount_must_be_positive', 400);
    if (interval && !INTERVALS.includes(interval)) return errorResponse(res, 'invalid_interval', 400);

    // 고객 소유권 검증 (멀티테넌트)
    const client = await Client.findOne({ where: { id: Number(client_id), business_id: businessId } });
    if (!client) return errorResponse(res, 'client_not_found', 404);

    const biz = await Business.findByPk(businessId, { attributes: ['default_currency', 'default_due_days'] });
    const start = start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date) ? start_date : new Date().toISOString().slice(0, 10);

    // 운영 — 회차 자동 종료 조건
    const endCond = parseEndCondition(req.body || {});
    if (endCond._error) return errorResponse(res, endCond._error, 400);

    const sub = await ClientSubscription.create({
      business_id: businessId,
      client_id: Number(client_id),
      plan_name: String(plan_name).trim().slice(0, 200),
      amount: amt,
      currency: currency || biz?.default_currency || 'KRW',
      interval: interval || 'monthly',
      vat_rate: vat_rate != null ? Number(vat_rate) : 10.0,
      auto_mode: auto_mode === 'auto' ? 'auto' : 'draft_review',
      due_days: due_days != null ? Number(due_days) : (biz?.default_due_days || 14),
      status: 'active',
      start_date: start,
      next_billing_at: start,
      notes: notes ? String(notes).slice(0, 500) : null,
      created_by: req.user.id,
      end_mode: endCond.end_mode || 'never',
      max_occurrences: endCond.max_occurrences ?? null,
      end_date: endCond.end_date ?? null,
    });
    await createAuditLog({
      userId: req.user.id, businessId, action: 'client_subscription.created',
      targetType: 'client_subscription', targetId: sub.id,
      newValue: { client_id, plan_name, amount: amt, interval: sub.interval, auto_mode: sub.auto_mode },
    });
    broadcast(req, businessId, { id: sub.id, client_id: sub.client_id, status: 'active' });
    return successResponse(res, serialize(sub), 'created', 201);
  } catch (err) { next(err); }
});

// PUT edit / pause / resume
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const sub = await ClientSubscription.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!sub) return errorResponse(res, 'not_found', 404);
    const b = req.body || {};
    const patch = {};
    if (b.plan_name && String(b.plan_name).trim()) patch.plan_name = String(b.plan_name).trim().slice(0, 200);
    if (b.amount != null) { const a = Number(b.amount); if (a > 0) patch.amount = a; }
    if (b.interval && INTERVALS.includes(b.interval)) patch.interval = b.interval;
    if (b.vat_rate != null) patch.vat_rate = Number(b.vat_rate);
    if (b.auto_mode) patch.auto_mode = b.auto_mode === 'auto' ? 'auto' : 'draft_review';
    if (b.due_days != null) patch.due_days = Number(b.due_days);
    if (b.notes != null) patch.notes = b.notes ? String(b.notes).slice(0, 500) : null;
    if (b.next_billing_at && /^\d{4}-\d{2}-\d{2}$/.test(b.next_billing_at)) patch.next_billing_at = b.next_billing_at;
    if (b.status && ['active', 'paused'].includes(b.status)) {
      patch.status = b.status; // canceled 는 DELETE 로만
    }
    // 운영 — 회차 자동 종료 조건 변경
    if (b.end_mode != null) {
      const endCond = parseEndCondition(b);
      if (endCond._error) return errorResponse(res, endCond._error, 400);
      Object.assign(patch, endCond);
    }
    if (!Object.keys(patch).length) return errorResponse(res, 'no_fields', 400);
    await sub.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId, action: 'client_subscription.updated',
      targetType: 'client_subscription', targetId: sub.id, newValue: patch,
    });
    broadcast(req, businessId, { id: sub.id, client_id: sub.client_id, status: sub.status });
    return successResponse(res, serialize(sub));
  } catch (err) { next(err); }
});

// DELETE — cancel (soft, status='canceled')
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const sub = await ClientSubscription.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!sub) return errorResponse(res, 'not_found', 404);
    await sub.update({ status: 'canceled', canceled_at: new Date() });
    await createAuditLog({
      userId: req.user.id, businessId, action: 'client_subscription.canceled',
      targetType: 'client_subscription', targetId: sub.id,
    });
    broadcast(req, businessId, { id: sub.id, client_id: sub.client_id, status: 'canceled' });
    return successResponse(res, { id: sub.id, status: 'canceled' }, 'canceled');
  } catch (err) { next(err); }
});

// POST bill-now — 즉시 1회 발행 (next_billing_at 무관). active 만.
router.post('/:businessId/:id/bill-now', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const sub = await ClientSubscription.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!sub) return errorResponse(res, 'not_found', 404);
    if (sub.status !== 'active') return errorResponse(res, 'not_active', 400);
    const { billOneSubscription } = require('../services/clientSubscriptionBilling');
    const r = await billOneSubscription(sub, new Date());
    if (!r.invoice_id) return errorResponse(res, r.skipped || 'bill_failed', 400);
    await createAuditLog({
      userId: req.user.id, businessId, action: 'client_subscription.bill_now',
      targetType: 'client_subscription', targetId: sub.id, newValue: { invoice_id: r.invoice_id },
    });
    return successResponse(res, { subscription_id: sub.id, invoice_id: r.invoice_id, next_billing_at: r.next_billing_at }, 'invoiced', 201);
  } catch (err) { next(err); }
});

module.exports = router;
