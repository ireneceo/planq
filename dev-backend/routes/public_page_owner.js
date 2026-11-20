// routes/public_page_owner.js — 워크스페이스 «공개» 설정 (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3·§6)
//
//   GET  /api/businesses/:id/public-page          — 상태·업종·지역·주소·최소 기준·자격 (멤버 이상 — 보기)
//   PUT  /api/businesses/:id/public-page          — 업종·지역·주소(slug) 저장 (오너·플랫폼 관리자)
//   POST /api/businesses/:id/public-page/request  — 공개 신청 off → pending (최소 기준·자격 통과 시) → 플랫폼 관리자 알림
//   POST /api/businesses/:id/public-page/off      — 공개 끄기 pending|public → off · 그 요청 안에서 생성 파일 삭제
//
// ★ 승인은 PlanQ 가 한다(Irene 결정 ④) — 여기서 public 으로 바로 가는 문은 없다. blocked 는 주인이 못 푼다.
// ★ 고치는 사람 판정은 창구 설정과 같은 선(routes/customer_entry.js assertEntryAdmin — 오너·플랫폼 관리자).
// ★ businesses.js 앞에 마운트(꼬리 경로 `/public-page*` 만 가진다 — 같은 접두어 라우터 순서 계약).
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Business, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, assertMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const wp = require('../services/workspacePage');

async function assertPageAdmin(req, businessId) {
  if (req.user?.platform_role === 'platform_admin') return true;
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  return !!(scope && (scope.isPlatformAdmin || scope.isOwner));
}

async function stateOf(biz) {
  const owner = await User.findByPk(biz.owner_id, { attributes: ['email_verified_at'] });
  const criteria = wp.criteriaOf(biz, { ownerEmailVerified: !!(owner && owner.email_verified_at) });
  const eligible = await wp.listingEligible(biz.id);
  const origin = process.env.APP_ORIGIN || process.env.FRONTEND_URL || 'https://planq.kr';
  return {
    status: biz.public_page_status,
    category: biz.public_category,
    region: biz.public_region,
    slug: biz.slug,
    slug_problem: wp.slugProblem(biz.slug),
    tags: wp.entryOf(biz).tags,
    published_at: biz.public_published_at,
    block_reason: biz.public_page_status === 'blocked' || biz.public_page_status === 'off' ? biz.public_block_reason : null,
    criteria,
    criteria_ok: criteria.every((c) => c.ok),
    eligible,
    switch_on: await wp.publicPagesOn(),
    public_url: `${String(origin).replace(/\/$/, '')}/w/${biz.slug}`,
    categories: wp.CATEGORIES,
    regions: wp.REGIONS,
  };
}

const loadBiz = (id) => Business.findByPk(id, { attributes: [...wp.PUBLIC_ATTRS, 'owner_id'] });

router.get('/:businessId/public-page', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) return errorResponse(res, 'forbidden', 403);
    const biz = await loadBiz(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    return successResponse(res, await stateOf(biz));
  } catch (err) { next(err); }
});

