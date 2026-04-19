const express = require('express');
const router = express.Router();
const { Business, BusinessMember, User, CueUsage } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

// ─── 공통: 현재 월(YYYY-MM) ───
const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ─── 공통: Cue 월 한도 (plan 별) ───
const PLAN_CUE_LIMITS = {
  free: 500,
  basic: 5000,
  pro: 25000,
  enterprise: 100000
};

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─── List businesses for current user ───
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.platform_role === 'platform_admin') {
      const businesses = await Business.findAll({
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
        order: [['created_at', 'DESC']]
      });
      return successResponse(res, businesses);
    }

    const memberships = await BusinessMember.findAll({
      where: { user_id: req.user.id },
      include: [{
        model: Business,
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }]
      }]
    });
    const businesses = memberships.map(m => m.Business);
    successResponse(res, businesses);
  } catch (error) {
    next(error);
  }
});

// ─── Create business (platform admin 전용 or 수동 생성) ───
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { brand_name, name, slug, default_language } = req.body;
    const bName = brand_name || name;
    if (!bName || !slug) {
      return errorResponse(res, 'Brand name and slug required', 400);
    }

    const existing = await Business.findOne({ where: { slug } });
    if (existing) return errorResponse(res, 'Slug already taken', 409);

    const business = await Business.create({
      name: bName,
      brand_name: bName,
      slug,
      owner_id: req.user.id,
      default_language: default_language === 'en' ? 'en' : 'ko',
      cue_mode: 'smart'
    });

    await BusinessMember.create({
      business_id: business.id,
      user_id: req.user.id,
      role: 'owner',
      joined_at: new Date()
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.create',
      targetType: 'business',
      targetId: business.id
    });

    successResponse(res, business, 'Workspace created', 201);
  } catch (error) {
    next(error);
  }
});

// ─── Get workspace detail (Cue 계정 포함 멤버) ───
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'cueUser', attributes: ['id', 'name', 'avatar_url', 'is_ai'] },
        {
          model: BusinessMember,
          as: 'members',
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai'] }]
        }
      ]
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Legacy PUT — 브랜드 갱신으로 매핑 ───
router.put('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const updates = {};
    const allowed = ['brand_name', 'brand_logo_url', 'brand_color', 'name', 'logo_url'];
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    // name 이 오면 brand_name 에도 반영 (legacy 호환)
    if (updates.name && !updates.brand_name) updates.brand_name = updates.name;

    await business.update(updates);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Brand 정보 수정 ───
router.put('/:businessId/brand', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { brand_name, brand_name_en, brand_tagline, brand_tagline_en,
            brand_logo_url, brand_color } = req.body;

    const oldValue = {
      brand_name: business.brand_name,
      brand_name_en: business.brand_name_en,
      brand_color: business.brand_color
    };

    const updates = {};
    if (brand_name !== undefined) {
      if (!brand_name || String(brand_name).trim().length === 0) {
        return errorResponse(res, 'Brand name cannot be empty', 400);
      }
      updates.brand_name = String(brand_name).trim().slice(0, 200);
      updates.name = updates.brand_name; // legacy 동기
    }
    if (brand_name_en !== undefined) {
      updates.brand_name_en = brand_name_en ? String(brand_name_en).trim().slice(0, 200) : null;
    }
    if (brand_tagline !== undefined) {
      updates.brand_tagline = brand_tagline ? String(brand_tagline).slice(0, 500) : null;
    }
    if (brand_tagline_en !== undefined) {
      updates.brand_tagline_en = brand_tagline_en ? String(brand_tagline_en).slice(0, 500) : null;
    }
    if (brand_logo_url !== undefined) {
      updates.brand_logo_url = brand_logo_url ? String(brand_logo_url).slice(0, 500) : null;
    }
    if (brand_color !== undefined) {
      if (brand_color && !/^#[0-9A-Fa-f]{3,8}$/.test(brand_color)) {
        return errorResponse(res, 'Invalid color hex', 400);
      }
      updates.brand_color = brand_color || null;
    }

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.brand_update',
      targetType: 'business',
      targetId: business.id,
      oldValue,
      newValue: updates
    });

    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Legal 정보 수정 ───
router.put('/:businessId/legal', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const fields = [
      'legal_name', 'legal_name_en', 'legal_entity_type', 'tax_id',
      'representative', 'representative_en', 'address', 'address_en',
      'phone', 'email', 'website'
    ];

    const validEntityTypes = ['corporation', 'individual', 'llc', 'other'];
    const updates = {};
    const oldValue = {};

    for (const k of fields) {
      if (k in req.body) {
        let v = req.body[k];
        if (v === '' || v === null || v === undefined) {
          v = null;
        } else {
          v = String(v).trim();
          if (k === 'legal_entity_type' && !validEntityTypes.includes(v)) {
            return errorResponse(res, 'Invalid entity type', 400);
          }
          if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
            return errorResponse(res, 'Invalid email format', 400);
          }
          if (k === 'website' && v && !/^https?:\/\//i.test(v)) {
            v = 'https://' + v;
          }
        }
        oldValue[k] = business[k];
        updates[k] = v;
      }
    }

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.legal_update',
      targetType: 'business',
      targetId: business.id,
      oldValue,
      newValue: updates
    });

    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Settings (언어·타임존·근무시간) ───
