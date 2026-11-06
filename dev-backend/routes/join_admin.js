// 워크스페이스 참여 신청 — 워크스페이스 쪽 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §5-3·§6-3, Fable 설계)
//   GET  /api/businesses/:businessId/join-requests                 — 신청 목록 (owner·admin)
//   POST /api/businesses/:businessId/join-requests/:rid/approve    — 승인 {role?: member|admin} (owner·admin)
//   POST /api/businesses/:businessId/join-requests/:rid/reject     — 거절 {note?} (owner·admin)
//   GET  /api/businesses/:businessId/join-settings                 — 참여 설정 (대표만 — 코드는 이 문에서만 나간다)
//   PUT  /api/businesses/:businessId/join-settings                 — 켜기·끄기 (대표만)
//   POST /api/businesses/:businessId/join-settings/rotate-code     — 코드 새로 (대표만)
// 마운트는 businesses.js 보다 앞 — 꼬리 경로(join-requests·join-settings)만 둔다.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { isWorkspaceAdminReq } = require('../middleware/access_scope');
const { Business, User, WorkspaceJoinRequest } = require('../models');
const policy = require('../services/joinPolicy');
const JR = require('../services/joinRequests');

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function requireAdmin(req, res, next) {
  if (!isWorkspaceAdminReq(req)) return errorResponse(res, 'workspace_admin_required', 403);
  return next();
}

/** 대표(owner_id) 또는 플랫폼 관리자 — 관리자(admin)는 참여 설정을 못 바꾼다(켜면 같은 도메인 전원에게 회사 이름이 보인다). */
async function loadOwnerBiz(req, res) {
  const biz = await Business.findOne({ where: { id: Number(req.params.businessId), deleted_at: null } });
  if (!biz) { errorResponse(res, 'not_found', 404); return null; }
  const isOwner = biz.owner_id === req.user.id || req.user.platform_role === 'platform_admin';
  if (!isOwner) { errorResponse(res, 'owner_required', 403); return null; }
  return biz;
}

async function settingsView(biz) {
  const pending = await WorkspaceJoinRequest.count({ where: { business_id: biz.id, status: 'pending' } });
  return {
    join_by_domain: !!biz.join_by_domain,
    join_domain: biz.join_domain || null,
    domain_open: await policy.domainJoinOpen(biz),
    owner_domains: await policy.ownerVerifiedDomains(biz),
    code_enabled: !!biz.join_code,
    join_code: policy.formatCode(biz.join_code),
    join_code_rotated_at: biz.join_code_rotated_at || null,
    pending_count: pending,
  };
}

async function newUniqueCode() {
  for (let i = 0; i < 8; i++) {
    const c = policy.generateCode();
    if (!(await Business.findOne({ where: { join_code: c }, attributes: ['id'] }))) return c;
  }
  throw new Error('join_code_generation_failed');
}

router.get('/:businessId/join-requests', authenticateToken, checkBusinessAccess, requireAdmin, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const now = Date.now();
    const rows = await WorkspaceJoinRequest.findAll({
      where: { business_id: businessId, status: 'pending' },
      include: [{ model: User, as: 'requester', attributes: ['id', 'name', 'email', 'avatar_url'] }],
      order: [['requested_at', 'DESC']], limit: 200,
    });
    const out = [];
    for (const r of rows) {
      const live = JR.isLive(r, now);
      if (!live && now - new Date(r.expires_at).getTime() > JR.SHOW_EXPIRED_MS) continue;
      out.push({
        id: r.id, source: r.source, message: r.message || null,
        requested_at: r.requested_at, expires_at: r.expires_at, expired: !live,
        // 아직 멤버가 아니라 워크스페이스 표시명이 없다 — 계정 이름(승인 뒤부터 표시명 규칙)
        user: r.requester ? { id: r.requester.id, name: r.requester.name, email: r.requester.email, avatar_url: r.requester.avatar_url || null } : null,
      });
    }
    const seats = await require('../services/memberInvite').seatsRemaining(businessId);
    return successResponse(res, { requests: out, seats_remaining: Number.isFinite(seats.remaining) ? seats.remaining : null });
  } catch (e) { next(e); }
});

