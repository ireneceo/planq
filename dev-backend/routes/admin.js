// Platform Admin 전용 라우트 — 결제 연동 전 임시 플랜 수동 조정 / 체험 연장 / 이력 조회
// 모든 엔드포인트는 authenticateToken + requireRole('platform_admin') 이중 체크
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, BusinessMember, User, BusinessPlanHistory, PlatformSetting } = require('../models');
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

// PUT /api/admin/platform-settings — 단일 row upsert. body: { brand, tagline, website, support_email, legal_entity, email_logo_url }
router.put('/platform-settings', async (req, res, next) => {
  try {
    const { brand, tagline, website, support_email, legal_entity, email_logo_url } = req.body || {};
    if (brand !== undefined && (!String(brand).trim() || String(brand).length > 100)) {
      return errorResponse(res, 'brand_invalid', 400);
    }
    const updates = {
      ...(brand !== undefined ? { brand: String(brand).trim() } : {}),
      ...(tagline !== undefined ? { tagline: tagline ? String(tagline).slice(0, 300) : null } : {}),
      ...(website !== undefined ? { website: website ? String(website).slice(0, 300) : null } : {}),
      ...(support_email !== undefined ? { support_email: support_email ? String(support_email).slice(0, 200) : null } : {}),
      ...(legal_entity !== undefined ? { legal_entity: legal_entity ? String(legal_entity).slice(0, 100) : null } : {}),
      ...(email_logo_url !== undefined ? { email_logo_url: email_logo_url ? String(email_logo_url).slice(0, 500) : null } : {}),
      updated_by_user_id: req.user.id,
    };
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

module.exports = router;
