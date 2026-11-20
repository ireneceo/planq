// routes/admin_public_pages.js — 플랫폼 관리자 «공개 페이지» 심사 (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §6.4)
//
//   Irene 결정 ④ — 첫 공개는 PlanQ 승인. 승인 뒤 내용 수정은 바로 반영(다시 심사하지 않는다 — 대신 «최근 고친 순»).
//   GET  /api/admin/public-pages?status=pending|public|blocked|off
//   POST /api/admin/public-pages/:id/approve   pending → public (published_at)
//   POST /api/admin/public-pages/:id/return    pending → off + 사유 (주인에게 알림)
//   POST /api/admin/public-pages/:id/block     public|pending|off → blocked + 사유 (주인이 다시 못 켠다)
//   POST /api/admin/public-pages/:id/unblock   blocked → off
//   PUT  /api/admin/public-pages/switch {enabled}  전체 끄기 스위치
// ★ 내리기·돌려보내기는 그 요청 안에서 생성 파일을 지운다(services/seoWorkspacePages.removeWorkspacePageFiles).
const express = require('express');
const router = express.Router();
const { Business, BusinessMember, PlatformSetting } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const wp = require('../services/workspacePage');
const seo = require('../services/seoWorkspacePages');

const chain = [authenticateToken, requireRole('platform_admin')];

async function notifyOwner(biz, { action, detail, ioApp }) {
  try {
    const { notify } = require('./notifications');
    const owners = await BusinessMember.findAll({ where: { business_id: biz.id, role: 'owner', removed_at: null }, attributes: ['user_id'], raw: true });
    for (const o of owners) {
      if (!o.user_id) continue;
      await notify({
        userId: o.user_id, businessId: biz.id, eventKind: 'system',
        titleSpec: { feature: 'system', action, detail: detail || null },
        link: '/business/settings/public-page', entityType: 'business', entityId: biz.id, ioApp,
      });
    }
  } catch (e) { console.warn('[admin-public-pages] notify 실패', e.message); }
}

router.get('/public-pages', ...chain, async (req, res, next) => {
  try {
    const status = wp.PUBLIC_STATUSES.includes(req.query.status) ? req.query.status : 'pending';
    const rows = await Business.findAll({
      where: { public_page_status: status, deleted_at: null },
      attributes: [...wp.PUBLIC_ATTRS, 'public_block_reason', 'plan', 'subscription_status'],
      order: [['updated_at', 'DESC']], limit: 200,
    });
    const items = [];
    for (const b of rows) {
      items.push({
        id: b.id, slug: b.slug, name: b.brand_name || b.name, category: b.public_category, region: b.public_region,
        status: b.public_page_status, published_at: b.public_published_at, updated_at: b.updated_at,
        block_reason: b.public_block_reason, plan: b.plan, eligible: await wp.listingEligible(b.id),
        preview: wp.publicPageView(b),
      });
    }
    const counts = {};
    for (const s of wp.PUBLIC_STATUSES) counts[s] = await Business.count({ where: { public_page_status: s, deleted_at: null } });
    return successResponse(res, { items, counts, switch_on: await wp.publicPagesOn() });
  } catch (err) { next(err); }
});

async function transition(req, res, next, { from, to, needReason = false, action, notifyAction }) {
  try {
    const id = Number(req.params.id) || 0;
    const biz = await Business.findByPk(id, { attributes: [...wp.PUBLIC_ATTRS, 'public_block_reason'] });
    if (!biz || biz.deleted_at) return errorResponse(res, 'not_found', 404);
    if (!from.includes(biz.public_page_status)) return errorResponse(res, 'invalid_state', 409);
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 255);
    if (needReason && !reason) return errorResponse(res, 'reason_required', 400);
    if (to === 'public' && !(await wp.listingEligible(id))) return errorResponse(res, 'plan_required', 409);
    const before = biz.public_page_status;
    const patch = { public_page_status: to };
    if (to === 'public') { patch.public_published_at = biz.public_published_at || new Date(); patch.public_block_reason = null; }
    if (needReason) patch.public_block_reason = reason;
    if (to === 'off' && before === 'blocked') patch.public_block_reason = null;
    await Business.update(patch, { where: { id, public_page_status: before } });
    if (to !== 'public') seo.removeWorkspacePageFiles(biz.slug);
    seo.regenerateSoon();
    createAuditLog({ userId: req.user.id, businessId: id, action, targetType: 'business', targetId: id,
      oldValue: { status: before }, newValue: { status: to, reason: reason || null } });
    if (notifyAction) await notifyOwner(biz, { action: notifyAction, detail: reason || null, ioApp: req.app });
    return successResponse(res, { id, status: to });
  } catch (err) { next(err); }
}

router.post('/public-pages/:id/approve', ...chain, (req, res, next) => transition(req, res, next,
  { from: ['pending'], to: 'public', action: 'public_page.approve', notifyAction: 'public_page_approved' }));
router.post('/public-pages/:id/return', ...chain, (req, res, next) => transition(req, res, next,
  { from: ['pending'], to: 'off', needReason: true, action: 'public_page.return', notifyAction: 'public_page_returned' }));
router.post('/public-pages/:id/block', ...chain, (req, res, next) => transition(req, res, next,
  { from: ['public', 'pending', 'off'], to: 'blocked', needReason: true, action: 'public_page.block', notifyAction: 'public_page_blocked' }));
router.post('/public-pages/:id/unblock', ...chain, (req, res, next) => transition(req, res, next,
  { from: ['blocked'], to: 'off', action: 'public_page.unblock', notifyAction: null }));

router.put('/public-pages/switch', ...chain, async (req, res, next) => {
  try {
    const enabled = req.body && req.body.enabled === true;
    const row = await PlatformSetting.findOne();
    if (!row) return errorResponse(res, 'not_found', 404);
    const before = row.public_pages_enabled;
    await row.update({ public_pages_enabled: enabled });
    wp.invalidatePublicSwitch();
    seo.regenerateSoon();
    createAuditLog({ userId: req.user.id, businessId: null, action: 'public_page.switch', targetType: 'platform_setting', targetId: row.id,
      oldValue: { enabled: before }, newValue: { enabled } });
    return successResponse(res, { enabled });
  } catch (err) { next(err); }
});

module.exports = router;