router.post('/:businessId/join-requests/:rid/approve', authenticateToken, checkBusinessAccess, requireAdmin, async (req, res, next) => { // audit-exempt: 감사는 services/joinRequests.approve 가 쓴다(workspace.join_approve)
  try {
    const r = await JR.approve({
      businessId: Number(req.params.businessId), requestId: Number(req.params.rid), role: req.body?.role,
      approver: req.user, io: req.app.get('io'), actorReq: req,
    });
    return successResponse(res, { id: r.row.id, status: 'approved', member_id: r.member.id, role: r.member.role });
  } catch (e) {
    if (e instanceof JR.JoinError) return e.body ? res.status(e.status).json(e.body) : errorResponse(res, e.code, e.status);
    next(e);
  }
});

router.post('/:businessId/join-requests/:rid/reject', authenticateToken, checkBusinessAccess, requireAdmin, async (req, res, next) => { // audit-exempt: 감사는 services/joinRequests.reject 가 쓴다(workspace.join_reject)
  try {
    const row = await JR.reject({
      businessId: Number(req.params.businessId), requestId: Number(req.params.rid), note: req.body?.note,
      approver: req.user, io: req.app.get('io'), actorReq: req,
    });
    return successResponse(res, { id: row.id, status: 'rejected', retry_after: row.retry_after });
  } catch (e) {
    if (e instanceof JR.JoinError) return errorResponse(res, e.code, e.status);
    next(e);
  }
});

router.get('/:businessId/join-settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const biz = await loadOwnerBiz(req, res); if (!biz) return;
    return successResponse(res, await settingsView(biz));
  } catch (e) { next(e); }
});

router.put('/:businessId/join-settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const biz = await loadOwnerBiz(req, res); if (!biz) return;
    const before = { join_by_domain: !!biz.join_by_domain, join_domain: biz.join_domain || null, code_enabled: !!biz.join_code };
    const patch = {};
    if (req.body?.join_by_domain !== undefined) {
      const on = req.body.join_by_domain === true;
      if (on) {
        const owned = await policy.ownerVerifiedDomains(biz);
        const want = String(req.body.join_domain || biz.join_domain || owned[0] || '').trim().toLowerCase().replace(/^@/, '');
        if (!want || !DOMAIN_RE.test(want) || !owned.includes(want)) return errorResponse(res, 'domain_not_verified', 400);
        patch.join_by_domain = true; patch.join_domain = want;
      } else {
        patch.join_by_domain = false;
      }
    }
    if (req.body?.code_enabled !== undefined) {
      if (req.body.code_enabled === true && !biz.join_code) { patch.join_code = await newUniqueCode(); patch.join_code_rotated_at = new Date(); }
      if (req.body.code_enabled === false) { patch.join_code = null; patch.join_code_rotated_at = null; }
    }
    if (Object.keys(patch).length) await biz.update(patch);
    const after = { join_by_domain: !!biz.join_by_domain, join_domain: biz.join_domain || null, code_enabled: !!biz.join_code };
    require('../services/auditService').logAudit(req, {
      action: 'business.join_settings', targetType: 'business', targetId: biz.id, businessId: biz.id,
      oldValue: before, newValue: after,   // 코드 값은 싣지 않는다 — 켜짐 여부만
    });
    return successResponse(res, await settingsView(biz));
  } catch (e) { next(e); }
});

router.post('/:businessId/join-settings/rotate-code', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const biz = await loadOwnerBiz(req, res); if (!biz) return;
    if (!biz.join_code) return errorResponse(res, 'join_code_disabled', 400);
    await biz.update({ join_code: await newUniqueCode(), join_code_rotated_at: new Date() });   // 옛 코드는 즉시 무효 · 들어온 신청은 그대로
    require('../services/auditService').logAudit(req, {
      action: 'business.join_code_rotate', targetType: 'business', targetId: biz.id, businessId: biz.id,
    });
    return successResponse(res, await settingsView(biz));
  } catch (e) { next(e); }
});

module.exports = router;