router.put('/:businessId/settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { default_language, timezone, reference_timezones, work_hours } = req.body;
    const updates = {};

    if (default_language !== undefined) {
      if (!['ko', 'en'].includes(default_language)) {
        return errorResponse(res, 'Supported languages: ko, en', 400);
      }
      updates.default_language = default_language;
    }
    const TZ_RE = /^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/;
    if (timezone !== undefined) {
      if (timezone && !TZ_RE.test(timezone)) {
        return errorResponse(res, 'Invalid timezone', 400);
      }
      updates.timezone = timezone || 'Asia/Seoul';
    }
    if (reference_timezones !== undefined) {
      if (reference_timezones !== null && !Array.isArray(reference_timezones)) {
        return errorResponse(res, 'Invalid reference_timezones', 400);
      }
      const cleaned = (reference_timezones || [])
        .filter((t) => typeof t === 'string' && TZ_RE.test(t))
        .slice(0, 20);
      updates.reference_timezones = cleaned.length ? cleaned : null;
    }
    if (work_hours !== undefined) updates.work_hours = work_hours || null;

    await business.update(updates);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── 멤버 목록 (Cue 포함) ───
router.get('/:businessId/members', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const members = await BusinessMember.findAll({
      where: { business_id: req.params.businessId },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai', 'last_login_at']
      }],
      order: [
        ['role', 'ASC'], // 'ai' → 'member' → 'owner' (역순정렬은 수동 처리)
        ['created_at', 'ASC']
      ]
    });
    successResponse(res, members);
  } catch (error) {
    next(error);
  }
});

// ─── Cue 설정·사용량 조회 ───
router.get('/:businessId/cue', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      include: [{ model: User, as: 'cueUser', attributes: ['id', 'name', 'avatar_url'] }]
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const ym = currentYearMonth();
    const rows = await CueUsage.findAll({
      where: { business_id: business.id, year_month: ym }
    });

    const totalCount = rows.reduce((sum, r) => sum + (r.action_count || 0), 0);
    const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    const byType = {};
    rows.forEach(r => { byType[r.action_type] = r.action_count; });

    const limit = PLAN_CUE_LIMITS[business.plan] || PLAN_CUE_LIMITS.free;

    successResponse(res, {
      cue_user_id: business.cue_user_id,
      cue_user: business.cueUser,
      mode: business.cue_mode,
      paused: business.cue_paused,
      usage: {
        year_month: ym,
        action_count: totalCount,
        limit,
        remaining: Math.max(0, limit - totalCount),
        cost_usd: Number(totalCost.toFixed(6)),
        by_type: byType
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─── Cue 모드·일시정지 설정 ───
router.put('/:businessId/cue', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { mode, paused } = req.body;
    const updates = {};
    if (mode !== undefined) {
      if (!['smart', 'auto', 'draft'].includes(mode)) {
        return errorResponse(res, 'Invalid mode', 400);
      }
      updates.cue_mode = mode;
    }
    if (paused !== undefined) updates.cue_paused = !!paused;

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: updates.paused ? 'cue.pause' : (updates.cue_mode ? 'cue.mode_change' : 'cue.resume'),
      targetType: 'business',
      targetId: business.id,
      newValue: updates
    });

    successResponse(res, {
      mode: business.cue_mode,
      paused: business.cue_paused
    });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/businesses/:id/members/:memberId/work-hours ───
router.patch('/:id/members/:memberId/work-hours', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.id);
    // 본인 또는 admin만
    const member = await BusinessMember.findOne({ where: { id: req.params.memberId, business_id: businessId } });
    if (!member) return errorResponse(res, 'member_not_found', 404);
    if (member.user_id !== req.user.id) {
      const reqMember = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
      if (!reqMember || (reqMember.role !== 'owner' && req.user.platform_role !== 'platform_admin')) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const updates = {};
    if (req.body.daily_work_hours !== undefined) updates.daily_work_hours = Math.max(0, Math.min(24, Number(req.body.daily_work_hours) || 0));
    if (req.body.weekly_work_days !== undefined) updates.weekly_work_days = Math.max(1, Math.min(7, Number(req.body.weekly_work_days) || 5));
    if (req.body.participation_rate !== undefined) updates.participation_rate = Math.max(0, Math.min(1, Number(req.body.participation_rate) || 1));
    await member.update(updates);
    return successResponse(res, member.toJSON());
  } catch (err) { next(err); }
});

// ─── PATCH /api/businesses/:id/members/:memberId/default-role ───
router.patch('/:id/members/:memberId/default-role', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.id);
    // 권한 확인: owner만
    const reqMember = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
    if (!reqMember || (reqMember.role !== 'owner' && req.user.platform_role !== 'platform_admin')) {
      return errorResponse(res, 'admin_only', 403);
    }
    const member = await BusinessMember.findOne({
      where: { id: req.params.memberId, business_id: businessId },
    });
    if (!member) return errorResponse(res, 'member_not_found', 404);
    const { default_role } = req.body || {};
    await member.update({ default_role: default_role ? String(default_role).trim().slice(0, 50) : null });
    return successResponse(res, member.toJSON());
  } catch (err) { next(err); }
});

module.exports = router;
