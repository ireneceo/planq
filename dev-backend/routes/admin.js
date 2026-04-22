// Platform Admin 전용 라우트 — 결제 연동 전 임시 플랜 수동 조정 / 체험 연장 / 이력 조회
// 모든 엔드포인트는 authenticateToken + requireRole('platform_admin') 이중 체크
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, BusinessMember, User, BusinessPlanHistory } = require('../models');
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

module.exports = router;
