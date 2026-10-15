// 급여 항목 API — /api/payroll/:businessId/items… (docs/PAYROLL_DESIGN.md §3.3 · §7.1)
//   체인은 routes/payroll.js 와 같다: authenticateToken → checkBusinessAccess → requireModule('payroll') → 관리자 [→ 쓰기 요금제].
//   규칙은 services/payrollItems 한 곳. 여기는 검사·감사·실시간 신호만.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { requireModule } = require('../services/modules');
const { requirePayrollManager, requirePayrollWrite } = require('../services/payrollAccess');
const { perUserDaily } = require('../middleware/costGuard');
const I = require('../services/payrollItems');
const { PRESETS } = require('../config/payrollPresets');
const { signalPayroll } = require('../services/payrollSignal');

const base = [authenticateToken, checkBusinessAccess, requireModule('payroll')];
const manager = [...base, requirePayrollManager];
const writer = [...manager, requirePayrollWrite];
const bizIdOf = (req) => Number(req.params.businessId);
const sendFail = (res, r) => errorResponse(res, r.code, r.http || 400);

router.get('/:businessId/items', ...manager, async (req, res, next) => {
  try { return successResponse(res, await I.listItems(bizIdOf(req))); } catch (e) { next(e); }
});

router.post('/:businessId/items', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await I.createItem(businessId, req.body || {});
    if (!r.ok) return sendFail(res, r);
    logAudit(req, { action: 'payroll.item_create', targetType: 'pay_item', targetId: r.data.id, businessId, newValue: r.data });
    signalPayroll(req, businessId, { kind: 'items' });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

router.put('/:businessId/items/:id', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await I.updateItem(businessId, Number(req.params.id), req.body || {});
    if (!r.ok) return sendFail(res, r);
    logAudit(req, { action: 'payroll.item_update', targetType: 'pay_item', targetId: r.data.id, businessId, oldValue: r.before, newValue: r.data });
    signalPayroll(req, businessId, { kind: 'items' });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

router.delete('/:businessId/items/:id', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await I.deleteItem(businessId, Number(req.params.id));
    if (!r.ok) return sendFail(res, r);
    logAudit(req, { action: 'payroll.item_delete', targetType: 'pay_item', targetId: Number(req.params.id), businessId, oldValue: r.before });
    signalPayroll(req, businessId, { kind: 'items' });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// 프리셋 — 목록(이름만) · 미리보기 · 불러오기(이미 있는 code 는 건너뜀)
router.get('/:businessId/item-presets', ...manager, async (req, res, next) => {
  try {
    return successResponse(res, Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, country: p.country, count: p.items.length })));
  } catch (e) { next(e); }
});

router.get('/:businessId/item-presets/:key', ...manager, async (req, res, next) => {
  try {
    const r = await I.previewPreset(bizIdOf(req), req.params.key);
    return r.ok ? successResponse(res, r.data) : sendFail(res, r);
  } catch (e) { next(e); }
});

router.post('/:businessId/item-presets/:key/apply', ...writer, async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const r = await I.applyPreset(businessId, req.params.key, { codes: req.body?.codes });
    if (!r.ok) return sendFail(res, r);
    logAudit(req, { action: 'payroll.items_preset', targetType: 'business', targetId: businessId, businessId, newValue: { preset: req.params.key, created: r.data.created.map((x) => x.code), skipped: r.data.skipped } });
    signalPayroll(req, businessId, { kind: 'items' });
    return successResponse(res, r.data);
  } catch (e) { next(e); }
});

// AI 틀 제안 — 저장하지 않는다(사람이 고른 것만 POST /items 로 들어간다). Cue 1회 계량 · 사용자당 분 3·일 20.
router.post('/:businessId/items/suggest', ...writer, ...perUserDaily('payroll-suggest', { perMin: 3, perDay: 20 }), async (req, res, next) => {
  try {
    const businessId = bizIdOf(req);
    const plan = require('../services/plan');
    const can = await plan.can(businessId, 'use_cue');
    if (!can.ok) return errorResponse(res, can.reason || 'cue_quota_exceeded', 409);
    const r = await I.suggestItems({ country: req.body?.country, employmentKind: req.body?.employment_kind, headers: req.body?.headers });
    if (r.llm && !r.fallback) {
      require('../services/cue_orchestrator').recordUsage(businessId, 'payroll_preset', r.llm.model, r.llm.input_tokens, r.llm.output_tokens).catch((e) => console.warn('[payroll suggest usage]', e.message));
    }
    return successResponse(res, { items: r.items, fallback: !!r.fallback });
  } catch (e) { next(e); }
});

module.exports = router;