router.put('/:businessId/public-page', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertPageAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    const b = req.body || {};
    const before = { category: biz.public_category, region: biz.public_region, slug: biz.slug };
    const patch = {};
    if (b.category !== undefined) {
      if (b.category !== null && !wp.CATEGORIES.includes(b.category)) return errorResponse(res, 'invalid_category', 400);
      patch.public_category = b.category;
    }
    if (b.region !== undefined) {
      if (b.region !== null && !wp.REGIONS.includes(b.region)) return errorResponse(res, 'invalid_region', 400);
      patch.public_region = b.region;
    }
    let oldSlug = null;
    if (b.slug !== undefined && b.slug !== biz.slug) {
      const slug = String(b.slug || '').trim().toLowerCase();
      const problem = wp.slugProblem(slug);
      if (problem) return errorResponse(res, problem, 400);
      const taken = await Business.count({ where: { slug, id: { [Op.ne]: businessId } } });
      if (taken) return errorResponse(res, 'slug_taken', 409);
      patch.slug = slug;
      oldSlug = biz.slug;
    }
    if (b.tags !== undefined) {
      const permissions = { ...(biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {}) };
      const ce = wp.normalizeEntry({ ...wp.entryOf(biz), tags: b.tags }, { hadSaved: true });
      permissions.customer_entry = ce;
      patch.permissions = permissions;
    }
    if (!Object.keys(patch).length) return successResponse(res, await stateOf(await loadBiz(businessId)));
    await biz.update(patch);
    // 공개 중에 주소를 바꾸면 옛 주소는 그 자리에서 끊긴다(화면의 확인 창이 그 사실을 말한다 — 옛 주소 넘김은 P4)
    if (oldSlug && biz.public_page_status === 'public') {
      require('../services/seoWorkspacePages').removeWorkspacePageFiles(oldSlug);
      require('../services/seoWorkspacePages').regenerateSoon();
    } else if (biz.public_page_status === 'public') {
      require('../services/seoWorkspacePages').regenerateSoon();
    }
    createAuditLog({
      userId: req.user.id, businessId, action: 'public_page.update', targetType: 'business', targetId: businessId,
      oldValue: before, newValue: { category: biz.public_category, region: biz.public_region, slug: biz.slug },
    });
    return successResponse(res, await stateOf(await loadBiz(businessId)));
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return errorResponse(res, 'slug_taken', 409);
    next(err);
  }
});

router.post('/:businessId/public-page/request', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertPageAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const biz = await loadBiz(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    if (biz.public_page_status === 'blocked') return errorResponse(res, 'blocked', 409);
    if (biz.public_page_status !== 'off') return successResponse(res, await stateOf(biz), 'unchanged');
    if (!(await wp.publicPagesOn())) return errorResponse(res, 'public_pages_disabled', 409);
    if (!(await wp.listingEligible(businessId))) return errorResponse(res, 'plan_required', 403);
    const st = await stateOf(biz);
    if (!st.criteria_ok) return errorResponse(res, 'criteria_unmet', 400);
    if (st.slug_problem) return errorResponse(res, st.slug_problem, 400);
    // 창구 링크가 없어도 공개 주소는 열린다(문의 폼은 공개 주소에서도 받는다). 예약·채팅 버튼만 없다.
    await Business.update({ public_page_status: 'pending', public_block_reason: null }, { where: { id: businessId, public_page_status: 'off' } });
    createAuditLog({ userId: req.user.id, businessId, action: 'public_page.request', targetType: 'business', targetId: businessId,
      oldValue: { status: 'off' }, newValue: { status: 'pending' } });
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      notifyPlatformAdmins({
        eventKind: 'inquiry',
        title: `공개 페이지 승인 요청 — ${biz.brand_name || biz.name}`,
        body: `«회사 찾기» 공개 신청이 들어왔습니다. 주소 /w/${biz.slug} · 업종 ${biz.public_category || '-'}`,
        link: `${APP_URL}/admin/public-pages?status=pending`,
        ctaLabel: '승인 대기 보기',
        relatedEntityId: biz.id,
      }).catch(() => null);
    });
    return successResponse(res, await stateOf(await loadBiz(businessId)), 'requested');
  } catch (err) { next(err); }
});

router.post('/:businessId/public-page/off', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertPageAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const biz = await loadBiz(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);
    if (biz.public_page_status === 'blocked') return errorResponse(res, 'blocked', 409);
    if (biz.public_page_status === 'off') return successResponse(res, await stateOf(biz), 'unchanged');
    const before = biz.public_page_status;
    await Business.update({ public_page_status: 'off' }, { where: { id: businessId } });
    // ★ 그 요청 안에서 생성 파일을 지운다 — 다음 0시까지 남으면 «껐는데 보인다»(§3). 사이트맵·목록은 곧 다시 만든다.
    const removed = require('../services/seoWorkspacePages').removeWorkspacePageFiles(biz.slug);
    require('../services/seoWorkspacePages').regenerateSoon();
    createAuditLog({ userId: req.user.id, businessId, action: 'public_page.off', targetType: 'business', targetId: businessId,
      oldValue: { status: before }, newValue: { status: 'off', removed_files: removed } });
    return successResponse(res, await stateOf(await loadBiz(businessId)), 'off');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.stateOf = stateOf;
